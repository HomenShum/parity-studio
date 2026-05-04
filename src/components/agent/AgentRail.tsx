import { useQuery } from 'convex/react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  History,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Radio,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useMemo, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useT } from '../../lib/i18n';
import { SessionByokPanel } from '../byok/SessionByokPanel';
import { ChatPanel } from '../canvas/ChatPanel';
import { ComposerCard } from '../composer/ComposerCard';

interface AgentRailProps {
  currentRunId: Id<'runs'> | null;
  onSelectRun: (runId: Id<'runs'>) => void;
  onRunStarted: (runId: Id<'runs'>) => void;
  clientSessionId: string;
  onResetSession: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

type RunRowShape = {
  _id: Id<'runs'>;
  _creationTime: number;
  title?: string;
  prompt?: string;
  status: string;
  finishedAt?: number;
  costMicroUsd: number;
};

function relativeTime(
  ts: number | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (ts === undefined) return '';
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.round(diff / 60_000);
  if (m < 1) return t('history.justNow');
  if (m < 60) return t('history.minutesAgo', { count: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('history.hoursAgo', { count: h });
  const d = Math.round(h / 24);
  return t('history.daysAgo', { count: d });
}

export function AgentRail({
  currentRunId,
  onSelectRun,
  onRunStarted,
  clientSessionId,
  onResetSession,
  collapsed,
  onToggleCollapsed,
}: AgentRailProps) {
  const t = useT();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [byokOpen, setByokOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const runs = useQuery(api.runs.listRecent, { limit: 12, clientSessionId });
  const currentRun = useQuery(api.runs.get, currentRunId ? { runId: currentRunId } : 'skip');

  const historyRuns = useMemo(() => {
    const out = new Map<Id<'runs'>, RunRowShape>();
    if (currentRun) out.set(currentRun._id, currentRun as RunRowShape);
    for (const run of runs ?? []) out.set(run._id, run as RunRowShape);
    return [...out.values()].sort((a, b) => b._creationTime - a._creationTime);
  }, [currentRun, runs]);

  if (collapsed) {
    return (
      <aside
        aria-label={t('agent.collapsedLabel')}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          padding: 'var(--space-3) 8px',
          borderRight: '1px solid var(--color-border-subtle)',
          background: 'var(--color-background-secondary)',
        }}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={t('agent.expand')}
          style={iconButtonStyle}
        >
          <PanelLeftOpen size={16} />
        </button>
        <button
          type="button"
          onClick={() => setLaunchOpen(true)}
          aria-label={t('history.newRun')}
          style={iconButtonStyle}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={() => {
            setByokOpen(true);
            onToggleCollapsed();
          }}
          aria-label={t('history.keysAndByok')}
          style={iconButtonStyle}
        >
          <ShieldCheck size={16} />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={t('agent.openChat')}
          style={iconButtonStyle}
        >
          <Radio size={16} />
        </button>
        {launchOpen ? (
          <LaunchModal
            clientSessionId={clientSessionId}
            onClose={() => setLaunchOpen(false)}
            onRunStarted={(runId) => {
              setLaunchOpen(false);
              onRunStarted(runId);
            }}
          />
        ) : null}
      </aside>
    );
  }

  return (
    <aside
      aria-label={t('agent.label')}
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(circle at 18% 8%, color-mix(in srgb, var(--color-accent) 10%, transparent), transparent 34%), var(--color-background-secondary)',
        borderRight: '1px solid var(--color-border-subtle)',
      }}
    >
      <div
        style={{
          padding: 'var(--space-4) var(--space-4) var(--space-3)',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'grid',
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <span aria-hidden style={agentIconStyle}>
              <Radio size={13} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 800,
                  fontSize: 13,
                  color: 'var(--color-text-primary)',
                }}
              >
                {t('agent.label')}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--color-text-faint)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {t('agent.subtitle')}
              </div>
            </div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <a
              href="https://github.com/HomenShum/parity-studio"
              aria-label={t('agent.repo')}
              style={repoLinkStyle}
            >
              GitHub
              <ExternalLink size={10} aria-hidden />
            </a>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={t('agent.collapse')}
              style={iconButtonStyle}
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
        </div>

