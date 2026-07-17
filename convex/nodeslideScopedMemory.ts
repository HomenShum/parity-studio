import { v } from 'convex/values';
import type { NodeSlideAgentMemory, NodeSlideAgentMemoryCategory } from '../shared/nodeslide';
import { nodeSlideMemoryScopeKey } from '../shared/nodeslideAccessPolicy';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { findDeckRow } from './lib/nodeslideData';
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';
import {
  evaluateNodeSlideWorkspaceAccess,
  isNodeSlideWorkspaceAccessPolicy,
} from './lib/nodeslideScopeAccess';

export const NODESLIDE_SCOPED_MEMORY_VERSION = 'nodeslide.scoped-memory/v1' as const;
export const NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT = 6;
export const NODESLIDE_SCOPED_MEMORY_RETRIEVAL_MAX_BYTES = 4_800;
export const NODESLIDE_SCOPED_MEMORY_MAX_CONTENT_LENGTH = 800;
const NODESLIDE_SCOPED_MEMORY_QUERY_LIMIT = 48;
const WORKSPACE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SCOPE_ACCESS_DENIED = 'NodeSlide scoped memory access denied.';

export type NodeSlideScopedMemoryScopeKind = 'workspace' | 'project' | 'deck';
export type NodeSlideScopedMemoryStatus = 'active' | 'archived';

export interface NodeSlideScopedMemoryScope {
  readonly kind: NodeSlideScopedMemoryScopeKind;
  readonly scopeKey: string;
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly deckId?: string;
}

export interface NodeSlideScopedMemoryBinding extends NodeSlideScopedMemoryScope {
  readonly memoryId: string;
  readonly contentDigest: string;
  readonly bindingDigest: string;
}

export interface NodeSlideScopedMemoryItem {
  readonly origin: 'scoped' | 'legacy';
  readonly id: string;
  readonly category: NodeSlideAgentMemoryCategory;
  readonly content: string;
  readonly status: NodeSlideScopedMemoryStatus;
  readonly source: 'user' | 'agent';
  readonly sourceRunId?: string;
  readonly contentDigest: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastUsedAt?: number;
  readonly useCount: number;
  readonly binding: NodeSlideScopedMemoryBinding;
}

export interface NodeSlideScopedMemoryRecord {
  readonly id: string;
  readonly schemaVersion: typeof NODESLIDE_SCOPED_MEMORY_VERSION;
  readonly scopeKind: NodeSlideScopedMemoryScopeKind;
  readonly scopeKey: string;
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly deckId?: string;
  readonly category: NodeSlideAgentMemoryCategory;
  readonly content: string;
  readonly contentDigest: string;
  readonly bindingDigest: string;
  readonly status: NodeSlideScopedMemoryStatus;
  readonly source: 'user' | 'agent';
  readonly sourceRunId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastUsedAt?: number;
  readonly useCount: number;
}

const scopeKindValidator = v.union(v.literal('workspace'), v.literal('project'), v.literal('deck'));

const memoryCategoryValidator = v.union(
  v.literal('preference'),
  v.literal('fact'),
  v.literal('decision'),
  v.literal('instruction'),
  v.literal('context'),
);

type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;
type AuthorizedDeck = Pick<
  Doc<'nodeslide_decks'>,
  'id' | 'projectId' | 'clientSessionId' | 'ownerAccessKey' | 'workspaceId' | 'workspaceProjectId'
>;

/**
 * Creates one scoped memory. The capability token is consumed only by the
 * access gate and is never copied into a row or response.
 */
