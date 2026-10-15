// @vitest-environment node
/**
 * Request-shape proof for mcp/src/lib/llmClient.ts (model-defaults SPEC A.0 rule 6, A.2.7).
 * Real request through this repo's own `call()` against a fake transport (stubbed fetch, always 400, no spend).
 * Asserts the explicit spelling table (SPEC A.0.5) covers the dotted OpenRouter slugs, the exact `<provider>/`
 * prefix strip keeps every spelling `inferProvider` routes working (SPEC A.0.4), the caller's maxTokens and the
 * per-phase effort reach the wire, and unknown ids fail closed (SPEC A.0.10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireLocalKeys } from './byok';
import { DEFAULT_EFFORT, VERIFIED_FREE_MODEL, WIRE_IDS, call, callByModel } from './llmClient';

// The first request per provider lazy-loads that provider's SDK (3 s+ on a cold machine).
vi.setConfig({ testTimeout: 30_000 });

let bodies: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  bodies = [];
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  vi.stubEnv('OPENAI_API_KEY', 'test-key-not-real');
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
    // Persisted 4.x spellings, with and without the provider prefix.
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
        // The top-level output_config governs the turn (the trailing message applies from the next user turn).
        expect(body['output_config']).toEqual({ effort: DEFAULT_EFFORT });
        const messages = body['messages'] as Array<{ role: string; output_config?: unknown }>;
        expect(messages.at(-1)).toMatchObject({
          role: 'system',
          output_config: { effort: DEFAULT_EFFORT },
        });
      }
    });
  }

  it('an explicit effort governs the turn: top-level output_config and the trailing message agree', async () => {
    await call({
      provider: 'anthropic',
      modelId: 'claude-opus-5-5',
      systemPrompt: 's',
      userText: 'u',
      effort: 'medium',
    });
    const messages = bodies[0]?.body['messages'] as Array<{
      role: string;
      output_config?: unknown;
    }>;
    expect(bodies[0]?.body['output_config']).toEqual({ effort: 'medium' });
    expect(messages.at(-1)).toMatchObject({ role: 'system', output_config: { effort: 'medium' } });
  });

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

describe('callByModel keeps every provider-prefixed spelling inferProvider routes (SPEC A.0.4)', () => {
  // [spelling a caller passes, text that must appear in the request URL or body model]
  const spellings: Array<[string, string]> = [
    ['openai/gpt-4o', 'gpt-4o'],
    ['openai/gpt-5', 'gpt-5'],
    ['google/gemini-3.8-flash', 'gemini-3.8-flash'],
    ['google/gemini-3.6-flash', 'gemini-3.6-flash'],
    ['anthropic/claude-fable-5-1', 'claude-fable-5-1'],
  ];
  for (const [spelling, wire] of spellings) {
    it(`${spelling} sends a request for ${wire}`, async () => {
      await callByModel({ model: spelling, systemPrompt: 's', userText: 'u', maxTokens: 64 }).catch(
        () => undefined,
      );
      expect(bodies).toHaveLength(1);
      const sent = bodies[0];
      expect(`${sent?.url} ${String(sent?.body['model'] ?? '')}`).toContain(wire);
      expect(sent?.url).not.toContain(`${spelling.split('/')[0]}/${wire}`);
      expect(sent?.body['model']).not.toBe(spelling);
    });
  }
});

describe('llmClient fails closed on unknown ids (SPEC A.0.10)', () => {
  it('an id that still misses the catalog after the prefix strip throws before any request', async () => {
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

  it('the key precheck follows the route the call will use: an unknown -free id needs the OpenRouter key, not OpenAI', async () => {
    // inferProvider('obsolete-model-free') is 'openai'; resolveWire redirects it to OpenRouter (SPEC A.0.10).
    vi.stubEnv('OPENAI_API_KEY', '');
    const status = requireLocalKeys(['obsolete-model-free']);
    expect(status.models[0]).toMatchObject({
      provider: 'openrouter',
      envVar: 'OPENROUTER_API_KEY',
    });
    await callByModel({ model: 'obsolete-model-free', systemPrompt: 's', userText: 'u' }).catch(
      () => undefined,
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.body['model']).toBe(VERIFIED_FREE_MODEL);
    // An id resolveWire refuses keeps the inferred provider's key; call() then throws before any request.
    expect(() => requireLocalKeys(['gpt-made-up'])).toThrow(/OPENAI_API_KEY/);
  });
});
