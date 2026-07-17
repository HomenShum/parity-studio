import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutationCtx } from './_generated/server';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import { nodeSlideJobOwnerDigest } from './lib/nodeslideJobState';
import { beginInternal, completeInternal, failInternal } from './nodeslideRoleStages';

const NOW = 100_000;
const OWNER_ACCESS_KEY = 'a'.repeat(43);

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

  withIndex(_name: string, configure: (index: MemoryIndex) => unknown): this {
    const index = new MemoryIndex();
    configure(index);
    this.filters = index.filters;
    return this;
  }

  async unique(): Promise<StoredRow | null> {
    const rows = this.evaluate();
    if (rows.length > 1) throw new Error('Memory query was not unique.');
    return rows[0] ?? null;
  }

  async first(): Promise<StoredRow | null> {
    return this.evaluate()[0] ?? null;
  }

  private evaluate(): StoredRow[] {
    return this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => row[filter.field] === filter.value))
      .sort((left, right) => left._creationTime - right._creationTime);
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }

  seed(tableName: string, value: Record<string, unknown>): StoredRow {
    this.sequence += 1;
    const row = {
      ...structuredClone(value),
      _id: `${tableName}:${this.sequence}`,
      _creationTime: this.sequence,
    };
    const rows = this.tables.get(tableName) ?? [];
    rows.push(row);
    this.tables.set(tableName, rows);
    return row;
  }

  async insert(tableName: string, value: Record<string, unknown>): Promise<string> {
    return this.seed(tableName, value)._id;
  }

  async patch(rowId: string, value: Record<string, unknown>): Promise<void> {
    const row = [...this.tables.values()].flat().find((candidate) => candidate._id === rowId);
    if (!row) throw new Error(`Memory row ${rowId} was not found.`);
    Object.assign(row, structuredClone(value));
  }

  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }
}

type BeginArgs = {
  jobId: string;
  deckId: string;
  ownerAccessKey: string;
  runId: string;
  role: 'analyst' | 'storyteller' | 'fact_checker';
  ordinal: number;
  parentStageId?: string;
  inputDigest: string;
  provider: string;
  model: string;
};

type Stage = StoredRow & {
  id: string;
  status: 'running' | 'completed' | 'fallback' | 'failed';
  attempt: number;
  leaseId: string;
  leaseExpiresAt: number;
  outputJson?: string;
  outputDigest?: string;
};

type BeginResult =
  | { state: 'acquired'; stage: Stage }
  | { state: 'terminal'; stage: Stage }
  | { state: 'in_flight'; stageId: string };

type CompleteArgs = {
  stageId: string;
  ownerAccessKey: string;
  leaseId: string;
  inputDigest: string;
  status: 'completed' | 'fallback';
  outputJson: string;
  outputDigest: string;
  callId?: string;
};

type FailArgs = {
  stageId: string;
  ownerAccessKey: string;
  leaseId: string;
  inputDigest: string;
  error: string;
};

type Handler<Args, Result> = (ctx: MutationCtx, args: Args) => Promise<Result>;

function handler<Args, Result>(registered: unknown): Handler<Args, Result> {
  const value = (registered as { _handler?: unknown })._handler;
  if (typeof value !== 'function') throw new Error('Registered Convex handler is unavailable.');
  return value as Handler<Args, Result>;
}

const beginHandler = handler<BeginArgs, BeginResult>(beginInternal);
const completeHandler = handler<CompleteArgs, Stage>(completeInternal);
const failHandler = handler<FailArgs, Stage>(failInternal);

