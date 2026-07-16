import { describe, expect, it } from 'vitest';
import type { DeckSnapshot, SlideElement } from '../shared/nodeslide';
import type { QueryCtx } from './_generated/server';
import { nodeSlideCandidateDigest } from './lib/nodeslideCandidate';
import { loadNodeSlideSnapshot } from './lib/nodeslideData';
import type { NodeSlideDeckCiResult } from './lib/nodeslideDeckCi';
import { evaluateNodeSlideDeckCi } from './lib/nodeslideDeckCi';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import {
  NODESLIDE_DECK_CI_CHANGED_SOURCE_LIMIT,
  evaluateCurrent,
  evaluateCurrentInternal,
  evaluateLatest,
} from './nodeslideDeckCi';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const SECOND_OWNER_ACCESS_KEY = 'b'.repeat(43);

type StoredRow = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

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

  async collect(): Promise<StoredRow[]> {
    return this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => row[filter.field] === filter.value));
  }

  async first(): Promise<StoredRow | null> {
    return (await this.collect())[0] ?? null;
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }

  seed(tableName: string, value: object): void {
    this.sequence += 1;
    const rows = this.tables.get(tableName) ?? [];
    rows.push({
      ...structuredClone(value),
      _id: `${tableName}:${this.sequence}`,
      _creationTime: this.sequence,
    });
    this.tables.set(tableName, rows);
  }

  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }

  totalRows(): number {
    return [...this.tables.values()].reduce((total, rows) => total + rows.length, 0);
  }
}

type DeckCiArgs = {
  deckId: string;
  ownerAccessKey: string;
  deckVersion: number;
  snapshotDigest: string;
  changedSourceIds?: string[];
};

type QueryHandler = (ctx: QueryCtx, args: DeckCiArgs) => Promise<NodeSlideDeckCiResult>;

