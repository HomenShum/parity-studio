import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';

export const append = internalMutation({
  args: {
    runId: v.id('runs'),
    version: v.number(),
    html: v.string(),
  },
  handler: async (ctx, { runId, version, html }) => {
    return await ctx.db.insert('artifacts', {
      runId,
      version,
      html,
      sizeBytes: html.length,
    });
  },
});

export const getLatest = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('artifacts')
      .withIndex('by_run_version', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
  },
});

export const listForRun = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('artifacts')
      .withIndex('by_run_version', (q) => q.eq('runId', runId))
      .order('desc')
      .take(10);
  },
});
