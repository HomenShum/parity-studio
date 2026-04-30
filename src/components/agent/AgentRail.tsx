import { useQuery } from 'convex/react';
import { ChevronDown, ChevronRight, ExternalLink, List, Plus, Radio } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { ChatPanel } from '../canvas/ChatPanel';
import { ComposerCard } from '../composer/ComposerCard';
import {
  PipelineActivityCard,
  type PipelineStage,
  type PipelineState,
} from '../pipeline/PipelineActivityCard';

interface AgentRailProps {
  currentRunId: Id<'runs'> | null;
  onSelectRun: (runId: Id<'runs'>) => void;
  onRunStarted: (runId: Id<'runs'>) => void;
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

function relativeTime(ts: number | undefined): string {
  if (ts === undefined) return '';
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function AgentRail({ currentRunId, onSelectRun, onRunStarted }: AgentRailProps) {
  const [runsOpen, setRunsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(currentRunId === null);
  const runs = useQuery(api.runs.listRecent, { limit: 12 });

  useEffect(() => {
    if (currentRunId === null) setSourceOpen(true);
  }, [currentRunId]);

  const rows: ActivityRow[] = useMemo(() => {
    if (!runs) return [];
    const out: ActivityRow[] = [];
    for (const run of runs) {
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
          ageLabel: relativeTime(entry.stageStartedAt),
          edits: entry.outputTokens ? Math.max(1, Math.round(entry.outputTokens / 200)) : undefined,
          src: entry.inputTokens ? Math.max(1, Math.round(entry.inputTokens / 50)) : undefined,
          runId: run._id,
        });
      }
      if (run.iterationsCompleted > 0 && !seen.has('iterate')) {
        out.push({
          key: `${run._id}-iterate`,
          stage: 'iterate',
          state: run.status === 'iterating' ? 'running' : run.status === 'failed' ? 'failed' : 'done',
          ageLabel: relativeTime(run.finishedAt ?? run._creationTime),
          edits: run.iterationsCompleted,
          src: undefined,
          runId: run._id,
        });
      }
    }
    return out.slice(0, 8);
  }, [runs]);

  const activeCount = rows.filter((row) => row.state === 'running').length;

  return (
    <aside
      aria-label="Agent stream"
      style={{
        flex: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        background: 'var(--color-background-secondary)',
        borderRight: '1px solid var(--color-border-subtle)',
      }}
    >
      <div
        style={{
          padding: 'var(--space-5) var(--space-5) var(--space-3)',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                width: 24,
                height: 24,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-accent)',
                color: 'var(--color-on-accent)',
                display: 'inline-grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <Radio size={13} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 700,
                  fontSize: 13,
                  color: 'var(--color-text-primary)',
                }}
              >
                Agent stream
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
                chat + tool calls stay visible
              </div>
            </div>
          </div>
          <a
            href="https://github.com/HomenShum/parity-studio"
            aria-label="View Parity Studio repository on GitHub"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            GitHub
            <ExternalLink size={10} aria-hidden />
          </a>
        </div>

        <button
          type="button"
          onClick={() => setRunsOpen((value) => !value)}
          aria-expanded={runsOpen}
          style={{
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)',
            color: 'var(--color-text-secondary)',
            padding: '0 10px',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--font-size-body-sm)',
            cursor: 'pointer',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {runsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Runs and pipeline history
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: activeCount > 0 ? 'var(--color-warning)' : 'var(--color-success)',
              }}
            />
            {activeCount > 0 ? `${activeCount} active` : `${rows.length} recent`}
          </span>
        </button>
      </div>

      {runsOpen ? (
        <div
          style={{
            maxHeight: '32%',
            minHeight: 128,
            overflowY: 'auto',
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--color-border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {runs === undefined ? (
            <RailHint text="loading runs..." />
          ) : rows.length === 0 ? (
            <RailHint text="no runs yet" />
          ) : (
            rows.map((row) => (
              <PipelineActivityCard
                key={row.key}
                stage={row.stage}
                state={row.state}
                ageLabel={row.ageLabel}
                edits={row.edits}
                src={row.src}
                active={row.runId === currentRunId}
                onClick={() => onSelectRun(row.runId)}
              />
            ))
          )}
          <button
            type="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              height: 34,
              background: 'transparent',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body-sm)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <List size={13} />
            View all runs
          </button>
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
        <ChatPanel runId={currentRunId} variant="rail" />
      </div>

      <div
        style={{
          borderTop: '1px solid var(--color-border-subtle)',
          padding: 'var(--space-3) var(--space-4) var(--space-4)',
          background: 'var(--color-background)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {currentRunId !== null ? (
          <button
            type="button"
            onClick={() => setSourceOpen((value) => !value)}
            aria-expanded={sourceOpen}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              height: 34,
              padding: '0 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border-subtle)',
              background: sourceOpen ? 'var(--color-accent-soft)' : 'var(--color-surface)',
              color: sourceOpen ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body-sm)',
              fontWeight: 600,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {sourceOpen ? <ChevronDown size={13} /> : <Plus size={13} />}
              Start new run
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-faint)' }}>
              prompt / image / ui_kit zip
            </span>
          </button>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--color-text-faint)',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            <span>Start or import source</span>
            <Plus size={12} aria-hidden />
          </div>
        )}
        {sourceOpen || currentRunId === null ? (
          <ComposerCard
            onRunStarted={(runId) => {
              setSourceOpen(false);
              onRunStarted(runId);
            }}
          />
        ) : null}
      </div>
    </aside>
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
