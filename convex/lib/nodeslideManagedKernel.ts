import {
  type NodeSlideAgenticControls,
  authorizeNodeSlideAgenticOperation,
} from './nodeslideAgenticControls';
import {
  NODESLIDE_ANALYSIS_KERNEL_HARD_LIMITS,
  NODESLIDE_ANALYSIS_KERNEL_SCHEMA_VERSION,
  type NodeSlideAnalysisJob,
  type NodeSlideKernelArtifactInput,
  type NodeSlideKernelBudget,
  type NodeSlideKernelCapabilities,
  type NodeSlideKernelLifecycleReceipt,
  type NodeSlideKernelRequest,
  type NodeSlideKernelResult,
  type NodeSlideKernelSession,
  type NodeSlideKernelTerminalReason,
} from './nodeslideAnalysisKernel';
import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_MANAGED_KERNEL_SCHEMA_VERSION =
  'nodeslide.managed-kernel-adapter/v1' as const;

const DEFAULT_BUDGET: NodeSlideKernelBudget = {
  maxWallTimeMs: 15_000,
  maxSteps: 25,
  maxInputBytes: 512_000,
  maxOutputBytes: 256_000,
  maxArtifactBytes: 1_000_000,
  memoryMb: 1_024,
};

export interface NodeSlideManagedKernelProviderTelemetry {
  provider: string;
  resolvedModel: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  latencyMs: number;
  retries: number;
  fallbackUsed: boolean;
}

export interface NodeSlideManagedKernelExecution {
  output: unknown;
  steps: number;
  artifacts?: NodeSlideKernelArtifactInput[];
  telemetry?: NodeSlideManagedKernelProviderTelemetry;
}

export interface NodeSlideManagedKernelTransport {
  open(args: {
    sessionId: string;
    traceId: string;
    job: NodeSlideAnalysisJob;
    budget: NodeSlideKernelBudget;
    network: { mode: 'deny' | 'allowlist'; allowedHosts: string[]; consentId?: string };
    signal: AbortSignal;
  }): Promise<NodeSlideKernelSession>;
  execute(
    session: Readonly<NodeSlideKernelSession>,
    job: Readonly<NodeSlideAnalysisJob>,
    options: { signal: AbortSignal },
  ): Promise<NodeSlideManagedKernelExecution>;
  cancel(session: Readonly<NodeSlideKernelSession>, reason: string): Promise<void>;
  cleanup(session: Readonly<NodeSlideKernelSession>): Promise<void>;
}

export interface NodeSlideManagedKernelAdapter {
  schemaVersion: typeof NODESLIDE_MANAGED_KERNEL_SCHEMA_VERSION;
  id: string;
  version: string;
  providerId: string;
  model: string;
  capabilities: NodeSlideKernelCapabilities;
  transport: NodeSlideManagedKernelTransport;
}

export function createProviderManagedNodeSlideKernelAdapter(args: {
  id: string;
  version: string;
  providerId: string;
  model: string;
  jobTypes: NodeSlideAnalysisJob['type'][];
  network: boolean;
  maxMemoryMb: number;
  transport: NodeSlideManagedKernelTransport;
}): NodeSlideManagedKernelAdapter {
  const id = cleanId(args.id);
  const version = cleanId(args.version);
  const providerId = cleanId(args.providerId);
  const model = cleanId(args.model);
  if (!id || !version || !providerId || !model) {
    throw new Error('Managed kernel adapter identity is invalid.');
  }
  if (!Number.isSafeInteger(args.maxMemoryMb) || args.maxMemoryMb <= 0) {
    throw new Error('Managed kernel memory capability is invalid.');
  }
  const jobTypes = [...new Set(args.jobTypes)].filter(isJobType).sort();
  if (jobTypes.length === 0) throw new Error('Managed kernel must support a typed analysis job.');
  return {
    schemaVersion: NODESLIDE_MANAGED_KERNEL_SCHEMA_VERSION,
    id,
    version,
    providerId,
    model,
    capabilities: {
      jobTypes,
      deterministic: false,
      hostedBy: 'provider',
      network: args.network,
      maxMemoryMb: Math.min(args.maxMemoryMb, NODESLIDE_ANALYSIS_KERNEL_HARD_LIMITS.memoryMb),
    },
    transport: args.transport,
  };
}

