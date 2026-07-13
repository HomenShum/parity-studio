import { describe, expect, it } from 'vitest';
import type {
  DeckPatch,
  DeckSnapshot,
  NodeSlideWorkspace,
  PatchOperation,
  PublishedNodeSlide,
} from '../../shared/nodeslide';
import type { SignatureProfile } from '../../shared/nodeslideSignature';
import { planSignatureApplication } from '../../shared/nodeslideSignatureApply';
import { financeIbcsTastePack } from '../../src/domains/nodeslide/signature/packs/index';
import type { MutationCtx } from '../_generated/server';
import {
  acceptPatch,
  addComment,
  applyPatch,
  getPresenterSnapshot,
  proposePatch,
  publishDeck,
  rejectPatch,
  replyComment,
  restoreVersion,
  revokePublication,
} from '../nodeslide';
import {
  NODESLIDE_WORKSPACE_LIMITS,
  loadNodeSlideSnapshot,
  loadNodeSlideWorkspace,
} from './nodeslideData';
import { clocksForNodeSlideOperations } from './nodeslidePatches';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import {
  serializeSignatureProfileForStorage,
  signatureProfileRowId,
} from './nodeslideSignatureProfiles';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const SECOND_OWNER_ACCESS_KEY = 'b'.repeat(43);
const HISTORY_TABLES = new Set([
  'nodeslide_comments',
  'nodeslide_patches',
  'nodeslide_versions',
  'nodeslide_traces',
  'nodeslide_validations',
  'nodeslide_exports',
]);

type StoredRow = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

type Filter = {
  field: string;
  operation: 'eq' | 'gt' | 'lte';
  value: unknown;
};

type Write = {
  kind: 'insert' | 'patch' | 'replace' | 'delete';
  tableName: string;
  value?: unknown;
};

class MemoryIndex {
  readonly filters: Filter[] = [];

  eq(field: string, value: unknown): this {
    this.filters.push({ field, operation: 'eq', value });
    return this;
  }

  gt(field: string, value: unknown): this {
    this.filters.push({ field, operation: 'gt', value });
    return this;
  }

  lte(field: string, value: unknown): this {
    this.filters.push({ field, operation: 'lte', value });
    return this;
  }
}

class MemoryQuery {
  private filters: readonly Filter[] = [];
  private indexName = '';
  private direction: 'asc' | 'desc' = 'asc';

  constructor(
    private readonly database: MemoryDatabase,
    private readonly tableName: string,
  ) {}

  withIndex(indexName: string, configure: (index: MemoryIndex) => unknown): this {
    const index = new MemoryIndex();
    configure(index);
    this.filters = index.filters;
    this.indexName = indexName;
    return this;
  }

  order(direction: 'asc' | 'desc'): this {
    this.direction = direction;
    return this;
  }

  async collect(): Promise<StoredRow[]> {
    this.database.collectCalls.push(this.tableName);
    return this.evaluate();
  }

  async first(): Promise<StoredRow | null> {
    return this.evaluate()[0] ?? null;
  }

  async take(limit: number): Promise<StoredRow[]> {
    this.database.takeCalls.push({ tableName: this.tableName, limit });
    return this.evaluate().slice(0, limit);
  }

  private evaluate(): StoredRow[] {
    const rows = this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => matchesFilter(row[filter.field], filter)));
    const orderField = orderFieldForIndex(this.indexName);
    rows.sort(
      (left, right) =>
        compareValues(left[orderField], right[orderField]) ||
        compareValues(left._creationTime, right._creationTime),
    );
    if (this.direction === 'desc') rows.reverse();
    return rows;
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;
  readonly collectCalls: string[] = [];
  readonly takeCalls: Array<{ tableName: string; limit: number }> = [];
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
    const located = this.findRow(rowId);
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) delete located.row[field];
      else located.row[field] = structuredClone(value);
    }
    this.writes.push({
      kind: 'patch',
      tableName: located.tableName,
      value: structuredClone(fields),
    });
  }

  async replace(rowId: string, value: object): Promise<void> {
    const located = this.findRow(rowId);
    const replacement = {
      ...structuredClone(value),
      _id: located.row._id,
      _creationTime: located.row._creationTime,
    } as StoredRow;
    located.rows[located.index] = replacement;
    this.writes.push({
      kind: 'replace',
      tableName: located.tableName,
      value: structuredClone(value),
    });
  }

  async delete(rowId: string): Promise<void> {
    const located = this.findRow(rowId);
    located.rows.splice(located.index, 1);
    this.writes.push({ kind: 'delete', tableName: located.tableName });
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

  resetObservations(): void {
    this.collectCalls.length = 0;
    this.takeCalls.length = 0;
    this.writes.length = 0;
  }

  private findRow(rowId: string): {
    tableName: string;
    rows: StoredRow[];
    row: StoredRow;
    index: number;
  } {
    for (const [tableName, rows] of this.tables) {
      const index = rows.findIndex((candidate) => candidate._id === rowId);
      const row = rows[index];
      if (row) return { tableName, rows, row, index };
    }
    throw new Error(`Memory row ${rowId} was not found.`);
  }
}

