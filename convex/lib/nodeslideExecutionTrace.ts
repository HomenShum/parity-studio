import type { NodeSlideDeckReplResult, NodeSlideDeckReplTerminalReason } from './nodeslideDeckRepl';
import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_EXECUTION_TRACE_SCHEMA_VERSION = 'nodeslide.execution-trace/v1' as const;
export const NODESLIDE_EXECUTION_TRACE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK = 100;

const MAX_PLAN_STEPS = 16;
const MAX_STEP_RECEIPTS = 32;
const MAX_GUARDRAILS = 16;
const MAX_PROPOSAL_DIGESTS = 64;
const MAX_SUMMARY_LENGTH = 500;
const MAX_TRACE_BYTES = 64_000;
const MAX_TRACE_BUDGET = Object.freeze({
  maxSteps: 1_000,
  maxInputBytes: 50_000_000,
  maxOutputBytes: 50_000_000,
  maxOperations: 10_000,
  maxWallTimeMs: 900_000,
});

export interface NodeSlideExecutionTraceStep {
  index: number;
  commandId: string;
  type: string;
  status: 'ok' | 'error';
  summary: string;
  outputDigest: string;
  elapsedMs: number;
  outputBytes: number;
}

export interface NodeSlideExecutionTrace {
  schemaVersion: typeof NODESLIDE_EXECUTION_TRACE_SCHEMA_VERSION;
  id: string;
  deckId: string;
  actorDigest: string;
  sessionId: string;
  cohort: string;
  controlsDigest?: string;
  kind: 'deck_repl' | 'analysis_kernel' | 'render_repair' | 'storybench';
  status: 'completed' | 'stopped';
  terminalReason: string;
  baseSnapshotDigest: string;
  candidateSnapshotDigest?: string;
  baseDeckVersion: number;
  adapterId: string;
  adapterVersion: string;
  egressMode: 'deny' | 'allowlist';
  allowedHosts: string[];
  consentDigest?: string;
  providerTelemetry?: {
    provider: string;
    resolvedModel: string;
    inputTokens: number;
    outputTokens: number;
    costMicroUsd: number;
    latencyMs: number;
    retries: number;
    fallbackUsed: boolean;
  };
  plan: string[];
  steps: NodeSlideExecutionTraceStep[];
  guardrails: string[];
  proposalDigests: string[];
  budget: {
    maxSteps: number;
    maxInputBytes: number;
    maxOutputBytes: number;
    maxOperations: number;
    maxWallTimeMs: number;
  };
  usage: {
    steps: number;
    inputBytes: number;
    outputBytes: number;
    operations: number;
    elapsedMs: number;
  };
  cleanupConfirmed: boolean;
  traceDigest: string;
  createdAt: number;
  completedAt: number;
  expiresAt: number;
}

