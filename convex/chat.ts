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

/**
 * Advisor-executor trigger. Fires when a user takes a UI action
 * (saves a comment, selects a file, edits a tweak) and wants the agent
 * to auto-figure-out and apply the fix instead of prescribing a plan.
 *
 * Synthesizes a user turn from the trigger context and schedules the
 * normal agent loop. The system prompt's advisor-executor protocol
 * kicks in: agent reads context, calls set_todos with a 3–5 step plan,
 * walks the plan via read_file/upsert_file/done, then summarizes.
 *
 * Inputs:
 *   - kind: 'comment' (read commentId) | 'file' (read filePath) | 'manual' (use prompt verbatim)
 *   - commentId: optional Convex id; resolved server-side to {targetFile, text, bbox}
 *   - filePath:  optional path string; surfaces "open this file and review" intent
 *   - prompt:    optional verbatim user instruction (for kind='manual')
 *
 * The synthesized turn always begins with "Auto-fix triggered:" so the
 * system prompt can detect the advisor-executor protocol.
 */
export const startAdviseLoop = mutation({
  args: {
    runId: v.id('runs'),
    kind: v.union(v.literal('comment'), v.literal('file'), v.literal('manual')),
    commentId: v.optional(v.id('comments')),
    filePath: v.optional(v.string()),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, { runId, kind, commentId, filePath, prompt }) => {
    let seedText: string;
    if (kind === 'comment') {
      if (!commentId) throw new Error('chat:startAdviseLoop kind=comment requires commentId');
      const c = await ctx.db.get(commentId);
      if (c === null) throw new Error('chat:startAdviseLoop comment not found');
      const target = c.targetFile ? `\`${c.targetFile}\`` : 'the rendered artifact';
      const bboxNote = c.bbox
        ? ` (anchored at bbox ${(c.bbox.x * 100).toFixed(0)}%, ${(c.bbox.y * 100).toFixed(0)}%)`
        : '';
      seedText = `Auto-fix triggered: user left this comment on ${target}${bboxNote}: "${c.text}".

Plan and execute as advisor-executor:
  (1) ADVISE — call set_todos with a 3–5 step plan to address the comment
  (2) EXECUTE — walk the plan with read_file/upsert_file as needed
  (3) VERIFY — call done({ paths: [<edited paths>] }) and self-heal any errors
  (4) CLOSE — final assistant turn summarizing what changed and any open follow-ups

Be concise. Only edit files needed for THIS comment — don't drift into adjacent refactors.`;
    } else if (kind === 'file') {
      if (!filePath) throw new Error('chat:startAdviseLoop kind=file requires filePath');
      seedText = `Auto-fix triggered: user opened \`${filePath}\` for review.

Plan and execute as advisor-executor:
  (1) ADVISE — read_file the path, then set_todos a focused 2–4 step polish plan (a11y, naming, structure, consistency with tokens)
  (2) EXECUTE — walk the plan with upsert_file
  (3) VERIFY — call done({ paths: ['${filePath}'] }) and self-heal
  (4) CLOSE — summarize

If the file is fine as-is, set_todos should be a single "no changes needed" item and skip to summary.`;
    } else {
      if (!prompt || prompt.trim().length === 0)
        throw new Error('chat:startAdviseLoop kind=manual requires non-empty prompt');
      seedText = `Auto-fix triggered: ${prompt.trim()}

Plan and execute as advisor-executor: set_todos → read_file/upsert_file → done → summarize.`;
    }

    const last = await ctx.db
      .query('chat_messages')
      .withIndex('by_run_turn', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
    const turn = (last?.turn ?? -1) + 1;

    await ctx.db.insert('chat_messages', {
      runId,
      role: 'user',
      content: seedText,
      turn,
    });

    await ctx.scheduler.runAfter(0, internal.chatLoop.runAgentLoop, { runId });
    return { ok: true };
  },
});
