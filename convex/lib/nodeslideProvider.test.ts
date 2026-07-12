import { describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_EDIT_MODEL,
  NODESLIDE_EDIT_PROVIDER,
  type NodeSlideCompletion,
  type NodeSlideCompletionResult,
  callNodeSlideFreeJson,
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
    costMicroUsd: options.costMicroUsd ?? 1_250,
    inputTokens: options.inputTokens ?? 120,
    outputTokens: options.outputTokens ?? 30,
  };
}

describe('NodeSlide named pi-ai JSON provider', () => {
  it('routes the completion through the single named GLM 5.2 constant', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('{"summary":"Sharper thesis","operations":[{"op":"replace_text"}]}'),
    );

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: true,
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_EDIT_MODEL,
        costMicroUsd: 1_250,
        inputTokens: 120,
        outputTokens: 30,
      },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      provider: NODESLIDE_EDIT_PROVIDER,
      model: NODESLIDE_EDIT_MODEL,
      maxTokens: 500,
      repairAttempt: false,
    });
    expect(complete.mock.calls[0]?.[0].systemPrompt).toContain('JSON Schema');
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
        model: NODESLIDE_EDIT_MODEL,
        costMicroUsd: 3_250,
        inputTokens: 270,
        outputTokens: 70,
      },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toMatchObject({ repairAttempt: true });
    expect(complete.mock.calls[1]?.[0].userText).toContain('Prior invalid model response');
  });

  it('falls back honestly after the single repair also returns invalid JSON', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('not-json'))
      .mockResolvedValueOnce(completion('still-not-json'));

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: false,
      reason: 'The GLM 5.2 route returned invalid JSON after one repair attempt.',
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_EDIT_MODEL,
      },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('still-not-json');
  });

  it('does not turn a provider error into a fabricated repair success', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('', { stopReason: 'error' }),
    );

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: false,
      reason: 'The GLM 5.2 route returned an error.',
    });
    expect(complete).toHaveBeenCalledTimes(1);
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
});
