import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutationCtx } from '../_generated/server';
import {
  NODESLIDE_SYNC_LIMITS,
  createConnection,
  disconnectConnection,
  getConnection,
  updateConnection,
} from '../nodeslideSync';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const OTHER_OWNER_ACCESS_KEY = 'b'.repeat(43);
const NOW = 1_750_000_000_000;

type StoredRow = Record<string, unknown> & { _id: string; _creationTime: number };
type Write = { kind: 'insert' | 'patch'; tableName: string; value: object };

class MemoryIndex {
  readonly filters: Array<{ field: string; value: unknown }> = [];

  eq(field: string, value: unknown): this {
    this.filters.push({ field, value });
    return this;
  }
}

class MemoryQuery {
  private filters: ReadonlyArray<{ field: string; value: unknown }> = [];

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
    return this.matches()[0] ?? null;
  }

  async unique(): Promise<StoredRow | null> {
    const rows = this.matches();
    if (rows.length > 1) throw new Error(`Expected unique ${this.tableName} row.`);
    return rows[0] ?? null;
  }

  private matches(): StoredRow[] {
    return this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every(({ field, value }) => row[field] === value));
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;
  readonly writes: Write[] = [];

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }

  async insert(tableName: string, value: object): Promise<string> {
    const row = this.seed(tableName, value);
    this.writes.push({ kind: 'insert', tableName, value: structuredClone(value) });
    return row._id;
  }

  async patch(rowId: string, fields: object): Promise<void> {
    const row = this.rowById(rowId);
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) delete row[field];
      else row[field] = structuredClone(value);
    }
    this.writes.push({ kind: 'patch', tableName: rowId.split(':')[0] ?? '', value: fields });
  }

  seed(tableName: string, value: object): StoredRow {
    this.sequence += 1;
    const row = {
      ...structuredClone(value),
      _id: `${tableName}:${this.sequence}`,
      _creationTime: this.sequence,
    } as StoredRow;
    const rows = this.tables.get(tableName) ?? [];
    rows.push(row);
    this.tables.set(tableName, rows);
    return row;
  }

  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }

  private rowById(rowId: string): StoredRow {
    for (const rows of this.tables.values()) {
      const row = rows.find((candidate) => candidate._id === rowId);
      if (row) return row;
    }
    throw new Error(`Missing row ${rowId}.`);
  }
}

type RegisteredHandler<Args, Result> = (ctx: MutationCtx, args: Args) => Promise<Result>;

