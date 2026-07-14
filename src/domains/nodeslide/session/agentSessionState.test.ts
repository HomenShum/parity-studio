import { describe, expect, it } from 'vitest';
import {
  archiveAgentSessionJob,
  attachAgentSessionJob,
  createInitialAgentSessionState,
  prepareAgentSessionJob,
  readAgentSessionState,
  reconcileAgentSessionJob,
  updateAgentSessionControls,
  writeAgentSessionState,
} from './agentSessionState';

describe('NodeSlide authoritative agent session state', () => {
  it('rehydrates controls and a durable job handle while resetting transient consent', () => {
    const storage = new MemoryStorage();
    const controlled = updateAgentSessionControls(
      createInitialAgentSessionState('session-a', 1),
      {
        model: 'deterministic',
        effort: 'xhigh',
        scope: {
          kind: 'elements',
          deckId: 'deck-a',
          operationMode: 'layout',
          slideIds: ['slide-a'],
          elementIds: ['element-a'],
        },
        attachments: [attachment()],
        web: { enabled: true, consentGranted: true },
        memory: { mode: 'relevant', references: ['memory-a'] },
      },
      2,
    );
    const prepared = prepareAgentSessionJob(
      controlled,
      {
        kind: 'create_deck',
        requestFingerprint: 'intent-a',
        ownerAccessKey: 'owner-a',
        idempotencyKey: 'idempotency-a',
      },
      3,
    );
    const attached = attachAgentSessionJob(prepared.state, {
      jobId: 'job-a',
      kind: 'create_deck',
      idempotencyKey: 'idempotency-a',
      status: 'running',
      phase: 'generating',
      progress: 42,
      attempt: 1,
      maxAttempts: 3,
      streamId: 'stream-a',
      conversationRunId: 'run-a',
      memoryIds: ['memory-a'],
      updatedAt: 4,
    });

    expect(writeAgentSessionState(storage, attached)).toBe(true);
    const reloaded = readAgentSessionState(storage, 'session-a', 5);

    expect(reloaded.controls).toMatchObject({
      model: 'deterministic',
      effort: 'xhigh',
      scope: { kind: 'elements', deckId: 'deck-a', operationMode: 'layout' },
      web: { enabled: true, consentGranted: false },
      memory: { mode: 'relevant', references: ['memory-a'] },
    });
    expect(reloaded.controls.attachments).toEqual([attachment()]);
    expect(reloaded.activeJob).toMatchObject({
      jobId: 'job-a',
      ownerAccessKey: 'owner-a',
      idempotencyKey: 'idempotency-a',
      phase: 'generating',
      progress: 42,
      conversationRunId: 'run-a',
      memoryIds: ['memory-a'],
    });
  });

  it('rejects a substituted receipt and ignores stale progress after reload', () => {
    const prepared = prepareAgentSessionJob(
      createInitialAgentSessionState('session-b', 1),
      {
        kind: 'create_deck',
        requestFingerprint: 'intent-b',
        ownerAccessKey: 'owner-b',
        idempotencyKey: 'idempotency-b',
      },
      2,
    );
    expect(() =>
      attachAgentSessionJob(prepared.state, {
        ...receipt(),
        idempotencyKey: 'substituted-key',
      }),
    ).toThrow(/idempotency binding mismatch/i);

    const running = attachAgentSessionJob(prepared.state, receipt());
    const stale = reconcileAgentSessionJob(running, {
      ...receipt(),
      phase: 'planning',
      progress: 5,
      updatedAt: 9,
    });
    expect(stale).toBe(running);
  });

  it('archives a terminal summary without retaining the owner capability', () => {
    const prepared = prepareAgentSessionJob(
      createInitialAgentSessionState('session-c', 1),
      {
        kind: 'create_deck',
        requestFingerprint: 'intent-c',
        ownerAccessKey: 'owner-secret',
        idempotencyKey: 'idempotency-c',
      },
      2,
    );
    const completed = attachAgentSessionJob(prepared.state, {
      ...receipt(),
      idempotencyKey: 'idempotency-c',
      status: 'succeeded',
      phase: 'complete',
      progress: 100,
      resultDeckId: 'deck-c',
      updatedAt: 20,
    });
    const archived = archiveAgentSessionJob(completed, 21);

    expect(archived.activeJob).toBeNull();
    expect(archived.lastJob).toMatchObject({ jobId: 'job-b', resultDeckId: 'deck-c' });
    expect(archived.lastJob).not.toHaveProperty('ownerAccessKey');
  });

  it('persists an edit target and exact candidate binding across reload', () => {
    const storage = new MemoryStorage();
    const prepared = prepareAgentSessionJob(
      createInitialAgentSessionState('session-edit', 1),
      {
        kind: 'edit_proposal',
        requestFingerprint: 'intent-edit',
        ownerAccessKey: 'deck-owner-key',
        idempotencyKey: 'idempotency-edit',
        targetDeckId: 'deck-edit',
      },
      2,
    );
    const awaitingReview = attachAgentSessionJob(prepared.state, {
      jobId: 'job-edit',
      kind: 'edit_proposal',
      idempotencyKey: 'idempotency-edit',
      status: 'awaiting_review',
      phase: 'awaiting_review',
      progress: 100,
      attempt: 1,
      maxAttempts: 3,
      resultPatchId: 'patch-edit',
      resultCandidateDigest: 'sha256:candidate-edit',
      updatedAt: 3,
    });

    expect(writeAgentSessionState(storage, awaitingReview)).toBe(true);
    expect(readAgentSessionState(storage, 'session-edit', 4).activeJob).toMatchObject({
      kind: 'edit_proposal',
      ownerAccessKey: 'deck-owner-key',
      targetDeckId: 'deck-edit',
      resultPatchId: 'patch-edit',
      resultCandidateDigest: 'sha256:candidate-edit',
    });
  });
});

function receipt() {
  return {
    jobId: 'job-b',
    kind: 'create_deck' as const,
    idempotencyKey: 'idempotency-b',
    status: 'running' as const,
    phase: 'generating',
    progress: 60,
    attempt: 1,
    maxAttempts: 3,
    memoryIds: ['memory-b'],
    updatedAt: 10,
  };
}

function attachment() {
  return {
    id: 'attachment-a',
    name: 'evidence.csv',
    mediaType: 'text/csv',
    content: 'region,revenue\nWest,42',
    lastModified: 123,
  };
}

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
