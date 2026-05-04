import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { recordDesignRevision } from './lib/designRevisions';

const KIND = v.union(
  v.literal('initial'),
  v.literal('manual-edit'),
  v.literal('agent-edit'),
  v.literal('file-create'),
  v.literal('file-rename'),
  v.literal('file-delete'),
  v.literal('import'),
  v.literal('sync'),
  v.literal('export'),
);

export const list = query({
  args: { runId: v.id('runs'), limit: v.optional(v.number()) },
  handler: async (ctx, { runId, limit = 20 }) => {
    return await ctx.db
      .query('design_revisions')
      .withIndex('by_run_revision', (q) => q.eq('runId', runId))
      .order('desc')
      .take(Math.max(1, Math.min(100, limit)));
  },
});

export const recordInternal = internalMutation({
  args: {
    runId: v.id('runs'),
    uiKitId: v.id('ui_kits'),
    kind: KIND,
    label: v.string(),
    summary: v.string(),
    changedPaths: v.array(v.string()),
    files: v.any(),
    source: v.optional(v.union(v.literal('app'), v.literal('agent'), v.literal('mcp'))),
  },
  handler: async (ctx, args) => {
    const files = (args.files as Record<string, string>) ?? {};
    return await recordDesignRevision(ctx, {
      runId: args.runId,
      uiKitId: args.uiKitId,
      kind: args.kind,
      label: args.label,
      summary: args.summary,
      changedPaths: args.changedPaths,
      files,
      ...(args.source ? { source: args.source } : {}),
    });
  },
});
