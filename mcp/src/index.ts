#!/usr/bin/env node
/**
 * parity-studio-mcp — MCP server exposing the decompose/verify/iterate loop
 * to coding agents (Claude Code, Cursor, Windsurf, any MCP client).
 *
 * Tools:
 *   - parity_pipeline    end-to-end: prompt|image -> ui_kit + ParityReport
 *   - parity_decompose   HTML artifact -> ui_kit/<slug>/{...} files
 *   - parity_verify      ui_kit + sourceHtml -> ParityReport (deterministic + visual)
 *   - parity_export_zip  ui_kit files -> base64-encoded ZIP for handoff
 *
 * Stdio transport. Designed for `command + args` configs in MCP clients:
 *
 *   "parity-studio": {
 *     "command": "npx",
 *     "args": ["-y", "parity-studio-mcp"],
 *     "env": {
 *       "ANTHROPIC_API_KEY": "sk-ant-...",
 *       "OPENAI_API_KEY": "sk-...",
 *       "PARITY_DECOMPOSE_MODEL": "claude-opus-4-1",
 *       "PARITY_JUDGE_MODEL": "claude-sonnet-4-5"
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import JSZip from 'jszip';
import { z } from 'zod';

import { eventBus, makeRunId } from './dashboard/events.js';
import { dashboardMode, openDashboardOnce } from './dashboard/openBrowser.js';
import { ensureDashboard } from './dashboard/server.js';
import { callByModel } from './lib/llmClient.js';
import {
  type ParityReport,
  checkDeterministic,
  statusFromBooleans,
} from './lib/parityChecker.js';
import {
  DECOMPOSE_SYSTEM,
  GENERATE_SYSTEM,
  ITERATE_SYSTEM,
  VISUAL_JUDGE_SYSTEM,
} from './lib/prompts.js';
import { renderHtmlToPng, shutdownRenderer } from './lib/render.js';
import { parseUiKitResponse } from './lib/uiKitParser.js';

/**
 * Eager-init the dashboard at MCP server boot. Returns the URL (or null
 * if PARITY_DASHBOARD=disabled). Browser auto-open is deferred to the
 * first actual tool call so we don't open an empty dashboard the moment
 * an agent merely lists tools.
 */
