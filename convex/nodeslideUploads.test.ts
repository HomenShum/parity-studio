import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
  approveUpload,
  deleteUpload,
  getUploadMetadata,
  listUploadMetadata,
  materializeNodeSlideStoredText,
  prepareUpload,
  registerUpload,
  rejectUpload,
  requireApprovedUploadStorageId,
} from './nodeslideUploads';
import type { PreparedNodeSlideUpload } from './nodeslideUploads';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const OTHER_OWNER_ACCESS_KEY = 'b'.repeat(43);
const DECK_ID = 'deck_1';
const SESSION_ID = 'session:1';
const DIGEST = 'stored-sha256-digest';
const NOW = 1_752_000_000_000;

type StoredRow = Record<string, unknown> & { _id: string; _creationTime: number };
type StorageMetadata = {
  _id: Id<'_storage'>;
  _creationTime: number;
  sha256: string;
  size: number;
  contentType?: string;
};

class MemoryIndex {
  readonly filters: Array<{ field: string; value: unknown }> = [];

  eq(field: string, value: unknown): this {
    this.filters.push({ field, value });
    return this;
  }
}

class MemoryQuery {
  private filters: ReadonlyArray<{ field: string; value: unknown }> = [];
  private descending = false;

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

  order(direction: 'asc' | 'desc'): this {
    this.descending = direction === 'desc';
    return this;
  }

  async first(): Promise<StoredRow | null> {
    return this.matches()[0] ?? null;
  }

  async unique(): Promise<StoredRow | null> {
    const matches = this.matches();
    if (matches.length > 1) throw new Error(`Expected unique ${this.tableName} row.`);
    return matches[0] ?? null;
  }

  async take(limit: number): Promise<StoredRow[]> {
    return this.matches().slice(0, limit);
  }

  private matches(): StoredRow[] {
    const matches = this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every(({ field, value }) => row[field] === value));
    if (this.descending) {
      return matches.sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
    }
    return matches;
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private readonly storage = new Map<string, StorageMetadata>();
  private sequence = 0;

  readonly system: {
    get: (tableName: '_storage', storageId: Id<'_storage'>) => Promise<StorageMetadata | null>;
  };

