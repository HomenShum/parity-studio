import type {
  NodeSlideAgentModelId,
  NodeSlideDesignBehavior,
  NodeSlideProviderMode,
  NodeSlideReasoningEffort,
  NodeSlideReferenceUsePolicy,
  PatchOperation,
  PatchScope,
} from '../../shared/nodeslide';
import { nodeSlideOperationDigest } from './nodeslideDeckRepl';
import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_SHADOW_COMPARISON_SCHEMA_VERSION = 'nodeslide.shadow-comparison/v1' as const;
export const NODESLIDE_SHADOW_COMPARISON_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK = 100;

const MAX_COMPARISON_BYTES = 16_000;
const MAX_LANE_ELAPSED_MS = 300_000;
const MAX_LANE_OPERATIONS = 8;

export interface NodeSlideShadowComparisonLane {
  adapterId: string;
  adapterVersion: string;
  outcome: 'proposed' | 'skipped' | 'stopped' | 'failed';
  terminalReason: string;
  proposalDigest?: string;
  operationCount: number;
  elapsedMs: number;
}

export interface NodeSlideShadowComparison {
  schemaVersion: typeof NODESLIDE_SHADOW_COMPARISON_SCHEMA_VERSION;
  id: string;
  deckId: string;
  actorDigest: string;
  turnId: string;
  baselinePatchId: string;
  baselineTraceId: string;
  turnInputDigest: string;
  baseSnapshotDigest: string;
  baseDeckVersion: number;
  controlsDigest: string;
  baseline: NodeSlideShadowComparisonLane & {
    outcome: 'proposed';
    terminalReason: 'completed';
    origin: 'free_route' | 'deterministic_fallback';
    proposalDigest: string;
  };
  candidate: NodeSlideShadowComparisonLane;
  candidateExposed: false;
  candidateCommitted: false;
  comparisonDigest: string;
  createdAt: number;
  completedAt: number;
  expiresAt: number;
}

export function nodeSlideEditTurnInputDigest(input: {
  instruction: string;
  deckId: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  focusSlideId?: string;
  designBehavior?: NodeSlideDesignBehavior;
  referenceUse?: NodeSlideReferenceUsePolicy;
  providerMode?: NodeSlideProviderMode;
  providerModel?: NodeSlideAgentModelId;
  providerEffort?: NodeSlideReasoningEffort;
  memories?: readonly { id: string; contentDigest: string }[];
}): string {
  return `turn_${nodeslideContentDigest(stableSerialize(input))}`;
}

export function nodeSlideShadowComparisonExpected(
  requested: boolean,
  baselineStatus: string,
): boolean {
  return requested && baselineStatus !== 'stale';
}

export function createNodeSlideShadowComparison(args: {
  id: string;
  deckId: string;
  actorSubject: string;
  turnId: string;
  baselinePatchId: string;
  baselineTraceId: string;
  turnInputDigest: string;
  baseSnapshotDigest: string;
  baseDeckVersion: number;
  controlsDigest: string;
  baseline: NodeSlideShadowComparison['baseline'];
  candidate: NodeSlideShadowComparisonLane;
  createdAt: number;
  completedAt: number;
}): NodeSlideShadowComparison {
  const partial = {
    schemaVersion: NODESLIDE_SHADOW_COMPARISON_SCHEMA_VERSION,
    id: args.id,
    deckId: args.deckId,
    actorDigest: `actor_${nodeslideContentDigest(args.actorSubject)}`,
    turnId: args.turnId,
    baselinePatchId: args.baselinePatchId,
    baselineTraceId: args.baselineTraceId,
    turnInputDigest: args.turnInputDigest,
    baseSnapshotDigest: args.baseSnapshotDigest,
    baseDeckVersion: args.baseDeckVersion,
    controlsDigest: args.controlsDigest,
    baseline: structuredClone(args.baseline),
    candidate: structuredClone(args.candidate),
    candidateExposed: false as const,
    candidateCommitted: false as const,
    createdAt: args.createdAt,
    completedAt: args.completedAt,
    expiresAt: args.createdAt + NODESLIDE_SHADOW_COMPARISON_TTL_MS,
  };
  assertNodeSlideShadowComparisonBounds(partial);
  return {
    ...partial,
    comparisonDigest: nodeSlideShadowComparisonDigest(partial),
  };
}

