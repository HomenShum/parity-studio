import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MutationCtx } from '../_generated/server';
import { deleteDeck } from '../nodeslide';
import {
  NODESLIDE_DECK_ERASURE_MAX_BYTES,
  NODESLIDE_DECK_ERASURE_MAX_RECORDS,
  NODESLIDE_DECK_ERASURE_TABLES,
} from './nodeslideDeckDeletion';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const OTHER_ACCESS_KEY = 'b'.repeat(43);

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

  async collect(): Promise<StoredRow[]> {
    this.database.collectCalls.push(this.tableName);
    return this.evaluate();
  }

  async take(count: number): Promise<StoredRow[]> {
    this.database.takeCalls.push({ tableName: this.tableName, count });
    return this.evaluate().slice(0, count);
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
  readonly collectCalls: string[] = [];
  readonly takeCalls: Array<{ tableName: string; count: number }> = [];
  readonly writes: Array<{ kind: 'delete'; tableName: string; rowId: string }> = [];
  readonly storageDeletes: string[] = [];

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }

  async get(rowId: string): Promise<StoredRow | null> {
    return this.find(rowId)?.row ?? null;
  }

  async delete(rowId: string): Promise<void> {
    const located = this.find(rowId);
    if (!located) throw new Error(`Memory row ${rowId} was not found.`);
    located.rows.splice(located.index, 1);
    this.writes.push({ kind: 'delete', tableName: located.tableName, rowId });
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

  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }

  private find(
    rowId: string,
  ): { tableName: string; rows: StoredRow[]; row: StoredRow; index: number } | undefined {
    for (const [tableName, rows] of this.tables) {
      const index = rows.findIndex((row) => row._id === rowId);
      const row = rows[index];
      if (row) return { tableName, rows, row, index };
    }
    return undefined;
  }
}

type DeleteDeckHandler = (
  ctx: MutationCtx,
  args: { deckId: string; ownerAccessKey: string },
) => Promise<{ deleted: true; deckId: string; deletedRecords: number }>;

const deleteDeckHandler = (deleteDeck as unknown as { _handler: DeleteDeckHandler })._handler;

function seedDeck(
  database: MemoryDatabase,
  options: {
    deckId: string;
    clientSessionId: string;
    ownerAccessKey: string;
    projectDomain?: 'nodeslide' | 'parity';
  },
) {
  const project = database.seed('projects', {
    clientSessionId: options.clientSessionId,
    domain: options.projectDomain ?? 'nodeslide',
    title: `${options.deckId} project`,
  });
  const deck = database.seed('nodeslide_decks', {
    id: options.deckId,
    projectId: `${options.deckId}:tenant`,
    projectRowId: project._id,
    clientSessionId: options.clientSessionId,
    ownerAccessKey: options.ownerAccessKey,
  });
  return { deck, project };
}

function mutationContext(database: MemoryDatabase): MutationCtx {
  return {
    db: database,
    storage: {
      delete: async (storageId: string) => {
        database.storageDeletes.push(storageId);
      },
    },
  } as unknown as MutationCtx;
}

