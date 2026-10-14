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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_PRESETS } from '../../src/lib/modelRouting';
import {
  CHAT_DEFAULT_MODEL,
  type ModelTier,
  OUTPUT_CAPS,
  type Phase,
  VERIFIED_FREE_MODEL,
  resolveModel,
  resolveRunModel,
} from './autoRouter';
import { call } from './piAi';

// SPEC 1.2: the only wire ids this PR may write, per transport. Independent literals on purpose: the tier tables
// use named constants, and this table is what those constants are checked against.
const WIRE = {
  'anthropic:claude-haiku-5-5': 'claude-haiku-5-5',
  'anthropic:claude-sonnet-5-5': 'claude-sonnet-5-5',
  'anthropic:claude-opus-5-5': 'claude-opus-5-5',
  'openrouter:anthropic/claude-haiku-5.5': 'anthropic/claude-haiku-5.5', // OpenRouter transport keeps the dotted slug (SPEC 1.2)
  'openrouter:anthropic/claude-sonnet-5.5': 'anthropic/claude-sonnet-5.5',
} as const;
const WIRE_FREE = 'nvidia/nemotron-3-super-120b-a12b:free'; // SPEC 1.2 live :free list

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

// SPEC 1.2: ids the pre-change code used. None may survive in any tier cell or migrated file.
const RETIRED = [
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
    kind: 'primary' | 'fallback';
    provider: string;
    modelId: string;
  }> = [];
  for (const tier of TIERS) {
    for (const phase of PHASES) {
      const cell = resolveModel(tier, phase);
      const cellName = `${tier}/${phase}`;
      out.push({ cell: cellName, kind: 'primary', provider: cell.provider, modelId: cell.modelId });
      if (cell.fallback) {
        out.push({
          cell: cellName,
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

async function build(provider: 'anthropic' | 'openrouter', modelId: string, maxTokens: number) {
  captured = [];
  await call({ provider, modelId, systemPrompt: 'sys', userText: 'hello', maxTokens });
  expect(captured).toHaveLength(1);
  return captured[0]?.body ?? {};
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
  // SPEC 1.3: assistant prefill is a 400. The request must end on a user turn.
  const messages = body['messages'] as Array<{ role: string }>;
  expect(messages.at(-1)?.role).not.toBe('assistant');
}

describe('request shape: tier x phase cells', () => {
  it('every Anthropic-provider or claude-named route, primary and fallback, is a SPEC 1.2 wire id (allowlist)', () => {
    // An allowlist, not a denylist: a malformed replacement ('claude-sonnet-5.5' on the direct transport) or an
    // id from the wrong generation ('claude-opus-4-8') is absent from WIRE and fails here, whatever RETIRED lists.
    for (const route of allRoutes()) {
      if (route.provider === 'anthropic' || /claude/i.test(route.modelId)) {
        expect(
          `${route.provider}:${route.modelId}` in WIRE,
          `${route.cell} ${route.kind} ${route.provider}:${route.modelId} is not a SPEC 1.2 wire id`,
        ).toBe(true);
      }
    }
  });

  it('no retired id survives in any tier cell, primary or fallback', () => {
    const ids = allRoutes().map((r) => r.modelId);
    for (const retired of RETIRED) expect(ids, retired).not.toContain(retired);
  });

  const claudeCells = allRoutes().filter(
    (r) => r.provider === 'anthropic' || /claude/i.test(r.modelId),
  );

  it('covers every Claude cell the refresh touched', () => {
    // opus-5-5 (advise/decompose), sonnet-5-5, haiku-5-5, OpenRouter sonnet/haiku 5.5 fallbacks.
    const ids = new Set(claudeCells.map((c) => `${c.provider}:${c.modelId}`));
    expect(ids).toEqual(new Set(Object.keys(WIRE)));
  });

  for (const cell of claudeCells) {
    it(`${cell.cell} ${cell.kind} ${cell.provider}:${cell.modelId} -> SPEC 1.2 id, no forbidden keys, caller cap honoured`, async () => {
      const body = await build(cell.provider as 'anthropic' | 'openrouter', cell.modelId, 1234);
      expect(body['model']).toBe(WIRE[`${cell.provider}:${cell.modelId}` as keyof typeof WIRE]);
      assertNoForbiddenKeys(body);
      // `maxOutputTokens` is not a pi-ai option; it was silently dropped and the model default (128000) was sent.
      expect(body['max_tokens']).toBe(1234);
      if (cell.provider === 'anthropic') {
        // SPEC 1.3 effort. pi-ai 1.1.0 hard-codes output_config.effort = 'high' for the managed-effort 5.5
        // models and has no per-call knob, so effort is SDK policy, not repo policy: Opus 5.5's default
        // medium never applies and every phase runs at 'high'. This pin turns a silent SDK change into a failure.
        expect(body['output_config']).toEqual({ effort: 'high' });
        expect((body['thinking'] as Record<string, unknown>)['type']).toBe('adaptive');
      }
    });
  }

  it('FREE tier primary is the verified free constant and its request carries no sampling keys', async () => {
    const cell = resolveModel('free', 'execute');
    expect(cell.modelId).toBe(WIRE_FREE);
    expect(VERIFIED_FREE_MODEL).toBe(WIRE_FREE);
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

  it('migrated script and doc defaults carry the SPEC 1.2 id and no retired id', () => {
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
      for (const retired of RETIRED) {
        expect(source, `${file} still names ${retired}`).not.toContain(retired);
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
