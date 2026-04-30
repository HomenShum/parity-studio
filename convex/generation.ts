'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalAction } from './_generated/server';
import { deploymentTier, resolveModel, sessionPick, type ModelTier, type Phase } from './lib/autoRouter';
import { findActiveKitFile, inferActiveKitSlug } from './lib/activeKitFiles';
import { expandToCanonicalShape } from './lib/canonicalShape';
import { checkDeterministic } from './lib/parityChecker';
import { call } from './lib/piAi';
import { DECOMPOSE_SYSTEM, GENERATE_SYSTEM, ITERATE_SYSTEM, VISUAL_JUDGE_SYSTEM } from './lib/prompts';
import { parseUiKitResponse } from './lib/uiKitParser';

/**
 * Resolve the (provider, modelId) for a pipeline phase given the run's
 * tier. Reads runs.tier first; falls back to PARITY_TIER env (set on
 * the Convex deployment); defaults to 'balanced' (which uses kimi-k2.6
 * for generate/decompose/iterate — same behavior as the legacy hardcoded
 * GENERATE_MODEL/DECOMPOSE_MODEL constants below).
 *
 * sessionPick spreads load across primary + fallback for free-tier slugs
 * so a single :free model doesn't get hammered.
 */
async function tierForRun(
  // biome-ignore lint/suspicious/noExplicitAny: action ctx
  ctx: any,
  runId: string,
): Promise<ModelTier> {
  const run = await ctx.runQuery(internal.runs.getInternal, { runId });
  const t = run?.tier as ModelTier | undefined;
  return t ?? deploymentTier();
}

function pickPhase(tier: ModelTier, phase: Phase, runId: string): { provider: 'anthropic' | 'openai' | 'google' | 'openrouter' | 'groq' | 'cerebras' | 'xai' | 'mistral'; modelId: string; isFree: boolean } {
  const resolved = sessionPick(runId, resolveModel(tier, phase));
  return { provider: resolved.provider, modelId: resolved.modelId, isFree: resolved.isFree };
}

// Cheap-tier defaults. Per user request: Kimi K2.6 via OpenRouter for the
// LLM stages (~$0.05-0.10/call vs $0.30-0.40 for Opus), Gemini 2.5 Flash
// via Google direct for the visual judge (~$0.005/call, vision-capable).
//
// Provider keys required on the deployment:
//   ANTHROPIC_API_KEY    optional fallback if user overrides to claude-*
//   OPENAI_API_KEY       required for image-gen + gpt-* model overrides
//   GEMINI_API_KEY       required for the visual judge default
//   OPENROUTER_API_KEY   required for kimi-k2.6 (any vendor/model id)
//
// Per-call overrides come through runs.start args (per-stage modelOverrides),
// reaching here via the workflow handler.
// Legacy GENERATE_MODEL / DECOMPOSE_MODEL constants removed —
// pipeline now resolves models via tierForRun(ctx, runId) +
// pickPhase(tier, phase) above. The default tier is 'balanced' which
// maps generate/decompose to openrouter/moonshotai/kimi-k2.6 — same
// underlying model as the old hardcoded constants. Set runs.tier='free'
// for $0 routes (qwen-coder-32b:free / deepseek-v3.1:free).
// Judge stays on the strong tier: gemini-3.1-pro-preview is the best-available
// vision verifier today. ~$0.02-0.05 per judge call (vs ~$0.005 for flash) but
// the rubric quality difference matters — the judge is what catches drift the
// deterministic checker can't see. False positives here have higher cost than
// the small judge fee.
const VISUAL_JUDGE_MODEL = { provider: 'openrouter' as const, modelId: 'google/gemini-3.1-pro-preview' };

const MAX_ITERATIONS = 2;

/**
 * Stage 1: generate initial HTML artifact from prompt + optional image.
 * Persists the artifact and accumulates cost.
 */
