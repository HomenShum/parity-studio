import { describe, expect, it } from 'vitest';
import { createNodeSlideCapabilityDigestMetadata } from '../../shared/nodeslideDurableSession';
import {
  NodeSlideDurableSessionError,
  claimNodeSlideDurableJob,
  createNodeSlideDurableSession,
  reduceNodeSlideDurableSession,
  resumeNodeSlideDurableJob,
  retryNodeSlideDurableJob,
  transitionNodeSlideDurableJob,
} from './nodeslideDurableSessionState';

describe('NodeSlide durable-session v2 state reducer', () => {
  it('enforces CAS, one active job, immutable request binding, and event chaining', () => {
    const state = session();
    const queued = reduceNodeSlideDurableSession(state, {
      type: 'enqueue',
      expectedStateVersion: 0,
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      now: 10,
    });
    expect(queued).toMatchObject({ stateVersion: 1, activeJobId: 'job-1' });
    expect(queued.events[0]).toMatchObject({
      sequence: 1,
      fromStatus: null,
      toStatus: 'queued',
      kind: 'enqueued',
    });
    expect(() =>
      reduceNodeSlideDurableSession(queued, {
        type: 'enqueue',
        expectedStateVersion: 0,
        jobId: 'job-2',
        requestBinding: queued.requestBinding,
        now: 11,
      }),
    ).toThrowError(NodeSlideDurableSessionError);
    expect(() =>
      reduceNodeSlideDurableSession(queued, {
        type: 'enqueue',
        expectedStateVersion: 1,
        jobId: 'job-2',
        requestBinding: { ...queued.requestBinding, requestDigest: 'sha256:substituted' },
        now: 11,
      }),
    ).toThrowError(expect.objectContaining({ code: 'request_binding_mismatch' }));
    expect(queued.events[0]?.eventDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(queued.events[1]).toBeUndefined();
  });

  it('distinguishes retry from resume and fences stale or expired leases', () => {
    let state = enqueue(session());
    state = claimNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      lease: { leaseId: 'lease-1', workerId: 'worker-1', issuedAt: 10, expiresAt: 100 },
      now: 10,
    });
    expect(state.jobs['job-1']).toMatchObject({ status: 'running', attempt: 1 });

    state = transitionNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      toStatus: 'paused',
      leaseId: 'lease-1',
      now: 20,
    });
    state = resumeNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      lease: { leaseId: 'lease-2', workerId: 'worker-2', issuedAt: 21, expiresAt: 100 },
      now: 21,
    });
    expect(state.jobs['job-1']).toMatchObject({ status: 'running', attempt: 1, resumeCount: 1 });
    expect(() =>
      transitionNodeSlideDurableJob(state, {
        jobId: 'job-1',
        requestBinding: state.requestBinding,
        toStatus: 'failed',
        leaseId: 'lease-1',
        now: 22,
      }),
    ).toThrowError(expect.objectContaining({ code: 'lease_mismatch' }));

    state = transitionNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      toStatus: 'failed',
      leaseId: 'lease-2',
      reason: 'transient provider failure',
      now: 22,
    });
    state = retryNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      now: 23,
    });
    expect(state.jobs['job-1']).toMatchObject({ status: 'retrying', attempt: 1, retryCount: 1 });
    state = claimNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      lease: { leaseId: 'lease-3', workerId: 'worker-3', issuedAt: 24, expiresAt: 100 },
      now: 24,
    });
    expect(state.jobs['job-1']).toMatchObject({ status: 'running', attempt: 2, resumeCount: 1 });
    expect(() =>
      transitionNodeSlideDurableJob(state, {
        jobId: 'job-1',
        requestBinding: state.requestBinding,
        toStatus: 'succeeded',
        leaseId: 'lease-3',
        now: 101,
      }),
    ).toThrowError(expect.objectContaining({ code: 'lease_mismatch' }));
  });

  it('supports review, rejection, cancellation, and egress-fenced stale outcomes', () => {
    let state = enqueue(session());
    state = claimNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      lease: { leaseId: 'lease-1', workerId: 'worker-1', issuedAt: 10, expiresAt: 100 },
      now: 10,
    });
    state = transitionNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      toStatus: 'awaiting_review',
      leaseId: 'lease-1',
      now: 20,
    });
    expect(state.activeJobId).toBeNull();
    state = transitionNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      toStatus: 'rejected',
      reason: 'human rejected proposal',
      now: 21,
    });
    expect(state.jobs['job-1']).toMatchObject({ status: 'rejected', completedAt: 21 });

    state = enqueue(state);
    state = claimNodeSlideDurableJob(state, {
      jobId: 'job-2',
      requestBinding: state.requestBinding,
      lease: { leaseId: 'lease-2', workerId: 'worker-2', issuedAt: 30, expiresAt: 100 },
      now: 30,
    });
    const rotated = reduceNodeSlideDurableSession(state, {
      type: 'rotate_egress',
      expectedStateVersion: state.stateVersion,
      now: 31,
      reason: 'consent revoked',
    });
    expect(rotated).toMatchObject({ egressEpoch: 1, activeJobId: null });
    expect(rotated.jobs['job-2']).toMatchObject({ status: 'stale', reason: 'consent revoked' });
    expect(() =>
      transitionNodeSlideDurableJob(rotated, {
        jobId: 'job-2',
        requestBinding: rotated.requestBinding,
        toStatus: 'succeeded',
        leaseId: 'lease-2',
        now: 32,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_transition' }));
  });

  it('accepts the remaining terminal lanes and rejects tampered event chains', () => {
    let state = enqueue(session());
    state = claimNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      lease: { leaseId: 'lease-1', workerId: 'worker-1', issuedAt: 10, expiresAt: 100 },
      now: 10,
    });
    state = transitionNodeSlideDurableJob(state, {
      jobId: 'job-1',
      requestBinding: state.requestBinding,
      toStatus: 'succeeded',
      leaseId: 'lease-1',
      now: 20,
    });
    expect(state.jobs['job-1']?.status).toBe('succeeded');

    state = enqueue(state);
    state = transitionNodeSlideDurableJob(state, {
      jobId: 'job-2',
      requestBinding: state.requestBinding,
      toStatus: 'cancelled',
      reason: 'user cancelled before claim',
      now: 30,
    });
    expect(state.jobs['job-2']?.status).toBe('cancelled');

    const firstEvent = state.events[0];
    if (!firstEvent) throw new Error('test fixture did not create an event');
    const tampered = {
      ...state,
      events: state.events.map((event, index) =>
        index === 0 ? { ...event, reason: 'tampered' } : event,
      ),
    };
    expect(() =>
      reduceNodeSlideDurableSession(tampered, {
        type: 'rotate_egress',
        expectedStateVersion: tampered.stateVersion,
        now: 40,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_state' }));
  });
});

function session() {
  const capability = createNodeSlideCapabilityDigestMetadata({ egress: 'model' });
  return createNodeSlideDurableSession({
    sessionId: 'session-1',
    request: { prompt: 'Build a deck' },
    capability,
    now: 1,
  });
}

function enqueue(state: ReturnType<typeof session>) {
  return reduceNodeSlideDurableSession(state, {
    type: 'enqueue',
    expectedStateVersion: state.stateVersion,
    jobId: state.jobs['job-1'] ? 'job-2' : 'job-1',
    requestBinding: state.requestBinding,
    now: state.stateVersion + 10,
  });
}
