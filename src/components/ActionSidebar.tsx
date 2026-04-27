import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * ActionSidebar — live pipeline status + parity score + cost from Convex.
 *
 * Reads run + parityReports:getLatest. Stage status is derived from run.status:
 *   queued       -> all idle
 *   generating   -> generate=running
 *   decomposing  -> generate=done, decompose=running
 *   verifying    -> generate=done, decompose=done, verify=running
 *   iterating    -> generate=done, decompose=done, verify=done, iterate=running
 *   done         -> all done
 *   failed       -> the in-flight stage flips to failed
 */
type StageState = 'idle' | 'running' | 'done' | 'failed' | 'unavailable';

interface ActionSidebarProps {
  runId: Id<'runs'> | null;
  commentModeActive: boolean;
  onToggleCommentMode: () => void;
}

const STAGE_ORDER: ReadonlyArray<{ id: string; label: string; status: string }> = [
  { id: 'generate', label: 'generate', status: 'generating' },
  { id: 'decompose', label: 'decompose', status: 'decomposing' },
  { id: 'verify-deterministic', label: 'verify · deterministic', status: 'verifying' },
  { id: 'verify-visual', label: 'verify · visual', status: 'verifying' },
  { id: 'iterate', label: 'iterate', status: 'iterating' },
];

// TOOLS array removed — buttons are now wired individually in the component

function stageStateFor(runStatus: string | undefined, stageStatus: string): StageState {
  if (runStatus === undefined || runStatus === 'queued') return 'idle';
  if (runStatus === 'failed') return 'failed';
  if (runStatus === 'done') return 'done';
  // verify-visual is intentionally `unavailable` in the in-app pipeline (see workflow comment)
  if (stageStatus === 'verifying' && runStatus === 'verifying') return 'running';
  if (runStatus === stageStatus) return 'running';
  // Stage runs in order — anything before the current run-status stage is done
  const stageIdx = ['generating', 'decomposing', 'verifying', 'iterating'].indexOf(stageStatus);
  const runIdx = ['generating', 'decomposing', 'verifying', 'iterating'].indexOf(runStatus);
  if (stageIdx >= 0 && runIdx >= 0 && stageIdx < runIdx) return 'done';
  return 'idle';
}

function microUsdToUsd(micro: number | undefined): string {
  if (micro === undefined) return '$0.0000';
  return `$${(micro / 1_000_000).toFixed(4)}`;
}

export function ActionSidebar({
  runId,
  commentModeActive,
  onToggleCommentMode,
}: ActionSidebarProps) {
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const parity = useQuery(api.parityReports.getLatest, runId ? { runId } : 'skip');
  const openComments = useQuery(api.comments.listForRun, runId ? { runId } : 'skip');
  const iterateWithComments = useMutation(api.runs.iterateWithComments);
  const [iterateBusy, setIterateBusy] = useState(false);
  const [iterateError, setIterateError] = useState<string | null>(null);

  const openCount = (openComments ?? []).filter((c) => c.status === 'open').length;
  const canIterate =
    runId !== null &&
    !iterateBusy &&
    (run?.status === 'done' || run?.status === 'failed') &&
    openCount > 0;

  async function onIterateNow() {
    if (runId === null) return;
    setIterateError(null);
    setIterateBusy(true);
    try {
      await iterateWithComments({ runId });
    } catch (err) {
      setIterateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIterateBusy(false);
    }
  }

  const passCountDisplay =
    parity && parity.totalChecks > 0 ? String(parity.passCount) : '--';
  const totalChecks = parity?.totalChecks ?? 12;
  const status = parity?.status ?? run?.status ?? 'idle';

  return (
    <>
      <div className="section">
        <div className="section-header">PIPELINE</div>
        {STAGE_ORDER.map((stage) => {
          // Visual-verify stage is always 'unavailable' in the in-app pipeline
          // because Playwright doesn't run in Convex actions. The MCP path
          // covers it; this is honest surface signaling.
          const overrideUnavailable = stage.id === 'verify-visual';
          const state: StageState = overrideUnavailable
            ? 'unavailable'
            : stageStateFor(run?.status, stage.status);
          const cls = state === 'idle' ? 'pipeline-item' : `pipeline-item ${state}`;
          return (
            <div key={stage.id} className={cls}>
              <span className="pipeline-dot" aria-hidden="true" />
              <span>{stage.label}</span>
            </div>
          );
        })}
      </div>
      <div className="section">
        <div className="section-header">PARITY</div>
        <div className="parity-section">
          <div className="parity-status">
            {passCountDisplay} /. {totalChecks} CHECKS
          </div>
          <div className="parity-subtitle">
            STATUS: {status.toUpperCase()}
          </div>
        </div>
      </div>
      <div className="section">
        <div className="section-header">COST</div>
        <div className="cost-section" style={{ borderRadius: 0, border: 0 }}>
          <span className="cost-label">this run</span>
          <span className="cost-value">{microUsdToUsd(run?.costMicroUsd)}</span>
        </div>
      </div>
      <div className="section">
        <div className="section-header">TOOLS</div>
        <button
          type="button"
          className="tools-item"
          aria-pressed={commentModeActive}
          aria-label="toggle bbox region selection on the preview"
          onClick={onToggleCommentMode}
          style={
            commentModeActive
              ? { color: 'var(--accent)', background: 'rgba(217,119,87,0.08)' }
              : undefined
          }
        >
          Comment mode {commentModeActive ? '· active' : ''}
        </button>
        <button
          type="button"
          className="tools-item"
          disabled={!canIterate}
          onClick={onIterateNow}
          aria-label="run another decompose pass folding in any open comments as feedback"
          style={!canIterate ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        >
          {iterateBusy
            ? 'Starting...'
            : openCount > 0
            ? `Iterate now (${openCount} comment${openCount === 1 ? '' : 's'})`
            : 'Iterate now'}
        </button>
        <button
          type="button"
          className="tools-item"
          aria-label="export bundle and copy CLI snippet for Claude Code"
        >
          Hand off to Claude Code
        </button>
        {iterateError !== null ? (
          <div
            style={{
              padding: '6px var(--space-lg) var(--space-md)',
              fontSize: 11,
              color: 'var(--danger)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {iterateError}
          </div>
        ) : null}
      </div>
    </>
  );
}