export function nodeSlideShadowComparisonDigest(
  comparison: Omit<NodeSlideShadowComparison, 'comparisonDigest'> | NodeSlideShadowComparison,
): string {
  const entries = Object.entries(comparison).filter(([key]) => key !== 'comparisonDigest');
  return `comparison_${nodeslideContentDigest(stableSerialize(Object.fromEntries(entries)))}`;
}

export function assertNodeSlideShadowComparisonBounds(
  comparison: Omit<NodeSlideShadowComparison, 'comparisonDigest'> | NodeSlideShadowComparison,
): void {
  if (comparison.schemaVersion !== NODESLIDE_SHADOW_COMPARISON_SCHEMA_VERSION) {
    throw new Error('Shadow comparison schema version is invalid.');
  }
  for (const id of [
    comparison.id,
    comparison.deckId,
    comparison.turnId,
    comparison.baselinePatchId,
    comparison.baselineTraceId,
  ]) {
    if (!cleanId(id) || cleanId(id) !== id) {
      throw new Error('Shadow comparison identity is invalid.');
    }
  }
  if (!isCanonicalBoundDigest(comparison.actorDigest, 'actor')) {
    throw new Error('Shadow comparison actor digest is invalid.');
  }
  if (!isCanonicalBoundDigest(comparison.turnInputDigest, 'turn')) {
    throw new Error('Shadow comparison turn digest is invalid.');
  }
  if (!isCanonicalBoundDigest(comparison.baseSnapshotDigest, 'snap')) {
    throw new Error('Shadow comparison snapshot digest is invalid.');
  }
  if (!isCanonicalBoundDigest(comparison.controlsDigest, 'controls')) {
    throw new Error('Shadow comparison controls digest is invalid.');
  }
  if (!Number.isSafeInteger(comparison.baseDeckVersion) || comparison.baseDeckVersion < 0) {
    throw new Error('Shadow comparison deck version is invalid.');
  }
  assertLane(comparison.baseline, true);
  assertLane(comparison.candidate, false);
  if (
    comparison.baseline.outcome !== 'proposed' ||
    comparison.baseline.terminalReason !== 'completed' ||
    !['free_route', 'deterministic_fallback'].includes(comparison.baseline.origin) ||
    !comparison.baseline.proposalDigest
  ) {
    throw new Error('Shadow comparison baseline lane is invalid.');
  }
  if (comparison.candidateExposed !== false || comparison.candidateCommitted !== false) {
    throw new Error('Shadow candidate authority invariant is invalid.');
  }
  if (
    !Number.isSafeInteger(comparison.createdAt) ||
    !Number.isSafeInteger(comparison.completedAt) ||
    !Number.isSafeInteger(comparison.expiresAt) ||
    comparison.createdAt <= 0 ||
    comparison.completedAt < comparison.createdAt ||
    comparison.expiresAt <= comparison.completedAt ||
    comparison.expiresAt - comparison.createdAt > NODESLIDE_SHADOW_COMPARISON_TTL_MS
  ) {
    throw new Error('Shadow comparison lifecycle is invalid.');
  }
  if (
    'comparisonDigest' in comparison &&
    (!isCanonicalBoundDigest(comparison.comparisonDigest, 'comparison') ||
      comparison.comparisonDigest !== nodeSlideShadowComparisonDigest(comparison))
  ) {
    throw new Error('Shadow comparison digest is invalid.');
  }
  if (new TextEncoder().encode(stableSerialize(comparison)).byteLength > MAX_COMPARISON_BYTES) {
    throw new Error('Shadow comparison byte limit exceeded.');
  }
}

export function nodeSlideShadowComparisonRetentionPlan(
  rows: readonly Pick<NodeSlideShadowComparison, 'id' | 'createdAt' | 'expiresAt'>[],
  now: number,
): string[] {
  const expired = rows
    .filter((row) => row.expiresAt <= now)
    .sort((left, right) => left.expiresAt - right.expiresAt || left.id.localeCompare(right.id));
  const active = rows
    .filter((row) => row.expiresAt > now)
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
  return [
    ...new Set(
      [...expired, ...active.slice(NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK)].map(
        (row) => row.id,
      ),
    ),
  ];
}

/**
 * Verify the pair against evidence written atomically with the authoritative
 * baseline proposal. This prevents a future internal producer from attaching
 * a valid-shaped comparison to a different request or snapshot.
 */
