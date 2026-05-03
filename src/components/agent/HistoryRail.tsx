import { useQuery } from 'convex/react';
import {
  ChevronsLeft,
  History,
  Layers3,
  PanelLeftOpen,
  Plus,
  Radio,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useMemo, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useT } from '../../lib/i18n';
import { SessionByokPanel } from '../byok/SessionByokPanel';
import { ComposerCard } from '../composer/ComposerCard';
import type { PipelineStage, PipelineState } from '../pipeline/PipelineActivityCard';

interface HistoryRailProps {
  currentRunId: Id<'runs'> | null;
  onSelectRun: (runId: Id<'runs'>) => void;
  onRunStarted: (runId: Id<'runs'>) => void;
  clientSessionId: string;
  onResetSession: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

interface ActivityRow {
  key: string;
  stage: PipelineStage;
  state: PipelineState;
  ageLabel: string | undefined;
  edits: number | undefined;
  src: number | undefined;
  runId: Id<'runs'>;
}

const STAGE_FROM_TELEMETRY: Record<string, PipelineStage> = {
  generate: 'generate',
  decompose: 'decompose',
  iterate: 'iterate',
  verify: 'verify',
  'verify-deterministic': 'verify',
  'verify-visual': 'verify',
};

function stageFromTelemetryName(stageName: string): PipelineStage {
  const root = stageName.replace(/-\d+(-noop)?$/, '').replace(/-noop$/, '');
  return STAGE_FROM_TELEMETRY[root] ?? 'iterate';
}

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

export function HistoryRail({
  currentRunId,
  onSelectRun,
  onRunStarted,
  clientSessionId,
  onResetSession,
  collapsed,
  onToggleCollapsed,
}: HistoryRailProps) {
  const t = useT();
  const [newRunOpen, setNewRunOpen] = useState(currentRunId === null);
  const [byokOpen, setByokOpen] = useState(false);
  const runs = useQuery(api.runs.listRecent, { limit: 12, clientSessionId });
  const projects = useQuery(api.projects.list, { limit: 12, clientSessionId });
  const currentRun = useQuery(api.runs.get, currentRunId ? { runId: currentRunId } : 'skip');

  const historyRuns = useMemo(() => {
    const out = new Map<Id<'runs'>, NonNullable<typeof currentRun>>();
    if (currentRun) out.set(currentRun._id, currentRun);
    for (const run of runs ?? []) out.set(run._id, run);
    return [...out.values()].sort((a, b) => b._creationTime - a._creationTime);
  }, [currentRun, runs]);

  const rows: ActivityRow[] = useMemo(() => {
    const out: ActivityRow[] = [];
    for (const run of historyRuns) {
      const breakdown = run.costBreakdown ?? [];
      const seen = new Set<PipelineStage>();
      for (let i = breakdown.length - 1; i >= 0; i -= 1) {
        const entry = breakdown[i];
        if (!entry) continue;
        const stage = stageFromTelemetryName(entry.stage);
        if (seen.has(stage)) continue;
        seen.add(stage);
        const failed = run.status === 'failed';
        const running =
          (stage === 'generate' && run.status === 'generating') ||
          (stage === 'decompose' && (run.status === 'decomposing' || run.status === 'iterating')) ||
          (stage === 'verify' && run.status === 'verifying') ||
          (stage === 'iterate' && run.status === 'iterating');
        out.push({
          key: `${run._id}-${stage}`,
          stage,
          state: running ? 'running' : failed ? 'failed' : 'done',
          ageLabel: relativeTime(entry.stageStartedAt, t),
          edits: entry.outputTokens ? Math.max(1, Math.round(entry.outputTokens / 200)) : undefined,
          src: entry.inputTokens ? Math.max(1, Math.round(entry.inputTokens / 50)) : undefined,
          runId: run._id,
        });
      }
      if (run.iterationsCompleted > 0 && !seen.has('iterate')) {
        out.push({
          key: `${run._id}-iterate`,
          stage: 'iterate',
          state:
            run.status === 'iterating' ? 'running' : run.status === 'failed' ? 'failed' : 'done',
          ageLabel: relativeTime(run.finishedAt ?? run._creationTime, t),
          edits: run.iterationsCompleted,
          src: undefined,
          runId: run._id,
        });
      }
    }
    return out.slice(0, 8);
  }, [historyRuns, t]);

  const activeCount = rows.filter((row) => row.state === 'running').length;
  const statusSummary = useMemo(() => {
    const count = (predicate: (status: string) => boolean) =>
      historyRuns.filter((run) => predicate(run.status)).length;
    return [
      {
        label: t('history.statusSummary.diagnosing'),
        count: count(
          (status) => status === 'queued' || status === 'decomposing' || status === 'iterating',
        ),
        color: 'var(--color-warning)',
      },
      {
        label: t('history.statusSummary.generating'),
        count: count((status) => status === 'generating'),
        color: 'var(--color-warning)',
      },
      {
        label: t('history.statusSummary.verifying'),
        count: count((status) => status === 'verifying'),
        color: 'var(--color-success)',
      },
      {
        label: t('history.statusSummary.complete'),
        count: count((status) => status === 'done'),
        color: 'var(--color-success)',
      },
    ];
  }, [historyRuns, t]);

  if (collapsed) {
    return (
      <aside
        aria-label={t('history.collapsedLabel')}
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
        <RailIconButton label={t('history.expand')} onClick={onToggleCollapsed}>
          <PanelLeftOpen size={16} />
        </RailIconButton>
        <RailIconButton label={t('history.newRun')} onClick={() => setNewRunOpen(true)}>
          <Plus size={16} />
        </RailIconButton>
        <RailIconButton label={t('history.keysAndByok')} onClick={() => setByokOpen(true)}>
          <ShieldCheck size={16} />
        </RailIconButton>
        <div style={{ width: 26, height: 1, background: 'var(--color-border-subtle)' }} />
        <RailIconButton label={t('history.recentRuns')} onClick={onToggleCollapsed}>
          <History size={16} />
        </RailIconButton>
        {newRunOpen ? (
          <SidebarModal
            title={t('history.startNewRun')}
            eyebrow={t('history.startNewRunEyebrow')}
            onClose={() => setNewRunOpen(false)}
          >
            <ComposerCard
              clientSessionId={clientSessionId}
              onRunStarted={(runId) => {
                setNewRunOpen(false);
                onRunStarted(runId);
              }}
            />
          </SidebarModal>
        ) : null}
        {byokOpen ? (
          <ByokModal
            clientSessionId={clientSessionId}
            onClose={() => setByokOpen(false)}
            onResetSession={onResetSession}
          />
        ) : null}
      </aside>
    );
  }

  return (
    <aside
      aria-label={t('history.expandedLabel')}
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(circle at 20% 8%, color-mix(in srgb, var(--color-accent) 9%, transparent), transparent 32%), var(--color-background-secondary)',
        borderRight: '1px solid var(--color-border-subtle)',
      }}
    >
      <div
        style={{
          padding: 'var(--space-4) var(--space-4) var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <button type="button" onClick={() => setNewRunOpen(true)} style={primaryCtaStyle}>
          <Plus size={14} />
          {t('history.newRun')}
        </button>
        <button type="button" onClick={() => setByokOpen(true)} style={secondaryCtaStyle}>
          <ShieldCheck size={14} />
          {t('history.keysAndByok')}
        </button>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 'var(--space-3) var(--space-3) var(--space-4)',
          display: 'grid',
          alignContent: 'start',
          gap: 'var(--space-4)',
        }}
      >
        <section style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <SectionHeader
            icon={<Layers3 size={12} />}
            title={t('history.projects')}
            meta={projects === undefined ? t('history.loading') : `${projects.length}`}
            action={
              <MiniActionButton
                label={t('history.startNewRun')}
                onClick={() => setNewRunOpen(true)}
              >
                <Plus size={12} />
              </MiniActionButton>
            }
          />
          {projects === undefined ? (
            <RailHint text={t('history.loadingProjects')} />
          ) : projects.length === 0 ? (
            <RailHint text={t('history.noProjects')} />
          ) : (
            projects.map((project) => (
              <ProjectRow
                key={String(project._id)}
                title={project.title}
                status={project.latestStatus ?? 'empty'}
                runCount={project.runCount}
                costMicroUsd={project.totalCostMicroUsd}
                active={project.latestRunId === currentRunId}
                starred={Boolean(project.starred)}
                onClick={() => {
                  if (project.latestRunId) onSelectRun(project.latestRunId);
                }}
              />
            ))
          )}
        </section>

