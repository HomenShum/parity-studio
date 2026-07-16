import { v } from 'convex/values';
import {
  NODESLIDE_RUN_BUDGET_RECEIPT_VERSION,
  type NodeSlideRunBudget,
  type NodeSlideRunBudgetReceipt,
  normalizeNodeSlideRunBudget,
} from '../shared/nodeslideRunBudget';
import type { Doc } from './_generated/dataModel';
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from './_generated/server';
import {
  NODESLIDE_BILLABLE_CALL_VERSION,
  NODESLIDE_BUDGET_EVENT_VERSION,
  NODESLIDE_BUDGET_LEDGER_VERSION,
  type NodeSlideBudgetEventKind,
  NodeSlideBudgetLedgerError,
  type NodeSlideBudgetLedgerState,
  assertNodeSlideBudgetLedgerState,
  assertNodeSlideExpectedBudgetState,
  assertNodeSlideLedgerKey,
  captureNodeSlideBudgetTimeoutCost,
  costLedgerFromState,
  nodeSlideAccountingStateFromLedger,
  nodeSlideBillableCallReleaseDigest,
  nodeSlideBillableCallReservationDigest,
  nodeSlideBillableCallSettlementDigest,
  nodeSlideBillableCallTimeoutDigest,
  nodeSlideBudgetConfigDigest,
  nodeSlideBudgetEventDigest,
  nodeSlideBudgetFinalizeDigest,
  nodeSlideBudgetPricingDigest,
  nodeSlideBudgetStateCoreDigest,
  nodeSlideBudgetStateDigest,
  nodeSlidePreflightStateFromLedger,
  releaseNodeSlideBudgetCost,
  reserveNodeSlideBudgetCost,
  settleNodeSlideBudgetCost,
} from './lib/nodeslideBudgetLedger';
import {
  accountNodeSlideRunBudgetReceipt,
  nodeSlideRunBudgetReceiptDigest,
  nodeSlideRunBudgetStateDigest,
  preflightNodeSlideRunBudget,
} from './lib/nodeslideRunBudget';

const budgetInputValidator = v.object({
  maxCostUsd: v.optional(v.number()),
  maxInputTokens: v.optional(v.number()),
  maxOutputTokens: v.optional(v.number()),
  maxDurationMs: v.optional(v.number()),
  maxIterations: v.optional(v.number()),
  maxToolCalls: v.optional(v.number()),
});

const expectedStateValidator = {
  expectedRevision: v.number(),
  expectedStateDigest: v.string(),
};

const settlementValidator = {
  inputTokens: v.number(),
  outputTokens: v.number(),
  actualMicroUsd: v.number(),
  elapsedMs: v.number(),
  iterations: v.number(),
  toolCalls: v.number(),
};

type BudgetRow = Doc<'nodeslide_run_budgets'>;
type CallRow = Doc<'nodeslide_billable_calls'>;

/**
 * Internal-only, atomic hard-budget persistence. Provider and job callers are
 * deliberately not wired here; they must invoke these mutations after their
 * own trusted execution boundary is in place.
 */
export const create = internalMutation({
  args: { budgetId: v.string(), budget: budgetInputValidator },
  handler: async (ctx, args) => {
    assertNodeSlideLedgerKey('budgetId', args.budgetId);
    const budget = normalizeNodeSlideRunBudget(args.budget);
    const configDigest = nodeSlideBudgetConfigDigest(args.budgetId, budget);
    const existing = await findBudget(ctx, args.budgetId);
    if (existing) {
      if (existing.configDigest !== configDigest) {
        throw new NodeSlideBudgetLedgerError(
          'budget_idempotency_conflict',
          'budget id is already bound to a different canonical configuration',
        );
      }
      return present(existing);
    }

    const now = Date.now();
    const initial = initialBudgetState(args.budgetId, budget);
    const transition = advanceBudget(initial, {
      kind: 'created',
      operationDigest: configDigest,
      deltas: zeroCostDeltas,
      previousEventDigest: undefined,
    });
    await ctx.db.insert('nodeslide_run_budgets', {
      id: args.budgetId,
      version: NODESLIDE_BUDGET_LEDGER_VERSION,
      status: transition.state.status,
      budget,
      configDigest,
      actualMicroUsd: transition.state.actualMicroUsd,
      reservedMicroUsd: transition.state.reservedMicroUsd,
      unreconciledMicroUsd: transition.state.unreconciledMicroUsd,
      accumulated: transition.state.accumulated,
      receiptDigests: transition.state.receiptDigests,
      accountingStateDigest: transition.state.accountingStateDigest,
      revision: transition.state.revision,
      eventSequence: transition.state.eventSequence,
      lastEventDigest: transition.state.lastEventDigest,
      stateDigest: transition.state.stateDigest,
      createdAt: now,
      updatedAt: now,
    });
    await insertEvent(ctx, args.budgetId, transition, now);
    return present(await requireBudget(ctx, args.budgetId));
  },
});

