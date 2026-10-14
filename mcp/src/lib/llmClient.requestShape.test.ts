// @vitest-environment node
/**
 * Request-shape proof for mcp/src/lib/llmClient.ts (model-defaults SPEC A.0 rule 6, A.2.7).
 * Real request through this repo's own `call()` against a fake transport (stubbed fetch, always 400, no spend).
 * Asserts the explicit spelling table (SPEC A.0.5) replaces prefix/dot surgery, the caller's maxTokens reaches
 * the wire, and unknown ids fail closed (SPEC A.0.10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERIFIED_FREE_MODEL, WIRE_IDS, call } from './llmClient';

let bodies: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  bodies = [];
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
  vi.stubEnv('GOOGLE_API_KEY', 'test-key-not-real');
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      bodies.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
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

describe('llmClient request shape (Claude 5.5)', () => {
  // [spelling a caller passes, wire id that must reach the request]
  const cases: Array<[string, string]> = [
    ['claude-haiku-5-5', 'claude-haiku-5-5'],
    ['claude-sonnet-5-5', 'claude-sonnet-5-5'],
    ['claude-opus-5-5', 'claude-opus-5-5'],
    // OpenRouter slug spelling: used to become the invalid dotted `claude-sonnet-5.5` after prefix stripping.
    ['anthropic/claude-haiku-5.5', 'claude-haiku-5-5'],
    ['anthropic/claude-sonnet-5.5', 'claude-sonnet-5-5'],
    ['anthropic/claude-opus-5.5', 'claude-opus-5-5'],
    ['anthropic/claude-sonnet-5-5', 'claude-sonnet-5-5'],
    // Persisted 4.x spellings are listed in the table explicitly (no generic prefix strip any more).
    ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
    ['anthropic/claude-sonnet-4-6', 'claude-sonnet-4-6'],
    ['anthropic/claude-opus-4-7', 'claude-opus-4-7'],
    ['anthropic/claude-haiku-4-5', 'claude-haiku-4-5'],
  ];

  for (const [input, wire] of cases) {
    it(`${input} -> wire model ${wire}, no forbidden keys, caller cap honoured`, async () => {
      await call({
        provider: 'anthropic',
        modelId: input,
        systemPrompt: 's',
        userText: 'u',
        maxTokens: 321,
      });
      expect(bodies).toHaveLength(1);
      const body = bodies[0]?.body ?? {};
      expect(body['model']).toBe(wire);
      for (const key of ['temperature', 'top_p', 'top_k', 'tool_choice']) {
        expect(body, key).not.toHaveProperty(key);
      }
      const thinking = body['thinking'] as Record<string, unknown> | undefined;
      if (thinking !== undefined) {
        expect(thinking['type']).not.toBe('disabled');
        expect(thinking).not.toHaveProperty('budget_tokens');
      }
      expect(body['max_tokens']).toBe(321);
      if (wire.endsWith('-5-5')) {
        // pi-ai 1.1.0 hard-codes effort 'high' for the managed-effort 5.5 models (SDK policy, no per-call knob).
        expect(body['output_config']).toEqual({ effort: 'high' });
      }
    });
  }

  it('the explicit table maps only onto catalog-resolvable wire ids and lists the 5.5 triple', () => {
    const anthropic = new Set(Object.values(WIRE_IDS['anthropic'] ?? {}));
    for (const id of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      expect(anthropic.has(id), id).toBe(true);
    }
    for (const wire of anthropic) expect(wire).toMatch(/^claude-[a-z]+-[0-9]+(-[0-9]+)?$/);
  });

  it('the frozen PARITY_JUDGE_MODEL default (google/ prefix) reaches the google transport as the bare id', async () => {
    await call({
      provider: 'google',
      modelId: 'google/gemini-3.1-pro-preview',
      systemPrompt: 's',
      userText: 'u',
    }).catch(() => undefined);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.url).toContain('gemini-3.1-pro-preview');
    expect(bodies[0]?.url).not.toContain('google/gemini');
  });
});

describe('llmClient fails closed on unknown ids (SPEC A.0.10)', () => {
  it('an unlisted spelling is not converted: it throws before any request', async () => {
    // Previously a generic prefix strip turned this into a different model; now only table entries convert.
    for (const [provider, modelId] of [
      ['anthropic', 'anthropic/claude-sonnet-9-9'],
      ['anthropic', 'claude-sonnet-5.5'],
      ['openai', 'openai/gpt-made-up'],
    ] as const) {
      await expect(
        call({ provider, modelId, systemPrompt: 's', userText: 'u' }),
        `${provider}:${modelId}`,
      ).rejects.toThrow(/Unknown model/);
    }
    expect(bodies).toHaveLength(0);
  });

  it('an unknown free-looking id resolves to the verified free constant on OpenRouter', async () => {
    await call({
      provider: 'openrouter',
      modelId: 'made-up/model:free',
      systemPrompt: 's',
      userText: 'u',
      maxTokens: 50,
    }).catch(() => undefined);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.body['model']).toBe(VERIFIED_FREE_MODEL);
    expect(VERIFIED_FREE_MODEL).toBe('nvidia/nemotron-3-super-120b-a12b:free');
  });
});
