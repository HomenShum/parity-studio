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
    status: v.union(...RUN_STATUSES.map((s) => v.literal(s))),
    workflowId: v.optional(v.string()),
    streamId: v.optional(v.string()),
    costMicroUsd: v.number(),
    iterationsCompleted: v.number(),
    errorMessage: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
  })
    .index('by_status', ['status'])
    .index('by_creation', ['_creationTime']),

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
  })
    .index('by_run_iter', ['runId', 'iterationNumber'])
    .index('by_uikit', ['uiKitId']),
});
