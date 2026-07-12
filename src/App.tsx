import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { Breadcrumb } from './components/Breadcrumb';
import { type Device, HeaderActions } from './components/HeaderActions';
import { Wordmark } from './components/Wordmark';
import { AgentRail } from './components/agent/AgentRail';
import { CanvasPanel, type CanvasTab } from './components/canvas/CanvasPanel';
import { ParityPanel } from './components/parity/ParityPanel';
import { NodeSlideStudio } from './domains/nodeslide/NodeSlideStudio';
import { convexHttpUrl } from './lib/convexEndpoints';
import { useT } from './lib/i18n';
import { getOrCreateSessionId, resetSessionId } from './lib/sessionIdentity';

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
  const urlDomain =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('domain');
  const configuredDomain = import.meta.env['VITE_STUDIO_DOMAIN'] ?? 'nodeslide';
  const parityEnabled = import.meta.env['VITE_ENABLE_PARITY_DOMAIN'] === 'true';
  const domain =
    urlDomain === 'parity' && parityEnabled
      ? 'parity'
      : urlDomain === 'nodeslide'
        ? 'nodeslide'
        : configuredDomain === 'parity' && parityEnabled
          ? 'parity'
          : 'nodeslide';
  return domain === 'parity' ? <ParityApp /> : <NodeSlideStudio />;
}

function ParityApp() {
  const t = useT();
  const [currentRunId, setCurrentRunId] = useState<Id<'runs'> | null>(() => {
    if (typeof window === 'undefined') return null;
    const urlRun = new URLSearchParams(window.location.search).get('run');
    return urlRun ? (urlRun as Id<'runs'>) : null;
  });
  const [clientSessionId, setClientSessionId] = useState(() => getOrCreateSessionId());
  const [commentModeActive, setCommentModeActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeSurfaceSlug, setActiveSurfaceSlug] = useState<string | null>(null);
  const [canvasTab, setCanvasTab] = useState<CanvasTab>('files');
  const [zoom, setZoom] = useState(100);
  const [starred, setStarred] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');
  const [agentCollapsed, setAgentCollapsed] = useState(false);
  const [parityCollapsed, setParityCollapsed] = useState(false);
  const [missingRunId, setMissingRunId] = useState<string | null>(null);
  const run = useQuery(api.runs.get, currentRunId ? { runId: currentRunId } : 'skip');
  const parity = useQuery(
    api.parityReports.getLatest,
    currentRunId ? { runId: currentRunId } : 'skip',
  );

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

  useEffect(() => {
    setCanvasTab(currentRunId === null ? 'files' : 'preview');
    setActiveSurfaceSlug(null);
  }, [currentRunId]);

  useEffect(() => {
    if (currentRunId && run === null) {
      setMissingRunId(String(currentRunId));
      setCurrentRunId(null);
      setSelectedFile(null);
      setCanvasTab('files');
      setCommentModeActive(false);
    }
  }, [currentRunId, run]);

  function activateRun(runId: Id<'runs'>) {
    setMissingRunId(null);
    setCurrentRunId(runId);
  }

  const breadcrumbTitle = currentRunId ? t('app.defaultRunTitle') : t('app.newDesignSession');

  const httpBase = convexHttpUrl();
  const exportHrefBase =
    currentRunId !== null && httpBase ? `${httpBase}/api/runs/${currentRunId}` : '#';
  const passCount = parity?.passCount ?? 0;
  const totalChecks = parity?.totalChecks ?? 16;
  const exportReady = currentRunId !== null && parity?.status === 'verified';
  const activeStep = (() => {
    if (currentRunId === null) return 1;
    if (run?.status === 'generating' || run?.status === 'decomposing' || run?.status === 'queued')
      return 2;
    if ((parity?.passCount ?? 0) < Math.ceil(totalChecks * 0.875)) return 3;
    if (parity?.status !== 'verified') return 4;
    return 5;
  })();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: [
          agentCollapsed ? '52px' : '430px',
          'minmax(0, 1fr)',
          parityCollapsed ? '52px' : 'var(--layout-parity-width)',
        ].join(' '),
        gridTemplateRows: 'var(--size-titlebar-height) 42px 1fr',
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
        <Breadcrumb
          title={breadcrumbTitle}
          starred={starred}
          onToggleStar={() => setStarred((v) => !v)}
        />
        <HeaderActions
          commentModeActive={commentModeActive}
          onToggleCommentMode={() => setCommentModeActive((v) => !v)}
          zoom={zoom}
          onZoomChange={setZoom}
          device={device}
          onDeviceChange={setDevice}
          exportHrefBase={exportHrefBase}
          exportEnabled={currentRunId !== null}
          exportReady={exportReady}
          exportWarning={
            currentRunId !== null && !exportReady
              ? t('app.exportWarning', { passCount, totalChecks })
              : undefined
          }
        />
      </header>
      <div
        style={{
          gridColumn: '1 / -1',
          gridRow: 2,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--color-background)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <JourneySteps activeStep={activeStep} />
      </div>

      <div style={{ gridColumn: 1, gridRow: 3, minHeight: 0, minWidth: 0, display: 'flex' }}>
        <AgentRail
          currentRunId={currentRunId}
          onSelectRun={activateRun}
          onRunStarted={activateRun}
          clientSessionId={clientSessionId}
          onResetSession={() => {
            setCurrentRunId(null);
            setMissingRunId(null);
            setClientSessionId(resetSessionId());
          }}
          collapsed={agentCollapsed}
          onToggleCollapsed={() => setAgentCollapsed((value) => !value)}
        />
      </div>

      <div style={{ gridColumn: 2, gridRow: 3, minHeight: 0, minWidth: 0, display: 'flex' }}>
        <CanvasPanel
          runId={currentRunId}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          activeTab={canvasTab}
          onTabChange={setCanvasTab}
          zoom={zoom}
          device={device}
          commentModeActive={commentModeActive}
          activeSurfaceSlug={activeSurfaceSlug}
          onSurfaceChange={setActiveSurfaceSlug}
          missingRunId={missingRunId}
          onDismissMissingRun={() => setMissingRunId(null)}
        />
      </div>

      <div style={{ gridColumn: 3, gridRow: 3, minHeight: 0, minWidth: 0, display: 'flex' }}>
        <ParityPanel
          runId={currentRunId}
          selectedFile={selectedFile}
          device={device}
          activeSurfaceSlug={activeSurfaceSlug}
          collapsed={parityCollapsed}
          onToggleCollapsed={() => setParityCollapsed((value) => !value)}
          onOpenFile={(path) => {
            setSelectedFile(path);
            setCanvasTab('files');
          }}
        />
      </div>
    </div>
  );
}