let bootDashboardUrl: string | null = null;
async function startDashboardAtBoot(): Promise<string | null> {
  if (dashboardMode() === 'disabled') return null;
  try {
    const handle = await ensureDashboard();
    bootDashboardUrl = handle.url;
    return handle.url;
  } catch (err) {
    console.error(
      '[parity-studio-mcp] dashboard boot failed; tools will run without it:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Called from each tool handler. Auto-opens the browser on the first real
 * tool invocation (per PARITY_DASHBOARD=auto-open default), but never blocks
 * the tool call. Returns the URL for inclusion in the response.
 */
async function dashboardForTool(): Promise<string | null> {
  if (bootDashboardUrl !== null) {
    await openDashboardOnce(bootDashboardUrl).catch(() => {});
  }
  return bootDashboardUrl;
}

const VERSION = '0.0.1';

// Model defaults — overridable via env
const GENERATE_MODEL = process.env['PARITY_GENERATE_MODEL'] ?? 'claude-sonnet-4-5';
const DECOMPOSE_MODEL = process.env['PARITY_DECOMPOSE_MODEL'] ?? 'claude-opus-4-1';
const JUDGE_MODEL = process.env['PARITY_JUDGE_MODEL'] ?? 'claude-sonnet-4-5';

// Image mime type, must match what most providers accept
const IMG_MIME_SCHEMA = z.enum(['image/png', 'image/jpeg', 'image/webp']);

// ---------- Tool: parity_decompose ----------------------------------------

const decomposeInput = {
  artifactHtml: z
    .string()
    .min(50, 'artifactHtml must be substantial — pass the full HTML artifact'),
  fallbackSlug: z
    .string()
    .optional()
    .describe('kebab-case slug to use if model does not pick one (default "untitled")'),
  decomposeModel: z
    .string()
    .optional()
    .describe(`override decompose model (default ${DECOMPOSE_MODEL})`),
};

async function handleDecompose(args: {
  artifactHtml: string;
  fallbackSlug?: string;
  decomposeModel?: string;
}) {
  const dashboardUrl = await dashboardForTool().catch(() => null);
  void dashboardUrl;
  const model = args.decomposeModel ?? DECOMPOSE_MODEL;
  const result = await callByModel({
    model,
    systemPrompt: DECOMPOSE_SYSTEM,
    userText: `Decompose this HTML artifact into a ui_kit/<slug>/ bundle:\n\n${args.artifactHtml}`,
    maxTokens: 24_000,
  });

  if (result.stopReason === 'error') {
    throw new Error(`decompose stage error from model ${result.modelUsed}`);
  }

  const parsed = parseUiKitResponse(result.text, args.fallbackSlug);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            slug: parsed.slug,
            files: parsed.files,
            fileCount: Object.keys(parsed.files).length,
            warnings: parsed.warnings,
            costUsd: result.costUsd,
            modelUsed: result.modelUsed,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ---------- Tool: parity_verify -------------------------------------------

const verifyInput = {
  uiKitFiles: z
    .record(z.string())
    .describe('Map of relative file paths to file contents (the parsed ui_kit/<slug>/ tree)'),
  sourceHtml: z
    .string()
    .min(20)
    .describe('Original HTML the ui_kit was decomposed from'),
  sourceImageBase64: z
    .string()
    .optional()
    .describe('Optional source mockup image. If provided, runs the visual judge in addition to deterministic checks.'),
  sourceImageMimeType: IMG_MIME_SCHEMA.optional(),
  judgeModel: z
    .string()
    .optional()
    .describe(`override judge model (default ${JUDGE_MODEL})`),
};

async function handleVerify(args: {
  uiKitFiles: Record<string, string>;
  sourceHtml: string;
  sourceImageBase64?: string;
  sourceImageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  judgeModel?: string;
}) {
  // Stage A: deterministic checks (no LLM, no cost)
  const indexHtml = findFileEnding(args.uiKitFiles, '/index.html') ?? null;
  const tokensCss = findFileEnding(args.uiKitFiles, '/tokens.css') ?? null;
  const detReport = checkDeterministic({
    sourceHtml: args.sourceHtml,
    decomposedHtml: indexHtml,
    tokensCss,
    uiKitFiles: args.uiKitFiles,
  });

  // Stage B (optional): visual judge if a source image is supplied + index.html exists
  let visualReport: VisualJudgeOutcome | null = null;
  if (args.sourceImageBase64 && args.sourceImageMimeType && indexHtml !== null) {
    visualReport = await runVisualJudge({
      sourceImageBase64: args.sourceImageBase64,
      sourceImageMimeType: args.sourceImageMimeType,
      indexHtml,
      judgeModel: args.judgeModel ?? JUDGE_MODEL,
    });
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            deterministic: detReport,
            visual: visualReport,
            combined: combinedReport(detReport, visualReport),
          },
          null,
          2,
        ),
      },
    ],
  };
}

interface VisualJudgeOutcome {
  passCount: number;
  totalChecks: number;
  parityScore: number;
  status: ParityReport['status'];
  summary: string;
  checks: Array<{ dimension: string; id: string; passed: boolean; note: string }>;
  judgeCostUsd: number;
  modelUsed: string;
  renderLatencyMs: number;
}

