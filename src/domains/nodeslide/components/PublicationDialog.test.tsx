// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeSlidePublication } from '../../../../shared/nodeslide';
import { PublicationDialog, type PublishApprovalView } from './PublicationDialog';

const publication: NodeSlidePublication = {
  id: 'publication:1',
  deckId: 'deck:1',
  shareSlug: 'share-private',
  revision: 1,
  deckVersion: 4,
  validationId: 'validation:4',
  status: 'active',
  publishedAt: 1,
};

// The studio shell (.nodeslide-studio) is always mounted before a dialog opens in production,
// so the dialog's portalContainer is stable from its first render. Mirror that here by mounting
// the host before render; otherwise the portal target flips null -> element on the first update
// and Radix remounts the subtree, dropping the first keystroke.
const hosts: HTMLElement[] = [];
function renderInStudio(ui: ReactElement) {
  const host = document.createElement('div');
  host.className = 'nodeslide-studio';
  document.body.appendChild(host);
  hosts.push(host);
  return render(ui, { container: host });
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof PublicationDialog>> = {}) {
  return renderInStudio(
    <PublicationDialog
      open
      publication={publication}
      shareUrl="https://example.com/s/share-private"
      currentDeckVersion={5}
      busy={false}
      onClose={() => undefined}
      onCopy={() => undefined}
      onPublish={() => undefined}
      onRevoke={() => undefined}
      {...overrides}
    />,
  );
}

const awaitingApproval: PublishApprovalView = {
  required: true,
  deckVersion: 5,
  approvers: [{ approverId: 'approver:1', label: 'Reviewer A', revoked: false }],
  currentVersionApprovals: [],
};

