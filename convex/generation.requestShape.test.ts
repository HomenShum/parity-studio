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
import { OUTPUT_CAPS, PHASE_EFFORT } from './lib/autoRouter';

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

function activeEffort(body: Body): unknown {
  const messages = body['messages'] as Array<{ role: string; output_config?: { effort?: string } }>;
  expect(messages.at(-1)?.role, 'trailing effort message').toBe('system');
  return messages.at(-1)?.output_config?.effort;
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
});
