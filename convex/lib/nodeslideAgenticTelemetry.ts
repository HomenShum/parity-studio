import {
  type NodeSlideExecutionTrace,
  assertExecutionTraceBounds,
} from './nodeslideExecutionTrace';
import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_AGENTIC_TELEMETRY_SCHEMA_VERSION = 'nodeslide.agentic-telemetry/v1' as const;

const MAX_TELEMETRY_TRACES = 1_000;
const ELAPSED_BUCKETS = [100, 500, 1_000, 5_000, 30_000, 120_000] as const;

interface UsageTotals {
  steps: number;
  inputBytes: number;
  outputBytes: number;
  operations: number;
  elapsedMs: number;
}

interface ProviderTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  latencyMs: number;
  retries: number;
  fallbacks: number;
  resolvedModels: Record<string, number>;
}

export interface NodeSlideAgenticTelemetryGroup {
  cohort: string;
  adapterId: string;
  adapterVersion: string;
  kind: NodeSlideExecutionTrace['kind'];
  requests: number;
  completed: number;
  stopped: number;
  cleanupFailures: number;
  egressSessions: number;
  terminalReasons: Record<string, number>;
  usage: UsageTotals;
  elapsedHistogram: Record<string, number>;
  provider: ProviderTotals;
}

export interface NodeSlideAgenticTelemetrySummary {
  schemaVersion: typeof NODESLIDE_AGENTIC_TELEMETRY_SCHEMA_VERSION;
  sampleSize: number;
  window: { firstCreatedAt: number | null; lastCreatedAt: number | null };
  totals: {
    requests: number;
    completed: number;
    stopped: number;
    cleanupFailures: number;
    egressSessions: number;
    usage: UsageTotals;
    provider: Omit<ProviderTotals, 'resolvedModels'>;
  };
  groups: NodeSlideAgenticTelemetryGroup[];
  summaryDigest: string;
}

export function summarizeNodeSlideExecutionTraces(
  traces: readonly NodeSlideExecutionTrace[],
): NodeSlideAgenticTelemetrySummary {
  if (traces.length > MAX_TELEMETRY_TRACES) {
    throw new Error(`Telemetry accepts at most ${MAX_TELEMETRY_TRACES} traces.`);
  }
  for (const trace of traces) assertExecutionTraceBounds(trace);
  const ordered = [...traces].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  const groups = new Map<string, NodeSlideAgenticTelemetryGroup>();
  for (const trace of ordered) {
    const key = `${trace.cohort}\u0000${trace.adapterId}\u0000${trace.adapterVersion}\u0000${trace.kind}`;
    const group = groups.get(key) ?? emptyGroup(trace);
    group.requests += 1;
    group[trace.status] += 1;
    if (!trace.cleanupConfirmed) group.cleanupFailures += 1;
    if (trace.egressMode === 'allowlist') group.egressSessions += 1;
    group.terminalReasons[trace.terminalReason] =
      (group.terminalReasons[trace.terminalReason] ?? 0) + 1;
    addUsage(group.usage, trace.usage);
    const elapsedBucket = bucketLabel(trace.usage.elapsedMs);
    group.elapsedHistogram[elapsedBucket] = (group.elapsedHistogram[elapsedBucket] ?? 0) + 1;
    if (trace.providerTelemetry) addProvider(group.provider, trace.providerTelemetry);
    groups.set(key, group);
  }

  const grouped = [...groups.values()]
    .map(normalizeGroup)
    .sort((left, right) =>
      `${left.cohort}:${left.adapterId}:${left.adapterVersion}:${left.kind}`.localeCompare(
        `${right.cohort}:${right.adapterId}:${right.adapterVersion}:${right.kind}`,
      ),
    );
  const totals = {
    requests: sum(grouped, 'requests'),
    completed: sum(grouped, 'completed'),
    stopped: sum(grouped, 'stopped'),
    cleanupFailures: sum(grouped, 'cleanupFailures'),
    egressSessions: sum(grouped, 'egressSessions'),
    usage: grouped.reduce((total, group) => addUsage(total, group.usage), emptyUsage()),
    provider: grouped.reduce((total, group) => {
      total.requests += group.provider.requests;
      total.inputTokens += group.provider.inputTokens;
      total.outputTokens += group.provider.outputTokens;
      total.costMicroUsd += group.provider.costMicroUsd;
      total.latencyMs += group.provider.latencyMs;
      total.retries += group.provider.retries;
      total.fallbacks += group.provider.fallbacks;
      return total;
    }, emptyProviderTotals()),
  };
  const partial = {
    schemaVersion: NODESLIDE_AGENTIC_TELEMETRY_SCHEMA_VERSION,
    sampleSize: ordered.length,
    window: {
      firstCreatedAt: ordered[0]?.createdAt ?? null,
      lastCreatedAt: ordered.at(-1)?.createdAt ?? null,
    },
    totals,
    groups: grouped,
  };
  return {
    ...partial,
    summaryDigest: `telemetry_${nodeslideContentDigest(stableSerialize(partial))}`,
  };
}

function emptyGroup(trace: NodeSlideExecutionTrace): NodeSlideAgenticTelemetryGroup {
  return {
    cohort: trace.cohort,
    adapterId: trace.adapterId,
    adapterVersion: trace.adapterVersion,
    kind: trace.kind,
    requests: 0,
    completed: 0,
    stopped: 0,
    cleanupFailures: 0,
    egressSessions: 0,
    terminalReasons: {},
    usage: emptyUsage(),
    elapsedHistogram: {},
    provider: { ...emptyProviderTotals(), resolvedModels: {} },
  };
}

function emptyUsage(): UsageTotals {
  return { steps: 0, inputBytes: 0, outputBytes: 0, operations: 0, elapsedMs: 0 };
}

function emptyProviderTotals(): Omit<ProviderTotals, 'resolvedModels'> {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    costMicroUsd: 0,
    latencyMs: 0,
    retries: 0,
    fallbacks: 0,
  };
}

function addUsage(target: UsageTotals, value: UsageTotals): UsageTotals {
  target.steps += value.steps;
  target.inputBytes += value.inputBytes;
  target.outputBytes += value.outputBytes;
  target.operations += value.operations;
  target.elapsedMs += value.elapsedMs;
  return target;
}

function addProvider(
  target: ProviderTotals,
  value: NonNullable<NodeSlideExecutionTrace['providerTelemetry']>,
): void {
  target.requests += 1;
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.costMicroUsd += value.costMicroUsd;
  target.latencyMs += value.latencyMs;
  target.retries += value.retries;
  if (value.fallbackUsed) target.fallbacks += 1;
  target.resolvedModels[value.resolvedModel] =
    (target.resolvedModels[value.resolvedModel] ?? 0) + 1;
}

function normalizeGroup(group: NodeSlideAgenticTelemetryGroup): NodeSlideAgenticTelemetryGroup {
  return {
    ...group,
    terminalReasons: sortedRecord(group.terminalReasons),
    elapsedHistogram: sortedRecord(group.elapsedHistogram),
    provider: {
      ...group.provider,
      resolvedModels: sortedRecord(group.provider.resolvedModels),
    },
  };
}

function bucketLabel(value: number): string {
  const upper = ELAPSED_BUCKETS.find((candidate) => value <= candidate);
  return upper === undefined ? 'gt_120000' : `lte_${upper}`;
}

function sum(
  groups: readonly NodeSlideAgenticTelemetryGroup[],
  key: 'requests' | 'completed' | 'stopped' | 'cleanupFailures' | 'egressSessions',
): number {
  return groups.reduce((total, group) => total + group[key], 0);
}

function sortedRecord(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}
