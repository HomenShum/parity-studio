'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { checkDeterministic } from './lib/parityChecker';
import { call } from './lib/piAi';
import { DECOMPOSE_SYSTEM, GENERATE_SYSTEM, ITERATE_SYSTEM, VISUAL_JUDGE_SYSTEM } from './lib/prompts';
import { parseUiKitResponse } from './lib/uiKitParser';

// Default model picks. Each can be overridden per-run via Convex env when
// we wire that surface (v0.0.3). Picks chosen for a balance of quality, cost,
// and vision capability.
const GENERATE_MODEL = { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-5' };
const DECOMPOSE_MODEL = { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-5' };
const VISUAL_JUDGE_MODEL = { provider: 'google' as const, modelId: 'gemini-3-pro-preview' };

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
    await ctx.runMutation(internal.runs.updateStatus, { runId, status: 'generating' });

    const userText =
      prompt?.trim().length
        ? prompt
        : 'Generate a polished, production-quality UI matching the attached image.';

    const result = await call({
      ...GENERATE_MODEL,
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
    await ctx.runMutation(internal.runs.accumulateCost, {
      runId,
      addMicroUsd: result.costMicroUsd,
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
    await ctx.runMutation(internal.runs.updateStatus, { runId, status: 'decomposing' });

    const result = await call({
      ...DECOMPOSE_MODEL,
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

    await ctx.runMutation(internal.uiKits.save, {
      runId,
      artifactVersion,
      slug: parsed.slug,
      schemaVersion: 1,
      files: parsed.files,
      decomposeCostMicroUsd: result.costMicroUsd,
    });
    await ctx.runMutation(internal.runs.accumulateCost, {
      runId,
      addMicroUsd: result.costMicroUsd,
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

    const indexHtml = findFileEnding(files, '/index.html') ?? null;
    const tokensCss = findFileEnding(files, '/tokens.css') ?? null;

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
    });
    return report;
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
 * Helpers
 */
function stripWrappingFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/);
  return fenceMatch?.[1] ?? trimmed;
}

function findFileEnding(files: Record<string, string>, suffix: string): string | undefined {
  for (const [path, content] of Object.entries(files)) {
    if (path === suffix.replace(/^\/+/, '') || path.endsWith(suffix)) return content;
  }
  return undefined;
}

// Suppress unused-import warnings until iterate stage is wired (v0.0.2)
void ITERATE_SYSTEM;
void VISUAL_JUDGE_SYSTEM;
void MAX_ITERATIONS;