type RegisteredHandler<Args, Result> = (ctx: MutationCtx, args: Args) => Promise<Result>;

function registeredHandler<Args, Result>(value: unknown): RegisteredHandler<Args, Result> {
  const handler = (value as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Registered Convex handler is unavailable.');
  return handler as RegisteredHandler<Args, Result>;
}

type PatchRequest = {
  id?: string;
  deckId: string;
  ownerAccessKey: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: DeckPatch['scope'];
  operations: PatchOperation[];
  summary?: string;
  profileId?: string;
  profileDigest?: string;
};

const applyPatchHandler = registeredHandler<PatchRequest, { patch: DeckPatch }>(applyPatch);
const acceptPatchHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string; patchId: string },
  { patch: DeckPatch }
>(acceptPatch);
const rejectPatchHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string; patchId: string },
  DeckPatch | null
>(rejectPatch);
const publishDeckHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string },
  PublishedNodeSlide
>(publishDeck);
const revokePublicationHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string },
  { status: string; revokedAt?: number } | null
>(revokePublication);
const presenterHandler = registeredHandler<{ shareSlug: string }, PublishedNodeSlide | null>(
  getPresenterSnapshot,
);
const addCommentHandler = registeredHandler<
  {
    id?: string;
    deckId: string;
    ownerAccessKey: string;
    anchor: { type: 'deck'; deckId: string };
    authorId: string;
    authorName: string;
    text: string;
  },
  unknown
>(addComment);
const replyCommentHandler = registeredHandler<
  {
    id?: string;
    deckId: string;
    ownerAccessKey: string;
    parentId: string;
    authorId: string;
    authorName: string;
    text: string;
  },
  unknown
>(replyComment);
const restoreVersionHandler = registeredHandler<
  {
    deckId: string;
    ownerAccessKey: string;
    versionId: string;
    baseDeckVersion: number;
  },
  { patch: DeckPatch; workspace: NodeSlideWorkspace | null }
>(restoreVersion);