function registeredHandler<Args, Result>(value: unknown): RegisteredHandler<Args, Result> {
  const handler = (value as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Registered Convex handler is unavailable.');
  return handler as RegisteredHandler<Args, Result>;
}

type ObjectLink = {
  kind: 'deck' | 'slide' | 'element';
  localId: string;
  remoteId: string;
  semanticFingerprint: string;
  localSlideId?: string;
  remoteSlideId?: string;
};

type CreateArgs = {
  deckId: string;
  ownerAccessKey: string;
  provider: 'google_slides';
  remotePresentationId: string;
  remoteRevision: string;
  lastSyncedDeckVersion: number;
  objectMapping: ObjectLink[];
  idempotencyKey: string;
};

type UpdateArgs = {
  deckId: string;
  ownerAccessKey: string;
  provider: 'google_slides';
  expectedConnectionVersion: number;
  idempotencyKey: string;
  update:
    | { kind: 'set_status'; status: 'syncing' | 'conflict' | 'error' }
    | {
        kind: 'sync_succeeded';
        remoteRevision: string;
        lastSyncedDeckVersion: number;
        objectMapping: ObjectLink[];
      };
};

type DisconnectArgs = Omit<UpdateArgs, 'update'>;
type ReadArgs = Pick<CreateArgs, 'deckId' | 'ownerAccessKey' | 'provider'>;
type Connection = {
  id: string;
  deckId: string;
  provider: 'google_slides';
  remotePresentationId: string;
  remoteRevision: string;
  lastSyncedDeckVersion: number;
  objectMapping: ObjectLink[];
  status: string;
  connectionVersion: number;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number;
  disconnectedAt?: number;
};

const createHandler = registeredHandler<CreateArgs, Connection>(createConnection);
const readHandler = registeredHandler<ReadArgs, Connection | null>(getConnection);
const updateHandler = registeredHandler<UpdateArgs, Connection>(updateConnection);
const disconnectHandler = registeredHandler<DisconnectArgs, Connection>(disconnectConnection);

describe('NodeSlide durable presentation sync server', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => vi.useRealTimers());

  it('creates and owner-reads a normalized Google Slides connection without exposing write guards', async () => {
    const database = databaseFixture();
    const context = { db: database } as unknown as MutationCtx;
    const args = createArgs();

    const created = await createHandler(context, args);
    const stored = onlyConnection(database);

    expect(created).toMatchObject({
      deckId: args.deckId,
      provider: 'google_slides',
      remotePresentationId: args.remotePresentationId,
      remoteRevision: args.remoteRevision,
      lastSyncedDeckVersion: 3,
      status: 'active',
      connectionVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
      lastSyncedAt: NOW,
    });
    expect(created.objectMapping.map((link) => link.kind)).toEqual(['deck', 'slide', 'element']);
    expect(created).not.toHaveProperty('lastMutationKey');
    expect(created).not.toHaveProperty('lastMutationFingerprint');
    expect(stored).not.toHaveProperty('ownerAccessKey');
    expect(stored).not.toHaveProperty('accessToken');
    expect(stored).not.toHaveProperty('refreshToken');
    expect(stored).not.toHaveProperty('credentials');
    expect(await readHandler(context, ownerReadArgs())).toEqual(created);

    const writesBeforeDeniedRead = database.writes.length;
    await expect(
      readHandler(context, { ...ownerReadArgs(), ownerAccessKey: OTHER_OWNER_ACCESS_KEY }),
    ).rejects.toThrow('owner access denied');
    expect(database.writes).toHaveLength(writesBeforeDeniedRead);
  });

  it('deduplicates exact create retries and rejects idempotency-key payload substitution', async () => {
    const database = databaseFixture();
    const context = { db: database } as unknown as MutationCtx;
    const args = createArgs();
    const first = await createHandler(context, args);
    const retry = await createHandler(context, {
      ...args,
      objectMapping: [...args.objectMapping].reverse(),
    });

    expect(retry).toEqual(first);
    expect(database.writes).toHaveLength(1);
    await expect(
      createHandler(context, { ...args, remoteRevision: 'different-revision' }),
    ).rejects.toThrow(/idempotency key.*different sync operation/i);
    await expect(
      createHandler(context, { ...args, idempotencyKey: 'create-different-request' }),
    ).rejects.toThrow(/already exists/i);
    expect(database.writes).toHaveLength(1);
  });

  it('uses CAS for status and baseline updates while preserving opaque revisions', async () => {
    const database = databaseFixture(5);
    const context = { db: database } as unknown as MutationCtx;
    await createHandler(context, createArgs());

    const statusArgs: UpdateArgs = {
      ...ownerReadArgs(),
      expectedConnectionVersion: 1,
      idempotencyKey: 'status-syncing-1',
      update: { kind: 'set_status', status: 'syncing' },
    };
    const syncing = await updateHandler(context, statusArgs);
    expect(syncing).toMatchObject({ status: 'syncing', connectionVersion: 2 });
    expect(await updateHandler(context, statusArgs)).toEqual(syncing);
    expect(database.writes).toHaveLength(2);
    await expect(
      updateHandler(context, {
        ...statusArgs,
        update: { kind: 'set_status', status: 'error' },
      }),
    ).rejects.toThrow(/idempotency key.*different sync operation/i);
    await expect(
      updateHandler(context, { ...statusArgs, idempotencyKey: 'stale-status' }),
    ).rejects.toThrow(/stale.*expected version 1.*current version is 2/i);

    vi.setSystemTime(NOW + 1_000);
    const opaqueRevision = 'opaque revision /+== α';
    const succeededArgs: UpdateArgs = {
      ...ownerReadArgs(),
      expectedConnectionVersion: 2,
      idempotencyKey: 'sync-success-1',
      update: {
        kind: 'sync_succeeded',
        remoteRevision: opaqueRevision,
        lastSyncedDeckVersion: 4,
        objectMapping: mappingFixture(),
      },
    };
    const synced = await updateHandler(context, succeededArgs);
    expect(synced).toMatchObject({
      status: 'active',
      remoteRevision: opaqueRevision,
      lastSyncedDeckVersion: 4,
      connectionVersion: 3,
      updatedAt: NOW + 1_000,
      lastSyncedAt: NOW + 1_000,
    });
    expect(onlyConnection(database).remoteRevision).toBe(opaqueRevision);
    await expect(
      updateHandler(context, {
        ...succeededArgs,
        expectedConnectionVersion: 3,
        idempotencyKey: 'sync-regression',
        update: {
          kind: 'sync_succeeded',
          remoteRevision: opaqueRevision,
          lastSyncedDeckVersion: 2,
          objectMapping: mappingFixture(),
        },
      }),
    ).rejects.toThrow(/cannot move backwards/i);
  });

  it('disconnects durably with retry safety and allows only the owner to reconnect', async () => {
    const database = databaseFixture();
    const context = { db: database } as unknown as MutationCtx;
    await createHandler(context, createArgs());
    const disconnectArgs: DisconnectArgs = {
      ...ownerReadArgs(),
      expectedConnectionVersion: 1,
      idempotencyKey: 'disconnect-1',
    };

    await expect(
      disconnectHandler(context, {
        ...disconnectArgs,
        ownerAccessKey: OTHER_OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/owner access denied/i);
    expect(database.writes).toHaveLength(1);
    const disconnected = await disconnectHandler(context, disconnectArgs);
    expect(disconnected).toMatchObject({
      status: 'disconnected',
      connectionVersion: 2,
      disconnectedAt: NOW,
    });
    expect(await disconnectHandler(context, disconnectArgs)).toEqual(disconnected);
    expect(database.writes).toHaveLength(2);
    await expect(
      updateHandler(context, {
        ...ownerReadArgs(),
        expectedConnectionVersion: 2,
        idempotencyKey: 'update-after-disconnect',
        update: { kind: 'set_status', status: 'syncing' },
      }),
    ).rejects.toThrow(/disconnected/i);

    vi.setSystemTime(NOW + 2_000);
    const reconnected = await createHandler(context, {
      ...createArgs(),
      idempotencyKey: 'reconnect-1',
      remoteRevision: 'reconnect-revision',
    });
    expect(reconnected).toMatchObject({
      status: 'active',
      connectionVersion: 3,
      remoteRevision: 'reconnect-revision',
      updatedAt: NOW + 2_000,
    });
    expect(reconnected).not.toHaveProperty('disconnectedAt');
  });

  it('bounds and structurally validates stable mappings before any connection write', async () => {
    const database = databaseFixture();
    const context = { db: database } as unknown as MutationCtx;
    const oversized = [
      mappingFixture()[1] as ObjectLink,
      ...Array.from({ length: NODESLIDE_SYNC_LIMITS.mappingLinks }, (_, index) => ({
        kind: 'slide' as const,
        localId: `slide-${index}`,
        remoteId: `remote-slide-${index}`,
        semanticFingerprint: `sync-semantic/v1:${index.toString(36)}`,
      })),
    ];
    await expect(
      createHandler(context, { ...createArgs(), objectMapping: oversized }),
    ).rejects.toThrow(/must contain 1-2048 links/i);
    await expect(
      createHandler(context, {
        ...createArgs(),
        objectMapping: mappingFixture().map((link, index) =>
          index === 0 ? { ...link, semanticFingerprint: 'unversioned-fingerprint' } : link,
        ),
      }),
    ).rejects.toThrow(/sync-semantic\/v1 format/i);
    await expect(
      createHandler(context, {
        ...createArgs(),
        objectMapping: mappingFixture().map((link) =>
          link.kind === 'element' ? { ...link, localSlideId: undefined } : link,
        ),
      }),
    ).rejects.toThrow(/element local slide ID/i);
    expect(database.writes).toEqual([]);
  });
});

describe('NodeSlide sync public security contract', () => {
  it('accepts only owner capability plus non-secret sync metadata', () => {
    expect(publicArgNames(createConnection)).toEqual([
      'deckId',
      'ownerAccessKey',
      'provider',
      'remotePresentationId',
      'remoteRevision',
      'lastSyncedDeckVersion',
      'objectMapping',
      'idempotencyKey',
    ]);
    expect(publicArgNames(updateConnection)).toEqual([
      'deckId',
      'ownerAccessKey',
      'provider',
      'expectedConnectionVersion',
      'idempotencyKey',
      'update',
    ]);
    expect(publicArgNames(disconnectConnection)).toEqual([
      'deckId',
      'ownerAccessKey',
      'provider',
      'expectedConnectionVersion',
      'idempotencyKey',
    ]);
    for (const endpoint of [
      createConnection,
      getConnection,
      updateConnection,
      disconnectConnection,
    ]) {
      expect(publicArgNames(endpoint).join(' ')).not.toMatch(
        /accessToken|refreshToken|credential|clientSecret/i,
      );
    }
  });

  it("does not allow one deck owner to claim another deck's remote presentation", async () => {
    const database = databaseFixture();
    seedDeck(database, 'deck-other', OTHER_OWNER_ACCESS_KEY, 3);
    const context = { db: database } as unknown as MutationCtx;
    await createHandler(context, createArgs());

    await expect(
      createHandler(context, {
        ...createArgs(),
        deckId: 'deck-other',
        ownerAccessKey: OTHER_OWNER_ACCESS_KEY,
        objectMapping: mappingFixture('deck-other'),
        idempotencyKey: 'other-deck-create',
      }),
    ).rejects.toThrow('NodeSlide sync connection unavailable');
    expect(database.rows('nodeslide_sync_connections')).toHaveLength(1);
  });
});

function databaseFixture(deckVersion = 3): MemoryDatabase {
  const database = new MemoryDatabase();
  seedDeck(database, 'deck-1', OWNER_ACCESS_KEY, deckVersion);
  return database;
}

function seedDeck(
  database: MemoryDatabase,
  deckId: string,
  ownerAccessKey: string,
  version: number,
): void {
  database.seed('nodeslide_decks', { id: deckId, ownerAccessKey, version });
}

function ownerReadArgs(): ReadArgs {
  return { deckId: 'deck-1', ownerAccessKey: OWNER_ACCESS_KEY, provider: 'google_slides' };
}

function createArgs(): CreateArgs {
  return {
    ...ownerReadArgs(),
    remotePresentationId: 'presentation-1',
    remoteRevision: 'opaque-revision-1',
    lastSyncedDeckVersion: 3,
    objectMapping: mappingFixture(),
    idempotencyKey: 'create-connection-1',
  };
}

function mappingFixture(deckId = 'deck-1'): ObjectLink[] {
  return [
    {
      kind: 'element',
      localId: 'element-1',
      remoteId: 'remote-element-1',
      localSlideId: 'slide-1',
      remoteSlideId: 'remote-slide-1',
      semanticFingerprint: 'sync-semantic/v1:element1',
    },
    {
      kind: 'slide',
      localId: 'slide-1',
      remoteId: 'remote-slide-1',
      semanticFingerprint: 'sync-semantic/v1:slide1',
    },
    {
      kind: 'deck',
      localId: deckId,
      remoteId: 'presentation-1',
      semanticFingerprint: 'sync-semantic/v1:deck1',
    },
  ];
}

function onlyConnection(database: MemoryDatabase): StoredRow {
  const rows = database.rows('nodeslide_sync_connections');
  if (rows.length !== 1 || !rows[0])
    throw new Error(`Expected one connection; got ${rows.length}.`);
  return rows[0];
}

function publicArgNames(value: unknown): string[] {
  const exportArgs = (value as { exportArgs?: () => string }).exportArgs;
  if (!exportArgs) throw new Error('Registered Convex argument validator is unavailable.');
  const exported = JSON.parse(exportArgs()) as { value?: Record<string, unknown> };
  return Object.keys(exported.value ?? {});
}
