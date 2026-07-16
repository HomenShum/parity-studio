import { describe, expect, it } from 'vitest';
import {
  archiveAgentSessionJob,
  attachAgentSessionJob,
  classifyAgentSessionJobFreshness,
  createInitialAgentSessionState,
  failAgentSessionJob,
  isAgentSessionEditAuthorityLocked,
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
        approval: {
          mode: 'auto_apply',
          deckId: 'deck-a',
          grantId: 'grant-a',
          token: 'token-a',
          policyDigest: 'sha256:policy-a',
          issuedAt: 2,
          expiresAt: 100,
          maxUses: 20,
          maxOperations: 8,
        },
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
      budgetId: 'budget-a',
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
      approval: {
        mode: 'auto_apply',
        deckId: 'deck-a',
        grantId: 'grant-a',
        token: 'token-a',
        policyDigest: 'sha256:policy-a',
        issuedAt: 2,
        expiresAt: 100,
        maxUses: 20,
        maxOperations: 8,
      },
    });
    expect(reloaded.controls.attachments).toEqual([attachment()]);
    expect(reloaded.activeJob).toMatchObject({
      jobId: 'job-a',
      ownerAccessKey: 'owner-a',
      idempotencyKey: 'idempotency-a',
      phase: 'generating',
      progress: 42,
      conversationRunId: 'run-a',
      budgetId: 'budget-a',
      memoryIds: ['memory-a'],
    });
  });

  it.each(['paused', 'retrying'] as const)(
    'rehydrates a %s durable job with progress and owner binding intact',
    (status) => {
      const storage = new MemoryStorage();
      const prepared = prepareAgentSessionJob(
        createInitialAgentSessionState(`session-${status}`, 1),
        {
          kind: 'create_deck',
          requestFingerprint: `intent-${status}`,
          ownerAccessKey: `owner-${status}`,
          idempotencyKey: `idempotency-${status}`,
        },
        2,
      );
      const durable = attachAgentSessionJob(prepared.state, {
        ...receipt(),
        idempotencyKey: `idempotency-${status}`,
        status,
        phase: status,
        progress: 55,
        updatedAt: 20,
      });

      expect(writeAgentSessionState(storage, durable)).toBe(true);
      expect(readAgentSessionState(storage, `session-${status}`, 21).activeJob).toMatchObject({
        status,
        phase: status,
        progress: 55,
        ownerAccessKey: `owner-${status}`,
      });
    },
  );

  it('reports stale heartbeat as stalled without replacing the durable running state', () => {
    const prepared = prepareAgentSessionJob(
      createInitialAgentSessionState('session-stalled', 1),
      {
        kind: 'create_deck',
        requestFingerprint: 'intent-stalled',
        ownerAccessKey: 'owner-stalled',
        idempotencyKey: 'idempotency-stalled',
      },
      2,
    );
    const running = attachAgentSessionJob(prepared.state, {
      ...receipt(),
      idempotencyKey: 'idempotency-stalled',
      updatedAt: 10,
    });

    expect(classifyAgentSessionJobFreshness(running.activeJob, 109, 100)).toBe('fresh');
    expect(classifyAgentSessionJobFreshness(running.activeJob, 110, 100)).toBe('stalled');
    expect(running.activeJob).toMatchObject({ status: 'running', updatedAt: 10 });
  });

  it('fails closed when a persisted auto-apply grant is incomplete', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'nodeslide.agent-session:v1:session-approval',
      JSON.stringify({
        version: 1,
        clientSessionId: 'session-approval',
        surface: 'editor',
        controls: {
          model: 'deterministic',
          effort: 'medium',
          scope: {
            kind: 'slide',
            operationMode: 'unrestricted',
            slideIds: [],
            elementIds: [],
          },
          attachments: [],
          web: { enabled: false, consentGranted: false },
          memory: { mode: 'off', references: [] },
          approval: { mode: 'auto_apply', deckId: 'deck-a' },
        },
        activeJob: null,
        lastJob: null,
        updatedAt: 1,
      }),
    );

    expect(readAgentSessionState(storage, 'session-approval', 2).controls.approval).toEqual({
      mode: 'review',
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

  it.each(['rejected', 'stale'] as const)(
    'rehydrates and archives a %s durable job without allowing a local failure override',
    (status) => {
      const storage = new MemoryStorage();
      const prepared = prepareAgentSessionJob(
        createInitialAgentSessionState(`session-${status}`, 1),
        {
          kind: 'edit_proposal',
          requestFingerprint: `intent-${status}`,
          ownerAccessKey: `owner-${status}`,
          idempotencyKey: `idempotency-${status}`,
          targetDeckId: 'deck-terminal',
        },
        2,
      );
      const terminal = attachAgentSessionJob(prepared.state, {
        jobId: `job-${status}`,
        kind: 'edit_proposal',
        idempotencyKey: `idempotency-${status}`,
        status,
        phase: status,
        progress: 100,
        attempt: 1,
        maxAttempts: 3,
        resultPatchId: 'patch-terminal',
        resultCandidateDigest: 'sha256:candidate-terminal',
        budgetId: 'budget-terminal',
        error: `The proposal became ${status}.`,
        updatedAt: 3,
      });

      expect(writeAgentSessionState(storage, terminal)).toBe(true);
      const reloaded = readAgentSessionState(storage, `session-${status}`, 4);
      expect(reloaded.activeJob).toMatchObject({
        status,
        phase: status,
        budgetId: 'budget-terminal',
      });
      expect(
        failAgentSessionJob(reloaded, 'Local fallback must not replace terminal state.', 5),
      ).toBe(reloaded);

      const archived = archiveAgentSessionJob(reloaded, 6);
      expect(archived.activeJob).toBeNull();
      expect(archived.lastJob).toMatchObject({ status, budgetId: 'budget-terminal' });
      expect(archived.lastJob).not.toHaveProperty('ownerAccessKey');
    },
  );

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
    expect(isAgentSessionEditAuthorityLocked(awaitingReview.activeJob)).toBe(true);
    expect(
      isAgentSessionEditAuthorityLocked(
        readAgentSessionState(storage, 'session-edit', 4).activeJob,
      ),
    ).toBe(true);
    expect(isAgentSessionEditAuthorityLocked(null)).toBe(false);
  });

  it('fails and archives an unrecoverable active edit job to release its authority lock', () => {
    const prepared = prepareAgentSessionJob(
      createInitialAgentSessionState('session-unrecoverable', 1),
      {
        kind: 'edit_proposal',
        requestFingerprint: 'intent-unrecoverable',
        ownerAccessKey: 'owner-unrecoverable',
        idempotencyKey: 'idempotency-unrecoverable',
        targetDeckId: 'deck-unrecoverable',
      },
      2,
    ).state;
    expect(isAgentSessionEditAuthorityLocked(prepared.activeJob)).toBe(true);

    const failed = failAgentSessionJob(prepared, 'The durable receipt is unavailable.', 3);
    expect(failed.activeJob).toMatchObject({ status: 'failed' });
    const archived = archiveAgentSessionJob(failed, 4);
    expect(archived.activeJob).toBeNull();
    expect(archived.lastJob).toMatchObject({
      status: 'failed',
      error: 'The durable receipt is unavailable.',
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
