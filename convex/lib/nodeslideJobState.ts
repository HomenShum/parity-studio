import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_JOB_MAX_ATTEMPTS = 3;

export const NODESLIDE_JOB_STATUSES = [
  'queued',
  'running',
  'awaiting_review',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const NODESLIDE_JOB_PHASES = [
  'queued',
  'planning',
  'generating',
  'persisting',
  'validating',
  'awaiting_review',
  'complete',
  'failed',
  'cancelled',
] as const;

export type NodeSlideJobStatus = (typeof NODESLIDE_JOB_STATUSES)[number];
export type NodeSlideJobPhase = (typeof NODESLIDE_JOB_PHASES)[number];

export interface NodeSlideJobRecord {
  id: string;
  kind: 'create_deck';
  clientSessionId: string;
  admissionQuotaSubject: string;
  ownerDigest: string;
  executionDigest: string;
  idempotencyKey: string;
  requestDigest: string;
  status: NodeSlideJobStatus;
  phase: NodeSlideJobPhase;
  progress: number;
  attempt: number;
  maxAttempts: number;
  streamId: string;
  memoryIds: readonly string[];
  workflowId?: string;
  resultDeckId?: string;
  resultPatchId?: string;
  conversationRunId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface PublicNodeSlideJob {
  jobId: string;
  kind: NodeSlideJobRecord['kind'];
  idempotencyKey: string;
  status: NodeSlideJobStatus;
  phase: NodeSlideJobPhase;
  progress: number;
  attempt: number;
  maxAttempts: number;
  streamId: string;
  memoryIds: readonly string[];
  workflowId?: string;
  resultDeckId?: string;
  resultPatchId?: string;
  conversationRunId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

const TERMINAL = new Set<NodeSlideJobStatus>(['succeeded', 'failed', 'cancelled']);

export function nodeSlideJobRequestDigest(value: unknown): string {
  return nodeslideContentDigest(stableSerialize(value));
}

export function nodeSlideJobOwnerDigest(ownerAccessKey: string): string {
  return nodeslideContentDigest(`nodeslide-job-owner\u001f${ownerAccessKey}`);
}

export function nodeSlideJobExecutionDigest(executionAccessKey: string): string {
  return nodeslideContentDigest(`nodeslide-job-execution\u001f${executionAccessKey}`);
}

export function assertNodeSlideJobIdempotency(
  existing: Pick<NodeSlideJobRecord, 'requestDigest' | 'ownerDigest'>,
  requestDigest: string,
  ownerDigest: string,
): void {
  if (existing.requestDigest !== requestDigest) {
    throw new Error('This idempotency key is already bound to a different NodeSlide request.');
  }
  if (existing.ownerDigest !== ownerDigest) {
    throw new Error('This NodeSlide job belongs to a different owner capability.');
  }
}

export function claimNodeSlideJobAttempt(job: NodeSlideJobRecord, now: number): NodeSlideJobRecord {
  if (job.status === 'cancelled') return job;
  if (job.status === 'succeeded' || job.status === 'awaiting_review') return job;
  if (job.attempt >= job.maxAttempts) {
    throw new Error(`NodeSlide job reached its bounded retry limit (${job.maxAttempts}).`);
  }
  const { error: _error, completedAt: _completedAt, ...resumable } = job;
  return {
    ...resumable,
    status: 'running',
    phase: 'planning',
    progress: Math.max(job.progress, 10),
    attempt: job.attempt + 1,
    updatedAt: now,
  };
}

export function advanceNodeSlideJob(
  job: NodeSlideJobRecord,
  update: {
    status?: NodeSlideJobStatus;
    phase: NodeSlideJobPhase;
    progress: number;
    resultDeckId?: string;
    resultPatchId?: string;
    conversationRunId?: string;
    memoryIds?: readonly string[];
    workflowId?: string;
    error?: string;
  },
  now: number,
): NodeSlideJobRecord {
  if (job.status === 'cancelled') return job;
  if (TERMINAL.has(job.status) && update.status !== job.status) return job;
  const progress = boundedProgress(update.progress);
  if (progress < job.progress) throw new Error('NodeSlide job progress cannot move backwards.');
  const status = update.status ?? job.status;
  validatePhaseStatus(update.phase, status, progress);
  const terminal = TERMINAL.has(status);
  return {
    ...job,
    status,
    phase: update.phase,
    progress,
    ...(update.resultDeckId ? { resultDeckId: boundedText(update.resultDeckId, 256) } : {}),
    ...(update.resultPatchId ? { resultPatchId: boundedText(update.resultPatchId, 256) } : {}),
    ...(update.conversationRunId
      ? { conversationRunId: boundedText(update.conversationRunId, 256) }
      : {}),
    ...(update.memoryIds
      ? { memoryIds: uniqueBounded(update.memoryIds, 24) }
      : { memoryIds: job.memoryIds }),
    ...(update.workflowId ? { workflowId: boundedText(update.workflowId, 256) } : {}),
    ...(update.error ? { error: boundedText(update.error, 600) } : {}),
    updatedAt: now,
    ...(terminal ? { completedAt: now } : {}),
  };
}

export function cancelNodeSlideJob(job: NodeSlideJobRecord, now: number): NodeSlideJobRecord {
  if (TERMINAL.has(job.status) || job.status === 'awaiting_review') return job;
  return advanceNodeSlideJob(
    job,
    {
      status: 'cancelled',
      phase: 'cancelled',
      progress: job.progress,
      error: 'Cancelled by the user. No mutation was accepted or applied.',
    },
    now,
  );
}

export function failNodeSlideJob(
  job: NodeSlideJobRecord,
  error: string,
  now: number,
): NodeSlideJobRecord {
  if (job.status === 'cancelled' || job.status === 'succeeded') return job;
  return advanceNodeSlideJob(
    job,
    {
      status: 'failed',
      phase: 'failed',
      progress: job.progress,
      error: boundedError(error),
    },
    now,
  );
}

export function retryNodeSlideJob(job: NodeSlideJobRecord, now: number): NodeSlideJobRecord {
  if (job.status !== 'failed') throw new Error('Only a failed NodeSlide job can be retried.');
  if (job.attempt >= job.maxAttempts) {
    throw new Error(`NodeSlide job reached its bounded retry limit (${job.maxAttempts}).`);
  }
  const { error: _error, completedAt: _completedAt, ...resumable } = job;
  return {
    ...resumable,
    status: 'queued',
    phase: 'queued',
    updatedAt: now,
  };
}

export function publicNodeSlideJob(job: NodeSlideJobRecord): PublicNodeSlideJob {
  return {
    jobId: job.id,
    kind: job.kind,
    idempotencyKey: job.idempotencyKey,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    streamId: job.streamId,
    memoryIds: [...job.memoryIds],
    ...(job.workflowId ? { workflowId: job.workflowId } : {}),
    ...(job.resultDeckId ? { resultDeckId: job.resultDeckId } : {}),
    ...(job.resultPatchId ? { resultPatchId: job.resultPatchId } : {}),
    ...(job.conversationRunId ? { conversationRunId: job.conversationRunId } : {}),
    ...(job.error ? { error: job.error } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
  };
}

export function nodeSlideJobProgressLine(
  job: Pick<NodeSlideJobRecord, 'status' | 'phase' | 'progress' | 'attempt' | 'maxAttempts'>,
): string {
  return `${job.phase} · ${job.progress}% · ${job.status} · attempt ${job.attempt}/${job.maxAttempts}.\n`;
}

function validatePhaseStatus(
  phase: NodeSlideJobPhase,
  status: NodeSlideJobStatus,
  progress: number,
): void {
  if (status === 'succeeded' && (phase !== 'complete' || progress !== 100)) {
    throw new Error('A succeeded NodeSlide job must be complete at 100%.');
  }
  if (status === 'awaiting_review' && (phase !== 'awaiting_review' || progress !== 100)) {
    throw new Error('A reviewable NodeSlide job must stop at the Accept gate at 100%.');
  }
  if (status === 'failed' && phase !== 'failed') {
    throw new Error('A failed NodeSlide job must use the failed phase.');
  }
  if (status === 'cancelled' && phase !== 'cancelled') {
    throw new Error('A cancelled NodeSlide job must use the cancelled phase.');
  }
}

function boundedProgress(value: number): number {
  if (!Number.isFinite(value)) throw new Error('NodeSlide job progress must be finite.');
  return Math.max(0, Math.min(100, Math.floor(value)));
}

function boundedText(value: string, max: number): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean) throw new Error('NodeSlide job value is required.');
  if (clean.length > max) throw new Error('NodeSlide job value exceeds its bound.');
  return clean;
}

function boundedError(value: string): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  return (clean || 'The durable NodeSlide job failed safely.').slice(0, 600);
}

function uniqueBounded(values: readonly string[], limit: number): string[] {
  return [...new Set(values.map((value) => boundedText(value, 256)))].slice(0, limit);
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}