class RoleStageHarness {
  readonly database = new MemoryDatabase();
  readonly context = { db: this.database } as unknown as MutationCtx;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.database.seed('nodeslide_decks', {
      id: 'deck-1',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    this.database.seed('nodeslide_agent_jobs', {
      id: 'job-1',
      kind: 'edit_proposal',
      ownerDigest: nodeSlideJobOwnerDigest(OWNER_ACCESS_KEY),
      status: 'running',
    });
  }

  begin(args: BeginArgs): Promise<BeginResult> {
    return this.mutate(() => beginHandler(this.context, args));
  }

  complete(args: CompleteArgs): Promise<Stage> {
    return this.mutate(() => completeHandler(this.context, args));
  }

  fail(args: FailArgs): Promise<Stage> {
    return this.mutate(() => failHandler(this.context, args));
  }

  private mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
    // Convex commits mutations serially and retries optimistic conflicts. Queueing
    // the in-memory handlers models the externally observable mutation contract.
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

describe('NodeSlide durable role stages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows only one acquisition when identical begins arrive concurrently', async () => {
    const harness = new RoleStageHarness();
    const args = beginArgs();

    const results = await Promise.all(Array.from({ length: 8 }, () => harness.begin(args)));

    expect(results.filter((result) => result.state === 'acquired')).toHaveLength(1);
    expect(results.filter((result) => result.state === 'in_flight')).toHaveLength(7);
    expect(harness.database.rows('nodeslide_role_stages')).toHaveLength(1);
    expect(harness.database.rows('nodeslide_role_stages')[0]).toMatchObject({
      attempt: 1,
      status: 'running',
    });
  });

  it('replays a terminal stage without reacquiring or duplicating it', async () => {
    const harness = new RoleStageHarness();
    const args = beginArgs();
    const acquired = requireStage(await harness.begin(args), 'acquired');
    const outputJson = JSON.stringify({ role: 'analyst', status: 'completed' });
    const completion = {
      stageId: acquired.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      leaseId: acquired.leaseId,
      inputDigest: args.inputDigest,
      status: 'completed' as const,
      outputJson,
      outputDigest: nodeslideContentDigest(outputJson),
    };

    await harness.complete(completion);
    await expect(harness.complete(completion)).resolves.toMatchObject({
      id: acquired.id,
      status: 'completed',
      outputJson,
    });
    const replay = await harness.begin(args);

    expect(replay.state).toBe('terminal');
    expect(requireStage(replay, 'terminal')).toMatchObject({
      id: acquired.id,
      status: 'completed',
      attempt: 1,
      outputJson,
    });
    expect(harness.database.rows('nodeslide_role_stages')).toHaveLength(1);
  });

  it('reports a non-expired stage as in flight without rotating its lease', async () => {
    const harness = new RoleStageHarness();
    const args = beginArgs();
    const acquired = requireStage(await harness.begin(args), 'acquired');

    vi.setSystemTime(acquired.leaseExpiresAt - 1);
    const replay = await harness.begin(args);

    expect(replay).toEqual({ state: 'in_flight', stageId: acquired.id });
    expect(harness.database.rows('nodeslide_role_stages')[0]).toMatchObject({
      attempt: 1,
      leaseId: acquired.leaseId,
      leaseExpiresAt: acquired.leaseExpiresAt,
    });
  });

  it('releases a failed lease so one immediate retry reacquires without duplicate work', async () => {
    const harness = new RoleStageHarness();
    const args = beginArgs();
    const first = requireStage(await harness.begin(args), 'acquired');

    const failed = await harness.fail({
      stageId: first.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      leaseId: first.leaseId,
      inputDigest: args.inputDigest,
      error: '  provider\nresponse could not be parsed  ',
    });
    expect(failed).toMatchObject({
      id: first.id,
      status: 'failed',
      attempt: 1,
      leaseId: first.leaseId,
      leaseExpiresAt: NOW,
      outputJson: JSON.stringify({ error: 'provider response could not be parsed' }),
    });
    expect(failed.outputDigest).toBe(nodeslideContentDigest(String(failed.outputJson)));

    const retries = await Promise.all([harness.begin(args), harness.begin(args)]);
    expect(retries.filter((result) => result.state === 'acquired')).toHaveLength(1);
    expect(retries.filter((result) => result.state === 'in_flight')).toHaveLength(1);
    const retry = requireStage(
      retries.find((result) => result.state === 'acquired') as BeginResult,
      'acquired',
    );
    expect(retry).toMatchObject({ id: first.id, status: 'running', attempt: 2 });
    expect(retry.leaseId).not.toBe(first.leaseId);
    expect(retry.outputJson).toBeUndefined();
    expect(retry.outputDigest).toBeUndefined();
    expect(harness.database.rows('nodeslide_role_stages')).toHaveLength(1);
  });

  it('does not let a stale failed attempt release a replacement lease', async () => {
    const harness = new RoleStageHarness();
    const args = beginArgs();
    const first = requireStage(await harness.begin(args), 'acquired');
    await harness.fail(failArgs(first, args, 'first attempt failed'));
    const retry = requireStage(await harness.begin(args), 'acquired');

    await expect(harness.fail(failArgs(first, args, 'late first-attempt error'))).rejects.toThrow(
      'Cognitive stage failure lease or input binding is stale.',
    );
    expect(harness.database.rows('nodeslide_role_stages')[0]).toMatchObject({
      status: 'running',
      attempt: 2,
      leaseId: retry.leaseId,
    });
  });

  it('preserves a completed stage when the caller observes a late exception', async () => {
    const harness = new RoleStageHarness();
    const args = beginArgs();
    const acquired = requireStage(await harness.begin(args), 'acquired');
    const outputJson = JSON.stringify({
      role: 'analyst',
      status: 'completed',
      summary: 'Bound result',
      details: [],
    });
    await harness.complete({
      stageId: acquired.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      leaseId: acquired.leaseId,
      inputDigest: args.inputDigest,
      status: 'completed',
      outputJson,
      outputDigest: nodeslideContentDigest(outputJson),
      callId: 'provider-call-1',
    });

    await expect(
      harness.fail(failArgs(acquired, args, 'completion acknowledgement was lost')),
    ).resolves.toMatchObject({ status: 'completed', callId: 'provider-call-1' });
    const replay = requireStage(await harness.begin(args), 'terminal');

    expect(replay).toMatchObject({
      status: 'completed',
      attempt: 1,
      outputJson,
      callId: 'provider-call-1',
    });
  });

  it('rejects a replay whose parent binding differs from the durable stage', async () => {
    const harness = new RoleStageHarness();
    const analyst = requireStage(await harness.begin(beginArgs()), 'acquired');
    const storytellerArgs = beginArgs({
      role: 'storyteller',
      ordinal: 3,
      parentStageId: analyst.id,
      inputDigest: nodeslideContentDigest('storyteller-input'),
    });
    const storyteller = requireStage(await harness.begin(storytellerArgs), 'acquired');

    await expect(
      harness.begin({ ...storytellerArgs, parentStageId: 'role_stage_forged-parent' }),
    ).rejects.toThrow('Cognitive stage idempotency binding conflict.');
    expect(harness.database.rows('nodeslide_role_stages')).toHaveLength(2);
    expect(harness.database.rows('nodeslide_role_stages')[1]).toMatchObject({
      id: storyteller.id,
      parentStageId: analyst.id,
      attempt: 1,
      leaseId: storyteller.leaseId,
    });
  });
});

function beginArgs(overrides: Partial<BeginArgs> = {}): BeginArgs {
  return {
    jobId: 'job-1',
    deckId: 'deck-1',
    ownerAccessKey: OWNER_ACCESS_KEY,
    runId: 'run-1',
    role: 'analyst',
    ordinal: 2,
    inputDigest: nodeslideContentDigest('analyst-input'),
    provider: 'openrouter',
    model: 'free-model',
    ...overrides,
  };
}

function requireStage(result: BeginResult, expectedState: 'acquired' | 'terminal'): Stage {
  if (result.state !== expectedState) {
    throw new Error(`Expected ${expectedState}, received ${result.state}.`);
  }
  return result.stage;
}

function failArgs(stage: Stage, args: BeginArgs, error: string): FailArgs {
  return {
    stageId: stage.id,
    ownerAccessKey: OWNER_ACCESS_KEY,
    leaseId: stage.leaseId,
    inputDigest: args.inputDigest,
    error,
  };
}
