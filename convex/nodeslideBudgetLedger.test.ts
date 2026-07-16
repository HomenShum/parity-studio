import { describe, expect, it } from 'vitest';
import { normalizeNodeSlideRunBudget } from '../shared/nodeslideRunBudget';
import {
  NODESLIDE_BUDGET_LEDGER_VERSION,
  NodeSlideBudgetLedgerError,
  type NodeSlideBudgetLedgerState,
  assertNodeSlideBudgetLedgerState,
  assertNodeSlideExpectedBudgetState,
  captureNodeSlideBudgetTimeoutCost,
  costLedgerFromState,
  nodeSlideBudgetEventDigest,
  nodeSlideBudgetStateCoreDigest,
  nodeSlideBudgetStateDigest,
  nodeSlidePreflightStateFromLedger,
  releaseNodeSlideBudgetCost,
  reserveNodeSlideBudgetCost,
  settleNodeSlideBudgetCost,
} from './lib/nodeslideBudgetLedger';
import { nodeSlideRunBudgetStateDigest } from './lib/nodeslideRunBudget';

describe('NodeSlide durable budget cost ledger', () => {
  it('enforces actual + reserved + unreconciled at every cost-transition prefix', () => {
    const start = {
      capMicroUsd: 100,
      actualMicroUsd: 0,
      reservedMicroUsd: 0,
      unreconciledMicroUsd: 0,
    };
    const reserved = reserveNodeSlideBudgetCost(start, 60);
    expect(reserved).toEqual({ ...start, reservedMicroUsd: 60 });
    expect(() => reserveNodeSlideBudgetCost(reserved, 41)).toThrow(NodeSlideBudgetLedgerError);

    const unknown = captureNodeSlideBudgetTimeoutCost(reserved, 60);
    expect(unknown).toEqual({ ...start, unreconciledMicroUsd: 60 });

    const settled = settleNodeSlideBudgetCost(unknown, {
      source: 'unreconciled',
      quoteMicroUsd: 60,
      actualMicroUsd: 42,
    });
    expect(settled).toEqual({ ...start, actualMicroUsd: 42 });
    expect(() =>
      settleNodeSlideBudgetCost(
        { ...start, reservedMicroUsd: 60 },
        {
          source: 'reserved',
          quoteMicroUsd: 60,
          actualMicroUsd: 61,
        },
      ),
    ).toThrow('actual cost exceeds');
  });

  it('releases either held state without changing actual settled spend', () => {
    const reserved = {
      capMicroUsd: 100,
      actualMicroUsd: 20,
      reservedMicroUsd: 30,
      unreconciledMicroUsd: 0,
    };
    expect(releaseNodeSlideBudgetCost(reserved, 'reserved', 30)).toEqual({
      capMicroUsd: 100,
      actualMicroUsd: 20,
      reservedMicroUsd: 0,
      unreconciledMicroUsd: 0,
    });
    expect(
      releaseNodeSlideBudgetCost(
        { capMicroUsd: 100, actualMicroUsd: 20, reservedMicroUsd: 0, unreconciledMicroUsd: 30 },
        'unreconciled',
        30,
      ),
    ).toMatchObject({ actualMicroUsd: 20, unreconciledMicroUsd: 0 });
  });

  it('binds stale-state checks and persisted state to deterministic digests', () => {
    const state = durableState();
    expect(() => assertNodeSlideBudgetLedgerState(state)).not.toThrow();
    expect(() => assertNodeSlideExpectedBudgetState(state, 0, state.stateDigest)).not.toThrow();
    expect(() => assertNodeSlideExpectedBudgetState(state, 1, state.stateDigest)).toThrow(
      'stale_budget_state',
    );
    expect(() => assertNodeSlideExpectedBudgetState(state, 0, 'sha256:bad')).toThrow(
      'invalid_budget_ledger',
    );
  });

  it('exposes held cost to the shared preflight instead of allowing concurrent overspend', () => {
    const state = durableState({ actualMicroUsd: 20, reservedMicroUsd: 70 });
    const preflight = nodeSlidePreflightStateFromLedger(state);
    expect(preflight.accumulated.costMicroUsd).toBe(90);
    expect(preflight.digest).toBe(nodeSlideRunBudgetStateDigest(preflight));
    expect(costLedgerFromState(state)).toMatchObject({ capMicroUsd: 100, reservedMicroUsd: 70 });
  });

  it('chains event digests to the canonical budget core', () => {
    const state = durableState();
    const event = {
      version: 'nodeslide.budget-event/v1' as const,
      budgetId: state.id,
      sequence: 1,
      revision: 1,
      kind: 'created' as const,
      operationDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'open' as const,
      actualDeltaMicroUsd: 0,
      reservedDeltaMicroUsd: 0,
      unreconciledDeltaMicroUsd: 0,
      actualMicroUsd: 0,
      reservedMicroUsd: 0,
      unreconciledMicroUsd: 0,
      capMicroUsd: 100,
      accountingStateDigest: state.accountingStateDigest,
      budgetStateCoreDigest: nodeSlideBudgetStateCoreDigest(state),
    };
    expect(nodeSlideBudgetEventDigest(event)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(nodeSlideBudgetEventDigest({ ...event })).toBe(nodeSlideBudgetEventDigest(event));
  });
});

function durableState(
  costs: { actualMicroUsd?: number; reservedMicroUsd?: number; unreconciledMicroUsd?: number } = {},
): NodeSlideBudgetLedgerState {
  const budget = normalizeNodeSlideRunBudget({
    maxCostUsd: 0.0001,
    maxInputTokens: 10,
    maxOutputTokens: 10,
    maxDurationMs: 1_000,
    maxIterations: 1,
    maxToolCalls: 1,
  });
  const actualMicroUsd = costs.actualMicroUsd ?? 0;
  const reservedMicroUsd = costs.reservedMicroUsd ?? 0;
  const unreconciledMicroUsd = costs.unreconciledMicroUsd ?? 0;
  const accounting = {
    version: 'nodeslide.run-budget-state/v1' as const,
    budget,
    accumulated: {
      costMicroUsd: actualMicroUsd,
      inputTokens: 0,
      outputTokens: 0,
      elapsedMs: 0,
      iterations: 0,
      toolCalls: 0,
    },
    receiptDigests: {},
  };
  const core = {
    version: NODESLIDE_BUDGET_LEDGER_VERSION,
    id: 'budget-test-1',
    status: 'open' as const,
    budget,
    actualMicroUsd,
    reservedMicroUsd,
    unreconciledMicroUsd,
    accumulated: {
      inputTokens: 0,
      outputTokens: 0,
      elapsedMs: 0,
      iterations: 0,
      toolCalls: 0,
    },
    receiptDigests: {},
    accountingStateDigest: nodeSlideRunBudgetStateDigest(accounting),
    revision: 0,
    eventSequence: 0,
    lastEventDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  };
  return { ...core, stateDigest: nodeSlideBudgetStateDigest(core) };
}
