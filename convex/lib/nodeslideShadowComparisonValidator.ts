import { v } from 'convex/values';

const nodeslideShadowComparisonLaneValidator = v.object({
  adapterId: v.string(),
  adapterVersion: v.string(),
  outcome: v.union(
    v.literal('proposed'),
    v.literal('skipped'),
    v.literal('stopped'),
    v.literal('failed'),
  ),
  terminalReason: v.string(),
  proposalDigest: v.optional(v.string()),
  operationCount: v.number(),
  elapsedMs: v.number(),
});

export const nodeslideShadowComparisonFields = {
  schemaVersion: v.literal('nodeslide.shadow-comparison/v1'),
  id: v.string(),
  deckId: v.string(),
  actorDigest: v.string(),
  turnId: v.string(),
  baselinePatchId: v.string(),
  baselineTraceId: v.string(),
  turnInputDigest: v.string(),
  baseSnapshotDigest: v.string(),
  baseDeckVersion: v.number(),
  controlsDigest: v.string(),
  baseline: v.object({
    adapterId: v.string(),
    adapterVersion: v.string(),
    outcome: v.literal('proposed'),
    terminalReason: v.literal('completed'),
    origin: v.union(v.literal('free_route'), v.literal('deterministic_fallback')),
    proposalDigest: v.string(),
    operationCount: v.number(),
    elapsedMs: v.number(),
  }),
  candidate: nodeslideShadowComparisonLaneValidator,
  candidateExposed: v.literal(false),
  candidateCommitted: v.literal(false),
  comparisonDigest: v.string(),
  createdAt: v.number(),
  completedAt: v.number(),
  expiresAt: v.number(),
};

export const nodeslideShadowComparisonValidator = v.object(nodeslideShadowComparisonFields);