/**
 * Named adapter seam for the Responses API Code Interpreter tool. The injected
 * transport owns the provider SDK/API call and credentials; NodeSlide retains
 * policy, budget, lifecycle, cleanup, and trace authority. Code Interpreter is
 * declared no-egress here and cannot be promoted by changing a request alone.
 */
export function createOpenAiCodeInterpreterKernelAdapter(args: {
  transport: NodeSlideManagedKernelTransport;
  model: string;
  version?: string;
}): NodeSlideManagedKernelAdapter {
  return createProviderManagedNodeSlideKernelAdapter({
    id: 'openai/code-interpreter',
    version: args.version ?? '1.0.0',
    providerId: 'openai',
    model: args.model,
    jobTypes: ['summarize_table', 'derive_series', 'validate_chart'],
    network: false,
    maxMemoryMb: 4_096,
    transport: args.transport,
  });
}

export async function runNodeSlideManagedKernel(args: {
  adapter: NodeSlideManagedKernelAdapter;
  request: NodeSlideKernelRequest;
  controls: NodeSlideAgenticControls;
  isCancelled?: () => boolean;
  now?: () => number;
}): Promise<NodeSlideKernelResult> {
  const now = args.now ?? Date.now;
  const startedAt = finiteClock(now());
  const request = structuredClone(args.request);
  const budget = resolveBudget(request.budget);
  const network = normalizeNetwork(request, args.adapter, args.controls);
  const sessionId = cleanId(request.sessionId);
  const traceId = cleanId(request.traceId);
  const adapterId = cleanId(args.adapter.id);
  const adapterVersion = cleanId(args.adapter.version);
  const inputDigest = `input_${nodeslideContentDigest(stableSerialize(request.job))}`;
  const inputBytes = byteLength(request.job);
  const lifecycle: NodeSlideKernelLifecycleReceipt[] = [
    { state: 'requested', elapsedMs: 0, summary: 'Bounded managed analysis requested.' },
  ];
  let session: NodeSlideKernelSession | undefined;
  let output: unknown;
  let outputDigest: string | undefined;
  let outputBytes = 0;
  let steps = 0;
  let artifactBytes = 0;
  let artifacts: NodeSlideKernelResult['artifacts'] = [];
  let telemetry: Record<string, unknown> = {};
  let cleanupConfirmed = false;
  let terminalReason: NodeSlideKernelTerminalReason = 'invalid_request';
  const elapsed = () => Math.max(0, finiteClock(now()) - startedAt);
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

  const kernelAuthorization = authorizeNodeSlideAgenticOperation(args.controls, {
    operation: 'analysis_kernel',
    kernelId: adapterId,
  });
  if (
    !kernelAuthorization.allowed ||
    !sessionId ||
    !traceId ||
    !adapterId ||
    !adapterVersion ||
    !budget ||
    !network.ok ||
    !isJobShape(request.job) ||
    !args.adapter.capabilities.jobTypes.includes(request.job.type) ||
    budget.memoryMb > args.adapter.capabilities.maxMemoryMb ||
    inputBytes > budget.maxInputBytes
  ) {
    lifecycle.push({ state: 'failed', elapsedMs: elapsed(), summary: 'Managed request rejected.' });
    return finish();
  }
  if (request.inputDigest && request.inputDigest !== inputDigest) {
    terminalReason = 'input_digest_mismatch';
    lifecycle.push({ state: 'failed', elapsedMs: elapsed(), summary: 'Input digest mismatch.' });
    return finish();
  }

  const deadlineController = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      deadlineController.abort();
      reject(new ManagedKernelDeadlineError());
    }, budget.maxWallTimeMs);
  });
  const beforeDeadline = <T>(operation: Promise<T>): Promise<T> =>
    Promise.race([operation, deadline]);

  try {
    session = sanitizeSession(
      await beforeDeadline(
        args.adapter.transport.open({
          sessionId,
          traceId,
          job: structuredClone(request.job),
          budget,
          network: network.policy,
          signal: deadlineController.signal,
        }),
      ),
    );
    lifecycle.push({ state: 'opened', elapsedMs: elapsed(), summary: 'Ephemeral session opened.' });
    const activeSession = session;
    if (args.isCancelled?.()) {
      terminalReason = 'cancelled';
      const cancelled = await settleManagedLifecycle(() =>
        args.adapter.transport.cancel(activeSession, 'cancelled_before_execution'),
      );
      if (cancelled) {
        lifecycle.push({ state: 'cancelled', elapsedMs: elapsed(), summary: 'Session cancelled.' });
      } else {
        terminalReason = 'adapter_failed';
        lifecycle.push({ state: 'failed', elapsedMs: elapsed(), summary: 'Cancellation failed.' });
      }
    } else {
      lifecycle.push({ state: 'running', elapsedMs: elapsed(), summary: 'Typed job started.' });
      const execution = await beforeDeadline(
        args.adapter.transport.execute(activeSession, structuredClone(request.job), {
          signal: deadlineController.signal,
        }),
      );
      steps = boundedNonNegativeInteger(execution.steps);
      outputBytes = byteLength(execution.output);
      const sanitizedOutput =
        outputBytes <= budget.maxOutputBytes ? sanitizeValue(execution.output) : undefined;
      const artifactResult = artifactReceipts(execution.artifacts ?? []);
      artifacts = artifactResult.receipts;
      artifactBytes = artifactResult.bytes;
      telemetry = sanitizeProviderTelemetry(execution.telemetry, args.adapter);
      if (steps > budget.maxSteps) terminalReason = 'step_budget_exhausted';
      else if (outputBytes > budget.maxOutputBytes) terminalReason = 'output_budget_exhausted';
      else if (artifactBytes > budget.maxArtifactBytes)
        terminalReason = 'artifact_budget_exhausted';
      else if (elapsed() > budget.maxWallTimeMs) terminalReason = 'wall_time_exhausted';
      else {
        output = sanitizedOutput;
        outputDigest = `output_${nodeslideContentDigest(stableSerialize(sanitizedOutput))}`;
        terminalReason = 'completed';
        lifecycle.push({
          state: 'completed',
          elapsedMs: elapsed(),
          summary: 'Typed job completed.',
        });
      }
      if (terminalReason !== 'completed') {
        lifecycle.push({
          state: 'failed',
          elapsedMs: elapsed(),
          summary: 'Managed budget exhausted.',
        });
      }
    }
  } catch (error) {
    if (error instanceof ManagedKernelDeadlineError) {
      terminalReason = 'wall_time_exhausted';
      if (session) {
        const activeSession = session;
        const cancelled = await settleManagedLifecycle(() =>
          args.adapter.transport.cancel(activeSession, 'wall_time_exhausted'),
        );
        lifecycle.push({
          state: cancelled ? 'cancelled' : 'failed',
          elapsedMs: elapsed(),
          summary: cancelled ? 'Session cancelled at its wall-time limit.' : 'Cancellation failed.',
        });
      } else {
        lifecycle.push({
          state: 'failed',
          elapsedMs: elapsed(),
          summary: 'Managed session open exceeded its wall-time limit.',
        });
      }
    } else {
      terminalReason = 'adapter_failed';
      lifecycle.push({ state: 'failed', elapsedMs: elapsed(), summary: 'Managed adapter failed.' });
    }
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    deadlineController.abort();
    if (session) {
      const activeSession = session;
      const cleaned = await settleManagedLifecycle(() =>
        args.adapter.transport.cleanup(activeSession),
      );
      if (cleaned) {
        cleanupConfirmed = true;
        lifecycle.push({
          state: 'cleaned',
          elapsedMs: elapsed(),
          summary: 'Session cleanup confirmed.',
        });
      } else {
        cleanupConfirmed = false;
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

class ManagedKernelDeadlineError extends Error {}

const MANAGED_LIFECYCLE_GRACE_MS = 1_000;

async function settleManagedLifecycle(operation: () => Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('managed_lifecycle_timeout')),
      MANAGED_LIFECYCLE_GRACE_MS,
    );
  });
  try {
    await Promise.race([operation(), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function resolveBudget(
  requested: Partial<NodeSlideKernelBudget> | undefined,
): NodeSlideKernelBudget | null {
  const budget = { ...DEFAULT_BUDGET, ...requested };
  for (const key of Object.keys(NODESLIDE_ANALYSIS_KERNEL_HARD_LIMITS) as Array<
    keyof NodeSlideKernelBudget
  >) {
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

function normalizeNetwork(
  request: NodeSlideKernelRequest,
  adapter: NodeSlideManagedKernelAdapter,
  controls: NodeSlideAgenticControls,
): {
  ok: boolean;
  policy: { mode: 'deny' | 'allowlist'; allowedHosts: string[]; consentId?: string };
  receipt: { mode: 'deny' | 'allowlist'; allowedHosts: string[]; consentRecorded: boolean };
} {
  if (!request.network || request.network.mode === 'deny') {
    return {
      ok: true,
      policy: { mode: 'deny', allowedHosts: [] },
      receipt: { mode: 'deny', allowedHosts: [], consentRecorded: false },
    };
  }
  const authorization = authorizeNodeSlideAgenticOperation(controls, {
    operation: 'network_egress',
  });
  const consentId = cleanId(request.network.consentId);
  const hosts = [...new Set(request.network.allowedHosts.map(normalizedPublicHost))]
    .filter(Boolean)
    .sort();
  const ok =
    authorization.allowed &&
    adapter.capabilities.network &&
    Boolean(consentId) &&
    hosts.length > 0 &&
    hosts.length <= 16 &&
    hosts.length === request.network.allowedHosts.length;
  return {
    ok,
    policy: { mode: 'allowlist', allowedHosts: hosts, ...(consentId ? { consentId } : {}) },
    receipt: { mode: 'allowlist', allowedHosts: hosts, consentRecorded: Boolean(consentId) },
  };
}

function artifactReceipts(artifacts: readonly NodeSlideKernelArtifactInput[]): {
  receipts: NodeSlideKernelResult['artifacts'];
  bytes: number;
} {
  if (artifacts.length > 32) throw new Error('Managed kernel artifact count exceeded.');
  const receipts = artifacts.map((artifact) => {
    const content = typeof artifact.content === 'string' ? artifact.content : '';
    const sizeBytes = byteLength(content);
    return {
      name: cleanFileName(artifact.name),
      mimeType: cleanMimeType(artifact.mimeType),
      sizeBytes,
      digest: `artifact_${nodeslideContentDigest(content)}`,
    };
  });
  return { receipts, bytes: receipts.reduce((total, artifact) => total + artifact.sizeBytes, 0) };
}

function sanitizeProviderTelemetry(
  value: NodeSlideManagedKernelProviderTelemetry | undefined,
  adapter: NodeSlideManagedKernelAdapter,
): Record<string, unknown> {
  if (!value) return { provider: adapter.providerId, resolvedModel: adapter.model };
  return {
    provider: cleanId(value.provider) || adapter.providerId,
    resolvedModel: cleanId(value.resolvedModel) || adapter.model,
    inputTokens: boundedNonNegativeInteger(value.inputTokens),
    outputTokens: boundedNonNegativeInteger(value.outputTokens),
    costMicroUsd: boundedNonNegativeInteger(value.costMicroUsd),
    latencyMs: boundedNonNegativeInteger(value.latencyMs),
    retries: boundedNonNegativeInteger(value.retries),
    fallbackUsed: value.fallbackUsed === true,
  };
}

function sanitizeSession(value: NodeSlideKernelSession): NodeSlideKernelSession {
  const opaqueSessionId = cleanId(value?.opaqueSessionId);
  if (!opaqueSessionId) throw new Error('Managed adapter returned an invalid session.');
  return { opaqueSessionId };
}

function isJobShape(value: unknown): value is NodeSlideAnalysisJob {
  if (!isRecord(value) || !isJobType(value['type'])) return false;
  if (value['type'] === 'summarize_table')
    return Array.isArray(value['columns']) && Array.isArray(value['rows']);
  if (value['type'] === 'derive_series')
    return (
      Array.isArray(value['values']) &&
      ['delta', 'cumulative', 'percent_change'].includes(String(value['operation']))
    );
  return Array.isArray(value['labels']) && Array.isArray(value['series']);
}

function isJobType(value: unknown): value is NodeSlideAnalysisJob['type'] {
  return ['summarize_table', 'derive_series', 'validate_chart'].includes(String(value));
}

function normalizedPublicHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return '';
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    return '';
  return host;
}

function cleanId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^A-Za-z0-9._:/+ -]/g, '')
    .trim()
    .slice(0, 180);
}

function cleanFileName(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9._ -]/g, '_')
      .trim()
      .slice(0, 160) || 'artifact.bin'
  );
}

function cleanMimeType(value: string): string {
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value)
    ? value.toLowerCase()
    : 'application/octet-stream';
}

function boundedNonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Managed kernel metric is invalid.');
  return value;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return value.slice(0, 16_000);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(typeof value === 'string' ? value : stableSerialize(value))
    .byteLength;
}

function finiteClock(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
