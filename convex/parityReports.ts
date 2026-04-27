import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { PARITY_STATUSES } from './schema';

const STATUS_UNION = v.union(...PARITY_STATUSES.map((s) => v.literal(s)));

export const save = internalMutation({
  args: {
    runId: v.id('runs'),
    uiKitId: v.id('ui_kits'),
    iterationNumber: v.number(),
    passCount: v.number(),
    totalChecks: v.number(),
    status: STATUS_UNION,
    gaps: v.any(),
    summary: v.string(),
    judgeCostMicroUsd: v.number(),
    judgeModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('parity_reports', args);
  },
});

export const getLatest = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('parity_reports')
      .withIndex('by_run_iter', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
  },
});

export const listForRun = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('parity_reports')
      .withIndex('by_run_iter', (q) => q.eq('runId', runId))
      .order('asc')
      .collect();
  },
});
