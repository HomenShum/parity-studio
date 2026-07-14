// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useNodeSlideComposerSession } from '../composer/nodeSlideComposerSession';
import { AgentSessionProvider, useAgentSession } from './AgentSessionProvider';

beforeEach(() => window.localStorage.clear());
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
});

function renderSession() {
  let secret = 0;
  return render(
    <AgentSessionProvider
      clientSessionId="shared-session"
      createSecret={() => `secret-${++secret}`}
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
      <output data-testid="landing-attachments">{landing.attachments.length}</output>
      <output data-testid="create-attachments">{create.attachments.length}</output>
      <output data-testid="editor-attachments">{editor.attachments.length}</output>
      <output data-testid="shared-model">{session.state.controls.model}</output>
      <output data-testid="job-status">{job?.status ?? 'none'}</output>
      <output data-testid="job-binding">
        {job ? `${job.ownerAccessKey}|${job.idempotencyKey}` : 'none'}
      </output>
      <output data-testid="job-target">{job?.targetDeckId ?? 'none'}</output>
    </div>
  );
}
