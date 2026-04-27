import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';

/**
 * Comments are user feedback pinned to the rendered preview. They feed
 * the "iterate with comments" path: when the user clicks "Iterate now",
 * any open comments are bundled into the iterate prompt's gap feedback
 * and marked 'addressed' once the next decompose runs.
 *
 * Bbox is normalized 0..1 so it survives viewport switches.
 */

const BBOX_SCHEMA = v.object({
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
});

export const create = mutation({
  args: {
    runId: v.id('runs'),
    artifactVersion: v.number(),
    text: v.string(),
    bbox: v.optional(BBOX_SCHEMA),
  },
  handler: async (ctx, args) => {
    if (args.text.trim().length === 0) {
      throw new Error('comments:create requires non-empty text');
    }
    if (args.text.length > 1_000) {
      throw new Error('comments:create text capped at 1000 chars');
    }
    return await ctx.db.insert('comments', {
      runId: args.runId,
      artifactVersion: args.artifactVersion,
      text: args.text.trim(),
      ...(args.bbox !== undefined ? { bbox: args.bbox } : {}),
      status: 'open',
    });
  },
});

export const listForRun = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('comments')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .order('desc')
      .take(50);
  },
});

export const dismiss = mutation({
  args: { commentId: v.id('comments') },
  handler: async (ctx, { commentId }) => {
    await ctx.db.patch(commentId, { status: 'dismissed' });
  },
});

/** Internal: read open comments for the iterate stage. */
export const listOpenInternal = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('comments')
      .withIndex('by_run_status', (q) => q.eq('runId', runId).eq('status', 'open'))
      .collect();
  },
});

/** Internal: mark all open comments as addressed after iterate consumes them. */
export const markAddressedInternal = internalMutation({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    const open = await ctx.db
      .query('comments')
      .withIndex('by_run_status', (q) => q.eq('runId', runId).eq('status', 'open'))
      .collect();
    for (const c of open) {
      await ctx.db.patch(c._id, { status: 'addressed' });
    }
    return open.length;
  },
});
