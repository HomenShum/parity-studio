import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeSlideCapabilityDigestMetadata } from '../shared/nodeslideDurableSession';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
  NODESLIDE_DURABLE_SESSION_MAX_TRANSITIONS,
  NodeSlideSessionPersistenceError,
  appendJournal,
  applyCommand,
  create,
  get,
  getEvents,
  getJournal,
} from './nodeslideSessions';

const RAW_SECRET = 'secret-provider-capability-that-must-never-be-returned';
const RAW_CONSENT = 'raw-consent-token-that-must-never-be-returned';

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
  private direction: 'asc' | 'desc' = 'asc';

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

  order(direction: 'asc' | 'desc'): this {
    this.direction = direction;
    return this;
  }

  async unique(): Promise<StoredRow | null> {
    const rows = this.evaluate();
    if (rows.length > 1) throw new Error('Memory query was not unique.');
    return rows[0] ?? null;
  }

  async collect(): Promise<StoredRow[]> {
    return this.evaluate();
  }

  private evaluate(): StoredRow[] {
    const rows = this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => row[filter.field] === filter.value))
      .sort((left, right) => sortValue(left) - sortValue(right));
    return this.direction === 'asc' ? rows : rows.reverse();
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

  tamper(tableName: string, index: number, patch: Record<string, unknown>): void {
    const row = this.tables.get(tableName)?.[index];
    if (!row) throw new Error(`Memory ${tableName}[${index}] was not found.`);
    Object.assign(row, structuredClone(patch));
  }

  private find(rowId: string): { tableName: string; row: StoredRow } | undefined {
    for (const [tableName, rows] of this.tables) {
      const row = rows.find((candidate) => candidate._id === rowId);
      if (row) return { tableName, row };
    }
    return undefined;
  }
}

type Handler<Args, Result> = (ctx: MutationCtx, args: Args) => Promise<Result>;
type QueryHandler<Args, Result> = (ctx: QueryCtx, args: Args) => Promise<Result>;

const createHandler = (
  create as unknown as { _handler: Handler<Record<string, unknown>, SessionMutationResult> }
)._handler;
const commandHandler = (
  applyCommand as unknown as { _handler: Handler<Record<string, unknown>, SessionMutationResult> }
)._handler;
const appendJournalHandler = (
  appendJournal as unknown as { _handler: Handler<Record<string, unknown>, JournalMutationResult> }
)._handler;
const getHandler = (
  get as unknown as {
    _handler: QueryHandler<{ sessionId: string }, Record<string, unknown> | null>;
  }
)._handler;
const getEventsHandler = (
  getEvents as unknown as {
    _handler: QueryHandler<{ sessionId: string }, Array<Record<string, unknown>> | null>;
  }
)._handler;
const getJournalHandler = (
  getJournal as unknown as {
    _handler: QueryHandler<{ binding: JournalBinding }, Record<string, unknown> | null>;
  }
)._handler;

type SessionMutationResult = {
  replayed: boolean;
  appliedStateVersion?: number;
  session: {
    requestBinding: RequestBinding;
    stateVersion: number;
    egressEpoch: number;
    activeJobId: string | null;
    jobs: Array<Record<string, unknown>>;
  };
};

type JournalMutationResult = {
  replayed: boolean;
  journal: Record<string, unknown>;
};

type RequestBinding = {
  schemaVersion: 'nodeslide.request-binding/v2';
  requestDigest: string;
  capabilityDigest: string;
};