  constructor() {
    this.system = {
      get: async (_tableName: '_storage', storageId: Id<'_storage'>) =>
        this.storage.get(storageId) ?? null,
    };
  }

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }

  async insert(tableName: string, value: object): Promise<string> {
    return this.seed(tableName, value)._id;
  }

  async patch(rowId: string, fields: object): Promise<void> {
    const row = this.rowById(rowId);
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) delete row[field];
      else row[field] = structuredClone(value);
    }
  }

  async delete(rowId: string): Promise<void> {
    for (const [tableName, rows] of this.tables) {
      const index = rows.findIndex((row) => row._id === rowId);
      if (index >= 0) {
        rows.splice(index, 1);
        this.tables.set(tableName, rows);
        return;
      }
    }
    throw new Error(`Missing row ${rowId}.`);
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

  seedStorage(
    storageId: Id<'_storage'>,
    metadata: Omit<StorageMetadata, '_id' | '_creationTime'>,
  ): void {
    this.storage.set(storageId, {
      _id: storageId,
      _creationTime: ++this.sequence,
      ...metadata,
    });
  }

  deleteStorage(storageId: Id<'_storage'>): void {
    this.storage.delete(storageId);
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

class MemoryStorage {
  private uploadSequence = 0;
  readonly deletes: Id<'_storage'>[] = [];

  constructor(private readonly database: MemoryDatabase) {}

  async generateUploadUrl(): Promise<string> {
    this.uploadSequence += 1;
    return `https://upload.example/${this.uploadSequence}`;
  }

  async delete(storageId: Id<'_storage'>): Promise<void> {
    this.deletes.push(storageId);
    this.database.deleteStorage(storageId);
  }
}

type RegisteredHandler<Args, Result, Ctx = MutationCtx> = (ctx: Ctx, args: Args) => Promise<Result>;

function registeredHandler<Args, Result, Ctx = MutationCtx>(
  value: unknown,
): RegisteredHandler<Args, Result, Ctx> {
  const handler = (value as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Registered Convex handler is unavailable.');
  return handler as RegisteredHandler<Args, Result, Ctx>;
}

type ScopeArgs = {
  deckId: string;
  ownerAccessKey: string;
  clientSessionId: string;
};

type PrepareArgs = ScopeArgs & {
  fileName: string;
  contentType: string;
  byteSize: number;
  contentDigest: string;
  idempotencyKey: string;
};

type RegisterArgs = ScopeArgs & {
  uploadId: string;
  storageId: Id<'_storage'>;
  idempotencyKey: string;
};

type UploadArgs = ScopeArgs & { uploadId: string };
type ApproveArgs = UploadArgs & { contentDigest: string };

const prepareHandler = registeredHandler<PrepareArgs, PreparedNodeSlideUpload>(prepareUpload);
const registerHandler = registeredHandler<RegisterArgs, unknown>(registerUpload);
const approveHandler = registeredHandler<ApproveArgs, unknown>(approveUpload);
const rejectHandler = registeredHandler<UploadArgs, unknown>(rejectUpload);
const deleteHandler = registeredHandler<UploadArgs, { deleted: true; uploadId: string }>(
  deleteUpload,
);
const getHandler = registeredHandler<UploadArgs, Record<string, unknown> | null, QueryCtx>(
  getUploadMetadata,
);
const listHandler = registeredHandler<
  ScopeArgs & { limit?: number },
  Record<string, unknown>[],
  QueryCtx
>(listUploadMetadata);

let database: MemoryDatabase;
let storage: MemoryStorage;

function mutationContext(): MutationCtx {
  return { db: database, storage } as unknown as MutationCtx;
}

function queryContext(): QueryCtx {
  return { db: database } as unknown as QueryCtx;
}

function scope(overrides: Partial<ScopeArgs> = {}): ScopeArgs {
  return {
    deckId: DECK_ID,
    ownerAccessKey: OWNER_ACCESS_KEY,
    clientSessionId: SESSION_ID,
    ...overrides,
  };
}

function prepareArgs(overrides: Partial<PrepareArgs> = {}): PrepareArgs {
  return {
    ...scope(),
    fileName: 'brief.pdf',
    contentType: 'application/pdf',
    byteSize: 1_024,
    contentDigest: DIGEST,
    idempotencyKey: 'request_1',
    ...overrides,
  };
}

function storageId(value: string): Id<'_storage'> {
  return value as Id<'_storage'>;
}

async function prepareAndRegister(id = storageId('storage_1')) {
  const prepared = await prepareHandler(mutationContext(), prepareArgs());
  database.seedStorage(id, {
    sha256: DIGEST,
    size: 1_024,
    contentType: 'application/pdf',
  });
  await registerHandler(mutationContext(), {
    ...scope(),
    uploadId: prepared.upload.id,
    storageId: id,
    idempotencyKey: 'request_1',
  });
  return prepared;
}

describe('NodeSlide two-phase uploads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    database = new MemoryDatabase();
    storage = new MemoryStorage(database);
    database.seed('nodeslide_decks', {
      id: DECK_ID,
      ownerAccessKey: OWNER_ACCESS_KEY,
      clientSessionId: SESSION_ID,
      version: 1,
    });
  });

  it('prepares a quarantined upload intent and returns a short-lived URL', async () => {
    const result = await prepareHandler(mutationContext(), prepareArgs());

    expect(result).toMatchObject({
      uploadUrl: 'https://upload.example/1',
      replayed: false,
      upload: {
        deckId: DECK_ID,
        clientSessionId: SESSION_ID,
        format: 'pdf',
        lifecycleStatus: 'awaiting_upload',
        securityStatus: 'pending',
        quarantineStatus: 'quarantined',
        modelAccessAllowed: false,
      },
    });
    expect(database.rows('nodeslide_uploads')).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('storageId');
  });

  it('requires both the owner capability and matching deck session', async () => {
    await expect(
      prepareHandler(mutationContext(), prepareArgs({ ownerAccessKey: OTHER_OWNER_ACCESS_KEY })),
    ).rejects.toThrow(/owner access denied/i);
    await expect(
      prepareHandler(mutationContext(), prepareArgs({ clientSessionId: 'session:other' })),
    ).rejects.toThrow(/session access denied/i);
    expect(database.rows('nodeslide_uploads')).toHaveLength(0);
  });

  it('replays one intent safely and rejects idempotency-key drift', async () => {
    const first = await prepareHandler(mutationContext(), prepareArgs());
    const replay = await prepareHandler(mutationContext(), prepareArgs());
    expect(replay.upload.id).toBe(first.upload.id);
    expect(replay.replayed).toBe(true);
    expect(replay.uploadUrl).toBe('https://upload.example/2');
    expect(database.rows('nodeslide_uploads')).toHaveLength(1);

    await expect(
      prepareHandler(mutationContext(), prepareArgs({ byteSize: 2_048 })),
    ).rejects.toThrow(/idempotency key/i);
  });

  it('verifies storage metadata and keeps a registered file quarantined', async () => {
    const prepared = await prepareHandler(mutationContext(), prepareArgs());
    const stored = storageId('storage_bad');
    database.seedStorage(stored, {
      sha256: DIGEST,
      size: 2_048,
      contentType: 'application/pdf',
    });
    await expect(
      registerHandler(mutationContext(), {
        ...scope(),
        uploadId: prepared.upload.id,
        storageId: stored,
        idempotencyKey: 'request_1',
      }),
    ).rejects.toThrow(/size/i);

    database.seedStorage(storageId('storage_good'), {
      sha256: DIGEST,
      size: 1_024,
      contentType: 'application/pdf',
    });
    const registered = (await registerHandler(mutationContext(), {
      ...scope(),
      uploadId: prepared.upload.id,
      storageId: storageId('storage_good'),
      idempotencyKey: 'request_1',
    })) as Record<string, unknown>;
    expect(registered).toMatchObject({
      lifecycleStatus: 'registered',
      securityStatus: 'pending',
      quarantineStatus: 'quarantined',
      modelAccessAllowed: false,
    });
  });

  it('denies model storage access until digest-bound approval releases quarantine', async () => {
    const prepared = await prepareAndRegister();
    await expect(
      requireApprovedUploadStorageId(queryContext(), {
        ...scope(),
        uploadId: prepared.upload.id,
      }),
    ).rejects.toThrow(/not approved/i);
    await expect(
      approveHandler(mutationContext(), {
        ...scope(),
        uploadId: prepared.upload.id,
        contentDigest: 'wrong-digest',
      }),
    ).rejects.toThrow(/digest/i);

    const approved = (await approveHandler(mutationContext(), {
      ...scope(),
      uploadId: prepared.upload.id,
      contentDigest: DIGEST,
    })) as Record<string, unknown>;
    expect(approved).toMatchObject({
      lifecycleStatus: 'registered',
      securityStatus: 'approved',
      quarantineStatus: 'released',
      modelAccessAllowed: true,
    });
    await expect(
      requireApprovedUploadStorageId(queryContext(), {
        ...scope(),
        uploadId: prepared.upload.id,
      }),
    ).resolves.toBe(storageId('storage_1'));
  });

  it('keeps owner metadata bounded and free of raw storage locators', async () => {
    const prepared = await prepareAndRegister();
    const metadata = await getHandler(queryContext(), {
      ...scope(),
      uploadId: prepared.upload.id,
    });
    const listed = await listHandler(queryContext(), { ...scope(), limit: 1_000 });
    expect(metadata).not.toHaveProperty('storageId');
    expect(metadata).not.toHaveProperty('idempotencyKey');
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('storageId');
  });

  it('supports explicit rejection without releasing raw model access', async () => {
    const prepared = await prepareAndRegister();
    const rejected = (await rejectHandler(mutationContext(), {
      ...scope(),
      uploadId: prepared.upload.id,
    })) as Record<string, unknown>;
    expect(rejected).toMatchObject({
      securityStatus: 'rejected',
      quarantineStatus: 'quarantined',
      modelAccessAllowed: false,
    });
    await expect(
      requireApprovedUploadStorageId(queryContext(), {
        ...scope(),
        uploadId: prepared.upload.id,
      }),
    ).rejects.toThrow(/not approved/i);
  });

  it('deletes both storage and metadata and treats retry as success', async () => {
    const prepared = await prepareAndRegister();
    const args = { ...scope(), uploadId: prepared.upload.id };
    await expect(deleteHandler(mutationContext(), args)).resolves.toEqual({
      deleted: true,
      uploadId: prepared.upload.id,
    });
    expect(storage.deletes).toEqual([storageId('storage_1')]);
    expect(database.rows('nodeslide_uploads')).toHaveLength(0);
    await expect(deleteHandler(mutationContext(), args)).resolves.toEqual({
      deleted: true,
      uploadId: prepared.upload.id,
    });
    expect(storage.deletes).toHaveLength(1);
  });
});

describe('NodeSlide stored text materialization', () => {
  it('preserves full data shape while bounding the model-readable preview', () => {
    const content = [
      'label,value',
      ...Array.from({ length: 1_000 }, (_, index) => `Row ${index},${index}`),
    ].join('\n');
    const result = materializeNodeSlideStoredText(new TextEncoder().encode(content), 'csv');

    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.preview).byteLength).toBeLessThanOrEqual(7_200);
    expect(result.rowCount).toBe(1_000);
    expect(result.columns).toEqual(['label', 'value']);
  });

  it('rejects malformed JSON before it can become agent context', () => {
    expect(() =>
      materializeNodeSlideStoredText(new TextEncoder().encode('{"unsafe":'), 'json'),
    ).toThrow('Stored JSON is malformed.');
  });

  it('materializes Markdown as bounded note text', () => {
    const result = materializeNodeSlideStoredText(
      new TextEncoder().encode('# Launch plan\n\n- Ship the evidence rail'),
      'md',
    );
    expect(result).toMatchObject({
      preview: '# Launch plan\n\n- Ship the evidence rail',
      truncated: false,
      rowCount: 2,
    });
  });
});
