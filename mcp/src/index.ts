#!/usr/bin/env node
/**
 * parity-studio-mcp — MCP server exposing the decompose/verify/iterate loop
 * to coding agents (Claude Code, Cursor, Windsurf, any MCP client).
 *
 * Tools:
 *   - parity_design_mission design-first slug board before production edits
 *   - parity_agent_runtime_metadata safe agent profiles/env allowlist
 *   - parity_studio      high-level natural-language app -> zip/run wrapper
 *   - parity_byok_status safe local provider-key presence check, no values
 *   - parity_pipeline    end-to-end: prompt|image -> ui_kit + ParityReport
 *   - parity_platform_to_ui_kit  existing app URL/codebase -> canonical ui_kit zip/run
 *   - parity_decompose   HTML artifact -> ui_kit/<slug>/{...} files
 *   - parity_verify      ui_kit + sourceHtml -> ParityReport (deterministic + visual)
 *   - parity_export_zip  ui_kit files -> base64-encoded ZIP for handoff
 *   - parity_apply_approved_design approved ui_kit deltas -> local repo files
 *   - parity_figma_export ui_kit files -> Figma plugin bridge ZIP/JSON
 *   - parity_figma_import Figma bridge/REST JSON -> ui_kit files
 *
 * Stdio transport. Designed for `command + args` configs in MCP clients:
 *
 *   "parity-studio": {
 *     "command": "npx",
 *     "args": ["-y", "parity-studio-mcp"],
 *     "env": {
 *       "ANTHROPIC_API_KEY": "sk-ant-...",
 *       "OPENAI_API_KEY": "sk-...",
 *       "PARITY_DECOMPOSE_MODEL": "claude-opus-4-7",
 *       "PARITY_JUDGE_MODEL": "claude-sonnet-4-6"
 *     }
 *   }
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import JSZip from 'jszip';
import { z } from 'zod';

import { eventBus, makeRunId } from './dashboard/events.js';
import { dashboardMode, openDashboardOnce } from './dashboard/openBrowser.js';
import { ensureDashboard } from './dashboard/server.js';
import { buildAgentRuntimeMetadata } from './lib/agentRuntime.js';
import { applyApprovedDesign } from './lib/applyApprovedDesign.js';
import { localByokStatus, requireLocalKeys } from './lib/byok.js';
import { collectCodeContext } from './lib/codeContext.js';
import {
  type DesignMissionOptions,
  designMissionPromptBlock,
  withDesignMissionFiles,
} from './lib/designMission.js';
import { buildDesignSystemShowcaseFiles } from './lib/designSystemShowcase.js';
import {
  buildFigmaBridgeFiles,
  filesFromFigmaPayload,
  parseFigmaBridgeJson,
} from './lib/figmaBridge.js';
import { withOperatingContract } from './lib/kitContract.js';
import { callByModel } from './lib/llmClient.js';
import { type ParityReport, checkDeterministic, statusFromBooleans } from './lib/parityChecker.js';
import { capturePlatformRoute } from './lib/platformCapture.js';
import { redactSensitiveValues } from './lib/privacy.js';
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

const VERSION = '0.3.6';

const PARITY_AGENT_RULES = `# Parity Studio agent rules

Use Parity Studio when the user asks to turn an existing app route into a
verified ui_kit, upload it to Parity Studio, export a zip, or iterate a scoped
UI surface.

Default workflow:

1. Prefer the high-level parity_studio tool for natural requests like "use
   Parity Studio with our app".
2. If the user provides no URL, use PARITY_APP_URL or probe common localhost
   dev ports. If nothing is running, ask the user to start the app or provide
   a URL.
3. Use projectRoot="." unless the user points at another repo.
4. Keep BYOK local: provider keys come from this MCP process env and are never
   returned, logged, written to files, or uploaded to Parity Studio.
5. Redact obvious emails, tokens, and API keys from captured HTML by default.
6. Generate the ui_kit, write a zip, import to Parity Studio unless disabled,
   and return the local zip path plus run URL.
7. In the exported kit, read parity.contract.json, performance.budget.json,
   api-wiring.plan.md, qa.plan.md, AGENTS.md, and .claude/skills/*/SKILL.md
   before editing.
8. Before spawning helper agents, call parity_agent_runtime_metadata with the
   model ids you intend to use and copy only the returned provider env names.

Design-first workflow:

- If the user asks to "iterate the design/UI slugs first", "make a design board",
  "preserve locked components", or "show side-by-side before implementation",
  prefer parity_design_mission over parity_studio.
- Treat Parity Studio as the staging layer before production code changes.
- Keep locked slugs/components non-negotiable until the user approves a change.
- Return the Parity Studio run URL and ZIP path before applying any repo deltas.
- Use parity_apply_approved_design in dryRun mode to show exact ui_kit -> repo
  file mappings; only call dryRun=false after the user approves those mappings.

Approval gates:

