import { describe, expect, it } from 'vitest';
import type { DeckSnapshot, NodeSlideWorkspace } from '../shared/nodeslide';
import { applyDeckPatch } from '../shared/nodeslidePatch';
import type { SignatureProfile } from '../shared/nodeslideSignature';
import { planSignatureApplication } from '../shared/nodeslideSignatureApply';
import { financeIbcsTastePack } from '../src/domains/nodeslide/signature/packs/index';
import type { MutationCtx } from './_generated/server';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import {
  requireDeckSignatureProfile,
  requireSignatureProfile,
  serializeSignatureProfileForStorage,
} from './lib/nodeslideSignatureProfiles';
import { activateProfile, clearActiveProfile, saveProfile } from './nodeslideSignatures';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const SECOND_OWNER_ACCESS_KEY = 'b'.repeat(43);

type StoredRow = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

type Filter = {
  field: string;
  operation: 'eq' | 'gt';
  value: unknown;
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
    const rows = this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => matchesFilter(row[filter.field], filter)));
    const orderField = orderFieldForIndex(this.indexName);
    rows.sort((left, right) => compare(left[orderField], right[orderField]));
    if (this.direction === 'desc') rows.reverse();
    return rows;
  }

  async first(): Promise<StoredRow | null> {
    return (await this.collect())[0] ?? null;
  }

  async unique(): Promise<StoredRow | null> {
    const rows = await this.collect();
    if (rows.length > 1) throw new Error('Memory query was not unique.');
    return rows[0] ?? null;
  }

  async take(limit: number): Promise<StoredRow[]> {
    return (await this.collect()).slice(0, limit);
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;
  writes = 0;

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }

  async insert(tableName: string, value: object): Promise<string> {
    const row = this.seed(tableName, value);
    this.writes += 1;
    return row._id;
  }

  async patch(rowId: string, fields: object): Promise<void> {
    const row = this.findRow(rowId);
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) delete row[field];
      else row[field] = structuredClone(value);
    }
    this.writes += 1;
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

  private findRow(rowId: string): StoredRow {
    for (const rows of this.tables.values()) {
      const row = rows.find((candidate) => candidate._id === rowId);
      if (row) return row;
    }
    throw new Error(`Memory row ${rowId} was not found.`);
  }
}

type MutationHandler<Args, Result> = (ctx: MutationCtx, args: Args) => Promise<Result>;

function registeredHandler<Args, Result>(value: unknown): MutationHandler<Args, Result> {
  const handler = (value as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Registered Convex handler is unavailable.');
  return handler as MutationHandler<Args, Result>;
}

const saveProfileHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string; profileJson: string },
  string
>(saveProfile);
const activateProfileHandler = registeredHandler<
  {
    deckId: string;
    ownerAccessKey: string;
    profileId: string;
    profileDigest: string;
    baseDeckVersion: number;
  },
  NodeSlideWorkspace | null
>(activateProfile);
const clearActiveProfileHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string; baseDeckVersion: number },
  NodeSlideWorkspace | null
>(clearActiveProfile);