function JourneySteps({ activeStep }: { activeStep: number }) {
  const t = useT();
  const steps = [
    t('app.workflow.start'),
    t('app.workflow.create'),
    t('app.workflow.improve'),
    t('app.workflow.verify'),
    t('app.workflow.export'),
  ];
  return (
    <div
      aria-label="Workflow steps"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '5px 7px',
        borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--color-border-subtle)',
        background: 'color-mix(in srgb, var(--color-background) 92%, white)',
        boxShadow: 'var(--shadow-soft)',
        pointerEvents: 'auto',
      }}
    >
      {steps.map((label, index) => {
        const number = index + 1;
        const active = number === activeStep;
        const done = number < activeStep;
        return (
          <span
            key={label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 8px',
              borderRadius: 'var(--radius-pill)',
              background: active ? 'var(--color-accent-soft)' : 'transparent',
              color: active
                ? 'var(--color-accent)'
                : done
                  ? 'var(--color-text-primary)'
                  : 'var(--color-text-faint)',
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              fontWeight: active ? 800 : 650,
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                display: 'inline-grid',
                placeItems: 'center',
                background: active || done ? 'var(--color-accent)' : 'var(--color-surface-active)',
                color: active || done ? 'var(--color-on-accent)' : 'var(--color-text-faint)',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
              }}
            >
              {number}
            </span>
            {label}
          </span>
        );
      })}
    </div>
  );
}