        <div style={commandCardStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" onClick={() => setLaunchOpen(true)} style={primaryButtonStyle}>
              <Plus size={14} />
              {t('history.newRun')}
            </button>
            <button
              type="button"
              onClick={() => setByokOpen((value) => !value)}
              style={secondaryButtonStyle}
            >
              <KeyRound size={14} />
              {t('history.keysAndByok')}
            </button>
          </div>
          <div style={helperTextStyle}>{t('agent.launchSubtitle')}</div>
          {byokOpen ? (
            <SessionByokPanel
              clientSessionId={clientSessionId}
              onResetSession={onResetSession}
              initialOpen
            />
          ) : null}
        </div>
      </div>

      <div
        style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'grid',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setHistoryOpen((value) => !value)}
          aria-expanded={historyOpen}
          style={historyToggleStyle}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <History size={13} />
            {t('agent.chatHistory')}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-faint)',
              }}
            >
              {runs === undefined ? t('history.loading') : historyRuns.length}
            </span>
            {historyOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        </button>
        {historyOpen ? (
          <div
            style={{ display: 'grid', gap: 6, maxHeight: 174, overflowY: 'auto', paddingRight: 2 }}
          >
            {runs === undefined && currentRun === undefined ? (
              <RailHint text={t('history.loadingRuns')} />
            ) : historyRuns.length === 0 ? (
              <RailHint text={t('history.noRuns')} />
            ) : (
              historyRuns
                .slice(0, 6)
                .map((run) => (
                  <RunHistoryRow
                    key={String(run._id)}
                    run={run}
                    active={run._id === currentRunId}
                    onClick={() => onSelectRun(run._id)}
                  />
                ))
            )}
          </div>
        ) : null}
      </div>

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
        <ChatPanel runId={currentRunId} variant="rail" />
      </div>

      {launchOpen ? (
        <LaunchModal
          clientSessionId={clientSessionId}
          onClose={() => setLaunchOpen(false)}
          onRunStarted={(runId) => {
            setLaunchOpen(false);
            onRunStarted(runId);
          }}
        />
      ) : null}
    </aside>
  );
}

function LaunchModal({
  clientSessionId,
  onClose,
  onRunStarted,
}: {
  clientSessionId: string;
  onClose: () => void;
  onRunStarted: (runId: Id<'runs'>) => void;
}) {
  const t = useT();
  return (
    // biome-ignore lint/a11y/useSemanticElements: custom full-screen modal shell needs non-dialog layout control.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('history.startNewRun')}
      data-testid="start-run-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 130,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(17, 13, 10, 0.38)',
        backdropFilter: 'blur(5px)',
      }}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          width: 720,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          borderRadius: '28px',
          border: '1px solid var(--color-border)',
          background:
            'radial-gradient(circle at 14% 0%, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent 34%), var(--color-background)',
          boxShadow: 'var(--shadow-elevated)',
          padding: 22,
          display: 'grid',
          gap: 18,
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            alignItems: 'flex-start',
          }}
        >
          <div style={{ maxWidth: 560 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-faint)',
                letterSpacing: 'var(--tracking-label)',
                textTransform: 'uppercase',
              }}
            >
              {t('history.startNewRunEyebrow')}
            </div>
            <h2
              style={{
                margin: '4px 0 0',
                fontFamily: 'var(--font-display)',
                fontSize: 34,
                lineHeight: 1,
                fontWeight: 500,
                letterSpacing: '-0.035em',
                color: 'var(--color-text-primary)',
              }}
            >
              {t('agent.startRunTitle')}
            </h2>
            <p style={{ marginTop: 10, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              {t('agent.startRunCopy')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('agent.closeStartRun')}
            data-testid="start-run-close"
            style={iconButtonStyle}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
          <LaunchHint
            icon={<Sparkles size={15} />}
            title={t('agent.launchPrompt')}
            body={t('agent.launchPromptBody')}
          />
          <LaunchHint
            icon={<Plus size={15} />}
            title={t('agent.launchImage')}
            body={t('agent.launchImageBody')}
          />
          <LaunchHint
            icon={<ShieldCheck size={15} />}
            title={t('agent.launchZip')}
            body={t('agent.launchZipBody')}
          />
        </div>

        <ComposerCard
          clientSessionId={clientSessionId}
          onRunStarted={onRunStarted}
          variant="launch"
        />
      </div>
    </div>
  );
}

