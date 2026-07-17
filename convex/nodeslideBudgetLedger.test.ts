import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
  normalizeNodeSlideRunBudget,
} from '../shared/nodeslideRunBudget';
import type { MutationCtx } from './_generated/server';
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
import {
  captureTimeout,
  create,
  finalize,
  finalizeForJob,
  release,
  reserve,
} from './nodeslideBudgets';

type BudgetMutationResult = {
  budget: {
    id: string;
    status: 'open' | 'finalized';
    revision: number;
    stateDigest: string;
    actualMicroUsd: number;
    reservedMicroUsd: number;
    unreconciledMicroUsd: number;
  };
  call?: {
    callId: string;
    status: 'reserved' | 'unreconciled' | 'settled' | 'released';
    quoteMicroUsd: number;
  };
};

type BudgetMutationHandler = (
  ctx: MutationCtx,
  args: Record<string, unknown>,
) => Promise<BudgetMutationResult>;

const createHandler = budgetMutationHandler(create);
const reserveHandler = budgetMutationHandler(reserve);
const captureTimeoutHandler = budgetMutationHandler(captureTimeout);
const releaseHandler = budgetMutationHandler(release);
const finalizeHandler = budgetMutationHandler(finalize);
const finalizeForJobHandler = budgetMutationHandler(finalizeForJob);

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

