import { v } from 'convex/values';

/**
 * Shared storage and mutation-boundary validator for bounded execution traces.
 * Keeping one field map prevents the database schema and the internal write API
 * from drifting apart.
 */
export const nodeslideExecutionTraceFields = {
  schemaVersion: v.literal('nodeslide.execution-trace/v1'),
  id: v.string(),
  deckId: v.string(),
  actorDigest: v.string(),
  sessionId: v.string(),
  cohort: v.string(),
  controlsDigest: v.optional(v.string()),
  kind: v.union(
    v.literal('deck_repl'),
    v.literal('analysis_kernel'),
    v.literal('render_repair'),
    v.literal('storybench'),
  ),
  status: v.union(v.literal('completed'), v.literal('stopped')),
  terminalReason: v.string(),
  baseSnapshotDigest: v.string(),
  candidateSnapshotDigest: v.optional(v.string()),
  baseDeckVersion: v.number(),
  adapterId: v.string(),
  adapterVersion: v.string(),
  egressMode: v.union(v.literal('deny'), v.literal('allowlist')),
  allowedHosts: v.array(v.string()),
  consentDigest: v.optional(v.string()),
  providerTelemetry: v.optional(
    v.object({
      provider: v.string(),
      resolvedModel: v.string(),
      inputTokens: v.number(),
      outputTokens: v.number(),
      costMicroUsd: v.number(),
      latencyMs: v.number(),
      retries: v.number(),
      fallbackUsed: v.boolean(),
    }),
  ),
  plan: v.array(v.string()),
  steps: v.array(
    v.object({
      index: v.number(),
      commandId: v.string(),
      type: v.string(),
      status: v.union(v.literal('ok'), v.literal('error')),
      summary: v.string(),
      outputDigest: v.string(),
      elapsedMs: v.number(),
      outputBytes: v.number(),
    }),
  ),
  guardrails: v.array(v.string()),
  proposalDigests: v.array(v.string()),
  budget: v.object({
    maxSteps: v.number(),
    maxInputBytes: v.number(),
    maxOutputBytes: v.number(),
    maxOperations: v.number(),
    maxWallTimeMs: v.number(),
  }),
  usage: v.object({
    steps: v.number(),
    inputBytes: v.number(),
    outputBytes: v.number(),
    operations: v.number(),
    elapsedMs: v.number(),
  }),
  cleanupConfirmed: v.boolean(),
  traceDigest: v.string(),
  createdAt: v.number(),
  completedAt: v.number(),
  expiresAt: v.number(),
};

export const nodeslideExecutionTraceValidator = v.object(nodeslideExecutionTraceFields);