export const reserve = internalMutation({
  args: {
    budgetId: v.string(),
    callId: v.string(),
    model: v.string(),
    estimatedInputTokens: v.number(),
    requestedMaxOutputTokens: v.number(),
    ...expectedStateValidator,
  },
  handler: async (ctx, args) => {
    assertNodeSlideLedgerKey('budgetId', args.budgetId);
    assertNodeSlideLedgerKey('callId', args.callId);
    const operationDigest = nodeSlideBillableCallReservationDigest(args);
    const existingCall = await findCall(ctx, args.budgetId, args.callId);
    if (existingCall) {
      if (existingCall.reservationDigest !== operationDigest) {
        throw new NodeSlideBudgetLedgerError(
          'call_idempotency_conflict',
          'call id is already bound to a different reservation',
        );
      }
      const budget = await requireBudget(ctx, args.budgetId);
      return present(budget, existingCall);
    }

    const row = await requireBudget(ctx, args.budgetId);
    const state = stateFromRow(row);
    assertOpenAndExpected(state, args.expectedRevision, args.expectedStateDigest);
    const decision = preflightNodeSlideRunBudget({
      state: nodeSlidePreflightStateFromLedger(state),
      model: args.model,
      estimatedInputTokens: args.estimatedInputTokens,
      requestedMaxOutputTokens: args.requestedMaxOutputTokens,
    });
    if (!decision.ok) {
      throw new NodeSlideBudgetLedgerError(
        decision.reason.code === 'pricing_unknown' ? 'pricing_unknown' : 'budget_exceeded',
        `reservation refused: ${decision.reason.code}`,
      );
    }

    const nextCost = reserveNodeSlideBudgetCost(
      costLedgerFromState(state),
      decision.worstCaseCostMicroUsd,
    );
    const transition = advanceBudget(state, {
      kind: 'reserved',
      operationDigest,
      deltas: {
        actualDeltaMicroUsd: 0,
        reservedDeltaMicroUsd: decision.worstCaseCostMicroUsd,
        unreconciledDeltaMicroUsd: 0,
      },
      cost: nextCost,
    });
    const now = Date.now();
    await ctx.db.insert('nodeslide_billable_calls', {
      budgetId: args.budgetId,
      callId: args.callId,
      version: NODESLIDE_BILLABLE_CALL_VERSION,
      status: 'reserved',
      model: args.model,
      pricingDigest: nodeSlideBudgetPricingDigest(decision.pricing),
      quoteMicroUsd: decision.worstCaseCostMicroUsd,
      estimatedInputTokens: args.estimatedInputTokens,
      requestedMaxOutputTokens: args.requestedMaxOutputTokens,
      providerSafeOutputTokenCeiling: decision.providerSafeOutputTokenCeiling,
      providerTimeoutMs: decision.providerTimeoutMs,
      reservationDigest: operationDigest,
      createdAt: now,
      updatedAt: now,
    });
    await persistTransition(ctx, row, transition, now);
    return present(
      await requireBudget(ctx, args.budgetId),
      await requireCall(ctx, args.budgetId, args.callId),
    );
  },
});