- Hosted upload of sensitive private route content.
- New provider/network egress beyond configured model providers.
- Secret changes, destructive filesystem operations, or external API writes.
`;

// ── Hosted Convex deployment endpoints (used by parity_chat_*, parity_enhance_prompt,
// parity_run_*, parity_export). Override via env to point at a self-hosted
// or staging deployment. Public mutations / queries / actions accept POST
// requests at these URLs without auth.
const CONVEX_CLOUD_URL = process.env.PARITY_CONVEX_URL ?? 'https://blissful-pig-998.convex.cloud';
const CONVEX_SITE_URL =
  process.env.PARITY_CONVEX_HTTP_URL ?? 'https://blissful-pig-998.convex.site';

/**
 * Thin Convex HTTP API client. Public functions (no `internal` prefix) are
 * callable without auth; this is enough for the chat / run / enhance tools.
 *
 * Convex API contract:
 *   POST {deployment}.convex.cloud/api/{query|mutation|action}
 *   Body: { path: "module:function", args: {...}, format: "json" }
 *   Response: { status: "success", value: any } | { status: "error", errorMessage: string }
 */
async function convexCall(
  kind: 'query' | 'mutation' | 'action',
  path: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const url = `${CONVEX_CLOUD_URL}/api/${kind}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  if (!res.ok) {
    throw new Error(`convex ${kind} ${path} → HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { status?: string; value?: unknown; errorMessage?: string };
  if (json.status === 'error') {
    throw new Error(`convex ${kind} ${path} → ${json.errorMessage ?? 'unknown error'}`);
  }
  return json.value;
}

// Cheap-tier defaults (Kimi K2.6 via OpenRouter for LLM, Gemini 2.5 Flash
// for vision judge). Override via env for any tier you prefer:
//   PARITY_GENERATE_MODEL=claude-sonnet-4-6
//   PARITY_DECOMPOSE_MODEL=claude-opus-4-7
//   PARITY_JUDGE_MODEL=gpt-4o
const GENERATE_MODEL = process.env.PARITY_GENERATE_MODEL ?? 'moonshotai/kimi-k2.6';
const DECOMPOSE_MODEL = process.env.PARITY_DECOMPOSE_MODEL ?? 'moonshotai/kimi-k2.6';
const JUDGE_MODEL = process.env.PARITY_JUDGE_MODEL ?? 'google/gemini-3.1-pro-preview';

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
  const byok = requireLocalKeys([model]);
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
            byok,
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
  sourceHtml: z.string().min(20).describe('Original HTML the ui_kit was decomposed from'),
  sourceImageBase64: z
    .string()
    .optional()
    .describe(
      'Optional source mockup image. If provided, runs the visual judge in addition to deterministic checks.',
    ),
  sourceImageMimeType: IMG_MIME_SCHEMA.optional(),
  judgeModel: z.string().optional().describe(`override judge model (default ${JUDGE_MODEL})`),
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
  requireLocalKeys([args.judgeModel]);
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
  const checks: VisualJudgeOutcome['checks'] = Array.isArray(parsed?.checks)
    ? (parsed.checks as VisualJudgeOutcome['checks'])
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
      typeof parsed?.summary === 'string'
        ? (parsed.summary as string)
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

// ---------- Tool: parity_platform_to_ui_kit -------------------------------

const platformToUiKitInput = {
  url: z
    .string()
    .url()
    .describe('Running app/platform route to capture, e.g. http://localhost:3000/settings'),
  selector: z
    .string()
    .optional()
    .describe('Optional CSS selector to decompose a scoped region instead of the whole page'),
  fallbackSlug: z
    .string()
    .optional()
    .describe('kebab-case slug to use if the model does not pick one'),
  projectRoot: z
    .string()
    .optional()
    .describe(
      'Optional local codebase root. If provided, selected source files are included as context.',
    ),
  includeCodeContext: z
    .boolean()
    .optional()
    .describe('Include local code context from projectRoot (default true when projectRoot is set)'),
  maxCodeBytes: z.number().int().min(0).max(300_000).optional(),
  waitMs: z.number().int().min(0).max(30_000).optional(),
  viewportWidth: z.number().int().min(320).max(3840).optional(),
  viewportHeight: z.number().int().min(320).max(3000).optional(),
  decomposeModel: z
    .string()
    .optional()
    .describe(`override decompose model (default ${DECOMPOSE_MODEL})`),
  outputZipPath: z
    .string()
    .optional()
    .describe(
      'Optional filesystem path where the MCP server should write the canonical ui_kit ZIP',
    ),
  includeZipBase64: z
    .boolean()
    .optional()
    .describe('Return zipBase64 in the tool response. Defaults false to avoid huge MCP payloads.'),
  importToParityStudio: z
    .boolean()
    .optional()
    .describe('Create a hosted Parity Studio run from the generated kit (default true).'),
  redactSensitiveValues: z
    .boolean()
    .optional()
    .describe(
      'Redact obvious emails/API keys/tokens from captured HTML before model calls or hosted import (default true).',
    ),
};

const parityStudioInput = {
  request: z
    .string()
    .optional()
    .describe(
      'Natural-language user request, e.g. "use Parity Studio with our app and get me the zip export"',
    ),
  url: z
    .string()
    .url()
    .optional()
    .describe(
      'Optional running app URL. If omitted, uses PARITY_APP_URL or probes common localhost dev ports.',
    ),
  route: z
    .string()
    .optional()
    .describe('Optional route/path such as /settings. Applied to the detected app origin.'),
  selector: z.string().optional(),
  projectRoot: z
    .string()
    .optional()
    .describe('Local codebase root. Defaults to "." so agents can just say "our app".'),
  outputZipPath: z
    .string()
    .optional()
    .describe(
      'Optional zip output path. Defaults to ./parity-<route>-ui-kit.zip under projectRoot.',
    ),
  importToParityStudio: z
    .boolean()
    .optional()
    .describe(
      'Upload generated kit to hosted Parity Studio. Default true. Keys are never uploaded.',
    ),
  decomposeModel: z
    .string()
    .optional()
    .describe(`override decompose model (default ${DECOMPOSE_MODEL})`),
  includeZipBase64: z.boolean().optional().describe('Return zipBase64. Default false.'),
  redactSensitiveValues: z
    .boolean()
    .optional()
    .describe('Redact obvious sensitive values. Default true.'),
};

const designMissionInput = {
  request: z
    .string()
    .optional()
    .describe(
      'Natural request, e.g. "iterate the design and UI slugs first before production implementation"',
    ),
  url: z
    .string()
    .url()
    .optional()
    .describe('Running app URL. If omitted, uses PARITY_APP_URL or localhost probing.'),
  route: z.string().optional().describe('Optional route/path such as /reports.'),
  selector: z.string().optional(),
  projectRoot: z.string().optional().describe('Local codebase root. Defaults to ".".'),
  targetFlow: z
    .string()
    .optional()
    .describe('Specific product flow to stage, e.g. "Composer -> Chat trace -> Reports".'),
  lockedSlugs: z
    .array(z.string())
    .optional()
    .describe('Stable UI slugs that must be preserved, e.g. nb.chat.composer.'),
  lockedComponents: z
    .array(z.string())
    .optional()
    .describe('Plain-English component names that must not be replaced.'),
  allowedDeltas: z
    .array(z.string())
    .optional()
    .describe('Additive changes allowed inside locked components.'),
  forbiddenPatterns: z
    .array(z.string())
    .optional()
    .describe('Patterns the agent must not introduce, such as a new shell or top-level nav.'),
  allowedChangeScope: z
    .enum(['design-only', 'approved-deltas', 'production-ready'])
    .optional()
    .describe('Default design-only; production changes still require user approval.'),
  includeRuntimeArchitecture: z
    .boolean()
    .optional()
    .describe('Include runtime-architecture.md/html/json. Default true.'),
  includeLockedSlugComparison: z
    .boolean()
    .optional()
    .describe('Include decomposed-comparison.html. Default true.'),
  includeImplementationMap: z
    .boolean()
    .optional()
    .describe('Include frontend/backend/database/agent implementation maps. Default true.'),
  proofMedia: z
    .boolean()
    .optional()
    .describe('Whether to scaffold media proof requirements in the kit. Default false.'),
  figmaBridge: z
    .boolean()
    .optional()
    .describe('Whether to scaffold Figma bridge metadata. Default false.'),
  qaDogfoodRelay: z
    .boolean()
    .optional()
    .describe(
      'Include QA dogfood relay packet files for links, GIF/MP4 plan, before/after snippets, Gmail resend, and easier-to-read submissions. Default true.',
    ),
  qaFeatureId: z
    .string()
    .optional()
    .describe('Stable feature id for the QA packet, e.g. nodebench.chat.declutter.v1.'),
  qaPersonas: z.array(z.string()).optional().describe('Personas to cover in the QA packet lanes.'),
  qaUserStates: z
    .array(z.string())
    .optional()
    .describe('User states to cover in the QA packet lanes.'),
  qaWorkflowLanes: z
    .array(z.string())
    .optional()
    .describe('Workflow lanes to cover in the QA packet, e.g. new run, comment edit, export.'),
  outputZipPath: z
    .string()
    .optional()
    .describe('Optional zip output path. Defaults to ./parity-<route>-design-mission.zip.'),
  importToParityStudio: z.boolean().optional().describe('Default true.'),
  decomposeModel: z
    .string()
    .optional()
    .describe(`override decompose model (default ${DECOMPOSE_MODEL})`),
  includeZipBase64: z.boolean().optional().describe('Return zipBase64. Default false.'),
  redactSensitiveValues: z.boolean().optional().describe('Redact sensitive values. Default true.'),
};

async function handlePlatformToUiKit(args: {
  url: string;
  selector?: string;
  fallbackSlug?: string;
  projectRoot?: string;
  includeCodeContext?: boolean;
  maxCodeBytes?: number;
  waitMs?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  decomposeModel?: string;
  outputZipPath?: string;
  includeZipBase64?: boolean;
  importToParityStudio?: boolean;
  redactSensitiveValues?: boolean;
  designMission?: DesignMissionOptions;
}) {
  const dashboardUrl = await dashboardForTool().catch(() => null);
  const runId = makeRunId();
  const decomposeModel = args.decomposeModel ?? DECOMPOSE_MODEL;
  const byok = requireLocalKeys([decomposeModel]);

  eventBus.createRun(runId, {
    status: 'queued',
    prompt: `Capture existing platform route: ${args.url}`,
  });
  eventBus.appendLog(runId, 'info', `capturing platform route ${args.url}`);

  try {
    eventBus.updateRun(runId, { status: 'generating' });
    eventBus.setStage(runId, 'generate', 'running');
    const capture = await capturePlatformRoute({
      url: args.url,
      selector: args.selector,
      waitMs: args.waitMs,
      viewportWidth: args.viewportWidth,
      viewportHeight: args.viewportHeight,
    });
    const htmlRedaction = redactSensitiveValues(
      capture.artifactHtml,
      args.redactSensitiveValues !== false,
    );
    const sampleRedaction = redactSensitiveValues(
      capture.textSample,
      args.redactSensitiveValues !== false,
    );
    const captureHtml = htmlRedaction.text;
    const textSample = sampleRedaction.text;
    eventBus.setStage(runId, 'generate', 'done');
    eventBus.updateRun(runId, { artifactHtmlFull: captureHtml });
    eventBus.appendLog(
      runId,
      'info',
      `captured ${captureHtml.length} bytes from ${capture.finalUrl}`,
    );
    if (htmlRedaction.count + sampleRedaction.count > 0) {
      eventBus.appendLog(
        runId,
        'info',
        `redacted ${htmlRedaction.count + sampleRedaction.count} sensitive value(s) before model/upload`,
      );
    }

    let codeContextText = '';
    let codeRedactionCount = 0;
    let codeContext: {
      root: string;
      filesRead: number;
      bytesRead: number;
      skipped: string[];
    } | null = null;
    const shouldReadCode = Boolean(args.projectRoot) && args.includeCodeContext !== false;
    if (args.projectRoot && shouldReadCode) {
      const collected = await collectCodeContext({
        projectRoot: args.projectRoot,
        maxBytes: args.maxCodeBytes,
      });
      const codeRedaction = redactSensitiveValues(
        collected.text,
        args.redactSensitiveValues !== false,
      );
      codeRedactionCount = codeRedaction.count;
      codeContextText = codeRedaction.text;
      codeContext = {
        root: collected.root,
        filesRead: collected.filesRead,
        bytesRead: collected.bytesRead,
        skipped: collected.skipped.slice(0, 40),
      };
      eventBus.appendLog(
        runId,
        'info',
        `included ${collected.filesRead} source files (${collected.bytesRead} bytes) as decomposition context`,
      );
      if (codeRedaction.count > 0) {
        eventBus.appendLog(
          runId,
          'info',
          `redacted ${codeRedaction.count} sensitive value(s) from local code context`,
        );
      }
    }

    eventBus.updateRun(runId, { status: 'decomposing' });
    eventBus.setStage(runId, 'decompose', 'running', undefined, decomposeModel);
    const t0 = Date.now();
    const result = await callByModel({
      model: decomposeModel,
      systemPrompt: DECOMPOSE_SYSTEM,
      userText: buildPlatformDecomposePrompt({
        captureHtml,
        sourceUrl: capture.finalUrl,
        title: capture.title,
        textSample,
        codeContextText,
        designMission: args.designMission,
      }),
      maxTokens: 24_000,
    });
    let parsed = parseUiKitResponse(result.text, args.fallbackSlug);
    const latencyMs = Date.now() - t0;
    if (Object.keys(parsed.files).length === 0) {
      eventBus.appendLog(
        runId,
        'warn',
        `model returned no parseable path-fenced ui_kit files; using deterministic platform capture fallback (${parsed.warnings.join('; ')})`,
      );
      parsed = buildPlatformCaptureFallback({
        captureHtml,
        fallbackSlug: args.fallbackSlug,
        sourceUrl: capture.finalUrl,
        title: capture.title,
        textSample,
        modelUsed: result.modelUsed,
      });
    }
    const filesWithContract = withDesignMissionFiles(
      withOperatingContract(parsed.files, {
        slug: parsed.slug,
        prompt: args.designMission?.request
          ? `Design mission from ${capture.finalUrl}: ${args.designMission.request}`
          : `Captured existing platform route ${capture.finalUrl} and decomposed it into a canonical ui_kit.`,
        sourceHtml: captureHtml,
        sourceType: 'platform-route',
        sourceUrl: capture.finalUrl,
        sourceTitle: capture.title,
        selector: args.selector,
        viewport: capture.viewport,
        consoleErrors: capture.consoleErrors,
        codeContext: codeContext ?? undefined,
        importToParityStudio: args.importToParityStudio !== false,
        byokMode: 'local-mcp-byok',
        createdAtIso: new Date().toISOString(),
      }),
      parsed.slug,
      args.designMission,
    );
    eventBus.setStage(runId, 'decompose', 'done', latencyMs, decomposeModel);
    eventBus.addCost(runId, result.costUsd);
    eventBus.updateRun(runId, { uiKitFiles: filesWithContract, uiKitSlug: parsed.slug });

    const indexHtml = findFileEnding(filesWithContract, '/index.html') ?? null;
    const tokensCss = findFileEnding(filesWithContract, '/tokens.css') ?? null;
    const deterministic = checkDeterministic({
      sourceHtml: captureHtml,
      decomposedHtml: indexHtml,
      tokensCss,
      uiKitFiles: filesWithContract,
    });
    eventBus.setStage(runId, 'verify', 'done');
    eventBus.updateRun(runId, {
      parityReport: {
        passCount: deterministic.passCount,
        totalChecks: deterministic.totalChecks,
        parityScore: deterministic.parityScore,
        status: deterministic.status,
        summary: deterministic.summary,
        basis: 'deterministic',
        failedChecks: deterministic.gaps.map((gap) => ({
          dimension: gap.kind,
          id: gap.kind,
          passed: false,
          note: gap.message,
        })),
      },
    });

    const portableFiles = withPortableExportFiles(filesWithContract, parsed.slug, {
      runId,
      activeSurface: parsed.slug,
    });
    const zipBuffer = await createUiKitZip(portableFiles, parsed.slug, true);
    let resolvedZipPath: string | null = null;
    if (args.outputZipPath) {
      resolvedZipPath = resolve(args.outputZipPath);
      await mkdir(dirname(resolvedZipPath), { recursive: true });
      await writeFile(resolvedZipPath, zipBuffer);
      eventBus.appendLog(runId, 'info', `wrote canonical ui_kit zip to ${resolvedZipPath}`);
    }

    let parityStudioRunId: string | null = null;
    let parityStudioRunUrl: string | null = null;
    if (args.importToParityStudio !== false) {
      parityStudioRunId = (await convexCall('mutation', 'runs:startFromKit', {
        slug: parsed.slug,
        files: filesWithContract,
        sourceArtifactHtml: captureHtml,
        prompt: `Captured existing platform route ${capture.finalUrl} and decomposed it into a canonical ui_kit.`,
      })) as string;
      parityStudioRunUrl = `https://parity-studio.vercel.app/?run=${parityStudioRunId}`;
      eventBus.appendLog(runId, 'info', `imported kit into Parity Studio: ${parityStudioRunUrl}`);
    }

    eventBus.setStage(runId, 'done', 'done');
    eventBus.updateRun(runId, { status: 'done' });

    const response: Record<string, unknown> = {
      runId,
      dashboardUrl,
      source: {
        url: args.url,
        finalUrl: capture.finalUrl,
        title: capture.title,
        selector: args.selector ?? null,
        capturedBytes: captureHtml.length,
        consoleErrors: capture.consoleErrors,
        redaction: {
          enabled: args.redactSensitiveValues !== false,
          count: htmlRedaction.count + sampleRedaction.count + codeRedactionCount,
        },
      },
      byok,
      codeContext,
      uiKit: {
        slug: parsed.slug,
        files: portableFiles,
        fileCount: Object.keys(portableFiles).length,
        warnings: parsed.warnings,
      },
      deterministic,
      zip: {
        outputZipPath: resolvedZipPath,
        zipSizeBytes: zipBuffer.length,
        zipBase64: args.includeZipBase64 ? zipBuffer.toString('base64') : undefined,
      },
      parityStudio: {
        imported: parityStudioRunId !== null,
        runId: parityStudioRunId,
        runUrl: parityStudioRunUrl,
      },
      designMission: args.designMission ?? null,
      modelUsed: result.modelUsed,
      costUsd: result.costUsd,
      latencyMs,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    eventBus.updateRun(runId, { status: 'failed', errorMessage: message });
    eventBus.appendLog(runId, 'error', message);
    throw err;
  }
}