export function assertNodeSlideShadowComparisonBaselineBinding(args: {
  comparison: NodeSlideShadowComparison;
  baselinePatch: {
    id: string;
    deckId: string;
    traceId?: string;
    source: string;
    status: string;
    baseDeckVersion: number;
    operations: readonly PatchOperation[];
  };
  baselineTrace: {
    id: string;
    deckId: string;
    patchId?: string;
    planningInputDigest?: string;
    planningSnapshotDigest?: string;
    shadowComparisonExpected?: boolean;
    shadowControlsDigest?: string;
  };
}): void {
  const { comparison, baselinePatch, baselineTrace } = args;
  if (
    baselinePatch.id !== comparison.baselinePatchId ||
    baselinePatch.deckId !== comparison.deckId ||
    baselinePatch.traceId !== comparison.baselineTraceId ||
    baselinePatch.source !== 'agent' ||
    baselinePatch.baseDeckVersion !== comparison.baseDeckVersion ||
    baselinePatch.operations.length !== comparison.baseline.operationCount ||
    nodeSlideOperationDigest(baselinePatch.operations) !== comparison.baseline.proposalDigest ||
    baselineTrace.id !== comparison.baselineTraceId ||
    baselineTrace.deckId !== comparison.deckId ||
    baselineTrace.patchId !== comparison.baselinePatchId ||
    baselineTrace.planningInputDigest !== comparison.turnInputDigest ||
    baselineTrace.planningSnapshotDigest !== comparison.baseSnapshotDigest ||
    baselineTrace.shadowComparisonExpected !== true ||
    baselineTrace.shadowControlsDigest !== comparison.controlsDigest
  ) {
    throw new Error('Shadow comparison baseline binding mismatch.');
  }
}

function assertLane(lane: NodeSlideShadowComparisonLane, baseline: boolean): void {
  if (
    !cleanAdapterId(lane.adapterId) ||
    cleanAdapterId(lane.adapterId) !== lane.adapterId ||
    !cleanAdapterId(lane.adapterVersion) ||
    cleanAdapterId(lane.adapterVersion) !== lane.adapterVersion
  ) {
    throw new Error('Shadow comparison adapter identity is invalid.');
  }
  if (!['proposed', 'skipped', 'stopped', 'failed'].includes(lane.outcome)) {
    throw new Error('Shadow comparison lane outcome is invalid.');
  }
  if (
    !cleanReason(lane.terminalReason) ||
    cleanReason(lane.terminalReason) !== lane.terminalReason
  ) {
    throw new Error('Shadow comparison lane terminal reason is invalid.');
  }
  if (
    !Number.isSafeInteger(lane.operationCount) ||
    lane.operationCount < 0 ||
    lane.operationCount > MAX_LANE_OPERATIONS ||
    !Number.isSafeInteger(lane.elapsedMs) ||
    lane.elapsedMs < 0 ||
    lane.elapsedMs > MAX_LANE_ELAPSED_MS
  ) {
    throw new Error('Shadow comparison lane usage is invalid.');
  }
  if (lane.outcome === 'proposed') {
    if (
      lane.operationCount === 0 ||
      !isCanonicalBoundDigest(lane.proposalDigest, 'ops') ||
      lane.terminalReason !== 'completed'
    ) {
      throw new Error('Shadow comparison proposed lane is invalid.');
    }
  } else if (lane.operationCount !== 0 || lane.proposalDigest !== undefined) {
    throw new Error('Shadow comparison non-proposal lane contains proposal metadata.');
  }
  if (baseline && lane.outcome !== 'proposed') {
    throw new Error('Shadow comparison baseline did not produce a proposal.');
  }
}

function cleanId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^A-Za-z0-9._:/+ -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function cleanAdapterId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 96) return '';
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ? value : '';
}

function cleanReason(value: unknown): string {
  if (typeof value !== 'string' || value.length > 96) return '';
  return /^[a-z][a-z0-9_]*$/.test(value) ? value : '';
}

function isCanonicalBoundDigest(value: unknown, prefix: string): value is string {
  if (typeof value !== 'string') return false;
  const marker = `${prefix}_sha256:`;
  return value.startsWith(marker) && /^[0-9a-f]{64}$/.test(value.slice(marker.length));
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return value;
}