export const generateInitial = internalAction({
  args: {
    runId: v.id('runs'),
    prompt: v.optional(v.string()),
    sourceImageBase64: v.optional(v.string()),
    sourceImageMimeType: v.optional(
      v.union(v.literal('image/png'), v.literal('image/jpeg'), v.literal('image/webp')),
    ),
  },
  handler: async (ctx, { runId, prompt, sourceImageBase64, sourceImageMimeType }) => {
    const stageStartedAt = Date.now();
    await ctx.runMutation(internal.runs.updateStatus, { runId, status: 'generating' });

    const userText =
      prompt?.trim().length
        ? prompt
        : 'Generate a polished, production-quality UI matching the attached image.';

    const tier = await tierForRun(ctx, String(runId));
    const picked = pickPhase(tier, 'generate', String(runId));
    const result = await call({
      provider: picked.provider,
      modelId: picked.modelId,
      systemPrompt: GENERATE_SYSTEM,
      userText,
      maxTokens: 16_000,
      ...(sourceImageBase64 !== undefined && sourceImageMimeType !== undefined
        ? { userImage: { base64: sourceImageBase64, mimeType: sourceImageMimeType } }
        : {}),
    });

    if (result.stopReason === 'error') {
      await ctx.runMutation(internal.runs.updateStatus, {
        runId,
        status: 'failed',
        errorMessage: `generate stage error: ${result.errorMessage ?? 'unknown'}`,
      });
      throw new Error(`generate stage error: ${result.errorMessage ?? 'unknown'}`);
    }

    const html = stripWrappingFences(result.text);
    await ctx.runMutation(internal.artifacts.append, { runId, version: 0, html });
    await ctx.runMutation(internal.runs.recordStageTelemetry, {
      runId,
      stage: 'generate',
      modelId: result.modelUsed,
      provider: result.provider,
      costMicroUsd: result.costMicroUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - stageStartedAt,
      stageStartedAt,
    });
    return { version: 0, costMicroUsd: result.costMicroUsd };
  },
});

/**
 * Stage 2: decompose the artifact into a ui_kit/<slug>/ bundle.
 */
export const decompose = internalAction({
  args: {
    runId: v.id('runs'),
    artifactVersion: v.number(),
    artifactHtml: v.string(),
  },
  handler: async (ctx, { runId, artifactVersion, artifactHtml }) => {
    const stageStartedAt = Date.now();
    await ctx.runMutation(internal.runs.updateStatus, { runId, status: 'decomposing' });

    const tier = await tierForRun(ctx, String(runId));
    const picked = pickPhase(tier, 'decompose', String(runId));
    const result = await call({
      provider: picked.provider,
      modelId: picked.modelId,
      systemPrompt: DECOMPOSE_SYSTEM,
      userText: `Decompose this HTML artifact into a ui_kit/<slug>/ bundle:\n\n${artifactHtml}`,
      maxTokens: 24_000,
    });

    if (result.stopReason === 'error') {
      await ctx.runMutation(internal.runs.updateStatus, {
        runId,
        status: 'failed',
        errorMessage: `decompose stage error: ${result.errorMessage ?? 'unknown'}`,
      });
      throw new Error(`decompose stage error: ${result.errorMessage ?? 'unknown'}`);
    }

    const parsed = parseUiKitResponse(result.text);
    if (Object.keys(parsed.files).length === 0) {
      throw new Error(`decompose returned 0 files; warnings: ${parsed.warnings.join('; ')}`);
    }

    // Expand to the full canonical shape so the chat agent can patchFile
    // any preview/, assets/, or explorations/ path atomically. Kit code
    // wins over canonical-shape regeneration on conflicts (the spread
    // order below makes the parsed kit files override).
    const runRow = await ctx.runQuery(internal.runs.getInternal, { runId });
    const canonical = expandToCanonicalShape({
      slug: parsed.slug,
      kitFiles: parsed.files,
      run: {
        runId: String(runId),
        prompt: runRow?.prompt,
        costMicroUsd: runRow?.costMicroUsd ?? 0,
        iterationsCompleted: runRow?.iterationsCompleted ?? 0,
        sourceImageMimeType: runRow?.sourceImageMimeType,
        hasSourceImage: Boolean(runRow?.sourceImageBase64),
      },
      parity: null,
      artifacts: [],
    });
    const fullShape = { ...canonical, ...parsed.files };

    await ctx.runMutation(internal.uiKits.save, {
      runId,
      artifactVersion,
      slug: parsed.slug,
      schemaVersion: 1,
      files: fullShape,
      decomposeCostMicroUsd: result.costMicroUsd,
    });
    await ctx.runMutation(internal.runs.recordStageTelemetry, {
      runId,
      stage: 'decompose',
      modelId: result.modelUsed,
      provider: result.provider,
      costMicroUsd: result.costMicroUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - stageStartedAt,
      stageStartedAt,
    });
    return {
      slug: parsed.slug,
      fileCount: Object.keys(parsed.files).length,
      warnings: parsed.warnings,
    };
  },
});

