import { describe, expect, it, vi } from 'vitest';
import type { NodeSlideAgentMemory } from '../shared/nodeslide';
import { normalizeNodeSlideAccessPolicy } from '../shared/nodeslideAccessPolicy';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import {
  nodeSlideWorkspaceCapabilitiesForRole,
  normalizeNodeSlideWorkspaceAccessPolicy,
} from './lib/nodeslideScopeAccess';
import {
  NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT,
  NODESLIDE_SCOPED_MEMORY_RETRIEVAL_MAX_BYTES,
  type NodeSlideScopedMemoryItem,
  archive,
  create,
  createScopedMemoryRecord,
  mergeNodeSlideScopedAndLegacyMemories,
  nodeSlideScopedMemoryScope,
  nodeSlideScopedMemoryScopes,
  retrieve,
  selectNodeSlideScopedMemories,
} from './nodeslideScopedMemory';

const OWNER_A = 'a'.repeat(43);
const OWNER_B = 'b'.repeat(43);
const GRANT_A = 'c'.repeat(43);
const GRANT_B = 'd'.repeat(43);

type StoredRow = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
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
  private indexName = '';
  private direction: 'asc' | 'desc' = 'asc';

  constructor(
    private readonly database: MemoryDatabase,
    private readonly tableName: string,
  ) {}

  withIndex(indexName: string, configure: (index: MemoryIndex) => unknown): this {
    const index = new MemoryIndex();
    configure(index);
    this.indexName = indexName;
    this.filters = index.filters;
    return this;
  }

  order(direction: 'asc' | 'desc'): this {
    this.direction = direction;
    return this;
  }

  async collect(): Promise<StoredRow[]> {
    const rows = this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => row[filter.field] === filter.value));
    const orderField = this.indexName.includes('updated') ? 'updatedAt' : '_creationTime';
    rows.sort((left, right) => compare(left[orderField], right[orderField]));
    if (this.direction === 'desc') rows.reverse();
    return rows;
  }

  async unique(): Promise<StoredRow | null> {
    const rows = await this.collect();
    if (rows.length > 1) throw new Error('Expected a unique row.');
    return rows[0] ?? null;
  }

  async first(): Promise<StoredRow | null> {
    return (await this.collect())[0] ?? null;
  }

  async take(limit: number): Promise<StoredRow[]> {
    return (await this.collect()).slice(0, limit);
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }

  async insert(tableName: string, value: object): Promise<string> {
    return this.seed(tableName, value)._id;
  }

  async patch(rowId: string, fields: object): Promise<void> {
    const row = [...this.tables.values()].flat().find((candidate) => candidate._id === rowId);
    if (!row) throw new Error(`Missing row ${rowId}.`);
    Object.assign(row, structuredClone(fields));
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
}

type RegisteredHandler<Args, Result> = (ctx: MutationCtx | QueryCtx, args: Args) => Promise<Result>;