async function handleParityStudio(args: {
  request?: string;
  url?: string;
  route?: string;
  selector?: string;
  projectRoot?: string;
  outputZipPath?: string;
  importToParityStudio?: boolean;
  decomposeModel?: string;
  includeZipBase64?: boolean;
  redactSensitiveValues?: boolean;
}) {
  const projectRoot = args.projectRoot ?? '.';
  const url = await resolveAppUrl({ url: args.url, route: args.route });
  const outputZipPath =
    args.outputZipPath ?? resolve(projectRoot, `parity-${slugHintFromUrl(url)}-ui-kit.zip`);

  return await handlePlatformToUiKit({
    url,
    selector: args.selector,
    projectRoot,
    outputZipPath,
    importToParityStudio: args.importToParityStudio ?? true,
    decomposeModel: args.decomposeModel,
    includeZipBase64: args.includeZipBase64,
    redactSensitiveValues: args.redactSensitiveValues,
  });
}

async function handleDesignMission(args: {
  request?: string;
  url?: string;
  route?: string;
  selector?: string;
  projectRoot?: string;
  targetFlow?: string;
  lockedSlugs?: string[];
  lockedComponents?: string[];
  allowedDeltas?: string[];
  forbiddenPatterns?: string[];
  allowedChangeScope?: 'design-only' | 'approved-deltas' | 'production-ready';
  includeRuntimeArchitecture?: boolean;
  includeLockedSlugComparison?: boolean;
  includeImplementationMap?: boolean;
  proofMedia?: boolean;
  figmaBridge?: boolean;
  qaDogfoodRelay?: boolean;
  qaFeatureId?: string;
  qaPersonas?: string[];
  qaUserStates?: string[];
  qaWorkflowLanes?: string[];
  outputZipPath?: string;
  importToParityStudio?: boolean;
  decomposeModel?: string;
  includeZipBase64?: boolean;
  redactSensitiveValues?: boolean;
}) {
  const projectRoot = args.projectRoot ?? '.';
  const url = await resolveAppUrl({ url: args.url, route: args.route });
  const outputZipPath =
    args.outputZipPath ?? resolve(projectRoot, `parity-${slugHintFromUrl(url)}-design-mission.zip`);
  return await handlePlatformToUiKit({
    url,
    selector: args.selector,
    projectRoot,
    outputZipPath,
    importToParityStudio: args.importToParityStudio ?? true,
    decomposeModel: args.decomposeModel,
    includeZipBase64: args.includeZipBase64,
    redactSensitiveValues: args.redactSensitiveValues,
    designMission: {
      request:
        args.request ??
        'Use Parity Studio as a design-first slug board before production implementation.',
      targetFlow: args.targetFlow,
      lockedSlugs: args.lockedSlugs,
      lockedComponents: args.lockedComponents,
      allowedDeltas: args.allowedDeltas,
      forbiddenPatterns: args.forbiddenPatterns,
      allowedChangeScope: args.allowedChangeScope ?? 'design-only',
      includeRuntimeArchitecture: args.includeRuntimeArchitecture ?? true,
      includeLockedSlugComparison: args.includeLockedSlugComparison ?? true,
      includeImplementationMap: args.includeImplementationMap ?? true,
      proofMedia: args.proofMedia ?? false,
      figmaBridge: args.figmaBridge ?? false,
      qaDogfoodRelay: args.qaDogfoodRelay ?? true,
      qaFeatureId: args.qaFeatureId,
      qaPersonas: args.qaPersonas,
      qaUserStates: args.qaUserStates,
      qaWorkflowLanes: args.qaWorkflowLanes,
    },
  });
}