type JournalBinding = RequestBinding & {
  sessionId: string;
  jobId: string;
  egressEpoch: number;
  attempt: number;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NodeSlide durable session v2 persistence', () => {
  it('creates one digest-bound canonical row and never persists or presents raw material', async () => {
    const database = new MemoryDatabase();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const args = createArgs();

    const created = await createHandler(mutationContext(database), args);
    expect(created.replayed).toBe(false);
    expect(created.session).toMatchObject({ stateVersion: 0, egressEpoch: 0, jobs: [] });
    expect(database.rows('nodeslide_durable_sessions')).toHaveLength(1);
    expect(JSON.stringify(database.rows('nodeslide_durable_sessions'))).not.toContain(RAW_SECRET);
    expect(JSON.stringify(database.rows('nodeslide_durable_sessions'))).not.toContain(RAW_CONSENT);

    const replay = await createHandler(mutationContext(database), args);
    expect(replay.replayed).toBe(true);
    expect(database.rows('nodeslide_durable_sessions')).toHaveLength(1);
    await expect(
      createHandler(mutationContext(database), {
        ...args,
        request: { prompt: 'A different immutable request' },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'idempotency_conflict' }));

    const presented = await getHandler(queryContext(database), { sessionId: 'session-1' });
    expect(JSON.stringify(presented)).not.toContain(RAW_SECRET);
    expect(JSON.stringify(presented)).not.toContain(RAW_CONSENT);
  });

  it('enforces CAS and command idempotency before replaying immutable outcomes', async () => {
    const database = new MemoryDatabase();
    const binding = await createSession(database);
    const enqueue = command('enqueue', 0, binding, { jobId: 'job-1' });

    expect(await commandHandler(mutationContext(database), enqueue)).toMatchObject({
      replayed: false,
      appliedStateVersion: 1,
    });
    expect(await commandHandler(mutationContext(database), enqueue)).toMatchObject({
      replayed: true,
      appliedStateVersion: 1,
    });
    expect(database.rows('nodeslide_durable_session_events')).toHaveLength(1);

    await expect(
      commandHandler(mutationContext(database), command('stale', 0, binding, { jobId: 'job-2' })),
    ).rejects.toThrowError(expect.objectContaining({ code: 'state_version_mismatch' }));
    await expect(
      commandHandler(mutationContext(database), {
        ...enqueue,
        command: { ...enqueue.command, jobId: 'job-substituted' },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'idempotency_conflict' }));
    await expect(
      commandHandler(
        mutationContext(database),
        command(
          'binding-substitution',
          1,
          {
            ...binding,
            requestDigest: `sha256:${'f'.repeat(64)}`,
          },
          { jobId: 'job-2' },
        ),
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'request_binding_mismatch' }));
  });

  it('persists retry/resume/review lanes and fences journal writes by lease and epoch', async () => {
    const database = new MemoryDatabase();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const binding = await createSession(database);
    await commandHandler(
      mutationContext(database),
      command('enqueue', 0, binding, { jobId: 'job-1' }),
    );
    now.mockReturnValue(1_010);
    await commandHandler(
      mutationContext(database),
      command('claim', 1, binding, {
        type: 'claim',
        jobId: 'job-1',
        lease: lease('lease-1', 'worker-secret', 1_010, 2_000),
      }),
    );

    const journalBinding = bindJournal(binding, 0, 1);
    now.mockReturnValue(1_020);
    const model = journalArgs(journalBinding, 'lease-1', modelEntry('model-1'));
    expect(await appendJournalHandler(mutationContext(database), model)).toMatchObject({
      replayed: false,
    });
    expect(await appendJournalHandler(mutationContext(database), model)).toMatchObject({
      replayed: true,
    });
    await expect(
      appendJournalHandler(mutationContext(database), {
        ...model,
        journal: {
          ...model.journal,
          entry: { ...model.journal.entry, outputDigest: `sha256:${'9'.repeat(64)}` },
        },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'idempotency_conflict' }));
    await expect(
      appendJournalHandler(
        mutationContext(database),
        journalArgs(journalBinding, 'wrong-lease', modelEntry('model-2')),
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'lease_mismatch' }));

    await appendJournalHandler(
      mutationContext(database),
      journalArgs(journalBinding, 'lease-1', webEntry('web-1')),
    );
    now.mockReturnValue(1_030);
    await commandHandler(
      mutationContext(database),
      command('pause', 2, binding, {
        type: 'transition',
        jobId: 'job-1',
        toStatus: 'paused',
        leaseId: 'lease-1',
      }),
    );
    now.mockReturnValue(1_040);
    await commandHandler(
      mutationContext(database),
      command('resume', 3, binding, {
        type: 'resume',
        jobId: 'job-1',
        lease: lease('lease-2', 'worker-secret-2', 1_040, 3_000),
      }),
    );
    now.mockReturnValue(1_050);
    await commandHandler(
      mutationContext(database),
      command('fail', 4, binding, {
        type: 'transition',
        jobId: 'job-1',
        toStatus: 'failed',
        leaseId: 'lease-2',
        reason: RAW_SECRET,
      }),
    );
    await commandHandler(
      mutationContext(database),
      command('retry', 5, binding, { type: 'retry', jobId: 'job-1' }),
    );
    now.mockReturnValue(1_060);
    await commandHandler(
      mutationContext(database),
      command('claim-2', 6, binding, {
        type: 'claim',
        jobId: 'job-1',
        lease: lease('lease-3', 'worker-secret-3', 1_060, 4_000),
      }),
    );
    await commandHandler(
      mutationContext(database),
      command('review', 7, binding, {
        type: 'transition',
        jobId: 'job-1',
        toStatus: 'awaiting_review',
        leaseId: 'lease-3',
      }),
    );
    await commandHandler(
      mutationContext(database),
      command('accept', 8, binding, {
        type: 'transition',
        jobId: 'job-1',
        toStatus: 'succeeded',
      }),
    );

    const session = await getHandler(queryContext(database), { sessionId: 'session-1' });
    expect(session).toMatchObject({ stateVersion: 9, activeJobId: null });
    expect(JSON.stringify(session)).not.toContain('lease-');
    expect(JSON.stringify(session)).not.toContain('worker-secret');
    expect(JSON.stringify(session)).not.toContain(RAW_SECRET);
    const events = await getEventsHandler(queryContext(database), { sessionId: 'session-1' });
    expect(events).toHaveLength(9);
    expect(JSON.stringify(events)).not.toContain('lease-');
    expect(JSON.stringify(events)).not.toContain('worker-secret');
    expect(JSON.stringify(events)).not.toContain(RAW_SECRET);
    expect(
      database.writes.filter(
        (write) =>
          write.tableName === 'nodeslide_durable_session_events' && write.kind !== 'insert',
      ),
    ).toEqual([]);

    const journal = await getJournalHandler(queryContext(database), { binding: journalBinding });
    expect(journal).toMatchObject({ nextSequence: 3 });
    expect(JSON.stringify(journal)).not.toContain('lease-');
    expect(JSON.stringify(journal)).not.toContain('worker-secret');
  });

  it('rotates the egress epoch, stales the active job, and rejects the old writer', async () => {
    const database = new MemoryDatabase();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const binding = await createSession(database);
    await commandHandler(
      mutationContext(database),
      command('enqueue', 0, binding, { jobId: 'job-1' }),
    );
    await commandHandler(
      mutationContext(database),
      command('claim', 1, binding, {
        type: 'claim',
        jobId: 'job-1',
        lease: lease('lease-1', 'worker-1', 1_000, 2_000),
      }),
    );
    now.mockReturnValue(1_010);
    const rotated = await commandHandler(
      mutationContext(database),
      command('rotate', 2, binding, { type: 'rotate_egress', reason: RAW_CONSENT }),
    );
    expect(rotated.session).toMatchObject({ stateVersion: 3, egressEpoch: 1, activeJobId: null });
    expect(rotated.session.jobs[0]).toMatchObject({ status: 'stale', hasReason: true });
    expect(JSON.stringify(rotated.session)).not.toContain(RAW_CONSENT);

    await expect(
      appendJournalHandler(mutationContext(database), {
        ...journalArgs(bindJournal(binding, 0, 1), 'lease-1', modelEntry('late')),
        expectedStateVersion: 3,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'egress_epoch_mismatch' }));
  });

  it('detects append-only tampering and enforces the bounded transition journal', async () => {
    const tamperedDatabase = new MemoryDatabase();
    const binding = await createSession(tamperedDatabase);
    await commandHandler(
      mutationContext(tamperedDatabase),
      command('enqueue', 0, binding, { jobId: 'job-1' }),
    );
    tamperedDatabase.tamper('nodeslide_durable_session_events', 0, {
      transitionDigest: `sha256:${'0'.repeat(64)}`,
    });
    await expect(
      getHandler(queryContext(tamperedDatabase), { sessionId: 'session-1' }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'integrity_failure' }));

    const boundedDatabase = new MemoryDatabase();
    const boundedBinding = await createSession(boundedDatabase);
    for (let index = 0; index < NODESLIDE_DURABLE_SESSION_MAX_TRANSITIONS; index += 1) {
      await commandHandler(
        mutationContext(boundedDatabase),
        command(`rotate-${index}`, index, boundedBinding, { type: 'rotate_egress' }),
      );
    }
    await expect(
      commandHandler(
        mutationContext(boundedDatabase),
        command('overflow', NODESLIDE_DURABLE_SESSION_MAX_TRANSITIONS, boundedBinding, {
          type: 'rotate_egress',
        }),
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'transition_capacity_exceeded' }));
    expect(boundedDatabase.rows('nodeslide_durable_session_events')).toHaveLength(
      NODESLIDE_DURABLE_SESSION_MAX_TRANSITIONS,
    );
  });
});