function registeredHandler(value: unknown): QueryHandler {
  const handler = (value as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Registered Convex handler is unavailable.');
  return handler as QueryHandler;
}

const evaluateCurrentHandler = registeredHandler(evaluateCurrent);
const evaluateCurrentInternalHandler = registeredHandler(evaluateCurrentInternal);
const evaluateLatestHandler = registeredHandler(evaluateLatest) as unknown as (
  ctx: QueryCtx,
  args: Pick<DeckCiArgs, 'deckId' | 'ownerAccessKey' | 'changedSourceIds'>,
) => Promise<NodeSlideDeckCiResult>;

describe('NodeSlide Deck CI Convex query', () => {
  it('computes the display result from the owner-authorized latest snapshot server-side', async () => {
    const workspace = await createWorkspace('latest-display');
    const result = await evaluateLatestHandler(workspace.context, {
      deckId: workspace.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });

    expect(result).toMatchObject({
      deckId: workspace.snapshot.deck.id,
      deckVersion: workspace.snapshot.deck.version,
      snapshotDigest: nodeSlideCandidateDigest(workspace.snapshot),
    });
    await expect(
      evaluateLatestHandler(workspace.context, {
        deckId: workspace.snapshot.deck.id,
        ownerAccessKey: SECOND_OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/owner access denied/i);
  });

  it('requires the exact owner capability before evaluating', async () => {
    const workspace = await createWorkspace('owner-gate');
    const binding = bindingFor(workspace.snapshot);

    await expect(
      evaluateCurrentHandler(workspace.context, {
        ...binding,
        ownerAccessKey: SECOND_OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/owner access denied/i);
    await expect(
      evaluateCurrentInternalHandler(workspace.context, {
        ...binding,
        ownerAccessKey: 'not-an-owner-key',
      }),
    ).rejects.toThrow(/owner access denied/i);
  });

  it('accepts only the exact authoritative current deck version and digest', async () => {
    const workspace = await createWorkspace('exact-binding');
    const binding = bindingFor(workspace.snapshot);

    await expect(
      evaluateCurrentHandler(workspace.context, {
        ...binding,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).resolves.toMatchObject({
      deckId: workspace.snapshot.deck.id,
      deckVersion: workspace.snapshot.deck.version,
      snapshotDigest: binding.snapshotDigest,
    });
    await expect(
      evaluateCurrentHandler(workspace.context, {
        ...binding,
        ownerAccessKey: OWNER_ACCESS_KEY,
        deckVersion: workspace.snapshot.deck.version - 1,
      }),
    ).rejects.toThrow(/snapshot binding denied/i);
    await expect(
      evaluateCurrentHandler(workspace.context, {
        ...binding,
        ownerAccessKey: OWNER_ACCESS_KEY,
        snapshotDigest: `sha256:${'0'.repeat(64)}`,
      }),
    ).rejects.toThrow(/snapshot binding denied/i);
  });

  it('reports bounded changed-source impact from the authoritative snapshot', async () => {
    const workspace = await createWorkspace('source-impact');
    const changedSourceId = requiredBoundSourceId(workspace.snapshot);
    const missingSourceId = 'source_missing_from_authoritative_snapshot';
    const changedSourceIds = [missingSourceId, changedSourceId, changedSourceId];

    const result = await evaluateCurrentHandler(workspace.context, {
      ...bindingFor(workspace.snapshot),
      ownerAccessKey: OWNER_ACCESS_KEY,
      changedSourceIds,
    });
    const boundElements = workspace.snapshot.elements.filter((element) =>
      sourceIdsForElement(element).includes(changedSourceId),
    );
    const boundSlideIds = workspace.snapshot.deck.slideOrder.filter((slideId) =>
      boundElements.some((element) => element.slideId === slideId),
    );

    expect(result.changedSourceImpact).toMatchObject({
      changedSourceIds: [missingSourceId, changedSourceId].sort(),
      boundSourceIds: [changedSourceId],
      missingSourceIds: [missingSourceId],
      slideIds: boundSlideIds,
      elementIds: boundElements.map((element) => element.id),
    });
    await expect(
      evaluateCurrentHandler(workspace.context, {
        ...bindingFor(workspace.snapshot),
        ownerAccessKey: OWNER_ACCESS_KEY,
        changedSourceIds: Array.from(
          { length: NODESLIDE_DECK_CI_CHANGED_SOURCE_LIMIT + 1 },
          (_, index) => `source-${index}`,
        ),
      }),
    ).rejects.toThrow(/changedSourceIds.*at most/i);
  });

  it('is deterministic across public, internal, and direct pure evaluation without writes', async () => {
    const workspace = await createWorkspace('deterministic');
    const changedSourceIds = [requiredBoundSourceId(workspace.snapshot)];
    const args = {
      ...bindingFor(workspace.snapshot),
      ownerAccessKey: OWNER_ACCESS_KEY,
      changedSourceIds,
    };
    const rowsBefore = workspace.database.totalRows();
    const expected = evaluateNodeSlideDeckCi(structuredClone(workspace.snapshot), {
      changedSourceIds,
    });

    const first = await evaluateCurrentHandler(workspace.context, args);
    const second = await evaluateCurrentHandler(workspace.context, structuredClone(args));
    const internal = await evaluateCurrentInternalHandler(workspace.context, args);

    expect(first).toEqual(expected);
    expect(second).toEqual(first);
    expect(internal).toEqual(first);
    expect(workspace.database.totalRows()).toBe(rowsBefore);
    expect(workspace.database.rows('nodeslide_validations')).toHaveLength(0);
  });

  it('denies a valid owner capability from a different deck', async () => {
    const database = new MemoryDatabase();
    const first = snapshotFor('cross-deck-first');
    const second = snapshotFor('cross-deck-second');
    seedSnapshot(database, first, OWNER_ACCESS_KEY);
    seedSnapshot(database, second, SECOND_OWNER_ACCESS_KEY);
    const context = { db: database } as unknown as QueryCtx;
    const authoritativeSecond = await loadNodeSlideSnapshot(context, second.deck.id);
    if (!authoritativeSecond) throw new Error('Expected the second authoritative snapshot.');

    await expect(
      evaluateCurrentHandler(context, {
        ...bindingFor(authoritativeSecond),
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/owner access denied/i);
  });
});

async function createWorkspace(sessionId: string): Promise<{
  database: MemoryDatabase;
  context: QueryCtx;
  snapshot: DeckSnapshot;
}> {
  const database = new MemoryDatabase();
  const seed = snapshotFor(sessionId);
  seedSnapshot(database, seed, OWNER_ACCESS_KEY);
  const context = { db: database } as unknown as QueryCtx;
  const snapshot = await loadNodeSlideSnapshot(context, seed.deck.id);
  if (!snapshot) throw new Error('Expected the authoritative snapshot.');
  return { database, context, snapshot };
}

function snapshotFor(sessionId: string): DeckSnapshot {
  const snapshot = buildGoldenNodeSlide(sessionId, 10_000).snapshot;
  snapshot.deck.version = 7;
  return snapshot;
}

function bindingFor(snapshot: DeckSnapshot): Omit<DeckCiArgs, 'ownerAccessKey'> {
  return {
    deckId: snapshot.deck.id,
    deckVersion: snapshot.deck.version,
    snapshotDigest: nodeSlideCandidateDigest(snapshot),
  };
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
}

function requiredBoundSourceId(snapshot: DeckSnapshot): string {
  const source = snapshot.sources.find((candidate) =>
    snapshot.elements.some((element) => sourceIdsForElement(element).includes(candidate.id)),
  );
  if (!source) throw new Error('Expected a source-bound element in the golden snapshot.');
  return source.id;
}

function sourceIdsForElement(element: SlideElement): string[] {
  return [
    ...element.sourceIds,
    ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ...(element.math?.sourceId ? [element.math.sourceId] : []),
    ...(element.image?.sourceId ? [element.image.sourceId] : []),
  ];
}
