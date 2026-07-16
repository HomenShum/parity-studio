// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useNodeSlideComposerSession } from '../composer/nodeSlideComposerSession';
import { AgentSessionProvider, useAgentSession } from './AgentSessionProvider';
import { agentSessionStorageKey } from './agentSessionState';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe('AgentSessionProvider', () => {
  it('shares controls and attachments across landing, create, and editor and restores them', () => {
    const first = renderSession();

    fireEvent.click(screen.getByRole('button', { name: 'Attach from landing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose deterministic' }));

    expect(screen.getByTestId('landing-attachments')).toHaveTextContent('1');
    expect(screen.getByTestId('create-attachments')).toHaveTextContent('1');
    expect(screen.getByTestId('editor-attachments')).toHaveTextContent('1');
    expect(screen.getByTestId('shared-model')).toHaveTextContent('deterministic');

    first.unmount();
    renderSession();

    expect(screen.getByTestId('landing-attachments')).toHaveTextContent('1');
    expect(screen.getByTestId('create-attachments')).toHaveTextContent('1');
    expect(screen.getByTestId('editor-attachments')).toHaveTextContent('1');
    expect(screen.getByTestId('shared-model')).toHaveTextContent('deterministic');
  });

  it('reuses the owner capability and idempotency key after an ambiguous admission failure', () => {
    renderSession();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare job' }));
    const firstBinding = screen.getByTestId('job-binding').textContent;
    expect(screen.getByTestId('job-status')).toHaveTextContent('failed');

    fireEvent.click(screen.getByRole('button', { name: 'Prepare job' }));

    expect(screen.getByTestId('job-status')).toHaveTextContent('preparing');
    expect(screen.getByTestId('job-binding').textContent).toBe(firstBinding);
  });

  it('binds edit jobs to the existing deck owner capability and target deck', () => {
    renderSession();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare edit job' }));

    expect(screen.getByTestId('job-binding')).toHaveTextContent('deck-owner-key|');
    expect(screen.getByTestId('job-target')).toHaveTextContent('deck-a');
  });

  it('persists a revocable deck-scoped auto-apply grant', () => {
    const first = renderSession();
    fireEvent.click(screen.getByRole('button', { name: 'Install auto-apply grant' }));

    expect(screen.getByTestId('approval-mode')).toHaveTextContent('auto_apply');
    expect(screen.getByTestId('approval-deck')).toHaveTextContent('deck-a');
    expect(screen.getByTestId('approval-grant')).toHaveTextContent('grant-a');

    first.unmount();
    renderSession();
    expect(screen.getByTestId('approval-mode')).toHaveTextContent('auto_apply');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke auto-apply grant' }));
    expect(screen.getByTestId('approval-mode')).toHaveTextContent('review');
    expect(screen.getByTestId('approval-grant')).toHaveTextContent('none');
  });

  it('keeps bearer capabilities in session storage instead of persistent local storage', () => {
    renderSession();
    fireEvent.click(screen.getByRole('button', { name: 'Install auto-apply grant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare edit job' }));

    const storedSession = window.sessionStorage.getItem(agentSessionStorageKey('shared-session'));
    expect(window.sessionStorage.length).toBeGreaterThan(0);
    expect(storedSession).toContain('delegation-token-a');
    expect(storedSession).toContain('deck-owner-key');
    expect(window.localStorage.length).toBe(0);
  });

  it('surfaces heartbeat freshness without turning a stalled job into a terminal result', () => {
    renderSession();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare edit job' }));
    fireEvent.click(screen.getByRole('button', { name: 'Attach running receipt' }));

    expect(screen.getByTestId('job-status')).toHaveTextContent('running');
    expect(screen.getByTestId('job-freshness')).toHaveTextContent('stalled');
  });
});

function renderSession() {
  let secret = 0;
  return render(
    <AgentSessionProvider
      clientSessionId="shared-session"
      createSecret={() => `secret-${++secret}`}
      now={() => 10}
    >
      <SessionHarness />
    </AgentSessionProvider>,
  );
}

function SessionHarness() {
  const session = useAgentSession();
  const landing = useNodeSlideComposerSession('landing:shared-session');
  const create = useNodeSlideComposerSession('project:shared-session');
  const editor = useNodeSlideComposerSession('editor:deck-a');
  const job = session.state.activeJob;

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          landing.setAttachments([
            {
              id: 'shared-attachment',
              name: 'shared.csv',
              mediaType: 'text/csv',
              content: 'a,b\n1,2',
              lastModified: 1,
            },
          ])
        }
      >
        Attach from landing
      </button>
      <button type="button" onClick={() => session.updateControls({ model: 'deterministic' })}>
        Choose deterministic
      </button>
      <button
        type="button"
        onClick={() => {
          session.prepareJob({ kind: 'create_deck', requestFingerprint: 'same-request' });
          if (session.state.activeJob?.status !== 'failed') {
            session.failPreparedJob('Admission response was lost.');
          }
        }}
      >
        Prepare job
      </button>
      <button
        type="button"
        onClick={() =>
          session.prepareJob({
            kind: 'edit_proposal',
            requestFingerprint: 'edit-request',
            targetDeckId: 'deck-a',
            ownerAccessKey: 'deck-owner-key',
          })
        }
      >
        Prepare edit job
      </button>
      <button
        type="button"
        onClick={() =>
          session.attachJob({
            jobId: 'job-edit',
            kind: 'edit_proposal',
            idempotencyKey: job?.idempotencyKey ?? '',
            status: 'running',
            phase: 'generating',
            progress: 40,
            attempt: 1,
            maxAttempts: 3,
            updatedAt: 10,
          })
        }
      >
        Attach running receipt
      </button>
      <button
        type="button"
        onClick={() =>
          session.installApprovalGrant({
            mode: 'auto_apply',
            deckId: 'deck-a',
            grantId: 'grant-a',
            token: 'delegation-token-a',
            policyDigest: 'sha256:policy-a',
            issuedAt: 1,
            expiresAt: 100,
            maxUses: 20,
            maxOperations: 8,
          })
        }
      >
        Install auto-apply grant
      </button>
      <button type="button" onClick={session.clearApprovalGrant}>
        Revoke auto-apply grant
      </button>
      <output data-testid="landing-attachments">{landing.attachments.length}</output>
      <output data-testid="create-attachments">{create.attachments.length}</output>
      <output data-testid="editor-attachments">{editor.attachments.length}</output>
      <output data-testid="shared-model">{session.state.controls.model}</output>
      <output data-testid="job-status">{job?.status ?? 'none'}</output>
      <output data-testid="job-binding">
        {job ? `${job.ownerAccessKey}|${job.idempotencyKey}` : 'none'}
      </output>
      <output data-testid="job-target">{job?.targetDeckId ?? 'none'}</output>
      <output data-testid="job-freshness">{session.getJobFreshness(200_011)}</output>
      <output data-testid="approval-mode">{session.state.controls.approval.mode}</output>
      <output data-testid="approval-deck">
        {session.state.controls.approval.mode === 'auto_apply'
          ? session.state.controls.approval.deckId
          : 'none'}
      </output>
      <output data-testid="approval-grant">
        {session.state.controls.approval.mode === 'auto_apply'
          ? session.state.controls.approval.grantId
          : 'none'}
      </output>
    </div>
  );
}
