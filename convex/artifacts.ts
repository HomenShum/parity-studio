import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';

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

/** Internal mirror used by the workflow handler. Same shape, internal access. */
export const getLatestInternal = internalQuery({
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

/**
 * Internal mirror used by the canonical zip exporter (convex/http.ts) so
 * the explorations/ folder can carry every iteration's index.html, not
 * just the latest one. Bounded to 10 to keep zip size reasonable.
 */
export const listForRunInternal = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('artifacts')
      .withIndex('by_run_version', (q) => q.eq('runId', runId))
      .order('desc')
      .take(10);
  },
});
