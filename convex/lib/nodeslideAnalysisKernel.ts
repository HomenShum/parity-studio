import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_ANALYSIS_KERNEL_SCHEMA_VERSION = 'nodeslide.analysis-kernel/v1' as const;

export const NODESLIDE_ANALYSIS_KERNEL_HARD_LIMITS = Object.freeze({
  maxWallTimeMs: 60_000,
  maxSteps: 100,
  maxInputBytes: 2_000_000,
  maxOutputBytes: 1_000_000,
  maxArtifactBytes: 5_000_000,
  memoryMb: 4_096,
});

export type NodeSlideAnalysisJob =
  | {
      type: 'summarize_table';
      columns: string[];
      rows: Array<Record<string, string | number | boolean | null>>;
    }
  | {
      type: 'derive_series';
      operation: 'delta' | 'cumulative' | 'percent_change';
      values: number[];
    }
  | {
      type: 'validate_chart';
      labels: string[];
      series: Array<{ name: string; values: number[] }>;
    };

export interface NodeSlideKernelBudget {
  maxWallTimeMs: number;
  maxSteps: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxArtifactBytes: number;
  memoryMb: number;
}

export type NodeSlideKernelNetworkPolicy =
  | { mode: 'deny' }
  | { mode: 'allowlist'; consentId: string; allowedHosts: string[] };

export interface NodeSlideKernelCapabilities {
  jobTypes: NodeSlideAnalysisJob['type'][];
  deterministic: boolean;
  hostedBy: 'nodeslide' | 'provider';
  network: boolean;
  maxMemoryMb: number;
}

export interface NodeSlideKernelRequest {
  sessionId: string;
  traceId: string;
  job: NodeSlideAnalysisJob;
  inputDigest?: string;
  network?: NodeSlideKernelNetworkPolicy;
  budget?: Partial<NodeSlideKernelBudget>;
}

export interface NodeSlideKernelSession {
  /** Opaque adapter metadata, never a canonical NodeSlide identifier. */
  opaqueSessionId: string;
}

export interface NodeSlideKernelArtifactInput {
  name: string;
  mimeType: string;
  content: string;
}

export interface NodeSlideKernelExecution {
  output: unknown;
  steps: number;
  artifacts?: NodeSlideKernelArtifactInput[];
  telemetry?: Record<string, unknown>;
}

export interface NodeSlideAnalysisKernelAdapter {
  id: string;
  version: string;
  capabilities: NodeSlideKernelCapabilities;
  open(request: Readonly<NodeSlideKernelRequest>): NodeSlideKernelSession;
  execute(
    session: Readonly<NodeSlideKernelSession>,
    job: Readonly<NodeSlideAnalysisJob>,
  ): NodeSlideKernelExecution;
  cancel(session: Readonly<NodeSlideKernelSession>, reason: string): void;
  cleanup(session: Readonly<NodeSlideKernelSession>): void;
}

export interface NodeSlideKernelArtifactReceipt {
  name: string;
  mimeType: string;
  sizeBytes: number;
  digest: string;
}

export type NodeSlideKernelTerminalReason =
  | 'completed'
  | 'invalid_request'
  | 'unsupported_job'
  | 'input_digest_mismatch'
  | 'input_budget_exhausted'
  | 'output_budget_exhausted'
  | 'artifact_budget_exhausted'
  | 'step_budget_exhausted'
  | 'wall_time_exhausted'
  | 'cancelled'
  | 'adapter_failed'
  | 'cleanup_failed';

export interface NodeSlideKernelLifecycleReceipt {
  state: 'requested' | 'opened' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cleaned';
  elapsedMs: number;
  summary: string;
}

export interface NodeSlideKernelResult {
  schemaVersion: typeof NODESLIDE_ANALYSIS_KERNEL_SCHEMA_VERSION;
  sessionId: string;
  traceId: string;
  adapterId: string;
  adapterVersion: string;
  inputDigest: string;
  outputDigest?: string;
  status: 'completed' | 'stopped';
  terminalReason: NodeSlideKernelTerminalReason;
  output?: unknown;
  artifacts: NodeSlideKernelArtifactReceipt[];
  lifecycle: NodeSlideKernelLifecycleReceipt[];
  usage: {
    elapsedMs: number;
    steps: number;
    inputBytes: number;
    outputBytes: number;
    artifactBytes: number;
    memoryMb: number;
  };
  network: { mode: 'deny' | 'allowlist'; allowedHosts: string[]; consentRecorded: boolean };
  telemetry: Record<string, unknown>;
  cleanupConfirmed: boolean;
}

