import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';

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

/**
 * User-driven file edit. Patches a single file in the latest ui_kit's
 * `files` map. Used by the in-app code editor (Monaco). Bumps a virtual
 * edit marker via convex's automatic `_creationTime` (the row is patched
 * in place; we'd add a separate user_edit_count counter if we wanted
 * an audit trail).
 *
 * Caps:
 *   - file content ≤ 200KB (matches the export-zip ceiling)
 *   - file path must already exist in the ui_kit (no new file creation
 *     here — that's a separate flow we can add if needed)
 *
 * Why mutate-in-place vs append-new-version: edits should flow into the
 * existing artifactVersion so the next iterate run sees them as the
 * "current" code. Iteration history is captured by re-running iterate,
 * which appends a new ui_kit row.
 */
export const patchFile = mutation({
  args: {
    uiKitId: v.id('ui_kits'),
    path: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { uiKitId, path, content }) => {
    if (path.length === 0 || path.length > 200) {
      throw new Error('uiKits:patchFile path must be 1..200 chars');
    }
    if (content.length > 200_000) {
      throw new Error('uiKits:patchFile content capped at 200000 chars');
    }
    const kit = await ctx.db.get(uiKitId);
    if (kit === null) throw new Error(`ui_kit ${uiKitId} not found`);
    const files = { ...((kit.files as Record<string, string>) ?? {}) };
    if (!(path in files)) {
      throw new Error(`uiKits:patchFile path "${path}" not in ui_kit`);
    }
    files[path] = content;
    await ctx.db.patch(uiKitId, { files });
    return { path, sizeBytes: content.length };
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
