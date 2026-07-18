// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectDialog, type SessionRunReceipt } from './ProjectDialog';

function renderDialog(overrides: Partial<React.ComponentProps<typeof ProjectDialog>> = {}) {
  return render(
    <div className="nodeslide-studio">
      <ProjectDialog
        open
        clientSessionId="session:test"
        recentDecks={[]}
        creating={false}
        onClose={() => undefined}
        onCreate={() => undefined}
        onOpenDeck={() => undefined}
        initialMode="open"
        {...overrides}
      />
    </div>,
  );
}

const proposalReceipt: SessionRunReceipt = {
  jobId: 'job:1',
  kind: 'create_deck',
  status: 'succeeded',
  updatedAt: 1_700_000_000_000,
  resultDeckId: 'deck:1',
  renderRepair: {
    status: 'proposed',
    terminalReason: 'proposed_repair',
    proposalOperationCount: 3,
    proposal: {
      deckId: 'deck:1',
      baseDeckVersion: 4,
      baseSlideVersions: { 'slide:1': 2 },
      baseElementVersions: { 'element:1': 5 },
      scope: { kind: 'slide', slideId: 'slide:1' },
      operations: [{ op: 'a' }, { op: 'b' }, { op: 'c' }],
    },
  },
};

describe('NodeSlide project dialog — session runs dashboard', () => {
  afterEach(cleanup);

  it('offers one-click apply of a recorded render-repair proposal', () => {
    const onApplyRepairs = vi.fn();
    renderDialog({ sessionJobs: [proposalReceipt], onApplyRepairs });

    const dashboard = screen.getByTestId('session-runs-dashboard');
    // The button surfaces the exact operation count the proposal will apply — no rounding, no bluff.
    const applyButton = within(dashboard).getByRole('button', { name: 'Apply repairs (3)' });
    fireEvent.click(applyButton);
    expect(onApplyRepairs).toHaveBeenCalledTimes(1);
    expect(onApplyRepairs).toHaveBeenCalledWith(proposalReceipt);
  });

  it('discloses the residual when only the first batch of a multi-attempt repair is applicable', () => {
    // The proposal (8 ops) binds the persisted base; proposalOperationCount (12) is the
    // total across attempts. The button must not imply the deck is fully repaired.
    const partial: SessionRunReceipt = {
      ...proposalReceipt,
      jobId: 'job:partial',
      renderRepair: {
        status: 'proposed',
        terminalReason: 'proposed_repair',
        proposalOperationCount: 12,
        proposal: {
          deckId: 'deck:1',
          baseDeckVersion: 4,
          baseSlideVersions: {},
          baseElementVersions: {},
          scope: { kind: 'deck' },
          operations: Array.from({ length: 8 }, (_, index) => ({ op: `op-${index}` })),
        },
      },
    };
    renderDialog({ sessionJobs: [partial], onApplyRepairs: () => undefined });
    const dashboard = screen.getByTestId('session-runs-dashboard');
    expect(
      within(dashboard).getByRole('button', { name: 'Apply repairs (8 of 12)' }),
    ).toBeVisible();
  });

  it('does not offer apply when the repair terminated without an applicable proposal', () => {
    // A repair loop can exhaust its budget and record evidence but no live-applicable proposal.
    const exhausted: SessionRunReceipt = {
      jobId: 'job:2',
      kind: 'edit_proposal',
      status: 'succeeded',
      updatedAt: 1_700_000_000_000,
      renderRepair: {
        status: 'exhausted',
        terminalReason: 'repair_budget_exhausted',
        proposalOperationCount: 0,
      },
    };
    renderDialog({ sessionJobs: [exhausted], onApplyRepairs: () => undefined });

    const dashboard = screen.getByTestId('session-runs-dashboard');
    expect(within(dashboard).queryByRole('button', { name: /Apply repairs/ })).toBeNull();
  });

  it('withholds the apply affordance when no handler is wired', () => {
    renderDialog({ sessionJobs: [proposalReceipt] });
    const dashboard = screen.getByTestId('session-runs-dashboard');
    expect(within(dashboard).queryByRole('button', { name: /Apply repairs/ })).toBeNull();
  });

  it('renders no dashboard when the session has no runs', () => {
    renderDialog({ sessionJobs: [] });
    expect(screen.queryByTestId('session-runs-dashboard')).toBeNull();
  });
});