const DEFAULT_BUDGET: NodeSlideKernelBudget = {
  maxWallTimeMs: 15_000,
  maxSteps: 25,
  maxInputBytes: 512_000,
  maxOutputBytes: 256_000,
  maxArtifactBytes: 1_000_000,
  memoryMb: 1_024,
};

export function runNodeSlideAnalysisKernel(args: {
  adapter: NodeSlideAnalysisKernelAdapter;
  request: NodeSlideKernelRequest;
  isCancelled?: () => boolean;
  now?: () => number;
}): NodeSlideKernelResult {
  const now = args.now ?? Date.now;
  const startedAt = finiteClock(now());
  const request = structuredClone(args.request);
  const adapterId = cleanId(args.adapter.id);
  const adapterVersion = cleanId(args.adapter.version);
  const sessionId = cleanId(request.sessionId);
  const traceId = cleanId(request.traceId);
  const budget = resolveBudget(request.budget);
  const network = normalizeNetworkPolicy(request.network);
  const inputDigest = `input_${nodeslideContentDigest(stableSerialize(request.job))}`;
  const inputBytes = byteLength(request.job);
  const lifecycle: NodeSlideKernelLifecycleReceipt[] = [
    { state: 'requested', elapsedMs: 0, summary: 'Bounded analysis session requested.' },
  ];
  let session: NodeSlideKernelSession | undefined;
  let cleanupConfirmed = false;
  let output: unknown;
  let outputDigest: string | undefined;
  let outputBytes = 0;
  let steps = 0;
  let artifactBytes = 0;
  let artifacts: NodeSlideKernelArtifactReceipt[] = [];
  let telemetry: Record<string, unknown> = {};
  let terminalReason: NodeSlideKernelTerminalReason = 'invalid_request';

  const elapsed = (): number => Math.max(0, finiteClock(now()) - startedAt);
  const finish = (): NodeSlideKernelResult => ({
    schemaVersion: NODESLIDE_ANALYSIS_KERNEL_SCHEMA_VERSION,
    sessionId,
    traceId,
    adapterId,
    adapterVersion,
    inputDigest,
    ...(outputDigest ? { outputDigest } : {}),
    status: terminalReason === 'completed' ? 'completed' : 'stopped',
    terminalReason,
    ...(output !== undefined ? { output } : {}),
    artifacts,
    lifecycle,
    usage: {
      elapsedMs: elapsed(),
      steps,
      inputBytes,
      outputBytes,
      artifactBytes,
      memoryMb: budget?.memoryMb ?? 0,
    },
    network: network.receipt,
    telemetry,
    cleanupConfirmed,
  });

  if (
    !adapterId ||
    !adapterVersion ||
    !sessionId ||
    !traceId ||
    !budget ||
    !network.ok ||
    !isJobShape(request.job)
  ) {
    lifecycle.push({ state: 'failed', elapsedMs: elapsed(), summary: 'Kernel request rejected.' });
    return finish();
  }
  if (!args.adapter.capabilities.jobTypes.includes(request.job.type)) {
    terminalReason = 'unsupported_job';
    lifecycle.push({ state: 'failed', elapsedMs: elapsed(), summary: 'Job type is unsupported.' });
    return finish();
  }
  if (budget.memoryMb > args.adapter.capabilities.maxMemoryMb) {
    lifecycle.push({
      state: 'failed',
      elapsedMs: elapsed(),
      summary: 'Requested memory exceeds adapter capability.',
    });
    return finish();
  }
  if (network.receipt.mode === 'allowlist' && !args.adapter.capabilities.network) {
    lifecycle.push({
      state: 'failed',
      elapsedMs: elapsed(),
      summary: 'Adapter does not permit network access.',
    });
    return finish();
  }
  if (request.inputDigest !== undefined && cleanDigest(request.inputDigest) !== inputDigest) {
    terminalReason = 'input_digest_mismatch';
    lifecycle.push({ state: 'failed', elapsedMs: elapsed(), summary: 'Input digest mismatch.' });
    return finish();
  }
  if (inputBytes > budget.maxInputBytes) {
    terminalReason = 'input_budget_exhausted';
    lifecycle.push({ state: 'failed', elapsedMs: elapsed(), summary: 'Input budget exhausted.' });
    return finish();
  }
  if (args.isCancelled?.()) {
    terminalReason = 'cancelled';
    lifecycle.push({
      state: 'cancelled',
      elapsedMs: elapsed(),
      summary: 'Session cancelled before open.',
    });
    return finish();
  }

  try {
    session = sanitizeSession(args.adapter.open(request));
    lifecycle.push({
      state: 'opened',
      elapsedMs: elapsed(),
      summary: 'Ephemeral adapter session opened.',
    });
    if (elapsed() > budget.maxWallTimeMs) {
      terminalReason = 'wall_time_exhausted';
      args.adapter.cancel(session, terminalReason);
      lifecycle.push({
        state: 'cancelled',
        elapsedMs: elapsed(),
        summary: 'Wall-time budget exhausted.',
      });
    } else if (args.isCancelled?.()) {
      terminalReason = 'cancelled';
      args.adapter.cancel(session, terminalReason);
      lifecycle.push({
        state: 'cancelled',
        elapsedMs: elapsed(),
        summary: 'Session cancelled before execution.',
      });
    } else {
      lifecycle.push({
        state: 'running',
        elapsedMs: elapsed(),
        summary: 'Bounded typed job executing.',
      });
      const execution = args.adapter.execute(session, request.job);
      steps = safeNonNegativeInteger(execution.steps);
      if (steps > budget.maxSteps) {
        terminalReason = 'step_budget_exhausted';
        args.adapter.cancel(session, terminalReason);
        lifecycle.push({
          state: 'cancelled',
          elapsedMs: elapsed(),
          summary: 'Step budget exhausted.',
        });
      } else if (args.isCancelled?.()) {
        terminalReason = 'cancelled';
        args.adapter.cancel(session, terminalReason);
        lifecycle.push({
          state: 'cancelled',
          elapsedMs: elapsed(),
          summary: 'Session cancelled after execution.',
        });
      } else if (elapsed() > budget.maxWallTimeMs) {
        terminalReason = 'wall_time_exhausted';
        args.adapter.cancel(session, terminalReason);
        lifecycle.push({
          state: 'cancelled',
          elapsedMs: elapsed(),
          summary: 'Wall-time budget exhausted.',
        });
      } else {
        output = sanitizeValue(execution.output);
        outputBytes = byteLength(output);
        if (outputBytes > budget.maxOutputBytes) {
          output = undefined;
          outputBytes = 0;
          terminalReason = 'output_budget_exhausted';
          lifecycle.push({
            state: 'failed',
            elapsedMs: elapsed(),
            summary: 'Output budget exhausted.',
          });
        } else {
          const artifactResult = artifactReceipts(execution.artifacts ?? []);
          artifacts = artifactResult.receipts;
          artifactBytes = artifactResult.bytes;
          if (artifactBytes > budget.maxArtifactBytes) {
            artifacts = [];
            artifactBytes = 0;
            terminalReason = 'artifact_budget_exhausted';
            lifecycle.push({
              state: 'failed',
              elapsedMs: elapsed(),
              summary: 'Artifact budget exhausted.',
            });
          } else {
            telemetry = sanitizeTelemetry(execution.telemetry ?? {});
            outputDigest = `output_${nodeslideContentDigest(stableSerialize({ output, artifacts }))}`;
            terminalReason = 'completed';
            lifecycle.push({
              state: 'completed',
              elapsedMs: elapsed(),
              summary: 'Typed analysis completed.',
            });
          }
        }
      }
    }
  } catch (error) {
    terminalReason = 'adapter_failed';
    telemetry = { error: sanitizeError(error) };
    lifecycle.push({ state: 'failed', elapsedMs: elapsed(), summary: 'Adapter execution failed.' });
  } finally {
    if (session) {
      try {
        args.adapter.cleanup(session);
        cleanupConfirmed = true;
        lifecycle.push({
          state: 'cleaned',
          elapsedMs: elapsed(),
          summary: 'Ephemeral session cleaned.',
        });
      } catch (error) {
        cleanupConfirmed = false;
        telemetry = { ...telemetry, cleanupError: sanitizeError(error) };
        terminalReason = 'cleanup_failed';
        lifecycle.push({
          state: 'failed',
          elapsedMs: elapsed(),
          summary: 'Session cleanup failed.',
        });
      }
    }
  }

  return finish();
}