        <section style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <SectionHeader
            icon={<History size={12} />}
            title={t('history.recentRuns')}
            meta={runs === undefined ? t('history.loading') : `${historyRuns.length}`}
          />
          {runs === undefined && currentRun === undefined ? (
            <RailHint text={t('history.loadingRuns')} />
          ) : historyRuns.length === 0 ? (
            <RailHint text={t('history.noRuns')} />
          ) : (
            historyRuns
              .slice(0, 14)
              .map((run) => (
                <RunRow
                  key={String(run._id)}
                  title={run.title ?? run.prompt ?? t('history.untitledRun')}
                  status={run.status}
                  ageLabel={relativeTime(run.finishedAt ?? run._creationTime, t)}
                  costMicroUsd={run.costMicroUsd}
                  active={run._id === currentRunId}
                  onClick={() => onSelectRun(run._id)}
                />
              ))
          )}
          {historyRuns.length > 0 ? <RailTextButton label={t('history.viewAllRuns')} /> : null}
        </section>

        <section style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <SectionHeader
            icon={<Radio size={12} />}
            title={t('history.runStatus')}
            meta={activeCount > 0 ? t('history.active', { count: activeCount }) : `${rows.length}`}
            active={activeCount > 0}
          />
          {rows.length === 0 ? (
            <RailHint text={t('history.noTelemetry')} />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {statusSummary.map((item) => (
                <StatusSummaryRow key={item.label} {...item} />
              ))}
              <RailTextButton label={t('history.viewAllActivity')} />
            </div>
          )}
        </section>
      </div>

