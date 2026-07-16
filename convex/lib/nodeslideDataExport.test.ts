import { describe, expect, it } from 'vitest';
import type { NodeSlideOwnerDataExport } from '../../shared/nodeslideDataExport';
import type { QueryCtx } from '../_generated/server';
import { exportMyData } from '../nodeslideDataExport';
import { nodeslideContentDigest, nodeslideStableId } from './nodeslideIds';
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

function seedOwnerActivity(database: MemoryDatabase, deckId: string, budgetId?: string) {
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
    requestDigest: 'sha256:owner-request',
    ...(budgetId ? { budgetId } : {}),
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

    expect(bundle.manifest.schemaVersion).toBe('nodeslide.owner-data-export/v2');
    expect(bundle.manifest.completeness).toMatchObject({ status: 'complete', truncated: false });
    expect(bundle.manifest.mutationPolicy).toBe('read_only_no_cas_or_proposal_state_changes');
    expect(bundle.manifest.redaction.removedFieldCount).toBeGreaterThan(0);
    expect(bundle.manifest.redaction.redactedValueCount).toBeGreaterThan(0);
    expect(bundle.manifest.redaction.excludedCollections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'nodeslide_oauth_credentials',
          reason: 'authentication_material',
        }),
        expect.objectContaining({
          name: 'nodeslide_presence',
          reason: 'ephemeral_runtime_state',
        }),
        expect.objectContaining({
          name: 'nodeslide_deck_ci',
          reason: 'computed_not_persisted',
        }),
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

  it('exports deck-bound custody, evidence, sync, delegation, output, and budget metadata', async () => {
    const database = new MemoryDatabase();
    const deckId = 'deck:custody';
    const budgetId = 'budget:owner';
    seedDeck(database, { deckId, ownerAccessKey: OWNER_ACCESS_KEY });
    seedOwnerActivity(database, deckId, budgetId);
    database.seed('nodeslide_elements', {
      id: 'element:inline-image',
      deckId,
      slideId: 'slide:one',
      imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      createdAt: 49,
    });

    const sessionId = nodeslideStableId('nsession', 'job:owner');
    const requestBinding = {
      schemaVersion: 'nodeslide.request-binding/v2',
      requestDigest: 'sha256:owner-request',
      capabilityDigest: 'sha256:capability-proof',
    };
    database.seed('nodeslide_durable_sessions', {
      id: sessionId,
      requestDigest: 'sha256:owner-request',
      capabilityDigest: 'sha256:capability-proof',
      requestBinding,
      jobs: { 'job:owner': { requestBinding } },
    });
    database.seed('nodeslide_durable_session_events', {
      sessionId,
      jobId: 'job:owner',
      requestBinding,
      transitionSequence: 1,
      occurredAt: 50,
    });
    database.seed('nodeslide_durable_job_journal_entries', {
      sessionId,
      jobId: 'job:owner',
      binding: { ...requestBinding, sessionId, jobId: 'job:owner' },
      sequence: 1,
      createdAt: 51,
    });
    database.seed('nodeslide_run_budgets', {
      id: budgetId,
      status: 'finalized',
      actualMicroUsd: 1200,
      createdAt: 52,
    });
    database.seed('nodeslide_billable_calls', {
      budgetId,
      callId: 'call:one',
      status: 'settled',
      createdAt: 53,
    });
    database.seed('nodeslide_budget_events', {
      budgetId,
      sequence: 1,
      kind: 'settled',
      createdAt: 54,
    });
    database.seed('nodeslide_sync_connections', {
      id: 'sync:one',
      deckId,
      provider: 'google_slides',
      remotePresentationId: 'google:deck',
      lastMutationKey: 'mutation-capability',
      createdAt: 55,
    });
    database.seed('nodeslide_delegation_grants', {
      id: 'grant:one',
      deckId,
      tokenDigest: 'sha256:delegation-secret-digest',
      capability: 'accept_validated',
      createdAt: 56,
    });
    database.seed('nodeslide_delegation_uses', {
      id: 'use:one',
      grantId: 'grant:one',
      deckId,
      patchId: 'patch:one',
      usedAt: 57,
    });
    database.seed('nodeslide_evidence_captures', {
      id: 'capture:one',
      deckId,
      runId: 'run:owner',
      traceId: 'trace:one',
      spanId: 'span:one',
      sourceId: 'source:one',
      status: 'ready',
      createdAt: 58,
    });
    database.seed('nodeslide_evidence_steps', {
      id: 'step:one',
      captureId: 'capture:one',
      deckId,
      runId: 'run:owner',
      traceId: 'trace:one',
      spanId: 'span:one',
      screenshotStorageId: 'storage:screenshot-capability',
      pdfStorageId: 'storage:pdf-capability',
      createdAt: 59,
    });
    database.seed('nodeslide_shadow_comparisons', {
      id: 'shadow:one',
      deckId,
      status: 'completed',
      createdAt: 60,
    });
    database.seed('nodeslide_exports', {
      id: 'export:one',
      deckId,
      kind: 'pptx',
      url: 'https://download.test/signed-export-capability',
      createdAt: 61,
    });
    database.seed('nodeslide_publications', {
      id: 'publication:one',
      deckId,
      shareSlug: SHARE_CAPABILITY,
      revision: 1,
      snapshot: { deck: { id: deckId }, slides: [], elements: [], sources: [] },
      publishedAt: 62,
    });
    database.seed('nodeslide_preference_events', {
      id: 'preference:one',
      deckId,
      type: 'patch_accepted',
      recordedAt: 63,
    });

    const bundle = await exportMyDataHandler(queryContext(database), {
      deckId,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const serialized = JSON.stringify(bundle);

    expect(bundle.data.activity.durableSessions).toHaveLength(1);
    expect(bundle.data.activity.durableSessionEvents).toHaveLength(1);
    expect(bundle.data.activity.durableJournalEntries).toHaveLength(1);
    expect(bundle.data.budgets.ledgers).toHaveLength(1);
    expect(bundle.data.budgets.billableCalls).toHaveLength(1);
    expect(bundle.data.budgets.events).toHaveLength(1);
    expect(bundle.data.sync.connections).toHaveLength(1);
    expect(bundle.data.delegation.grants).toHaveLength(1);
    expect(bundle.data.delegation.uses).toHaveLength(1);
    expect(bundle.data.evidence.captures).toHaveLength(1);
    expect(bundle.data.evidence.steps).toHaveLength(1);
    expect(bundle.data.activity.shadowComparisons).toHaveLength(1);
    expect(bundle.data.outputs.exports).toHaveLength(1);
    expect(bundle.data.outputs.publications).toHaveLength(1);
    expect(bundle.data.preferenceEvents).toHaveLength(1);
    expect(bundle.data.evidence.steps[0]).not.toHaveProperty('screenshotStorageId');
    expect(bundle.data.evidence.steps[0]).not.toHaveProperty('pdfStorageId');
    expect(bundle.data.delegation.grants[0]).not.toHaveProperty('tokenDigest');
    expect(bundle.data.sync.connections[0]).not.toHaveProperty('lastMutationKey');
    expect(bundle.data.outputs.exports[0]).not.toHaveProperty('url');
    expect(serialized).not.toContain('signed-export-capability');
    expect(serialized).not.toContain('iVBORw0KGgo');
    expect(serialized).toContain('[OMITTED_BINARY_DATA]');
    expect(bundle.manifest.collections.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        'data.evidence.steps',
        'data.activity.durableSessions',
        'data.budgets.ledgers',
        'data.sync.connections',
        'data.delegation.uses',
        'data.outputs.publications',
      ]),
    );
    expect(bundle.manifest.completeness.recordCount).toBe(
      bundle.manifest.collections.reduce((total, entry) => total + entry.recordCount, 0),
    );
  });

  it('orders records and object keys deterministically', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, { deckId: 'deck:ordered', ownerAccessKey: OWNER_ACCESS_KEY });
    database.seed('nodeslide_comments', {
      id: 'comment:a',
      deckId: 'deck:ordered',
      createdAt: 1,
    });
    database.seed('nodeslide_comments', {
      id: 'comment:z',
      deckId: 'deck:ordered',
      zeta: 'last key',
      alpha: 'first key',
      createdAt: 2,
    });

    const first = await exportMyDataHandler(queryContext(database), {
      deckId: 'deck:ordered',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const second = await exportMyDataHandler(queryContext(database), {
      deckId: 'deck:ordered',
      ownerAccessKey: OWNER_ACCESS_KEY,
    });

    expect(first.data).toEqual(second.data);
    expect({ ...first.manifest, generatedAt: 0 }).toEqual({ ...second.manifest, generatedAt: 0 });
    expect(first.data.comments.map((comment) => comment.id)).toEqual(['comment:a', 'comment:z']);
    expect(Object.keys(first.data.comments[1])).toEqual([
      'alpha',
      'createdAt',
      'deckId',
      'id',
      'zeta',
    ]);
    expect(first.manifest.determinism.objectKeyOrder).toBe('lexicographic');
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

  it('fails closed when an evidence step is not bound to an exported capture', async () => {
    const database = new MemoryDatabase();
    seedDeck(database, { deckId: 'deck:owner', ownerAccessKey: OWNER_ACCESS_KEY });
    database.seed('nodeslide_evidence_steps', {
      id: 'step:orphan',
      captureId: 'capture:foreign',
      deckId: 'deck:owner',
      runId: 'run:owner',
      traceId: 'trace:owner',
      spanId: 'span:owner',
      createdAt: 1,
    });

    await expect(
      exportMyDataHandler(queryContext(database), {
        deckId: 'deck:owner',
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow('failed closed: evidence step ownership is inconsistent');
  });

  it('exports a complete immutable claim-to-region custody chain', async () => {
    const database = new MemoryDatabase();
    const deckId = 'deck:custody';
    const ownerDigest = `actor_${nodeslideContentDigest(OWNER_ACCESS_KEY)}`;
    const revisionDigest = `sha256:${'1'.repeat(64)}`;
    const captureDigest = `sha256:${'2'.repeat(64)}`;
    const stepDigest = `sha256:${'3'.repeat(64)}`;
    const attachmentDigest = `sha256:${'4'.repeat(64)}`;
    seedDeck(database, { deckId, ownerAccessKey: OWNER_ACCESS_KEY });
    database.seed('nodeslide_patches', { id: 'patch:custody', deckId, createdAt: 1 });
    database.seed('nodeslide_source_revisions', {
      id: `source-revision:${revisionDigest}`,
      revisionDigest,
      ownerDigest,
      deckId,
      sourceId: 'source:custody',
      contentDigest: `sha256:${'5'.repeat(64)}`,
      createdAt: 2,
    });
    database.seed('nodeslide_evidence_captures', {
      id: 'capture:custody',
      deckId,
      sourceId: 'source:custody',
      sourceRevisionId: `source-revision:${revisionDigest}`,
      sourceRevisionDigest: revisionDigest,
      captureDigest,
      createdAt: 3,
    });
    database.seed('nodeslide_evidence_steps', {
      id: 'step:custody',
      captureId: 'capture:custody',
      deckId,
      attachmentDigest,
      evidenceStepDigest: stepDigest,
      createdAt: 4,
    });
    database.seed('nodeslide_claim_evidence_receipts', {
      id: 'receipt-row:custody',
      receiptId: 'receipt:custody',
      receiptDigest: `sha256:${'6'.repeat(64)}`,
      ownerDigest,
      deckId,
      patchId: 'patch:custody',
      sourceRevisionId: `source-revision:${revisionDigest}`,
      sourceRevisionDigest: revisionDigest,
      captureId: 'capture:custody',
      captureDigest,
      evidenceStepId: 'step:custody',
      evidenceStepDigest: stepDigest,
      attachmentDigest,
      createdAt: 5,
    });

    const bundle = await exportMyDataHandler(queryContext(database), {
      deckId,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });

    expect(bundle.data.sourceRevisions).toHaveLength(1);
    expect(bundle.data.evidence.claimReceipts).toHaveLength(1);
    expect(bundle.data.sourceRevisions?.[0]).not.toHaveProperty('ownerDigest');
    expect(bundle.data.evidence.claimReceipts?.[0]).not.toHaveProperty('ownerDigest');
    expect(bundle.manifest.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'data.sourceRevisions', recordCount: 1 }),
        expect.objectContaining({ path: 'data.evidence.claimReceipts', recordCount: 1 }),
      ]),
    );
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