function registeredHandler<Args, Result>(value: unknown): RegisteredHandler<Args, Result> {
  const handler = (value as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Convex handler is unavailable.');
  return handler as RegisteredHandler<Args, Result>;
}

const createHandler = registeredHandler<
  {
    deckId: string;
    capabilityToken: string;
    scopeKind: 'workspace' | 'project' | 'deck';
    category: 'preference' | 'fact' | 'decision' | 'instruction' | 'context';
    content: string;
  },
  { created: boolean; memory: NodeSlideScopedMemoryItem }
>(create);

const archiveHandler = registeredHandler<
  {
    deckId: string;
    capabilityToken: string;
    memoryId: string;
    contentDigest: string;
    scopeKind: 'workspace' | 'project' | 'deck';
    scopeKey: string;
    bindingDigest: string;
  },
  { archived: boolean; memoryId: string; bindingDigest: string }
>(archive);

const retrieveHandler = registeredHandler<
  { deckId: string; capabilityToken: string; limit?: number },
  NodeSlideScopedMemoryItem[]
>(retrieve);

describe('NodeSlide scoped persistent memory', () => {
  it('requires the exact deck capability, dedupes by normalized content digest, and stores no token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { context, database } = harness();
    const args = {
      deckId: 'deck-a',
      capabilityToken: GRANT_A,
      scopeKind: 'project' as const,
      category: 'instruction' as const,
      content: '  Cite   primary sources. ',
    };

    await expect(createHandler(context, { ...args, capabilityToken: GRANT_B })).rejects.toThrow(
      /scoped memory access denied/i,
    );
    const first = await createHandler(context, args);
    const duplicate = await createHandler(context, {
      ...args,
      content: 'Cite primary sources.',
    });

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ created: false, memory: first.memory });
    const rows = database.rows('nodeslide_scoped_memories');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(GRANT_A);
    expect(rows[0]).not.toHaveProperty('capabilityToken');
    expect(first.memory).not.toHaveProperty('capabilityToken');
    vi.useRealTimers();
  });

  it('denies empty, mismatched, and sibling memory scope keys', async () => {
    const deniedCases: Array<{
      scopeKind: 'workspace' | 'project' | 'deck';
      memoryScopeKeys: readonly string[];
    }> = [
      { scopeKind: 'deck', memoryScopeKeys: [] },
      {
        scopeKind: 'project',
        memoryScopeKeys: [memoryScopeKey('workspace', 'workspace-one')],
      },
      {
        scopeKind: 'project',
        memoryScopeKeys: [memoryScopeKey('project', 'workspace-one', 'project-b')],
      },
      {
        scopeKind: 'deck',
        memoryScopeKeys: [memoryScopeKey('deck', 'workspace-one', 'project-a', 'deck-sibling')],
      },
    ];

    for (const deniedCase of deniedCases) {
      const { context } = harness({ grantAMemoryScopeKeys: deniedCase.memoryScopeKeys });
      await expect(
        createMemory(
          context,
          'deck-a',
          GRANT_A,
          deniedCase.scopeKind,
          `Denied ${deniedCase.scopeKind} memory.`,
        ),
      ).rejects.toThrow(/scoped memory access denied/i);
    }

    const deniedReadKeys = [
      [],
      [memoryScopeKey('deck', 'workspace-one', 'project-a', 'deck-a')],
      [
        memoryScopeKey('workspace', 'workspace-one'),
        memoryScopeKey('project', 'workspace-one', 'project-b'),
        memoryScopeKey('deck', 'workspace-one', 'project-a', 'deck-a'),
      ],
    ];
    for (const memoryScopeKeys of deniedReadKeys) {
      const { context } = harness({ grantAMemoryScopeKeys: memoryScopeKeys });
      await expect(
        retrieveHandler(context, { deckId: 'deck-a', capabilityToken: GRANT_A }),
      ).rejects.toThrow(/scoped memory access denied/i);
    }
  });

  it('enforces deck then project then workspace precedence without sibling-project leakage', async () => {
    const { context } = harness();
    await createMemory(context, 'deck-a', GRANT_A, 'workspace', 'Workspace citation standard.');
    await createMemory(context, 'deck-a', GRANT_A, 'project', 'Project narrative standard.');
    await createMemory(context, 'deck-a', GRANT_A, 'project', 'Shared visual standard.');
    const deckDuplicate = await createMemory(
      context,
      'deck-a',
      GRANT_A,
      'deck',
      'Shared visual standard.',
    );
    await createMemory(context, 'deck-b', GRANT_B, 'project', 'Sibling project secret.');
    await expect(
      createMemory(context, 'deck-b', GRANT_B, 'workspace', 'Forged workspace standard.'),
    ).rejects.toThrow(/scoped memory access denied/i);
    const temporary = await createMemory(
      context,
      'deck-a',
      GRANT_A,
      'deck',
      'Temporary archived note.',
    );

    await expect(
      archiveHandler(context, {
        deckId: 'deck-a',
        capabilityToken: GRANT_A,
        memoryId: temporary.id,
        contentDigest: nodeslideContentDigest('wrong'),
        scopeKind: temporary.binding.kind,
        scopeKey: temporary.binding.scopeKey,
        bindingDigest: temporary.binding.bindingDigest,
      }),
    ).rejects.toThrow(/binding mismatch/i);
    await archiveHandler(context, archiveArgs('deck-a', GRANT_A, temporary));

    const selected = await retrieveHandler(context, {
      deckId: 'deck-a',
      capabilityToken: GRANT_A,
    });
    expect(selected.map((memory) => memory.content)).toEqual([
      'Shared visual standard.',
      'Project narrative standard.',
      'Workspace citation standard.',
    ]);
    expect(selected[0]).toEqual(deckDuplicate);
    expect(selected.map((memory) => memory.content)).not.toContain('Sibling project secret.');
    expect(selected.map((memory) => memory.content)).not.toContain('Temporary archived note.');
    expect(selected.map((memory) => memory.binding.kind)).toEqual(['deck', 'project', 'workspace']);
    for (const memory of selected) {
      expect(memory.binding).toMatchObject({
        memoryId: memory.id,
        contentDigest: memory.contentDigest,
      });
      expect(memory.binding.bindingDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    }
  });

  it('rejects malformed bindings and enforces both the six-item and UTF-8 byte ceilings', () => {
    const deck = deckDescriptor('deck-a', 'project-a', 'workspace-one');
    const scopes = nodeSlideScopedMemoryScopes(deck);
    const deckScope = nodeSlideScopedMemoryScope(deck, 'deck');
    const rows = Array.from({ length: 8 }, (_, index) =>
      createScopedMemoryRecord({
        scope: deckScope,
        category: 'context',
        content: `Bounded memory ${index}`,
        source: 'user',
        now: 1_000 + index,
      }),
    );
    const tampered = { ...rows[0], id: 'memory-forged' };
    const selected = selectNodeSlideScopedMemories([...rows, tampered], scopes, 99);
    expect(selected).toHaveLength(NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT);
    expect(selected.map((memory) => memory.id)).not.toContain('memory-forged');

    const multibyteRows = Array.from({ length: 6 }, (_, index) =>
      createScopedMemoryRecord({
        scope: deckScope,
        category: 'context',
        content: `${index}:${'😀'.repeat(290)}`,
        source: 'user',
        now: 2_000 + index,
      }),
    );
    const byteBounded = selectNodeSlideScopedMemories(multibyteRows, scopes);
    expect(byteBounded.length).toBeLessThan(NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT);
    expect(totalBytes(byteBounded)).toBeLessThanOrEqual(
      NODESLIDE_SCOPED_MEMORY_RETRIEVAL_MAX_BYTES,
    );
  });

  it('merges exact legacy deck memories without weakening scope, archive, digest, or bounds', () => {
    const deck = deckDescriptor('deck-a', 'project-a', 'workspace-one');
    const scopes = nodeSlideScopedMemoryScopes(deck);
    const scoped = createScopedMemoryRecord({
      scope: nodeSlideScopedMemoryScope(deck, 'deck'),
      category: 'instruction',
      content: 'Keep claims sourced.',
      source: 'user',
      now: 2_000,
    });
    const merged = mergeNodeSlideScopedAndLegacyMemories({
      scopedRows: [scoped],
      scopes,
      legacyMemories: [
        legacyMemory('legacy-duplicate', 'deck-a', 'Keep claims sourced.'),
        legacyMemory('legacy-active', 'deck-a', 'Use the approved company palette.'),
        legacyMemory('legacy-archived', 'deck-a', 'Archived note.', 'archived'),
        legacyMemory('legacy-sibling', 'deck-b', 'Sibling deck note.'),
        { ...legacyMemory('legacy-tampered', 'deck-a', 'Tampered digest.'), contentDigest: 'bad' },
      ],
    });

    expect(merged.map((memory) => [memory.origin, memory.content])).toEqual([
      ['scoped', 'Keep claims sourced.'],
      ['legacy', 'Use the approved company palette.'],
    ]);
    expect(totalBytes(merged)).toBeLessThanOrEqual(NODESLIDE_SCOPED_MEMORY_RETRIEVAL_MAX_BYTES);
  });

  it('ranks scoped and legacy deck memories ahead of project and workspace under the ceiling', () => {
    const deck = deckDescriptor('deck-a', 'project-a', 'workspace-one');
    const scopes = nodeSlideScopedMemoryScopes(deck);
    const scopedRows = [
      createScopedMemoryRecord({
        scope: nodeSlideScopedMemoryScope(deck, 'workspace'),
        category: 'context',
        content: 'Newest workspace memory.',
        source: 'user',
        now: 9_000,
      }),
      createScopedMemoryRecord({
        scope: nodeSlideScopedMemoryScope(deck, 'project'),
        category: 'context',
        content: 'Deck duplicate should lose at project scope.',
        source: 'user',
        now: 8_000,
      }),
      createScopedMemoryRecord({
        scope: nodeSlideScopedMemoryScope(deck, 'project'),
        category: 'context',
        content: 'Newest project memory.',
        source: 'user',
        now: 7_000,
      }),
      createScopedMemoryRecord({
        scope: nodeSlideScopedMemoryScope(deck, 'deck'),
        category: 'context',
        content: 'Scoped deck memory.',
        source: 'user',
        now: 1_000,
      }),
    ];
    const merged = mergeNodeSlideScopedAndLegacyMemories({
      scopedRows,
      scopes,
      legacyMemories: [
        legacyMemory('legacy-deck', 'deck-a', 'Legacy deck memory.'),
        legacyMemory(
          'legacy-project-duplicate',
          'deck-a',
          'Deck duplicate should lose at project scope.',
        ),
      ],
      requestedLimit: 3,
    });

    expect(merged.map((memory) => [memory.origin, memory.content])).toEqual([
      ['scoped', 'Scoped deck memory.'],
      ['legacy', 'Legacy deck memory.'],
      ['legacy', 'Deck duplicate should lose at project scope.'],
    ]);
    expect(merged.every((memory) => memory.binding.kind === 'deck')).toBe(true);
  });
});

