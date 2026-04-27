import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';

export const save = internalMutation({
  args: {
    runId: v.id('runs'),
    artifactVersion: v.number(),
    slug: v.string(),
    schemaVersion: v.number(),
    files: v.any(),
    decomposeCostMicroUsd: v.number(),
  },
  handler: async (ctx, args) => {
    const fileCount = Object.keys((args.files as Record<string, string>) ?? {}).length;
    return await ctx.db.insert('ui_kits', { ...args, fileCount });
  },
});

export const getLatest = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('ui_kits')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
  },
});

export const get = query({
  args: { uiKitId: v.id('ui_kits') },
  handler: async (ctx, { uiKitId }) => {
    return await ctx.db.get(uiKitId);
  },
});

/** Internal mirror of `get` so internalActions can read by id. */
export const getInternal = internalQuery({
  args: { uiKitId: v.id('ui_kits') },
  handler: async (ctx, { uiKitId }) => {
    return await ctx.db.get(uiKitId);
  },
});

/** Internal mirror used by the workflow handler. */
export const getLatestInternal = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('ui_kits')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
  },
});