/** Records a provider receipt exactly once, but only within its reservation. */
export const settle = internalMutation({
  args: {
    budgetId: v.string(),
    callId: v.string(),
    ...settlementValidator,
    ...expectedStateValidator,
  },
  handler: async (ctx, args) => {
    const call = await requireCall(ctx, args.budgetId, args.callId);
    const operationDigest = nodeSlideBillableCallSettlementDigest({
      budgetId: args.budgetId,
      callId: args.callId,
      model: call.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      actualMicroUsd: args.actualMicroUsd,
      elapsedMs: args.elapsedMs,
      iterations: args.iterations,
      toolCalls: args.toolCalls,
    });
    const row = await requireBudget(ctx, args.budgetId);
    if (call.status === 'settled') return replayTerminal(row, call, operationDigest);
    if (call.status !== 'reserved' && call.status !== 'unreconciled') {
      throw new NodeSlideBudgetLedgerError('invalid_call_transition', 'only held calls can settle');
    }
    const state = stateFromRow(row);
    assertOpenAndExpected(state, args.expectedRevision, args.expectedStateDigest);
    const nextCost = settleNodeSlideBudgetCost(costLedgerFromState(state), {
      source: call.status === 'reserved' ? 'reserved' : 'unreconciled',
      quoteMicroUsd: call.quoteMicroUsd,
      actualMicroUsd: args.actualMicroUsd,
    });
    const receipt: NodeSlideRunBudgetReceipt = {
      version: NODESLIDE_RUN_BUDGET_RECEIPT_VERSION,
      idempotencyKey: args.callId,
      model: call.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costMicroUsd: args.actualMicroUsd,
      elapsedMs: args.elapsedMs,
      iterations: args.iterations,
      toolCalls: args.toolCalls,
    };
    const accounted = accountNodeSlideRunBudgetReceipt({
      state: nodeSlideAccountingStateFromLedger(state),
      receipt,
    });
    if (!accounted.ok) {
      throw new NodeSlideBudgetLedgerError('receipt_rejected', accounted.reason.code);
    }
    assertUsageWithinBudget(accounted.state.budget, accounted.state.accumulated);
    const receiptDigest = nodeSlideRunBudgetReceiptDigest(receipt);
    const transition = advanceBudget(state, {
      kind: 'settled',
      operationDigest,
      deltas: {
        actualDeltaMicroUsd: args.actualMicroUsd,
        reservedDeltaMicroUsd: call.status === 'reserved' ? -call.quoteMicroUsd : 0,
        unreconciledDeltaMicroUsd: call.status === 'unreconciled' ? -call.quoteMicroUsd : 0,
      },
      cost: nextCost,
      accumulated: withoutCost(accounted.state.accumulated),
      receiptDigests: accounted.state.receiptDigests,
    });
    const now = Date.now();
    await ctx.db.patch(call._id, {
      status: 'settled',
      terminalOperationDigest: operationDigest,
      receiptDigest,
      actualMicroUsd: args.actualMicroUsd,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      elapsedMs: args.elapsedMs,
      iterations: args.iterations,
      toolCalls: args.toolCalls,
      updatedAt: now,
      settledAt: now,
    });
    await persistTransition(ctx, row, transition, now);
    return present(
      await requireBudget(ctx, args.budgetId),
      await requireCall(ctx, args.budgetId, args.callId),
    );
  },
});

/** Holds the full authorization after an indeterminate provider timeout. */
export const captureTimeout = internalMutation({
  args: { budgetId: v.string(), callId: v.string(), ...expectedStateValidator },
  handler: async (ctx, args) => {
    const call = await requireCall(ctx, args.budgetId, args.callId);
    const operationDigest = nodeSlideBillableCallTimeoutDigest(args.budgetId, args.callId);
    const row = await requireBudget(ctx, args.budgetId);
    if (call.status === 'unreconciled') return replayTerminal(row, call, operationDigest);
    if (call.status !== 'reserved') {
      throw new NodeSlideBudgetLedgerError(
        'invalid_call_transition',
        'only reserved calls can time out',
      );
    }
    const state = stateFromRow(row);
    assertOpenAndExpected(state, args.expectedRevision, args.expectedStateDigest);
    const nextCost = captureNodeSlideBudgetTimeoutCost(
      costLedgerFromState(state),
      call.quoteMicroUsd,
    );
    const transition = advanceBudget(state, {
      kind: 'timeout_captured',
      operationDigest,
      deltas: {
        actualDeltaMicroUsd: 0,
        reservedDeltaMicroUsd: -call.quoteMicroUsd,
        unreconciledDeltaMicroUsd: call.quoteMicroUsd,
      },
      cost: nextCost,
    });
    const now = Date.now();
    await ctx.db.patch(call._id, {
      status: 'unreconciled',
      terminalOperationDigest: operationDigest,
      updatedAt: now,
      timeoutCapturedAt: now,
    });
    await persistTransition(ctx, row, transition, now);
    return present(
      await requireBudget(ctx, args.budgetId),
      await requireCall(ctx, args.budgetId, args.callId),
    );
  },
});

