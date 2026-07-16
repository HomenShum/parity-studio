import { describe, expect, it } from 'vitest';
import { NODESLIDE_AGENT_MODELS } from '../shared/nodeslide';
import {
  NODESLIDE_MODEL_PRICING,
  NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
  NODESLIDE_RUN_BUDGET_BOUNDS,
  NODESLIDE_RUN_BUDGET_RECEIPT_VERSION,
  type NodeSlideRunBudgetInput,
  type NodeSlideRunBudgetReceipt,
  type NodeSlideRunBudgetState,
  accountNodeSlideRunBudgetReceipt,
  createNodeSlideRunBudgetState,
  nodeSlideModelPricing,
  nodeSlideRunBudgetReceiptDigest,
  normalizeNodeSlideRunBudget,
  parseNodeSlideSpendConstraint,
  parseUsdDecimalToMicroUsd,
  preflightNodeSlideRunBudget,
  scoreNodeSlideWorstCaseCost,
} from './lib/nodeslideRunBudget';

const PRICED_MODEL = 'nebius/zai-org/GLM-5.2';

describe('NodeSlide run budget normalization', () => {
  it('A05: parses the exact standalone run ceiling with decimal-safe micro-USD', () => {
    expect(parseNodeSlideSpendConstraint('Spend no more than $1 on this run')).toEqual({
      source: 'instruction',
      matchedText: 'Spend no more than $1 on this run',
      maxCostMicroUsd: 1_000_000,
    });
    expect(parseUsdDecimalToMicroUsd('0.1234569')).toBe(123_456);
  });

  it('uses the most restrictive repeated ceiling and ignores unrelated dollar copy', () => {
    expect(
      parseNodeSlideSpendConstraint(
        'The market is worth $10B. Spend no more than $2 on this run, then spend not more than $0.75 for the run.',
      ),
    ).toMatchObject({ maxCostMicroUsd: 750_000 });
    expect(parseNodeSlideSpendConstraint('Show a $1 price point on the market slide.')).toBeNull();
  });

  it('applies finite defaults and is canonically idempotent', () => {
    const normalized = normalizeNodeSlideRunBudget({});

    expect(normalized).toEqual({
      version: 'nodeslide.run-budget/v1',
      enforcement: 'hard',
      maxCostUsd: NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.default,
      maxCostMicroUsd: NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.default * 1_000_000,
      maxInputTokens: NODESLIDE_RUN_BUDGET_BOUNDS.maxInputTokens.default,
      maxOutputTokens: NODESLIDE_RUN_BUDGET_BOUNDS.maxOutputTokens.default,
      maxDurationMs: NODESLIDE_RUN_BUDGET_BOUNDS.maxDurationMs.default,
      maxIterations: NODESLIDE_RUN_BUDGET_BOUNDS.maxIterations.default,
      maxToolCalls: NODESLIDE_RUN_BUDGET_BOUNDS.maxToolCalls.default,
    });
    expect(normalizeNodeSlideRunBudget(normalized)).toEqual(normalized);
  });

  it('accepts every declared endpoint and rejects out-of-range or non-integral input', () => {
    const boundedFields = [
      'maxInputTokens',
      'maxOutputTokens',
      'maxDurationMs',
      'maxIterations',
      'maxToolCalls',
    ] as const;
    for (const field of boundedFields) {
      const bounds = NODESLIDE_RUN_BUDGET_BOUNDS[field];
      expect(() => normalizeNodeSlideRunBudget({ [field]: bounds.min })).not.toThrow();
      expect(() => normalizeNodeSlideRunBudget({ [field]: bounds.max })).not.toThrow();
      expect(() => normalizeNodeSlideRunBudget({ [field]: bounds.min - 1 })).toThrow(field);
      expect(() => normalizeNodeSlideRunBudget({ [field]: bounds.max + 1 })).toThrow(field);
      expect(() => normalizeNodeSlideRunBudget({ [field]: bounds.min + 0.5 })).toThrow(field);
    }
    expect(() =>
      normalizeNodeSlideRunBudget({ maxCostUsd: NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.min }),
    ).not.toThrow();
    expect(() => normalizeNodeSlideRunBudget({ maxCostUsd: -0.000001 })).toThrow('maxCostUsd');
    expect(() => normalizeNodeSlideRunBudget({ maxCostUsd: Number.NaN })).toThrow('maxCostUsd');
    expect(() => normalizeNodeSlideRunBudget({ unexpected: 1 })).toThrow('unexpected');
  });

  it('canonicalizes USD down to integer micro-USD without increasing a hard cap', () => {
    const normalized = normalizeNodeSlideRunBudget({ maxCostUsd: 0.1234569 });
    expect(normalized.maxCostMicroUsd).toBe(123_456);
    expect(normalized.maxCostUsd).toBe(0.123456);
  });
});

