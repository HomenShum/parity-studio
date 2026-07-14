import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect } from 'react';

export function LoadingScreen({ title }: { title: string }) {
  return (
    <main
      className="nodeslide-studio ns-loading-screen"
      data-testid="nodeslide-studio"
      aria-busy="true"
    >
      <output className="ns-sr-only" aria-live="polite">
        {title}
      </output>
      <span className="ns-loading-mark" aria-hidden="true">
        <LoaderCircle className="ns-spin" size={20} />
      </span>
      <strong>{title}</strong>
      <p>Loading canonical slides, sources, comments, and revision clocks.</p>
    </main>
  );
}

export function RecoveryScreen({
  title,
  detail,
  primaryLabel,
  onPrimary,
  children,
}: {
  title: string;
  detail: string;
  primaryLabel: string;
  onPrimary: () => void;
  children?: ReactNode;
}) {
  return (
    <main className="nodeslide-studio ns-recovery-screen" data-testid="nodeslide-studio">
      <span className="ns-recovery-mark" aria-hidden="true">
        <ShieldAlert size={22} />
      </span>
      <span className="ns-eyebrow">Safe recovery</span>
      <h1>{title}</h1>
      <p>{detail}</p>
      {children}
      <button className="ns-button ns-button--accent" type="button" onClick={onPrimary}>
        {primaryLabel === 'Retry' ? <RefreshCw size={15} /> : <FolderOpen size={15} />}
        {primaryLabel}
      </button>
    </main>
  );
}

export interface StudioToast {
  kind: 'success' | 'error';
  message: string;
}

export function Toast({ toast, onClose }: { toast: StudioToast; onClose: () => void }) {
  useEffect(() => {
    if (toast.kind === 'error') return;
    const timeout = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timeout);
  }, [onClose, toast.kind]);
  return (
    <output className={`ns-toast is-${toast.kind}`} aria-live="polite">
      {toast.kind === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss notification">
        <X size={14} />
      </button>
    </output>
  );
}
