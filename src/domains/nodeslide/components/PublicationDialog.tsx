import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ClipboardCopy, Link2, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react';
import { useRef } from 'react';
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
  const primaryRef = useRef<HTMLButtonElement>(null);
  const active = publication?.status === 'active';
  const current = active && publication.deckVersion === currentDeckVersion;

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