export function createDeterministicNodeSlideKernel(): NodeSlideAnalysisKernelAdapter {
  return {
    id: 'nodeslide/deterministic-analysis',
    version: '1.0.0',
    capabilities: {
      jobTypes: ['summarize_table', 'derive_series', 'validate_chart'],
      deterministic: true,
      hostedBy: 'nodeslide',
      network: false,
      maxMemoryMb: 1_024,
    },
    open(request) {
      return {
        opaqueSessionId: `local_${nodeslideContentDigest(`${request.sessionId}:${request.traceId}`)}`,
      };
    },
    execute(_session, job) {
      if (job.type === 'summarize_table') return summarizeTable(job);
      if (job.type === 'derive_series') return deriveSeries(job);
      if (job.type === 'validate_chart') return validateChart(job);
      throw new Error('Unsupported deterministic analysis job.');
    },
    cancel() {
      // Synchronous deterministic jobs have no retained process to terminate.
    },
    cleanup() {
      // The reference adapter is stateless; this confirms lifecycle closure.
    },
  };
}

export function runNodeSlideKernelConformance(adapter: NodeSlideAnalysisKernelAdapter): {
  passed: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
} {
  const jobs: Array<{ id: string; job: NodeSlideAnalysisJob }> = [
    {
      id: 'summarize',
      job: { type: 'summarize_table', columns: ['value'], rows: [{ value: 1 }, { value: 3 }] },
    },
    { id: 'derive', job: { type: 'derive_series', operation: 'delta', values: [1, 4, 9] } },
    {
      id: 'chart',
      job: {
        type: 'validate_chart',
        labels: ['A', 'B'],
        series: [{ name: 'Value', values: [1, 2] }],
      },
    },
  ];
  const checks = jobs.map(({ id, job }) => {
    if (!adapter.capabilities.jobTypes.includes(job.type)) {
      return { id, passed: true, detail: 'Capability intentionally unsupported.' };
    }
    const result = runNodeSlideAnalysisKernel({
      adapter,
      request: { sessionId: `conformance-${id}`, traceId: 'conformance', job },
      now: () => 1_700_000_000_000,
    });
    return {
      id,
      passed: result.terminalReason === 'completed' && result.cleanupConfirmed,
      detail: `${result.terminalReason}; cleanup=${result.cleanupConfirmed}`,
    };
  });
  checks.push({
    id: 'default-no-egress',
    passed: adapter.capabilities.network === false || adapter.capabilities.hostedBy === 'provider',
    detail: 'Network use requires an explicit allowlist policy and consent at execution time.',
  });
  return { passed: checks.every((check) => check.passed), checks };
}