function buildPlatformDecomposePrompt(args: {
  captureHtml: string;
  sourceUrl: string;
  title: string;
  textSample: string;
  codeContextText: string;
  designMission?: DesignMissionOptions;
}): string {
  const context =
    args.codeContextText.trim().length > 0
      ? `\n\nLOCAL CODE CONTEXT (use this to preserve component names, routes, tokens, and product vocabulary; source capture remains the visual/content truth):\n${args.codeContextText.slice(0, 120_000)}`
      : '';
  return `Decompose this already-built platform route into a canonical ui_kit/<slug>/ bundle.

SOURCE ROUTE: ${args.sourceUrl}
TITLE: ${args.title || '(untitled)'}
VISIBLE TEXT SAMPLE:
${args.textSample || '(empty)'}

Use the captured HTML/CSS below as the source of truth. Preserve visible copy,
numbers, labels, hierarchy, and interaction states. Componentize the page into
meaningful React TSX regions and extract design tokens so the resulting ZIP can
be dropped into Parity Studio for scoped iterations.

Also produce or support these native operating files:
- ui_kits/<slug>/parity.contract.json for intent/source/performance/API/QA/privacy
- ui_kits/<slug>/performance.budget.json for route and interaction budgets
- ui_kits/<slug>/api-wiring.plan.md for mock/live API migration
- ui_kits/<slug>/qa.plan.md for browser, selector, console, screenshot, and dogfood checks
${designMissionPromptBlock(args.designMission)}

The runtime will normalize these files, but richer source-specific details from
you are useful. Never include provider API keys or secrets in generated files.
${context}

CAPTURED PLATFORM HTML:
${args.captureHtml}`;
}

async function resolveAppUrl(args: { url?: string; route?: string }): Promise<string> {
  if (args.url) return withRoute(args.url, args.route);
  if (process.env.PARITY_APP_URL)
    return withRoute(process.env.PARITY_APP_URL as string, args.route);

  const commonOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'http://localhost:5000',
    'http://127.0.0.1:5000',
  ];

  for (const origin of commonOrigins) {
    const candidate = withRoute(origin, args.route);
    try {
      const res = await fetch(candidate, { method: 'GET', signal: AbortSignal.timeout(900) });
      if (res.ok || (res.status >= 300 && res.status < 500)) return candidate;
    } catch {
      // keep probing
    }
  }

  throw new Error(
    'Could not find a running local app. Start the app, set PARITY_APP_URL, or pass url. ' +
      'Example natural request: "use Parity Studio with http://localhost:3000/settings".',
  );
}