function sortValue(row: StoredRow): number {
  const value = row.transitionSequence ?? row.sequence ?? row._creationTime;
  return typeof value === 'number' ? value : row._creationTime;
}

function mutationContext(database: MemoryDatabase): MutationCtx {
  return { db: database } as unknown as MutationCtx;
}

function queryContext(database: MemoryDatabase): QueryCtx {
  return { db: database } as unknown as QueryCtx;
}

function createArgs(): Record<string, unknown> {
  return {
    sessionId: 'session-1',
    request: { prompt: 'Build an investor deck', transient: RAW_SECRET },
    capability: createNodeSlideCapabilityDigestMetadata({
      provider: 'nebius',
      model: 'zai-org/GLM-5.2',
      scopes: ['model'],
      egress: 'model',
      secret: RAW_SECRET,
      consent: { token: RAW_CONSENT },
    }),
  };
}

async function createSession(database: MemoryDatabase): Promise<RequestBinding> {
  const created = await createHandler(mutationContext(database), createArgs());
  return created.session.requestBinding;
}

function command(
  commandId: string,
  expectedStateVersion: number,
  binding: RequestBinding,
  fields: Record<string, unknown>,
): Record<string, unknown> & { command: Record<string, unknown> } {
  return {
    sessionId: 'session-1',
    commandId,
    command: {
      type: fields.type ?? 'enqueue',
      expectedStateVersion,
      requestBinding: binding,
      ...fields,
    },
  };
}