function summarizeTable(
  job: Extract<NodeSlideAnalysisJob, { type: 'summarize_table' }>,
): NodeSlideKernelExecution {
  const columns = [...new Set(job.columns.map(cleanId).filter(Boolean))].sort();
  const summary = Object.fromEntries(
    columns.map((column) => {
      const values = job.rows
        .map((row) => row[column])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const total = values.reduce((sum, value) => sum + value, 0);
      return [
        column,
        {
          numericCount: values.length,
          missingCount: job.rows.length - values.length,
          min: values.length > 0 ? Math.min(...values) : null,
          max: values.length > 0 ? Math.max(...values) : null,
          mean: values.length > 0 ? roundNumber(total / values.length) : null,
        },
      ];
    }),
  );
  return {
    output: { rowCount: job.rows.length, columns: summary },
    steps: job.rows.length + columns.length,
  };
}

function deriveSeries(
  job: Extract<NodeSlideAnalysisJob, { type: 'derive_series' }>,
): NodeSlideKernelExecution {
  const values = job.values.map((value) => finiteNumber(value));
  let derived: Array<number | null>;
  if (job.operation === 'delta') {
    derived = values.map((value, index) =>
      index === 0 ? 0 : roundNumber(value - (values[index - 1] ?? 0)),
    );
  } else if (job.operation === 'cumulative') {
    let total = 0;
    derived = values.map((value) => {
      total += value;
      return roundNumber(total);
    });
  } else {
    derived = values.map((value, index) => {
      if (index === 0) return null;
      const previous = values[index - 1] ?? 0;
      return previous === 0 ? null : roundNumber(((value - previous) / Math.abs(previous)) * 100);
    });
  }
  return { output: { operation: job.operation, values: derived }, steps: values.length };
}

function validateChart(
  job: Extract<NodeSlideAnalysisJob, { type: 'validate_chart' }>,
): NodeSlideKernelExecution {
  const issues: string[] = [];
  if (job.labels.length === 0) issues.push('labels_empty');
  if (job.series.length === 0) issues.push('series_empty');
  for (const series of job.series) {
    if (!cleanId(series.name)) issues.push('series_name_missing');
    if (series.values.length !== job.labels.length)
      issues.push(`series_length_mismatch:${cleanId(series.name)}`);
    if (series.values.some((value) => !Number.isFinite(value)))
      issues.push(`series_value_non_finite:${cleanId(series.name)}`);
  }
  return {
    output: {
      valid: issues.length === 0,
      labelCount: job.labels.length,
      seriesCount: job.series.length,
      issues,
    },
    steps: job.labels.length + job.series.reduce((sum, series) => sum + series.values.length, 0),
  };
}