/**
 * Stage 3: deterministic verifier. No LLM, no cost. Pure parity checks.
 */
export const verifyDeterministic = internalAction({
  args: {
    runId: v.id('runs'),
    uiKitId: v.id('ui_kits'),
    iterationNumber: v.number(),
    sourceHtml: v.string(),
  },
  handler: async (ctx, { runId, uiKitId, iterationNumber, sourceHtml }) => {
    await ctx.runMutation(internal.runs.updateStatus, { runId, status: 'verifying' });

    const uiKit = await ctx.runQuery(internal.uiKits.getInternal, { uiKitId });
    if (uiKit === null) throw new Error(`ui_kit ${uiKitId} not found`);
    const files = (uiKit.files as Record<string, string>) ?? {};

    const indexHtml = findActiveKitFile(files, uiKit.slug, 'index.html') ?? null;
    const tokensCss = findActiveKitFile(files, uiKit.slug, 'tokens.css') ?? null;

    const report = checkDeterministic({
      sourceHtml,
      decomposedHtml: indexHtml,
      tokensCss,
      uiKitFiles: files,
    });

    await ctx.runMutation(internal.parityReports.save, {
      runId,
      uiKitId,
      iterationNumber,
      passCount: report.passCount,
      totalChecks: report.totalChecks,
      status: report.status,
      gaps: report.gaps,
      summary: report.summary,
      judgeCostMicroUsd: 0,
      judgeModel: 'deterministic',
      // Sprint 3: persist the 16-row typed rubric so the right-rail
      // ParityPanel renders honest per-check verdicts + evidence
      // instead of bucket-derived approximations.
      checks: report.checks,
    });
    return report;
  },
});

/**
 * Stage 5: iterate — re-decompose with the previous parity report's gaps as
 * explicit feedback. Produces a new ui_kit row + new artifactVersion so the
 * verify stage can run again against it.
 *
 * Bounded by MAX_ITERATIONS (set in workflow). Each iteration costs another
 * decompose call (~$0.05-0.40 depending on model). The workflow only invokes
 * iterate when verifyDeterministic returns status='needs_iteration' AND the
 * iteration count is below the cap — honest scope: never silent infinite loop.
 */
