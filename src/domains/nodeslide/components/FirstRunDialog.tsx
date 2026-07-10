import { ArrowRight, FilePlus2, PlayCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface FirstRunDialogProps {
  open: boolean;
  onCreate: () => void;
  onExplore: () => void;
}

export function FirstRunDialog({ open, onCreate, onExplore }: FirstRunDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => primaryRef.current?.focus());
    }
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={dialogRef}
      className="ns-first-run-dialog"
      aria-labelledby="ns-first-run-title"
      aria-describedby="ns-first-run-description"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onExplore();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onExplore();
      }}
    >
      <div className="ns-first-run-kicker">
        <span>
          <Sparkles size={13} /> Private preview
        </span>
        <small>Free route · deterministic fallback</small>
      </div>
      <header>
        <span className="ns-first-run-mark" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h1 id="ns-first-run-title">From brief to a reviewable deck.</h1>
          <p id="ns-first-run-description">
            NodeSlide creates an editable first draft, keeps AI changes scoped until you approve
            them, and checks the exact deck before presenting or export.
          </p>
        </div>
      </header>
      <ol className="ns-first-run-steps">
        <li>
          <span>01</span>
          <div>
            <strong>Start with a brief</strong>
            <p>Describe the audience, decision, and evidence standard.</p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Edit directly or ask AI</strong>
            <p>Every accepted change becomes a version you can inspect and restore.</p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Present or export safely</strong>
            <p>Publishing is gated on structure, readability, sources, and export support.</p>
          </div>
        </li>
      </ol>
      <div className="ns-first-run-actions">
        <button
          ref={primaryRef}
          className="ns-button ns-button--accent"
          type="button"
          onClick={onCreate}
        >
          <FilePlus2 size={15} /> Create my deck <ArrowRight size={14} />
        </button>
        <button className="ns-button ns-button--quiet" type="button" onClick={onExplore}>
          <PlayCircle size={15} /> Explore the sample
        </button>
      </div>
      <footer>
        The sample deck is illustrative. Evidence caveats remain attached to exports; NodeSlide does
        not independently verify factual claims.
      </footer>
    </dialog>
  );
}
