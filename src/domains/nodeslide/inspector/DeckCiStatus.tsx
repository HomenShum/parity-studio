import type { NodeSlideDeckCiResult } from '../../../../convex/lib/nodeslideDeckCi';
import './DeckCiStatus.css';

type DeckCiDisplayState = NodeSlideDeckCiResult['status'] | 'loading' | 'unavailable';

export interface DeckCiStatusProps {
  result: NodeSlideDeckCiResult | null;
  loading?: boolean;
  error?: unknown;
  onOpenTrace?: () => void;
}

const STATUS_LABELS: Record<DeckCiDisplayState, string> = {
  loading: 'Checking',
  pass: 'Passed',
  warn: 'Warnings',
  fail: 'Failed',
  unavailable: 'Unavailable',
};

/** A compact Deck CI summary; individual checks remain in Trace. */
export function DeckCiStatus({ result, loading = false, error, onOpenTrace }: DeckCiStatusProps) {
  const state = displayState(result, loading, error);
  const statusLabel = STATUS_LABELS[state];
  const counts =
    result && state !== 'loading' && state !== 'unavailable' ? resultCounts(result) : null;
  const content = (
    <>
      <span className="ns-deck-ci-status__dot" aria-hidden="true" />
      <span className="ns-deck-ci-status__name">Deck CI</span>
      <strong>{statusLabel}</strong>
      {counts ? (
        <span className="ns-deck-ci-status__counts">
          {countLabel(counts.blockers, 'blocker')}
          <span aria-hidden="true"> · </span>
          {countLabel(counts.warnings, 'warning')}
        </span>
      ) : null}
    </>
  );

  const summary = [
    `Deck CI ${statusLabel}`,
    counts ? countLabel(counts.blockers, 'blocker') : null,
    counts ? countLabel(counts.warnings, 'warning') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <output
      className={`ns-deck-ci-status is-${state}`}
      aria-live="polite"
      aria-atomic="true"
      data-state={state}
    >
      {onOpenTrace ? (
        <button
          type="button"
          className="ns-deck-ci-status__line"
          onClick={onOpenTrace}
          aria-label={`${summary}. Open Trace`}
        >
          {content}
        </button>
      ) : (
        <span className="ns-deck-ci-status__line">{content}</span>
      )}
    </output>
  );
}

function displayState(
  result: NodeSlideDeckCiResult | null,
  loading: boolean,
  error: unknown,
): DeckCiDisplayState {
  if (loading) return 'loading';
  if (error !== undefined && error !== null) return 'unavailable';
  return result?.status ?? 'unavailable';
}

function resultCounts(result: NodeSlideDeckCiResult) {
  return {
    blockers: result.blockerCount,
    warnings: result.severityCounts.warning,
  };
}

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