describe('NodeSlide release security', () => {
  it('removes public provenance arguments and forces direct human mutations to human', async () => {
    expect(publicArgNames(applyPatch)).not.toContain('source');
    expect(publicArgNames(applyPatch)).not.toContain('traceId');
    expect(publicArgNames(proposePatch)).not.toContain('source');
    expect(publicArgNames(proposePatch)).not.toContain('traceId');
    expect(publicArgNames(applyPatch)).toEqual(
      expect.arrayContaining(['profileId', 'profileDigest']),
    );

    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'human-provenance', OWNER_ACCESS_KEY, 'a');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Human content');
    const clocks = clocksForNodeSlideOperations(snapshot, [edit.operation]);
    const request = {
      id: 'human-patch',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocks,
      scope: edit.scope,
      operations: [edit.operation],
      summary: 'Human edit',
      source: 'agent',
      traceId: 'forged-trace',
    } as unknown as PatchRequest;

    const receipt = await applyPatchHandler(context, request);

    expect(receipt.patch.source).toBe('human');
    expect(receipt.patch.traceId).toBeUndefined();
    expect(onlyStableRow(database, 'nodeslide_patches', 'human-patch').source).toBe('human');
    expect(onlyStableRow(database, 'nodeslide_patches', 'human-patch').traceId).toBeUndefined();

    const afterHumanEdit = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const pairedEdit = textEdit(afterHumanEdit, 'Profile pair validation');
    const pairedClocks = clocksForNodeSlideOperations(afterHumanEdit, [pairedEdit.operation]);
    const pairedBase = {
      deckId: afterHumanEdit.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: afterHumanEdit.deck.version,
      ...pairedClocks,
      scope: pairedEdit.scope,
      operations: [pairedEdit.operation],
      summary: 'Incomplete profile reference',
    };
    database.resetObservations();
    await expect(
      applyPatchHandler(context, { ...pairedBase, profileId: 'profile-without-digest' }),
    ).rejects.toThrow(/profileId and profileDigest must appear together/i);
    await expect(
      applyPatchHandler(context, {
        ...pairedBase,
        profileDigest: `sha256:${'0'.repeat(64)}`,
      }),
    ).rejects.toThrow(/profileId and profileDigest must appear together/i);
    expect(database.writes).toEqual([]);
  });

  it('resolves signature application and restore by immutable profile digest', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'profile-digest', OWNER_ACCESS_KEY, '4');
    const context = { db: database } as unknown as MutationCtx;
    const firstRevision = structuredClone(financeIbcsTastePack) as SignatureProfile;
    const digestCharacter = firstRevision.source.digest.endsWith('0') ? '1' : '0';
    const secondRevision = structuredClone(firstRevision) as SignatureProfile;
    secondRevision.name = `${firstRevision.name} second revision`;
    secondRevision.source = {
      ...secondRevision.source,
      digest: `sha256:${digestCharacter.repeat(64)}`,
    };
    seedSignatureProfile(database, fixture.snapshot.deck.projectId, firstRevision);
    seedSignatureProfile(database, fixture.snapshot.deck.projectId, secondRevision);

    const beforeSignature = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const application = planSignatureApplication(beforeSignature, firstRevision);
    if (!application.ok) throw new Error(application.error.message);
    const signatureReceipt = await applyPatchHandler(context, {
      id: 'signature-patch-first-revision',
      deckId: beforeSignature.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: application.plan.baseDeckVersion,
      baseSlideVersions: application.plan.baseSlideVersions,
      baseElementVersions: application.plan.baseElementVersions,
      scope: application.plan.scope,
      operations: application.plan.operations,
      summary: 'Apply exact signature revision',
      profileId: firstRevision.id,
      profileDigest: firstRevision.source.digest,
    });

    expect(signatureReceipt.patch).toEqual(
      expect.objectContaining({
        profileId: firstRevision.id,
        profileDigest: firstRevision.source.digest,
      }),
    );
    expect(onlyStableRow(database, 'nodeslide_patches', signatureReceipt.patch.id)).toEqual(
      expect.objectContaining({
        profileId: firstRevision.id,
        profileDigest: firstRevision.source.digest,
      }),
    );
    const signedSnapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    expect(signedSnapshot.deck.activeSignatureProfileId).toBe(firstRevision.id);
    expect(signedSnapshot.deck.activeSignatureProfileDigest).toBe(firstRevision.source.digest);
    expect(signedSnapshot.deck.activeSignatureProfileDigest).not.toBe(secondRevision.source.digest);
    const signedVersion = database
      .rows('nodeslide_versions')
      .find((row) => row.version === signedSnapshot.deck.version);
    if (!signedVersion || typeof signedVersion.id !== 'string') {
      throw new Error('Signed version receipt is missing.');
    }
    expect((signedVersion.snapshot as DeckSnapshot).deck.activeSignatureProfileDigest).toBe(
      firstRevision.source.digest,
    );

    const laterEdit = textEdit(signedSnapshot, 'Edit under the immutable active revision');
    const laterClocks = clocksForNodeSlideOperations(signedSnapshot, [laterEdit.operation]);
    await applyPatchHandler(context, {
      deckId: signedSnapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: signedSnapshot.deck.version,
      ...laterClocks,
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Edit with active signature enforcement',
    });
    const beforeRestore = await requiredSnapshot(context, signedSnapshot.deck.id);
    const restored = await restoreVersionHandler(context, {
      deckId: signedSnapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      versionId: signedVersion.id,
      baseDeckVersion: beforeRestore.deck.version,
    });

    expect(restored.patch.status).toBe('accepted');
    expect(restored.workspace?.deck.activeSignatureProfileId).toBe(firstRevision.id);
    expect(restored.workspace?.deck.activeSignatureProfileDigest).toBe(firstRevision.source.digest);
    expect(
      (await requiredSnapshot(context, signedSnapshot.deck.id)).deck.activeSignatureProfileDigest,
    ).toBe(firstRevision.source.digest);
  });

  it('publishes only current validated, sanitized immutable snapshots and supports bounded republish/revoke', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'publication', OWNER_ACCESS_KEY, 'b', (snapshot) => {
      const publicSourceId = `public-source-${snapshot.deck.id}`;
      snapshot.sources.push({
        id: publicSourceId,
        deckId: snapshot.deck.id,
        title: 'Public evidence',
        url: 'https://example.com/evidence',
        sourceType: 'url',
        retrievedAt: 1_000,
        citation: 'Public evidence citation',
      });
      const element = snapshot.elements[0];
      const internalSource = snapshot.sources.find((source) => source.sourceType !== 'url');
      if (!element || !internalSource) throw new Error('Publication fixture is incomplete.');
      element.sourceIds = [internalSource.id, publicSourceId];
    });
    const context = { db: database } as unknown as MutationCtx;

    const first = await publishDeckHandler(context, {
      deckId: fixture.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const slug = first.publication.shareSlug;
    expect(slug).not.toBe(fixture.snapshot.deck.shareSlug);
    const publicRead = await presenterHandler(context, { shareSlug: slug });
    if (!publicRead) throw new Error('Published snapshot was unavailable.');

    expect(publicRead.snapshot.slides.every((slide) => !('notes' in slide))).toBe(true);
    expect('projectId' in publicRead.snapshot.deck).toBe(false);
    expect('brief' in publicRead.snapshot.deck).toBe(false);
    expect('activeSignatureProfileId' in publicRead.snapshot.deck).toBe(false);
    expect('shareSlug' in publicRead.snapshot.deck).toBe(false);
    expect(publicRead.snapshot.sources).toEqual([
      expect.objectContaining({ sourceType: 'url', url: 'https://example.com/evidence' }),
    ]);
    expect(publicRead.snapshot.elements.flatMap((element) => element.sourceIds)).toEqual([
      `public-source-${fixture.snapshot.deck.id}`,
    ]);
    expect(publicRead.snapshot.elements[0]?.sourceIds).toEqual([
      `public-source-${fixture.snapshot.deck.id}`,
    ]);

    const live = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const editedText = 'This edit exists only in the live workspace.';
    const edit = textEdit(live, editedText);
    const clocks = clocksForNodeSlideOperations(live, [edit.operation]);
    await applyPatchHandler(context, {
      deckId: live.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: live.deck.version,
      ...clocks,
      scope: edit.scope,
      operations: [edit.operation],
      summary: 'Edit after publication',
    });

    const unchanged = await presenterHandler(context, { shareSlug: slug });
    expect(
      unchanged?.snapshot.elements.find((element) => element.id === edit.elementId)?.content,
    ).not.toBe(editedText);

    const republished = await publishDeckHandler(context, {
      deckId: live.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    expect(republished.publication.revision).toBe(2);
    expect(republished.publication.shareSlug).toBe(slug);
    expect(
      (await presenterHandler(context, { shareSlug: slug }))?.snapshot.elements.find(
        (element) => element.id === edit.elementId,
      )?.content,
    ).toBe(editedText);

    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.publications + 3; index += 1) {
      await publishDeckHandler(context, {
        deckId: live.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
      });
    }
    expect(database.rows('nodeslide_publications')).toHaveLength(
      NODESLIDE_WORKSPACE_LIMITS.publications,
    );
    expect(
      database.rows('nodeslide_publications').filter((row) => row.status === 'active'),
    ).toHaveLength(1);

    const revoked = await revokePublicationHandler(context, {
      deckId: live.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    expect(revoked).toEqual(expect.objectContaining({ status: 'revoked' }));
    expect(await presenterHandler(context, { shareSlug: slug })).toBeNull();

    const afterRevoke = await publishDeckHandler(context, {
      deckId: live.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    expect(afterRevoke.publication.shareSlug).not.toBe(slug);
    expect(await presenterHandler(context, { shareSlug: slug })).toBeNull();
    expect(
      await presenterHandler(context, { shareSlug: afterRevoke.publication.shareSlug }),
    ).not.toBeNull();
  });

  it('refuses publication without a publishable validation for the exact live version', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'invalid-publication', OWNER_ACCESS_KEY, 'c');
    const context = { db: database } as unknown as MutationCtx;
    const validation = database.rows('nodeslide_validations')[0];
    if (!validation) throw new Error('Validation fixture is missing.');
    validation.publishOk = false;

    await expect(
      publishDeckHandler(context, {
        deckId: fixture.snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/current deck version must pass publish validation/i);
    expect(database.rows('nodeslide_publications')).toEqual([]);

    validation.publishOk = true;
    const deck = database.rows('nodeslide_decks')[0];
    if (!deck || typeof deck.version !== 'number') throw new Error('Deck fixture is missing.');
    deck.version += 1;
    await expect(
      publishDeckHandler(context, {
        deckId: fixture.snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/current deck version must pass publish validation/i);
    expect(database.rows('nodeslide_publications')).toEqual([]);
  });

  it('does not complete or reject traces linked to another deck or patch', async () => {
    const database = new MemoryDatabase();
    const first = seedWorkspace(database, 'trace-owner', OWNER_ACCESS_KEY, 'd');
    const second = seedWorkspace(database, 'trace-victim', SECOND_OWNER_ACCESS_KEY, 'e');
    const context = { db: database } as unknown as MutationCtx;

    const rejectCandidate = readyTextPatch(
      first.snapshot,
      'patch-reject',
      'trace-reject',
      'Rejected',
    );
    database.seed('nodeslide_patches', rejectCandidate);
    database.seed(
      'nodeslide_traces',
      traceRow(second.snapshot.deck.id, rejectCandidate.id, 'trace-reject'),
    );

    await rejectPatchHandler(context, {
      deckId: first.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patchId: rejectCandidate.id,
    });
    expect(onlyStableRow(database, 'nodeslide_patches', rejectCandidate.id).status).toBe(
      'rejected',
    );
    expect(onlyStableRow(database, 'nodeslide_traces', 'trace-reject')).toEqual(
      expect.objectContaining({ status: 'awaiting_review', deckId: second.snapshot.deck.id }),
    );
    expect(onlyStableRow(database, 'nodeslide_traces', 'trace-reject').completedAt).toBeUndefined();

    const current = await requiredSnapshot(context, first.snapshot.deck.id);
    const acceptCandidate = readyTextPatch(current, 'patch-accept', 'trace-accept', 'Accepted');
    database.seed('nodeslide_patches', acceptCandidate);
    database.seed(
      'nodeslide_traces',
      traceRow(second.snapshot.deck.id, acceptCandidate.id, 'trace-accept'),
    );

    const accepted = await acceptPatchHandler(context, {
      deckId: first.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patchId: acceptCandidate.id,
    });
    expect(accepted.patch.status).toBe('accepted');
    expect(onlyStableRow(database, 'nodeslide_traces', 'trace-accept')).toEqual(
      expect.objectContaining({ status: 'awaiting_review', deckId: second.snapshot.deck.id }),
    );
    expect(onlyStableRow(database, 'nodeslide_traces', 'trace-accept').completedAt).toBeUndefined();

    const afterAccept = await requiredSnapshot(context, first.snapshot.deck.id);
    const wrongPatchCandidate = readyTextPatch(
      afterAccept,
      'patch-wrong-link',
      'trace-wrong-link',
      'Wrong link',
    );
    database.seed('nodeslide_patches', wrongPatchCandidate);
    database.seed(
      'nodeslide_traces',
      traceRow(first.snapshot.deck.id, 'another-patch', 'trace-wrong-link'),
    );
    await acceptPatchHandler(context, {
      deckId: first.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patchId: wrongPatchCandidate.id,
    });
    expect(onlyStableRow(database, 'nodeslide_traces', 'trace-wrong-link').status).toBe(
      'awaiting_review',
    );
    expect(
      onlyStableRow(database, 'nodeslide_traces', 'trace-wrong-link').completedAt,
    ).toBeUndefined();
  });

  it('rejects cross-deck comment idempotency collisions for comments and replies', async () => {
    const database = new MemoryDatabase();
    const first = seedWorkspace(database, 'comment-owner', OWNER_ACCESS_KEY, 'f');
    const second = seedWorkspace(database, 'comment-victim', SECOND_OWNER_ACCESS_KEY, '1');
    const context = { db: database } as unknown as MutationCtx;
    database.seed(
      'nodeslide_comments',
      commentRow('collision-comment', second.snapshot.deck.id, undefined, 10),
    );

    await expect(
      addCommentHandler(context, {
        id: 'collision-comment',
        deckId: first.snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        anchor: { type: 'deck', deckId: first.snapshot.deck.id },
        authorId: 'owner',
        authorName: 'Owner',
        text: 'Do not return another deck comment.',
      }),
    ).rejects.toThrow('Comment id is unavailable.');

    database.seed(
      'nodeslide_comments',
      commentRow('parent-comment', first.snapshot.deck.id, undefined, 11),
    );
    database.seed(
      'nodeslide_comments',
      commentRow('collision-reply', second.snapshot.deck.id, 'victim-parent', 12),
    );
    await expect(
      replyCommentHandler(context, {
        id: 'collision-reply',
        deckId: first.snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        parentId: 'parent-comment',
        authorId: 'owner',
        authorName: 'Owner',
        text: 'Do not return another deck reply.',
      }),
    ).rejects.toThrow('Comment id is unavailable.');
    expect(database.rows('nodeslide_comments')).toHaveLength(3);
  });

  it('loads deterministic bounded history while retaining latest and actionable rows', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'bounded-history', OWNER_ACCESS_KEY, '2');
    const deckId = fixture.snapshot.deck.id;
    const context = { db: database } as unknown as MutationCtx;

    database.seed('nodeslide_comments', commentRow('old-open-comment', deckId, undefined, 1));
    onlyStableRow(database, 'nodeslide_comments', 'old-open-comment').status = 'open';
    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.comments + 20; index += 1) {
      const row = commentRow(`comment-${index}`, deckId, undefined, 100 + index);
      row.status = 'resolved';
      database.seed('nodeslide_comments', row);
    }

    database.seed('nodeslide_patches', historyPatch('old-ready-patch', deckId, 'ready', 1));
    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.patches + 20; index += 1) {
      database.seed(
        'nodeslide_patches',
        historyPatch(`patch-${index}`, deckId, 'accepted', 100 + index),
      );
    }

    for (let index = 2; index < NODESLIDE_WORKSPACE_LIMITS.versions + 20; index += 1) {
      database.seed('nodeslide_versions', {
        id: `version-${index}`,
        deckId,
        version: index,
        label: `Version ${index}`,
        source: 'human',
        snapshot: fixture.snapshot,
        createdAt: index,
      });
    }

    database.seed('nodeslide_traces', {
      ...traceRow(deckId, 'old-patch', 'old-review-trace', 1),
      reasoningEffort: 'xhigh',
    });
    for (let index = 0; index < 20; index += 1) {
      database.seed('nodeslide_traces', {
        ...traceRow(deckId, `planning-patch-${index}`, `planning-trace-${index}`, 2 + index),
        status: 'planning',
      });
      database.seed('nodeslide_traces', {
        ...traceRow(deckId, `working-patch-${index}`, `working-trace-${index}`, 30 + index),
        status: 'working',
      });
    }
    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.traces + 20; index += 1) {
      const row = traceRow(deckId, `trace-patch-${index}`, `trace-${index}`, 100 + index);
      database.seed('nodeslide_traces', {
        ...row,
        status: 'completed',
        completedAt: 100 + index,
      });
    }

    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.validations + 20; index += 1) {
      database.seed('nodeslide_validations', {
        id: `validation-${index}`,
        deckId,
        deckVersion: index + 2,
        ok: true,
        publishOk: true,
        cleanOk: true,
        issues: [],
        checkedAt: 100 + index,
        toolchainVersion: fixture.snapshot.deck.toolchainVersion,
      });
    }

    database.seed('nodeslide_exports', exportRow('old-rendering-export', deckId, 'rendering', 1));
    for (let index = 0; index < 20; index += 1) {
      database.seed('nodeslide_exports', {
        ...exportRow(`queued-export-${index}`, deckId, 'ready', 2 + index),
        status: 'queued',
      });
    }
    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.exports + 20; index += 1) {
      database.seed(
        'nodeslide_exports',
        exportRow(`export-${index}`, deckId, 'ready', 100 + index),
      );
    }

    database.resetObservations();
    const workspace = await loadNodeSlideWorkspace(context, deckId, 0);
    if (!workspace) throw new Error('Bounded workspace was unavailable.');

    expect(workspace.comments).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.comments);
    expect(workspace.patches).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.patches);
    expect(workspace.versions).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.versions);
    expect(workspace.traces).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.traces);
    expect(workspace.validations).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.validations);
    expect(workspace.exports).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.exports);
    expect(workspace.comments.some((row) => row.id === 'old-open-comment')).toBe(true);
    expect(workspace.patches.some((row) => row.id === 'old-ready-patch')).toBe(true);
    expect(workspace.traces.some((row) => row.id === 'old-review-trace')).toBe(true);
    expect(workspace.traces.find((row) => row.id === 'old-review-trace')?.reasoningEffort).toBe(
      'xhigh',
    );
    expect(workspace.exports.some((row) => row.id === 'old-rendering-export')).toBe(true);
    expect(workspace.comments.at(-1)?.id).toBe(
      `comment-${NODESLIDE_WORKSPACE_LIMITS.comments + 19}`,
    );
    expect(workspace.patches[0]?.id).toBe(`patch-${NODESLIDE_WORKSPACE_LIMITS.patches + 19}`);
    expect(workspace.traces[0]?.id).toBe(`trace-${NODESLIDE_WORKSPACE_LIMITS.traces + 19}`);
    expect(workspace.exports[0]?.id).toBe(`export-${NODESLIDE_WORKSPACE_LIMITS.exports + 19}`);
    expect(isAscending(workspace.comments.map((row) => row.createdAt))).toBe(true);
    expect(isDescending(workspace.patches.map((row) => row.createdAt))).toBe(true);
    expect(isDescending(workspace.versions.map((row) => row.version))).toBe(true);
    expect(isDescending(workspace.traces.map((row) => row.createdAt))).toBe(true);
    expect(isDescending(workspace.validations.map((row) => row.checkedAt))).toBe(true);
    expect(isDescending(workspace.exports.map((row) => row.createdAt))).toBe(true);
    expect(database.collectCalls.filter((tableName) => HISTORY_TABLES.has(tableName))).toEqual([]);
    expect(
      database.takeCalls
        .filter(({ tableName }) => HISTORY_TABLES.has(tableName))
        .every(({ tableName, limit }) => limit <= historyLimit(tableName)),
    ).toBe(true);
  });

  it('returns the existing stale restore receipt without changing the workspace snapshot', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'stale-restore', OWNER_ACCESS_KEY, '3');
    const context = { db: database } as unknown as MutationCtx;
    const before = await requiredSnapshot(context, fixture.snapshot.deck.id);
    database.resetObservations();

    const receipt = await restoreVersionHandler(context, {
      deckId: fixture.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      versionId: fixture.versionId,
      baseDeckVersion: before.deck.version - 1,
    });

    expect(receipt.patch.status).toBe('stale');
    expect(receipt.workspace?.deck.version).toBe(before.deck.version);
    expect(receipt.workspace?.slides).toEqual(before.slides);
    expect(receipt.workspace?.elements).toEqual(before.elements);
    expect(receipt.workspace?.sources).toEqual(before.sources);
    expect(await requiredSnapshot(context, fixture.snapshot.deck.id)).toEqual(before);
    expect(database.writes).toEqual([
      expect.objectContaining({ kind: 'insert', tableName: 'nodeslide_patches' }),
    ]);
    expect(onlyStableRow(database, 'nodeslide_patches', receipt.patch.id).status).toBe('stale');
  });
});