export const iterate = internalAction({
  args: {
    runId: v.id('runs'),
    iterationNumber: v.number(),
    sourceHtml: v.string(),
    previousUiKitFiles: v.any(), // Record<string, string>
    failedGaps: v.any(), // ParityGap[]
  },
  handler: async (ctx, args) => {
    const iterateStartedAt = Date.now();
    await ctx.runMutation(internal.runs.updateStatus, { runId: args.runId, status: 'iterating' });

    const previousFiles = args.previousUiKitFiles as Record<string, string>;
    const previousSlug = inferActiveKitSlug(previousFiles);
    const previousIndexHtml = findActiveKitFile(previousFiles, previousSlug, 'index.html') ?? '';
    const previousTokensCss = findActiveKitFile(previousFiles, previousSlug, 'tokens.css') ?? '';

    const failedGaps = (args.failedGaps as Array<{ kind?: string; severity?: string; message?: string }>) ?? [];
    const gapText = failedGaps.length === 0
      ? '(no specific gaps reported, but parity score was below threshold — review the previous bundle for opportunities to better match the source)'
      : failedGaps
          .map((g, i) => `${i + 1}. [${g.severity ?? 'medium'}/${g.kind ?? 'check'}] ${g.message ?? ''}`)
          .join('\n');

    const userText = `Previous decompose attempt fell below parity. Re-emit the COMPLETE
ui_kit/<slug>/ bundle in the same fenced-block format, addressing the failed
checks below. Preserve everything that already passed; only fix what was flagged.

FAILED CHECKS:
${gapText}

PREVIOUS index.html (for reference):
\`\`\`
${previousIndexHtml.slice(0, 8_000)}
\`\`\`

PREVIOUS tokens.css:
\`\`\`
${previousTokensCss.slice(0, 2_000)}
\`\`\`

ORIGINAL SOURCE (the artifact you should be matching):
${args.sourceHtml.slice(0, 8_000)}`;

    const tier = await tierForRun(ctx, String(args.runId));
    const picked = pickPhase(tier, 'iterate', String(args.runId));
    const result = await call({
      provider: picked.provider,
      modelId: picked.modelId,
      systemPrompt: ITERATE_SYSTEM,
      userText,
      maxTokens: 24_000,
    });

    if (result.stopReason === 'error') {
      await ctx.runMutation(internal.runs.updateStatus, {
        runId: args.runId,
        status: 'failed',
        errorMessage: `iterate stage error: ${result.errorMessage ?? 'unknown'}`,
      });
      throw new Error(`iterate stage error: ${result.errorMessage ?? 'unknown'}`);
    }

    const parsed = parseUiKitResponse(result.text);
    if (Object.keys(parsed.files).length === 0) {
      // Soft-fail: the LLM emitted fenced blocks without path annotations
      // (a known kimi-k2.6 quirk on iterate prompts). The previous ui_kit
      // is still intact, so don't throw — record the wasted-call telemetry
      // and let the workflow detect "no new ui_kit" and exit the loop
      // gracefully with status='done'. Previous behavior conflated this
      // recoverable LLM-format glitch with a pipeline crash.
      await ctx.runMutation(internal.runs.recordStageTelemetry, {
        runId: args.runId,
        stage: `iterate-${args.iterationNumber}-noop`,
        modelId: result.modelUsed,
        provider: result.provider,
        costMicroUsd: result.costMicroUsd,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - iterateStartedAt,
        stageStartedAt: iterateStartedAt,
      });
      return {
        iterationNumber: args.iterationNumber,
        slug: '',
        fileCount: 0,
        costMicroUsd: result.costMicroUsd,
      };
    }

    // Expand to canonical shape on iterate too, so each new ui_kit row
    // is fully addressable from the chat agent.
    const iterRunRow = await ctx.runQuery(internal.runs.getInternal, { runId: args.runId });
    const iterCanonical = expandToCanonicalShape({
      slug: parsed.slug,
      kitFiles: parsed.files,
      run: {
        runId: String(args.runId),
        prompt: iterRunRow?.prompt,
        costMicroUsd: iterRunRow?.costMicroUsd ?? 0,
        iterationsCompleted: args.iterationNumber,
        sourceImageMimeType: iterRunRow?.sourceImageMimeType,
        hasSourceImage: Boolean(iterRunRow?.sourceImageBase64),
      },
      parity: null,
      artifacts: [],
    });

    // Merge policy: user edits made on the previous ui_kit row's
    // canonical-shape files (preview/, assets/, explorations/, top-level
    // docs) MUST survive an iterate. Without this, the chat agent's
    // edits to e.g. assets/og-<slug>.svg would be silently overwritten
    // each time the user clicks Iterate now.
    //   1. Start with the previous map (preserves all user edits)
    //   2. Drop ui_kits/<slug>/* paths (replaced by new decompose)
    //   3. Overlay the new kit code from `parsed.files`
    //   4. Add any canonical paths that didn't exist before (e.g. a
    //      preview specimen for a NEW component this iterate produced)
    const priorFiles = (args.previousUiKitFiles as Record<string, string>) ?? {};
    const slugPrefix = `ui_kits/${parsed.slug}/`;
    const iterFullShape: Record<string, string> = {};
    for (const [k, v] of Object.entries(priorFiles)) {
      if (!k.startsWith(slugPrefix)) iterFullShape[k] = v; // preserve user edits + non-kit paths
    }
    for (const [k, v] of Object.entries(parsed.files)) {
      iterFullShape[k] = v; // new decompose wins on kit paths
    }
    for (const [k, v] of Object.entries(iterCanonical)) {
      if (!(k in iterFullShape)) iterFullShape[k] = v; // backfill new canonical (e.g. new component → new specimen)
    }

    await ctx.runMutation(internal.uiKits.save, {
      runId: args.runId,
      // Bump artifactVersion so getLatest disambiguates this iteration's ui_kit
      // from the previous one. The artifact row stays the same — we're
      // re-decomposing it, not regenerating it.
      artifactVersion: args.iterationNumber + 1,
      slug: parsed.slug,
      schemaVersion: 1,
      files: iterFullShape,
      decomposeCostMicroUsd: result.costMicroUsd,
    });
    await ctx.runMutation(internal.runs.recordStageTelemetry, {
      runId: args.runId,
      stage: `iterate-${args.iterationNumber}`,
      modelId: result.modelUsed,
      provider: result.provider,
      costMicroUsd: result.costMicroUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - iterateStartedAt,
      stageStartedAt: iterateStartedAt,
    });
    await ctx.runMutation(internal.runs.updateStatus, {
      runId: args.runId,
      status: 'verifying',
      iterationsCompleted: args.iterationNumber,
    });

    return {
      iterationNumber: args.iterationNumber,
      slug: parsed.slug,
      fileCount: Object.keys(parsed.files).length,
      costMicroUsd: result.costMicroUsd,
    };
  },
});