export const create = mutation({
  args: {
    deckId: v.string(),
    capabilityToken: v.string(),
    scopeKind: scopeKindValidator,
    category: memoryCategoryValidator,
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const deck = await authorizeScopedMemory(
      ctx,
      args.deckId,
      args.capabilityToken,
      'write',
      args.scopeKind,
    );
    const scope = nodeSlideScopedMemoryScope(deck, args.scopeKind);
    const content = normalizeScopedMemoryContent(args.content);
    const contentDigest = nodeslideContentDigest(content);
    const existing = await ctx.db
      .query('nodeslide_scoped_memories')
      .withIndex('by_scope_digest', (index) =>
        index.eq('scopeKey', scope.scopeKey).eq('contentDigest', contentDigest),
      )
      .unique();

    if (existing) {
      if (!isExactScopedMemoryRecord(existing, scope) || existing.status === 'archived') {
        throw new Error('Matching scoped memory is archived or has an invalid binding.');
      }
      return { created: false, memory: scopedMemoryItem(existing) };
    }

    const now = Date.now();
    const record = createScopedMemoryRecord({
      scope,
      category: args.category,
      content,
      source: 'user',
      now,
    });
    await ctx.db.insert('nodeslide_scoped_memories', record);
    return { created: true, memory: scopedMemoryItem(record) };
  },
});

/** Archives only an exact id, content digest, scope, and binding tuple. */
export const archive = mutation({
  args: {
    deckId: v.string(),
    capabilityToken: v.string(),
    memoryId: v.string(),
    contentDigest: v.string(),
    scopeKind: scopeKindValidator,
    scopeKey: v.string(),
    bindingDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const deck = await authorizeScopedMemory(
      ctx,
      args.deckId,
      args.capabilityToken,
      'write',
      args.scopeKind,
    );
    const expectedScope = nodeSlideScopedMemoryScope(deck, args.scopeKind);
    const row = await ctx.db
      .query('nodeslide_scoped_memories')
      .withIndex('by_stable_id', (index) => index.eq('id', args.memoryId))
      .unique();
    if (
      !row ||
      row.id !== args.memoryId ||
      row.contentDigest !== args.contentDigest ||
      row.scopeKey !== args.scopeKey ||
      row.bindingDigest !== args.bindingDigest ||
      !isExactScopedMemoryRecord(row, expectedScope)
    ) {
      throw new Error('Scoped memory binding mismatch.');
    }
    if (row.status !== 'archived') {
      await ctx.db.patch(row._id, { status: 'archived', updatedAt: Date.now() });
    }
    return { archived: true, memoryId: row.id, bindingDigest: row.bindingDigest };
  },
});

/** Retrieves only active rows from the exact authorized hierarchy. */
export const retrieve = query({
  args: {
    deckId: v.string(),
    capabilityToken: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deck = await authorizeScopedMemory(ctx, args.deckId, args.capabilityToken, 'read');
    const scopes = nodeSlideScopedMemoryScopes(deck);
    const rows = (
      await Promise.all(
        scopes.map(
          async (scope) =>
            await ctx.db
              .query('nodeslide_scoped_memories')
              .withIndex('by_scope_status_updated', (index) =>
                index.eq('scopeKey', scope.scopeKey).eq('status', 'active'),
              )
              .order('desc')
              .take(NODESLIDE_SCOPED_MEMORY_QUERY_LIMIT),
        ),
      )
    ).flat();
    return selectNodeSlideScopedMemories(rows, scopes, args.limit);
  },
});

/**
 * Durable agent jobs are already authorized by the deck owner capability. This
 * internal path derives the hierarchy from the authoritative deck and returns
 * the exact scoped bindings that must be persisted on the run and trace.
 */
export const retrieveForOwnerInternal = internalQuery({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const scopes = nodeSlideScopedMemoryScopes(deck);
    const rows = (
      await Promise.all(
        scopes.map(
          async (scope) =>
            await ctx.db
              .query('nodeslide_scoped_memories')
              .withIndex('by_scope_status_updated', (index) =>
                index.eq('scopeKey', scope.scopeKey).eq('status', 'active'),
              )
              .order('desc')
              .take(NODESLIDE_SCOPED_MEMORY_QUERY_LIMIT),
        ),
      )
    ).flat();
    return selectNodeSlideScopedMemories(rows, scopes, args.limit);
  },
});

