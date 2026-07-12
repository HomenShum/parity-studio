import { describe, expect, it, vi } from 'vitest';
import { callNodeSlideFreeJson } from './nodeslideProvider';

const request = {
  systemPrompt: 'Return a bounded NodeSlide patch.',
  userText: '{"instruction":"Rewrite the headline"}',
  maxTokens: 500,
  jsonSchema: {
    name: 'nodeslide_test_patch',
    schema: {
      type: 'object',
      required: ['operations'],
      properties: { operations: { type: 'array' } },
    },
  },
};

function providerResponse(
  content: string,
  options: { model?: string; finishReason?: string } = {},
) {
  return new Response(
    JSON.stringify({
      model: options.model ?? 'resolved/free-model',
      choices: [
        {
          finish_reason: options.finishReason ?? 'stop',
          message: { content },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        cost: 0,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('NodeSlide free JSON provider', () => {
  it('pins a free model and requests strict structured output', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        providerResponse('{"summary":"Sharper thesis","operations":[{"op":"replace_text"}]}'),
    );

    const result = await callNodeSlideFreeJson(request, {
      apiKey: 'test-key',
      fetchImpl: fetchImpl as typeof fetch,
      modelCandidates: ['primary/free-model'],
    });

    expect(result).toMatchObject({
      ok: true,
      telemetry: {
        provider: 'openrouter',
        model: 'resolved/free-model',
        costMicroUsd: 0,
        inputTokens: 120,
        outputTokens: 30,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'primary/free-model',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'nodeslide_test_patch', strict: true },
      },
      provider: { require_parameters: true },
      reasoning: { effort: 'low', exclude: true },
    });
    expect(body.plugins).toEqual([{ id: 'response-healing' }]);
  });

  it('fails over to the backup model when the primary is capacity limited', async () => {
    const fetchImpl = vi
      .fn(
        async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
          providerResponse('{"operations":[{"op":"replace_text"}]}'),
      )
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(providerResponse('{"operations":[{"op":"replace_text"}]}'));

    const result = await callNodeSlideFreeJson(request, {
      apiKey: 'test-key',
      fetchImpl: fetchImpl as typeof fetch,
      modelCandidates: ['primary/free-model', 'backup/free-model'],
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body));
    expect(secondBody.model).toBe('backup/free-model');
  });

  it('rejects incomplete and malformed responses without exposing upstream payloads', async () => {
    const fetchImpl = vi
      .fn(
        async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
          providerResponse('not-json'),
      )
      .mockResolvedValueOnce(providerResponse('{"operations":', { finishReason: 'length' }))
      .mockResolvedValueOnce(providerResponse('not-json'));

    const result = await callNodeSlideFreeJson(request, {
      apiKey: 'test-key',
      fetchImpl: fetchImpl as typeof fetch,
      modelCandidates: ['primary/free-model', 'backup/free-model'],
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'The free route returned malformed JSON.',
    });
    expect(JSON.stringify(result)).not.toContain('not-json');
  });

  it('does not call the provider without a server-side API key', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        providerResponse('{}'),
    );
    const result = await callNodeSlideFreeJson(request, {
      apiKey: '',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toEqual({ ok: false, reason: 'The free route was unavailable.' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