/**
 * Stage 4: visual verifier. Renders the ui_kit headlessly, sends source +
 * rendered to a vision LLM, parses the boolean rubric.
 *
 * v0.0.1 placeholder: marks as 'unavailable' since headless ui_kit rendering
 * is not yet wired (needs a Convex action that boots a headless browser, or
 * a Vercel function that does it). Wires real in v0.0.2.
 */
export const verifyVisual = internalAction({
  args: {
    runId: v.id('runs'),
    uiKitId: v.id('ui_kits'),
    iterationNumber: v.number(),
  },
  handler: async (ctx, { runId, uiKitId, iterationNumber }) => {
    await ctx.runMutation(internal.parityReports.save, {
      runId,
      uiKitId,
      iterationNumber,
      passCount: 0,
      totalChecks: 12,
      status: 'unavailable',
      gaps: [],
      summary: 'visual judge not yet wired (v0.0.1 placeholder — needs headless render path)',
      judgeCostMicroUsd: 0,
      judgeModel: VISUAL_JUDGE_MODEL.modelId,
    });
    return { status: 'unavailable' as const };
  },
});

/**
 * Public action: generate a source image from a text prompt using OpenAI's
 * image model. Returns base64 + mime so the frontend can immediately drop it
 * into the same `runs.start` flow as an uploaded image — no server-side
 * persistence, no extra round trip.
 *
 * Wired to the "Generate from prompt" button in InputBar. Closes the
 * "no in-app image generation" gap from issue #225.
 *
 * Cost telemetry: prefer the OpenAI response `usage` block (gpt-image-2
 * returns input/output token counts) and compute exact micro-USD using the
 * published per-token pricing. Falls back to a size-based estimate if the
 * API ever stops emitting usage.
 */