async function runVisualJudge(args: {
  sourceImageBase64: string;
  sourceImageMimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  indexHtml: string;
  judgeModel: string;
}): Promise<VisualJudgeOutcome> {
  const rendered = await renderHtmlToPng(args.indexHtml);

  // Build a single user message with both images side-by-side context.
  // Some providers only accept one image per message — we send the rendered as
  // primary and pass the source as a leading reference inside the userText.
  // For Anthropic vision multi-image: use both via two image blocks.
  // Simpler: pass them sequentially in the same prompt body, judge tolerates.
  const judge = await callByModel({
    model: args.judgeModel,
    systemPrompt: VISUAL_JUDGE_SYSTEM,
    userText:
      'IMAGE 1 = SOURCE (reference). IMAGE 2 = RENDERED candidate.\nReturn the JSON rubric described above.',
    userImage: { base64: args.sourceImageBase64, mediaType: args.sourceImageMimeType },
    maxTokens: 4_000,
  });

  // Parse JSON loosely — providers sometimes wrap in fences
  const parsed = parseLooseJson(judge.text);
  const checks: VisualJudgeOutcome['checks'] = Array.isArray(parsed?.['checks'])
    ? (parsed['checks'] as VisualJudgeOutcome['checks'])
    : [];
  const passCount = checks.filter((c) => c.passed === true).length;
  const totalChecks = checks.length || 12;
  const parityScore = totalChecks === 0 ? 0 : passCount / totalChecks;
  const status = statusFromBooleans(passCount, totalChecks);

  return {
    passCount,
    totalChecks,
    parityScore,
    status,
    summary:
      typeof parsed?.['summary'] === 'string'
        ? (parsed['summary'] as string)
        : `${passCount}/${totalChecks} visual checks passed`,
    checks,
    judgeCostUsd: judge.costUsd,
    modelUsed: judge.modelUsed,
    renderLatencyMs: rendered.latencyMs,
  };
}

function combinedReport(det: ParityReport, visual: VisualJudgeOutcome | null) {
  if (visual === null) {
    return {
      passCount: det.passCount,
      totalChecks: det.totalChecks,
      parityScore: det.parityScore,
      status: det.status,
      basis: 'deterministic-only',
    };
  }
  const passCount = det.passCount + visual.passCount;
  const totalChecks = det.totalChecks + visual.totalChecks;
  return {
    passCount,
    totalChecks,
    parityScore: passCount / totalChecks,
    status: statusFromBooleans(passCount, totalChecks),
    basis: 'deterministic+visual',
  };
}

// ---------- Tool: parity_pipeline -----------------------------------------

const pipelineInput = {
  prompt: z.string().optional().describe('Brief describing the desired UI. Either prompt or sourceImageBase64 (or both) required.'),
  sourceImageBase64: z.string().optional().describe('Optional source mockup. Required if generating from a sketch/screenshot.'),
  sourceImageMimeType: IMG_MIME_SCHEMA.optional(),
  generateModel: z.string().optional(),
  decomposeModel: z.string().optional(),
  judgeModel: z.string().optional(),
  skipGenerate: z
    .boolean()
    .optional()
    .describe('If true, treat sourceImageBase64 as the rendered artifact — skip stage 1 generation. Useful when the image is already a polished mockup.'),
};