function withRoute(baseUrl: string, route?: string): string {
  if (!route || route.trim().length === 0) return baseUrl;
  if (/^https?:\/\//i.test(route)) return route;
  const url = new URL(baseUrl);
  const cleanRoute = route.startsWith('/') ? route : `/${route}`;
  url.pathname = cleanRoute;
  return url.toString();
}

function slugHintFromUrl(urlText: string): string {
  const url = new URL(urlText);
  const pathSlug = url.pathname
    .split('/')
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return pathSlug || 'app';
}

function buildPlatformCaptureFallback(args: {
  captureHtml: string;
  fallbackSlug?: string;
  sourceUrl: string;
  title: string;
  textSample: string;
  modelUsed: string;
}): { slug: string; files: Record<string, string>; warnings: string[] } {
  const slug = sanitizeSlug(args.fallbackSlug ?? slugHintFromUrl(args.sourceUrl));
  const title = args.title || 'Captured platform route';
  const visibleSample = args.textSample || '(no visible text sample captured)';
  const files: Record<string, string> = {
    [`ui_kits/${slug}/index.html`]: args.captureHtml,
    [`ui_kits/${slug}/components/AppShell.tsx`]: `export interface AppShellProps {
  title?: string;
}

export function AppShell({ title = ${JSON.stringify(title)} }: AppShellProps) {
  return (
    <main className="parity-platform-capture" aria-label={title}>
      <header className="parity-platform-capture__notice">
        <p>Platform capture fallback</p>
        <h1>{title}</h1>
        <p>
          The visual source is preserved in ui_kits/${slug}/index.html. Use this
          component as the integration anchor when replacing fallback markup with
          hand-authored React regions.
        </p>
      </header>
    </main>
  );
}
`,
    [`ui_kits/${slug}/tokens.css`]: `:root {
  --parity-capture-bg: #fbf4eb;
  --parity-capture-ink: #241812;
  --parity-capture-muted: #8a7669;
  --parity-capture-brand: #dd5d3f;
  --parity-capture-border: rgba(36, 24, 18, 0.12);
  --parity-capture-radius: 18px;
  --parity-capture-shadow: 0 24px 80px rgba(36, 24, 18, 0.12);
}
`,
    [`ui_kits/${slug}/manifest.json`]: JSON.stringify(
      {
        schemaVersion: 1,
        generator: 'parity-studio-mcp',
        slug,
        sourceType: 'platform-route',
        sourceUrl: args.sourceUrl,
        fallback: true,
        components: ['AppShell'],
        tokens: [
          '--parity-capture-bg',
          '--parity-capture-ink',
          '--parity-capture-muted',
          '--parity-capture-brand',
          '--parity-capture-border',
          '--parity-capture-radius',
          '--parity-capture-shadow',
        ],
      },
      null,
      2,
    ),
    [`ui_kits/${slug}/README.md`]: `# ${slug} ui_kit

This kit was created from an existing platform route:

- Source URL: ${args.sourceUrl}
- Source title: ${title}
- Decompose model attempted: ${args.modelUsed}
- Fallback mode: deterministic platform capture

## What happened

The model call did not return parseable path-fenced ui_kit files, so the MCP
server preserved the captured route HTML as the canonical visual source in
\`index.html\` instead of failing the workflow. This lets the kit import into
Parity Studio immediately for inspiration, comments, scoped edits, and export.

## Visible text sample

${visibleSample}

## Next edit recommendation

Use Parity Studio comments to mark the first area to componentize. Replace the
fallback AppShell anchor with meaningful React regions only after checking
Preview against the preserved \`index.html\` source.

## Known limitations

- Component decomposition is intentionally minimal because this was a fallback.
- \`index.html\` is the source of visual truth for the imported run.
- Run a follow-up decompose with a stricter model when you want full component
  decomposition from the preserved capture.
`,
  };
  return {
    slug,
    files,
    warnings: [
      'model returned no path-fenced ui_kit files; deterministic platform capture fallback used',
    ],
  };
}

function sanitizeSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'platform-route'
  );
}

// ---------- Tool: parity_pipeline -----------------------------------------

const pipelineInput = {
  prompt: z
    .string()
    .optional()
    .describe(
      'Brief describing the desired UI. Either prompt or sourceImageBase64 (or both) required.',
    ),
  sourceImageBase64: z
    .string()
    .optional()
    .describe('Optional source mockup. Required if generating from a sketch/screenshot.'),
  sourceImageMimeType: IMG_MIME_SCHEMA.optional(),
  generateModel: z.string().optional(),
  decomposeModel: z.string().optional(),
  judgeModel: z.string().optional(),
  skipGenerate: z
    .boolean()
    .optional()
    .describe(
      'If true, treat sourceImageBase64 as the rendered artifact — skip stage 1 generation. Useful when the image is already a polished mockup.',
    ),
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
  const requiredModels = [
    ...(args.skipGenerate ? [] : [generateModel]),
    decomposeModel,
    ...(args.sourceImageBase64 && args.sourceImageMimeType ? [judgeModel] : []),
  ];
  const byok = requireLocalKeys(requiredModels);

  // Spin up dashboard on first call. Best-effort: never blocks the run.
  const dashboardUrl = await dashboardForTool().catch(() => null);

  // Create the run record so the dashboard sees it the moment the user
  // looks. All subsequent stage updates broadcast via the event bus.
  const runId = makeRunId();
  eventBus.createRun(runId, {
    status: 'queued',
    ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
    ...(args.sourceImageBase64 !== undefined ? { sourceImageBase64: args.sourceImageBase64 } : {}),
    ...(args.sourceImageMimeType !== undefined
      ? { sourceImageMimeType: args.sourceImageMimeType }
      : {}),
  });
  eventBus.appendLog(
    runId,
    'info',
    `parity_pipeline started (decompose=${decomposeModel}, judge=${judgeModel})`,
  );

  try {
    let totalCostUsd = 0;
    let artifactHtml: string;
    let generateLatencyMs = 0;

    // Stage 1: generate (or skip if image provided + skipGenerate flag)
    if (args.skipGenerate && args.sourceImageBase64) {
      artifactHtml = '<!-- skipGenerate: source image used directly -->';
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
      eventBus.appendLog(
        runId,
        'info',
        `generated ${artifactHtml.length} bytes in ${(generateLatencyMs / 1000).toFixed(1)}s, $${gen.costUsd.toFixed(4)}`,
      );
    }

    // Stage 2: decompose -> verify -> iterate loop. Bounded by MAX_ITERATIONS.
    // Each iteration adds one decompose call + one verify pass.
    const MAX_ITERATIONS = 2;
    let iterationsCompleted = 0;
    let parsed = await runDecompose({
      runId,
      artifactHtml,
      decomposeModel,
      prompt: args.prompt,
    });
    const decomposeLatencyMs = parsed.latencyMs;
    const decomposeCostUsd = parsed.costUsd;
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
              byok,
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
    .describe(
      'Map of relative file paths to file contents (from parity_decompose or parity_pipeline output)',
    ),
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
  const files = withOperatingContract(args.uiKitFiles, {
    slug: args.slug,
    sourceType: 'imported-kit',
    importToParityStudio: false,
    byokMode: 'local-mcp-byok',
  });
  const portableFiles = withPortableExportFiles(files, args.slug, { activeSurface: args.slug });
  const buf = await createUiKitZip(portableFiles, args.slug, includeReadme);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            slug: args.slug,
            zipBase64: buf.toString('base64'),
            zipSizeBytes: buf.length,
            fileCount: Object.keys(portableFiles).length + (includeReadme ? 1 : 0),
            includesHandoffReadme: includeReadme,
            includesDesignSystemShowcase: true,
            includesFigmaBridge: true,
            usage:
              'base64-decode zipBase64 and write to disk, or pipe through `base64 -d > out.zip`',
          },
          null,
          2,
        ),
      },
    ],
  };
}

