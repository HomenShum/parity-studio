import { useQuery } from 'convex/react';
import { ExternalLink, List, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { ComposerCard } from '../composer/ComposerCard';
import {
  PipelineActivityCard,
  type PipelineStage,
  type PipelineState,
} from './PipelineActivityCard';

interface PipelinePanelProps {
  currentRunId: Id<'runs'> | null;
  onSelectRun: (runId: Id<'runs'>) => void;
  onRunStarted: (runId: Id<'runs'>) => void;
}

interface ActivityRow {
  key: string;
  stage: PipelineStage;
  state: PipelineState;
  ageLabel: string | undefined;
  description: string | undefined;
  edits: number | undefined;
  src: number | undefined;
  runId: Id<'runs'>;
}

const STAGE_FROM_TELEMETRY: Record<string, PipelineStage> = {
  generate: 'generate',
  decompose: 'decompose',
  iterate: 'decompose',
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

export function PipelinePanel({ currentRunId, onSelectRun, onRunStarted }: PipelinePanelProps) {
  const runs = useQuery(api.runs.listRecent, { limit: 12 });

  const rows: ActivityRow[] = useMemo(() => {
    if (!runs) return [];
    const out: ActivityRow[] = [];
    for (const run of runs) {
      const breakdown = run.costBreakdown ?? [];
      const seen = new Set<PipelineStage>();
      // Iterate breakdown in chronological order; surface one card per stage
      // bucket, picking the most recent within that bucket so the visible
      // state reflects the latest activity for that stage.
      for (let i = breakdown.length - 1; i >= 0; i -= 1) {
        const entry = breakdown[i];
        if (!entry) continue;
        const stage = stageFromTelemetryName(entry.stage);
        if (seen.has(stage)) continue;
        seen.add(stage);
        const isFailed = run.status === 'failed';
        const inFlight =
          (stage === 'generate' && run.status === 'generating') ||
          (stage === 'decompose' && (run.status === 'decomposing' || run.status === 'iterating')) ||
          (stage === 'verify' && run.status === 'verifying');
        out.push({
          key: `${run._id}-${stage}`,
          stage,
          state: inFlight ? 'running' : isFailed ? 'failed' : 'done',
          ageLabel: relativeTime(entry.stageStartedAt),
          description: undefined,
          edits: entry.outputTokens ? Math.max(1, Math.round(entry.outputTokens / 200)) : undefined,
          src: entry.inputTokens ? Math.max(1, Math.round(entry.inputTokens / 50)) : undefined,
          runId: run._id,
        });
      }
      // Backfill iterate row if the run had any iterations
      if (run.iterationsCompleted > 0 && !seen.has('iterate')) {
        out.push({
          key: `${run._id}-iterate`,
          stage: 'iterate',
          state:
            run.status === 'iterating' ? 'running' : run.status === 'failed' ? 'failed' : 'done',
          ageLabel: relativeTime(run.finishedAt ?? run._creationTime),
          description: undefined,
          edits: run.iterationsCompleted,
          src: undefined,
          runId: run._id,
        });
      }
    }
    // Surface the most recent 8 rows
    return out.slice(0, 8);
  }, [runs]);

  const activeCount = rows.filter((r) => r.state === 'running').length || rows.length;

  return (
    <aside
      style={{
        flex: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-background-secondary)',
        borderRight: '1px solid var(--color-border-subtle)',
        minWidth: 0,
      }}
      aria-label="Pipeline activity"
    >
      <div
        style={{
          padding: 'var(--space-5) var(--space-5) var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: 'var(--font-sans)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 'var(--tracking-eyebrow)',
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
          }}
        >
          <span>Pipeline activity</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              textTransform: 'none',
              letterSpacing: 'normal',
              color: 'var(--color-text-secondary)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-success)',
              }}
            />
            Convex
            <a
              href="https://github.com/HomenShum/parity-studio"
              aria-label="View source on GitHub"
              style={{
                marginLeft: 4,
                color: 'var(--color-text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              source
              <ExternalLink size={10} aria-hidden />
            </a>
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--font-size-body-sm)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <span>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
              {activeCount}
            </span>{' '}
            active threads
          </span>
          <button
            type="button"
            aria-label="New run"
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 24,
              height: 24,
              background: 'transparent',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-3) var(--space-4) var(--space-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {runs === undefined ? (
          <Skeleton />
        ) : rows.length === 0 ? (
          <EmptyHint />
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
      </div>

      <div
        style={{
          padding: '0 var(--space-4) var(--space-3)',
          borderTop: '1px solid var(--color-border-subtle)',
          paddingTop: 'var(--space-3)',
        }}
      >
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

      <div
        style={{
          padding: 'var(--space-3) var(--space-4) var(--space-4)',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-background)',
        }}
      >
        <ComposerCard onRunStarted={onRunStarted} />
      </div>
    </aside>
  );
}

function Skeleton() {
  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--color-text-faint)',
      }}
    >
      loading runs…
    </div>
  );
}

function EmptyHint() {
  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--color-surface)',
        border: '1px dashed var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--font-size-body-sm)',
        color: 'var(--color-text-secondary)',
      }}
    >
      No runs yet. Drop an image or describe a design below to start the pipeline.
    </div>
  );
}