export function executionTraceFromDeckRepl(args: {
  result: NodeSlideDeckReplResult;
  deckId: string;
  actorSubject: string;
  createdAt: number;
  adapterId?: string;
  adapterVersion?: string;
  cohort?: string;
  controlsDigest?: string;
}): NodeSlideExecutionTrace {
  const createdAt = boundedTimestamp(args.createdAt);
  const deckId = cleanId(args.deckId);
  const actorDigest = `actor_${nodeslideContentDigest(args.actorSubject)}`;
  if (!deckId || args.result.deckId !== deckId) {
    throw new Error('Execution trace deck binding is invalid.');
  }
  if (!cleanId(args.result.traceId) || !cleanId(args.result.sessionId)) {
    throw new Error('Execution trace identity is invalid.');
  }
  if (args.result.receipts.length > MAX_STEP_RECEIPTS) {
    throw new Error('Execution trace contains too many step receipts.');
  }
  const steps = args.result.receipts.map((receipt, index) => ({
    index,
    commandId: cleanId(receipt.commandId),
    type: cleanId(receipt.commandType),
    status: receipt.status,
    summary: cleanText(receipt.summary),
    outputDigest: cleanDigest(receipt.outputDigest),
    elapsedMs: boundedNonNegativeInteger(receipt.elapsedMs),
    outputBytes: boundedNonNegativeInteger(receipt.outputBytes),
  }));
  const proposalDigests = args.result.proposals
    .map((proposal) => cleanDigest(proposal.operationDigest))
    .filter(Boolean)
    .slice(0, MAX_PROPOSAL_DIGESTS);
  const plan = args.result.receipts
    .map((receipt) => `${receipt.commandType}:${receipt.status}`)
    .slice(0, MAX_PLAN_STEPS);
  const partial = {
    schemaVersion: NODESLIDE_EXECUTION_TRACE_SCHEMA_VERSION,
    id: cleanId(args.result.traceId),
    deckId,
    actorDigest,
    sessionId: cleanId(args.result.sessionId),
    cohort: cleanId(args.cohort ?? 'private-preview-shadow'),
    ...(args.controlsDigest ? { controlsDigest: cleanDigest(args.controlsDigest) } : {}),
    kind: 'deck_repl' as const,
    status: args.result.status,
    terminalReason: cleanTerminalReason(args.result.terminalReason),
    baseSnapshotDigest: cleanDigest(args.result.snapshotDigest),
    baseDeckVersion: boundedNonNegativeInteger(args.result.baseDeckVersion),
    adapterId: cleanId(args.adapterId ?? 'nodeslide/deck-repl'),
    adapterVersion: cleanId(args.adapterVersion ?? '1.0.0'),
    egressMode: 'deny' as const,
    allowedHosts: [],
    plan,
    steps,
    guardrails: args.result.guardrails.map(cleanText).filter(Boolean).slice(0, MAX_GUARDRAILS),
    proposalDigests,
    budget: {
      maxSteps: boundedPositiveInteger(args.result.budget.maxSteps),
      maxInputBytes: boundedPositiveInteger(args.result.budget.maxInputBytes),
      maxOutputBytes: boundedPositiveInteger(args.result.budget.maxOutputBytes),
      maxOperations: boundedPositiveInteger(args.result.budget.maxOperations),
      maxWallTimeMs: boundedPositiveInteger(args.result.budget.maxWallTimeMs),
    },
    usage: {
      steps: boundedNonNegativeInteger(args.result.usage.steps),
      inputBytes: boundedNonNegativeInteger(args.result.usage.inputBytes),
      outputBytes: boundedNonNegativeInteger(args.result.usage.outputBytes),
      operations: boundedNonNegativeInteger(args.result.usage.operations),
      elapsedMs: boundedNonNegativeInteger(args.result.usage.elapsedMs),
    },
    cleanupConfirmed: true,
    createdAt,
    completedAt: createdAt,
    expiresAt: createdAt + NODESLIDE_EXECUTION_TRACE_TTL_MS,
  };
  assertExecutionTraceBounds(partial);
  return {
    ...partial,
    traceDigest: executionTraceDigest(partial),
  };
}

export function executionTraceDigest(
  trace: Omit<NodeSlideExecutionTrace, 'traceDigest'> | NodeSlideExecutionTrace,
): string {
  const entries = Object.entries(trace).filter(([key]) => key !== 'traceDigest');
  return `trace_${nodeslideContentDigest(stableSerialize(Object.fromEntries(entries)))}`;
}

