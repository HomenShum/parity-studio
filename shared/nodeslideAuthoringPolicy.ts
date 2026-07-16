import { nodeSlideDurableDigest } from './nodeslideDurableSession';

export const NODESLIDE_AUTHORING_POLICY_VERSION = 'nodeslide.authoring-policy/v1' as const;

export const NODESLIDE_AUTHORING_ROLES = [
  'communication_strategist',
  'researcher',
  'narrative_architect',
  'storyboard_architect',
  'visual_director',
  'layout_composer',
  'data_visualization_agent',
  'claim_verifier',
  'slide_critic',
  'deck_critic',
  'export_parity_critic',
  'journey_capture_agent',
] as const;

export type NodeSlideAuthoringRole = (typeof NODESLIDE_AUTHORING_ROLES)[number];

export interface NodeSlideAuthoringPolicyBundle {
  schemaVersion: typeof NODESLIDE_AUTHORING_POLICY_VERSION;
  id: string;
  parentId?: string;
  generation: number;
  roles: Record<NodeSlideAuthoringRole, { enabled: boolean; promptVersion: string }>;
  maxRepairIterations: number;
  requireReferenceComparison: boolean;
  requireJourneyProof: boolean;
  thresholds: {
    overall: number;
    perDimension: number;
    requestCoverage: number;
    evidenceCoverage: number;
    maxConsecutiveLayoutRepeats: number;
  };
  digest: string;
}

export interface NodeSlideAuthoringPolicyPatch {
  rolePromptVersions?: Partial<Record<NodeSlideAuthoringRole, string>>;
  roleEnabled?: Partial<Record<NodeSlideAuthoringRole, boolean>>;
  maxRepairIterations?: number;
  requireReferenceComparison?: boolean;
  requireJourneyProof?: boolean;
  thresholds?: Partial<NodeSlideAuthoringPolicyBundle['thresholds']>;
}

export interface NodeSlideAuthoringEvaluation {
  policyId: string;
  heldOut: boolean;
  quality: number;
  safety: number;
  exportFidelity: number;
  costMicroUsd: number;
  latencyMs: number;
  journeyProofPassed: boolean;
  evaluatedAt: number;
  digest: string;
}

export interface NodeSlideAuthoringArchiveEntry {
  policy: NodeSlideAuthoringPolicyBundle;
  evaluation: NodeSlideAuthoringEvaluation;
}

export function createDefaultNodeSlideAuthoringPolicy(): NodeSlideAuthoringPolicyBundle {
  return materializePolicy({
    schemaVersion: NODESLIDE_AUTHORING_POLICY_VERSION,
    id: 'authoring-policy:default-v1',
    generation: 0,
    roles: Object.fromEntries(
      NODESLIDE_AUTHORING_ROLES.map((role) => [
        role,
        { enabled: true, promptVersion: `${role}/v1` },
      ]),
    ) as NodeSlideAuthoringPolicyBundle['roles'],
    maxRepairIterations: 3,
    requireReferenceComparison: true,
    requireJourneyProof: true,
    thresholds: {
      overall: 85,
      perDimension: 75,
      requestCoverage: 100,
      evidenceCoverage: 100,
      maxConsecutiveLayoutRepeats: 2,
    },
  });
}

/**
 * Applies a bounded policy/config change. Production code is intentionally outside the
 * mutation surface; HyperAgents-style exploration is limited to versioned authoring policy.
 */
export function applyNodeSlideAuthoringPolicyPatch(
  base: NodeSlideAuthoringPolicyBundle,
  patch: NodeSlideAuthoringPolicyPatch,
  childId: string,
): NodeSlideAuthoringPolicyBundle {
  assertValidPolicy(base);
  const roles = structuredClone(base.roles);
  for (const [role, enabled] of Object.entries(patch.roleEnabled ?? {})) {
    assertRole(role);
    if (typeof enabled !== 'boolean') throw new Error(`Invalid enabled value for ${role}.`);
    roles[role].enabled = enabled;
  }
  for (const [role, promptVersion] of Object.entries(patch.rolePromptVersions ?? {})) {
    assertRole(role);
    if (!validVersion(promptVersion)) throw new Error(`Invalid prompt version for ${role}.`);
    roles[role].promptVersion = promptVersion;
  }
  const next = materializePolicy({
    schemaVersion: NODESLIDE_AUTHORING_POLICY_VERSION,
    id: normalizedId(childId),
    parentId: base.id,
    generation: base.generation + 1,
    roles,
    maxRepairIterations: patch.maxRepairIterations ?? base.maxRepairIterations,
    requireReferenceComparison: patch.requireReferenceComparison ?? base.requireReferenceComparison,
    requireJourneyProof: patch.requireJourneyProof ?? base.requireJourneyProof,
    thresholds: { ...base.thresholds, ...patch.thresholds },
  });
  assertValidPolicy(next);
  return next;
}

