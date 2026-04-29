import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';

/**
 * V8 surface for the chat panel. Public list query + send mutation +
 * internal CRUD helpers used by the Node-side agent loop in chatLoop.ts.
 *
 * The Node action uses these via ctx.runQuery / ctx.runMutation.
 * Convex requires `'use node'` files to expose actions only — mutations
 * and queries must live in a V8 file.
 */

export const list = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('chat_messages')
      .withIndex('by_run_turn', (q) => q.eq('runId', runId))
      .order('asc')
      .take(200);
  },
});

export const insertTurn = internalMutation({
  args: {
    runId: v.id('runs'),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('tool')),
    content: v.string(),
    turn: v.number(),
    toolCalls: v.optional(
      v.array(v.object({ id: v.string(), name: v.string(), args: v.string() })),
    ),
    toolCallId: v.optional(v.string()),
    toolName: v.optional(v.string()),
    modelId: v.optional(v.string()),
    provider: v.optional(v.string()),
    costMicroUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('chat_messages', args);
  },
});

export const nextTurnNumber = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    const last = await ctx.db
      .query('chat_messages')
      .withIndex('by_run_turn', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
    return (last?.turn ?? -1) + 1;
  },
});

export const listForLoadInternal = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('chat_messages')
      .withIndex('by_run_turn', (q) => q.eq('runId', runId))
      .order('asc')
      .take(200);
  },
});

/**
 * User-facing send mutation. Persists the user's turn, then schedules
 * the Node-side agent loop (chatLoop.runAgentLoop) which consumes the
 * conversation, calls pi-ai with tools, and writes assistant + tool
 * turns back to the chat_messages table.
 */
export const send = mutation({
  args: {
    runId: v.id('runs'),
    text: v.string(),
  },
  handler: async (ctx, { runId, text }) => {
    if (text.trim().length === 0) throw new Error('chat:send empty text');
    if (text.length > 8000) throw new Error('chat:send capped at 8000 chars');

    const last = await ctx.db
      .query('chat_messages')
      .withIndex('by_run_turn', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
    const turn = (last?.turn ?? -1) + 1;

    await ctx.db.insert('chat_messages', {
      runId,
      role: 'user',
      content: text.trim(),
      turn,
    });

    await ctx.scheduler.runAfter(0, internal.chatLoop.runAgentLoop, { runId });
    return { ok: true };
  },
});