export function assertExecutionTraceBounds(
  trace: Omit<NodeSlideExecutionTrace, 'traceDigest'> | NodeSlideExecutionTrace,
): void {
  if (trace.schemaVersion !== NODESLIDE_EXECUTION_TRACE_SCHEMA_VERSION) {
    throw new Error('Execution trace schema version is invalid.');
  }
  for (const value of [
    trace.id,
    trace.deckId,
    trace.actorDigest,
    trace.sessionId,
    trace.cohort,
    trace.terminalReason,
    trace.adapterId,
    trace.adapterVersion,
  ]) {
    if (!cleanId(value) || cleanId(value) !== value || value.length > 180)
      throw new Error('Execution trace identity is invalid.');
  }
  if (!isCanonicalBoundDigest(trace.actorDigest, 'actor')) {
    throw new Error('Execution trace actor digest is invalid.');
  }
  if (
    trace.controlsDigest !== undefined &&
    !isCanonicalBoundDigest(trace.controlsDigest, 'controls')
  ) {
    throw new Error('Execution trace controls digest is invalid.');
  }
  if (
    !['deck_repl', 'analysis_kernel', 'render_repair', 'storybench'].includes(trace.kind) ||
    !['completed', 'stopped'].includes(trace.status)
  ) {
    throw new Error('Execution trace classification is invalid.');
  }
  if (
    !isCanonicalBoundDigest(trace.baseSnapshotDigest, 'snap') ||
    (trace.candidateSnapshotDigest !== undefined &&
      !isCanonicalBoundDigest(trace.candidateSnapshotDigest, 'snap'))
  ) {
    throw new Error('Execution trace snapshot digest is invalid.');
  }
  if (!Number.isSafeInteger(trace.baseDeckVersion) || trace.baseDeckVersion < 0) {
    throw new Error('Execution trace deck version is invalid.');
  }
  if (!['deny', 'allowlist'].includes(trace.egressMode)) {
    throw new Error('Execution trace egress mode is invalid.');
  }
  if (trace.allowedHosts.length > 16) throw new Error('Execution trace host limit exceeded.');
  const normalizedHosts = trace.allowedHosts.map(normalizedHost);
  if (
    normalizedHosts.some((host, index) => !host || host !== trace.allowedHosts[index]) ||
    new Set(normalizedHosts).size !== normalizedHosts.length ||
    (trace.egressMode === 'deny' && normalizedHosts.length > 0) ||
    (trace.egressMode === 'allowlist' && normalizedHosts.length === 0)
  ) {
    throw new Error('Execution trace host policy is invalid.');
  }
  if (
    (trace.consentDigest !== undefined &&
      !isCanonicalBoundDigest(trace.consentDigest, 'consent')) ||
    (trace.egressMode === 'allowlist' && !trace.consentDigest)
  ) {
    throw new Error('Execution trace consent binding is invalid.');
  }
  if (trace.providerTelemetry !== undefined) {
    const provider = trace.providerTelemetry;
    if (
      !cleanId(provider.provider) ||
      cleanId(provider.provider) !== provider.provider ||
      !cleanId(provider.resolvedModel) ||
      cleanId(provider.resolvedModel) !== provider.resolvedModel
    ) {
      throw new Error('Execution trace provider identity is invalid.');
    }
    for (const value of [
      provider.inputTokens,
      provider.outputTokens,
      provider.costMicroUsd,
      provider.latencyMs,
      provider.retries,
    ]) {
      boundedNonNegativeInteger(value);
    }
    if (typeof provider.fallbackUsed !== 'boolean') {
      throw new Error('Execution trace provider fallback receipt is invalid.');
    }
  }
  if (trace.steps.length > MAX_STEP_RECEIPTS) {
    throw new Error('Execution trace step limit exceeded.');
  }
  if (trace.plan.length > MAX_PLAN_STEPS || trace.guardrails.length > MAX_GUARDRAILS) {
    throw new Error('Execution trace text-list limit exceeded.');
  }
  if (trace.proposalDigests.length > MAX_PROPOSAL_DIGESTS) {
    throw new Error('Execution trace proposal limit exceeded.');
  }
  for (const text of [...trace.plan, ...trace.guardrails]) {
    if (!cleanText(text) || cleanText(text) !== text || text.length > MAX_SUMMARY_LENGTH) {
      throw new Error('Execution trace text is invalid.');
    }
  }
  for (const digest of trace.proposalDigests) {
    if (!isCanonicalBoundDigest(digest, 'ops')) {
      throw new Error('Execution trace proposal digest is invalid.');
    }
  }
  for (const [index, step] of trace.steps.entries()) {
    if (step.index !== index || !Number.isSafeInteger(step.index)) {
      throw new Error('Execution trace step index is invalid.');
    }
    if (
      !cleanId(step.commandId) ||
      cleanId(step.commandId) !== step.commandId ||
      !cleanId(step.type) ||
      cleanId(step.type) !== step.type ||
      !isCanonicalBoundDigest(step.outputDigest, 'out') ||
      !['ok', 'error'].includes(step.status)
    ) {
      throw new Error('Execution trace step binding is invalid.');
    }
    if (cleanText(step.summary) !== step.summary || step.summary.length > MAX_SUMMARY_LENGTH) {
      throw new Error('Execution trace step summary is too long.');
    }
    boundedNonNegativeInteger(step.elapsedMs);
    boundedNonNegativeInteger(step.outputBytes);
  }
  const budgetEntries = Object.entries(trace.budget) as Array<
    [keyof typeof MAX_TRACE_BUDGET, number]
  >;
  for (const [key, value] of budgetEntries) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TRACE_BUDGET[key]) {
      throw new Error('Execution trace budget is invalid.');
    }
  }
  for (const value of Object.values(trace.usage)) boundedNonNegativeInteger(value);
  if (
    trace.usage.steps > trace.budget.maxSteps ||
    trace.usage.inputBytes > trace.budget.maxInputBytes ||
    trace.usage.outputBytes > trace.budget.maxOutputBytes ||
    trace.usage.operations > trace.budget.maxOperations ||
    trace.usage.elapsedMs > trace.budget.maxWallTimeMs ||
    trace.steps.length > trace.usage.steps
  ) {
    throw new Error('Execution trace usage exceeds its declared budget.');
  }
  if (typeof trace.cleanupConfirmed !== 'boolean') {
    throw new Error('Execution trace cleanup receipt is invalid.');
  }
  if (
    !Number.isSafeInteger(trace.createdAt) ||
    !Number.isSafeInteger(trace.completedAt) ||
    !Number.isSafeInteger(trace.expiresAt) ||
    trace.completedAt < trace.createdAt ||
    trace.expiresAt <= trace.completedAt ||
    trace.expiresAt - trace.createdAt > NODESLIDE_EXECUTION_TRACE_TTL_MS
  ) {
    throw new Error('Execution trace lifecycle is invalid.');
  }
  if (
    'traceDigest' in trace &&
    (!isCanonicalBoundDigest(trace.traceDigest, 'trace') ||
      trace.traceDigest !== executionTraceDigest(trace))
  ) {
    throw new Error('Execution trace digest is invalid.');
  }
  if (byteLength(stableSerialize(trace)) > MAX_TRACE_BYTES) {
    throw new Error('Execution trace byte limit exceeded.');
  }
}

