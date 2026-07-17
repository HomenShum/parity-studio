import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LoaderCircle, Trash2, X } from 'lucide-react';
import { type FormEvent, useId, useRef, useState } from 'react';

export interface DeleteDeckDialogProps {
  open: boolean;
  deckTitle: string;
  deleting: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function deleteDeckConfirmationMatches(confirmation: string, deckTitle: string): boolean {
  return deckTitle.length > 0 && confirmation === deckTitle;
}

/** Standalone destructive-action dialog; callers own mutation and navigation wiring. */
export function DeleteDeckDialog({ open, ...props }: DeleteDeckDialogProps) {
  if (!open) return null;
  return <OpenDeleteDeckDialog key={props.deckTitle} {...props} />;
}

function OpenDeleteDeckDialog({
  deckTitle,
  deleting,
  error,
  onCancel,
  onConfirm,
}: Omit<DeleteDeckDialogProps, 'open'>) {
  const [confirmation, setConfirmation] = useState('');
  const confirmationRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const closeIfIdle = () => {
    if (!deleting) onCancel();
  };
  const confirmed = deleteDeckConfirmationMatches(confirmation, deckTitle);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirmed && !deleting) onConfirm();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeIfIdle();
      }}
    >
      <AlertDialogContent
        className="ns-share-dialog"
        overlayClassName="ns-modal-backdrop"
        portalContainer={
          typeof document === 'undefined'
            ? null
            : document.querySelector<HTMLElement>('.nodeslide-studio')
        }
        aria-busy={deleting}
        data-testid="delete-deck-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmationRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (deleting) event.preventDefault();
        }}
      >
        <header>
          <span aria-hidden="true">
            <Trash2 size={20} />
          </span>
          <div>
            <small>Permanent data deletion</small>
            <AlertDialogTitle asChild>
              <h1 id="ns-delete-deck-dialog-title">Delete this deck?</h1>
            </AlertDialogTitle>
          </div>
          <AlertDialogCancel
            className="ns-icon-button"
            type="button"
            aria-label="Cancel deck deletion"
            disabled={deleting}
          >
            <X size={16} />
          </AlertDialogCancel>
        </header>
        <form id={formId} onSubmit={submit}>
          <div className="ns-share-dialog-body">
            <AlertDialogDescription asChild>
              <p id={descriptionId}>
                This permanently deletes the deck, slides, sources, history, comments, deck-scoped
                memories, role stages, source refresh plans, sync state, traces, publications, and
                exports. This action cannot be undone.
              </p>
            </AlertDialogDescription>
            <label className="ns-share-url">
              Type <strong>{deckTitle}</strong> to confirm
              <input
                ref={confirmationRef}
                type="text"
                value={confirmation}
                aria-invalid={confirmation.length > 0 && !confirmed}
                aria-describedby={error ? errorId : descriptionId}
                autoComplete="off"
                spellCheck={false}
                disabled={deleting}
                data-testid="delete-deck-confirmation"
                onChange={(event) => setConfirmation(event.currentTarget.value)}
              />
            </label>
            {error ? (
              <output id={errorId} role="alert">
                {error}
              </output>
            ) : null}
          </div>
        </form>
        <footer>
          <AlertDialogCancel
            className="ns-button ns-button--quiet"
            type="button"
            disabled={deleting}
          >
            Cancel
          </AlertDialogCancel>
          <button
            className="ns-button ns-button--danger"
            type="submit"
            form={formId}
            disabled={!confirmed || deleting}
            data-testid="delete-deck-confirm"
          >
            {deleting ? <LoaderCircle className="ns-spin" size={15} /> : <Trash2 size={15} />}
            {deleting ? 'Deleting…' : 'Delete deck permanently'}
          </button>
        </footer>
      </AlertDialogContent>
    </AlertDialog>
  );
}
