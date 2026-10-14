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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ModelTier, type Phase, resolveModel } from './autoRouter';
import { call } from './piAi';

// SPEC 1.2: the only wire ids this PR may write, per transport.
const WIRE = {
  'anthropic:claude-haiku-5-5': 'claude-haiku-5-5',
  'anthropic:claude-sonnet-5-5': 'claude-sonnet-5-5',
  'anthropic:claude-opus-5-5': 'claude-opus-5-5',
  'openrouter:anthropic/claude-haiku-5.5': 'anthropic/claude-haiku-5.5', // OpenRouter transport keeps the dotted slug (SPEC 1.2)
  'openrouter:anthropic/claude-sonnet-5.5': 'anthropic/claude-sonnet-5.5',
} as const;

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

// SPEC 1.2: ids the pre-change code used. None may survive in any tier cell (primary or fallback).
const RETIRED = [
  'claude-haiku-4-5',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-4.6',
  'inclusionai/ling-2.6-1t:free',
];

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

describe('request shape: every tier x phase cell resolves to a SPEC 1.2 id and builds a valid request', () => {
  it('no retired id survives in any tier cell, primary or fallback', () => {
    const ids: string[] = [];
    for (const tier of TIERS) {
      for (const phase of PHASES) {
        const cell = resolveModel(tier, phase);
        ids.push(cell.modelId);
        if (cell.fallback) ids.push(cell.fallback.modelId);
      }
    }
    for (const retired of RETIRED) expect(ids, retired).not.toContain(retired);
  });

  const claudeCells: Array<{
    label: string;
    provider: 'anthropic' | 'openrouter';
    modelId: string;
  }> = [];
  for (const tier of TIERS) {
    for (const phase of PHASES) {
      const cell = resolveModel(tier, phase);
      const routes = [cell, ...(cell.fallback ? [cell.fallback] : [])];
      for (const route of routes) {
        if (`${route.provider}:${route.modelId}` in WIRE) {
          claudeCells.push({
            label: `${tier}/${phase}`,
            provider: route.provider as 'anthropic' | 'openrouter',
            modelId: route.modelId,
          });
        }
      }
    }
  }

  it('covers every Claude cell the refresh touched', () => {
    // opus-5-5 (advise/decompose), sonnet-5-5, haiku-5-5, OpenRouter sonnet/haiku 5.5 fallbacks.
    const ids = new Set(claudeCells.map((c) => `${c.provider}:${c.modelId}`));
    expect(ids).toEqual(new Set(Object.keys(WIRE)));
  });

  for (const cell of claudeCells) {
    it(`${cell.label} ${cell.provider}:${cell.modelId} -> SPEC 1.2 id, no forbidden keys, caller cap honoured`, async () => {
      const body = await build(cell.provider, cell.modelId, 1234);
      expect(body['model']).toBe(WIRE[`${cell.provider}:${cell.modelId}` as keyof typeof WIRE]);
      assertNoForbiddenKeys(body);
      // `maxOutputTokens` is not a pi-ai option; it was silently dropped and the model default (128000) was sent.
      expect(body['max_tokens']).toBe(1234);
    });
  }

  it('FREE tier primary is the verified free constant and its request carries no sampling keys', async () => {
    const cell = resolveModel('free', 'execute');
    expect(cell.modelId).toBe('nvidia/nemotron-3-super-120b-a12b:free');
    const body = await build('openrouter', cell.modelId, 777);
    expect(body['model']).toBe('nvidia/nemotron-3-super-120b-a12b:free');
    for (const key of ['temperature', 'top_p', 'top_k', 'tool_choice']) {
      expect(body, key).not.toHaveProperty(key);
    }
    expect(body['max_tokens'] ?? body['max_completion_tokens']).toBe(777);
  });
});
