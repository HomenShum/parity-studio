import { describe, expect, it } from 'vitest';
import type { NodeSlideOwnerDataExport } from '../../shared/nodeslideDataExport';
import type { QueryCtx } from '../_generated/server';
import { exportMyData } from '../nodeslideDataExport';
import { nodeslideContentDigest } from './nodeslideIds';
import { nodeSlideJobOwnerDigest } from './nodeslideJobState';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const OTHER_ACCESS_KEY = 'b'.repeat(43);
const SHARE_CAPABILITY = 'share-1234567890abcdef1234567890abcdef1234';

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

  async take(count: number): Promise<StoredRow[]> {
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
  readonly queryCalls: string[] = [];

  query(tableName: string): MemoryQuery {
    this.queryCalls.push(tableName);
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

  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }
}

type ExportMyDataHandler = (
  ctx: QueryCtx,
  args: { deckId: string; ownerAccessKey: string },
) => Promise<NodeSlideOwnerDataExport>;

const exportMyDataHandler = (exportMyData as unknown as { _handler: ExportMyDataHandler })._handler;

function queryContext(database: MemoryDatabase): QueryCtx {
  return { db: database } as unknown as QueryCtx;
}

function seedDeck(
  database: MemoryDatabase,
  {
    deckId,
    ownerAccessKey,
    title = 'Owner deck',
    shareSlug,
    spec = { brief: 'Owner brief' },
  }: {
    deckId: string;
    ownerAccessKey: string;
    title?: string;
    shareSlug?: string;
    spec?: unknown;
  },
) {
  return database.seed('nodeslide_decks', {
    id: deckId,
    ownerAccessKey,
    title,
    version: 7,
    shareSlug,
    spec,
    createdAt: 1,
    updatedAt: 2,
  });
}

function seedOwnerActivity(database: MemoryDatabase, deckId: string) {
  database.seed('nodeslide_agent_jobs', {
    id: 'job:owner',
    kind: 'edit_proposal',
    resultDeckId: deckId,
    ownerDigest: nodeSlideJobOwnerDigest(OWNER_ACCESS_KEY),
    executionDigest: 'execution-private',
    admissionQuotaSubject: 'quota-private',
    idempotencyKey: 'job-private-key',
    streamId: 'stream-private',
    workflowId: 'workflow-private',
    error: `Never echo ${OWNER_ACCESS_KEY}`,
    createdAt: 40,
    updatedAt: 41,
  });
  database.seed('nodeslide_agent_runs', {
    id: 'run:owner',
    deckId,
    ownerDigest: `actor_${nodeslideContentDigest(OWNER_ACCESS_KEY)}`,
    idempotencyKey: 'run-private-key',
    instruction: 'Owner instruction',
    createdAt: 42,
    updatedAt: 43,
  });
}