/** Releases a call that the trusted caller proved was never billable. */
export const release = internalMutation({
  args: { budgetId: v.string(), callId: v.string(), ...expectedStateValidator },
  handler: async (ctx, args) => {
    const call = await requireCall(ctx, args.budgetId, args.callId);
    const operationDigest = nodeSlideBillableCallReleaseDigest(args.budgetId, args.callId);
    const row = await requireBudget(ctx, args.budgetId);
    if (call.status === 'released') return replayTerminal(row, call, operationDigest);
    if (call.status !== 'reserved' && call.status !== 'unreconciled') {
      throw new NodeSlideBudgetLedgerError(
        'invalid_call_transition',
        'only held calls can release',
      );
    }
    const state = stateFromRow(row);
    assertOpenAndExpected(state, args.expectedRevision, args.expectedStateDigest);
    const source = call.status;
    const nextCost = releaseNodeSlideBudgetCost(
      costLedgerFromState(state),
      source,
      call.quoteMicroUsd,
    );
    const transition = advanceBudget(state, {
      kind: 'released',
      operationDigest,
      deltas: {
        actualDeltaMicroUsd: 0,
        reservedDeltaMicroUsd: source === 'reserved' ? -call.quoteMicroUsd : 0,
        unreconciledDeltaMicroUsd: source === 'unreconciled' ? -call.quoteMicroUsd : 0,
      },
      cost: nextCost,
    });
    const now = Date.now();
    await ctx.db.patch(call._id, {
      status: 'released',
      terminalOperationDigest: operationDigest,
      updatedAt: now,
      releasedAt: now,
    });
    await persistTransition(ctx, row, transition, now);
    return present(
      await requireBudget(ctx, args.budgetId),
      await requireCall(ctx, args.budgetId, args.callId),
    );
  },
});

export const finalize = internalMutation({
  args: { budgetId: v.string(), ...expectedStateValidator },
  handler: async (ctx, args) => {
    const row = await requireBudget(ctx, args.budgetId);
    const operationDigest = nodeSlideBudgetFinalizeDigest(args.budgetId);
    if (row.status === 'finalized') {
      if (row.finalizeDigest !== operationDigest) {
        throw new NodeSlideBudgetLedgerError(
          'budget_idempotency_conflict',
          'finalization digest differs',
        );
      }
      return present(row);
    }
    const state = stateFromRow(row);
    assertOpenAndExpected(state, args.expectedRevision, args.expectedStateDigest);
    await assertReconciledForFinalization(ctx, state);
    return await persistFinalization(ctx, row, state, operationDigest);
  },
});

/**
 * Trusted durable-job finalizer. The current canonical row is read and
 * finalized atomically, so job callers do not need to carry a stale-prone CAS
 * snapshot across their terminal transition.
 */
export const finalizeForJob = internalMutation({
  args: { budgetId: v.string() },
  handler: async (ctx, args) => {
    assertNodeSlideLedgerKey('budgetId', args.budgetId);
    const row = await requireBudget(ctx, args.budgetId);
    const state = stateFromRow(row);
    await assertReconciledForFinalization(ctx, state);
    const operationDigest = nodeSlideBudgetFinalizeDigest(args.budgetId);
    if (state.status === 'finalized') {
      if (state.finalizeDigest !== operationDigest) {
        throw new NodeSlideBudgetLedgerError(
          'budget_idempotency_conflict',
          'finalization digest differs',
        );
      }
      return present(row);
    }
    return await persistFinalization(ctx, row, state, operationDigest);
  },
});