function lease(leaseId: string, workerId: string, issuedAt: number, expiresAt: number) {
  return { leaseId, workerId, issuedAt, expiresAt };
}

function bindJournal(
  binding: RequestBinding,
  egressEpoch: number,
  attempt: number,
): JournalBinding {
  return {
    ...binding,
    sessionId: 'session-1',
    jobId: 'job-1',
    egressEpoch,
    attempt,
  };
}

function journalArgs(
  binding: JournalBinding,
  leaseId: string,
  journal: { kind: 'model' | 'web'; entry: Record<string, unknown> },
): Record<string, unknown> & {
  journal: {
    kind: 'model' | 'web';
    binding: JournalBinding;
    entry: Record<string, unknown>;
  };
} {
  return {
    sessionId: binding.sessionId,
    expectedStateVersion: 2,
    leaseId,
    journal: { ...journal, binding },
  };
}

function modelEntry(id: string) {
  return {
    kind: 'model' as const,
    entry: {
      id,
      provider: 'nebius',
      model: 'zai-org/GLM-5.2',
      operation: 'plan',
      inputDigest: `sha256:${'1'.repeat(64)}`,
      outputDigest: `sha256:${'2'.repeat(64)}`,
      inputTokens: 100,
      outputTokens: 40,
      createdAt: 1_020,
    },
  };
}

function webEntry(id: string) {
  return {
    kind: 'web' as const,
    entry: {
      id,
      provider: 'search',
      operation: 'search',
      queryDigest: `sha256:${'3'.repeat(64)}`,
      urlDigest: `sha256:${'4'.repeat(64)}`,
      resultDigest: `sha256:${'5'.repeat(64)}`,
      resultCount: 3,
      createdAt: 1_020,
    },
  };
}