function seedWorkspace(
  database: MemoryDatabase,
  label: string,
  ownerAccessKey: string,
  slugCharacter: string,
  mutate?: (snapshot: DeckSnapshot) => void,
): { snapshot: DeckSnapshot; versionId: string } {
  const snapshot = structuredClone(
    buildGoldenNodeSlide(`release-security-${label}`, 1_000).snapshot,
  );
  snapshot.deck.shareSlug = `share-${slugCharacter.repeat(36)}`;
  mutate?.(snapshot);
  const validation = validateNodeSlideSnapshot(snapshot, 1_000);
  if (!validation.publishOk) throw new Error(`Fixture ${label} must begin publishable.`);
  const project = database.seed('projects', {
    clientSessionId: label,
    title: snapshot.deck.title,
    domain: 'nodeslide',
    brief: snapshot.deck.brief,
    sourceType: 'prompt',
    starred: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  });
  database.seed('nodeslide_decks', {
    ...snapshot.deck,
    projectRowId: project._id,
    clientSessionId: label,
    ownerAccessKey,
    plan: [],
    spec: {},
  });
  for (const slide of snapshot.slides) {
    database.seed('nodeslide_slides', { ...slide, createdAt: 1_000, updatedAt: 1_000 });
  }
  for (const element of snapshot.elements) {
    database.seed('nodeslide_elements', {
      ...element,
      deckId: snapshot.deck.id,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
  }
  for (const source of snapshot.sources) database.seed('nodeslide_sources', source);
  database.seed('nodeslide_validations', validation);
  const versionId = `initial-version-${snapshot.deck.id}`;
  database.seed('nodeslide_versions', {
    id: versionId,
    deckId: snapshot.deck.id,
    version: snapshot.deck.version,
    label: 'Initial deck',
    source: 'system',
    snapshot,
    createdAt: 1_000,
  });
  return { snapshot, versionId };
}

function seedSignatureProfile(
  database: MemoryDatabase,
  tenantId: string,
  profile: SignatureProfile,
): void {
  database.seed('nodeslide_signature_profiles', {
    id: signatureProfileRowId(tenantId, profile.id, profile.source.digest),
    tenantId,
    profileId: profile.id,
    sourceDigest: profile.source.digest,
    sourceKind: profile.source.kind,
    name: profile.name,
    confidence: profile.confidence,
    warningCount: profile.warnings.length,
    profileJson: serializeSignatureProfileForStorage(profile),
    createdAt: 1_000,
    updatedAt: 1_000,
  });
}

async function requiredSnapshot(ctx: MutationCtx, deckId: string): Promise<DeckSnapshot> {
  const snapshot = await loadNodeSlideSnapshot(ctx, deckId);
  if (!snapshot) throw new Error(`Snapshot ${deckId} is missing.`);
  return snapshot;
}

function textEdit(
  snapshot: DeckSnapshot,
  text: string,
): {
  elementId: string;
  operation: Extract<PatchOperation, { op: 'replace_text' }>;
  scope: DeckPatch['scope'];
} {
  const element = snapshot.elements.find(
    (candidate) => candidate.kind === 'text' && !candidate.locked && candidate.content !== text,
  );
  if (!element) throw new Error('Editable text fixture is missing.');
  return {
    elementId: element.id,
    operation: { op: 'replace_text', slideId: element.slideId, elementId: element.id, text },
    scope: {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [element.slideId],
      elementIds: [element.id],
      operationMode: 'copy',
    },
  };
}

function readyTextPatch(
  snapshot: DeckSnapshot,
  id: string,
  traceId: string,
  text: string,
): DeckPatch {
  const edit = textEdit(snapshot, text);
  const clocks = clocksForNodeSlideOperations(snapshot, [edit.operation]);
  return {
    id,
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    ...clocks,
    scope: edit.scope,
    operations: [edit.operation],
    source: 'agent',
    status: 'ready',
    summary: id,
    traceId,
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function traceRow(deckId: string, patchId: string, id: string, createdAt = 1_000) {
  return {
    id,
    deckId,
    patchId,
    status: 'awaiting_review',
    summary: id,
    plan: [],
    context: [],
    toolCalls: [],
    guardrails: [],
    createdAt,
  };
}

function commentRow(id: string, deckId: string, parentId: string | undefined, createdAt: number) {
  return {
    id,
    deckId,
    ...(parentId ? { parentId } : {}),
    anchor: { type: 'deck', deckId },
    authorId: 'author',
    authorName: 'Author',
    text: id,
    status: 'open',
    createdAt,
    updatedAt: createdAt,
  };
}

function historyPatch(id: string, deckId: string, status: 'ready' | 'accepted', createdAt: number) {
  return {
    id,
    deckId,
    baseDeckVersion: 1,
    baseSlideVersions: {},
    baseElementVersions: {},
    scope: { kind: 'deck', deckId, operationMode: 'unrestricted' },
    operations: [],
    source: 'human',
    status,
    summary: id,
    createdAt,
    updatedAt: createdAt,
  };
}

function exportRow(id: string, deckId: string, status: 'rendering' | 'ready', createdAt: number) {
  return {
    id,
    deckId,
    deckVersion: 1,
    kind: 'html',
    status,
    capabilityWarnings: [],
    createdAt,
  };
}

function onlyStableRow(database: MemoryDatabase, tableName: string, id: string): StoredRow {
  const rows = database.rows(tableName).filter((row) => row.id === id);
  if (rows.length !== 1 || !rows[0]) {
    throw new Error(`Expected one ${tableName} row with id ${id}; found ${rows.length}.`);
  }
  return rows[0];
}

function matchesFilter(actual: unknown, filter: Filter): boolean {
  if (filter.operation === 'eq') return actual === filter.value;
  if (filter.operation === 'gt') return compareValues(actual, filter.value) > 0;
  return compareValues(actual, filter.value) <= 0;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function orderFieldForIndex(indexName: string): string {
  if (indexName === 'by_deck_revision' || indexName === 'by_share_slug_revision') {
    return 'revision';
  }
  if (indexName === 'by_deck_version') return 'version';
  if (indexName === 'by_deck_version_checked' || indexName === 'by_deck_checked') {
    return 'checkedAt';
  }
  if (indexName === 'by_deck_expiry') return 'expiresAt';
  if (indexName.includes('created')) return 'createdAt';
  return '_creationTime';
}

function historyLimit(tableName: string): number {
  if (tableName === 'nodeslide_comments') return NODESLIDE_WORKSPACE_LIMITS.comments;
  if (tableName === 'nodeslide_patches') return NODESLIDE_WORKSPACE_LIMITS.patches;
  if (tableName === 'nodeslide_versions') return NODESLIDE_WORKSPACE_LIMITS.versions;
  if (tableName === 'nodeslide_traces') return NODESLIDE_WORKSPACE_LIMITS.traces;
  if (tableName === 'nodeslide_validations') return NODESLIDE_WORKSPACE_LIMITS.validations;
  if (tableName === 'nodeslide_exports') return NODESLIDE_WORKSPACE_LIMITS.exports;
  throw new Error(`Unknown history table ${tableName}.`);
}

function isAscending(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value >= (values[index - 1] ?? value));
}

function isDescending(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value <= (values[index - 1] ?? value));
}

function publicArgNames(value: unknown): string[] {
  const exportArgs = (value as { exportArgs?: () => string }).exportArgs;
  if (!exportArgs) throw new Error('Registered Convex argument validator is unavailable.');
  const exported = JSON.parse(exportArgs()) as { value?: Record<string, unknown> };
  return Object.keys(exported.value ?? {});
}
