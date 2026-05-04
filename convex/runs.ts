import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { expandToCanonicalShape } from './lib/canonicalShape';
import { recordDesignRevision } from './lib/designRevisions';
import { withOperatingContract } from './lib/kitContract';
import { RUN_STATUSES } from './schema';
import { workflow } from './workflows';

const TIER_UNION = v.union(
  v.literal('frontier'),
  v.literal('balanced'),
  v.literal('free'),
  v.literal('small'),
);

const SUPPORTED_PROVIDER_UNION = v.union(
  v.literal('anthropic'),
  v.literal('openai'),
  v.literal('google'),
  v.literal('openrouter'),
  v.literal('groq'),
  v.literal('cerebras'),
  v.literal('xai'),
  v.literal('mistral'),
);

const MODEL_OVERRIDE_VALIDATOR = v.object({
  provider: SUPPORTED_PROVIDER_UNION,
  modelId: v.string(),
  label: v.optional(v.string()),
});

/**
 * Set or clear the tier on an existing run. Used by the ModelPicker
 * pill in the chat composer.
 */
export const setTier = mutation({
  args: { runId: v.id('runs'), tier: v.optional(TIER_UNION) },
  handler: async (ctx, { runId, tier }) => {
    const run = await ctx.db.get(runId);
    if (run === null) throw new Error('runs:setTier — run not found');
    if (tier) await ctx.db.patch(runId, { tier, modelOverride: undefined });
    else await ctx.db.patch(runId, { tier: undefined, modelOverride: undefined });
    return { ok: true };
  },
});

export const setModelSelection = mutation({
  args: {
    runId: v.id('runs'),
    tier: v.optional(TIER_UNION),
    modelOverride: v.optional(MODEL_OVERRIDE_VALIDATOR),
  },
  handler: async (ctx, { runId, tier, modelOverride }) => {
    const run = await ctx.db.get(runId);
    if (run === null) throw new Error('runs:setModelSelection — run not found');
    if (modelOverride !== undefined) {
      const modelId = modelOverride.modelId.trim();
      if (modelId.length === 0) throw new Error('runs:setModelSelection requires a model id');
      await ctx.db.patch(runId, {
        tier: undefined,
        modelOverride: {
          provider: modelOverride.provider,
          modelId,
          ...(modelOverride.label?.trim()
            ? { label: modelOverride.label.trim().slice(0, 96) }
            : {}),
        },
      });
      return { ok: true };
    }
    if (tier) await ctx.db.patch(runId, { tier, modelOverride: undefined });
    else await ctx.db.patch(runId, { tier: undefined, modelOverride: undefined });
    return { ok: true };
  },
});

const STATUS_UNION = v.union(...RUN_STATUSES.map((s) => v.literal(s)));

function inferTitle(prompt: string | undefined, fallback: string): string {
  const trimmed = prompt?.replace(/\s+/g, ' ').trim();
  if (!trimmed) return fallback;
  return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed;
}

function importedUiKitSlugs(files: Record<string, string>): Set<string> {
  const slugs = new Set<string>();
  for (const path of Object.keys(files)) {
    const match = path.match(/^ui_kits\/([^/]+)\//);
    if (match?.[1]) slugs.add(match[1]);
  }
  return slugs;
}

function selectImportedEntryHtml(files: Record<string, string>, slug: string): string {
  const exactIndex = files[`ui_kits/${slug}/index.html`];
  if (exactIndex !== undefined) return exactIndex;
  const manifestEntry = entryFromProjectManifest(files, slug);
  if (manifestEntry && files[manifestEntry] !== undefined) return files[manifestEntry] as string;
  const root = `ui_kits/${slug}/`;
  const slugHtml = Object.entries(files)
    .filter(([path]) => path.startsWith(root) && path.endsWith('.html'))
    .sort(([a], [b]) => a.localeCompare(b));
  const firstSlugHtml = slugHtml[0]?.[1];
  if (firstSlugHtml !== undefined) return firstSlugHtml;
  const firstIndex = Object.entries(files).find(
    ([path]) => path.endsWith('/index.html') || path === 'index.html',
  )?.[1];
  return (
    firstIndex ??
    '<!doctype html><html><body><!-- ui_kit imported without index.html --></body></html>'
  );
}

function entryFromProjectManifest(files: Record<string, string>, slug: string): string | null {
  const raw = files['parity.project.json'];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      surfaces?: Array<{ slug?: string; entry?: string | null }>;
    };
    const surface = parsed.surfaces?.find((item) => item.slug === slug);
    return typeof surface?.entry === 'string' && surface.entry.length > 0 ? surface.entry : null;
  } catch {
    return null;
  }
}