describe('NodeSlide model pricing metadata', () => {
  it('has an explicit priced-or-unknown row for every current named model', () => {
    const catalogIds = NODESLIDE_AGENT_MODELS.map((model) => model.id).sort();
    expect(Object.keys(NODESLIDE_MODEL_PRICING).sort()).toEqual(catalogIds);

    for (const model of NODESLIDE_AGENT_MODELS) {
      const metadata = nodeSlideModelPricing(model.id);
      expect(metadata.modelId).toBe(model.id);
      expect(['priced', 'unknown']).toContain(metadata.kind);
    }
    expect(nodeSlideModelPricing(PRICED_MODEL)).toMatchObject({
      kind: 'priced',
      inputMicroUsdPerMillionTokens: 1_400_000,
      outputMicroUsdPerMillionTokens: 4_400_000,
      providerContextWindowTokens: 1_048_576,
      providerMaxOutputTokens: 131_072,
    });
  });

  it('returns typed unscored data, never a fabricated estimate, for unknown pricing', () => {
    const named = scoreNodeSlideWorstCaseCost({
      model: 'z-ai/glm-5.2',
      inputTokens: 10_000,
      outputTokens: 2_000,
    });
    const uncataloged = scoreNodeSlideWorstCaseCost({
      model: 'vendor/not-cataloged',
      inputTokens: 10_000,
      outputTokens: 2_000,
    });

    expect(named).toMatchObject({
      kind: 'unscored',
      reason: 'pricing_unknown',
      totalCostMicroUsd: null,
      pricing: { reason: 'provider_pricing_not_pinned' },
    });
    expect(uncataloged).toMatchObject({
      kind: 'unscored',
      totalCostMicroUsd: null,
      pricing: { reason: 'model_not_cataloged' },
    });
  });

  it('rounds each priced token component upward and scores the private route at zero', () => {
    expect(
      scoreNodeSlideWorstCaseCost({ model: PRICED_MODEL, inputTokens: 1, outputTokens: 1 }),
    ).toMatchObject({
      kind: 'scored',
      inputCostMicroUsd: 2,
      outputCostMicroUsd: 5,
      totalCostMicroUsd: 7,
    });
    expect(
      scoreNodeSlideWorstCaseCost({
        model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toMatchObject({ kind: 'scored', totalCostMicroUsd: 0 });
  });
});

describe('NodeSlide run budget preflight', () => {
  it('A05: makes a $1 run unable to schedule output above its conservative remainder', () => {
    const initial = createNodeSlideRunBudgetState({
      maxCostUsd: 1,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 200_000,
    });
    const charged = applyReceipt(
      initial,
      receipt({ idempotencyKey: 'a05-prior-charge', costMicroUsd: 900_000 }),
    );
    const unsafeRequestedCost = scoreNodeSlideWorstCaseCost({
      model: PRICED_MODEL,
      inputTokens: 50_000,
      outputTokens: 10_000,
    });
    expect(unsafeRequestedCost).toMatchObject({
      kind: 'scored',
      totalCostMicroUsd: 114_000,
    });

    const decision = preflightNodeSlideRunBudget({
      state: charged,
      model: PRICED_MODEL,
      estimatedInputTokens: 50_000,
      requestedMaxOutputTokens: 10_000,
    });

    expect(decision.ok).toBe(true);
    if (!decision.ok) throw new Error(decision.reason.code);
    expect(decision.remainingBeforeCall.costMicroUsd).toBe(100_000);
    expect(decision.providerSafeOutputTokenCeiling).toBe(6_818);
    expect(decision.providerSafeOutputTokenCeiling).toBeLessThan(10_000);
    expect(decision.worstCaseCostMicroUsd).toBeLessThanOrEqual(
      decision.remainingBeforeCall.costMicroUsd,
    );
  });

  it('denies when estimated input plus one output token cannot fit the cost remainder', () => {
    const initial = createNodeSlideRunBudgetState({ maxCostUsd: 1 });
    const charged = applyReceipt(
      initial,
      receipt({ idempotencyKey: 'prior-cost', costMicroUsd: 900_000 }),
    );
    const decision = preflightNodeSlideRunBudget({
      state: charged,
      model: PRICED_MODEL,
      estimatedInputTokens: 71_429,
      requestedMaxOutputTokens: 1,
    });

    expect(decision).toMatchObject({
      ok: false,
      reason: {
        code: 'cost_budget_exceeded',
        remainingCostMicroUsd: 100_000,
        inputCostMicroUsd: 100_001,
      },
    });
  });

  it('caps output by provider, cumulative output, and estimated cumulative input limits', () => {
    const providerBound = preflightNodeSlideRunBudget({
      state: createNodeSlideRunBudgetState({ maxCostUsd: 1, maxOutputTokens: 500_000 }),
      model: PRICED_MODEL,
      estimatedInputTokens: 0,
      requestedMaxOutputTokens: 500_000,
    });
    expect(providerBound).toMatchObject({
      ok: true,
      providerSafeOutputTokenCeiling: 131_072,
    });

    const contextBound = preflightNodeSlideRunBudget({
      state: createNodeSlideRunBudgetState({ maxCostUsd: 10 }),
      model: PRICED_MODEL,
      estimatedInputTokens: 1_048_570,
      requestedMaxOutputTokens: 100,
    });
    expect(contextBound).toMatchObject({
      ok: true,
      providerSafeOutputTokenCeiling: 6,
    });
    expect(
      preflightNodeSlideRunBudget({
        state: createNodeSlideRunBudgetState({ maxCostUsd: 10 }),
        model: PRICED_MODEL,
        estimatedInputTokens: 1_048_576,
        requestedMaxOutputTokens: 1,
      }),
    ).toMatchObject({ ok: false, reason: { code: 'model_context_exceeded' } });

    const nearTokens = applyReceipt(
      createNodeSlideRunBudgetState({
        maxCostUsd: 10,
        maxInputTokens: 100,
        maxOutputTokens: 50,
      }),
      receipt({
        idempotencyKey: 'near-token-caps',
        model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
        inputTokens: 90,
        outputTokens: 45,
      }),
    );
    expect(
      preflightNodeSlideRunBudget({
        state: nearTokens,
        model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
        estimatedInputTokens: 10,
        requestedMaxOutputTokens: 100,
      }),
    ).toMatchObject({ ok: true, providerSafeOutputTokenCeiling: 5 });
    expect(
      preflightNodeSlideRunBudget({
        state: nearTokens,
        model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
        estimatedInputTokens: 11,
        requestedMaxOutputTokens: 1,
      }),
    ).toMatchObject({ ok: false, reason: { code: 'estimated_input_exceeds_remaining' } });
  });

  it('fails closed for hard monetary caps when pricing is unknown', () => {
    const decision = preflightNodeSlideRunBudget({
      state: createNodeSlideRunBudgetState({ maxCostUsd: 1 }),
      model: 'anthropic/claude-sonnet-5',
      estimatedInputTokens: 100,
      requestedMaxOutputTokens: 100,
    });

    expect(decision).toMatchObject({
      ok: false,
      reason: {
        code: 'pricing_unknown',
        pricing: { kind: 'unknown', reason: 'provider_pricing_not_pinned' },
      },
    });
  });
});

describe('NodeSlide postflight accounting', () => {
  it('accumulates provider usage and cost exactly once for an idempotency key', () => {
    const initial = createNodeSlideRunBudgetState({ maxCostUsd: 1 });
    const providerReceipt = receipt({
      idempotencyKey: 'provider-receipt-42',
      inputTokens: 123,
      outputTokens: 45,
      costMicroUsd: 67_890,
      elapsedMs: 750,
      iterations: 2,
      toolCalls: 3,
    });
    const first = accountNodeSlideRunBudgetReceipt({ state: initial, receipt: providerReceipt });
    expect(first).toMatchObject({
      ok: true,
      applied: true,
      state: {
        accumulated: {
          inputTokens: 123,
          outputTokens: 45,
          costMicroUsd: 67_890,
          elapsedMs: 750,
          iterations: 2,
          toolCalls: 3,
        },
      },
      remaining: { costMicroUsd: 932_110 },
      terminalReason: null,
    });
    if (!first.ok) throw new Error(first.reason.code);

    const replay = accountNodeSlideRunBudgetReceipt({
      state: first.state,
      receipt: { ...providerReceipt },
    });
    expect(replay).toMatchObject({ ok: true, applied: false });
    if (!replay.ok) throw new Error(replay.reason.code);
    expect(replay.state).toBe(first.state);
    expect(replay.state.accumulated).toEqual(first.state.accumulated);
  });

  it('rejects a mismatched replay without mutating accounting', () => {
    const providerReceipt = receipt({
      idempotencyKey: 'provider-replay-key',
      costMicroUsd: 10_000,
    });
    const applied = accountNodeSlideRunBudgetReceipt({
      state: createNodeSlideRunBudgetState(),
      receipt: providerReceipt,
    });
    if (!applied.ok) throw new Error(applied.reason.code);

    const mismatch = accountNodeSlideRunBudgetReceipt({
      state: applied.state,
      receipt: { ...providerReceipt, costMicroUsd: 10_001 },
    });
    expect(mismatch).toMatchObject({
      ok: false,
      reason: { code: 'receipt_replay_mismatch', idempotencyKey: 'provider-replay-key' },
    });
    if (mismatch.ok) throw new Error('Expected mismatched replay rejection');
    expect(mismatch.state).toBe(applied.state);
    expect(mismatch.state.accumulated.costMicroUsd).toBe(10_000);
  });

  it('marks the run terminal at actual cumulative cost and denies the next call', () => {
    let state = createNodeSlideRunBudgetState({ maxCostUsd: 1 });
    state = applyReceipt(state, receipt({ idempotencyKey: 'cost-part-1', costMicroUsd: 600_000 }));
    const final = accountNodeSlideRunBudgetReceipt({
      state,
      receipt: receipt({ idempotencyKey: 'cost-part-2', costMicroUsd: 400_000 }),
    });
    expect(final).toMatchObject({
      ok: true,
      remaining: { costMicroUsd: 0, costUsd: 0 },
      terminalReason: { code: 'max_cost_reached', used: 1_000_000, limit: 1_000_000 },
    });
    if (!final.ok) throw new Error(final.reason.code);

    expect(
      preflightNodeSlideRunBudget({
        state: final.state,
        model: PRICED_MODEL,
        estimatedInputTokens: 0,
        requestedMaxOutputTokens: 1,
      }),
    ).toMatchObject({ ok: false, reason: { code: 'max_cost_reached' } });
  });

  it('rejects nonzero cost on the deterministic/private route', () => {
    const result = accountNodeSlideRunBudgetReceipt({
      state: createNodeSlideRunBudgetState(),
      receipt: receipt({
        model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
        costMicroUsd: 1,
      }),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: { code: 'invalid_receipt', field: 'costMicroUsd' },
    });
  });
});

describe('NodeSlide deterministic/private route caps', () => {
  it('costs zero while retaining a provider-safe output and timeout ceiling', () => {
    const decision = preflightNodeSlideRunBudget({
      state: createNodeSlideRunBudgetState({
        maxCostUsd: 0,
        maxInputTokens: 100,
        maxOutputTokens: 100,
        maxDurationMs: 1_000,
      }),
      model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
      estimatedInputTokens: 10,
      requestedMaxOutputTokens: 20,
    });
    expect(decision).toMatchObject({
      ok: true,
      pricing: { kind: 'zero_cost' },
      remainingBeforeCall: { costMicroUsd: 0 },
      providerSafeOutputTokenCeiling: 20,
      providerTimeoutMs: 1_000,
      worstCaseCostMicroUsd: 0,
    });
    expect(
      preflightNodeSlideRunBudget({
        state: createNodeSlideRunBudgetState({ maxCostUsd: 0 }),
        model: PRICED_MODEL,
        estimatedInputTokens: 0,
        requestedMaxOutputTokens: 1,
      }),
    ).toMatchObject({ ok: false, reason: { code: 'cost_budget_exceeded' } });
  });

  it.each([
    ['time', { maxDurationMs: 1_000 }, { elapsedMs: 1_000 }, 'max_duration_reached'],
    ['iteration', { maxIterations: 1 }, { iterations: 1 }, 'max_iterations_reached'],
    ['tool', { maxToolCalls: 1 }, { toolCalls: 1 }, 'max_tool_calls_reached'],
  ])('still terminates at the %s cap', (_label, budget, receiptDelta, expectedCode) => {
    const accounted = accountNodeSlideRunBudgetReceipt({
      state: createNodeSlideRunBudgetState(budget),
      receipt: receipt({
        idempotencyKey: `private-${expectedCode}`,
        model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
        ...receiptDelta,
      }),
    });
    expect(accounted).toMatchObject({
      ok: true,
      terminalReason: { code: expectedCode },
    });
    if (!accounted.ok) throw new Error(accounted.reason.code);
    expect(
      preflightNodeSlideRunBudget({
        state: accounted.state,
        model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
        estimatedInputTokens: 0,
        requestedMaxOutputTokens: 1,
      }),
    ).toMatchObject({ ok: false, reason: { code: expectedCode } });
  });
});

describe('NodeSlide run budget digests', () => {
  it('is stable across input key and receipt application order', () => {
    const leftBudget: NodeSlideRunBudgetInput = {
      maxCostUsd: 2,
      maxInputTokens: 1_000,
      maxOutputTokens: 500,
      maxDurationMs: 10_000,
      maxIterations: 10,
      maxToolCalls: 10,
    };
    const rightBudget = {
      maxToolCalls: 10,
      maxIterations: 10,
      maxDurationMs: 10_000,
      maxOutputTokens: 500,
      maxInputTokens: 1_000,
      maxCostUsd: 2,
    };
    const receiptA = receipt({ idempotencyKey: 'digest-a', inputTokens: 10 });
    const receiptB = receipt({ idempotencyKey: 'digest-b', outputTokens: 20 });
    let left = createNodeSlideRunBudgetState(leftBudget);
    let right = createNodeSlideRunBudgetState(rightBudget);
    expect(left.digest).toBe(right.digest);

    left = applyReceipt(applyReceipt(left, receiptA), receiptB);
    right = applyReceipt(applyReceipt(right, receiptB), receiptA);
    expect(left.accumulated).toEqual(right.accumulated);
    expect(left.receiptDigests).toEqual(right.receiptDigests);
    expect(left.digest).toBe(right.digest);
    expect(left.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const reorderedReceipt = {
      toolCalls: receiptA.toolCalls,
      iterations: receiptA.iterations,
      elapsedMs: receiptA.elapsedMs,
      costMicroUsd: receiptA.costMicroUsd,
      outputTokens: receiptA.outputTokens,
      inputTokens: receiptA.inputTokens,
      model: receiptA.model,
      idempotencyKey: receiptA.idempotencyKey,
      version: receiptA.version,
    };
    expect(nodeSlideRunBudgetReceiptDigest(reorderedReceipt)).toBe(
      nodeSlideRunBudgetReceiptDigest(receiptA),
    );
  });

  it('produces stable preflight decisions and fails closed on state digest tampering', () => {
    const state = createNodeSlideRunBudgetState({ maxCostUsd: 1 });
    const args = {
      state,
      model: PRICED_MODEL,
      estimatedInputTokens: 100,
      requestedMaxOutputTokens: 100,
    };
    const first = preflightNodeSlideRunBudget(args);
    const second = preflightNodeSlideRunBudget(args);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (!first.ok || !second.ok) throw new Error('Expected stable allowed decisions');
    expect(first.decisionDigest).toBe(second.decisionDigest);

    const tampered: NodeSlideRunBudgetState = {
      ...state,
      digest: `sha256:${'0'.repeat(64)}`,
    };
    expect(preflightNodeSlideRunBudget({ ...args, state: tampered })).toMatchObject({
      ok: false,
      reason: { code: 'state_digest_mismatch' },
    });
    expect(accountNodeSlideRunBudgetReceipt({ state: tampered, receipt: receipt() })).toMatchObject(
      { ok: false, reason: { code: 'state_digest_mismatch' } },
    );
  });
});

function receipt(overrides: Partial<NodeSlideRunBudgetReceipt> = {}): NodeSlideRunBudgetReceipt {
  return {
    version: NODESLIDE_RUN_BUDGET_RECEIPT_VERSION,
    idempotencyKey: 'provider-receipt-1',
    model: PRICED_MODEL,
    inputTokens: 0,
    outputTokens: 0,
    costMicroUsd: 0,
    elapsedMs: 0,
    iterations: 1,
    toolCalls: 0,
    ...overrides,
  };
}

function applyReceipt(
  state: NodeSlideRunBudgetState,
  providerReceipt: NodeSlideRunBudgetReceipt,
): NodeSlideRunBudgetState {
  const result = accountNodeSlideRunBudgetReceipt({ state, receipt: providerReceipt });
  if (!result.ok) throw new Error(`${result.reason.code}: receipt was not applied`);
  if (!result.applied) throw new Error('Expected a newly applied receipt');
  return result.state;
}
