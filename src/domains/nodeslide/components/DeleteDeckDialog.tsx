import { LoaderCircle, Trash2, X } from 'lucide-react';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useModalDialog } from './useModalDialog';

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
  const { dialogRef, handleBackdropMouseDown, handleCancel, handleKeyDown } = useModalDialog({
    open: true,
    onClose: closeIfIdle,
    initialFocusRef: confirmationRef,
  });

  const confirmed = deleteDeckConfirmationMatches(confirmation, deckTitle);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirmed && !deleting) onConfirm();
  };

  return (
    <dialog
      ref={dialogRef}
      className="ns-share-dialog"
      aria-labelledby="ns-delete-deck-dialog-title"
      aria-describedby={descriptionId}
      aria-busy={deleting}
      data-testid="delete-deck-dialog"
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
    >
      <header>
        <span aria-hidden="true">
          <Trash2 size={20} />
        </span>
        <div>
          <small>Permanent data deletion</small>
          <h1 id="ns-delete-deck-dialog-title">Delete this deck?</h1>
        </div>
        <button
          className="ns-icon-button"
          type="button"
          aria-label="Cancel deck deletion"
          onClick={closeIfIdle}
          disabled={deleting}
        >
          <X size={16} />
        </button>
      </header>
      <form id={formId} onSubmit={submit}>
        <div className="ns-share-dialog-body">
          <p id={descriptionId}>
            This permanently deletes the deck, slides, sources, history, comments, deck-scoped
            memories, role stages, source refresh plans, sync state, traces, publications, and
            exports. This action cannot be undone.
          </p>
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
        <button
          className="ns-button ns-button--quiet"
          type="button"
          onClick={closeIfIdle}
          disabled={deleting}
        >
          Cancel
        </button>
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
    </dialog>
  );
}
