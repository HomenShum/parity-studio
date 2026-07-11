import { ClipboardCopy, Link2, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { NodeSlidePublication } from '../../../../shared/nodeslide';

interface PublicationDialogProps {
  open: boolean;
  publication: NodeSlidePublication | null;
  shareUrl: string | null;
  currentDeckVersion: number;
  busy: boolean;
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
  onClose,
  onCopy,
  onPublish,
  onRevoke,
}: PublicationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const active = publication?.status === 'active';
  const current = active && publication.deckVersion === currentDeckVersion;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => primaryRef.current?.focus());
    }
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={dialogRef}
      className="ns-share-dialog"
      aria-labelledby="ns-share-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <span aria-hidden="true">
          <Link2 size={20} />
        </span>
        <div>
          <small>View-only publication</small>
          <h1 id="ns-share-dialog-title">Share a frozen, validated deck</h1>
        </div>
        <button
          className="ns-icon-button"
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close share dialog"
        >
          <X size={16} />
        </button>
      </header>
      <div className="ns-share-dialog-body">
        <p>
          A share link opens an immutable snapshot. Speaker notes, the creation brief, private
          project context, and non-public sources are excluded.
        </p>
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
    </dialog>
  );
}