describe('deleteDeck', () => {
  it('keeps the deletion manifest exhaustive for every deck-bound schema table', () => {
    const schema = readFileSync(new URL('../schema.ts', import.meta.url), 'utf8');
    const starts = [...schema.matchAll(/^ {2}(nodeslide_[a-z_]+): defineTable/gm)];
    const deckBoundTables = starts
      .filter((match, index) => {
        const start = match.index;
        const end = starts[index + 1]?.index ?? schema.length;
        const definition = schema.slice(start, end);
        return (
          /\bdeckId:\s*v\.string\(\)/.test(definition) ||
          /\.index\([^\n]+\['deckId'/.test(definition)
        );
      })
      .map((match) => match[1]);
    const expected = [
      ...deckBoundTables,
      'nodeslide_scoped_memories',
      'nodeslide_signature_profiles',
      'nodeslide_taste_profiles',
    ].sort();

    expect([...NODESLIDE_DECK_ERASURE_TABLES].sort()).toEqual(expected);
    expect(NODESLIDE_DECK_ERASURE_TABLES).toEqual(
      expect.arrayContaining(['nodeslide_claim_evidence_receipts', 'nodeslide_source_revisions']),
    );
    expect(NODESLIDE_DECK_ERASURE_TABLES.indexOf('nodeslide_claim_evidence_receipts')).toBeLessThan(
      NODESLIDE_DECK_ERASURE_TABLES.indexOf('nodeslide_source_revisions'),
    );
  });

  it('denies a wrong owner capability before reading or deleting child data', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, {
      deckId: 'deck:private',
      clientSessionId: 'session:private',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });

    await expect(
      deleteDeckHandler(mutationContext(database), {
        deckId: 'deck:private',
        ownerAccessKey: OTHER_ACCESS_KEY,
      }),
    ).rejects.toThrow('NodeSlide owner access denied.');

    expect(database.writes).toEqual([]);
    expect(database.collectCalls).toEqual([]);
    expect(database.takeCalls).toEqual([]);
  });

  it('fails closed without writes when the linked project cannot be verified', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, {
      deckId: 'deck:private',
      clientSessionId: 'session:private',
      ownerAccessKey: OWNER_ACCESS_KEY,
      projectDomain: 'parity',
    });

    await expect(
      deleteDeckHandler(mutationContext(database), {
        deckId: 'deck:private',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow('failed closed');

    expect(database.writes).toEqual([]);
  });

  it('fails closed without writes when a non-NodeSlide run shares the project', async () => {
    const database = new MemoryDatabase();
    const { project } = seedDeck(database, {
      deckId: 'deck:private',
      clientSessionId: 'session:private',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    database.seed('runs', { projectId: project._id, status: 'completed' });
    database.seed('nodeslide_sources', { id: 'source:private', deckId: 'deck:private' });

    await expect(
      deleteDeckHandler(mutationContext(database), {
        deckId: 'deck:private',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow('linked runs');

    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_sources')).toHaveLength(1);
  });

  it('fails closed before profile erasure when the data tenant is shared by another deck', async () => {
    const database = new MemoryDatabase();
    const target = seedDeck(database, {
      deckId: 'deck:private',
      clientSessionId: 'session:private',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const other = seedDeck(database, {
      deckId: 'deck:other',
      clientSessionId: 'session:other',
      ownerAccessKey: OTHER_ACCESS_KEY,
    });
    other.deck.projectId = target.deck.projectId;
    database.seed('nodeslide_signature_profiles', {
      id: 'profile:shared',
      tenantId: target.deck.projectId,
    });

    await expect(
      deleteDeckHandler(mutationContext(database), {
        deckId: 'deck:private',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow('data tenant binding is ambiguous');

    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_signature_profiles')).toHaveLength(1);
  });

  it('deletes every deck-scoped row plus its deck and project while preserving other data', async () => {
    const database = new MemoryDatabase();
    const target = seedDeck(database, {
      deckId: 'deck:target',
      clientSessionId: 'session:target',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const other = seedDeck(database, {
      deckId: 'deck:other',
      clientSessionId: 'session:other',
      ownerAccessKey: OTHER_ACCESS_KEY,
    });
    for (const tableName of NODESLIDE_DECK_ERASURE_TABLES) {
      const key =
        tableName === 'nodeslide_signature_profiles' || tableName === 'nodeslide_taste_profiles'
          ? 'tenantId'
          : tableName === 'nodeslide_scoped_memories'
            ? 'scopeKey'
            : 'deckId';
      database.seed(tableName, {
        id: `${tableName}:target`,
        [key]:
          key === 'tenantId'
            ? 'deck:target:tenant'
            : key === 'scopeKey'
              ? 'nodeslide.scoped-memory%2Fv1/workspace/session%3Atarget/project/deck%3Atarget%3Atenant/deck/deck%3Atarget'
              : 'deck:target',
        ...(tableName === 'nodeslide_scoped_memories'
          ? {
              schemaVersion: 'nodeslide.scoped-memory/v1',
              scopeKind: 'deck',
              workspaceId: 'session:target',
              projectId: 'deck:target:tenant',
              deckId: 'deck:target',
            }
          : {}),
        ...(tableName === 'nodeslide_evidence_steps'
          ? { screenshotStorageId: 'storage:target' }
          : tableName === 'nodeslide_uploads'
            ? { storageId: 'storage:upload-target' }
            : {}),
      });
      database.seed(tableName, {
        id: `${tableName}:other`,
        [key]:
          key === 'tenantId'
            ? 'deck:other:tenant'
            : key === 'scopeKey'
              ? 'nodeslide.scoped-memory%2Fv1/workspace/session%3Aother/project/deck%3Aother%3Atenant/deck/deck%3Aother'
              : 'deck:other',
        ...(tableName === 'nodeslide_scoped_memories'
          ? {
              schemaVersion: 'nodeslide.scoped-memory/v1',
              scopeKind: 'deck',
              workspaceId: 'session:other',
              projectId: 'deck:other:tenant',
              deckId: 'deck:other',
            }
          : {}),
        ...(tableName === 'nodeslide_evidence_steps'
          ? { screenshotStorageId: 'storage:other' }
          : tableName === 'nodeslide_uploads'
            ? { storageId: 'storage:upload-other' }
            : {}),
      });
    }

    const result = await deleteDeckHandler(mutationContext(database), {
      deckId: 'deck:target',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });

    expect(result).toEqual({
      deleted: true,
      deckId: 'deck:target',
      deletedRecords: NODESLIDE_DECK_ERASURE_TABLES.length + 2,
    });
    expect(new Set(database.takeCalls.map((call) => call.tableName))).toEqual(
      new Set(['nodeslide_decks', 'runs', ...NODESLIDE_DECK_ERASURE_TABLES]),
    );
    for (const tableName of NODESLIDE_DECK_ERASURE_TABLES) {
      const key =
        tableName === 'nodeslide_signature_profiles' || tableName === 'nodeslide_taste_profiles'
          ? 'tenantId'
          : tableName === 'nodeslide_scoped_memories'
            ? 'scopeKey'
            : 'deckId';
      expect(database.rows(tableName).map((row) => row[key])).toEqual([
        key === 'tenantId'
          ? 'deck:other:tenant'
          : key === 'scopeKey'
            ? 'nodeslide.scoped-memory%2Fv1/workspace/session%3Aother/project/deck%3Aother%3Atenant/deck/deck%3Aother'
            : 'deck:other',
      ]);
    }
    expect(database.rows('nodeslide_decks')).toEqual([other.deck]);
    expect(database.rows('projects')).toEqual([other.project]);
    expect(database.rows('nodeslide_decks')).not.toContain(target.deck);
    expect(database.rows('projects')).not.toContain(target.project);
    expect(database.storageDeletes).toEqual(['storage:upload-target', 'storage:target']);
  });

  it('erases exact deck-scoped memories without deleting shared workspace or project memories', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, {
      deckId: 'deck:memory',
      clientSessionId: 'workspace:shared',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const deckScopeKey = [
      'nodeslide.scoped-memory/v1',
      'workspace',
      'workspace:shared',
      'project',
      'deck:memory:tenant',
      'deck',
      'deck:memory',
    ]
      .map(encodeURIComponent)
      .join('/');
    database.seed('nodeslide_scoped_memories', {
      id: 'memory:deck',
      schemaVersion: 'nodeslide.scoped-memory/v1',
      scopeKind: 'deck',
      scopeKey: deckScopeKey,
      workspaceId: 'workspace:shared',
      projectId: 'deck:memory:tenant',
      deckId: 'deck:memory',
    });
    database.seed('nodeslide_scoped_memories', {
      id: 'memory:workspace',
      schemaVersion: 'nodeslide.scoped-memory/v1',
      scopeKind: 'workspace',
      scopeKey: 'nodeslide.scoped-memory%2Fv1/workspace/workspace%3Ashared',
      workspaceId: 'workspace:shared',
    });
    database.seed('nodeslide_scoped_memories', {
      id: 'memory:project',
      schemaVersion: 'nodeslide.scoped-memory/v1',
      scopeKind: 'project',
      scopeKey:
        'nodeslide.scoped-memory%2Fv1/workspace/workspace%3Ashared/project/deck%3Amemory%3Atenant',
      workspaceId: 'workspace:shared',
      projectId: 'deck:memory:tenant',
    });

    const result = await deleteDeckHandler(mutationContext(database), {
      deckId: 'deck:memory',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });

    expect(result.deletedRecords).toBe(3);
    expect(database.rows('nodeslide_scoped_memories').map((row) => row.id)).toEqual([
      'memory:workspace',
      'memory:project',
    ]);
  });

  it('rejects an oversized record set before the first write', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, {
      deckId: 'deck:large',
      clientSessionId: 'session:large',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    for (let index = 0; index < NODESLIDE_DECK_ERASURE_MAX_RECORDS - 1; index += 1) {
      database.seed('nodeslide_slides', {
        id: `slide:${index}`,
        deckId: 'deck:large',
      });
    }

    await expect(
      deleteDeckHandler(mutationContext(database), {
        deckId: 'deck:large',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(`atomic limit of ${NODESLIDE_DECK_ERASURE_MAX_RECORDS} records`);

    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_decks')).toHaveLength(1);
    expect(database.rows('nodeslide_slides')).toHaveLength(NODESLIDE_DECK_ERASURE_MAX_RECORDS - 1);
  });

  it('rejects an oversized byte set before the first write', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, {
      deckId: 'deck:heavy',
      clientSessionId: 'session:heavy',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const payload = 'x'.repeat(Math.ceil(NODESLIDE_DECK_ERASURE_MAX_BYTES / 5));
    for (let index = 0; index < 5; index += 1) {
      database.seed('nodeslide_sources', {
        id: `source:${index}`,
        deckId: 'deck:heavy',
        payload,
      });
    }

    await expect(
      deleteDeckHandler(mutationContext(database), {
        deckId: 'deck:heavy',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(`atomic limit of ${NODESLIDE_DECK_ERASURE_MAX_BYTES} bytes`);

    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_decks')).toHaveLength(1);
    expect(database.rows('nodeslide_sources')).toHaveLength(5);
  });
});
