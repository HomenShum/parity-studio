import { useConvex } from 'convex/react';
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { publishNodeSlideUiContract } from '../../uiContract';

/** After this long on one loading stage, offer an honest retry instead of spinning forever. */
const LOADING_RETRY_AFTER_MS = 12_000;

function useConvexConnectionReady(): boolean {
  const convex = useConvex();
  const [ready, setReady] = useState(() => convex.connectionState().isWebSocketConnected);
  useEffect(() => {
    if (ready) return;
    const interval = window.setInterval(() => {
      if (convex.connectionState().isWebSocketConnected) setReady(true);
    }, 300);
    return () => window.clearInterval(interval);
  }, [convex, ready]);
  return ready;
}

export function LoadingScreen({
  title,
  kind = 'preparing_sample',
  theme = 'light',
}: {
  title: string;
  kind?: 'preparing_sample' | 'opening_deck';
  theme?: 'light' | 'dark';
}) {
  const connected = useConvexConnectionReady();
  const [startedAt] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  const stage = connected ? kind : 'connecting';
  const retryVisible = elapsedMs >= LOADING_RETRY_AFTER_MS;
  const stageTitle = connected ? title : 'Connecting to the workspace service…';
  const stageDetail = connected
    ? 'Loading canonical slides, sources, comments, and revision clocks.'
    : 'Establishing the realtime connection before anything loads.';

  useEffect(() => {
    publishNodeSlideUiContract({
      phase: 'loading',
      connection: connected ? 'ready' : 'connecting',
      theme,
      loading: { stage, elapsedMs, retryVisible },
    });
  }, [connected, stage, elapsedMs, retryVisible, theme]);

  return (
    <main
      className="nodeslide-studio ns-loading-screen"
      data-testid="nodeslide-studio"
      aria-busy="true"
    >
      <output className="ns-sr-only" aria-live="polite">
        {stageTitle}
      </output>
      <div className="ns-loading-group" data-testid="ns-loading-stage" data-stage={stage}>
        <span className="ns-loading-mark" aria-hidden="true">
          <LoaderCircle className="ns-spin" size={20} />
        </span>
        <strong>{stageTitle}</strong>
        <p>{stageDetail}</p>
        {retryVisible ? (
          <div className="ns-loading-retry">
            <p>Still working — first-time sample setup can take longer than usual.</p>
            <button
              className="ns-button"
              type="button"
              onClick={() => window.location.reload()}
              data-testid="ns-loading-retry"
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : null}
      </div>
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