function normalizeModelOverride(
  modelOverride:
    | {
        provider:
          | 'anthropic'
          | 'openai'
          | 'google'
          | 'openrouter'
          | 'groq'
          | 'cerebras'
          | 'xai'
          | 'mistral';
        modelId: string;
        label?: string;
      }
    | undefined,
) {
  if (modelOverride === undefined) return undefined;
  const modelId = modelOverride.modelId.trim();
  if (modelId.length === 0) throw new Error('model override requires a model id');
  return {
    provider: modelOverride.provider,
    modelId,
    ...(modelOverride.label?.trim() ? { label: modelOverride.label.trim().slice(0, 96) } : {}),
  };
}

function publicRunFromDoc(run: Doc<'runs'>) {
  const { sourceImageBase64: _sourceImageBase64, ...rest } = run;
  return {
    ...rest,
    hasSourceImage: Boolean(run.sourceImageBase64 || run.sourceImageStorageId),
    ...(run.sourceImageBase64
      ? { sourceImageByteLength: Math.ceil((run.sourceImageBase64.length * 3) / 4) }
      : {}),
  };
}

function publicRun(run: Doc<'runs'> | null) {
  return run === null ? null : publicRunFromDoc(run);
}

export const start = mutation({
  args: {
    projectId: v.optional(v.id('projects')),
    clientSessionId: v.optional(v.string()),
    title: v.optional(v.string()),
    tier: v.optional(TIER_UNION),
    modelOverride: v.optional(MODEL_OVERRIDE_VALIDATOR),
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
    const now = Date.now();
    const title = inferTitle(
      args.title ?? args.prompt,
      hasImage ? 'Image to UI kit' : 'Prompt to UI kit',
    );
    const modelOverride = normalizeModelOverride(args.modelOverride);
    const projectId =
      args.projectId ??
      (await ctx.db.insert('projects', {
        ...(args.clientSessionId !== undefined ? { clientSessionId: args.clientSessionId } : {}),
        title,
        sourceType: hasImage ? 'image' : 'prompt',
        starred: false,
        createdAt: now,
        updatedAt: now,
      }));
    if (args.projectId !== undefined) {
      await ctx.db.patch(args.projectId, { updatedAt: now });
    }
    const runId = await ctx.db.insert('runs', {
      projectId,
      ...(args.clientSessionId !== undefined ? { clientSessionId: args.clientSessionId } : {}),
      title,
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
      ...(args.tier !== undefined ? { tier: args.tier } : {}),
      ...(modelOverride !== undefined ? { modelOverride } : {}),
    });

    // Kick off the durable workflow. Returns a workflow id we persist on
    // the run row so the dashboard / status query can deep-link to the
    // workflow record if it ever needs to.
    const workflowId = await workflow.start(ctx, internal.workflows.parityStudioWorkflow, {
      runId,
      ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
      ...(args.sourceImageBase64 !== undefined
        ? { sourceImageBase64: args.sourceImageBase64 }
        : {}),
      ...(args.sourceImageMimeType !== undefined
        ? { sourceImageMimeType: args.sourceImageMimeType }
        : {}),
    });
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
    projectId: v.optional(v.id('projects')),
    clientSessionId: v.optional(v.string()),
    tier: v.optional(TIER_UNION),
    modelOverride: v.optional(MODEL_OVERRIDE_VALIDATOR),
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
    /**
     * Optional source artifact HTML captured from an existing product route.
     * When present, deterministic verify compares the generated ui_kit
     * against this source instead of self-verifying against the imported
     * ui_kit's own index.html.
     */
    sourceArtifactHtml: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const files = (args.files ?? {}) as Record<string, string>;
    if (typeof args.slug !== 'string' || args.slug.length === 0) {
      throw new Error('runs:startFromKit requires a slug');
    }
    if (Object.keys(files).length === 0) {
      throw new Error('runs:startFromKit requires at least one file');
    }
    const indexHtml = selectImportedEntryHtml(files, args.slug);
    const artifactHtml = args.sourceArtifactHtml ?? indexHtml;
    const filesWithContract = withOperatingContract(files, {
      slug: args.slug,
      prompt: args.prompt,
      sourceHtml: artifactHtml,
      sourceType: args.sourceArtifactHtml ? 'platform-route' : 'imported-kit',
      importToParityStudio: true,
      createdAtIso: new Date().toISOString(),
    });

    const now = Date.now();
    const title = inferTitle(args.prompt, `Imported ${args.slug}`);
    const modelOverride = normalizeModelOverride(args.modelOverride);
    const projectId =
      args.projectId ??
      (await ctx.db.insert('projects', {
        ...(args.clientSessionId !== undefined ? { clientSessionId: args.clientSessionId } : {}),
        title,
        sourceType: args.sourceArtifactHtml ? 'platform-route' : 'zip',
        starred: false,
        createdAt: now,
        updatedAt: now,
      }));
    if (args.projectId !== undefined) {
      await ctx.db.patch(args.projectId, { updatedAt: now });
    }

    const runId = await ctx.db.insert('runs', {
      projectId,
      ...(args.clientSessionId !== undefined ? { clientSessionId: args.clientSessionId } : {}),
      title,
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
      ...(args.tier !== undefined ? { tier: args.tier } : {}),
      ...(modelOverride !== undefined ? { modelOverride } : {}),
    });

    // Insert artifact (the index.html) at version 0 so the canvas iframe
    // renders it immediately.
    await ctx.db.insert('artifacts', {
      runId,
      version: 0,
      html: artifactHtml,
      sizeBytes: artifactHtml.length,
    });

    const importedSlugs = importedUiKitSlugs(filesWithContract);
    const isProjectPack =
      importedSlugs.size > 1 || filesWithContract['parity.project.json'] !== undefined;

    // Single-kit imports get the full canonical scaffold. Multi-surface
    // project packs already carry their own files and can exceed Convex's
    // document size limit if we duplicate preview/assets/explorations for
    // every surface, so preserve them as-is plus the operating contract.
    const importFullShape = isProjectPack
      ? filesWithContract
      : {
          ...expandToCanonicalShape({
            slug: args.slug,
            kitFiles: filesWithContract,
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
          }),
          ...filesWithContract,
        };

    // Insert ui_kit row with cost = 0.
    const fileCount = Object.keys(importFullShape).length;
    const uiKitId = await ctx.db.insert('ui_kits', {
      runId,
      artifactVersion: 0,
      slug: args.slug,
      schemaVersion: 1,
      files: importFullShape,
      fileCount,
      decomposeCostMicroUsd: 0,
    });
    await recordDesignRevision(ctx, {
      runId,
      uiKitId,
      kind: 'initial',
      label: 'Imported ui_kit snapshot',
      summary: `Imported ${args.slug} with ${fileCount} files.`,
      changedPaths: Object.keys(importFullShape).slice(0, 20),
      files: importFullShape,
      source: 'app',
    });

    // Trigger verify in the background so the right-rail rubric populates.
    await ctx.scheduler.runAfter(0, internal.workflows.verifyImportedKit, { runId });

    return runId;
  },
});

