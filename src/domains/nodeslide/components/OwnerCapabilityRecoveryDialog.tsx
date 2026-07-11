import { ClipboardCopy, Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface OwnerCapabilityRecovery {
  deckId: string;
  deckTitle: string;
  ownerAccessKey: string;
}

interface OwnerCapabilityRecoveryDialogProps {
  open: boolean;
  recovery: OwnerCapabilityRecovery | null;
  onClose: () => void;
}

export function OwnerCapabilityRecoveryDialog({
  open,
  recovery,
  onClose,
}: OwnerCapabilityRecoveryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && recovery && !dialog.open) {
      setRevealed(false);
      setCopyStatus(null);
      dialog.showModal();
      window.requestAnimationFrame(() => copyButtonRef.current?.focus());
    }
    if ((!open || !recovery) && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open, recovery]);

  if (!open || !recovery) return null;

  const copyRecoveryKey = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable.');
      await navigator.clipboard.writeText(recovery.ownerAccessKey);
      setCopyStatus('Recovery key copied. Keep it in a private password manager.');
    } catch {
      setRevealed(true);
      setCopyStatus('Automatic copy was unavailable. Select and copy the revealed key.');
      window.requestAnimationFrame(() => {
        keyInputRef.current?.focus();
        keyInputRef.current?.select();
      });
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="ns-owner-recovery-dialog"
      aria-labelledby="ns-owner-recovery-title"
      aria-describedby="ns-owner-recovery-description"
      onCancel={(event) => event.preventDefault()}
    >
      <header>
        <span aria-hidden="true">
          <ShieldAlert size={22} />
        </span>
        <div>
          <small>Owner-key recovery</small>
          <h1 id="ns-owner-recovery-title">Save access to “{recovery.deckTitle}”</h1>
        </div>
      </header>
      <p id="ns-owner-recovery-description">
        This browser did not persist the anonymous owner key. It grants full edit access. Save it
        privately now; you can paste it into this deck’s editor link to recover access later.
      </p>
      <label>
        Recovery key
        <span className="ns-owner-recovery-key">
          <KeyRound size={15} aria-hidden="true" />
          <input
            ref={keyInputRef}
            type={revealed ? 'text' : 'password'}
            value={recovery.ownerAccessKey}
            readOnly
            autoComplete="off"
            spellCheck={false}
            aria-label="Owner recovery key"
          />
          <button
            className="ns-icon-button"
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? 'Hide recovery key' : 'Reveal recovery key'}
          >
            {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </span>
      </label>
      {copyStatus ? <output aria-live="polite">{copyStatus}</output> : null}
      <footer>
        <button
          ref={copyButtonRef}
          className="ns-button ns-button--accent"
          type="button"
          onClick={() => void copyRecoveryKey()}
        >
          <ClipboardCopy size={15} /> Copy recovery key
        </button>
        <button className="ns-button ns-button--quiet" type="button" onClick={onClose}>
          I saved it
        </button>
      </footer>
    </dialog>
  );
}
