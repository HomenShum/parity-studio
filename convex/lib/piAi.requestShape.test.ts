// @vitest-environment node
/**
 * Request-shape proof for the Claude 5.5 refresh (model-defaults SPEC A.0 rule 6, A.2.7).
 *
 * Builds a REAL request through this repo's own builder (`call()` in ./piAi, which resolves the model through
 * pi-ai's catalog and serialises the provider payload) against a fake transport (stubbed global fetch), then
 * asserts on the JSON body that would have gone over the wire: the model string equals the SPEC 1.2 id,
 * forbidden keys are absent (SPEC 1.3), and the caller's maxTokens reaches `max_tokens`.
 * No network, no key, no spend: the fake answers 400 so nothing is ever generated.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel } from '@earendil-works/pi-ai/compat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_PRESETS } from '../../src/lib/modelRouting';
import {
  CHAT_DEFAULT_MODEL,
  FREE_FALLBACK_MODEL,
  type ModelTier,
  OUTPUT_CAPS,
  PHASE_EFFORT,
  type Phase,
  VERIFIED_FREE_MODEL,
  resolveModel,
  resolveRunModel,
} from './autoRouter';
import { type Effort, call } from './piAi';

// SPEC 1.2: the only wire ids this PR may write, per transport. Independent literals on purpose: the tier tables
// use named constants, and this table is what those constants are checked against.
const WIRE = {
  'anthropic:claude-haiku-5-5': 'claude-haiku-5-5',
  'anthropic:claude-sonnet-5-5': 'claude-sonnet-5-5',
  'anthropic:claude-opus-5-5': 'claude-opus-5-5',
  'openrouter:anthropic/claude-sonnet-5.5': 'anthropic/claude-sonnet-5.5',
} as const;
const WIRE_FREE = 'nvidia/nemotron-3-super-120b-a12b:free'; // SPEC 1.2 live :free list
const WIRE_FREE_FALLBACK = 'google/gemma-4-26b-a4b-it:free'; // SPEC 1.2 live :free list; takes image input

const TIERS: ModelTier[] = ['frontier', 'balanced', 'free', 'small'];
const PHASES: Phase[] = [
  'enhance',
  'advise',
  'execute',
  'generate',
  'decompose',
  'iterate',
  'judge',
];

// Ids the pre-change code used. The four Claude ids are superseded by the migration guide rename table (SPEC 1.1 lists
// them Active legacy, not retired); ling-2.6-1t:free is absent from OpenRouter (SPEC 1.2 live :free list). None may
// survive in any tier cell or migrated file.
const SUPERSEDED = [
  'claude-haiku-4-5',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-4.6',
  'inclusionai/ling-2.6-1t:free',
];

const repoFile = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

/** Every route of every tier x phase cell, primary and fallback. */
function allRoutes() {
  const out: Array<{
    cell: string;
    phase: Phase;
    kind: 'primary' | 'fallback';
    provider: string;
    modelId: string;
  }> = [];
  for (const tier of TIERS) {
    for (const phase of PHASES) {
      const cell = resolveModel(tier, phase);
      const cellName = `${tier}/${phase}`;
      out.push({
        cell: cellName,
        phase,
        kind: 'primary',
        provider: cell.provider,
        modelId: cell.modelId,
      });
      if (cell.fallback) {
        out.push({
          cell: cellName,
          phase,
          kind: 'fallback',
          provider: cell.fallback.provider,
          modelId: cell.fallback.modelId,
        });
      }
    }
  }
  return out;
}

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

let captured: Captured[] = [];

