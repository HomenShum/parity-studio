import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_JOB_MAX_ATTEMPTS,
  type NodeSlideJobRecord,
  advanceNodeSlideJob,
  assertNodeSlideJobCheckpointKind,
  assertNodeSlideJobCompletionKind,
  assertNodeSlideJobIdempotency,
  cancelNodeSlideJob,
  claimNodeSlideJobAttempt,
  classifyNodeSlideJobFreshness,
  failNodeSlideJob,
  heartbeatNodeSlideJob,
  isNodeSlideJobTerminal,
  nodeSlideJobExecutionDigest,
  nodeSlideJobOwnerDigest,
  nodeSlideJobRequestDigest,
  pauseNodeSlideJob,
  publicNodeSlideJob,
  resolveNodeSlideReviewJob,
  resumeNodeSlideJob,
  retryNodeSlideJob,
} from './nodeslideJobState';

describe('NodeSlide durable job state', () => {
  it('deduplicates the same request and rejects idempotency-key payload substitution', () => {
    const requestDigest = nodeSlideJobRequestDigest({ prompt: 'Build a launch deck', files: [] });
    const ownerDigest = nodeSlideJobOwnerDigest('owner-capability');
    expect(() => assertNodeSlideJobIdempotency(job(), requestDigest, ownerDigest)).not.toThrow();
    expect(() =>
      assertNodeSlideJobIdempotency(
        job(),
        nodeSlideJobRequestDigest({ prompt: 'A different deck', files: [] }),
        ownerDigest,
      ),
    ).toThrow(/different NodeSlide request/i);
  });

  it('resumes from durable phase/progress and keeps progress monotonic', () => {
    const claimed = claimNodeSlideJobAttempt(job(), 2_000);
    const generating = advanceNodeSlideJob(
      claimed,
      { status: 'running', phase: 'generating', progress: 45 },
      3_000,
    );
    const reloaded = structuredClone(generating);
    const publicJob = publicNodeSlideJob(reloaded);
    expect(publicJob).toMatchObject({
      jobId: 'job_create_1',
      phase: 'generating',
      progress: 45,
      attempt: 1,
      memoryIds: ['memory_1'],
    });
    expect(publicJob).not.toHaveProperty('ownerDigest');
    expect(publicJob).not.toHaveProperty('executionDigest');
    expect(() => advanceNodeSlideJob(reloaded, { phase: 'planning', progress: 20 }, 4_000)).toThrow(
      /cannot move backwards/i,
    );
  });

  it('reuses the current attempt when the workflow retries the same running action', () => {
    const running = claimNodeSlideJobAttempt(job(), 2_000);
    expect(claimNodeSlideJobAttempt(running, 3_000)).toBe(running);
    expect(running.attempt).toBe(1);
  });

  it('freezes exact memory ids and digests once a durable job binds retrieval', () => {
    const bound = job({
      memoryIds: ['memory_1'],
      memoryDigests: ['digest_1'],
    });
    expect(() =>
      advanceNodeSlideJob(
        bound,
        {
          phase: 'planning',
          progress: bound.progress,
          memoryIds: ['memory_2'],
          memoryDigests: ['digest_2'],
        },
        2_000,
      ),
    ).toThrow(/memory binding cannot change/i);
    expect(() =>
      advanceNodeSlideJob(
        bound,
        {
          phase: 'planning',
          progress: bound.progress,
          memoryIds: ['memory_1'],
          memoryDigests: ['digest_2'],
        },
        2_000,
      ),
    ).toThrow(/memory digest binding cannot change/i);
  });

  it('makes cancel terminal so a late workflow completion cannot mutate the outcome', () => {
    const running = claimNodeSlideJobAttempt(job(), 2_000);
    const cancelled = cancelNodeSlideJob(running, 3_000);
    const late = advanceNodeSlideJob(
      cancelled,
      {
        status: 'succeeded',
        phase: 'complete',
        progress: 100,
        resultDeckId: 'deck_late',
      },
      4_000,
    );
    expect(late).toEqual(cancelled);
    expect(late.resultDeckId).toBeUndefined();
  });

  it('pauses cooperatively, fences late completion, and resumes the same running attempt', () => {
    const running = advanceNodeSlideJob(
      claimNodeSlideJobAttempt(job(), 2_000),
      { status: 'running', phase: 'generating', progress: 45 },
      3_000,
    );
    const paused = pauseNodeSlideJob(running, 4_000);
    const late = advanceNodeSlideJob(
      paused,
      { status: 'succeeded', phase: 'complete', progress: 100, resultDeckId: 'deck_late' },
      5_000,
    );

    expect(paused).toMatchObject({ status: 'paused', phase: 'paused', attempt: 1, progress: 45 });
    expect(pauseNodeSlideJob(paused, 4_500)).toBe(paused);
    expect(late).toBe(paused);
    expect(failNodeSlideJob(paused, 'Late workflow failure.', 5_000)).toBe(paused);

    const resumed = resumeNodeSlideJob(paused, 6_000, 'running');
    expect(resumed).toMatchObject({
      id: running.id,
      status: 'running',
      phase: 'planning',
      attempt: 1,
      progress: 45,
    });
  });

  it('keeps cancellation terminal from paused state', () => {
    const paused = pauseNodeSlideJob(claimNodeSlideJobAttempt(job(), 2_000), 3_000);
    const cancelled = cancelNodeSlideJob(paused, 4_000);
    expect(cancelled).toMatchObject({ status: 'cancelled', phase: 'cancelled' });
    expect(
      advanceNodeSlideJob(
        cancelled,
        { status: 'succeeded', phase: 'complete', progress: 100 },
        5_000,
      ),
    ).toBe(cancelled);
  });

  it('bounds retries and preserves the stable job id across attempts', () => {
    let current = job({ status: 'failed', phase: 'failed' });
    for (let attempt = 1; attempt <= NODESLIDE_JOB_MAX_ATTEMPTS; attempt += 1) {
      current = retryNodeSlideJob(current, attempt * 10);
      expect(current.status).toBe('retrying');
      current = claimNodeSlideJobAttempt(current, attempt * 10 + 1);
      current = advanceNodeSlideJob(
        current,
        { status: 'failed', phase: 'failed', progress: current.progress, error: 'transient' },
        attempt * 10 + 2,
      );
      expect(current.id).toBe('job_create_1');
    }
    expect(current.attempt).toBe(NODESLIDE_JOB_MAX_ATTEMPTS);
    expect(() => retryNodeSlideJob(current, 100)).toThrow(/retry limit/i);
  });

  it('persists heartbeats and classifies an overdue active job as stalled without terminating it', () => {
    const running = claimNodeSlideJobAttempt(job(), 2_000);
    const heartbeat = heartbeatNodeSlideJob(running, 3_000);
    expect(heartbeat.updatedAt).toBe(3_000);
    expect(classifyNodeSlideJobFreshness(heartbeat, 3_099, 100)).toEqual({
      freshness: 'fresh',
      heartbeatAt: 3_000,
    });
    expect(classifyNodeSlideJobFreshness(heartbeat, 3_100, 100)).toEqual({
      freshness: 'stalled',
      heartbeatAt: 3_000,
      stalledSince: 3_100,
    });
    expect(heartbeat.status).toBe('running');
    expect(heartbeat.completedAt).toBeUndefined();
  });

  it('bounds workflow failures so callback persistence cannot strand a running job', () => {
    const failed = failNodeSlideJob(
      claimNodeSlideJobAttempt(job(), 2_000),
      'x'.repeat(2_000),
      3_000,
    );
    expect(failed.status).toBe('failed');
    expect(failed.error).toHaveLength(600);
  });

  it('stops edit-style work at review rather than treating proposal generation as acceptance', () => {
    const awaitingReview = advanceNodeSlideJob(
      claimNodeSlideJobAttempt(job(), 2_000),
      {
        status: 'awaiting_review',
        phase: 'awaiting_review',
        progress: 100,
        resultDeckId: 'deck_1',
        resultPatchId: 'patch_proposal_only',
        resultCandidateDigest: 'candidate_sha256:proposal',
        conversationRunId: 'agent_run_1',
      },
      3_000,
    );
    expect(awaitingReview.status).toBe('awaiting_review');
    expect(awaitingReview.resultPatchId).toBe('patch_proposal_only');
    expect(awaitingReview.resultCandidateDigest).toBe('candidate_sha256:proposal');
    expect(awaitingReview).not.toHaveProperty('acceptedAt');
    expect(isNodeSlideJobTerminal(awaitingReview.status)).toBe(false);
    expect(isNodeSlideJobTerminal('succeeded')).toBe(true);
    expect(isNodeSlideJobTerminal('rejected')).toBe(true);
  });

  it('exposes a review-only edit result bound to the exact preflight candidate', () => {
    const reviewable = reviewJob();
    expect(publicNodeSlideJob(reviewable)).toMatchObject({
      kind: 'edit_proposal',
      status: 'awaiting_review',
      result: {
        kind: 'edit_proposal',
        deckId: 'deck_1',
        patchId: 'patch_1',
        candidateDigest: 'candidate_sha256:abc123',
        reviewRequired: true,
      },
    });
  });

  it.each([
    {
      outcome: 'accepted',
      status: 'succeeded',
      phase: 'complete',
      error: undefined,
    },
    {
      outcome: 'rejected',
      status: 'rejected',
      phase: 'rejected',
      error: 'The user rejected the proposed patch. No candidate mutation was applied.',
    },
    {
      outcome: 'stale',
      status: 'stale',
      phase: 'stale',
      error: 'The proposed patch became stale before commit. The newer deck was preserved.',
    },
  ] as const)(
    'resolves an $outcome review into a terminal $status job',
    ({ outcome, status, phase, error }) => {
      const awaitingReview = reviewJob();
      const resolved = resolveNodeSlideReviewJob(awaitingReview, outcome, 4_000);

      expect(resolved).toEqual({
        ...awaitingReview,
        status,
        phase,
        updatedAt: 4_000,
        completedAt: 4_000,
        ...(error ? { error } : {}),
      });
    },
  );

  it.each(['accepted', 'rejected', 'stale'] as const)(
    'keeps an $outcome resolution terminal across same and conflicting replays',
    (outcome) => {
      const resolved = resolveNodeSlideReviewJob(reviewJob(), outcome, 4_000);

      for (const replayOutcome of ['accepted', 'rejected', 'stale'] as const) {
        expect(resolveNodeSlideReviewJob(resolved, replayOutcome, 5_000)).toBe(resolved);
      }
      expect(resolved).toMatchObject({ updatedAt: 4_000, completedAt: 4_000 });
    },
  );

  it('only exposes an actionable edit result while review is pending', () => {
    const awaitingReview = reviewJob();
    expect(publicNodeSlideJob(awaitingReview).result).toEqual({
      kind: 'edit_proposal',
      deckId: 'deck_1',
      patchId: 'patch_1',
      candidateDigest: 'candidate_sha256:abc123',
      reviewRequired: true,
    });

    for (const { outcome, status } of [
      { outcome: 'accepted', status: 'succeeded' },
      { outcome: 'rejected', status: 'rejected' },
      { outcome: 'stale', status: 'stale' },
    ] as const) {
      const terminal = publicNodeSlideJob(
        resolveNodeSlideReviewJob(awaitingReview, outcome, 4_000),
      );
      expect(terminal).toMatchObject({
        status,
        resultDeckId: 'deck_1',
        resultPatchId: 'patch_1',
        resultCandidateDigest: 'candidate_sha256:abc123',
      });
      expect(terminal).not.toHaveProperty('result');
    }
  });

  it('rejects cross-kind completions and checkpoint result substitution before persistence', () => {
    expect(() => assertNodeSlideJobCompletionKind(job(), 'edit_proposal')).toThrow(
      /cannot complete a edit_proposal result/i,
    );
    expect(() =>
      assertNodeSlideJobCompletionKind(job({ kind: 'edit_proposal' }), 'create_deck'),
    ).toThrow(/cannot complete a create_deck result/i);
    expect(() =>
      assertNodeSlideJobCheckpointKind(job(), {
        phase: 'awaiting_review',
        status: 'awaiting_review',
        resultPatchId: 'patch_wrong_lane',
      }),
    ).toThrow(/cannot checkpoint an edit-proposal result/i);
    expect(() =>
      assertNodeSlideJobCheckpointKind(job({ kind: 'edit_proposal' }), {
        phase: 'complete',
        status: 'succeeded',
      }),
    ).toThrow(/must stop at the review gate/i);
    expect(() =>
      assertNodeSlideJobCheckpointKind(job({ kind: 'edit_proposal' }), {
        phase: 'awaiting_review',
        status: 'awaiting_review',
        resultDeckId: 'deck_1',
        resultPatchId: 'patch_1',
      }),
    ).toThrow(/requires its deck, patch, and candidate digest bindings/i);
  });
});

