import { v } from 'convex/values';
import type { NodeSlideAgentMemory, NodeSlideAgentMemoryCategory } from '../shared/nodeslide';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { nodeslideContentDigest, nodeslideEventId } from './lib/nodeslideIds';

export const NODESLIDE_MEMORY_MAX_ITEMS = 100;
export const NODESLIDE_MEMORY_MAX_ACTIVE_ITEMS = 48;
export const NODESLIDE_MEMORY_MAX_CONTENT_LENGTH = 800;
export const NODESLIDE_MEMORY_RETRIEVAL_LIMIT = 6;
export const NODESLIDE_MEMORY_RETRIEVAL_MAX_BYTES = 4_800;

const memoryCategoryValidator = v.union(
  v.literal('preference'),
  v.literal('fact'),
  v.literal('decision'),
  v.literal('instruction'),
  v.literal('context'),
);

const memoryStatusValidator = v.union(v.literal('active'), v.literal('archived'));

function normalizeMemoryContent(value: string): string {
  const content = value.replace(/\s+/gu, ' ').trim();
  if (!content) throw new Error('Memory content is required.');
  if (content.length > NODESLIDE_MEMORY_MAX_CONTENT_LENGTH) {
    throw new Error(`Memory content exceeds ${NODESLIDE_MEMORY_MAX_CONTENT_LENGTH} characters.`);
  }
  return content;
}

function memoryFromRow(row: {
  id: string;
  deckId: string;
  category: NodeSlideAgentMemoryCategory;
  content: string;
  status: 'active' | 'archived';
  source: 'user' | 'agent';
  sourceRunId?: string;
  contentDigest: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  useCount: number;
}): NodeSlideAgentMemory {
  return {
    id: row.id,
    deckId: row.deckId,
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
  };
}

export const list = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    status: v.optional(memoryStatusValidator),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const status = args.status;
    const rows = status
      ? await ctx.db
          .query('nodeslide_agent_memories')
          .withIndex('by_deck_status_updated', (query) =>
            query.eq('deckId', args.deckId).eq('status', status),
          )
          .order('desc')
          .take(NODESLIDE_MEMORY_MAX_ITEMS)
      : await ctx.db
          .query('nodeslide_agent_memories')
          .withIndex('by_deck_updated', (query) => query.eq('deckId', args.deckId))
          .order('desc')
          .take(NODESLIDE_MEMORY_MAX_ITEMS);
    return rows.map(memoryFromRow);
  },
});

export const create = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    category: memoryCategoryValidator,
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const rows = await ctx.db
      .query('nodeslide_agent_memories')
      .withIndex('by_deck_updated', (query) => query.eq('deckId', args.deckId))
      .collect();
    if (rows.length >= NODESLIDE_MEMORY_MAX_ITEMS) {
      throw new Error(`A deck can keep at most ${NODESLIDE_MEMORY_MAX_ITEMS} memories.`);
    }
    if (rows.filter((row) => row.status === 'active').length >= NODESLIDE_MEMORY_MAX_ACTIVE_ITEMS) {
      throw new Error(
        `Archive an active memory before adding another (limit ${NODESLIDE_MEMORY_MAX_ACTIVE_ITEMS}).`,
      );
    }
    const content = normalizeMemoryContent(args.content);
    const now = Date.now();
    const id = nodeslideEventId('memory', now, args.deckId, args.category, content);
    const memory = {
      id,
      deckId: args.deckId,
      category: args.category,
      content,
      status: 'active' as const,
      source: 'user' as const,
      contentDigest: nodeslideContentDigest(content),
      createdAt: now,
      updatedAt: now,
      useCount: 0,
    };
    await ctx.db.insert('nodeslide_agent_memories', memory);
    return memoryFromRow(memory);
  },
});