function harness(options: { grantAMemoryScopeKeys?: readonly string[] } = {}): {
  database: MemoryDatabase;
  context: MutationCtx & QueryCtx;
} {
  const database = new MemoryDatabase();
  database.seed('nodeslide_decks', {
    ...deckDescriptor('deck-a', 'project-a', 'workspace-one'),
    ownerAccessKey: OWNER_A,
  });
  database.seed('nodeslide_decks', {
    ...deckDescriptor('deck-b', 'project-b', 'workspace-one'),
    ownerAccessKey: OWNER_B,
  });
  seedGrant(
    database,
    GRANT_A,
    'workspace-one',
    'deck-a',
    undefined,
    options.grantAMemoryScopeKeys ?? [
      memoryScopeKey('workspace', 'workspace-one'),
      memoryScopeKey('project', 'workspace-one', 'project-a'),
      memoryScopeKey('deck', 'workspace-one', 'project-a', 'deck-a'),
    ],
  );
  seedGrant(database, GRANT_B, 'workspace-one', 'deck-b', 'project-b', [
    memoryScopeKey('workspace', 'workspace-one'),
    memoryScopeKey('project', 'workspace-one', 'project-b'),
    memoryScopeKey('deck', 'workspace-one', 'project-b', 'deck-b'),
  ]);
  return {
    database,
    context: { db: database } as unknown as MutationCtx & QueryCtx,
  };
}