function job(overrides: Partial<NodeSlideJobRecord> = {}): NodeSlideJobRecord {
  return {
    id: 'job_create_1',
    kind: 'create_deck',
    clientSessionId: 'session_1',
    admissionQuotaSubject: 'preview-subject',
    ownerDigest: nodeSlideJobOwnerDigest('owner-capability'),
    executionDigest: nodeSlideJobExecutionDigest('workflow-capability'),
    idempotencyKey: 'create_1',
    requestDigest: nodeSlideJobRequestDigest({ prompt: 'Build a launch deck', files: [] }),
    status: 'queued',
    phase: 'queued',
    progress: 0,
    attempt: 0,
    maxAttempts: NODESLIDE_JOB_MAX_ATTEMPTS,
    streamId: 'stream_1',
    memoryIds: ['memory_1'],
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function reviewJob(): NodeSlideJobRecord {
  return advanceNodeSlideJob(
    claimNodeSlideJobAttempt(job({ kind: 'edit_proposal', id: 'job_edit_1' }), 2_000),
    {
      status: 'awaiting_review',
      phase: 'awaiting_review',
      progress: 100,
      resultDeckId: 'deck_1',
      resultPatchId: 'patch_1',
      resultCandidateDigest: 'candidate_sha256:abc123',
      conversationRunId: 'agent_run_1',
    },
    3_000,
  );
}
