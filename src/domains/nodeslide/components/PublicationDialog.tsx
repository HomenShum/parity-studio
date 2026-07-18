import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ClipboardCopy, Link2, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NodeSlidePublication } from '../../../../shared/nodeslide';

export interface PublishApprovalView {
  required: boolean;
  deckVersion: number;
  approvers: Array<{ approverId: string; label: string; revoked: boolean }>;
  currentVersionApprovals: Array<{ approverId: string; approvedAt: number }>;
}

interface PublicationDialogProps {
  open: boolean;
  publication: NodeSlidePublication | null;
  shareUrl: string | null;
  currentDeckVersion: number;
  busy: boolean;
  /** D9 governance state + actions; omitted while the approval query loads. */
  approval?: PublishApprovalView;
  issuedApproverToken?: { label: string; token: string } | null;
  onToggleApprovalRequired?: (required: boolean) => void;
  onIssueApprover?: (label: string) => void;
  onRevokeApprover?: (approverId: string) => void;
  onApproveWithToken?: (token: string, reviewedDeckVersion: number) => void;
  onClose: () => void;
  onCopy: () => void;
  onPublish: () => void;
  onRevoke: () => void;
}

export function PublicationDialog({
  open,
  publication,
  shareUrl,
  currentDeckVersion,
  busy,
  approval,
  issuedApproverToken = null,
  onToggleApprovalRequired,
  onIssueApprover,
  onRevokeApprover,
  onApproveWithToken,
  onClose,
  onCopy,
  onPublish,
  onRevoke,
}: PublicationDialogProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [approverName, setApproverName] = useState('');
  const [approverToken, setApproverToken] = useState('');
  // The version an approver signs off must be PINNED when they begin reviewing (first token
  // entry), never read live from the reactive approval query at click time — otherwise a
  // concurrent owner edit advancing the deck silently re-targets the attestation to a newer,
  // unreviewed version and the server CAS (which compares against the current version) passes.
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  // The dialog is never unmounted (only Radix's portal DOM toggles), so its local state
  // survives close/reopen and deck switches. Clear the pasted approver capability — a bearer
  // secret — plus the pinned version and draft name whenever the dialog closes, matching the
  // "shown once, cleared on close" hygiene already given to the issued token.
  useEffect(() => {
    if (!open) {
      setApproverToken('');
      setReviewedVersion(null);
      setApproverName('');
    }
  }, [open]);
  const active = publication?.status === 'active';
  const current = active && publication.deckVersion === currentDeckVersion;
  const governanceReady = approval !== undefined && onToggleApprovalRequired !== undefined;
  const approvedForCurrent = (approval?.currentVersionApprovals.length ?? 0) > 0;
  const approverLabelById = new Map(
    (approval?.approvers ?? []).map((entry) => [entry.approverId, entry.label]),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}
    >
      <DialogContent
        className="ns-share-dialog"
        overlayClassName="ns-share-dialog-backdrop"
        portalContainer={
          typeof document === 'undefined'
            ? null
            : document.querySelector<HTMLElement>('.nodeslide-studio')
        }
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          primaryRef.current?.focus();
        }}
      >
        <header>
          <span aria-hidden="true">
            <Link2 size={20} />
          </span>
          <div>
            <small>View-only publication</small>
            <DialogTitle asChild>
              <h1>Share a frozen, validated deck</h1>
            </DialogTitle>
          </div>
          <DialogClose asChild>
            <button
              className="ns-icon-button"
              type="button"
              disabled={busy}
              aria-label="Close share dialog"
            >
              <X size={16} />
            </button>
          </DialogClose>
        </header>
        <div className="ns-share-dialog-body">
          <DialogDescription asChild>
            <p>
              A share link opens an immutable snapshot. Speaker notes, the creation brief, private
              project context, and non-public sources are excluded.
            </p>
          </DialogDescription>
          <div className={`ns-share-status ${active ? 'is-active' : ''}`}>
            <ShieldCheck size={17} aria-hidden="true" />
            <span>
              <strong>
                {current
                  ? `Version ${publication.deckVersion} is published`
                  : active
                    ? `Version ${publication.deckVersion} remains published`
                    : publication?.status === 'revoked'
                      ? 'The previous link is revoked'
                      : 'No public link exists yet'}
              </strong>
              <small>
                {current
                  ? 'Later edits will not change this link until you publish again.'
                  : active
                    ? `Your editor is now version ${currentDeckVersion}; the existing link has not changed.`
                    : 'Publishing requires the current version to pass the server validation gate.'}
              </small>
            </span>
          </div>
          {governanceReady ? (
            <section className="ns-share-approval" data-testid="publish-approval-section">
              <label className="ns-share-approval-toggle">
                <input
                  type="checkbox"
                  checked={approval.required}
                  disabled={busy}
                  onChange={(event) => onToggleApprovalRequired?.(event.currentTarget.checked)}
                  aria-label="Require approver sign-off before publishing"
                />
                <span>
                  <strong>Require approver sign-off</strong>
                  <small>
                    When on, publishing v{approval.deckVersion} needs a sign-off from an approver
                    capability — a separate role the server checks on every publish.
                  </small>
                </span>
              </label>
              {approval.required ? (
                <>
                  <div
                    className={`ns-share-approval-state ${approvedForCurrent ? 'is-approved' : ''}`}
                  >
                    {approvedForCurrent ? (
                      <>
                        <ShieldCheck size={14} aria-hidden="true" /> v{approval.deckVersion} signed
                        off by{' '}
                        {approval.currentVersionApprovals
                          .map((entry) => approverLabelById.get(entry.approverId) ?? 'approver')
                          .join(', ')}
                      </>
                    ) : (
                      <>Awaiting sign-off for v{approval.deckVersion}.</>
                    )}
                  </div>
                  <ul className="ns-share-approvers">
                    {approval.approvers.map((entry) => (
                      <li key={entry.approverId} className={entry.revoked ? 'is-revoked' : ''}>
                        <span>{entry.label}</span>
                        {entry.revoked ? (
                          <small>revoked</small>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onRevokeApprover?.(entry.approverId)}
                          >
                            Revoke
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="ns-share-approval-row">
                    <input
                      type="text"
                      value={approverName}
                      placeholder="Approver name"
                      maxLength={80}
                      disabled={busy}
                      aria-label="New approver name"
                      onChange={(event) => setApproverName(event.currentTarget.value)}
                    />
                    <button
                      className="ns-button ns-button--quiet"
                      type="button"
                      disabled={busy || approverName.trim().length === 0}
                      onClick={() => {
                        onIssueApprover?.(approverName.trim());
                        setApproverName('');
                      }}
                    >
                      Issue approver
                    </button>
                  </div>
                  {issuedApproverToken ? (
                    <div className="ns-share-approval-token" data-testid="issued-approver-token">
                      <strong>{issuedApproverToken.label}'s capability — shown once:</strong>
                      <input
                        type="text"
                        readOnly
                        value={issuedApproverToken.token}
                        onFocus={(event) => event.currentTarget.select()}
                        aria-label="Approver capability token"
                      />
                      <small>
                        Share it with the approver over a trusted channel. Only its digest is
                        stored; this dialog will not show it again.
                      </small>
                    </div>
                  ) : null}
                  {!approvedForCurrent ? (
                    <div className="ns-share-approval-row">
                      <input
                        type="password"
                        value={approverToken}
                        placeholder="Paste an approver capability to sign off"
                        disabled={busy}
                        aria-label="Approver capability token to sign off"
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setApproverToken(value);
                          // Pin the reviewed version on first token entry; release it when the
                          // field is cleared so a fresh review re-pins to the current version.
                          setReviewedVersion((prev) =>
                            value.trim().length === 0 ? null : (prev ?? approval.deckVersion),
                          );
                        }}
                      />
                      <button
                        className="ns-button ns-button--quiet"
                        type="button"
                        disabled={
                          busy ||
                          approverToken.trim().length === 0 ||
                          (reviewedVersion !== null && reviewedVersion !== approval.deckVersion)
                        }
                        onClick={() => {
                          // Sign off the PINNED reviewed version, not the live query value, so the
                          // server rejects it if the deck advanced past what the approver reviewed.
                          onApproveWithToken?.(
                            approverToken.trim(),
                            reviewedVersion ?? approval.deckVersion,
                          );
                          setApproverToken('');
                          setReviewedVersion(null);
                        }}
                      >
                        Sign off v{reviewedVersion ?? approval.deckVersion}
                      </button>
                      {reviewedVersion !== null && reviewedVersion !== approval.deckVersion ? (
                        <small className="ns-share-approval-drift" role="alert">
                          The deck advanced to v{approval.deckVersion} while you were reviewing v
                          {reviewedVersion}. Clear the token and re-review to sign off the current
                          version.
                        </small>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}
          {active && shareUrl ? (
            <label className="ns-share-url">
              View-only link
              <input
                type="url"
                value={shareUrl}
                readOnly
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Published view-only link"
              />
            </label>
          ) : null}
        </div>
        <footer>
          {active ? (
            <button
              ref={current ? primaryRef : undefined}
              className="ns-button ns-button--quiet"
              type="button"
              onClick={onCopy}
              disabled={busy}
            >
              <ClipboardCopy size={15} /> Copy existing link
            </button>
          ) : null}
          {!current ? (
            <button
              ref={primaryRef}
              className="ns-button ns-button--accent"
              type="button"
              onClick={onPublish}
              disabled={busy}
            >
              {busy ? <LoaderCircle className="ns-spin" size={15} /> : <Link2 size={15} />}
              {active ? 'Publish current version & copy' : 'Publish & copy link'}
            </button>
          ) : null}
          {active ? (
            <button
              className="ns-button ns-button--danger"
              type="button"
              onClick={onRevoke}
              disabled={busy}
            >
              <Trash2 size={15} /> Revoke link
            </button>
          ) : null}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
