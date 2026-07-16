// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NodeSlideDeckCiResult,
  NodeSlideDeckCiStatus,
} from '../../../../convex/lib/nodeslideDeckCi';
import { DeckCiStatus } from './DeckCiStatus';

afterEach(cleanup);

function ciResult(
  status: NodeSlideDeckCiStatus,
  blockerCount = 0,
  warningCount = 0,
): NodeSlideDeckCiResult {
  return {
    schemaVersion: 'nodeslide.deck-ci/v1',
    deckId: 'deck_ci',
    deckVersion: 3,
    snapshotDigest: 'snapshot-digest',
    referenceTime: 1_720_000_000_000,
    status,
    checks: [],
    blockerCount,
    severityCounts: { critical: 0, error: blockerCount, warning: warningCount, info: 0 },
    affectedSlideIds: [],
    affectedElementIds: [],
    affectedSourceIds: [],
    changedSourceImpact: {
      changedSourceIds: [],
      boundSourceIds: [],
      unboundSourceIds: [],
      missingSourceIds: [],
      slideIds: [],
      elementIds: [],
    },
    validation: {
      id: 'validation_ci',
      supplied: true,
      inputAccepted: true,
      ok: blockerCount === 0,
      publishOk: blockerCount === 0,
      cleanOk: blockerCount === 0 && warningCount === 0,
    },
    semantic: { id: 'semantic_ci', verdict: status === 'fail' ? 'blocked' : 'pass' },
    digest: 'ci-digest',
  };
}

describe('DeckCiStatus', () => {
  it.each([
    { props: { result: null, loading: true }, state: 'loading', label: 'Checking' },
    { props: { result: ciResult('pass') }, state: 'pass', label: 'Passed' },
    { props: { result: ciResult('warn', 0, 2) }, state: 'warn', label: 'Warnings' },
    { props: { result: ciResult('fail', 3, 1) }, state: 'fail', label: 'Failed' },
    { props: { result: null }, state: 'unavailable', label: 'Unavailable' },
    {
      props: { result: ciResult('pass'), error: new Error('network down') },
      state: 'unavailable',
      label: 'Unavailable',
    },
  ])('renders the $state state in the live region', ({ props, state, label }) => {
    render(<DeckCiStatus {...props} />);

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    expect(liveRegion).toHaveAttribute('data-state', state);
    expect(liveRegion).toHaveTextContent(`Deck CI${label}`);
  });

  it('shows blocker and warning counts without rendering check details', () => {
    render(<DeckCiStatus result={ciResult('fail', 2, 1)} />);

    expect(screen.getByRole('status')).toHaveTextContent('Deck CIFailed2 blockers · 1 warning');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses a native button and opens Trace with Enter and Space', async () => {
    const onOpenTrace = vi.fn();
    const user = userEvent.setup();
    render(<DeckCiStatus result={ciResult('warn', 0, 2)} onOpenTrace={onOpenTrace} />);

    const button = screen.getByRole('button', {
      name: 'Deck CI Warnings, 0 blockers, 2 warnings. Open Trace',
    });
    button.focus();

    await user.keyboard('{Enter}');
    await user.keyboard('[Space]');

    expect(onOpenTrace).toHaveBeenCalledTimes(2);
  });
});
