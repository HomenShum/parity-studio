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
  failNodeSlideJob,
  nodeSlideJobExecutionDigest,
  nodeSlideJobOwnerDigest,
  nodeSlideJobRequestDigest,
  publicNodeSlideJob,
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

  it('bounds retries and preserves the stable job id across attempts', () => {
    let current = job({ status: 'failed', phase: 'failed' });
    for (let attempt = 1; attempt <= NODESLIDE_JOB_MAX_ATTEMPTS; attempt += 1) {
      current = retryNodeSlideJob(current, attempt * 10);
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
        resultPatchId: 'patch_proposal_only',
        conversationRunId: 'agent_run_1',
      },
      3_000,
    );
    expect(awaitingReview.status).toBe('awaiting_review');
    expect(awaitingReview.resultPatchId).toBe('patch_proposal_only');
    expect(awaitingReview).not.toHaveProperty('acceptedAt');
  });

  it('exposes a review-only edit result bound to the exact preflight candidate', () => {
    const reviewable = advanceNodeSlideJob(
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
