import { describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_EDIT_MODEL,
  NODESLIDE_EDIT_PROVIDER,
  NODESLIDE_NEBIUS_GLM_MODEL,
  type NodeSlideCompletion,
  type NodeSlideCompletionResult,
  callNodeSlideFreeJson,
  nodeSlideStructuredOutputPayload,
} from './nodeslideProvider';

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

function completion(
  text: string,
  options: Partial<Omit<NodeSlideCompletionResult, 'text'>> = {},
): NodeSlideCompletionResult {
  return {
    text,
    stopReason: options.stopReason ?? 'stop',
    ...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
    costMicroUsd: options.costMicroUsd ?? 1_250,
    inputTokens: options.inputTokens ?? 120,
    outputTokens: options.outputTokens ?? 30,
  };
}

describe('NodeSlide named pi-ai JSON provider', () => {
  it('routes through the named default model', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('{"summary":"Sharper thesis","operations":[{"op":"replace_text"}]}'),
    );

    const result = await callNodeSlideFreeJson(
      { ...request, maxTokens: 5_000 },
      {
        complete,
        dispatchPolicy: { maxOutputTokens: 5_000, timeoutMs: 60_000 },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_NEBIUS_GLM_MODEL,
        reasoningEffort: 'medium',
        costMicroUsd: 1_250,
        inputTokens: 120,
        outputTokens: 30,
      },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      provider: NODESLIDE_EDIT_PROVIDER,
      model: NODESLIDE_NEBIUS_GLM_MODEL,
      reasoningEffort: 'medium',
      maxTokens: 2_200,
      jsonSchema: request.jsonSchema,
      structuredOutputMode: 'json_schema',
      repairAttempt: false,
    });
    expect(complete.mock.calls[0]?.[0].systemPrompt).toContain('JSON Schema');
    expect(complete.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(result.ok && result.telemetry.attempts).toEqual([
      expect.objectContaining({
        attempt: 'initial',
        attempted: true,
        settled: true,
        ambiguous: false,
        unreconciled: false,
      }),
    ]);
  });

  it('routes an allowlisted model selection and attributes telemetry to that exact model', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('{"summary":"Sharper thesis","operations":[{"op":"replace_text"}]}'),
    );

    const result = await callNodeSlideFreeJson(
      { ...request, model: 'anthropic/claude-sonnet-5', reasoningEffort: 'xhigh' },
      { complete },
    );

    expect(result).toMatchObject({
      ok: true,
      telemetry: {
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-5',
        reasoningEffort: 'xhigh',
      },
    });
    expect(complete.mock.calls[0]?.[0].model).toBe('anthropic/claude-sonnet-5');
    expect(complete.mock.calls[0]?.[0].reasoningEffort).toBe('xhigh');
  });

  it('injects the schema while preserving pi-ai provider routing', () => {
    expect(
      nodeSlideStructuredOutputPayload(
        { model: NODESLIDE_EDIT_MODEL, provider: { data_collection: 'deny' } },
        request.jsonSchema,
      ),
    ).toEqual({
      model: NODESLIDE_EDIT_MODEL,
      provider: { data_collection: 'deny' },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.jsonSchema.name,
          strict: false,
          schema: request.jsonSchema.schema,
        },
      },
    });

    expect(
      nodeSlideStructuredOutputPayload(
        { model: NODESLIDE_EDIT_MODEL, provider: { data_collection: 'deny' } },
        undefined,
        'json_object',
      ),
    ).toEqual({
      model: NODESLIDE_EDIT_MODEL,
      provider: { data_collection: 'deny' },
      response_format: { type: 'json_object' },
    });
  });

  it('binds the OpenRouter endpoint price ceiling without losing routing or JSON mode', () => {
    const maxPrice = { prompt: 1.4, completion: 4.4 };
    expect(
      nodeSlideStructuredOutputPayload(
        { model: NODESLIDE_EDIT_MODEL, provider: { data_collection: 'deny' } },
        request.jsonSchema,
        'json_schema',
        maxPrice,
      ),
    ).toMatchObject({
      provider: { data_collection: 'deny', max_price: maxPrice },
      response_format: { type: 'json_schema' },
    });
    expect(
      nodeSlideStructuredOutputPayload(
        { model: NODESLIDE_EDIT_MODEL, provider: { data_collection: 'deny' } },
        undefined,
        'prompt',
        maxPrice,
      ),
    ).toMatchObject({
      provider: { data_collection: 'deny', max_price: maxPrice },
    });
  });

  it('makes exactly one repair completion after malformed JSON', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('not-json'))
      .mockResolvedValueOnce(
        completion('{"operations":[{"op":"replace_text"}]}', {
          costMicroUsd: 2_000,
          inputTokens: 150,
          outputTokens: 40,
        }),
      );

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: true,
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_NEBIUS_GLM_MODEL,
        costMicroUsd: 3_250,
        inputTokens: 270,
        outputTokens: 70,
      },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toMatchObject({
      repairAttempt: true,
      structuredOutputMode: 'json_schema',
    });
    expect(complete.mock.calls[1]?.[0].userText).toContain('Prior invalid model response');
    expect(result.ok && result.telemetry.attempts).toEqual([
      expect.objectContaining({ attempt: 'initial', settled: true, ambiguous: false }),
      expect.objectContaining({ attempt: 'repair', settled: true, ambiguous: false }),
    ]);
  });

  it('uses the same single repair attempt for a schema-invalid JSON envelope', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('{"summary":"Missing operations"}'))
      .mockResolvedValueOnce(completion('{"operations":[{"op":"replace_text"}]}'));

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result.ok).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toMatchObject({ repairAttempt: true });
    expect(complete.mock.calls[1]?.[0].userText).toContain('Missing operations');
  });

  it('repairs a missing factual source binding exactly once against the planner schema', async () => {
    const sourceBindingRequest = {
      ...request,
      jsonSchema: {
        name: 'nodeslide_source_bound_patch',
        schema: {
          type: 'object',
          required: ['operations'],
          properties: {
            operations: {
              type: 'array',
              items: {
                type: 'object',
                required: ['op', 'sourceIds'],
                properties: {
                  op: { const: 'replace_text' },
                  sourceIds: { type: 'array', minItems: 1, items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    };
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('{"operations":[{"op":"replace_text"}]}'))
      .mockResolvedValueOnce(
        completion('{"operations":[{"op":"replace_text","sourceIds":["source-fifa"]}]}'),
      );

    const result = await callNodeSlideFreeJson(sourceBindingRequest, { complete });

    expect(result.ok).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toMatchObject({ repairAttempt: true });
    expect(complete.mock.calls[1]?.[0].userText).toContain('"op":"replace_text"');
  });

  it('falls back honestly after the single repair also returns invalid JSON', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('not-json'))
      .mockResolvedValueOnce(completion('still-not-json'));

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: false,
      reason: 'The GLM 5.2 via Nebius route returned invalid JSON after one repair attempt.',
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_NEBIUS_GLM_MODEL,
      },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('still-not-json');
  });

  it('uses the single repair attempt without native schema mode when a route rejects it', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(
        completion('', {
          stopReason: 'error',
          errorMessage: 'response_format JSON schema is not supported by this endpoint',
        }),
      )
      .mockResolvedValueOnce(completion('{"operations":[{"op":"replace_text"}]}'));

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result.ok).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ jsonSchema: request.jsonSchema });
    expect(complete.mock.calls[1]?.[0]).not.toHaveProperty('jsonSchema');
    expect(complete.mock.calls[1]?.[0]).toMatchObject({
      repairAttempt: true,
      structuredOutputMode: 'json_object',
    });
    expect(complete.mock.calls[1]?.[0].systemPrompt).toContain('JSON Schema');
    expect(complete.mock.calls[1]?.[0].userText).toContain('provider rejected JSON Schema mode');
  });

  it('uses provider-compatible JSON object transport for the large Gemini edit contract', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('{"operations":[{"op":"replace_text"}]}'),
    );

    const result = await callNodeSlideFreeJson(
      {
        ...request,
        model: 'google/gemini-3.5-flash',
        reasoningEffort: 'medium',
        jsonSchema: { ...request.jsonSchema, name: 'nodeslide_edit_patch' },
      },
      { complete },
    );

    expect(result.ok).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty('jsonSchema');
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      model: 'google/gemini-3.5-flash',
      structuredOutputMode: 'json_object',
    });
    expect(complete.mock.calls[0]?.[0].systemPrompt).toContain('JSON Schema');
  });

  it('spends the sole schema compatibility retry on a generic zero-usage preflight error', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(
        completion('', {
          stopReason: 'error',
          errorMessage: 'Provider returned an error stop reason',
          costMicroUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
        }),
      )
      .mockResolvedValueOnce(completion('{"operations":[{"op":"replace_text"}]}'));

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result.ok).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toMatchObject({
      structuredOutputMode: 'prompt',
      repairAttempt: true,
    });
  });

  it('falls back honestly when the schema compatibility retry also errors', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('', {
        stopReason: 'error',
        errorMessage: 'response_format JSON schema is not supported by this endpoint',
      }),
    );

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: false,
      reason: 'The GLM 5.2 via Nebius route rejected the structured-output schema.',
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('bounds model output before attempting the one repair', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('x'.repeat(200_001)))
      .mockResolvedValueOnce(completion('still-not-json'));

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result.ok).toBe(false);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0].userText).toContain('response omitted');
    expect(complete.mock.calls[1]?.[0].userText).not.toContain('x'.repeat(1_000));
  });

  it('enforces the hard deadline even when the completion ignores AbortSignal', async () => {
    const complete = vi.fn<NodeSlideCompletion>(() => new Promise(() => {}));

    const result = await callNodeSlideFreeJson(request, { complete, timeoutMs: 10 });

    expect(result).toMatchObject({
      ok: false,
      reason: 'The GLM 5.2 via Nebius route timed out.',
      telemetry: {
        costMicroUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        attempts: [
          expect.objectContaining({
            attempt: 'initial',
            attempted: true,
            settled: false,
            ambiguous: true,
            unreconciled: true,
          }),
        ],
      },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });

  it('contains a thrown provider failure, records ambiguity, and never exposes its raw message', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () => {
      throw new Error('raw upstream credential and transport details');
    });

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: false,
      reason: 'The GLM 5.2 via Nebius route was unavailable.',
      telemetry: {
        costMicroUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        attempts: [
          expect.objectContaining({
            attempt: 'initial',
            attempted: true,
            settled: false,
            ambiguous: true,
            unreconciled: true,
          }),
        ],
      },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(JSON.stringify(result)).not.toContain('credential');
  });

  it('shares one deadline across the initial response and its only repair', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('not-json'))
      .mockImplementationOnce(() => new Promise(() => {}));

    const result = await callNodeSlideFreeJson(request, { complete, timeoutMs: 10 });

    expect(result).toMatchObject({
      ok: false,
      reason: 'The GLM 5.2 via Nebius route timed out.',
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_NEBIUS_GLM_MODEL,
      },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0].repairAttempt).toBe(true);
    expect(complete.mock.calls[1]?.[0].signal.aborted).toBe(true);
  });

  it('rejects reasoning efforts that the selected provider does not advertise', async () => {
    const complete = vi.fn<NodeSlideCompletion>();

    const result = await callNodeSlideFreeJson(
      { ...request, model: NODESLIDE_EDIT_MODEL, reasoningEffort: 'xhigh' },
      { complete },
    );

    expect(result).toEqual({
      ok: false,
      reason: 'The GLM 5.2 route does not support the selected reasoning effort.',
    });
    expect(complete).not.toHaveBeenCalled();
  });
});