beforeEach(() => {
  captured = [];
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      captured.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(
        JSON.stringify({ error: { type: 'invalid_request_error', message: 'fake transport' } }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** True when the catalog model speaks the Anthropic Messages API, which is what carries `output_config.effort`. */
function usesAnthropicMessages(provider: string, modelId: string): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai getModel is typed against its compile-time registry
  return (getModel as any)(provider, modelId).api === 'anthropic-messages';
}

async function build(
  provider: 'anthropic' | 'openrouter',
  modelId: string,
  maxTokens: number,
  effort?: Effort,
) {
  captured = [];
  await call({
    provider,
    modelId,
    systemPrompt: 'sys',
    userText: 'hello',
    maxTokens,
    ...(effort !== undefined ? { effort } : {}),
  });
  expect(captured).toHaveLength(1);
  return captured[0]?.body ?? {};
}

/**
 * The effort that governs the turn on a managed-effort 5.5 model. pi-ai 1.1.0 hard-codes the TOP-LEVEL
 * `output_config.effort` to 'high' and carries the per-call `effort` only in a trailing system message
 * (anthropic-messages.js:944,1216), which the API applies from the NEXT user turn; none follows. `call()` therefore
 * rewrites the top-level value (`effortOptions`), and this returns it after checking the trailing message agrees.
 */
function activeEffort(body: Record<string, unknown>): unknown {
  const messages = body['messages'] as Array<{ role: string; output_config?: { effort?: string } }>;
  const last = messages.at(-1);
  expect(last?.role, 'trailing effort message').toBe('system');
  const topLevel = (body['output_config'] as { effort?: string } | undefined)?.effort;
  expect(last?.output_config?.effort, 'trailing effort agrees with top level').toBe(topLevel);
  return topLevel;
}

function assertNoForbiddenKeys(body: Record<string, unknown>) {
  // SPEC 1.3: sampling is a 400 on every 5.5 id; forced tool_choice is a 400 on Sonnet/Opus 5.5.
  for (const key of ['temperature', 'top_p', 'top_k', 'tool_choice']) {
    expect(body, `forbidden key ${key}`).not.toHaveProperty(key);
  }
  // SPEC 1.3: thinking must be adaptive. `disabled` and budget_tokens are 400 on Sonnet/Opus 5.5.
  const thinking = body['thinking'] as Record<string, unknown> | undefined;
  if (thinking !== undefined) {
    expect(thinking['type']).toBe('adaptive');
    expect(thinking).not.toHaveProperty('budget_tokens');
  }
  // SPEC 1.3: assistant prefill is a 400. The request must end on a user turn. pi-ai always appends a trailing
  // `system` effort message on the 5.5 models, so the last message alone can never be 'assistant' there; the check
  // is on the last non-system message (round 3: the old check could not fail).
  const messages = body['messages'] as Array<{ role: string }>;
  expect(messages.filter((m) => m.role !== 'system').at(-1)?.role).not.toBe('assistant');
}

describe('request shape: tier x phase cells', () => {
  it('every Anthropic-provider or claude-named route, primary and fallback, is a SPEC 1.2 wire id (allowlist)', () => {
    // An allowlist, not a denylist: a malformed replacement ('claude-sonnet-5.5' on the direct transport) or an
    // id from the wrong generation ('claude-opus-4-8') is absent from WIRE and fails here, whatever SUPERSEDED lists.
    for (const route of allRoutes()) {
      if (route.provider === 'anthropic' || /claude/i.test(route.modelId)) {
        expect(
          `${route.provider}:${route.modelId}` in WIRE,
          `${route.cell} ${route.kind} ${route.provider}:${route.modelId} is not a SPEC 1.2 wire id`,
        ).toBe(true);
      }
    }
  });

  it('no superseded id survives in any tier cell, primary or fallback', () => {
    const ids = allRoutes().map((r) => r.modelId);
    for (const old of SUPERSEDED) expect(ids, old).not.toContain(old);
  });

  const claudeCells = allRoutes().filter(
    (r) => r.provider === 'anthropic' || /claude/i.test(r.modelId),
  );

  it('covers every Claude cell the refresh touched', () => {
    // opus-5-5 (advise/decompose), sonnet-5-5, haiku-5-5, OpenRouter sonnet 5.5 fallback.
    const ids = new Set(claudeCells.map((c) => `${c.provider}:${c.modelId}`));
    expect(ids).toEqual(new Set(Object.keys(WIRE)));
  });

  for (const cell of claudeCells) {
    it(`${cell.cell} ${cell.kind} ${cell.provider}:${cell.modelId} -> SPEC 1.2 id, no forbidden keys, caller cap honoured`, async () => {
      const body = await build(
        cell.provider as 'anthropic' | 'openrouter',
        cell.modelId,
        1234,
        PHASE_EFFORT[cell.phase],
      );
      expect(body['model']).toBe(WIRE[`${cell.provider}:${cell.modelId}` as keyof typeof WIRE]);
      assertNoForbiddenKeys(body);
      // `maxOutputTokens` is not a pi-ai option; it was silently dropped and the model default (128000) was sent.
      expect(body['max_tokens']).toBe(1234);
      // Selected by the model's wire api, not the provider name: OpenRouter's Claude 5.5 rows are
      // 'anthropic-messages' too and carry the same top-level and trailing effort (review round 5, defect 5).
      if (usesAnthropicMessages(cell.provider, cell.modelId)) {
        // SPEC 1.3 / A.2.7: effort is explicit per phase and the top-level value (the one that governs the turn)
        // carries it. This was `toEqual({ effort: 'high' })` while pi-ai's hard-coded 'high' was mistaken for the
        // inert value; with `enhance` at 'low' that pinned the defect (review round 2, defect 1).
        expect(activeEffort(body), `${cell.cell} active effort`).toBe(PHASE_EFFORT[cell.phase]);
        expect(body['output_config']).toEqual({ effort: PHASE_EFFORT[cell.phase] });
        expect((body['thinking'] as Record<string, unknown>)['type']).toBe('adaptive');
      }
    });
  }

  it('FREE tier primary is the verified free constant and its request carries no sampling keys', async () => {
    const cell = resolveModel('free', 'execute');
    expect(cell.modelId).toBe(WIRE_FREE);
    expect(VERIFIED_FREE_MODEL).toBe(WIRE_FREE);
    expect(FREE_FALLBACK_MODEL).toBe(WIRE_FREE_FALLBACK);
    const body = await build('openrouter', cell.modelId, 777);
    expect(body['model']).toBe(WIRE_FREE);
    for (const key of ['temperature', 'top_p', 'top_k', 'tool_choice']) {
      expect(body, key).not.toHaveProperty(key);
    }
    expect(body['max_tokens'] ?? body['max_completion_tokens']).toBe(777);
  });

  // Behaviour change owned by the maxTokens fix (needs-live-eval scope on PR #101): kimi-k2.6 used to get no cap
  // at all because pi-ai ignored `maxOutputTokens`. The production caps now reach the wire.
  it.each(['generate', 'decompose', 'iterate'] as const)(
    'BALANCED %s (kimi-k2.6) now sends the production cap',
    async (phase) => {
      const cell = resolveModel('balanced', phase);
      expect(cell.modelId).toBe('moonshotai/kimi-k2.6');
      const body = await build('openrouter', cell.modelId, OUTPUT_CAPS[phase]);
      expect(body['max_tokens'] ?? body['max_completion_tokens']).toBe(OUTPUT_CAPS[phase]);
    },
  );
});

describe('request shape: the caller cap is bounded by the model maximum', () => {
  // pi-ai copies maxTokens into the request unclamped; gemma-4-26b :free (the FREE-tier recovery model) tops out at
  // 32,768 in the pi-ai 1.1.0 catalog, below OUTPUT_CAPS.agentLoop (64,000).
  const GEMMA = 'google/gemma-4-26b-a4b-it:free';
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModel surface
  const gemmaMax: number = (getModel as any)('openrouter', GEMMA).maxTokens;

  it('a cap above the catalog maximum is sent as the maximum', async () => {
    expect(gemmaMax).toBeLessThan(OUTPUT_CAPS.agentLoop);
    const body = await build('openrouter', GEMMA, OUTPUT_CAPS.agentLoop);
    expect(body['max_tokens'] ?? body['max_completion_tokens']).toBe(gemmaMax);
  });

  it('a cap below the catalog maximum is sent unchanged', async () => {
    const body = await build('openrouter', GEMMA, 777);
    expect(body['max_tokens'] ?? body['max_completion_tokens']).toBe(777);
  });
});

describe('request shape: defaults that do not live in a tier cell', () => {
  it('chatLoop CHAT_MODEL default (feeds enhance, explainParity and runAgentLoop) builds a SPEC 1.2 request', async () => {
    expect(CHAT_DEFAULT_MODEL.anthropic).toBe('claude-sonnet-5-5');
    const body = await build('anthropic', CHAT_DEFAULT_MODEL.anthropic, 4000);
    expect(body['model']).toBe('claude-sonnet-5-5');
    assertNoForbiddenKeys(body);
    // chatLoop.ts must take the default from the tested constant, not carry its own model literal.
    const source = repoFile('convex/chatLoop.ts');
    expect(source).toContain('CHAT_DEFAULT_MODEL');
    expect(source).not.toMatch(/['"](?:anthropic\/)?claude-[a-z]+-[0-9]/);
    // The frozen OpenRouter default stays where the freeze registry anchors it (SPEC A.2.7 row chatLoop.ts:41).
    expect(source).toContain("'moonshotai/kimi-k2.6'");
  });

  it('every UI preset resolves unchanged through resolveRunModel and the Claude ones build a SPEC 1.2 request', async () => {
    for (const preset of MODEL_PRESETS) {
      const resolved = resolveRunModel({ modelOverride: preset }, 'execute', 'run-preset');
      expect({ provider: resolved.provider, modelId: resolved.modelId }, preset.label).toEqual({
        provider: preset.provider,
        modelId: preset.modelId,
      });
      if (preset.provider === 'anthropic' || /claude/i.test(preset.modelId)) {
        expect(`${preset.provider}:${preset.modelId}` in WIRE, preset.label).toBe(true);
      }
    }
    const claudePresets = MODEL_PRESETS.filter((p) => p.provider === 'anthropic');
    expect(claudePresets.map((p) => p.modelId)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
    for (const preset of claudePresets) {
      const body = await build('anthropic', preset.modelId, 100);
      expect(body['model']).toBe(preset.modelId);
      assertNoForbiddenKeys(body);
    }
    const free = MODEL_PRESETS.find((p) => p.modelId.endsWith(':free'));
    expect(free?.modelId).toBe(WIRE_FREE);
  });

  it('migrated script and doc defaults carry the SPEC 1.2 id and no superseded id', () => {
    for (const file of [
      'scripts/verify-demo-video-gemini.mjs',
      'scripts/verify-current-workflows-demo-gemini.mjs',
      'scripts/verify-readme-proof-demo-gemini.mjs',
    ]) {
      const source = repoFile(file);
      expect(source, file).toMatch(/GEMINI_VIDEO_MODEL \?\? 'gemini-3\.8-flash'/);
      expect(source, `${file} must not send temperature (deprecated on Gemini 3.6+)`).not.toMatch(
        /temperature\s*:/,
      );
      expect(source, file).not.toContain('gemini-2.5');
    }
    expect(repoFile('mcp/scripts/dashboard-smoke.mjs')).toContain(
      "decomposeModel: 'claude-haiku-5-5'",
    );
    for (const file of [
      'mcp/scripts/dashboard-smoke.mjs',
      'mcp/src/index.ts',
      'README.md',
      'mcp/README.md',
      'convex/chatLoop.ts',
      'src/lib/modelRouting.ts',
    ]) {
      const source = repoFile(file);
      for (const old of SUPERSEDED) {
        expect(source, `${file} still names ${old}`).not.toContain(old);
      }
    }
  });
});

describe('unknown ids fail closed (SPEC A.0.10)', () => {
  it('an unknown free-looking override resolves to the verified free constant and costs nothing', () => {
    for (const modelId of ['made-up/model:free', 'made-up-model-free']) {
      const resolved = resolveRunModel(
        { modelOverride: { provider: 'openrouter', modelId } },
        'execute',
        'run-free',
      );
      expect({
        provider: resolved.provider,
        modelId: resolved.modelId,
        isFree: resolved.isFree,
      }).toEqual({ provider: 'openrouter', modelId: WIRE_FREE, isFree: true });
    }
    expect(captured).toHaveLength(0);
  });

  it('any other unknown override throws at the resolver, and call() makes no request', async () => {
    for (const [provider, modelId] of [
      ['anthropic', 'claude-sonnet-5.5'], // dotted spelling is invalid on the direct transport
      ['openrouter', 'made-up/paid-model'],
    ] as const) {
      expect(() =>
        resolveRunModel({ modelOverride: { provider, modelId } }, 'execute', 'run-unknown'),
      ).toThrow(/Unknown model/);
    }
    await expect(
      call({
        provider: 'anthropic',
        modelId: 'claude-sonnet-5.5',
        systemPrompt: 's',
        userText: 'u',
      }),
    ).rejects.toThrow();
    expect(captured).toHaveLength(0);
  });

  it('a persisted 4.x override still resolves (it stays in the pi-ai catalog)', () => {
    const resolved = resolveRunModel(
      { modelOverride: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' } },
      'execute',
      'run-persisted',
    );
    expect(resolved.modelId).toBe('claude-sonnet-4-6');
  });
});