/** Read-only recovery support for callers retrying an idempotent operation. */
export const replay = internalQuery({
  args: { budgetId: v.string(), callId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const budget = await findBudget(ctx, args.budgetId);
    if (!budget) return null;
    const call = args.callId ? await findCall(ctx, args.budgetId, args.callId) : null;
    return present(budget, call ?? undefined);
  },
});

const zeroCostDeltas = {
  actualDeltaMicroUsd: 0,
  reservedDeltaMicroUsd: 0,
  unreconciledDeltaMicroUsd: 0,
};

async function findBudget(
  ctx: MutationCtx | QueryCtx,
  budgetId: string,
): Promise<BudgetRow | null> {
  return await ctx.db
    .query('nodeslide_run_budgets')
    .withIndex('by_stable_id', (index) => index.eq('id', budgetId))
    .unique();
}

async function requireBudget(ctx: MutationCtx | QueryCtx, budgetId: string): Promise<BudgetRow> {
  const budget = await findBudget(ctx, budgetId);
  if (!budget) throw new NodeSlideBudgetLedgerError('budget_not_found', 'budget id does not exist');
  return budget;
}

async function findCall(
  ctx: MutationCtx | QueryCtx,
  budgetId: string,
  callId: string,
): Promise<CallRow | null> {
  return await ctx.db
    .query('nodeslide_billable_calls')
    .withIndex('by_budget_call', (index) => index.eq('budgetId', budgetId).eq('callId', callId))
    .unique();
}

async function requireCall(
  ctx: MutationCtx | QueryCtx,
  budgetId: string,
  callId: string,
): Promise<CallRow> {
  const call = await findCall(ctx, budgetId, callId);
  if (!call) throw new NodeSlideBudgetLedgerError('call_not_found', 'call id does not exist');
  return call;
}

function stateFromRow(row: BudgetRow): NodeSlideBudgetLedgerState {
  const state: NodeSlideBudgetLedgerState = {
    version: row.version,
    id: row.id,
    status: row.status,
    budget: row.budget,
    actualMicroUsd: row.actualMicroUsd,
    reservedMicroUsd: row.reservedMicroUsd,
    unreconciledMicroUsd: row.unreconciledMicroUsd,
    accumulated: row.accumulated,
    receiptDigests: row.receiptDigests,
    accountingStateDigest: row.accountingStateDigest,
    revision: row.revision,
    eventSequence: row.eventSequence,
    lastEventDigest: row.lastEventDigest,
    ...(row.finalizeDigest ? { finalizeDigest: row.finalizeDigest } : {}),
    stateDigest: row.stateDigest,
  };
  assertNodeSlideBudgetLedgerState(state);
  return state;
}

function initialBudgetState(id: string, budget: NodeSlideRunBudget): NodeSlideBudgetLedgerState {
  const accounting = {
    version: 'nodeslide.run-budget-state/v1' as const,
    budget,
    accumulated: {
      costMicroUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      elapsedMs: 0,
      iterations: 0,
      toolCalls: 0,
    },
    receiptDigests: {},
  };
  const accountingStateDigest = nodeSlideRunBudgetStateDigest(accounting);
  const core = {
    version: NODESLIDE_BUDGET_LEDGER_VERSION,
    id,
    status: 'open' as const,
    budget,
    actualMicroUsd: 0,
    reservedMicroUsd: 0,
    unreconciledMicroUsd: 0,
    accumulated: withoutCost(accounting.accumulated),
    receiptDigests: {},
    accountingStateDigest,
    revision: 0,
    eventSequence: 0,
    lastEventDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  };
  return { ...core, stateDigest: nodeSlideBudgetStateDigest(core) };
}

function assertOpenAndExpected(
  state: NodeSlideBudgetLedgerState,
  revision: number,
  digest: string,
): void {
  if (state.status !== 'open') {
    throw new NodeSlideBudgetLedgerError('budget_finalized', 'budget is finalized');
  }
  assertNodeSlideExpectedBudgetState(state, revision, digest);
}

