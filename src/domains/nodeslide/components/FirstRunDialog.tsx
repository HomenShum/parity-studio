import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ArrowRight, FilePlus2, PlayCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { useRef } from 'react';

interface FirstRunDialogProps {
  open: boolean;
  onCreate: () => void;
  onExplore: () => void;
}

export function FirstRunDialog({ open, onCreate, onExplore }: FirstRunDialogProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onExplore();
      }}
    >
      <DialogContent
        className="ns-first-run-dialog"
        overlayClassName="ns-first-run-backdrop"
        showCloseButton={false}
        data-testid="first-run-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          primaryRef.current?.focus();
        }}
      >
        <div className="ns-first-run-kicker">
          <span>
            <Sparkles size={13} /> Private preview
          </span>
          <small>Nebius recommended · explicit consent</small>
        </div>
        <header>
          <span className="ns-first-run-mark" aria-hidden="true">
            <ShieldCheck size={22} />
          </span>
          <div>
            <DialogTitle asChild>
              <h1>From brief to a reviewable deck.</h1>
            </DialogTitle>
            <DialogDescription asChild>
              <p id="ns-first-run-description">
                NodeSlide creates an editable first draft, keeps AI changes scoped until you approve
                them, and checks the exact deck before presenting or export. Your new-deck brief
                stays inside NodeSlide until you choose an external model. The selected provider
                receives the full brief only after you explicitly consent.
              </p>
            </DialogDescription>
          </div>
        </header>
        <ol className="ns-first-run-steps">
          <li>
            <span>01</span>
            <div>
              <strong>Start with a brief</strong>
              <p>
                Describe the audience, decision, and evidence standard, then choose its provider.
              </p>
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
            data-testid="first-run-create"
            onClick={onCreate}
          >
            <FilePlus2 size={15} /> Create my deck <ArrowRight size={14} />
          </button>
          <button
            className="ns-button ns-button--quiet"
            type="button"
            data-testid="first-run-explore"
            onClick={onExplore}
          >
            <PlayCircle size={15} /> Explore the sample
          </button>
        </div>
        <footer>
          Creating a deck requires a private-preview access code. The sample deck is illustrative;
          NodeSlide does not independently verify factual claims.
        </footer>
      </DialogContent>
    </Dialog>
  );
}