/** Marks only exact memory/binding pairs returned by the internal retrieval. */
export const markUsedForOwnerInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    bindings: v.array(
      v.object({
        memoryId: v.string(),
        contentDigest: v.string(),
        bindingDigest: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const scopes = new Map(
      nodeSlideScopedMemoryScopes(deck).map((scope) => [scope.scopeKey, scope]),
    );
    const now = Date.now();
    let updated = 0;
    for (const binding of args.bindings.slice(0, NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT)) {
      const row = await ctx.db
        .query('nodeslide_scoped_memories')
        .withIndex('by_stable_id', (index) => index.eq('id', binding.memoryId))
        .unique();
      const scope = row ? scopes.get(row.scopeKey) : undefined;
      if (
        !row ||
        !scope ||
        row.status !== 'active' ||
        row.contentDigest !== binding.contentDigest ||
        row.bindingDigest !== binding.bindingDigest ||
        !isExactScopedMemoryRecord(row, scope)
      ) {
        continue;
      }
      await ctx.db.patch(row._id, {
        lastUsedAt: now,
        useCount: Math.max(0, row.useCount) + 1,
        updatedAt: now,
      });
      updated += 1;
    }
    return { updated };
  },
});

/**
 * Attached decks use the workspace grant policy from nodeslideScopeAccess.
 * Unattached legacy decks retain their existing owner capability path. Every
 * scope identifier is derived from the authoritative deck, never caller input.
 */
async function authorizeScopedMemory(
  ctx: ReadCtx,
  deckId: string,
  capabilityToken: string,
  operation: 'read' | 'write',
  writeScopeKind?: NodeSlideScopedMemoryScopeKind,
): Promise<AuthorizedDeck> {
  const deck = await findDeckRow(ctx, deckId);
  if (!deck) throw new Error(SCOPE_ACCESS_DENIED);
  if (deck.workspaceId === undefined && deck.workspaceProjectId === undefined) {
    return await requireOwnerAccess(ctx, deckId, capabilityToken);
  }
  if (
    !deck.workspaceId ||
    !deck.workspaceProjectId ||
    !WORKSPACE_TOKEN_PATTERN.test(capabilityToken)
  ) {
    throw new Error(SCOPE_ACCESS_DENIED);
  }
  const grant = await ctx.db
    .query('nodeslide_access_grants')
    .withIndex('by_token_digest', (index) =>
      index.eq('tokenDigest', workspaceGrantTokenDigest(capabilityToken)),
    )
    .unique();
  if (
    !grant ||
    grant.workspaceId !== deck.workspaceId ||
    grant.revokedAt !== undefined ||
    Date.now() >= grant.expiresAt ||
    !isNodeSlideWorkspaceAccessPolicy(grant.policy) ||
    grant.policy.workspaceId !== grant.workspaceId ||
    grant.policy.role !== grant.role ||
    (grant.projectId === undefined
      ? grant.policy.projectScope.kind !== 'workspace'
      : grant.policy.projectScope.kind !== 'project' ||
        grant.policy.projectScope.projectId !== grant.projectId)
  ) {
    throw new Error(SCOPE_ACCESS_DENIED);
  }
  const workspaceDecision = evaluateNodeSlideWorkspaceAccess(grant.policy, {
    workspaceId: deck.workspaceId,
    capability: 'deck:read',
    projectId: deck.workspaceProjectId,
  });
  const memoryCapability = operation === 'write' ? 'memory:write' : 'memory:read';
  const requiredMemoryScopes =
    operation === 'read'
      ? nodeSlideScopedMemoryScopes(deck)
      : writeScopeKind
        ? [nodeSlideScopedMemoryScope(deck, writeScopeKind)]
        : [];
  if (
    !workspaceDecision.allowed ||
    requiredMemoryScopes.length === 0 ||
    !grant.policy.agentPolicy.capabilities.includes(memoryCapability) ||
    !grant.policy.agentPolicy.scopes.deckIds.includes(deck.id) ||
    !requiredMemoryScopes.every((scope) =>
      grant.policy.agentPolicy.scopes.memoryScopeKeys.includes(scope.scopeKey),
    ) ||
    (operation === 'write' &&
      writeScopeKind === 'workspace' &&
      grant.policy.projectScope.kind !== 'workspace')
  ) {
    throw new Error(SCOPE_ACCESS_DENIED);
  }
  return deck;
}