export const update = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    memoryId: v.string(),
    category: v.optional(memoryCategoryValidator),
    content: v.optional(v.string()),
    status: v.optional(memoryStatusValidator),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await ctx.db
      .query('nodeslide_agent_memories')
      .withIndex('by_stable_id', (query) => query.eq('id', args.memoryId))
      .unique();
    if (!row || row.deckId !== args.deckId) throw new Error('Memory not found.');
    if (args.status === 'active' && row.status !== 'active') {
      const active = await ctx.db
        .query('nodeslide_agent_memories')
        .withIndex('by_deck_status_updated', (query) =>
          query.eq('deckId', args.deckId).eq('status', 'active'),
        )
        .take(NODESLIDE_MEMORY_MAX_ACTIVE_ITEMS);
      if (active.length >= NODESLIDE_MEMORY_MAX_ACTIVE_ITEMS) {
        throw new Error(
          `Archive an active memory before restoring another (limit ${NODESLIDE_MEMORY_MAX_ACTIVE_ITEMS}).`,
        );
      }
    }
    const content = args.content === undefined ? row.content : normalizeMemoryContent(args.content);
    await ctx.db.patch(row._id, {
      ...(args.category ? { category: args.category } : {}),
      ...(args.content !== undefined
        ? { content, contentDigest: nodeslideContentDigest(content) }
        : {}),
      ...(args.status ? { status: args.status } : {}),
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get(row._id);
    if (!updated) throw new Error('Memory update failed.');
    return memoryFromRow(updated);
  },
});

export const remove = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), memoryId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await ctx.db
      .query('nodeslide_agent_memories')
      .withIndex('by_stable_id', (query) => query.eq('id', args.memoryId))
      .unique();
    if (!row || row.deckId !== args.deckId) return false;
    await ctx.db.delete(row._id);
    return true;
  },
});

export const retrieveRelevantInternal = internalQuery({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    instruction: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const rows = await ctx.db
      .query('nodeslide_agent_memories')
      .withIndex('by_deck_status_updated', (query) =>
        query.eq('deckId', args.deckId).eq('status', 'active'),
      )
      .order('desc')
      .take(NODESLIDE_MEMORY_MAX_ACTIVE_ITEMS);
    return selectRelevantMemories(rows.map(memoryFromRow), args.instruction, args.limit);
  },
});

export const markUsedInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    memoryIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const now = Date.now();
    for (const memoryId of [...new Set(args.memoryIds)].slice(
      0,
      NODESLIDE_MEMORY_RETRIEVAL_LIMIT,
    )) {
      const row = await ctx.db
        .query('nodeslide_agent_memories')
        .withIndex('by_stable_id', (query) => query.eq('id', memoryId))
        .unique();
      if (!row || row.deckId !== args.deckId || row.status !== 'active') continue;
      await ctx.db.patch(row._id, {
        lastUsedAt: now,
        useCount: Math.max(0, row.useCount) + 1,
      });
    }
  },
});

export function selectRelevantMemories(
  memories: readonly NodeSlideAgentMemory[],
  instruction: string,
  requestedLimit = NODESLIDE_MEMORY_RETRIEVAL_LIMIT,
): NodeSlideAgentMemory[] {
  const limit = Math.max(1, Math.min(NODESLIDE_MEMORY_RETRIEVAL_LIMIT, Math.floor(requestedLimit)));
  const queryTokens = tokens(instruction);
  const now = Date.now();
  const ranked = memories
    .filter((memory) => memory.status === 'active')
    .map((memory) => {
      const memoryTokens = tokens(memory.content);
      let overlap = 0;
      for (const token of queryTokens) if (memoryTokens.has(token)) overlap += 1;
      const categoryWeight =
        memory.category === 'instruction' || memory.category === 'decision'
          ? 3
          : memory.category === 'preference'
            ? 2
            : 1;
      const ageDays = Math.max(0, (now - memory.updatedAt) / 86_400_000);
      const recency = Math.max(0, 2 - ageDays / 30);
      return { memory, score: overlap * 10 + categoryWeight + recency };
    })
    .sort(
      (left, right) => right.score - left.score || right.memory.updatedAt - left.memory.updatedAt,
    );

  const selected: NodeSlideAgentMemory[] = [];
  let bytes = 0;
  for (const { memory } of ranked) {
    if (selected.length >= limit) break;
    const memoryBytes = new TextEncoder().encode(memory.content).byteLength;
    if (bytes + memoryBytes > NODESLIDE_MEMORY_RETRIEVAL_MAX_BYTES) continue;
    selected.push(memory);
    bytes += memoryBytes;
  }
  return selected;
}

function tokens(value: string): Set<string> {
  const stop = new Set([
    'about',
    'after',
    'again',
    'also',
    'and',
    'are',
    'deck',
    'for',
    'from',
    'have',
    'into',
    'make',
    'slide',
    'that',
    'the',
    'this',
    'with',
  ]);
  return new Set(
    value
      .toLocaleLowerCase()
      .match(/[a-z0-9][a-z0-9_-]{2,}/gu)
      ?.filter((token) => !stop.has(token)) ?? [],
  );
}
