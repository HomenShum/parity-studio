import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// All cost fields stored as integer micro-cents (1 USD = 1_000_000 micro-cents)
// to dodge floating-point drift on summation. UI converts back to USD on read.

export const RUN_STATUSES = [
  'queued',
  'generating',
  'decomposing',
  'verifying',
  'iterating',
  'done',
  'failed',
] as const;

export const PARITY_STATUSES = [
  'verified',
  'needs_review',
  'needs_iteration',
  'failed',
  'unavailable',
] as const;

export default defineSchema({
  runs: defineTable({
    prompt: v.optional(v.string()),
    sourceImageStorageId: v.optional(v.id('_storage')),
    /**
     * Inline source-image bytes, persisted so the canvas can render the
     * original sketch alongside whatever component is currently scoped
     * (the SourceImagePopover). Same 2 MB cap as runs.start. For larger
     * images, sourceImageStorageId is the path forward.
     */
    sourceImageBase64: v.optional(v.string()),
    sourceImageMimeType: v.optional(
      v.union(v.literal('image/png'), v.literal('image/jpeg'), v.literal('image/webp')),
    ),
    status: v.union(...RUN_STATUSES.map((s) => v.literal(s))),
    workflowId: v.optional(v.string()),
    streamId: v.optional(v.string()),
    costMicroUsd: v.number(),
    iterationsCompleted: v.number(),
    errorMessage: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
    /**
     * Optional tier override for this run. When set, the agent loop +
     * pipeline use it instead of the deployment-wide PARITY_TIER. UI
     * lets the user cycle Frontier / Balanced / Free per session.
     */
    tier: v.optional(
      v.union(v.literal('frontier'), v.literal('balanced'), v.literal('free'), v.literal('small')),
    ),
    /**
     * Per-stage cost + telemetry breakdown for the cost panel UI.
     * Append-only: each stage push appends one entry; iterate stages
     * append their own. Reads as a flat list ordered by stageStartedAt.
     */
    costBreakdown: v.optional(
      v.array(
        v.object({
          stage: v.string(), // 'generate' | 'decompose' | 'verify-deterministic' | 'verify-visual' | 'iterate-1' | ...
          modelId: v.string(),
          provider: v.string(),
          costMicroUsd: v.number(),
          inputTokens: v.optional(v.number()),
          outputTokens: v.optional(v.number()),
          latencyMs: v.number(),
          stageStartedAt: v.number(),
        }),
      ),
    ),
  }).index('by_status', ['status']),

  artifacts: defineTable({
    runId: v.id('runs'),
    version: v.number(), // 0 = initial generation, 1+ = iteration outputs
    html: v.string(),
    sizeBytes: v.number(),
  }).index('by_run_version', ['runId', 'version']),

  ui_kits: defineTable({
    runId: v.id('runs'),
    artifactVersion: v.number(),
    slug: v.string(),
    schemaVersion: v.number(),
    files: v.any(), // {[path: string]: string} tree
    fileCount: v.number(),
    decomposeCostMicroUsd: v.number(),
  })
    .index('by_run', ['runId'])
    .index('by_run_version', ['runId', 'artifactVersion']),

  /**
   * User comments pinned to a region of the rendered artifact. Used by the
   * "iterate with comments" path: the agent receives the bbox + text and
   * is told to address each comment in the next decompose pass.
   *
   * Bbox coordinates are normalized to 0..1 over the rendered iframe so they
   * survive viewport changes (desktop / tablet / mobile). status='open' until
   * the next iterate run consumes it; then 'addressed'.
   */
  comments: defineTable({
    runId: v.id('runs'),
    artifactVersion: v.number(),
    text: v.string(),
    bbox: v.optional(
      v.object({
        x: v.number(),
        y: v.number(),
        w: v.number(),
        h: v.number(),
      }),
    ),
    /**
     * Optional file path within the latest ui_kit (e.g. "components/Button.tsx").
     * Set when the user clicks a file in FilesPanel before commenting, so the
     * iterate prompt can scope the change to that component instead of the whole
     * artifact. Coexists with bbox — both can be present.
     */
    targetFile: v.optional(v.string()),
    status: v.union(v.literal('open'), v.literal('addressed'), v.literal('dismissed')),
  })
    .index('by_run', ['runId'])
    .index('by_run_status', ['runId', 'status']),

  /**
   * Conversation log per run. Drives the ChatPanel surface — user turns,
   * assistant turns (with optional tool calls), and tool result turns.
   * The agent's tool calls (read_file, patch_file, upsert_file,
   * iterate_now, list_files) act on the run's ui_kit row, so any edit
   * is atomic and round-trips through the canonical-shape exporter.
   */
  chat_messages: defineTable({
    runId: v.id('runs'),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('tool')),
    /** Plain text content. Empty string allowed for tool turns whose
     * payload is fully captured in toolName/toolArgs/toolResult. */
    content: v.string(),
    /** For assistant turns: the tool calls the model emitted alongside
     * (or instead of) prose. Each entry has id + name + args (JSON). */
    toolCalls: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          args: v.string(),
        }),
      ),
    ),
    /** For tool turns: the call id this result corresponds to. */
    toolCallId: v.optional(v.string()),
    /** For tool turns: short label of the tool (e.g. 'patch_file'). */
    toolName: v.optional(v.string()),
    /** Optional model + provider tag for assistant turns. */
    modelId: v.optional(v.string()),
    provider: v.optional(v.string()),
    /** Provider-reported cost for this turn, if any. */
    costMicroUsd: v.optional(v.number()),
    /** Turn index, monotonic per run. Lets the UI keep order without
     * needing to rely on _creationTime stability under high write rate. */
    turn: v.number(),
  })
    .index('by_run_turn', ['runId', 'turn'])
    .index('by_run', ['runId']),

  parity_reports: defineTable({
    runId: v.id('runs'),
    uiKitId: v.id('ui_kits'),
    iterationNumber: v.number(),
    passCount: v.number(),
    totalChecks: v.number(),
    status: v.union(...PARITY_STATUSES.map((s) => v.literal(s))),
    gaps: v.any(), // ParityGap[]
    summary: v.string(),
    judgeCostMicroUsd: v.number(),
    judgeModel: v.optional(v.string()),
    /**
     * Sprint 3 (2026-04-28): typed 16-row check rubric per
     * docs/plans/2026-04-28-shell-revamp-from-reference.md §6.
     * Optional for back-compat with rows written before the rewrite.
     * Each entry is { id, label, status: 'pass'|'warn'|'fail'|'unavailable',
     * evidence: string[] }.
     */
    checks: v.optional(v.any()),
  })
    .index('by_run_iter', ['runId', 'iterationNumber'])
    .index('by_uikit', ['uiKitId']),
});