export function nodeSlideScopedMemoryScopes(deck: {
  readonly id: string;
  readonly projectId: string;
  readonly clientSessionId: string;
  readonly workspaceId?: string;
  readonly workspaceProjectId?: string;
}): NodeSlideScopedMemoryScope[] {
  return [
    nodeSlideScopedMemoryScope(deck, 'workspace'),
    nodeSlideScopedMemoryScope(deck, 'project'),
    nodeSlideScopedMemoryScope(deck, 'deck'),
  ];
}

export function nodeSlideScopedMemoryScope(
  deck: {
    readonly id: string;
    readonly projectId: string;
    readonly clientSessionId: string;
    readonly workspaceId?: string;
    readonly workspaceProjectId?: string;
  },
  kind: NodeSlideScopedMemoryScopeKind,
): NodeSlideScopedMemoryScope {
  if ((deck.workspaceId === undefined) !== (deck.workspaceProjectId === undefined)) {
    throw new Error('Invalid scoped memory workspace attachment.');
  }
  const workspaceId = boundedIdentifier(deck.workspaceId ?? deck.clientSessionId, 'workspaceId');
  const projectId = boundedIdentifier(deck.workspaceProjectId ?? deck.projectId, 'projectId');
  const deckId = boundedIdentifier(deck.id, 'deckId');
  if (kind === 'workspace') {
    return {
      kind,
      scopeKey: nodeSlideMemoryScopeKey({ kind, workspaceId }),
      workspaceId,
    };
  }
  if (kind === 'project') {
    return {
      kind,
      scopeKey: nodeSlideMemoryScopeKey({ kind, workspaceId, projectId }),
      workspaceId,
      projectId,
    };
  }
  return {
    kind,
    scopeKey: nodeSlideMemoryScopeKey({ kind, workspaceId, projectId, deckId }),
    workspaceId,
    projectId,
    deckId,
  };
}

export function createScopedMemoryRecord(args: {
  readonly scope: NodeSlideScopedMemoryScope;
  readonly category: NodeSlideAgentMemoryCategory;
  readonly content: string;
  readonly source: 'user' | 'agent';
  readonly sourceRunId?: string;
  readonly now: number;
}): NodeSlideScopedMemoryRecord {
  const content = normalizeScopedMemoryContent(args.content);
  const contentDigest = nodeslideContentDigest(content);
  const id = nodeslideStableId('scoped_memory', args.scope.scopeKey, contentDigest);
  const bindingDigest = scopedMemoryBindingDigest({
    ...args.scope,
    memoryId: id,
    contentDigest,
  });
  return {
    id,
    schemaVersion: NODESLIDE_SCOPED_MEMORY_VERSION,
    scopeKind: args.scope.kind,
    scopeKey: args.scope.scopeKey,
    workspaceId: args.scope.workspaceId,
    ...(args.scope.projectId ? { projectId: args.scope.projectId } : {}),
    ...(args.scope.deckId ? { deckId: args.scope.deckId } : {}),
    category: args.category,
    content,
    contentDigest,
    bindingDigest,
    status: 'active',
    source: args.source,
    ...(args.sourceRunId ? { sourceRunId: args.sourceRunId } : {}),
    createdAt: args.now,
    updatedAt: args.now,
    useCount: 0,
  };
}

export function selectNodeSlideScopedMemories(
  rows: readonly NodeSlideScopedMemoryRecord[],
  authorizedScopes: readonly NodeSlideScopedMemoryScope[],
  requestedLimit = NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT,
): NodeSlideScopedMemoryItem[] {
  const scopesByKey = new Map(authorizedScopes.map((scope) => [scope.scopeKey, scope]));
  const limit = boundedRetrievalLimit(requestedLimit);
  const ranked = rows
    .filter((row) => {
      const scope = scopesByKey.get(row.scopeKey);
      return (
        row.status === 'active' && scope !== undefined && isExactScopedMemoryRecord(row, scope)
      );
    })
    .sort(
      (left, right) =>
        scopeRank(right.scopeKind) - scopeRank(left.scopeKind) ||
        right.updatedAt - left.updatedAt ||
        left.id.localeCompare(right.id),
    );

  const selected: NodeSlideScopedMemoryItem[] = [];
  const contentDigests = new Set<string>();
  let bytes = 0;
  for (const row of ranked) {
    if (selected.length >= limit) break;
    if (contentDigests.has(row.contentDigest)) continue;
    const rowBytes = utf8Bytes(row.content);
    if (bytes + rowBytes > NODESLIDE_SCOPED_MEMORY_RETRIEVAL_MAX_BYTES) continue;
    selected.push(scopedMemoryItem(row));
    contentDigests.add(row.contentDigest);
    bytes += rowBytes;
  }
  return selected;
}