function LaunchHint({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div
      style={{
        minHeight: 104,
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface)',
        padding: 13,
        display: 'grid',
        alignContent: 'start',
        gap: 8,
      }}
    >
      <span aria-hidden style={{ color: 'var(--color-accent)' }}>
        {icon}
      </span>
      <strong
        style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-text-primary)' }}
      >
        {title}
      </strong>
      <p
        style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--color-text-secondary)' }}
      >
        {body}
      </p>
    </div>
  );
}

function RunHistoryRow({
  run,
  active,
  onClick,
}: { run: RunRowShape; active: boolean; onClick: () => void }) {
  const t = useT();
  const running =
    run.status === 'queued' ||
    run.status === 'generating' ||
    run.status === 'decomposing' ||
    run.status === 'verifying' ||
    run.status === 'iterating';
  const title = run.title ?? run.prompt ?? t('history.untitledRun');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'grid',
        gap: 5,
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        background: active ? 'var(--color-accent-soft)' : 'var(--color-surface)',
        color: 'var(--color-text-primary)',
        padding: '9px 10px',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13,
            fontWeight: active ? 780 : 650,
          }}
        >
          {title}
        </span>
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: running
              ? 'var(--color-warning)'
              : run.status === 'failed'
                ? 'var(--color-error)'
                : 'var(--color-success)',
          }}
        />
      </span>
      <span
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          color: 'var(--color-text-faint)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
        }}
      >
        <span>{t(`history.status.${run.status}`)}</span>
        <span>{relativeTime(run.finishedAt ?? run._creationTime, t)}</span>
      </span>
    </button>
  );
}

function RailHint({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--color-text-faint)',
      }}
    >
      {text}
    </div>
  );
}

const agentIconStyle: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-accent)',
  color: 'var(--color-on-accent)',
  display: 'inline-grid',
  placeItems: 'center',
  flexShrink: 0,
};

const repoLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  textDecoration: 'none',
  flexShrink: 0,
};

const commandCardStyle: CSSProperties = {
  display: 'grid',
  gap: 9,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-xl)',
  background: 'color-mix(in srgb, var(--color-surface) 88%, white)',
  boxShadow: 'var(--shadow-soft)',
  padding: 10,
};

const primaryButtonStyle: CSSProperties = {
  height: 40,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  border: '1px solid color-mix(in srgb, var(--color-accent) 70%, transparent)',
  borderRadius: 'var(--radius-lg)',
  background:
    'linear-gradient(135deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 78%, #f9b27b))',
  color: 'var(--color-on-accent)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-body-sm)',
  fontWeight: 820,
  boxShadow: '0 12px 28px color-mix(in srgb, var(--color-accent) 20%, transparent)',
};

const secondaryButtonStyle: CSSProperties = {
  height: 40,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-body-sm)',
  fontWeight: 760,
};

const helperTextStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--color-text-faint)',
  lineHeight: 1.4,
};

const historyToggleStyle: CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-primary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  cursor: 'pointer',
  padding: '0 2px',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  fontWeight: 780,
};

const iconButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-secondary)',
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer',
};
