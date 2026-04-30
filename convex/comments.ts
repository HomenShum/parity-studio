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
    targetFile: v.optional(v.string()),
    selector: v.optional(v.string()),
    domPath: v.optional(v.string()),
    elementLabel: v.optional(v.string()),
    tagName: v.optional(v.string()),
    textSnippet: v.optional(v.string()),
    componentHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.text.trim().length === 0) {
      throw new Error('comments:create requires non-empty text');
    }
    if (args.text.length > 1_000) {
      throw new Error('comments:create text capped at 1000 chars');
    }
    if (args.targetFile !== undefined && args.targetFile.length > 200) {
      throw new Error('comments:create targetFile capped at 200 chars');
    }
    if (args.bbox !== undefined) {
      const { x, y, w, h } = args.bbox;
      if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.02 || y + h > 1.02) {
        throw new Error('comments:create bbox must be normalized within the preview');
      }
    }
    for (const [name, value] of Object.entries({
      selector: args.selector,
      domPath: args.domPath,
      elementLabel: args.elementLabel,
      tagName: args.tagName,
      textSnippet: args.textSnippet,
      componentHint: args.componentHint,
    })) {
      if (value !== undefined && value.length > 500) {
        throw new Error(`comments:create ${name} capped at 500 chars`);
      }
    }
    return await ctx.db.insert('comments', {
      runId: args.runId,
      artifactVersion: args.artifactVersion,
      text: args.text.trim(),
      ...(args.bbox !== undefined ? { bbox: args.bbox } : {}),
      ...(args.targetFile !== undefined ? { targetFile: args.targetFile } : {}),
      ...(args.selector !== undefined ? { selector: args.selector } : {}),
      ...(args.domPath !== undefined ? { domPath: args.domPath } : {}),
      ...(args.elementLabel !== undefined ? { elementLabel: args.elementLabel } : {}),
      ...(args.tagName !== undefined ? { tagName: args.tagName } : {}),
      ...(args.textSnippet !== undefined ? { textSnippet: args.textSnippet } : {}),
      ...(args.componentHint !== undefined ? { componentHint: args.componentHint } : {}),
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