describe('NodeSlide signature policy persistence', () => {
  it('never overwrites an identity/digest and makes identical saves write-free', async () => {
    const { database, context, snapshot } = signatureWorkspace('immutable-save');
    const args = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      profileJson: JSON.stringify(financeIbcsTastePack),
    };

    const stored = await saveProfileHandler(context, args);
    const revision = onlyRow(database, 'nodeslide_signature_profiles');
    const writesAfterFirstSave = database.writes;
    expect(stored).toBe(serializeSignatureProfileForStorage(financeIbcsTastePack));

    await expect(saveProfileHandler(context, args)).resolves.toBe(stored);
    expect(database.writes).toBe(writesAfterFirstSave);
    expect(onlyRow(database, 'nodeslide_signature_profiles')).toEqual(revision);

    const conflicting = structuredClone(financeIbcsTastePack) as SignatureProfile;
    conflicting.name = `${conflicting.name} rewritten`;
    await expect(
      saveProfileHandler(context, { ...args, profileJson: JSON.stringify(conflicting) }),
    ).rejects.toThrow(/already bound to different content/i);
    expect(database.writes).toBe(writesAfterFirstSave);
    expect(onlyRow(database, 'nodeslide_signature_profiles')).toEqual(revision);
  });

  it('rejects stale activation and clear, then records each successful policy version', async () => {
    const { database, context, snapshot } = signatureWorkspace('policy-cas');
    await saveStoredProfile(context, snapshot.deck.id, financeIbcsTastePack);
    const startingVersionCount = database.rows('nodeslide_versions').length;

    await expect(
      activateProfileHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        profileId: financeIbcsTastePack.id,
        profileDigest: financeIbcsTastePack.source.digest,
        baseDeckVersion: snapshot.deck.version - 1,
      }),
    ).rejects.toThrow(/stale signature policy change/i);
    expect(currentDeck(database, snapshot.deck.id)['version']).toBe(snapshot.deck.version);
    expect(database.rows('nodeslide_versions')).toHaveLength(startingVersionCount);

    const activated = await activateProfileHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      profileId: financeIbcsTastePack.id,
      profileDigest: financeIbcsTastePack.source.digest,
      baseDeckVersion: snapshot.deck.version,
    });
    expect(activated?.deck.version).toBe(snapshot.deck.version + 1);
    expect(activated?.deck.activeSignatureProfileDigest).toBe(financeIbcsTastePack.source.digest);
    const activatedVersion = versionSnapshot(database, snapshot.deck.id, snapshot.deck.version + 1);
    expect(activatedVersion.deck.activeSignatureProfileId).toBe(financeIbcsTastePack.id);
    expect(activatedVersion.deck.activeSignatureProfileDigest).toBe(
      financeIbcsTastePack.source.digest,
    );

    await expect(
      clearActiveProfileHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        baseDeckVersion: snapshot.deck.version,
      }),
    ).rejects.toThrow(/stale signature policy change/i);
    expect(currentDeck(database, snapshot.deck.id)['version']).toBe(snapshot.deck.version + 1);

    const cleared = await clearActiveProfileHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version + 1,
    });
    expect(cleared?.deck.version).toBe(snapshot.deck.version + 2);
    expect(cleared?.deck.activeSignatureProfileId).toBeUndefined();
    expect(cleared?.deck.activeSignatureProfileDigest).toBeUndefined();
    const clearedVersion = versionSnapshot(database, snapshot.deck.id, snapshot.deck.version + 2);
    expect(clearedVersion.deck.activeSignatureProfileId).toBeUndefined();
    expect(clearedVersion.deck.activeSignatureProfileDigest).toBeUndefined();
    expect(database.rows('nodeslide_versions')).toHaveLength(startingVersionCount + 2);
    expect(
      database
        .rows('nodeslide_validations')
        .map((row) => row['deckVersion'])
        .sort(),
    ).toEqual([snapshot.deck.version + 1, snapshot.deck.version + 2]);
  });

  it('keeps historical versions bound to exact immutable revisions within their tenant', async () => {
    const { database, context, snapshot } = signatureWorkspace('historical-policy');
    const secondRevision = revisedProfile('c');
    await saveStoredProfile(context, snapshot.deck.id, financeIbcsTastePack);
    await saveStoredProfile(context, snapshot.deck.id, secondRevision);
    expect(database.rows('nodeslide_signature_profiles')).toHaveLength(2);
    await expect(
      requireSignatureProfile(context, snapshot.deck.projectId, financeIbcsTastePack.id),
    ).rejects.toThrow(/digest is required/i);

    await activateProfileHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      profileId: financeIbcsTastePack.id,
      profileDigest: financeIbcsTastePack.source.digest,
      baseDeckVersion: snapshot.deck.version,
    });
    await activateProfileHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      profileId: secondRevision.id,
      profileDigest: secondRevision.source.digest,
      baseDeckVersion: snapshot.deck.version + 1,
    });

    const firstHistorical = versionSnapshot(database, snapshot.deck.id, snapshot.deck.version + 1);
    const secondHistorical = versionSnapshot(database, snapshot.deck.id, snapshot.deck.version + 2);
    const firstResolved = await requireDeckSignatureProfile(
      context,
      snapshot.deck.projectId,
      firstHistorical.deck,
    );
    const secondResolved = await requireDeckSignatureProfile(
      context,
      snapshot.deck.projectId,
      secondHistorical.deck,
    );
    expect(firstResolved?.source.digest).toBe(financeIbcsTastePack.source.digest);
    expect(secondResolved?.source.digest).toBe(secondRevision.source.digest);
    expect(firstHistorical.deck.activeSignatureProfileDigest).toBe(
      financeIbcsTastePack.source.digest,
    );

    const otherSnapshot = signatureAppliedSnapshot('other-tenant');
    seedSnapshot(database, otherSnapshot, SECOND_OWNER_ACCESS_KEY);
    await expect(
      activateProfileHandler(context, {
        deckId: otherSnapshot.deck.id,
        ownerAccessKey: SECOND_OWNER_ACCESS_KEY,
        profileId: financeIbcsTastePack.id,
        profileDigest: financeIbcsTastePack.source.digest,
        baseDeckVersion: otherSnapshot.deck.version,
      }),
    ).rejects.toThrow(/profile unavailable/i);
    await expect(
      activateProfileHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: SECOND_OWNER_ACCESS_KEY,
        profileId: financeIbcsTastePack.id,
        profileDigest: financeIbcsTastePack.source.digest,
        baseDeckVersion: snapshot.deck.version + 2,
      }),
    ).rejects.toThrow(/owner access denied/i);
  });
});