/**
 * Pure compatibility bridge for the existing deck-only memory table. Every
 * deck-level row outranks project/workspace rows; scoped rows win same-rank
 * digest collisions. Legacy rows can only join the exact deck and remain
 * subject to the same item and byte ceilings.
 */
export function mergeNodeSlideScopedAndLegacyMemories(args: {
  readonly scopedRows: readonly NodeSlideScopedMemoryRecord[];
  readonly legacyMemories: readonly NodeSlideAgentMemory[];
  readonly scopes: readonly NodeSlideScopedMemoryScope[];
  readonly requestedLimit?: number;
}): NodeSlideScopedMemoryItem[] {
  const limit = boundedRetrievalLimit(args.requestedLimit);
  const scopesByKey = new Map(args.scopes.map((scope) => [scope.scopeKey, scope]));
  const deckScope = args.scopes.find((scope) => scope.kind === 'deck');
  const scoped = args.scopedRows.flatMap((row) => {
    const scope = scopesByKey.get(row.scopeKey);
    return row.status === 'active' && scope && isExactScopedMemoryRecord(row, scope)
      ? [scopedMemoryItem(row)]
      : [];
  });
  const legacy = deckScope
    ? args.legacyMemories
        .filter(
          (memory) =>
            memory.deckId === deckScope.deckId &&
            memory.status === 'active' &&
            memory.contentDigest === nodeslideContentDigest(memory.content),
        )
        .map((memory): NodeSlideScopedMemoryItem => {
          const binding = legacyMemoryBinding(deckScope, memory);
          return {
            origin: 'legacy',
            id: memory.id,
            category: memory.category,
            content: memory.content,
            status: memory.status,
            source: memory.source,
            ...(memory.sourceRunId ? { sourceRunId: memory.sourceRunId } : {}),
            contentDigest: memory.contentDigest,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt,
            ...(memory.lastUsedAt ? { lastUsedAt: memory.lastUsedAt } : {}),
            useCount: memory.useCount,
            binding,
          };
        })
    : [];
  const winnersByDigest = new Map<string, NodeSlideScopedMemoryItem>();
  for (const memory of [...scoped, ...legacy]) {
    const existing = winnersByDigest.get(memory.contentDigest);
    if (!existing || compareMemoryDigestPrecedence(memory, existing) < 0) {
      winnersByDigest.set(memory.contentDigest, memory);
    }
  }
  const ranked = [...winnersByDigest.values()].sort(compareMemoryRetrievalPrecedence);
  const selected: NodeSlideScopedMemoryItem[] = [];
  let bytes = 0;
  for (const memory of ranked) {
    if (selected.length >= limit) break;
    const memoryBytes = utf8Bytes(memory.content);
    if (bytes + memoryBytes > NODESLIDE_SCOPED_MEMORY_RETRIEVAL_MAX_BYTES) continue;
    selected.push(memory);
    bytes += memoryBytes;
  }
  return selected;
}

function compareMemoryDigestPrecedence(
  left: NodeSlideScopedMemoryItem,
  right: NodeSlideScopedMemoryItem,
): number {
  return (
    scopeRank(right.binding.kind) - scopeRank(left.binding.kind) ||
    Number(right.origin === 'scoped') - Number(left.origin === 'scoped') ||
    right.updatedAt - left.updatedAt ||
    left.id.localeCompare(right.id)
  );
}

