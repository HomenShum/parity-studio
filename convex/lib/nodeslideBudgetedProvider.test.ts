import { describe, expect, it, vi } from 'vitest';
import {
  type NodeSlideBudgetLedgerClient,
  type NodeSlideBudgetLedgerView,
  type NodeSlideBudgetedProviderCall,
  callNodeSlideBudgetedJson,
  estimateNodeSlideProviderInputTokens,
  nodeSlideProviderBudgetId,
  nodeSlideProviderCallId,
} from './nodeslideBudgetedProvider';
import type { NodeSlideProviderResult } from './nodeslideProvider';

const providerRequest = {
  systemPrompt: 'Return a bounded NodeSlide patch.',
  userText: '{"instruction":"Rewrite the headline"}',
  maxTokens: 500,
  jsonSchema: {
    name: 'nodeslide_budgeted_test_patch',
    schema: {
      type: 'object',
      required: ['operations'],
      properties: { operations: { type: 'array' } },
    },
  },
} as const;

const settledAttempt = {
  attempt: 'initial' as const,
  attempted: true as const,
  settled: true,
  ambiguous: false,
  unreconciled: false,
  elapsedMs: 7,
};

function successfulProviderResult(
  overrides: Partial<{
    costMicroUsd: number;
    inputTokens: number;
    outputTokens: number;
    provider: 'nebius' | 'openrouter';
    model: string;
  }> = {},
): NodeSlideProviderResult {
  return {
    ok: true,
    value: { operations: [{ op: 'replace_text' }] },
    telemetry: {
      provider: overrides.provider ?? 'nebius',
      model: overrides.model ?? 'zai-org/GLM-5.2',
      reasoningEffort: 'medium',
      costMicroUsd: overrides.costMicroUsd ?? 250,
      inputTokens: overrides.inputTokens ?? 120,
      outputTokens: overrides.outputTokens ?? 30,
      attempts: [settledAttempt],
    },
  };
}

function ledgerFixture(
  options: {
    priorStatus?: NonNullable<NodeSlideBudgetLedgerView['call']>['status'];
    quoteMicroUsd?: number;
    outputCeiling?: number;
    reserveError?: unknown;
    providerTimeoutMs?: number;
  } = {},
) {
  let revision = 1;
  let stateDigest = `sha256:${'1'.repeat(64)}`;
  let budgetId = '';
  let callId = '';

  const budget = (): NodeSlideBudgetLedgerView['budget'] => ({
    id: budgetId,
    status: 'open',
    revision,
    stateDigest,
    actualMicroUsd: 0,
    reservedMicroUsd: 0,
    unreconciledMicroUsd: 0,
  });
  const call = (
    status: NonNullable<NodeSlideBudgetLedgerView['call']>['status'],
  ): NonNullable<NodeSlideBudgetLedgerView['call']> => ({
    callId,
    status,
    quoteMicroUsd: options.quoteMicroUsd ?? 1_000,
    providerSafeOutputTokenCeiling: options.outputCeiling ?? 1_000,
    providerTimeoutMs: options.providerTimeoutMs ?? 12_000,
  });
  const advance = () => {
    revision += 1;
    stateDigest = `sha256:${String(revision).repeat(64).slice(0, 64)}`;
  };

  const create = vi.fn<NodeSlideBudgetLedgerClient['create']>(async (args) => {
    budgetId = args.budgetId;
    return { budget: budget() };
  });
  const replay = vi.fn<NodeSlideBudgetLedgerClient['replay']>(async (args) => {
    callId = args.callId ?? callId;
    return {
      budget: budget(),
      ...(options.priorStatus ? { call: call(options.priorStatus) } : {}),
    };
  });
  const reserve = vi.fn<NodeSlideBudgetLedgerClient['reserve']>(async (args) => {
    if (options.reserveError) throw options.reserveError;
    callId = args.callId;
    advance();
    return { budget: budget(), call: call('reserved') };
  });
  const settle = vi.fn<NodeSlideBudgetLedgerClient['settle']>(async () => {
    advance();
    return { budget: budget(), call: call('settled') };
  });
  const captureTimeout = vi.fn<NodeSlideBudgetLedgerClient['captureTimeout']>(async () => {
    advance();
    return { budget: budget(), call: call('unreconciled') };
  });
  const release = vi.fn<NodeSlideBudgetLedgerClient['release']>(async () => {
    advance();
    return { budget: budget(), call: call('released') };
  });
  const ledger: NodeSlideBudgetLedgerClient = {
    create,
    reserve,
    settle,
    captureTimeout,
    release,
    replay,
  };
  return { ledger, create, reserve, settle, captureTimeout, release, replay };
}