export function executionTraceRetentionPlan(
  rows: readonly Pick<NodeSlideExecutionTrace, 'id' | 'createdAt' | 'expiresAt'>[],
  now: number,
): string[] {
  const expired = rows
    .filter((row) => row.expiresAt <= now)
    .sort((left, right) => left.expiresAt - right.expiresAt || left.id.localeCompare(right.id));
  const active = rows
    .filter((row) => row.expiresAt > now)
    .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
  const overLimit = active.slice(NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK);
  return [...new Set([...expired, ...overLimit].map((row) => row.id))];
}

function cleanTerminalReason(value: NodeSlideDeckReplTerminalReason): string {
  return cleanId(value) || 'invalid_request';
}

function cleanText(value: string): string {
  return stripControlCharacters(value)
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SUMMARY_LENGTH);
}

function cleanId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^A-Za-z0-9._:/+ -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function cleanDigest(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 180);
}

function isCanonicalBoundDigest(value: unknown, prefix: string): value is string {
  if (typeof value !== 'string') return false;
  const marker = `${prefix}_sha256:`;
  return value.startsWith(marker) && /^[0-9a-f]{64}$/.test(value.slice(marker.length));
}

function normalizedHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return '';
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    return '';
  return host;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('Execution trace time is invalid.');
  return value;
}

function boundedPositiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('Execution trace budget is invalid.');
  return value;
}

function boundedNonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Execution trace usage is invalid.');
  return value;
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
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