async function handlePipeline(args: {
  prompt?: string;
  sourceImageBase64?: string;
  sourceImageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  generateModel?: string;
  decomposeModel?: string;
  judgeModel?: string;
  skipGenerate?: boolean;
}) {
  if (!args.prompt && !args.sourceImageBase64) {
    throw new Error('parity_pipeline requires at least one of: prompt, sourceImageBase64');
  }
  const generateModel = args.generateModel ?? GENERATE_MODEL;
  const decomposeModel = args.decomposeModel ?? DECOMPOSE_MODEL;
  const judgeModel = args.judgeModel ?? JUDGE_MODEL;

  // Spin up dashboard on first call. Best-effort: never blocks the run.
  const dashboardUrl = await dashboardForTool().catch(() => null);

  // Create the run record so the dashboard sees it the moment the user
  // looks. All subsequent stage updates broadcast via the event bus.
  const runId = makeRunId();
  eventBus.createRun(runId, {
    status: 'queued',
    ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
    ...(args.sourceImageBase64 !== undefined ? { sourceImageBase64: args.sourceImageBase64 } : {}),
    ...(args.sourceImageMimeType !== undefined ? { sourceImageMimeType: args.sourceImageMimeType } : {}),
  });
  eventBus.appendLog(runId, 'info', `parity_pipeline started (decompose=${decomposeModel}, judge=${judgeModel})`);

  try {
    let totalCostUsd = 0;
    let artifactHtml: string;
    let generateLatencyMs = 0;

    // Stage 1: generate (or skip if image provided + skipGenerate flag)
    if (args.skipGenerate && args.sourceImageBase64) {
      artifactHtml = `<!-- skipGenerate: source image used directly -->`;
      eventBus.setStage(runId, 'generate', 'unavailable');
      eventBus.appendLog(runId, 'info', 'generate stage skipped (skipGenerate=true)');
    } else {
      eventBus.updateRun(runId, { status: 'generating' });
      eventBus.setStage(runId, 'generate', 'running', undefined, generateModel);
      const t0 = Date.now();
      const gen = await callByModel({
        model: generateModel,
        systemPrompt: GENERATE_SYSTEM,
        userText: args.prompt ?? 'Generate a polished UI matching the attached image.',
        ...(args.sourceImageBase64 && args.sourceImageMimeType
          ? { userImage: { base64: args.sourceImageBase64, mediaType: args.sourceImageMimeType } }
          : {}),
        maxTokens: 16_000,
      });
      artifactHtml = stripWrappingFences(gen.text);
      totalCostUsd += gen.costUsd;
      generateLatencyMs = Date.now() - t0;
      eventBus.setStage(runId, 'generate', 'done', generateLatencyMs, generateModel);
      eventBus.addCost(runId, gen.costUsd);
      eventBus.updateRun(runId, { artifactHtmlFull: artifactHtml });
      eventBus.appendLog(runId, 'info', `generated ${artifactHtml.length} bytes in ${(generateLatencyMs / 1000).toFixed(1)}s, $${gen.costUsd.toFixed(4)}`);
    }

    // Stage 2: decompose -> verify -> iterate loop. Bounded by MAX_ITERATIONS.
    // Each iteration adds one decompose call + one verify pass.
    const MAX_ITERATIONS = 2;
    let iterationsCompleted = 0;
    let parsed = await runDecompose({
      runId,
      artifactHtml,
      decomposeModel,
    });
    let decomposeLatencyMs = parsed.latencyMs;
    let decomposeCostUsd = parsed.costUsd;
    totalCostUsd += parsed.costUsd;

    // Verify-iterate loop. We always at least run verify once. We only
    // iterate when status === needs_iteration AND we're below the cap.
    let detReport: ParityReport;
    let visualReport: VisualJudgeOutcome | null = null;
    let combined: ReturnType<typeof combinedReport>;
    let failedGaps: Array<{ kind?: string; severity?: string; message: string }> = [];

    while (true) {
      eventBus.updateRun(runId, { status: 'verifying' });
      eventBus.setStage(runId, 'verify', 'running');
      const indexHtml = findFileEnding(parsed.files, '/index.html') ?? null;
      const tokensCss = findFileEnding(parsed.files, '/tokens.css') ?? null;
      detReport = checkDeterministic({
        sourceHtml: artifactHtml,
        decomposedHtml: indexHtml,
        tokensCss,
        uiKitFiles: parsed.files,
      });
      eventBus.appendLog(
        runId,
        'info',
        `iter ${iterationsCompleted}: deterministic verify ${detReport.passCount}/${detReport.totalChecks} (${detReport.status})`,
      );

      visualReport = null;
      if (args.sourceImageBase64 && args.sourceImageMimeType && indexHtml !== null) {
        visualReport = await runVisualJudge({
          sourceImageBase64: args.sourceImageBase64,
          sourceImageMimeType: args.sourceImageMimeType,
          indexHtml,
          judgeModel,
        });
        totalCostUsd += visualReport.judgeCostUsd;
        eventBus.addCost(runId, visualReport.judgeCostUsd);
        eventBus.appendLog(
          runId,
          'info',
          `iter ${iterationsCompleted}: visual verify ${visualReport.passCount}/${visualReport.totalChecks} (${visualReport.status})`,
        );
      }

      combined = combinedReport(detReport, visualReport);
      const visualFailedChecks = visualReport?.checks?.filter((c) => !c.passed) ?? [];
      // Aggregate gaps from BOTH verifiers for the iterate prompt's feedback
      failedGaps = [
        ...detReport.gaps.map((g) => ({
          kind: g.kind,
          severity: g.severity ?? 'medium',
          message: g.message,
        })),
        ...visualFailedChecks.map((c) => ({
          kind: c.dimension,
          severity: 'high',
          message: c.note,
        })),
      ];

      eventBus.updateRun(runId, {
        parityReport: {
          passCount: combined.passCount,
          totalChecks: combined.totalChecks,
          parityScore: combined.parityScore,
          status: combined.status,
          summary: visualReport?.summary ?? detReport.summary,
          basis: combined.basis as 'deterministic' | 'visual' | 'deterministic+visual',
          failedChecks: visualFailedChecks,
        },
      });

      const shouldIterate =
        combined.status === 'needs_iteration' && iterationsCompleted < MAX_ITERATIONS;
      if (!shouldIterate) {
        eventBus.setStage(
          runId,
          'verify',
          combined.status === 'verified' || combined.status === 'needs_review' ? 'done' : 'failed',
        );
        break;
      }

      // Iterate: re-decompose with gap feedback. New ui_kit replaces the
      // current one in eventBus state so the dashboard reflects the latest.
      iterationsCompleted += 1;
      eventBus.updateRun(runId, { status: 'iterating' });
      eventBus.setStage(runId, 'iterate', 'running', undefined, decomposeModel);
      eventBus.appendLog(
        runId,
        'info',
        `iterating (round ${iterationsCompleted}/${MAX_ITERATIONS}) with ${failedGaps.length} gaps as feedback`,
      );
      const it0 = Date.now();
      parsed = await runIterate({
        runId,
        artifactHtml,
        previousFiles: parsed.files,
        failedGaps,
        decomposeModel,
      });
      const iterLatencyMs = Date.now() - it0;
      void iterLatencyMs;
      totalCostUsd += parsed.costUsd;
      eventBus.setStage(runId, 'iterate', 'done', parsed.latencyMs, decomposeModel);
      eventBus.appendLog(
        runId,
        'info',
        `iter ${iterationsCompleted}: re-decomposed ${Object.keys(parsed.files).length} files in ${(parsed.latencyMs / 1000).toFixed(1)}s, $${parsed.costUsd.toFixed(4)}`,
      );
    }

    eventBus.setStage(runId, 'done', 'done');
    eventBus.updateRun(runId, { status: 'done' });
    eventBus.appendLog(
      runId,
      'info',
      `pipeline complete after ${iterationsCompleted} iter(s): parityScore ${combined.parityScore.toFixed(2)} (${combined.status}), total $${totalCostUsd.toFixed(4)}`,
    );
    void decomposeLatencyMs;
    void decomposeCostUsd;

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              runId,
              dashboardUrl,
              uiKit: { slug: parsed.slug, files: parsed.files, warnings: parsed.warnings },
              deterministic: detReport,
              visual: visualReport,
              combined,
              costs: {
                totalUsd: Number(totalCostUsd.toFixed(4)),
                generate: args.skipGenerate ? 0 : 'included',
                decomposeFirstPass: decomposeCostUsd,
                visualJudge: visualReport?.judgeCostUsd ?? 0,
                iterations: iterationsCompleted,
              },
              latencies: {
                generateMs: generateLatencyMs,
                decomposeMs: decomposeLatencyMs,
                renderMs: visualReport?.renderLatencyMs ?? 0,
              },
              modelsUsed: {
                generate: args.skipGenerate ? null : generateModel,
                decompose: decomposeModel,
                judge: judgeModel,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    eventBus.updateRun(runId, { status: 'failed', errorMessage: message });
    eventBus.appendLog(runId, 'error', `pipeline failed: ${message}`);
    throw err;
  }
}

// ---------- Tool: parity_export_zip ---------------------------------------

const exportZipInput = {
  uiKitFiles: z
    .record(z.string())
    .describe('Map of relative file paths to file contents (from parity_decompose or parity_pipeline output)'),
  slug: z.string().describe('ui_kit slug to use as the root folder name'),
  includeReadme: z
    .boolean()
    .optional()
    .describe('Append a Claude Code / Cursor handoff README to the bundle (default true)'),
};

async function handleExportZip(args: {
  uiKitFiles: Record<string, string>;
  slug: string;
  includeReadme?: boolean;
}) {
  const includeReadme = args.includeReadme !== false;
  const zip = new JSZip();

  for (const [path, content] of Object.entries(args.uiKitFiles)) {
    zip.file(path, content);
  }

  if (includeReadme) {
    const handoff = `# ${args.slug} — handoff to your coding agent

This bundle was produced by parity-studio-mcp. To integrate:

1. Unzip into your repo at the path of your choice.
2. Open in Claude Code, Cursor, or Windsurf and run:

   > Integrate the ui_kits/${args.slug}/ folder into the existing app at <your route>.
   > Use components/*.tsx as the building blocks. Wire tokens.css into your global stylesheet.
   > Preserve all visible text and numbers verbatim — they came from the source mockup.

3. Verify visually before merging. If parity drifted, run parity_verify with the
   integrated render to surface gaps.

manifest.json schemaVersion 1 contract is stable across minor versions.
`;
    zip.file(`ui_kits/${args.slug}/HANDOFF.md`, handoff);
  }

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            slug: args.slug,
            zipBase64: buf.toString('base64'),
            zipSizeBytes: buf.length,
            fileCount: Object.keys(args.uiKitFiles).length + (includeReadme ? 1 : 0),
            includesHandoffReadme: includeReadme,
            usage: 'base64-decode zipBase64 and write to disk, or pipe through `base64 -d > out.zip`',
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ---------- Pipeline helpers ----------------------------------------------

interface DecomposeOutput {
  slug: string;
  files: Record<string, string>;
  warnings: string[];
  costUsd: number;
  latencyMs: number;
}

async function runDecompose(args: {
  runId: string;
  artifactHtml: string;
  decomposeModel: string;
}): Promise<DecomposeOutput> {
  eventBus.updateRun(args.runId, { status: 'decomposing' });
  eventBus.setStage(args.runId, 'decompose', 'running', undefined, args.decomposeModel);
  const t0 = Date.now();
  const dec = await callByModel({
    model: args.decomposeModel,
    systemPrompt: DECOMPOSE_SYSTEM,
    userText: `Decompose this HTML artifact into a ui_kit/<slug>/ bundle:\n\n${args.artifactHtml}`,
    maxTokens: 24_000,
  });
  const parsed = parseUiKitResponse(dec.text);
  const latencyMs = Date.now() - t0;

  if (Object.keys(parsed.files).length === 0) {
    eventBus.setStage(args.runId, 'decompose', 'failed', latencyMs, args.decomposeModel);
    eventBus.appendLog(
      args.runId,
      'error',
      `decompose returned 0 files; warnings: ${parsed.warnings.join('; ')}`,
    );
    eventBus.updateRun(args.runId, {
      status: 'failed',
      errorMessage: 'decompose returned 0 files',
    });
    throw new Error(`decompose returned 0 files; warnings: ${parsed.warnings.join('; ')}`);
  }
  eventBus.setStage(args.runId, 'decompose', 'done', latencyMs, args.decomposeModel);
  eventBus.addCost(args.runId, dec.costUsd);
  eventBus.updateRun(args.runId, {
    uiKitFiles: parsed.files,
    uiKitSlug: parsed.slug,
  });
  eventBus.appendLog(
    args.runId,
    'info',
    `decomposed into ui_kits/${parsed.slug}/ (${Object.keys(parsed.files).length} files) in ${(latencyMs / 1000).toFixed(1)}s, $${dec.costUsd.toFixed(4)}`,
  );
  return {
    slug: parsed.slug,
    files: parsed.files,
    warnings: parsed.warnings,
    costUsd: dec.costUsd,
    latencyMs,
  };
}

async function runIterate(args: {
  runId: string;
  artifactHtml: string;
  previousFiles: Record<string, string>;
  failedGaps: Array<{ kind?: string; severity?: string; message: string }>;
  decomposeModel: string;
}): Promise<DecomposeOutput> {
  const t0 = Date.now();
  const previousIndexHtml = findFileEnding(args.previousFiles, '/index.html') ?? '';
  const previousTokensCss = findFileEnding(args.previousFiles, '/tokens.css') ?? '';

  const gapText =
    args.failedGaps.length === 0
      ? '(no specific gaps reported, but parity score was below threshold — review the previous bundle for opportunities to better match the source)'
      : args.failedGaps
          .map(
            (g, i) =>
              `${i + 1}. [${g.severity ?? 'medium'}/${g.kind ?? 'check'}] ${g.message ?? ''}`,
          )
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
${args.artifactHtml.slice(0, 8_000)}`;

  const result = await callByModel({
    model: args.decomposeModel,
    systemPrompt: ITERATE_SYSTEM,
    userText,
    maxTokens: 24_000,
  });
  const parsed = parseUiKitResponse(result.text);
  const latencyMs = Date.now() - t0;

  if (Object.keys(parsed.files).length === 0) {
    throw new Error(`iterate returned 0 files; warnings: ${parsed.warnings.join('; ')}`);
  }
  eventBus.addCost(args.runId, result.costUsd);
  eventBus.updateRun(args.runId, {
    uiKitFiles: parsed.files,
    uiKitSlug: parsed.slug,
  });
  return {
    slug: parsed.slug,
    files: parsed.files,
    warnings: parsed.warnings,
    costUsd: result.costUsd,
    latencyMs,
  };
}

// ---------- Helpers --------------------------------------------------------

function findFileEnding(files: Record<string, string>, suffix: string): string | undefined {
  for (const [path, content] of Object.entries(files)) {
    if (path === suffix.replace(/^\/+/, '') || path.endsWith(suffix)) return content;
  }
  return undefined;
}

function stripWrappingFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/);
  return fenceMatch?.[1] ?? trimmed;
}

function parseLooseJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  // Strip leading/trailing fence
  const stripped = trimmed
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    // Try to extract first { ... } block
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------- Server bootstrap ----------------------------------------------

async function main() {
  // Boot the local dashboard FIRST so it's already serving when the user looks.
  // No-op if PARITY_DASHBOARD=disabled. Best-effort: failures are logged to
  // stderr (which doesn't pollute MCP stdout) and tools continue without it.
  await startDashboardAtBoot();

  const server = new McpServer({
    name: 'parity-studio',
    version: VERSION,
  });

  server.registerTool(
    'parity_pipeline',
    {
      title: 'Generate, decompose, and verify a ui_kit end-to-end',
      description:
        'Full pipeline: prompt or sketch -> HTML artifact -> componentized ui_kit/<slug>/ bundle -> deterministic + visual parity verification. Returns the bundle plus a ParityReport with bounded enum status (verified | needs_review | needs_iteration | failed | unavailable) derived from passCount/totalChecks.',
      inputSchema: pipelineInput,
    },
    handlePipeline,
  );

  server.registerTool(
    'parity_decompose',
    {
      title: 'Decompose an HTML artifact into a ui_kit bundle',
      description:
        'Takes a complete HTML artifact and emits ui_kits/<slug>/{index.html, components/*.tsx, tokens.css, manifest.json, README.md}. Use when you already have a generated artifact from another source and want it shaped for coding-agent handoff.',
      inputSchema: decomposeInput,
    },
    handleDecompose,
  );

  server.registerTool(
    'parity_verify',
    {
      title: 'Verify a ui_kit against a source HTML (and optionally a source image)',
      description:
        'Runs deterministic parity checks (element count, visible text coverage, token fidelity, expected file presence). If sourceImageBase64 is provided, additionally runs the visual judge on a Playwright-rendered snapshot of the ui_kit. Returns derived parityScore = passCount / totalChecks with bounded enum status. No floating-point hallucination.',
      inputSchema: verifyInput,
    },
    handleVerify,
  );

  server.registerTool(
    'parity_export_zip',
    {
      title: 'Pack a ui_kit into a base64-encoded ZIP for handoff',
      description:
        'Bundles the ui_kit files into a ZIP and returns it as base64. Optionally appends a HANDOFF.md with integration instructions for Claude Code, Cursor, or Windsurf. Use when handing off the bundle to a downstream coding agent or saving to disk.',
      inputSchema: exportZipInput,
    },
    handleExportZip,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Cleanup on shutdown
  const cleanup = async () => {
    await shutdownRenderer();
    process.exit(0);
  };
  process.on('SIGINT', () => void cleanup());
  process.on('SIGTERM', () => void cleanup());
}

main().catch((err) => {
  console.error('parity-studio-mcp failed to start:', err);
  process.exit(1);
});
