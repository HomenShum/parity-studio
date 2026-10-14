// @vitest-environment node
/**
 * Request-shape proof for mcp/src/lib/llmClient.ts (model-defaults SPEC A.0 rule 6, A.2.7).
 * Real request through this repo's own `call()` against a fake transport (stubbed fetch, always 400, no spend).
 * Asserts the SPEC 1.2 explicit id table replaces prefix/dot surgery and the caller's maxTokens reaches the wire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_5_5_WIRE_IDS, call } from './llmClient';

let bodies: Array<Record<string, unknown>> = [];

beforeEach(() => {
  bodies = [];
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
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
  const cases: Array<[string, string]> = [
    ['claude-haiku-5-5', 'claude-haiku-5-5'],
    ['claude-sonnet-5-5', 'claude-sonnet-5-5'],
    ['claude-opus-5-5', 'claude-opus-5-5'],
    // OpenRouter slug spelling: used to become the invalid dotted `claude-sonnet-5.5` after prefix stripping.
    ['anthropic/claude-haiku-5.5', 'claude-haiku-5-5'],
    ['anthropic/claude-sonnet-5.5', 'claude-sonnet-5-5'],
    ['anthropic/claude-opus-5.5', 'claude-opus-5-5'],
    // Persisted rows keep working: 4.x hyphenated ids still resolve through the legacy prefix strip.
    ['anthropic/claude-sonnet-4-6', 'claude-sonnet-4-6'],
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
      const body = bodies[0] ?? {};
      expect(body['model']).toBe(wire);
      for (const key of ['temperature', 'top_p', 'top_k', 'tool_choice'])
        expect(body, key).not.toHaveProperty(key);
      const thinking = body['thinking'] as Record<string, unknown> | undefined;
      if (thinking !== undefined) {
        expect(thinking['type']).not.toBe('disabled');
        expect(thinking).not.toHaveProperty('budget_tokens');
      }
      expect(body['max_tokens']).toBe(321);
    });
  }

  it('the explicit table only maps onto SPEC 1.2 anthropic wire ids', () => {
    expect(new Set(Object.values(CLAUDE_5_5_WIRE_IDS))).toEqual(
      new Set(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']),
    );
  });
});
