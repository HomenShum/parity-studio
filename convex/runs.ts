import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { expandToCanonicalShape } from './lib/canonicalShape';
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
      // Persist inline source image so the SourceImagePopover can render
      // it alongside the scoped component without a separate roundtrip.
      ...(args.sourceImageBase64 !== undefined
        ? { sourceImageBase64: args.sourceImageBase64 }
        : {}),
      ...(args.sourceImageMimeType !== undefined
        ? { sourceImageMimeType: args.sourceImageMimeType }
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

/**
 * Drop a pre-built ui_kit directly into a run, skipping generate +
 * decompose entirely. Used when the user drops a canonical
 * NodeBench-skill-style ZIP onto the composer instead of starting from
 * an image or prompt.
 *
 * The zip is parsed client-side by ComposerCard (JSZip), the largest
 * `ui_kits/<slug>/` folder is selected, and its files are passed in
 * here as a flat path → content map. We persist a synthetic artifact
 * (the kit's index.html) and a ui_kit row with cost = 0, then trigger
 * verifyDeterministic so the right-rail rubric populates immediately
 * with no LLM cost.
 *
 * sourceImageBase64 / sourceImageMimeType are optional — populated if
 * the zip carried an `uploads/` png/jpg/webp.
 */
export const startFromKit = mutation({
  args: {
    slug: v.string(),
    files: v.any(), // Record<string, string>
    sourceImageBase64: v.optional(v.string()),
    sourceImageMimeType: v.optional(
      v.union(v.literal('image/png'), v.literal('image/jpeg'), v.literal('image/webp')),
    ),
    /**
     * Optional original prompt that produced the kit. For provenance.
     */
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const files = (args.files ?? {}) as Record<string, string>;
    if (typeof args.slug !== 'string' || args.slug.length === 0) {
      throw new Error('runs:startFromKit requires a slug');
    }
    if (Object.keys(files).length === 0) {
      throw new Error('runs:startFromKit requires at least one file');
    }
    const indexHtml =
      Object.entries(files).find(([p]) => p.endsWith('/index.html') || p === 'index.html')?.[1] ??
      '<!doctype html><html><body><!-- ui_kit imported without index.html --></body></html>';

    const runId = await ctx.db.insert('runs', {
      ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
      ...(args.sourceImageBase64 !== undefined
        ? { sourceImageBase64: args.sourceImageBase64 }
        : {}),
      ...(args.sourceImageMimeType !== undefined
        ? { sourceImageMimeType: args.sourceImageMimeType }
        : {}),
      status: 'verifying',
      costMicroUsd: 0,
      iterationsCompleted: 0,
    });

    // Insert artifact (the index.html) at version 0 so the canvas iframe
    // renders it immediately.
    await ctx.db.insert('artifacts', {
      runId,
      version: 0,
      html: indexHtml,
      sizeBytes: indexHtml.length,
    });

    // Expand the imported kit into the full canonical shape so the
    // chat agent can patch any preview/, assets/, or explorations/
    // file from day one. Imported kit files override regenerated
    // shape on conflicts (the spread below puts `files` last).
    const importCanonical = expandToCanonicalShape({
      slug: args.slug,
      kitFiles: files,
      run: {
        runId: String(runId),
        prompt: args.prompt,
        costMicroUsd: 0,
        iterationsCompleted: 0,
        sourceImageMimeType: args.sourceImageMimeType,
        hasSourceImage: Boolean(args.sourceImageBase64),
      },
      parity: null,
      artifacts: [],
    });
    const importFullShape = { ...importCanonical, ...files };

    // Insert ui_kit row with cost = 0.
    const fileCount = Object.keys(importFullShape).length;
    await ctx.db.insert('ui_kits', {
      runId,
      artifactVersion: 0,
      slug: args.slug,
      schemaVersion: 1,
      files: importFullShape,
      fileCount,
      decomposeCostMicroUsd: 0,
    });

    // Trigger verify in the background so the right-rail rubric populates.
    await ctx.scheduler.runAfter(0, internal.workflows.verifyImportedKit, { runId });

    return runId;
  },
});

export const get = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db.get(runId);
  },
});

/** Internal mirror of `get` so http actions can read by id. */
export const getInternal = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db.get(runId);
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = Math.min(Math.max(limit ?? 20, 1), 100);
    // _creationTime is the implicit default ordering on any query without
    // an explicit index, so .order('desc') alone gives us the most recent.
    return await ctx.db.query('runs').order('desc').take(cap);
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

/**
 * User-triggered iterate pass on a finished run, optionally folding in any
 * open comments as additional gap feedback. Use this for "iterate now" from
 * the action sidebar after the user has reviewed the previous output and
 * dropped comments on regions they want changed.
 *
 * Kicks off a separate workflow that:
 *   1. Reads the latest artifact + ui_kit + open comments
 *   2. Calls iterate action with comments folded into failedGaps
 *   3. Re-runs verifyDeterministic
 *   4. Marks comments as 'addressed' on success
 */
export const iterateWithComments = mutation({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (run === null) throw new Error(`runs:iterateWithComments — run ${runId} not found`);
    if (run.status !== 'done' && run.status !== 'failed') {
      throw new Error(
        `runs:iterateWithComments — current status is ${run.status}; can only iterate a settled run`,
      );
    }
    const wfId = await workflow.start(ctx, internal.workflows.iterateWithCommentsWorkflow, {
      runId,
    });
    await ctx.db.patch(runId, {
      status: 'iterating',
      workflowId: wfId.toString(),
      iterationsCompleted: run.iterationsCompleted + 1,
    });
    return runId;
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

/**
 * Append a per-stage telemetry entry. Used by every action so the cost panel
 * can render a clean breakdown (model + tokens + cost + latency per stage).
 * Also bumps the run's total cost in the same patch so the UI never sees a
 * total that's out of sync with the per-stage sum.
 */
export const recordStageTelemetry = internalMutation({
  args: {
    runId: v.id('runs'),
    stage: v.string(),
    modelId: v.string(),
    provider: v.string(),
    costMicroUsd: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    latencyMs: v.number(),
    stageStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (run === null) return;
    const breakdown = (run.costBreakdown ?? []).slice();
    const entry: {
      stage: string;
      modelId: string;
      provider: string;
      costMicroUsd: number;
      inputTokens?: number;
      outputTokens?: number;
      latencyMs: number;
      stageStartedAt: number;
    } = {
      stage: args.stage,
      modelId: args.modelId,
      provider: args.provider,
      costMicroUsd: args.costMicroUsd,
      latencyMs: args.latencyMs,
      stageStartedAt: args.stageStartedAt,
    };
    if (args.inputTokens !== undefined) entry.inputTokens = args.inputTokens;
    if (args.outputTokens !== undefined) entry.outputTokens = args.outputTokens;
    breakdown.push(entry);
    await ctx.db.patch(args.runId, {
      costBreakdown: breakdown,
      costMicroUsd: run.costMicroUsd + args.costMicroUsd,
    });
  },
});