function normalizeNetworkPolicy(policy: NodeSlideKernelNetworkPolicy | undefined): {
  ok: boolean;
  receipt: NodeSlideKernelResult['network'];
} {
  if (!policy || policy.mode === 'deny') {
    return { ok: true, receipt: { mode: 'deny', allowedHosts: [], consentRecorded: false } };
  }
  const consentId = cleanId(policy.consentId);
  const hosts = [...new Set(policy.allowedHosts.map(normalizeHost).filter(Boolean))].sort();
  const allValid =
    consentId.length > 0 &&
    hosts.length > 0 &&
    hosts.length <= 16 &&
    policy.allowedHosts.length === hosts.length;
  return {
    ok: allValid,
    receipt: { mode: 'allowlist', allowedHosts: hosts, consentRecorded: Boolean(consentId) },
  };
}

function normalizeHost(value: string): string {
  const clean = value.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(clean)) return '';
  if (
    clean === 'localhost' ||
    clean.endsWith('.localhost') ||
    clean.endsWith('.local') ||
    clean.endsWith('.internal')
  ) {
    return '';
  }
  return clean;
}

function resolveBudget(
  requested: Partial<NodeSlideKernelBudget> | undefined,
): NodeSlideKernelBudget | null {
  const budget = { ...DEFAULT_BUDGET, ...requested };
  const keys = Object.keys(
    NODESLIDE_ANALYSIS_KERNEL_HARD_LIMITS,
  ) as (keyof NodeSlideKernelBudget)[];
  for (const key of keys) {
    const value = budget[key];
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > NODESLIDE_ANALYSIS_KERNEL_HARD_LIMITS[key]
    ) {
      return null;
    }
  }
  return budget;
}

function artifactReceipts(artifacts: readonly NodeSlideKernelArtifactInput[]): {
  receipts: NodeSlideKernelArtifactReceipt[];
  bytes: number;
} {
  const receipts = artifacts.slice(0, 32).map((artifact) => {
    const content = typeof artifact.content === 'string' ? artifact.content : '';
    const sizeBytes = byteLength(content);
    return {
      name: cleanFileName(artifact.name),
      mimeType: cleanMimeType(artifact.mimeType),
      sizeBytes,
      digest: `artifact_${nodeslideContentDigest(content)}`,
    };
  });
  return { receipts, bytes: receipts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0) };
}

function sanitizeSession(session: NodeSlideKernelSession): NodeSlideKernelSession {
  const opaqueSessionId = cleanId(session?.opaqueSessionId);
  if (!opaqueSessionId) throw new Error('Adapter returned an invalid session.');
  return { opaqueSessionId };
}

function isJobShape(job: unknown): job is NodeSlideAnalysisJob {
  if (!isRecord(job) || typeof job['type'] !== 'string') return false;
  if (job['type'] === 'summarize_table')
    return Array.isArray(job['columns']) && Array.isArray(job['rows']);
  if (job['type'] === 'derive_series')
    return (
      Array.isArray(job['values']) &&
      ['delta', 'cumulative', 'percent_change'].includes(String(job['operation']))
    );
  if (job['type'] === 'validate_chart')
    return Array.isArray(job['labels']) && Array.isArray(job['series']);
  return false;
}

function sanitizeTelemetry(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(value) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return redact(value).slice(0, 1_000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value))
    return value.slice(0, 10_000).map((item) => sanitizeValue(item, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 1_000)
        .map(([key, item]) => [cleanId(key), sanitizeValue(item, depth + 1)]),
    );
  }
  return undefined;
}

function sanitizeError(error: unknown): string {
  return redact(error instanceof Error ? error.message : 'Adapter failed.').slice(0, 500);
}

function redact(value: string): string {
  return stripControlCharacters(value)
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (isRecord(value)) {
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

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(typeof value === 'string' ? value : stableSerialize(value))
      .byteLength;
  } catch {
    return Number.MAX_SAFE_INTEGER;
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

function cleanDigest(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 180);
}

function cleanFileName(value: unknown): string {
  const clean = cleanId(value)
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 180);
  return clean || 'artifact.bin';
}

function cleanMimeType(value: unknown): string {
  if (typeof value !== 'string') return 'application/octet-stream';
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9.+\-/]/g, '')
    .slice(0, 100);
  return clean.includes('/') ? clean : 'application/octet-stream';
}

function safeNonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : Number.MAX_SAFE_INTEGER;
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteClock(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function roundNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