async function assertReconciledForFinalization(
  ctx: MutationCtx,
  state: NodeSlideBudgetLedgerState,
): Promise<void> {
  if (state.reservedMicroUsd !== 0 || state.unreconciledMicroUsd !== 0) {
    unresolvedFinalization();
  }
  const reservedCall = await ctx.db
    .query('nodeslide_billable_calls')
    .withIndex('by_budget_status', (index) =>
      index.eq('budgetId', state.id).eq('status', 'reserved'),
    )
    .first();
  if (reservedCall) unresolvedFinalization();
  const unreconciledCall = await ctx.db
    .query('nodeslide_billable_calls')
    .withIndex('by_budget_status', (index) =>
      index.eq('budgetId', state.id).eq('status', 'unreconciled'),
    )
    .first();
  if (unreconciledCall) unresolvedFinalization();
}

function unresolvedFinalization(): never {
  throw new NodeSlideBudgetLedgerError(
    'invalid_call_transition',
    'cannot finalize while billable cost exposure is unresolved',
  );
}

async function persistFinalization(
  ctx: MutationCtx,
  row: BudgetRow,
  state: NodeSlideBudgetLedgerState,
  operationDigest: string,
) {
  const transition = advanceBudget(state, {
    kind: 'finalized',
    operationDigest,
    deltas: zeroCostDeltas,
    status: 'finalized',
    finalizeDigest: operationDigest,
  });
  const now = Date.now();
  await persistTransition(ctx, row, transition, now);
  return present(await requireBudget(ctx, row.id));
}

function assertUsageWithinBudget(
  budget: NodeSlideRunBudget,
  accumulated: {
    inputTokens: number;
    outputTokens: number;
    elapsedMs: number;
    iterations: number;
    toolCalls: number;
  },
): void {
  const limits = [
    ['inputTokens', accumulated.inputTokens, budget.maxInputTokens],
    ['outputTokens', accumulated.outputTokens, budget.maxOutputTokens],
    ['elapsedMs', accumulated.elapsedMs, budget.maxDurationMs],
    ['iterations', accumulated.iterations, budget.maxIterations],
    ['toolCalls', accumulated.toolCalls, budget.maxToolCalls],
  ] as const;
  for (const [field, used, cap] of limits) {
    if (used > cap) {
      throw new NodeSlideBudgetLedgerError('budget_exceeded', `${field} exceeds the hard budget`);
    }
  }
}

function withoutCost(accumulated: {
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
  iterations: number;
  toolCalls: number;
  costMicroUsd?: number;
}) {
  return {
    inputTokens: accumulated.inputTokens,
    outputTokens: accumulated.outputTokens,
    elapsedMs: accumulated.elapsedMs,
    iterations: accumulated.iterations,
    toolCalls: accumulated.toolCalls,
  };
}

