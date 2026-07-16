import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_JOB_MAX_ATTEMPTS = 3;

export const NODESLIDE_JOB_STATUSES = [
  'queued',
  'running',
  'awaiting_review',
  'succeeded',
  'failed',
  'cancelled',
  'rejected',
  'stale',
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
  'rejected',
  'stale',
] as const;

export type NodeSlideJobStatus = (typeof NODESLIDE_JOB_STATUSES)[number];
export type NodeSlideJobPhase = (typeof NODESLIDE_JOB_PHASES)[number];
export type NodeSlideJobKind = 'create_deck' | 'edit_proposal';

export interface NodeSlideJobRecord {
  id: string;
  kind: NodeSlideJobKind;
  clientSessionId: string;
  admissionQuotaSubject: string;
  ownerDigest: string;
  executionDigest: string;
  idempotencyKey: string;
  requestDigest: string;
  /** Digest of only the exact visible user request, for secret-free evidence binding. */
  userRequestDigest?: string;
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
  resultCandidateDigest?: string;
  conversationRunId?: string;
  /** Stable server-owned ledger binding for every externally billable durable run. */
  budgetId?: string;
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
  resultCandidateDigest?: string;
  result?:
    | { kind: 'create_deck'; deckId: string; conversationRunId?: string }
    | {
        kind: 'edit_proposal';
        deckId: string;
        patchId: string;
        candidateDigest: string;
        reviewRequired: true;
      };
  conversationRunId?: string;
  budgetId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

const TERMINAL = new Set<NodeSlideJobStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'rejected',
  'stale',
]);

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
  if (TERMINAL.has(job.status) || job.status === 'awaiting_review') return job;
  // @convex-dev/workflow may retry the same action invocation after a transient
  // error. Re-entering an already-running durable job must reuse its fenced
  // attempt/lease; only an explicit failed -> retry -> queued cycle may advance it.
  if (job.status === 'running') return job;
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

/** Keeps internal completion handlers from crossing durable job result lanes. */
export function assertNodeSlideJobCompletionKind(
  job: Pick<NodeSlideJobRecord, 'kind'>,
  expected: NodeSlideJobKind,
): void {
  if (job.kind !== expected) {
    throw new Error(`The durable ${job.kind} job cannot complete a ${expected} result.`);
  }
}

/** Rejects result-bearing checkpoints that contradict the job's durable contract. */
export function assertNodeSlideJobCheckpointKind(
  job: Pick<NodeSlideJobRecord, 'kind'>,
  update: Pick<
    Parameters<typeof advanceNodeSlideJob>[1],
    'status' | 'phase' | 'resultDeckId' | 'resultPatchId' | 'resultCandidateDigest'
  >,
): void {
  if (job.kind === 'create_deck') {
    if (
      update.status === 'awaiting_review' ||
      update.phase === 'awaiting_review' ||
      update.resultPatchId !== undefined ||
      update.resultCandidateDigest !== undefined
    ) {
      throw new Error('A create-deck job cannot checkpoint an edit-proposal result.');
    }
    return;
  }
  if (update.status === 'succeeded' || update.phase === 'complete') {
    throw new Error('An edit-proposal job must stop at the review gate, not completion.');
  }
  if (
    (update.status === 'awaiting_review' || update.phase === 'awaiting_review') &&
    (update.resultDeckId === undefined ||
      update.resultPatchId === undefined ||
      update.resultCandidateDigest === undefined)
  ) {
    throw new Error(
      'An edit-proposal review checkpoint requires its deck, patch, and candidate digest bindings.',
    );
  }
  if (
    update.resultCandidateDigest !== undefined &&
    (update.resultDeckId === undefined || update.resultPatchId === undefined)
  ) {
    throw new Error('An edit-proposal candidate digest requires its deck and patch bindings.');
  }
}

export function advanceNodeSlideJob(
  job: NodeSlideJobRecord,
  update: {
    status?: NodeSlideJobStatus;
    phase: NodeSlideJobPhase;
    progress: number;
    resultDeckId?: string;
    resultPatchId?: string;
    resultCandidateDigest?: string;
    conversationRunId?: string;
    memoryIds?: readonly string[];
    workflowId?: string;
    error?: string;
  },
  now: number,
): NodeSlideJobRecord {
  if (TERMINAL.has(job.status)) return job;
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
    ...(update.resultCandidateDigest
      ? { resultCandidateDigest: boundedText(update.resultCandidateDigest, 256) }
      : {}),
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
  if (TERMINAL.has(job.status)) return job;
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

export function resolveNodeSlideReviewJob(
  job: NodeSlideJobRecord,
  outcome: 'accepted' | 'rejected' | 'stale',
  now: number,
): NodeSlideJobRecord {
  if (job.kind !== 'edit_proposal') {
    throw new Error('Only an edit-proposal job can resolve a patch review.');
  }
  if (TERMINAL.has(job.status)) return job;
  if (job.status !== 'awaiting_review') {
    throw new Error('The durable edit job is not awaiting review.');
  }
  if (!job.resultDeckId || !job.resultPatchId || !job.resultCandidateDigest) {
    throw new Error('The durable edit job is missing its review bindings.');
  }
  return advanceNodeSlideJob(
    job,
    outcome === 'accepted'
      ? { status: 'succeeded', phase: 'complete', progress: 100 }
      : outcome === 'rejected'
        ? {
            status: 'rejected',
            phase: 'rejected',
            progress: 100,
            error: 'The user rejected the proposed patch. No candidate mutation was applied.',
          }
        : {
            status: 'stale',
            phase: 'stale',
            progress: 100,
            error: 'The proposed patch became stale before commit. The newer deck was preserved.',
          },
    now,
  );
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
    ...(job.resultCandidateDigest ? { resultCandidateDigest: job.resultCandidateDigest } : {}),
    ...(job.conversationRunId ? { conversationRunId: job.conversationRunId } : {}),
    ...(job.budgetId ? { budgetId: job.budgetId } : {}),
    ...(job.error ? { error: job.error } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    ...publicResult(job),
  };
}

function publicResult(job: NodeSlideJobRecord): Pick<PublicNodeSlideJob, 'result'> {
  if (job.kind === 'create_deck' && job.resultDeckId) {
    return {
      result: {
        kind: 'create_deck',
        deckId: job.resultDeckId,
        ...(job.conversationRunId ? { conversationRunId: job.conversationRunId } : {}),
      },
    };
  }
  if (
    job.kind === 'edit_proposal' &&
    job.resultDeckId &&
    job.resultPatchId &&
    job.resultCandidateDigest &&
    job.status === 'awaiting_review'
  ) {
    return {
      result: {
        kind: 'edit_proposal',
        deckId: job.resultDeckId,
        patchId: job.resultPatchId,
        candidateDigest: job.resultCandidateDigest,
        reviewRequired: true,
      },
    };
  }
  return {};
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
  if (status === 'rejected' && (phase !== 'rejected' || progress !== 100)) {
    throw new Error('A rejected NodeSlide job must use the rejected phase at 100%.');
  }
  if (status === 'stale' && (phase !== 'stale' || progress !== 100)) {
    throw new Error('A stale NodeSlide job must use the stale phase at 100%.');
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
