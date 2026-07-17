// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceRecord } from '../../../../shared/nodeslide';
import { DataInspector } from './DataInspector';

const webSource: SourceRecord = {
  id: 'source-web',
  deckId: 'deck-one',
  title: 'Quarterly results',
  url: 'https://example.com/results',
  sourceType: 'url',
  retrievedAt: Date.now(),
  citation: 'Revenue grew 12%.',
  format: 'web',
  retention: 'public_snapshot',
};

afterEach(cleanup);

describe('NodeSlide evidence source monitoring', () => {
  it('enables monitoring with one explicit source-level action', async () => {
    const user = userEvent.setup();
    const onConfigure = vi.fn().mockResolvedValue(undefined);
    render(
      <DataInspector
        sources={[webSource]}
        selectedElements={[]}
        sourceRefresh={{ schedules: [], proposals: [] }}
        onConfigureSourceRefresh={onConfigure}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Monitor changes for Quarterly results' }));

    await waitFor(() => expect(onConfigure).toHaveBeenCalledWith('source-web', true));
    expect(screen.getByText(/never edits the deck automatically/i)).toBeVisible();
  });

  it('shows a material change as a bounded update handoff', async () => {
    const user = userEvent.setup();
    const onPrepare = vi.fn().mockResolvedValue(undefined);
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(
      <DataInspector
        sources={[webSource]}
        selectedElements={[]}
        sourceRefresh={{
          schedules: [
            {
              id: 'schedule-one',
              deckId: 'deck-one',
              sourceId: webSource.id,
              enabled: true,
              intervalMinutes: 60,
              nextRunAt: Date.now() + 60_000,
              status: 'ready',
              failureCount: 0,
              updatedAt: Date.now(),
            },
          ],
          proposals: [
            {
              id: 'proposal-one',
              deckId: 'deck-one',
              sourceId: webSource.id,
              status: 'ready',
              baseDeckVersion: 3,
              planDigest: 'plan-digest',
              deckCiDigest: 'ci-digest',
              affectedSlideIds: ['slide-one', 'slide-two'],
              affectedElementIds: ['chart-one'],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        }}
        onPrepareSourceRefresh={onPrepare}
        onDismissSourceRefresh={onDismiss}
      />,
    );

    expect(screen.getByText('2 affected slides · 1 bound element')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Prepare update from Quarterly results' }));
    await waitFor(() => expect(onPrepare).toHaveBeenCalledWith('proposal-one'));
    await user.click(screen.getByRole('button', { name: 'Dismiss update from Quarterly results' }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('proposal-one'));
  });

  it('surfaces a failed monitoring request without leaving the control busy', async () => {
    const user = userEvent.setup();
    const onConfigure = vi.fn().mockRejectedValue(new Error('Monitoring service unavailable.'));
    render(
      <DataInspector
        sources={[webSource]}
        selectedElements={[]}
        sourceRefresh={{ schedules: [], proposals: [] }}
        onConfigureSourceRefresh={onConfigure}
      />,
    );

    const monitor = screen.getByRole('button', {
      name: 'Monitor changes for Quarterly results',
    });
    await user.click(monitor);

    expect(await screen.findByRole('alert')).toHaveTextContent('Monitoring service unavailable.');
    expect(monitor).toBeEnabled();
  });
});
