import { v } from 'convex/values';
import { internal } from './_generated/api';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from './_generated/server';
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
    /**
     * Sprint 3: typed 16-row check rubric. Optional for back-compat;
     * rows from before this field was written still read normally.
     */
    checks: v.optional(v.any()),
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

/** Internal mirror used by the workflow handler. */
export const getLatestInternal = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('parity_reports')
      .withIndex('by_run_iter', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
  },
});

export const reverifyLatestInternal = internalAction({
  args: {
    runId: v.id('runs'),
    reason: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { runId },
  ): Promise<{ ok: boolean; uiKitId?: string; status?: string; iterationNumber?: number }> => {
    const artifact = await ctx.runQuery(internal.artifacts.getLatestInternal, { runId });
    const uiKit = await ctx.runQuery(internal.uiKits.getLatestInternal, { runId });
    const previousReport = await ctx.runQuery(internal.parityReports.getLatestInternal, { runId });
    const run = await ctx.runQuery(internal.runs.getInternal, { runId });
    if (artifact === null || uiKit === null) {
      return { ok: false };
    }
    const iterationNumber =
      Math.max(
        Number(previousReport?.iterationNumber ?? 0),
        Number(run?.iterationsCompleted ?? 0),
      ) + 1;
    const result = await ctx.runAction(internal.generation.verifyDeterministic, {
      runId,
      uiKitId: uiKit._id,
      iterationNumber,
      sourceHtml: artifact.html,
    });
    await ctx.runMutation(internal.runs.updateStatus, {
      runId,
      status: 'done',
    });
    return { ok: true, uiKitId: uiKit._id, status: result.status, iterationNumber };
  },
});

/**
 * Sprint 3 helper: re-verify an existing finished run with the new
 * 16-row check rubric. Used to backfill the typed `checks` payload on
 * runs whose parity_reports were written by the old (3-bucket) code,
 * without waiting for a fresh end-to-end pipeline run.
 *
 * Public action so it can be invoked from `npx convex run`. Internal
 * `verifyDeterministic` does the heavy lifting; this wrapper just
 * resolves the latest artifact + ui_kit for the run.
 */
export const reverifyForRun = action({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }): Promise<{ ok: boolean; uiKitId?: string; status?: string }> => {
    const result = await ctx.runAction(internal.parityReports.reverifyLatestInternal, {
      runId,
      reason: 'manual-reverify',
    });
    return result;
  },
});