const GPT_IMAGE_2_PRICING_PER_MTOK = {
  textInput: 5,    // $5 per 1M input text tokens
  imageInput: 10,  // $10 per 1M input image tokens (e.g. for edits, not used here)
  imageOutput: 40, // $40 per 1M output image tokens
} as const;
const GPT_IMAGE_2_FALLBACK_MICRO_USD: Record<string, number> = {
  '1024x1024': 40_000,
  '1024x1536': 62_000,
  '1536x1024': 62_000,
};

export const generateSourceImage = action({
  args: {
    prompt: v.string(),
    size: v.optional(
      v.union(v.literal('1024x1024'), v.literal('1024x1536'), v.literal('1536x1024')),
    ),
  },
  handler: async (
    _ctx,
    { prompt, size },
  ): Promise<{
    base64: string;
    mimeType: 'image/png';
    costMicroUsd: number;
    costSource: 'usage' | 'estimate';
    inputTokens: number;
    outputTokens: number;
    modelUsed: string;
    latencyMs: number;
  }> => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      throw new Error('generateSourceImage: prompt is required');
    }
    if (trimmed.length > 4_000) {
      throw new Error('generateSourceImage: prompt capped at 4000 chars');
    }
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('generateSourceImage: OPENAI_API_KEY not configured');
    }

    const resolvedSize = size ?? '1024x1024';
    const startedAt = Date.now();
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: trimmed,
        size: resolvedSize,
        n: 1,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const latencyMs = Date.now() - startedAt;

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`gpt-image-2 HTTP ${resp.status}: ${text.slice(0, 400)}`);
    }

    const json = (await resp.json()) as {
      data?: Array<{ b64_json?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: {
          text_tokens?: number;
          image_tokens?: number;
        };
      };
    };
    const b64 = json.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || b64.length === 0) {
      throw new Error('gpt-image-2 returned no b64_json payload');
    }

    let costMicroUsd: number;
    let costSource: 'usage' | 'estimate';
    let inputTokens = 0;
    let outputTokens = 0;
    if (json.usage && typeof json.usage.output_tokens === 'number') {
      const textIn = json.usage.input_tokens_details?.text_tokens ?? json.usage.input_tokens ?? 0;
      const imageIn = json.usage.input_tokens_details?.image_tokens ?? 0;
      const out = json.usage.output_tokens;
      inputTokens = (json.usage.input_tokens ?? textIn + imageIn) | 0;
      outputTokens = out | 0;
      const usd =
        (textIn * GPT_IMAGE_2_PRICING_PER_MTOK.textInput +
          imageIn * GPT_IMAGE_2_PRICING_PER_MTOK.imageInput +
          out * GPT_IMAGE_2_PRICING_PER_MTOK.imageOutput) /
        1_000_000;
      costMicroUsd = Math.round(usd * 1_000_000);
      costSource = 'usage';
    } else {
      costMicroUsd = GPT_IMAGE_2_FALLBACK_MICRO_USD[resolvedSize] ?? 40_000;
      costSource = 'estimate';
    }

    return {
      base64: b64,
      mimeType: 'image/png',
      costMicroUsd,
      costSource,
      inputTokens,
      outputTokens,
      modelUsed: 'openai/gpt-image-2',
      latencyMs,
    };
  },
});

/**
 * Helpers
 */
function stripWrappingFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/);
  return fenceMatch?.[1] ?? trimmed;
}


// Suppress unused-import warnings — VISUAL_JUDGE_SYSTEM is referenced in
// future visual-verifier wiring; MAX_ITERATIONS is consumed by the workflow.
void VISUAL_JUDGE_SYSTEM;
void MAX_ITERATIONS;