function deckDescriptor(id: string, projectId: string, clientSessionId: string) {
  return {
    id,
    projectId: `legacy-${projectId}`,
    clientSessionId: `legacy-${clientSessionId}`,
    workspaceId: clientSessionId,
    workspaceProjectId: projectId,
  };
}

function seedGrant(
  database: MemoryDatabase,
  token: string,
  workspaceId: string,
  deckId: string,
  projectId?: string,
  memoryScopeKeys: readonly string[] = [],
): void {
  const role = projectId ? 'editor' : 'owner';
  const agentPolicy = normalizeNodeSlideAccessPolicy({
    role: 'researcher',
    capabilities: ['deck:read', 'memory:read', 'memory:write'],
    scopes: {
      deckIds: [deckId],
      sourceIds: [],
      providerIds: [],
      modelIds: [],
      toolIds: [],
      memoryScopeKeys,
    },
    budget: {},
  });
  const policy = normalizeNodeSlideWorkspaceAccessPolicy({
    workspaceId,
    role,
    projectScope: projectId ? { kind: 'project', projectId } : { kind: 'workspace' },
    capabilities: nodeSlideWorkspaceCapabilitiesForRole(role),
    agentPolicy,
  });
  database.seed('nodeslide_access_grants', {
    id: `grant-${deckId}`,
    workspaceId,
    ...(projectId ? { projectId } : {}),
    role,
    tokenDigest: nodeslideContentDigest(`nodeslide-workspace-grant\u001f${token}`),
    policy,
    expiresAt: 9_000_000_000_000,
    createdAt: 1,
  });
}

function memoryScopeKey(
  kind: 'workspace' | 'project' | 'deck',
  workspaceId: string,
  projectId?: string,
  deckId?: string,
): string {
  const deck = deckDescriptor(deckId ?? 'scope-deck', projectId ?? 'scope-project', workspaceId);
  return nodeSlideScopedMemoryScope(deck, kind).scopeKey;
}

async function createMemory(
  context: MutationCtx & QueryCtx,
  deckId: string,
  capabilityToken: string,
  scopeKind: 'workspace' | 'project' | 'deck',
  content: string,
): Promise<NodeSlideScopedMemoryItem> {
  return (
    await createHandler(context, {
      deckId,
      capabilityToken,
      scopeKind,
      category: 'context',
      content,
    })
  ).memory;
}

function archiveArgs(deckId: string, capabilityToken: string, memory: NodeSlideScopedMemoryItem) {
  return {
    deckId,
    capabilityToken,
    memoryId: memory.id,
    contentDigest: memory.contentDigest,
    scopeKind: memory.binding.kind,
    scopeKey: memory.binding.scopeKey,
    bindingDigest: memory.binding.bindingDigest,
  };
}

function legacyMemory(
  id: string,
  deckId: string,
  content: string,
  status: NodeSlideAgentMemory['status'] = 'active',
): NodeSlideAgentMemory {
  return {
    id,
    deckId,
    category: 'context',
    content,
    status,
    source: 'user',
    contentDigest: nodeslideContentDigest(content),
    createdAt: 1_000,
    updatedAt: 1_000,
    useCount: 0,
  };
}

function totalBytes(memories: readonly NodeSlideScopedMemoryItem[]): number {
  return memories.reduce(
    (total, memory) => total + new TextEncoder().encode(memory.content).byteLength,
    0,
  );
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left ?? '').localeCompare(String(right ?? ''));
}