describe('NodeSlide trusted job budget finalization', () => {
  it('does not fabricate a missing budget', async () => {
    const database = new MemoryDatabase();

    await expect(
      finalizeForJobHandler(mutationContext(database), { budgetId: 'missing-budget' }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'budget_not_found' }));
    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_run_budgets')).toEqual([]);
    expect(database.rows('nodeslide_budget_events')).toEqual([]);
  });

  it('refuses active reservations and finalizes with conservative unreconciled exposure', async () => {
    const database = new MemoryDatabase();
    const ctx = mutationContext(database);
    const budgetId = 'budget-job-finalize';
    const created = await createHandler(ctx, { budgetId, budget: { maxCostUsd: 1 } });
    const reserved = await reserveHandler(ctx, {
      budgetId,
      callId: 'provider-call-1',
      model: 'nebius/zai-org/GLM-5.2',
      estimatedInputTokens: 100,
      requestedMaxOutputTokens: 100,
      ...expectedState(created),
    });
    expect(reserved.budget.reservedMicroUsd).toBeGreaterThan(0);

    const reservedWrites = database.writes.length;
    await expect(finalizeForJobHandler(ctx, { budgetId })).rejects.toThrowError(
      expect.objectContaining({ code: 'invalid_call_transition' }),
    );
    expect(database.writes).toHaveLength(reservedWrites);

    const unreconciled = await captureTimeoutHandler(ctx, {
      budgetId,
      callId: 'provider-call-1',
      ...expectedState(reserved),
    });
    expect(unreconciled.budget).toMatchObject({
      reservedMicroUsd: 0,
      unreconciledMicroUsd: reserved.budget.reservedMicroUsd,
    });
    const finalized = await finalizeForJobHandler(ctx, { budgetId });
    expect(finalized.budget).toMatchObject({
      status: 'finalized',
      revision: unreconciled.budget.revision + 1,
      actualMicroUsd: unreconciled.budget.actualMicroUsd,
      reservedMicroUsd: 0,
      unreconciledMicroUsd: unreconciled.budget.unreconciledMicroUsd,
    });
    expect(database.rows('nodeslide_budget_events').at(-1)).toMatchObject({
      budgetId,
      kind: 'finalized',
      revision: finalized.budget.revision,
    });

    const writesAfterFinalization = database.writes.length;
    const eventsAfterFinalization = database.rows('nodeslide_budget_events').length;
    await expect(finalizeForJobHandler(ctx, { budgetId })).resolves.toEqual(finalized);
    expect(database.writes).toHaveLength(writesAfterFinalization);
    expect(database.rows('nodeslide_budget_events')).toHaveLength(eventsAfterFinalization);
  });

  it('treats a zero-cost held call as unresolved usage exposure', async () => {
    const database = new MemoryDatabase();
    const ctx = mutationContext(database);
    const budgetId = 'budget-job-zero-cost';
    const created = await createHandler(ctx, { budgetId, budget: { maxCostUsd: 1 } });
    const reserved = await reserveHandler(ctx, {
      budgetId,
      callId: 'zero-cost-call',
      model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
      estimatedInputTokens: 100,
      requestedMaxOutputTokens: 100,
      ...expectedState(created),
    });
    expect(reserved).toMatchObject({
      budget: { reservedMicroUsd: 0, unreconciledMicroUsd: 0 },
      call: { status: 'reserved', quoteMicroUsd: 0 },
    });
    await expect(finalizeForJobHandler(ctx, { budgetId })).rejects.toThrowError(
      expect.objectContaining({ code: 'invalid_call_transition' }),
    );

    const unreconciled = await captureTimeoutHandler(ctx, {
      budgetId,
      callId: 'zero-cost-call',
      ...expectedState(reserved),
    });
    expect(unreconciled).toMatchObject({
      budget: { reservedMicroUsd: 0, unreconciledMicroUsd: 0 },
      call: { status: 'unreconciled', quoteMicroUsd: 0 },
    });
    const finalized = await finalizeForJobHandler(ctx, { budgetId });
    expect(finalized.budget).toMatchObject({
      status: 'finalized',
      reservedMicroUsd: 0,
      unreconciledMicroUsd: 0,
    });
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

type StoredRow = Record<string, unknown> & { _id: string; _creationTime: number };
type Filter = { field: string; value: unknown };

class MemoryIndex {
  readonly filters: Filter[] = [];

  eq(field: string, value: unknown): this {
    this.filters.push({ field, value });
    return this;
  }
}

class MemoryQuery {
  private filters: readonly Filter[] = [];

  constructor(
    private readonly database: MemoryDatabase,
    private readonly tableName: string,
  ) {}

  withIndex(_indexName: string, configure: (index: MemoryIndex) => unknown): this {
    const index = new MemoryIndex();
    configure(index);
    this.filters = index.filters;
    return this;
  }

  async first(): Promise<StoredRow | null> {
    return this.evaluate()[0] ?? null;
  }

  async unique(): Promise<StoredRow | null> {
    const rows = this.evaluate();
    if (rows.length > 1) throw new Error('Memory query was not unique.');
    return rows[0] ?? null;
  }

  private evaluate(): StoredRow[] {
    return this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => row[filter.field] === filter.value));
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;
  readonly writes: Array<{ kind: 'insert' | 'patch'; tableName: string; rowId: string }> = [];

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }

  async insert(tableName: string, value: Record<string, unknown>): Promise<string> {
    this.sequence += 1;
    const row = {
      ...structuredClone(value),
      _id: `${tableName}:${this.sequence}`,
      _creationTime: this.sequence,
    };
    const rows = this.tables.get(tableName) ?? [];
    rows.push(row);
    this.tables.set(tableName, rows);
    this.writes.push({ kind: 'insert', tableName, rowId: row._id });
    return row._id;
  }

  async patch(rowId: string, value: Record<string, unknown>): Promise<void> {
    const located = this.find(rowId);
    if (!located) throw new Error(`Memory row ${rowId} was not found.`);
    Object.assign(located.row, structuredClone(value));
    this.writes.push({ kind: 'patch', tableName: located.tableName, rowId });
  }

  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }

  private find(rowId: string): { tableName: string; row: StoredRow } | undefined {
    for (const [tableName, rows] of this.tables) {
      const row = rows.find((candidate) => candidate._id === rowId);
      if (row) return { tableName, row };
    }
    return undefined;
  }
}

function budgetMutationHandler(value: unknown): BudgetMutationHandler {
  const handler = (value as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Expected a Convex mutation handler.');
  return handler as BudgetMutationHandler;
}

function mutationContext(database: MemoryDatabase): MutationCtx {
  return { db: database } as unknown as MutationCtx;
}

function expectedState(result: BudgetMutationResult) {
  return {
    expectedRevision: result.budget.revision,
    expectedStateDigest: result.budget.stateDigest,
  };
}