export const get = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return publicRun(await ctx.db.get(runId));
  },
});

export const getSourceImage = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (run === null || !run.sourceImageBase64 || !run.sourceImageMimeType) return null;
    return {
      base64: run.sourceImageBase64,
      mimeType: run.sourceImageMimeType,
      byteLength: Math.ceil((run.sourceImageBase64.length * 3) / 4),
    };
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
  args: {
    limit: v.optional(v.number()),
    clientSessionId: v.optional(v.string()),
    projectId: v.optional(v.id('projects')),
  },
  handler: async (ctx, { limit, clientSessionId, projectId }) => {
    const cap = Math.min(Math.max(limit ?? 20, 1), 100);
    if (projectId !== undefined) {
      try {
        const rows = await ctx.db
          .query('runs')
          .withIndex('by_project', (q) => q.eq('projectId', projectId))
          .order('desc')
          .take(cap);
        return rows.map((run) => publicRunFromDoc(run));
      } catch {
        const rows = await ctx.db
          .query('runs')
          .order('desc')
          .take(cap * 10);
        return rows
          .filter((run) => run.projectId === projectId)
          .slice(0, cap)
          .map((run) => publicRunFromDoc(run));
      }
    }
    if (clientSessionId !== undefined) {
      try {
        const rows = await ctx.db
          .query('runs')
          .withIndex('by_session', (q) => q.eq('clientSessionId', clientSessionId))
          .order('desc')
          .take(cap);
        return rows.map((run) => publicRunFromDoc(run));
      } catch {
        const rows = await ctx.db
          .query('runs')
          .order('desc')
          .take(cap * 10);
        return rows
          .filter((run) => run.clientSessionId === clientSessionId)
          .slice(0, cap)
          .map((run) => publicRunFromDoc(run));
      }
    }
    const rows = await ctx.db.query('runs').order('desc').take(cap);
    return rows.map((run) => publicRunFromDoc(run));
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