function signatureWorkspace(
  sessionId: string,
  ownerAccessKey = OWNER_ACCESS_KEY,
): { database: MemoryDatabase; context: MutationCtx; snapshot: DeckSnapshot } {
  const database = new MemoryDatabase();
  const snapshot = signatureAppliedSnapshot(sessionId);
  seedSnapshot(database, snapshot, ownerAccessKey);
  return { database, context: { db: database } as unknown as MutationCtx, snapshot };
}

function signatureAppliedSnapshot(sessionId: string): DeckSnapshot {
  const source = buildGoldenNodeSlide(sessionId, 1_000).snapshot;
  const application = planSignatureApplication(source, financeIbcsTastePack);
  if (!application.ok) throw new Error(application.error.message);
  return applyDeckPatch(
    source,
    {
      baseDeckVersion: application.plan.baseDeckVersion,
      scope: application.plan.scope,
      operations: application.plan.operations,
    },
    2_000,
  ).snapshot;
}

function seedSnapshot(
  database: MemoryDatabase,
  snapshot: DeckSnapshot,
  ownerAccessKey: string,
): void {
  const now = snapshot.deck.updatedAt;
  database.seed('nodeslide_decks', {
    ...snapshot.deck,
    projectRowId: `projects:${snapshot.deck.projectId}`,
    clientSessionId: snapshot.deck.id,
    ownerAccessKey,
    plan: [],
    spec: {},
  });
  for (const slide of snapshot.slides) {
    database.seed('nodeslide_slides', { ...slide, createdAt: now, updatedAt: now });
  }
  for (const element of snapshot.elements) {
    database.seed('nodeslide_elements', {
      ...element,
      deckId: snapshot.deck.id,
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const source of snapshot.sources) database.seed('nodeslide_sources', source);
  database.seed('nodeslide_versions', {
    id: `version:${snapshot.deck.id}:${snapshot.deck.version}`,
    deckId: snapshot.deck.id,
    version: snapshot.deck.version,
    label: 'Current deck',
    source: 'human',
    snapshot,
    createdAt: now,
  });
}

async function saveStoredProfile(
  context: MutationCtx,
  deckId: string,
  profile: SignatureProfile,
): Promise<void> {
  await saveProfileHandler(context, {
    deckId,
    ownerAccessKey: OWNER_ACCESS_KEY,
    profileJson: JSON.stringify(profile),
  });
}

function revisedProfile(digestCharacter: string): SignatureProfile {
  const profile = structuredClone(financeIbcsTastePack) as SignatureProfile;
  const digest = `sha256:${digestCharacter.repeat(64)}`;
  profile.source.digest = digest;
  profile.evidence = profile.evidence.map((item) => ({ ...item, sourceDigest: digest }));
  return profile;
}

function onlyRow(database: MemoryDatabase, tableName: string): StoredRow {
  const rows = database.rows(tableName);
  if (rows.length !== 1 || !rows[0]) throw new Error(`Expected one ${tableName} row.`);
  return structuredClone(rows[0]);
}

function currentDeck(database: MemoryDatabase, deckId: string): StoredRow {
  const row = database.rows('nodeslide_decks').find((candidate) => candidate['id'] === deckId);
  if (!row) throw new Error(`Deck ${deckId} was not found.`);
  return row;
}

function versionSnapshot(database: MemoryDatabase, deckId: string, version: number): DeckSnapshot {
  const row = database
    .rows('nodeslide_versions')
    .find((candidate) => candidate['deckId'] === deckId && candidate['version'] === version);
  if (!row) throw new Error(`Version ${version} was not found.`);
  return row['snapshot'] as DeckSnapshot;
}

function matchesFilter(candidate: unknown, filter: Filter): boolean {
  if (filter.operation === 'eq') return candidate === filter.value;
  return typeof candidate === 'number' && typeof filter.value === 'number'
    ? candidate > filter.value
    : typeof candidate === 'string' && typeof filter.value === 'string' && candidate > filter.value;
}

function orderFieldForIndex(indexName: string): string {
  if (indexName.endsWith('_version')) return 'version';
  if (indexName.endsWith('_updated')) return 'updatedAt';
  if (indexName.endsWith('_checked')) return 'checkedAt';
  if (indexName.endsWith('_expiry')) return 'expiresAt';
  if (indexName.includes('_created')) return 'createdAt';
  return '_creationTime';
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left ?? '').localeCompare(String(right ?? ''));
}