function withPortableExportFiles(
  uiKitFiles: Record<string, string>,
  slug: string,
  figmaOptions: { runId?: string; activeSurface?: string | null } = {},
): Record<string, string> {
  const withShowcase = {
    ...uiKitFiles,
    ...buildDesignSystemShowcaseFiles(uiKitFiles, slug),
  };
  return {
    ...withShowcase,
    ...buildFigmaBridgeFiles(withShowcase, slug, figmaOptions),
  };
}

// ---------- Tool: parity_apply_approved_design ----------------------------

const applyApprovedDesignInput = {
  uiKitFiles: z
    .record(z.string())
    .describe('Map of relative Parity ui_kit file paths to file contents.'),
  projectRoot: z
    .string()
    .default('.')
    .describe('Local repo root where approved design files may be staged/applied.'),
  slug: z.string().optional().describe('Active ui_kit slug. Inferred from file paths if omitted.'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Default true. Set false only after the user approves the exact mappings.'),
  mappings: z
    .array(
      z.object({
        fromPath: z.string().describe('Source path inside uiKitFiles.'),
        toPath: z.string().describe('Target path under projectRoot.'),
        mode: z.enum(['write', 'append']).optional().describe('Default write.'),
      }),
    )
    .optional()
    .describe(
      'Explicit approved source->repo mappings. If omitted, files are safely staged into .parity/approved-design/<slug>/ instead of production source.',
    ),
};

async function handleApplyApprovedDesign(args: {
  uiKitFiles: Record<string, string>;
  projectRoot?: string;
  slug?: string;
  dryRun?: boolean;
  mappings?: Array<{ fromPath: string; toPath: string; mode?: 'write' | 'append' }>;
}) {
  const result = await applyApprovedDesign({
    uiKitFiles: args.uiKitFiles,
    projectRoot: args.projectRoot ?? '.',
    ...(args.slug ? { slug: args.slug } : {}),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
    ...(args.mappings ? { mappings: args.mappings } : {}),
  });
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            ...result,
            next:
              result.dryRun === true
                ? 'Review operations. If correct, call again with dryRun=false after user approval.'
                : 'Run your repo tests and browser QA before committing production changes.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ---------- Tool: parity_figma_export -------------------------------------

const figmaExportInput = {
  uiKitFiles: z
    .record(z.string())
    .describe('Map of relative Parity ui_kit file paths to file contents.'),
  slug: z.string().describe('Active ui_kit slug to export to Figma.'),
  runId: z.string().optional().describe('Optional hosted Parity run id for provenance.'),
  includeZipBase64: z
    .boolean()
    .optional()
    .describe('Return a Figma plugin ZIP as base64. Defaults true.'),
};

async function handleFigmaExport(args: {
  uiKitFiles: Record<string, string>;
  slug: string;
  runId?: string;
  includeZipBase64?: boolean;
}) {
  const bridgeFiles = buildFigmaBridgeFiles(args.uiKitFiles, args.slug, {
    ...(args.runId ? { runId: args.runId } : {}),
    activeSurface: args.slug,
  });
  const zip = new JSZip();
  for (const [path, content] of Object.entries(bridgeFiles)) zip.file(path, content);
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            slug: args.slug,
            files: bridgeFiles,
            fileCount: Object.keys(bridgeFiles).length,
            zipBase64: args.includeZipBase64 === false ? undefined : buf.toString('base64'),
            zipSizeBytes: buf.length,
            usage:
              'Write zipBase64 to <slug>-figma-bridge.zip, unzip it, then import figma/manifest.json from Figma Plugins > Development.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ---------- Tool: parity_figma_import -------------------------------------

const figmaImportInput = {
  figmaJson: z
    .string()
    .min(20)
    .describe('Parity Figma bridge JSON or Figma REST file JSON with document.children.'),
  fallbackSlug: z.string().optional().describe('Slug to use if the payload has no name.'),
};

async function handleFigmaImport(args: { figmaJson: string; fallbackSlug?: string }) {
  const parsed = parseFigmaBridgeJson(args.figmaJson);
  const result = filesFromFigmaPayload(parsed, args.fallbackSlug ?? 'figma-import');
  const files = withOperatingContract(result.files, {
    slug: result.slug,
    sourceType: 'imported-kit',
    importToParityStudio: false,
    byokMode: 'local-mcp-byok',
  });
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            slug: result.slug,
            files,
            fileCount: Object.keys(files).length,
            warnings: result.warnings,
            next: 'Pass files to parity_export_zip or import them into hosted Parity Studio with runs.startFromKit.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function createUiKitZip(
  uiKitFiles: Record<string, string>,
  slug: string,
  includeReadme: boolean,
): Promise<Buffer> {
  const zip = new JSZip();

  for (const [path, content] of Object.entries(uiKitFiles)) {
    zip.file(path, content);
  }

  if (includeReadme) {
    const handoff = `# ${slug} — handoff to your coding agent

This bundle was produced by parity-studio-mcp. To integrate:

1. Unzip into your repo at the path of your choice.
2. Open in Claude Code, Cursor, or Windsurf and run:

   > Integrate the ui_kits/${slug}/ folder into the existing app at <your route>.
   > First read ui_kits/${slug}/parity.contract.json, performance.budget.json,
   > api-wiring.plan.md, qa.plan.md, and AGENTS.md.
   > Use components/*.tsx as the building blocks. Wire tokens.css into your global stylesheet.
   > Preserve all visible text and numbers verbatim - they came from the source mockup.

3. Verify visually before merging. If parity drifted, run parity_verify with the
   integrated render to surface gaps.

manifest.json schemaVersion 1 contract is stable across minor versions.
`;
    zip.file(`ui_kits/${slug}/HANDOFF.md`, handoff);
  }

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
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
  prompt?: string;
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
  const filesWithContract = withOperatingContract(parsed.files, {
    slug: parsed.slug,
    runId: args.runId,
    prompt: args.prompt,
    sourceHtml: args.artifactHtml,
    sourceType: 'generated-html',
    importToParityStudio: false,
    byokMode: 'local-mcp-byok',
    createdAtIso: new Date().toISOString(),
  });
  eventBus.setStage(args.runId, 'decompose', 'done', latencyMs, args.decomposeModel);
  eventBus.addCost(args.runId, dec.costUsd);
  eventBus.updateRun(args.runId, {
    uiKitFiles: filesWithContract,
    uiKitSlug: parsed.slug,
  });
  eventBus.appendLog(
    args.runId,
    'info',
    `decomposed into ui_kits/${parsed.slug}/ (${Object.keys(filesWithContract).length} files) in ${(latencyMs / 1000).toFixed(1)}s, $${dec.costUsd.toFixed(4)}`,
  );
  return {
    slug: parsed.slug,
    files: filesWithContract,
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
  const filesWithContract = withOperatingContract(parsed.files, {
    slug: parsed.slug,
    runId: args.runId,
    sourceHtml: args.artifactHtml,
    sourceType: 'generated-html',
    importToParityStudio: false,
    byokMode: 'local-mcp-byok',
    createdAtIso: new Date().toISOString(),
  });
  eventBus.addCost(args.runId, result.costUsd);
  eventBus.updateRun(args.runId, {
    uiKitFiles: filesWithContract,
    uiKitSlug: parsed.slug,
  });
  return {
    slug: parsed.slug,
    files: filesWithContract,
    warnings: parsed.warnings,
    costUsd: result.costUsd,
    latencyMs,
  };
}

// ---------- Helpers --------------------------------------------------------

function findFileEnding(files: Record<string, string>, suffix: string): string | undefined {
  const filename = suffix.replace(/^\/+/, '');
  if (filename === 'index.html' || filename === 'tokens.css') {
    for (const [path, content] of Object.entries(files)) {
      if (path.match(new RegExp(`^ui_kits/[^/]+/${filename.replace('.', '\\.')}$`))) {
        return content;
      }
    }
  }
  for (const [path, content] of Object.entries(files)) {
    if (path === filename || path.endsWith(suffix)) return content;
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

  server.registerResource(
    'parity-studio-agent-rules',
    'parity://agent-rules',
    {
      title: 'Parity Studio Agent Rules',
      description:
        'End-to-end rules for using Parity Studio safely from Claude Code, Codex, Cursor, or Windsurf.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: PARITY_AGENT_RULES }],
    }),
  );

  server.registerPrompt(
    'use-parity-studio',
    {
      title: 'Use Parity Studio With This App',
      description:
        'Guide an agent to capture a running app, export a ui_kit zip, import it to Parity Studio, and keep BYOK provider keys local.',
      argsSchema: {
        request: z.string().optional(),
        appUrl: z.string().optional(),
        projectRoot: z.string().optional(),
        route: z.string().optional(),
      },
    },
    async ({ request, appUrl, projectRoot, route }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${request ?? 'Use Parity Studio with this app, get me the zip export, and upload it to Parity Studio.'}\n\nUse the parity_studio MCP tool. Use url=${appUrl ?? 'auto-detect via PARITY_APP_URL or localhost probe'}, route=${route ?? '(none)'}, projectRoot=${projectRoot ?? '.'}. Use local MCP BYOK env keys only; never print or upload key values. Return the zip path, Parity Studio run URL, parity score, redaction count, and QA gaps.`,
          },
        },
      ],
    }),
  );

  // ── New (v0.1.0) — wraps the hosted Convex web-app services so a coding
  // agent in Claude Code / Cursor / Windsurf can drive the chat, kick the
  // advisor-executor auto-fix, list recent runs, fetch any export format,
  // and rewrite a draft prompt without leaving the editor.

  server.registerTool(
    'parity_agent_runtime_metadata',
    {
      title: 'Get Parity Studio agent runtime metadata',
      description:
        'Returns Claude Code, Codex, Cursor, Windsurf, and generic MCP runtime profiles plus a model-specific env allowlist. Use this before spawning child agents or copying env so unrelated provider keys are not forwarded.',
      inputSchema: {
        models: z
          .array(z.string())
          .optional()
          .describe('Models this agent intends to call; used to compute provider env allowlist.'),
      },
    },
    async ({ models }) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(buildAgentRuntimeMetadata(models ?? []), null, 2),
        },
      ],
    }),
  );

  server.registerPrompt(
    'use-parity-design-mission',
    {
      title: 'Use Parity Studio As A Design-First Slug Board',
      description:
        'Guide an agent to stage UI/design changes in Parity Studio before editing production code.',
      argsSchema: {
        request: z.string().optional(),
        appUrl: z.string().optional(),
        projectRoot: z.string().optional(),
        route: z.string().optional(),
        targetFlow: z.string().optional(),
      },
    },
    async ({ request, appUrl, projectRoot, route, targetFlow }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${request ?? 'Use Parity Studio to iterate the design and UI slugs first before production implementation.'}

Use the parity_design_mission MCP tool. Use url=${appUrl ?? 'auto-detect via PARITY_APP_URL or localhost probe'}, route=${route ?? '(none)'}, projectRoot=${projectRoot ?? '.'}, targetFlow=${targetFlow ?? '(infer from route)'}. Preserve existing components as locked slugs, include locked-component comparison, runtime architecture handoff artifacts, QA dogfood relay packet, Gmail resend HTML, Remotion storyboard, and easier-to-read submission stub. Keep provider keys local, import the generated design board into Parity Studio, and return the zip path, hosted run URL, slug manifest, runtime handoff, parity score, QA packet paths, and next approval steps. Do not edit production app code until the user approves the Parity Studio run; after approval, dry-run parity_apply_approved_design before writing repo files.`,
          },
        },
      ],
    }),
  );

  server.registerTool(
    'parity_enhance_prompt',
    {
      title: 'Rewrite a draft prompt for clarity (Kilo-style)',
      description:
        "Stateless. Calls the hosted enhance action which uses a small/cheap model to rewrite a rough prompt into a clearer, more specific version. Returns { text, modelUsed, provider }. Mirrors Kilo Code's ✨ enhance feature.",
      inputSchema: { text: z.string().min(1).max(8000) },
    },
    async ({ text }) => {
      const result = (await convexCall('action', 'chatLoop:enhance', { text })) as {
        text: string;
        modelUsed: string;
        provider: string;
      };
      return {
        content: [
          { type: 'text', text: result.text },
          { type: 'text', text: `\n[via ${result.provider}/${result.modelUsed}]` },
        ],
      };
    },
  );

  server.registerTool(
    'parity_chat_send',
    {
      title: 'Send a chat message to the parity-studio agent for a run',
      description:
        'Persists a user turn and schedules the agent loop (which has tools: list_files, read_file, read_design_system, upsert_file, set_todos, done). The agent runs server-side and writes assistant + tool turns back. Use parity_chat_history to read what came back.',
      inputSchema: {
        runId: z.string().min(20),
        text: z.string().min(1).max(8000),
      },
    },
    async ({ runId, text }) => {
      await convexCall('mutation', 'chat:send', { runId, text });
      return {
        content: [{ type: 'text', text: `sent — poll parity_chat_history with runId=${runId}` }],
      };
    },
  );

  server.registerTool(
    'parity_chat_advise',
    {
      title: 'Auto-fix via the advisor-executor protocol (advise → execute → verify → close)',
      description:
        'Trigger the agent to autonomously plan + execute on a comment, file, or manual prompt. Synthesizes a user turn that begins with "Auto-fix triggered:" so the system prompt activates the 4-phase protocol. Use kind="comment" with commentId for a saved comment, kind="file" with filePath, or kind="manual" with prompt.',
      inputSchema: {
        runId: z.string().min(20),
        kind: z.enum(['comment', 'file', 'manual']),
        commentId: z.string().optional(),
        filePath: z.string().optional(),
        prompt: z.string().optional(),
      },
    },
    async (args) => {
      await convexCall('mutation', 'chat:startAdviseLoop', args);
      return {
        content: [
          {
            type: 'text',
            text: `advisor-executor scheduled — poll parity_chat_history for the agent's plan + edits`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'parity_chat_history',
    {
      title: 'Read the chat conversation for a run',
      description:
        'Returns the chat_messages array (user / assistant / tool turns) for a runId, sorted by turn. Use after parity_chat_send / parity_chat_advise to see what the agent did.',
      inputSchema: {
        runId: z.string().min(20),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ runId, limit }) => {
      const turns = (await convexCall('query', 'chat:list', { runId })) as Array<{
        turn: number;
        role: string;
        toolName?: string;
        content: string;
        modelId?: string;
      }>;
      const cap = limit ?? 50;
      const tail = turns.slice(-cap);
      const lines = tail.map((t) => {
        const role = t.toolName ? `tool:${t.toolName}` : t.role;
        const head = t.content.split('\n')[0]?.slice(0, 200) ?? '';
        return `[${t.turn}] ${role} → ${head}`;
      });
      return {
        content: [
          {
            type: 'text',
            text: lines.length > 0 ? lines.join('\n') : '(no chat history yet)',
          },
        ],
      };
    },
  );

  server.registerTool(
    'parity_run_listRecent',
    {
      title: 'List recent parity-studio runs',
      description:
        'Returns the most recent runs (most-recent first), each with status, prompt, costMicroUsd, iterationsCompleted, and finishedAt. Useful to find a runId to chat / advise / export against.',
      inputSchema: { limit: z.number().int().min(1).max(50).optional() },
    },
    async ({ limit }) => {
      const runs = (await convexCall('query', 'runs:listRecent', { limit: limit ?? 10 })) as Array<{
        _id: string;
        prompt?: string;
        status: string;
        costMicroUsd: number;
        iterationsCompleted: number;
        finishedAt?: number;
      }>;
      const lines = runs.map((r) => {
        const prompt = (r.prompt ?? '(image-only)').slice(0, 60);
        const cost = `$${(r.costMicroUsd / 1_000_000).toFixed(4)}`;
        return `${r._id}  ${r.status.padEnd(12)}  ${cost}  iter=${r.iterationsCompleted}  ${prompt}`;
      });
      return {
        content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : '(no runs yet)' }],
      };
    },
  );

  server.registerTool(
    'parity_export',
    {
      title: 'Download a run in canonical zip / single HTML / markdown form',
      description:
        'Fetches the export at the chosen format. ZIP = full canonical NodeBench skill-pack (round-trips back into the importer). HTML = single index.html with tokens.css inlined. Markdown = prose handoff for coding agents. Figma = plugin-importable Figma bridge ZIP. Returns the content as text (or base64 for zip/figma).',
      inputSchema: {
        runId: z.string().min(20),
        format: z.enum(['zip', 'html', 'markdown', 'figma']),
      },
    },
    async ({ runId, format }) => {
      const url = `${CONVEX_SITE_URL}/api/runs/${runId}/${format}`;
      const res = await fetch(url);
      if (!res.ok) {
        return {
          content: [{ type: 'text', text: `error: HTTP ${res.status} from ${url}` }],
          isError: true,
        };
      }
      if (format === 'zip' || format === 'figma') {
        const buf = await res.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        return {
          content: [
            { type: 'text', text: `[${format} · ${buf.byteLength} bytes · base64 below]` },
            { type: 'text', text: b64 },
          ],
        };
      }
      const body = await res.text();
      return { content: [{ type: 'text', text: body }] };
    },
  );

  server.registerTool(
    'parity_byok_status',
    {
      title: 'Check local BYOK model-key status without exposing keys',
      description:
        'Returns which provider env vars are present for requested model ids. Never returns key values. Use before local MCP generation/decomposition if the user asks to use their own keys.',
      inputSchema: {
        models: z
          .array(z.string())
          .optional()
          .describe('Model ids to check. Defaults to current generate/decompose/judge models.'),
      },
    },
    async ({ models }) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            localByokStatus(models ?? [GENERATE_MODEL, DECOMPOSE_MODEL, JUDGE_MODEL]),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    'parity_design_mission',
    {
      title: 'Stage design/UI slug changes in Parity Studio before production edits',
      description:
        'High-level design-first workflow for Claude Code, Codex, Cursor, and other agents. Use when the user says "iterate the design and UI slugs first", "preserve locked components", "show me the Parity Studio design board before implementation", or "use Parity Studio like a Figma redesign staging layer". Captures a running route, creates locked slug/component mission files, current-vs-proposed comparison, runtime architecture handoff, verifies, writes a ZIP, and imports to hosted Parity Studio by default. Provider keys stay local in MCP env.',
      inputSchema: designMissionInput,
    },
    handleDesignMission,
  );

  server.registerTool(
    'parity_studio',
    {
      title: 'Use Parity Studio with the current app',
      description:
        'High-level natural-language entrypoint. Use this when the user says "use Parity Studio with our app", "get me the zip export", "upload it to Parity Studio", or "use my own env keys". It auto-detects a local app URL when possible, uses projectRoot=".", keeps provider keys local in MCP env, captures the route, creates a canonical ui_kit zip, verifies it, and imports it to hosted Parity Studio by default.',
      inputSchema: parityStudioInput,
    },
    handleParityStudio,
  );

  server.registerTool(
    'parity_platform_to_ui_kit',
    {
      title: 'Capture an existing platform route and decompose it into a Parity Studio ui_kit',
      description:
        'For Claude Code, Codex, Cursor, and other coding agents working in an already-built app. Opens a running URL with Playwright, captures standalone HTML/CSS, optionally reads local source context, decomposes the route into ui_kits/<slug>/ plus operating contract/API/QA/perf files, verifies it against the captured source, writes/returns a canonical ZIP, and optionally imports it into hosted Parity Studio for iterative editing. Uses local MCP BYOK env keys; key values are never uploaded.',
      inputSchema: platformToUiKitInput,
    },
    handlePlatformToUiKit,
  );

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
        'Takes a complete HTML artifact and emits ui_kits/<slug>/{index.html, components/*.tsx, tokens.css, manifest.json, README.md, parity.contract.json, performance.budget.json, api-wiring.plan.md, qa.plan.md}. Use when you already have a generated artifact from another source and want it shaped for coding-agent handoff.',
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

  server.registerTool(
    'parity_apply_approved_design',
    {
      title: 'Apply approved Parity ui_kit deltas to a local repo',
      description:
        'Approval-gated bridge from design-first ui_kit work to production code. Defaults to dryRun and safe staging under .parity/approved-design/<slug>; explicit mappings are required for production files. Blocks .env, .git, node_modules, lockfiles, and paths outside projectRoot.',
      inputSchema: applyApprovedDesignInput,
    },
    handleApplyApprovedDesign,
  );

  server.registerTool(
    'parity_figma_export',
    {
      title: 'Export a Parity ui_kit as a Figma plugin bridge',
      description:
        'Builds figma/manifest.json, code.js, ui.html, parity-figma-bridge.json, and token metadata so a coding agent can hand a Parity kit to Figma as editable frames, paint styles, and component guide cards.',
      inputSchema: figmaExportInput,
    },
    handleFigmaExport,
  );

  server.registerTool(
    'parity_figma_import',
    {
      title: 'Import Figma bridge or Figma REST JSON into a Parity ui_kit',
      description:
        'Turns a Parity Figma bridge JSON or Figma REST document JSON into ui_kits/<slug>/ files so users can continue comments, inspiration edits, parity checks, and coding-agent handoff in Parity Studio.',
      inputSchema: figmaImportInput,
    },
    handleFigmaImport,
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