      <footer
        style={{
          borderTop: '1px solid var(--color-border-subtle)',
          padding: '10px var(--space-4)',
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
          alignItems: 'center',
          gap: 8,
          color: 'var(--color-text-secondary)',
        }}
      >
        <Settings size={14} />
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 650,
          }}
        >
          parity-studio
        </span>
        <span style={proBadgeStyle}>Pro</span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={t('history.collapse')}
          style={footerCollapseStyle}
        >
          <ChevronsLeft size={14} />
        </button>
      </footer>

      {newRunOpen ? (
        <SidebarModal
          title={t('history.startNewRun')}
          eyebrow={t('history.startNewRunEyebrow')}
          onClose={() => setNewRunOpen(false)}
        >
          <ComposerCard
            clientSessionId={clientSessionId}
            onRunStarted={(runId) => {
              setNewRunOpen(false);
              onRunStarted(runId);
            }}
          />
        </SidebarModal>
      ) : null}

      {byokOpen ? (
        <ByokModal
          clientSessionId={clientSessionId}
          onClose={() => setByokOpen(false)}
          onResetSession={onResetSession}
        />
      ) : null}
    </aside>
  );
}

function ByokModal({
  clientSessionId,
  onClose,
  onResetSession,
}: {
  clientSessionId: string;
  onClose: () => void;
  onResetSession: () => void;
}) {
  const t = useT();
  return (
    <SidebarModal title={t('byok.modalTitle')} eyebrow={t('byok.modalEyebrow')} onClose={onClose}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div
          style={{
            padding: 12,
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border-subtle)',
            background: 'var(--color-background-secondary)',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--font-size-body-sm)',
            lineHeight: 1.45,
          }}
        >
          {t('byok.modalCopy')}
        </div>
        <SessionByokPanel
          clientSessionId={clientSessionId}
          onResetSession={onResetSession}
          initialOpen
        />
      </div>
    </SidebarModal>
  );
}

function RailIconButton({
  label,
  onClick,
  children,
}: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={smallIconButtonStyle}
    >
      {children}
    </button>
  );
}

const primaryCtaStyle: CSSProperties = {
  height: 44,
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
  fontSize: 'var(--font-size-body)',
  fontWeight: 780,
  boxShadow: '0 12px 28px color-mix(in srgb, var(--color-accent) 22%, transparent)',
};

const secondaryCtaStyle: CSSProperties = {
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
  fontWeight: 750,
  boxShadow: 'var(--shadow-soft)',
};

