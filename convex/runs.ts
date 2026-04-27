import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
import { RUN_STATUSES } from './schema';
import { workflow } from './workflows';

const STATUS_UNION = v.union(...RUN_STATUSES.map((s) => v.literal(s)));

export const start = mutation({
  args: {
    prompt: v.optional(v.string()),
    sourceImageStorageId: v.optional(v.id('_storage')),
    /**
     * Optional: pass the source image directly as base64 instead of via Convex
     * storage. Convenient for the in-app InputBar but capped at 2 MB by the
     * pipeline so the workflow journal doesn't bloat. Use sourceImageStorageId
     * for larger files.
     */
    sourceImageBase64: v.optional(v.string()),
    sourceImageMimeType: v.optional(
      v.union(v.literal('image/png'), v.literal('image/jpeg'), v.literal('image/webp')),
    ),
  },
  handler: async (ctx, args) => {
    const hasPrompt = (args.prompt?.trim().length ?? 0) > 0;
    const hasImage =
      args.sourceImageStorageId !== undefined || args.sourceImageBase64 !== undefined;
    if (!hasPrompt && !hasImage) {
      throw new Error('runs:start requires either prompt or sourceImageBase64/StorageId');
    }
    const runId = await ctx.db.insert('runs', {
      ...(hasPrompt ? { prompt: args.prompt } : {}),
      ...(args.sourceImageStorageId !== undefined
        ? { sourceImageStorageId: args.sourceImageStorageId }
        : {}),
      status: 'queued',
      costMicroUsd: 0,
      iterationsCompleted: 0,
    });

    // Kick off the durable workflow. Returns a workflow id we persist on
    // the run row so the dashboard / status query can deep-link to the
    // workflow record if it ever needs to.
    const workflowId = await workflow.start(
      ctx,
      internal.workflows.parityStudioWorkflow,
      {
        runId,
        ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
        ...(args.sourceImageBase64 !== undefined
          ? { sourceImageBase64: args.sourceImageBase64 }
          : {}),
        ...(args.sourceImageMimeType !== undefined
          ? { sourceImageMimeType: args.sourceImageMimeType }
          : {}),
      },
    );
    await ctx.db.patch(runId, { workflowId: workflowId.toString() });
    return runId;
  },
});

export const get = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db.get(runId);
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = Math.min(Math.max(limit ?? 20, 1), 100);
    return await ctx.db.query('runs').withIndex('by_creation').order('desc').take(cap);
  },
});

export const updateStatus = internalMutation({
  args: {
    runId: v.id('runs'),
    status: STATUS_UNION,
    errorMessage: v.optional(v.string()),
    iterationsCompleted: v.optional(v.number()),
  },
  handler: async (ctx, { runId, status, errorMessage, iterationsCompleted }) => {
    const patch: {
      status: (typeof RUN_STATUSES)[number];
      errorMessage?: string;
      iterationsCompleted?: number;
      finishedAt?: number;
    } = { status };
    if (errorMessage !== undefined) patch.errorMessage = errorMessage;
    if (iterationsCompleted !== undefined) patch.iterationsCompleted = iterationsCompleted;
    if (status === 'done' || status === 'failed') patch.finishedAt = Date.now();
    await ctx.db.patch(runId, patch);
  },
});

export const accumulateCost = internalMutation({
  args: { runId: v.id('runs'), addMicroUsd: v.number() },
  handler: async (ctx, { runId, addMicroUsd }) => {
    if (addMicroUsd < 0) throw new Error('cost delta must be non-negative');
    const run = await ctx.db.get(runId);
    if (run === null) return;
    await ctx.db.patch(runId, { costMicroUsd: run.costMicroUsd + addMicroUsd });
  },
});