describe('NodeSlide publication dialog', () => {
  afterEach(() => {
    cleanup();
    for (const host of hosts.splice(0)) host.remove();
  });

  it('explains immutable sanitized sharing and exposes revocation', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toHaveTextContent('immutable snapshot');
    expect(screen.getByRole('dialog')).toHaveTextContent('Speaker notes');
    expect(screen.getByRole('dialog')).toHaveTextContent('Version 4 remains published');
    expect(screen.getByRole('button', { name: 'Publish current version & copy' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Revoke link' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Published view-only link' })).toBeVisible();
  });

  it('hides the governance section entirely until the approval query resolves', () => {
    renderDialog();
    expect(screen.queryByTestId('publish-approval-section')).toBeNull();
  });

  it('renders the toggle alone when sign-off is not required', () => {
    const approval: PublishApprovalView = {
      required: false,
      deckVersion: 5,
      approvers: [],
      currentVersionApprovals: [],
    };
    renderDialog({ approval, onToggleApprovalRequired: () => undefined });

    const section = screen.getByTestId('publish-approval-section');
    expect(within(section).getByText('Require approver sign-off')).toBeVisible();
    // With the requirement off, no approver management or sign-off surfaces exist to mislead.
    expect(within(section).queryByText(/Awaiting sign-off/)).toBeNull();
    expect(within(section).queryByLabelText('New approver name')).toBeNull();
  });

  it('reports the awaiting state and honestly forwards a requirement toggle', async () => {
    const user = userEvent.setup();
    const onToggleApprovalRequired = vi.fn();
    renderDialog({ approval: awaitingApproval, onToggleApprovalRequired });

    const section = screen.getByTestId('publish-approval-section');
    expect(within(section).getByText('Awaiting sign-off for v5.')).toBeVisible();

    await user.click(within(section).getByLabelText('Require approver sign-off before publishing'));
    expect(onToggleApprovalRequired).toHaveBeenCalledWith(false);
  });

  it('issues an approver with a trimmed name only when the field is non-empty', async () => {
    const user = userEvent.setup();
    const onIssueApprover = vi.fn();
    renderDialog({
      approval: awaitingApproval,
      onToggleApprovalRequired: () => undefined,
      onIssueApprover,
    });

    const section = screen.getByTestId('publish-approval-section');
    const issueButton = within(section).getByRole('button', { name: 'Issue approver' });
    // Blank field cannot issue a phantom approver.
    expect(issueButton).toBeDisabled();

    await user.type(within(section).getByLabelText('New approver name'), '  Reviewer B  ');
    expect(issueButton).toBeEnabled();
    await user.click(issueButton);
    expect(onIssueApprover).toHaveBeenCalledWith('Reviewer B');
  });

  it('signs off the current version from a pasted capability token', async () => {
    const user = userEvent.setup();
    const onApproveWithToken = vi.fn();
    renderDialog({
      approval: awaitingApproval,
      onToggleApprovalRequired: () => undefined,
      onApproveWithToken,
    });

    const section = screen.getByTestId('publish-approval-section');
    const signButton = within(section).getByRole('button', { name: 'Sign off v5' });
    expect(signButton).toBeDisabled();

    await user.type(
      within(section).getByLabelText('Approver capability token to sign off'),
      ' cap-token-xyz ',
    );
    expect(signButton).toBeEnabled();
    await user.click(signButton);
    // The sign-off carries the exact version the button was labeled with (v5), so the server
    // can reject an attestation whose reviewed version no longer matches the current deck.
    expect(onApproveWithToken).toHaveBeenCalledWith('cap-token-xyz', 5);
  });

  it('pins the reviewed version so a mid-review deck advance blocks sign-off instead of re-targeting', async () => {
    const user = userEvent.setup();
    const onApproveWithToken = vi.fn();
    const baseProps = {
      open: true as const,
      publication,
      shareUrl: 'https://example.com/s/share-private',
      currentDeckVersion: 5,
      busy: false,
      approval: awaitingApproval,
      onToggleApprovalRequired: () => undefined,
      onApproveWithToken,
      onClose: () => undefined,
      onCopy: () => undefined,
      onPublish: () => undefined,
      onRevoke: () => undefined,
    };
    const view = renderInStudio(<PublicationDialog {...baseProps} />);
    const section = screen.getByTestId('publish-approval-section');
    // Approver begins review of v5 by entering their token — this PINS v5.
    await user.type(
      within(section).getByLabelText('Approver capability token to sign off'),
      'cap-token-xyz',
    );
    // The owner commits an edit; the reactive approval query re-renders with v6.
    view.rerender(
      <PublicationDialog {...baseProps} approval={{ ...awaitingApproval, deckVersion: 6 }} />,
    );
    const advanced = screen.getByTestId('publish-approval-section');
    // The button stays pinned to v5 (never silently relabels to v6), is disabled, and an
    // explicit drift alert appears — the approver cannot attest to a version they never saw.
    const signButton = within(advanced).getByRole('button', { name: 'Sign off v5' });
    expect(signButton).toBeDisabled();
    expect(within(advanced).getByRole('alert')).toHaveTextContent('The deck advanced to v6');
    await user.click(signButton);
    expect(onApproveWithToken).not.toHaveBeenCalled();
  });

  it('clears a pasted approver capability when the dialog closes so it cannot leak into a later session', async () => {
    const user = userEvent.setup();
    const baseProps = {
      open: true as const,
      publication,
      shareUrl: 'https://example.com/s/share-private',
      currentDeckVersion: 5,
      busy: false,
      approval: awaitingApproval,
      onToggleApprovalRequired: () => undefined,
      onApproveWithToken: () => undefined,
      onClose: () => undefined,
      onCopy: () => undefined,
      onPublish: () => undefined,
      onRevoke: () => undefined,
    };
    const view = renderInStudio(<PublicationDialog {...baseProps} />);
    const field = () =>
      within(screen.getByTestId('publish-approval-section')).getByLabelText(
        'Approver capability token to sign off',
      ) as HTMLInputElement;
    await user.type(field(), 'cap-token-secret');
    expect(field().value).toBe('cap-token-secret');
    // The dialog is never unmounted — closing then reopening must not resurrect the bearer token.
    view.rerender(<PublicationDialog {...baseProps} open={false} />);
    view.rerender(<PublicationDialog {...baseProps} open={true} />);
    expect(field().value).toBe('');
  });

  it('shows an issued capability exactly once and warns it is not stored', () => {
    renderDialog({
      approval: awaitingApproval,
      onToggleApprovalRequired: () => undefined,
      onIssueApprover: () => undefined,
      onApproveWithToken: () => undefined,
      issuedApproverToken: { label: 'Reviewer A', token: 'ns-approver-secret-capability' },
    });

    const tokenBox = screen.getByTestId('issued-approver-token');
    expect(within(tokenBox).getByLabelText('Approver capability token')).toHaveValue(
      'ns-approver-secret-capability',
    );
    expect(tokenBox).toHaveTextContent('shown once');
    expect(tokenBox).toHaveTextContent('Only its digest is stored');
  });

  it('reports a signed-off version and removes the sign-off entry point', () => {
    const approval: PublishApprovalView = {
      required: true,
      deckVersion: 5,
      approvers: [{ approverId: 'approver:1', label: 'Reviewer A', revoked: false }],
      currentVersionApprovals: [{ approverId: 'approver:1', approvedAt: 1000 }],
    };
    renderDialog({
      approval,
      onToggleApprovalRequired: () => undefined,
      onApproveWithToken: () => undefined,
    });

    const section = screen.getByTestId('publish-approval-section');
    expect(within(section).getByText(/signed\s+off by/)).toHaveTextContent('Reviewer A');
    // Once signed off, the paste-token affordance is gone — no duplicate sign-off path.
    expect(within(section).queryByLabelText('Approver capability token to sign off')).toBeNull();
  });

  it('revokes a named approver by id', async () => {
    const user = userEvent.setup();
    const onRevokeApprover = vi.fn();
    const approval: PublishApprovalView = {
      required: true,
      deckVersion: 5,
      approvers: [{ approverId: 'approver:9', label: 'Reviewer Z', revoked: false }],
      currentVersionApprovals: [],
    };
    renderDialog({
      approval,
      onToggleApprovalRequired: () => undefined,
      onRevokeApprover,
    });

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onRevokeApprover).toHaveBeenCalledWith('approver:9');
  });

  it('disables governance controls while an approval action is in flight so a double-click cannot double-issue', async () => {
    const user = userEvent.setup();
    let resolveIssue: () => void = () => undefined;
    const onIssueApprover = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveIssue = resolve;
        }),
    );
    renderDialog({
      approval: awaitingApproval,
      onToggleApprovalRequired: () => undefined,
      onIssueApprover,
    });

    await user.type(screen.getByLabelText('New approver name'), 'Reviewer B');
    const issueButton = screen.getByRole('button', { name: 'Issue approver' });
    await user.click(issueButton);
    // In flight: the button reports progress and every governance control is disabled —
    // a second click (the double-issue path) must be impossible, not merely unlikely.
    const busyButton = screen.getByRole('button', { name: 'Issuing…' });
    expect(busyButton).toBeDisabled();
    expect(screen.getByLabelText('Require approver sign-off before publishing')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
    expect(onIssueApprover).toHaveBeenCalledTimes(1);

    resolveIssue();
    // Settled: controls re-arm for the next action.
    expect(await screen.findByRole('button', { name: 'Issue approver' })).toBeInTheDocument();
    expect(screen.getByLabelText('Require approver sign-off before publishing')).toBeEnabled();
  });

  it('shows the approver review link beside the issued capability with a separate-channels warning', () => {
    renderDialog({
      approval: awaitingApproval,
      onToggleApprovalRequired: () => undefined,
      issuedApproverToken: { label: 'Reviewer A', token: 'capability-token' },
      approverReviewUrl: 'https://example.com/?approve=deck%3A1',
    });

    const link = screen.getByTestId('approver-review-link');
    expect(link).toHaveValue('https://example.com/?approve=deck%3A1');
    expect(screen.getByTestId('issued-approver-token')).toHaveTextContent('separate channels');
  });
});