function advanceBudget(
  previous: NodeSlideBudgetLedgerState,
  args: {
    kind: NodeSlideBudgetEventKind;
    operationDigest: string;
    deltas: {
      actualDeltaMicroUsd: number;
      reservedDeltaMicroUsd: number;
      unreconciledDeltaMicroUsd: number;
    };
    cost?: { actualMicroUsd: number; reservedMicroUsd: number; unreconciledMicroUsd: number };
    accumulated?: ReturnType<typeof withoutCost>;
    receiptDigests?: Readonly<Record<string, string>>;
    status?: 'open' | 'finalized';
    finalizeDigest?: string;
    previousEventDigest?: string | undefined;
  },
) {
  const cost = args.cost ?? costLedgerFromState(previous);
  const accumulated = args.accumulated ?? previous.accumulated;
  const receiptDigests = args.receiptDigests ?? previous.receiptDigests;
  const accounting = {
    version: 'nodeslide.run-budget-state/v1' as const,
    budget: previous.budget,
    accumulated: { costMicroUsd: cost.actualMicroUsd, ...accumulated },
    receiptDigests,
  };
  const core = {
    version: NODESLIDE_BUDGET_LEDGER_VERSION,
    id: previous.id,
    status: args.status ?? previous.status,
    budget: previous.budget,
    actualMicroUsd: cost.actualMicroUsd,
    reservedMicroUsd: cost.reservedMicroUsd,
    unreconciledMicroUsd: cost.unreconciledMicroUsd,
    accumulated,
    receiptDigests,
    accountingStateDigest: nodeSlideRunBudgetStateDigest(accounting),
    revision: previous.revision + 1,
    eventSequence: previous.eventSequence + 1,
    ...(args.finalizeDigest ? { finalizeDigest: args.finalizeDigest } : {}),
  };
  const coreDigest = nodeSlideBudgetStateCoreDigest({
    ...core,
    lastEventDigest: previous.lastEventDigest,
  });
  const event = {
    version: NODESLIDE_BUDGET_EVENT_VERSION,
    budgetId: previous.id,
    sequence: core.eventSequence,
    revision: core.revision,
    kind: args.kind,
    operationDigest: args.operationDigest,
    status: core.status,
    ...args.deltas,
    actualMicroUsd: core.actualMicroUsd,
    reservedMicroUsd: core.reservedMicroUsd,
    unreconciledMicroUsd: core.unreconciledMicroUsd,
    capMicroUsd: core.budget.maxCostMicroUsd,
    accountingStateDigest: core.accountingStateDigest,
    budgetStateCoreDigest: coreDigest,
    ...(args.previousEventDigest === undefined && args.kind === 'created'
      ? {}
      : { previousEventDigest: args.previousEventDigest ?? previous.lastEventDigest }),
  };
  const eventDigest = nodeSlideBudgetEventDigest(event);
  const state: NodeSlideBudgetLedgerState = {
    ...core,
    lastEventDigest: eventDigest,
    stateDigest: nodeSlideBudgetStateDigest({ ...core, lastEventDigest: eventDigest }),
  };
  assertNodeSlideBudgetLedgerState(state);
  return { state, event: { ...event, eventDigest } };
}

async function persistTransition(
  ctx: MutationCtx,
  row: BudgetRow,
  transition: ReturnType<typeof advanceBudget>,
  now: number,
) {
  await ctx.db.patch(row._id, {
    status: transition.state.status,
    actualMicroUsd: transition.state.actualMicroUsd,
    reservedMicroUsd: transition.state.reservedMicroUsd,
    unreconciledMicroUsd: transition.state.unreconciledMicroUsd,
    accumulated: transition.state.accumulated,
    receiptDigests: transition.state.receiptDigests,
    accountingStateDigest: transition.state.accountingStateDigest,
    revision: transition.state.revision,
    eventSequence: transition.state.eventSequence,
    lastEventDigest: transition.state.lastEventDigest,
    stateDigest: transition.state.stateDigest,
    ...(transition.state.finalizeDigest
      ? { finalizeDigest: transition.state.finalizeDigest, finalizedAt: now }
      : {}),
    updatedAt: now,
  });
  await insertEvent(ctx, row.id, transition, now);
}

async function insertEvent(
  ctx: MutationCtx,
  budgetId: string,
  transition: ReturnType<typeof advanceBudget>,
  now: number,
) {
  const event = transition.event;
  await ctx.db.insert('nodeslide_budget_events', { ...event, budgetId, createdAt: now });
}

function replayTerminal(row: BudgetRow, call: CallRow, operationDigest: string) {
  if (call.terminalOperationDigest !== operationDigest) {
    throw new NodeSlideBudgetLedgerError('call_idempotency_conflict', 'terminal operation differs');
  }
  return present(row, call);
}

function present(budget: BudgetRow, call?: CallRow) {
  return {
    budget: {
      id: budget.id,
      status: budget.status,
      revision: budget.revision,
      stateDigest: budget.stateDigest,
      actualMicroUsd: budget.actualMicroUsd,
      reservedMicroUsd: budget.reservedMicroUsd,
      unreconciledMicroUsd: budget.unreconciledMicroUsd,
    },
    ...(call
      ? {
          call: {
            callId: call.callId,
            status: call.status,
            quoteMicroUsd: call.quoteMicroUsd,
            providerSafeOutputTokenCeiling: call.providerSafeOutputTokenCeiling,
            providerTimeoutMs: call.providerTimeoutMs,
          },
        }
      : {}),
  };
}