export function createNodeSlideAuthoringEvaluation(
  input: Omit<NodeSlideAuthoringEvaluation, 'digest'>,
): NodeSlideAuthoringEvaluation {
  for (const key of ['quality', 'safety', 'exportFidelity'] as const) {
    if (!score(input[key])) throw new Error(`${key} must be between 0 and 100.`);
  }
  if (!Number.isSafeInteger(input.costMicroUsd) || input.costMicroUsd < 0) {
    throw new Error('costMicroUsd must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(input.latencyMs) || input.latencyMs < 0) {
    throw new Error('latencyMs must be a non-negative safe integer.');
  }
  const partial = structuredClone(input);
  return { ...partial, digest: nodeSlideDurableDigest(partial) };
}

export function verifyNodeSlideAuthoringEvaluation(
  evaluation: NodeSlideAuthoringEvaluation,
): boolean {
  const { digest, ...partial } = evaluation;
  return digest === nodeSlideDurableDigest(partial);
}

/** Deterministic Pareto-front selection over quality, safety, fidelity, cost, and latency. */
export function nodeSlideAuthoringParetoFront(
  entries: readonly NodeSlideAuthoringArchiveEntry[],
): NodeSlideAuthoringArchiveEntry[] {
  const eligible = entries.filter(
    ({ policy, evaluation }) =>
      policy.id === evaluation.policyId &&
      evaluation.heldOut &&
      evaluation.journeyProofPassed &&
      verifyNodeSlideAuthoringEvaluation(evaluation) &&
      safePolicy(policy),
  );
  return eligible
    .filter(
      (candidate) => !eligible.some((other) => other !== candidate && dominates(other, candidate)),
    )
    .sort(compareEntries);
}

export function selectNodeSlideAuthoringParent(
  entries: readonly NodeSlideAuthoringArchiveEntry[],
): NodeSlideAuthoringArchiveEntry | null {
  return nodeSlideAuthoringParetoFront(entries)[0] ?? null;
}

export function nodeSlideAuthoringPolicyPromotable(args: {
  baseline: NodeSlideAuthoringArchiveEntry;
  candidate: NodeSlideAuthoringArchiveEntry;
}): boolean {
  const { baseline, candidate } = args;
  return (
    candidate.policy.parentId === baseline.policy.id &&
    candidate.evaluation.heldOut &&
    candidate.evaluation.journeyProofPassed &&
    verifyNodeSlideAuthoringEvaluation(candidate.evaluation) &&
    candidate.evaluation.safety >= baseline.evaluation.safety &&
    candidate.evaluation.exportFidelity >= baseline.evaluation.exportFidelity &&
    candidate.evaluation.quality > baseline.evaluation.quality &&
    safePolicy(candidate.policy)
  );
}

function materializePolicy(
  input: Omit<NodeSlideAuthoringPolicyBundle, 'digest'>,
): NodeSlideAuthoringPolicyBundle {
  return { ...input, digest: nodeSlideDurableDigest(input) };
}

function assertValidPolicy(policy: NodeSlideAuthoringPolicyBundle): void {
  if (!safePolicy(policy))
    throw new Error('Authoring policy violates the bounded policy contract.');
  const { digest, ...partial } = policy;
  if (digest !== nodeSlideDurableDigest(partial))
    throw new Error('Authoring policy digest mismatch.');
}

function safePolicy(policy: NodeSlideAuthoringPolicyBundle): boolean {
  return (
    policy.schemaVersion === NODESLIDE_AUTHORING_POLICY_VERSION &&
    Boolean(policy.id.trim()) &&
    Number.isSafeInteger(policy.generation) &&
    policy.generation >= 0 &&
    Number.isInteger(policy.maxRepairIterations) &&
    policy.maxRepairIterations >= 1 &&
    policy.maxRepairIterations <= 5 &&
    policy.requireJourneyProof &&
    policy.roles.claim_verifier.enabled &&
    policy.roles.export_parity_critic.enabled &&
    policy.roles.journey_capture_agent.enabled &&
    score(policy.thresholds.overall) &&
    score(policy.thresholds.perDimension) &&
    policy.thresholds.requestCoverage === 100 &&
    policy.thresholds.evidenceCoverage === 100 &&
    Number.isInteger(policy.thresholds.maxConsecutiveLayoutRepeats) &&
    policy.thresholds.maxConsecutiveLayoutRepeats >= 1 &&
    policy.thresholds.maxConsecutiveLayoutRepeats <= 3
  );
}

function dominates(
  left: NodeSlideAuthoringArchiveEntry,
  right: NodeSlideAuthoringArchiveEntry,
): boolean {
  const l = left.evaluation;
  const r = right.evaluation;
  const noWorse =
    l.quality >= r.quality &&
    l.safety >= r.safety &&
    l.exportFidelity >= r.exportFidelity &&
    l.costMicroUsd <= r.costMicroUsd &&
    l.latencyMs <= r.latencyMs;
  const better =
    l.quality > r.quality ||
    l.safety > r.safety ||
    l.exportFidelity > r.exportFidelity ||
    l.costMicroUsd < r.costMicroUsd ||
    l.latencyMs < r.latencyMs;
  return noWorse && better;
}

function compareEntries(
  left: NodeSlideAuthoringArchiveEntry,
  right: NodeSlideAuthoringArchiveEntry,
): number {
  return (
    right.evaluation.quality - left.evaluation.quality ||
    right.evaluation.safety - left.evaluation.safety ||
    right.evaluation.exportFidelity - left.evaluation.exportFidelity ||
    left.evaluation.costMicroUsd - right.evaluation.costMicroUsd ||
    left.evaluation.latencyMs - right.evaluation.latencyMs ||
    left.policy.id.localeCompare(right.policy.id)
  );
}

function assertRole(value: string): asserts value is NodeSlideAuthoringRole {
  if (!(NODESLIDE_AUTHORING_ROLES as readonly string[]).includes(value)) {
    throw new Error(`Unknown authoring role: ${value}`);
  }
}

function validVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._/-]{2,79}$/u.test(value);
}

function normalizedId(value: string): string {
  const id = value.trim();
  if (!/^[a-z0-9][a-z0-9:._/-]{2,127}$/u.test(id)) throw new Error('Invalid policy id.');
  return id;
}

function score(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}