function compareMemoryRetrievalPrecedence(
  left: NodeSlideScopedMemoryItem,
  right: NodeSlideScopedMemoryItem,
): number {
  return (
    scopeRank(right.binding.kind) - scopeRank(left.binding.kind) ||
    right.updatedAt - left.updatedAt ||
    Number(right.origin === 'scoped') - Number(left.origin === 'scoped') ||
    left.id.localeCompare(right.id)
  );
}

function isExactScopedMemoryRecord(
  row: NodeSlideScopedMemoryRecord,
  expectedScope: NodeSlideScopedMemoryScope,
): boolean {
  const expectedId = nodeslideStableId('scoped_memory', expectedScope.scopeKey, row.contentDigest);
  const expectedBinding = scopedMemoryBindingDigest({
    ...expectedScope,
    memoryId: row.id,
    contentDigest: row.contentDigest,
  });
  return (
    row.schemaVersion === NODESLIDE_SCOPED_MEMORY_VERSION &&
    row.scopeKind === expectedScope.kind &&
    row.scopeKey === expectedScope.scopeKey &&
    row.workspaceId === expectedScope.workspaceId &&
    row.projectId === expectedScope.projectId &&
    row.deckId === expectedScope.deckId &&
    row.id === expectedId &&
    row.contentDigest === nodeslideContentDigest(row.content) &&
    row.bindingDigest === expectedBinding
  );
}

function scopedMemoryItem(row: NodeSlideScopedMemoryRecord): NodeSlideScopedMemoryItem {
  const binding: NodeSlideScopedMemoryBinding = {
    kind: row.scopeKind,
    scopeKey: row.scopeKey,
    workspaceId: row.workspaceId,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.deckId ? { deckId: row.deckId } : {}),
    memoryId: row.id,
    contentDigest: row.contentDigest,
    bindingDigest: row.bindingDigest,
  };
  return {
    origin: 'scoped',
    id: row.id,
    category: row.category,
    content: row.content,
    status: row.status,
    source: row.source,
    ...(row.sourceRunId ? { sourceRunId: row.sourceRunId } : {}),
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
    useCount: row.useCount,
    binding,
  };
}

function legacyMemoryBinding(
  deckScope: NodeSlideScopedMemoryScope,
  memory: NodeSlideAgentMemory,
): NodeSlideScopedMemoryBinding {
  const binding = {
    ...deckScope,
    memoryId: memory.id,
    contentDigest: memory.contentDigest,
  };
  return { ...binding, bindingDigest: scopedMemoryBindingDigest(binding, 'legacy') };
}

function scopedMemoryBindingDigest(
  binding: Omit<NodeSlideScopedMemoryBinding, 'bindingDigest'>,
  origin: 'scoped' | 'legacy' = 'scoped',
): string {
  return nodeslideContentDigest(
    JSON.stringify([
      NODESLIDE_SCOPED_MEMORY_VERSION,
      origin,
      binding.kind,
      binding.scopeKey,
      binding.workspaceId,
      binding.projectId ?? null,
      binding.deckId ?? null,
      binding.memoryId,
      binding.contentDigest,
    ]),
  );
}

function normalizeScopedMemoryContent(value: string): string {
  const content = value.replace(/\s+/gu, ' ').trim();
  if (!content) throw new Error('Scoped memory content is required.');
  if (content.length > NODESLIDE_SCOPED_MEMORY_MAX_CONTENT_LENGTH) {
    throw new Error(
      `Scoped memory content exceeds ${NODESLIDE_SCOPED_MEMORY_MAX_CONTENT_LENGTH} characters.`,
    );
  }
  return content;
}

function boundedRetrievalLimit(requestedLimit?: number): number {
  if (requestedLimit === undefined || !Number.isFinite(requestedLimit)) {
    return NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT;
  }
  return Math.max(1, Math.min(NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT, Math.floor(requestedLimit)));
}

function scopeRank(kind: NodeSlideScopedMemoryScopeKind): number {
  return kind === 'deck' ? 3 : kind === 'project' ? 2 : 1;
}

function boundedIdentifier(value: string, field: string): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > 256) throw new Error(`Invalid scoped memory ${field}.`);
  return clean;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function workspaceGrantTokenDigest(token: string): string {
  return nodeslideContentDigest(`nodeslide-workspace-grant\u001f${token}`);
}