describe('NodeSlide owner data export', () => {
  it('denies a wrong owner capability before reading child collections', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, { deckId: 'deck:private', ownerAccessKey: OWNER_ACCESS_KEY });
    database.seed('nodeslide_sources', {
      id: 'source:private',
      deckId: 'deck:private',
      citation: 'private evidence',
    });

    await expect(
      exportMyDataHandler(queryContext(database), {
        deckId: 'deck:private',
        ownerAccessKey: OTHER_ACCESS_KEY,
      }),
    ).rejects.toThrow('NodeSlide owner access denied.');

    expect(database.queryCalls).toEqual(['nodeslide_decks']);
  });

  it('exports only rows indexed to the authorized deck', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, { deckId: 'deck:owner', ownerAccessKey: OWNER_ACCESS_KEY });
    seedDeck(database, { deckId: 'deck:other', ownerAccessKey: OTHER_ACCESS_KEY });
    database.seed('nodeslide_sources', {
      id: 'source:owner',
      deckId: 'deck:owner',
      citation: 'owner-only evidence',
    });
    database.seed('nodeslide_sources', {
      id: 'source:other',
      deckId: 'deck:other',
      citation: 'foreign-owner evidence',
    });
    database.seed('nodeslide_comments', {
      id: 'comment:owner',
      deckId: 'deck:owner',
      text: 'owner-only comment',
      createdAt: 10,
    });
    database.seed('nodeslide_comments', {
      id: 'comment:other',
      deckId: 'deck:other',
      text: 'foreign-owner comment',
      createdAt: 11,
    });
    seedOwnerActivity(database, 'deck:owner');
    database.seed('nodeslide_agent_runs', {
      id: 'run:other',
      deckId: 'deck:other',
      ownerDigest: `actor_${nodeslideContentDigest(OTHER_ACCESS_KEY)}`,
      instruction: 'foreign-owner run',
      createdAt: 50,
    });

    const bundle = await exportMyDataHandler(queryContext(database), {
      deckId: 'deck:owner',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const serialized = JSON.stringify(bundle);

    expect(bundle.manifest.scope).toEqual({
      kind: 'deck_owner_capability',
      deckId: 'deck:owner',
      deckVersion: 7,
    });
    expect(bundle.data.sources).toHaveLength(1);
    expect(bundle.data.comments).toHaveLength(1);
    expect(bundle.data.activity.jobs).toHaveLength(1);
    expect(bundle.data.activity.runs).toHaveLength(1);
    expect(serialized).toContain('owner-only evidence');
    expect(serialized).not.toContain('foreign-owner');
  });

  it('redacts capabilities and embedded secrets while returning a complete manifest', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, {
      deckId: 'deck:redacted',
      ownerAccessKey: OWNER_ACCESS_KEY,
      shareSlug: SHARE_CAPABILITY,
      spec: {
        brief: `Published at ${SHARE_CAPABILITY}`,
        apiKey: 'sk-provider-secret-value',
        nested: { password: 'database-password' },
      },
    });
    database.seed('nodeslide_slides', {
      id: 'slide:one',
      deckId: 'deck:redacted',
      title: 'Opening',
    });
    database.seed('nodeslide_elements', {
      id: 'element:one',
      deckId: 'deck:redacted',
      slideId: 'slide:one',
      content: 'No secret',
    });
    database.seed('nodeslide_patches', {
      id: 'patch:one',
      deckId: 'deck:redacted',
      summary: 'Owner proposal',
      createdAt: 20,
    });
    database.seed('nodeslide_versions', {
      id: 'version:one',
      deckId: 'deck:redacted',
      version: 6,
      snapshot: {
        deck: { id: 'deck:redacted', shareSlug: SHARE_CAPABILITY },
        slides: [{ id: 'slide:one', deckId: 'deck:redacted' }],
        elements: [{ id: 'element:one', slideId: 'slide:one' }],
        sources: [{ id: 'source:one', deckId: 'deck:redacted' }],
      },
      createdAt: 21,
    });
    database.seed('nodeslide_sources', {
      id: 'source:one',
      deckId: 'deck:redacted',
      url: 'https://example.test/data?access_token=url-secret-value&X-Amz-Signature=signed-url-secret',
      citation: 'Authorization: Bearer bearer-secret-value; client_secret=embedded-secret-value',
    });
    database.seed('nodeslide_agent_memories', {
      id: 'memory:one',
      deckId: 'deck:redacted',
      content: 'Remember the owner preference.',
      updatedAt: 30,
    });
    database.seed('nodeslide_traces', {
      id: 'trace:one',
      deckId: 'deck:redacted',
      summary: `Trace input ${OWNER_ACCESS_KEY}`,
      createdAt: 31,
    });
    database.seed('nodeslide_execution_traces', {
      id: 'execution:one',
      deckId: 'deck:redacted',
      summary: 'Durable execution trace',
      createdAt: 32,
    });
    database.seed('nodeslide_comments', {
      id: 'comment:one',
      deckId: 'deck:redacted',
      text: 'Review this claim.',
      createdAt: 33,
    });
    seedOwnerActivity(database, 'deck:redacted');

    const bundle = await exportMyDataHandler(queryContext(database), {
      deckId: 'deck:redacted',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const serialized = JSON.stringify(bundle);

    expect(bundle.manifest.schemaVersion).toBe('nodeslide.owner-data-export/v1');
    expect(bundle.manifest.completeness).toMatchObject({ status: 'complete', truncated: false });
    expect(bundle.manifest.mutationPolicy).toBe('read_only_no_cas_or_proposal_state_changes');
    expect(bundle.manifest.redaction.removedFieldCount).toBeGreaterThan(0);
    expect(bundle.manifest.redaction.redactedValueCount).toBeGreaterThan(0);
    expect(bundle.manifest.redaction.excludedCollections).toEqual(
      expect.arrayContaining([
        { name: 'nodeslide_oauth_credentials', reason: 'authentication_material' },
        { name: 'nodeslide_presence', reason: 'ephemeral_runtime_state' },
      ]),
    );
    expect(bundle.data.deckSpec.deck).not.toHaveProperty('ownerAccessKey');
    expect(bundle.data.deckSpec.deck).not.toHaveProperty('shareSlug');
    expect(bundle.data.activity.jobs[0]).not.toHaveProperty('ownerDigest');
    expect(bundle.data.activity.jobs[0]).not.toHaveProperty('executionDigest');
    expect(bundle.data.activity.runs[0]).not.toHaveProperty('idempotencyKey');
    for (const secret of [
      OWNER_ACCESS_KEY,
      SHARE_CAPABILITY,
      'provider-secret-value',
      'database-password',
      'url-secret-value',
      'signed-url-secret',
      'bearer-secret-value',
      'embedded-secret-value',
      'job-private-key',
      'run-private-key',
      'stream-private',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('[REDACTED]');
    expect(bundle.data.versions).toHaveLength(1);
    expect(bundle.data.proposals.patches).toHaveLength(1);
    expect(bundle.data.sources).toHaveLength(1);
    expect(bundle.data.memories).toHaveLength(1);
    expect(bundle.data.activity.traces).toHaveLength(1);
    expect(bundle.data.activity.executionTraces).toHaveLength(1);
    expect(bundle.data.comments).toHaveLength(1);
  });

  it('fails closed when a linked job belongs to another owner capability', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, { deckId: 'deck:owner', ownerAccessKey: OWNER_ACCESS_KEY });
    database.seed('nodeslide_agent_jobs', {
      id: 'job:foreign',
      resultDeckId: 'deck:owner',
      ownerDigest: nodeSlideJobOwnerDigest(OTHER_ACCESS_KEY),
      createdAt: 1,
    });

    await expect(
      exportMyDataHandler(queryContext(database), {
        deckId: 'deck:owner',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow('failed closed: durable job ownership is inconsistent');
  });

  it('fails closed when a version snapshot embeds another deck', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, { deckId: 'deck:owner', ownerAccessKey: OWNER_ACCESS_KEY });
    database.seed('nodeslide_versions', {
      id: 'version:foreign',
      deckId: 'deck:owner',
      version: 1,
      snapshot: {
        deck: { id: 'deck:other' },
        slides: [],
        elements: [],
        sources: [],
      },
      createdAt: 1,
    });

    await expect(
      exportMyDataHandler(queryContext(database), {
        deckId: 'deck:owner',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow('failed closed: a version snapshot crossed the authorized deck boundary');
  });
});
