// @vitest-environment node
/**
 * Request-shape proof for the generation pipeline builder in convex/generation.ts (model-defaults SPEC A.0 rule 6):
 * `generateInitial` and `decompose` reach pi-ai through `callValidatedPipelineModel`, driven here through their
 * registered Convex handlers with a fake ctx and a stubbed fetch (always 400, no spend). Asserts the model that goes
 * on the wire, the production cap, the effort that applies, and the paid recovery hop on BALANCED.
 */
import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decompose, generateInitial } from './generation';
import {
  FREE_FALLBACK_MODEL,
  OUTPUT_CAPS,
  PHASE_EFFORT,
  VERIFIED_FREE_MODEL,
} from './lib/autoRouter';

type Body = Record<string, unknown>;
let bodies: Body[] = [];

// Sentinels distinct from pi-ai's default 'high' so a missing pass-through is visible (see chatLoop.requestShape).
const ORIGINAL_EFFORT = { ...PHASE_EFFORT };

beforeEach(() => {
  Object.assign(PHASE_EFFORT, { generate: 'medium', decompose: 'low' });
  bodies = [];
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({ error: { type: 'invalid_request_error', message: 'fake transport' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
});

afterEach(() => {
  Object.assign(PHASE_EFFORT, ORIGINAL_EFFORT);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const fakeCtx = (run: { tier: string }) => ({
  runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
    if (getFunctionName(ref) === 'runs:getInternal') return run;
    throw new Error(`unexpected query ${getFunctionName(ref)}`);
  },
  runMutation: async () => null,
});

// biome-ignore lint/suspicious/noExplicitAny: Convex registered functions expose their handler as _handler
const handlerOf = (registered: unknown): ((ctx: any, args: any) => Promise<any>) =>
  (registered as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;

const generateHandler = handlerOf(generateInitial);
const decomposeHandler = handlerOf(decompose);

/** The effort that governs the turn on a managed-effort 5.5 model: the top-level `output_config.effort`. */
function activeEffort(body: Body): unknown {
  const messages = body['messages'] as Array<{ role: string; output_config?: { effort?: string } }>;
  expect(messages.at(-1)?.role, 'trailing effort message').toBe('system');
  const topLevel = (body['output_config'] as { effort?: string } | undefined)?.effort;
  // The API applies a per-message effort from the NEXT user turn and none follows, so the top-level value is the
  // one that governs this turn: it must carry the phase effort, and the trailing message must agree with it.
  expect(messages.at(-1)?.output_config?.effort, 'trailing effort agrees with top level').toBe(
    topLevel,
  );
  return topLevel;
}

describe('generation pipeline builds the SPEC 1.2 request', () => {
  it('FRONTIER generate: claude-sonnet-5-5, 16k cap, the generate phase effort, no forbidden keys', async () => {
    await expect(
      generateHandler(fakeCtx({ tier: 'frontier' }), { runId: 'run_1', prompt: 'a landing page' }),
    ).rejects.toThrow(/generate stage error/);
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as Body;
    expect(body['model']).toBe('claude-sonnet-5-5');
    expect(body['max_tokens']).toBe(OUTPUT_CAPS.generate);
    expect(activeEffort(body)).toBe('medium');
    for (const key of ['temperature', 'top_p', 'top_k', 'tool_choice']) {
      expect(body, key).not.toHaveProperty(key);
    }
  });

  it('FRONTIER decompose: claude-opus-5-5, 24k cap, the decompose phase effort', async () => {
    await expect(
      decomposeHandler(fakeCtx({ tier: 'frontier' }), {
        runId: 'run_1',
        artifactVersion: 0,
        artifactHtml: '<html></html>',
      }),
    ).rejects.toThrow(/decompose stage error/);
    const body = bodies[0] as Body;
    expect(body['model']).toBe('claude-opus-5-5');
    expect(body['max_tokens']).toBe(OUTPUT_CAPS.decompose);
    expect(activeEffort(body)).toBe('low');
  });

  it('BALANCED generate: kimi-k2.6 with its real cap, then the paid Sonnet 5.5 recovery hop', async () => {
    await expect(
      generateHandler(fakeCtx({ tier: 'balanced' }), { runId: 'run_1', prompt: 'a landing page' }),
    ).rejects.toThrow(/generate stage error/);
    expect(bodies.map((b) => b['model'])).toEqual([
      'moonshotai/kimi-k2.6',
      'anthropic/claude-sonnet-5.5',
    ]);
    for (const body of bodies) {
      expect(body['max_tokens'] ?? body['max_completion_tokens']).toBe(OUTPUT_CAPS.generate);
    }
  });

  it('FREE generate: nemotron then the free gemma recovery hop, never a paid model (SPEC A.0.10)', async () => {
    await expect(
      generateHandler(fakeCtx({ tier: 'free' }), { runId: 'run_1', prompt: 'a landing page' }),
    ).rejects.toThrow(/generate stage error/);
    expect(bodies.map((b) => b['model'])).toEqual([VERIFIED_FREE_MODEL, FREE_FALLBACK_MODEL]);
  });

  it('FREE generate with a source image: the text-only primary is rejected locally, the free image-capable fallback serves it', async () => {
    await expect(
      generateHandler(fakeCtx({ tier: 'free' }), {
        runId: 'run_1',
        prompt: 'match this',
        sourceImageBase64: 'iVBORw0KGgo=',
        sourceImageMimeType: 'image/png',
      }),
    ).rejects.toThrow(/does not support image input/);
    // nemotron never reaches the wire (pi-ai rejects image input on a text-only model); gemma does; nothing paid.
    expect(bodies.map((b) => b['model'])).toEqual([FREE_FALLBACK_MODEL]);
  });
});

// Persona: a run was started with a custom model that the catalog has since dropped. On main the stage failed with a
// visible 'failed' status and message; resolving outside the try would throw past it and leave the run 'generating'
// forever. The id is refused before a request exists (A.0.10) and the run still ends in a visible failure.
describe('an unknown stored model override fails the stage visibly, with zero requests', () => {
  const badRun = {
    tier: 'frontier',
    modelOverride: { provider: 'openrouter', modelId: 'made-up/paid-model' },
  };
  const recordingCtx = (statuses: Array<Record<string, unknown>>) => ({
    ...fakeCtx(badRun as never),
    runMutation: async (
      ref: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) => {
      if (getFunctionName(ref) === 'runs:updateStatus') statuses.push(args);
      return null;
    },
  });

  it('generate and decompose mark the run failed with the stage error', async () => {
    const statuses: Array<Record<string, unknown>> = [];
    await expect(
      generateHandler(recordingCtx(statuses), { runId: 'run_1', prompt: 'a landing page' }),
    ).rejects.toThrow(/generate stage error: Unknown model "made-up\/paid-model"/);
    await expect(
      decomposeHandler(recordingCtx(statuses), {
        runId: 'run_1',
        artifactVersion: 0,
        artifactHtml: '<html></html>',
      }),
    ).rejects.toThrow(/decompose stage error: Unknown model/);
    expect(statuses.filter((s) => s['status'] === 'failed')).toHaveLength(2);
    expect(bodies).toHaveLength(0);
  });
});