describe('NodeSlide budgeted provider adapter', () => {
  it('derives opaque deterministic IDs from canonical request content', () => {
    const reorderedRequest = {
      ...providerRequest,
      jsonSchema: {
        schema: {
          properties: { operations: { type: 'array' } },
          required: ['operations'],
          type: 'object',
        },
        name: 'nodeslide_budgeted_test_patch',
      },
    };
    const first = nodeSlideProviderCallId({
      runId: 'run-17',
      callKey: 'edit-planner',
      providerRequest,
    });
    const second = nodeSlideProviderCallId({
      runId: 'run-17',
      callKey: 'edit-planner',
      providerRequest: reorderedRequest,
    });

    expect(first).toBe(second);
    expect(first).not.toContain('run-17');
    expect(nodeSlideProviderBudgetId('run-17')).toBe(nodeSlideProviderBudgetId('run-17'));
    expect(estimateNodeSlideProviderInputTokens(providerRequest)).toBeGreaterThan(100_000);
  });

  it('reserves before dispatch, tightens both attempts, and settles the conservative cost', async () => {
    const fixture = ledgerFixture();
    const provider = vi.fn<NodeSlideBudgetedProviderCall>(async (request, dependencies) => {
      expect(request.maxTokens).toBe(500);
      expect(dependencies.dispatchPolicy).toEqual({ maxOutputTokens: 500, timeoutMs: 12_000 });
      return successfulProviderResult();
    });

    const result = await callNodeSlideBudgetedJson(
      { runId: 'run-success', callKey: 'edit-planner', providerRequest },
      {
        ledger: fixture.ledger,
        provider,
        now: vi.fn().mockReturnValueOnce(1_000).mockReturnValue(1_010),
      },
    );

    expect(result).toMatchObject({ ok: true, accounting: { disposition: 'settled' } });
    expect(fixture.reserve).toHaveBeenCalledOnce();
    expect(fixture.reserve.mock.calls[0]?.[0]).toMatchObject({
      model: 'nebius/zai-org/GLM-5.2',
      requestedMaxOutputTokens: 1_000,
    });
    expect(fixture.reserve.mock.calls[0]?.[0].estimatedInputTokens).toBeGreaterThan(100_000);
    // Recomputed pinned cost is 300 micro-USD, higher than the reported 250.
    expect(fixture.settle.mock.calls[0]?.[0]).toMatchObject({
      actualMicroUsd: 300,
      inputTokens: 120,
      outputTokens: 30,
      iterations: 1,
      toolCalls: 0,
    });
    expect(fixture.captureTimeout).not.toHaveBeenCalled();
    expect(fixture.release).not.toHaveBeenCalled();
    expect(fixture.create.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.reserve.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(fixture.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      provider.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(provider.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.settle.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('allows long-form deck creation up to the provider hard deadline', async () => {
    const fixture = ledgerFixture({ providerTimeoutMs: 120_000 });
    const provider = vi.fn<NodeSlideBudgetedProviderCall>(async (_request, dependencies) => {
      expect(dependencies.dispatchPolicy).toEqual({ maxOutputTokens: 500, timeoutMs: 90_000 });
      return successfulProviderResult();
    });

    const result = await callNodeSlideBudgetedJson(
      { runId: 'run-long-form-deck', callKey: 'deck-creation', providerRequest },
      { ledger: fixture.ledger, provider },
    );

    expect(result).toMatchObject({ ok: true, accounting: { disposition: 'settled' } });
    expect(provider).toHaveBeenCalledOnce();
  });

  it('passes the pinned OpenRouter pricing ceiling into provider routing', async () => {
    const fixture = ledgerFixture();
    const provider = vi.fn<NodeSlideBudgetedProviderCall>(async (_request, dependencies) => {
      expect(dependencies.dispatchPolicy).toEqual({
        maxOutputTokens: 500,
        timeoutMs: 12_000,
        maxInputMicroUsdPerMillionTokens: 1_400_000,
        maxOutputMicroUsdPerMillionTokens: 4_400_000,
      });
      return successfulProviderResult({
        provider: 'openrouter',
        model: 'z-ai/glm-5.2',
      });
    });

    const result = await callNodeSlideBudgetedJson(
      {
        runId: 'run-openrouter-price-cap',
        callKey: 'edit-planner',
        providerRequest: { ...providerRequest, model: 'z-ai/glm-5.2' },
      },
      { ledger: fixture.ledger, provider },
    );

    expect(result).toMatchObject({ ok: true, accounting: { disposition: 'settled' } });
    expect(provider).toHaveBeenCalledOnce();
  });

  it('settles completed provider attempts even when their JSON result is invalid', async () => {
    const fixture = ledgerFixture();
    const provider = vi.fn<NodeSlideBudgetedProviderCall>(async () => ({
      ok: false,
      reason: 'The route returned invalid JSON after one repair attempt.',
      telemetry: {
        provider: 'nebius',
        model: 'zai-org/GLM-5.2',
        costMicroUsd: 500,
        inputTokens: 200,
        outputTokens: 50,
        attempts: [settledAttempt, { ...settledAttempt, attempt: 'repair' }],
      },
    }));

    const result = await callNodeSlideBudgetedJson(
      { runId: 'run-invalid-json', callKey: 'edit-planner', providerRequest },
      { ledger: fixture.ledger, provider },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: 'The route returned invalid JSON after one repair attempt.',
      accounting: { disposition: 'settled' },
    });
    expect(fixture.settle).toHaveBeenCalledOnce();
  });

  it('captures the full reservation when telemetry marks a timeout ambiguous', async () => {
    const fixture = ledgerFixture();
    const provider = vi.fn<NodeSlideBudgetedProviderCall>(async () => ({
      ok: false,
      reason: 'timed out',
      telemetry: {
        provider: 'nebius',
        model: 'zai-org/GLM-5.2',
        costMicroUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        attempts: [
          {
            ...settledAttempt,
            settled: false,
            ambiguous: true,
            unreconciled: true,
          },
        ],
      },
    }));

    const result = await callNodeSlideBudgetedJson(
      { runId: 'run-timeout', callKey: 'edit-planner', providerRequest },
      { ledger: fixture.ledger, provider },
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'ambiguous_provider_call',
      accounting: { disposition: 'unreconciled' },
    });
    expect(fixture.captureTimeout).toHaveBeenCalledOnce();
    expect(fixture.settle).not.toHaveBeenCalled();
    expect(fixture.release).not.toHaveBeenCalled();
  });

  it('captures the full reservation when the provider throws after authorization', async () => {
    const fixture = ledgerFixture();
    const provider = vi.fn<NodeSlideBudgetedProviderCall>(async () => {
      throw new Error('raw provider transport details');
    });

    const result = await callNodeSlideBudgetedJson(
      { runId: 'run-throw', callKey: 'edit-planner', providerRequest },
      { ledger: fixture.ledger, provider },
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'ambiguous_provider_call',
      accounting: { disposition: 'unreconciled' },
    });
    expect(JSON.stringify(result)).not.toContain('transport details');
    expect(fixture.captureTimeout).toHaveBeenCalledOnce();
  });

  it('releases only a provider rejection with proof that no attempt started', async () => {
    const fixture = ledgerFixture();
    const provider = vi.fn<NodeSlideBudgetedProviderCall>(async () => ({
      ok: false,
      reason: 'The selected reasoning mode is unsupported.',
    }));

    const result = await callNodeSlideBudgetedJson(
      { runId: 'run-not-dispatched', callKey: 'edit-planner', providerRequest },
      { ledger: fixture.ledger, provider },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: 'The selected reasoning mode is unsupported.',
      accounting: { disposition: 'released' },
    });
    expect(fixture.release).toHaveBeenCalledOnce();
    expect(fixture.captureTimeout).not.toHaveBeenCalled();
  });

  it('fails closed after creating a finalizable zero-usage ledger when pricing is not pinned', async () => {
    const fixture = ledgerFixture();
    const provider = vi.fn<NodeSlideBudgetedProviderCall>();

    const result = await callNodeSlideBudgetedJson(
      {
        runId: 'run-unknown-price',
        callKey: 'edit-planner',
        providerRequest: { ...providerRequest, model: 'anthropic/claude-sonnet-5' },
      },
      { ledger: fixture.ledger, provider },
    );

    expect(result).toMatchObject({ ok: false, code: 'pricing_unknown' });
    expect(fixture.create).toHaveBeenCalledOnce();
    expect(fixture.reserve).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('fails closed on a hard-cap denial without dispatching or releasing an absent reservation', async () => {
    const fixture = ledgerFixture({
      reserveError: Object.assign(new Error('cap'), { code: 'budget_exceeded' }),
    });
    const provider = vi.fn<NodeSlideBudgetedProviderCall>();

    const result = await callNodeSlideBudgetedJson(
      { runId: 'run-cap', callKey: 'edit-planner', providerRequest },
      { ledger: fixture.ledger, provider },
    );

    expect(result).toMatchObject({ ok: false, code: 'budget_denied' });
    expect(provider).not.toHaveBeenCalled();
    expect(fixture.release).not.toHaveBeenCalled();
  });

  it('never redispatches settled or unreconciled calls and captures a stranded reservation', async () => {
    const settledFixture = ledgerFixture({ priorStatus: 'settled' });
    const settledProvider = vi.fn<NodeSlideBudgetedProviderCall>();
    const settledResult = await callNodeSlideBudgetedJson(
      { runId: 'run-replay-settled', callKey: 'edit-planner', providerRequest },
      { ledger: settledFixture.ledger, provider: settledProvider },
    );

    expect(settledResult).toMatchObject({
      ok: false,
      code: 'idempotent_replay',
      accounting: { disposition: 'replayed', ledger: { call: { status: 'settled' } } },
    });
    expect(settledProvider).not.toHaveBeenCalled();
    expect(settledFixture.reserve).not.toHaveBeenCalled();

    const unreconciledFixture = ledgerFixture({ priorStatus: 'unreconciled' });
    const unreconciledProvider = vi.fn<NodeSlideBudgetedProviderCall>();
    const unreconciledResult = await callNodeSlideBudgetedJson(
      { runId: 'run-replay-unreconciled', callKey: 'edit-planner', providerRequest },
      { ledger: unreconciledFixture.ledger, provider: unreconciledProvider },
    );

    expect(unreconciledResult).toMatchObject({
      ok: false,
      code: 'idempotent_replay',
      accounting: {
        disposition: 'replayed',
        ledger: { call: { status: 'unreconciled' } },
      },
    });
    expect(unreconciledProvider).not.toHaveBeenCalled();
    expect(unreconciledFixture.reserve).not.toHaveBeenCalled();

    const reservedFixture = ledgerFixture({ priorStatus: 'reserved' });
    const reservedProvider = vi.fn<NodeSlideBudgetedProviderCall>();
    const reservedResult = await callNodeSlideBudgetedJson(
      { runId: 'run-replay-reserved', callKey: 'edit-planner', providerRequest },
      { ledger: reservedFixture.ledger, provider: reservedProvider },
    );

    expect(reservedResult).toMatchObject({
      ok: false,
      code: 'ambiguous_provider_call',
      accounting: { disposition: 'unreconciled' },
    });
    expect(reservedProvider).not.toHaveBeenCalled();
    expect(reservedFixture.captureTimeout).toHaveBeenCalledOnce();
  });

  it('captures instead of under-accounting a receipt that exceeds its quote', async () => {
    const fixture = ledgerFixture({ quoteMicroUsd: 100 });
    const provider = vi.fn<NodeSlideBudgetedProviderCall>(async () =>
      successfulProviderResult({ costMicroUsd: 101 }),
    );

    const result = await callNodeSlideBudgetedJson(
      { runId: 'run-over-quote', callKey: 'edit-planner', providerRequest },
      { ledger: fixture.ledger, provider },
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'ambiguous_provider_call',
      accounting: { disposition: 'unreconciled' },
    });
    expect(fixture.settle).not.toHaveBeenCalled();
    expect(fixture.captureTimeout).toHaveBeenCalledOnce();
  });
});