const smallIconButtonStyle: CSSProperties = {
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

function SidebarModal({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: custom sidebar modal shell needs non-dialog layout control.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        padding: '96px 24px 24px 44px',
        background: 'rgba(17, 13, 10, 0.34)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 132px)',
          overflowY: 'auto',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-background)',
          boxShadow: 'var(--shadow-elevated)',
          padding: 16,
          display: 'grid',
          gap: 12,
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-faint)',
                letterSpacing: 'var(--tracking-label)',
                textTransform: 'uppercase',
              }}
            >
              {eyebrow}
            </div>
            <h2
              style={{
                margin: '2px 0 0',
                fontFamily: 'var(--font-display)',
                fontSize: 24,
                fontWeight: 500,
                color: 'var(--color-text-primary)',
              }}
            >
              {title}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={smallIconButtonStyle}>
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  meta,
  action,
  active = false,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  action?: ReactNode;
  active?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '0 2px',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--font-size-body-sm)',
        fontWeight: 760,
        color: 'var(--color-text-primary)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        <span style={{ color: active ? 'var(--color-warning)' : 'var(--color-text-faint)' }}>
          {icon}
        </span>
        {title}
      </span>
      {action ?? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: active ? 'var(--color-warning)' : 'var(--color-text-faint)',
          }}
        >
          {active ? (
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-warning)',
              }}
            />
          ) : null}
          {meta}
        </span>
      )}
    </div>
  );
}

function MiniActionButton({
  label,
  onClick,
  children,
}: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={miniActionButtonStyle}
    >
      {children}
    </button>
  );
}

function RailTextButton({ label }: { label: string }) {
  return (
    <button type="button" style={railTextButtonStyle}>
      <span aria-hidden>-&gt;</span>
      {label}
    </button>
  );
}

function StatusSummaryRow({
  label,
  count,
  color,
}: { label: string; count: number; color: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 10,
        padding: '2px 4px',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        color: 'var(--color-text-secondary)',
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <span>{label}</span>
      <span
        style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-faint)' }}
      >
        {count}
      </span>
    </div>
  );
}

function ProjectRow({
  title,
  status,
  runCount,
  costMicroUsd,
  active,
  starred,
  onClick,
}: {
  title: string;
  status: string;
  runCount: number;
  costMicroUsd: number;
  active: boolean;
  starred: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const statusLabel = status === 'empty' ? t('history.empty') : status;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      style={{
        width: '100%',
        textAlign: 'left',
        border: `1px solid ${active ? 'color-mix(in srgb, var(--color-accent) 28%, var(--color-border-subtle))' : 'transparent'}`,
        borderRadius: 'var(--radius-md)',
        background: active ? 'var(--color-accent-soft)' : 'transparent',
        color: 'var(--color-text-primary)',
        padding: '8px 10px',
        cursor: 'pointer',
        display: 'grid',
        gap: 4,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: active ? 780 : 560,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span style={{ color: starred ? 'var(--color-accent)' : 'var(--color-text-faint)' }}>
          {starred ? t('history.starred') : statusLabel}
        </span>
      </span>
      <span
        style={{
          display: 'flex',
          gap: 10,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-faint)',
        }}
      >
        <span>{t('history.runCount', { count: runCount, plural: runCount === 1 ? '' : 's' })}</span>
        <span>${(costMicroUsd / 1_000_000).toFixed(4)}</span>
      </span>
    </button>
  );
}

function RunRow({
  title,
  status,
  ageLabel,
  costMicroUsd,
  active,
  onClick,
}: {
  title: string;
  status: string;
  ageLabel: string;
  costMicroUsd: number;
  active: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const running =
    status === 'queued' ||
    status === 'generating' ||
    status === 'decomposing' ||
    status === 'verifying' ||
    status === 'iterating';
  const statusLabel = t(`history.status.${status}`);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      style={{
        width: '100%',
        textAlign: 'left',
        border: `1px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
        borderRadius: 'var(--radius-md)',
        background: active ? 'var(--color-accent-soft)' : 'transparent',
        color: 'var(--color-text-primary)',
        padding: '8px 10px',
        cursor: 'pointer',
        display: 'grid',
        gap: 5,
      }}
    >
      <span
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: 8,
          alignItems: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: active ? 760 : 620,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: running
              ? 'var(--color-warning)'
              : status === 'failed'
                ? 'var(--color-error)'
                : 'var(--color-success)',
          }}
        />
      </span>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-faint)',
        }}
      >
        <span>{statusLabel}</span>
        <span>{ageLabel || `$${(costMicroUsd / 1_000_000).toFixed(4)}`}</span>
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

const miniActionButtonStyle: CSSProperties = {
  width: 26,
  height: 26,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-secondary)',
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer',
};

const railTextButtonStyle: CSSProperties = {
  width: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  padding: '6px 8px',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  cursor: 'pointer',
};

const proBadgeStyle: CSSProperties = {
  padding: '2px 7px',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--color-accent-soft)',
  color: 'var(--color-accent)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
};

const footerCollapseStyle: CSSProperties = {
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: 'var(--radius-md)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer',
};
