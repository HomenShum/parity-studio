import { v } from 'convex/values';
import { internal } from './_generated/api';
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
    await ctx.scheduler.runAfter(0, internal.parityReports.reverifyLatestInternal, {
      runId: kit.runId,
      reason: 'manual-file-save',
    });
    return { path, sizeBytes: content.length, reverifyScheduled: true };
  },
});

export const createFile = mutation({
  args: {
    uiKitId: v.id('ui_kits'),
    path: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { uiKitId, path, content }) => {
    if (path.length === 0 || path.length > 200) {
      throw new Error('uiKits:createFile path must be 1..200 chars');
    }
    if (content.length > 200_000) {
      throw new Error('uiKits:createFile content capped at 200000 chars');
    }
    const kit = await ctx.db.get(uiKitId);
    if (kit === null) throw new Error(`ui_kit ${uiKitId} not found`);
    const files = { ...((kit.files as Record<string, string>) ?? {}) };
    if (path in files) throw new Error(`uiKits:createFile path "${path}" already exists`);
    files[path] = content;
    await ctx.db.patch(uiKitId, { files, fileCount: Object.keys(files).length });
    await ctx.scheduler.runAfter(0, internal.parityReports.reverifyLatestInternal, {
      runId: kit.runId,
      reason: 'file-create',
    });
    return { path, sizeBytes: content.length };
  },
});

export const renameFile = mutation({
  args: {
    uiKitId: v.id('ui_kits'),
    fromPath: v.string(),
    toPath: v.string(),
  },
  handler: async (ctx, { uiKitId, fromPath, toPath }) => {
    if (
      fromPath.length === 0 ||
      fromPath.length > 200 ||
      toPath.length === 0 ||
      toPath.length > 200
    ) {
      throw new Error('uiKits:renameFile paths must be 1..200 chars');
    }
    const kit = await ctx.db.get(uiKitId);
    if (kit === null) throw new Error(`ui_kit ${uiKitId} not found`);
    const files = { ...((kit.files as Record<string, string>) ?? {}) };
    if (!(fromPath in files)) throw new Error(`uiKits:renameFile path "${fromPath}" not in ui_kit`);
    if (toPath in files)
      throw new Error(`uiKits:renameFile destination "${toPath}" already exists`);
    files[toPath] = files[fromPath] ?? '';
    delete files[fromPath];
    await ctx.db.patch(uiKitId, { files, fileCount: Object.keys(files).length });
    await ctx.scheduler.runAfter(0, internal.parityReports.reverifyLatestInternal, {
      runId: kit.runId,
      reason: 'file-rename',
    });
    return { fromPath, toPath };
  },
});

export const deleteFile = mutation({
  args: {
    uiKitId: v.id('ui_kits'),
    path: v.string(),
  },
  handler: async (ctx, { uiKitId, path }) => {
    if (path.length === 0 || path.length > 200) {
      throw new Error('uiKits:deleteFile path must be 1..200 chars');
    }
    const kit = await ctx.db.get(uiKitId);
    if (kit === null) throw new Error(`ui_kit ${uiKitId} not found`);
    const files = { ...((kit.files as Record<string, string>) ?? {}) };
    if (!(path in files)) throw new Error(`uiKits:deleteFile path "${path}" not in ui_kit`);
    delete files[path];
    await ctx.db.patch(uiKitId, { files, fileCount: Object.keys(files).length });
    await ctx.scheduler.runAfter(0, internal.parityReports.reverifyLatestInternal, {
      runId: kit.runId,
      reason: 'file-delete',
    });
    return { path };
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

/**
 * Atomic upsert across the full canonical shape. Adds the path if it
 * doesn't exist; replaces content if it does. Caps content at 200KB
 * to keep the ui_kit row under Convex doc-size limits when many
 * files accumulate.
 *
 * Used by the chat agent's patch_file tool — needs to be able to
 * create new specimen pages (e.g. `preview/component-NewThing.html`)
 * as well as edit existing ones. patchFile keeps the existing-only
 * semantic for safety; this mutation is the explicit-create variant.
 */
export const upsertFile = mutation({
  args: {
    uiKitId: v.id('ui_kits'),
    path: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { uiKitId, path, content }) => {
    if (path.length === 0 || path.length > 200) {
      throw new Error('uiKits:upsertFile path must be 1..200 chars');
    }
    if (content.length > 200_000) {
      throw new Error('uiKits:upsertFile content capped at 200000 chars');
    }
    const kit = await ctx.db.get(uiKitId);
    if (kit === null) throw new Error(`ui_kit ${uiKitId} not found`);
    const files = { ...((kit.files as Record<string, string>) ?? {}) };
    const created = !(path in files);
    files[path] = content;
    await ctx.db.patch(uiKitId, {
      files,
      fileCount: Object.keys(files).length,
    });
    await ctx.scheduler.runAfter(0, internal.parityReports.reverifyLatestInternal, {
      runId: kit.runId,
      reason: created ? 'file-create' : 'file-upsert',
    });
    return { path, sizeBytes: content.length, created };
  },
});

/**
 * Internal mirror of upsertFile so the chat agent's tool loop (running
 * inside an action) can patch files without ctx-bridging.
 */
export const upsertFileInternal = internalMutation({
  args: {
    uiKitId: v.id('ui_kits'),
    path: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { uiKitId, path, content }) => {
    if (path.length === 0 || path.length > 200) {
      throw new Error('uiKits:upsertFileInternal path must be 1..200 chars');
    }
    if (content.length > 200_000) {
      throw new Error('uiKits:upsertFileInternal content capped at 200000 chars');
    }
    const kit = await ctx.db.get(uiKitId);
    if (kit === null) throw new Error(`ui_kit ${uiKitId} not found`);
    const files = { ...((kit.files as Record<string, string>) ?? {}) };
    const created = !(path in files);
    files[path] = content;
    await ctx.db.patch(uiKitId, {
      files,
      fileCount: Object.keys(files).length,
    });
    return { path, sizeBytes: content.length, created };
  },
});
