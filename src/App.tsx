import { useEffect, useState } from 'react';
import type { Id } from '../convex/_generated/dataModel';
import { Breadcrumb } from './components/Breadcrumb';
import { AgentRail } from './components/agent/AgentRail';
import { CanvasPanel } from './components/canvas/CanvasPanel';
import { HeaderActions, type Device } from './components/HeaderActions';
import { ParityPanel } from './components/parity/ParityPanel';
import { Wordmark } from './components/Wordmark';

/**
 * App shell — reference layout (docs/plans/2026-04-28-shell-revamp-from-reference.md).
 *
 *   ┌──────────────────────────────────────────┐
 *   │  TopBar (h: 64px)                        │
 *   ├────────────┬─────────────┬───────────────┤
 *   │  Agent     │   Canvas    │   Parity      │
 *   │   Rail     │   Panel     │   Panel       │
 *   │  (392 px)  │   (1fr)     │  (432 px)     │
 *   └────────────┴─────────────┴───────────────┘
 */
export default function App() {
  const [currentRunId, setCurrentRunId] = useState<Id<'runs'> | null>(() => {
    if (typeof window === 'undefined') return null;
    const urlRun = new URLSearchParams(window.location.search).get('run');
    return urlRun ? (urlRun as Id<'runs'>) : null;
  });
  const [commentModeActive, setCommentModeActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [starred, setStarred] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');

  // Reflect currentRunId into the URL so the active session is shareable
  // and a deep-linked screenshot/demo can boot straight into context.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (currentRunId) {
      if (url.searchParams.get('run') !== currentRunId) {
        url.searchParams.set('run', currentRunId);
        window.history.replaceState(null, '', url.toString());
      }
    } else if (url.searchParams.has('run')) {
      url.searchParams.delete('run');
      window.history.replaceState(null, '', url.toString());
    }
  }, [currentRunId]);

  const breadcrumbTitle = currentRunId
    ? 'Reimagine recording demo into parity UI kit'
    : 'New design session';

  function convexHttpBase(): string | null {
    const fromEnv = import.meta.env['VITE_CONVEX_HTTP_URL'] as string | undefined;
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    const wsUrl = (import.meta.env['VITE_CONVEX_URL'] as string | undefined) ?? '';
    if (!wsUrl) return null;
    return wsUrl.replace('.convex.cloud', '.convex.site').replace(/\/$/, '');
  }
  const httpBase = convexHttpBase();
  const exportHrefBase =
    currentRunId !== null && httpBase ? `${httpBase}/api/runs/${currentRunId}` : '#';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'var(--layout-agent-width) 1fr var(--layout-parity-width)',
        gridTemplateRows: 'var(--size-titlebar-height) 1fr',
        height: '100vh',
        background: 'var(--color-background)',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <header
        style={{
          gridColumn: '1 / -1',
          gridRow: 1,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          alignItems: 'center',
          gap: 'var(--space-6)',
          padding: '0 var(--space-6)',
          background: 'var(--color-background)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <Wordmark />
        <Breadcrumb title={breadcrumbTitle} starred={starred} onToggleStar={() => setStarred((v) => !v)} />
        <HeaderActions
          commentModeActive={commentModeActive}
          onToggleCommentMode={() => setCommentModeActive((v) => !v)}
          zoom={zoom}
          onZoomChange={setZoom}
          device={device}
          onDeviceChange={setDevice}
          exportHrefBase={exportHrefBase}
          exportEnabled={currentRunId !== null && httpBase !== null}
        />
      </header>

      <div style={{ gridColumn: 1, gridRow: 2, minHeight: 0, minWidth: 0, display: 'flex' }}>
        <AgentRail
          currentRunId={currentRunId}
          onSelectRun={setCurrentRunId}
          onRunStarted={setCurrentRunId}
        />
      </div>

      <div style={{ gridColumn: 2, gridRow: 2, minHeight: 0, minWidth: 0, display: 'flex' }}>
        <CanvasPanel
          runId={currentRunId}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          zoom={zoom}
          device={device}
          commentModeActive={commentModeActive}
        />
      </div>

      <div style={{ gridColumn: 3, gridRow: 2, minHeight: 0, minWidth: 0, display: 'flex' }}>
        <ParityPanel runId={currentRunId} />
      </div>
    </div>
  );
}
