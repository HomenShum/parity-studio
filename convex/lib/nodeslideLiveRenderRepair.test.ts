import { describe, expect, it } from 'vitest';
import type { DeckSnapshot } from '../../shared/nodeslide';
import {
  deterministicRepairOperations,
  runNodeSlideLiveRenderRepair,
} from './nodeslideLiveRenderRepair';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_700_000_000_000;

function golden(): DeckSnapshot {
  return buildGoldenNodeSlide('live-render-repair-tests', NOW).snapshot;
}

describe('NodeSlide live render repair', () => {
  it('completes clean on a coherent deck with a receipt trail', () => {
    const { result, summary } = runNodeSlideLiveRenderRepair(golden());
    expect(summary.status).toBe('completed');
    expect(summary.terminalReason).toBe('clean');
    expect(summary.receipts.length).toBeGreaterThan(0);
    expect(result.operations).toHaveLength(0);
    expect(summary.baseSnapshotDigest).toBe(summary.candidateSnapshotDigest);
  });

  it('emits a live repair receipt trail with a repair stage for a defective deck', () => {
    const snapshot = golden();
    const text = snapshot.elements.find((element) => element.kind === 'text' && !element.locked);
    if (!text) throw new Error('Golden fixture must include unlocked text.');
    // Out-of-bounds geometry is a deterministic automatic-repair class.
    text.bbox = { x: 0.9, y: 0.9, width: 0.5, height: 0.4 };

    const { result, summary } = runNodeSlideLiveRenderRepair(snapshot);
    // The DEPTH D1 visible signal: more than one iteration receipt, at least
    // one of which consumed a prior receipt's output as a repair.
    expect(result.receipts.length).toBeGreaterThan(1);
    expect(result.receipts.some((receipt) => receipt.status === 'repaired')).toBe(true);
    expect(summary.proposalOperationCount).toBeGreaterThan(0);
    expect(summary.baseSnapshotDigest).not.toBe(summary.candidateSnapshotDigest);
  });

  it('derives exact review-path operations from the automatic repair plan', () => {
    const snapshot = golden();
    const text = snapshot.elements.find((element) => element.kind === 'text' && !element.locked);
    if (!text) throw new Error('Golden fixture must include unlocked text.');
    text.bbox = { x: 0.9, y: 0.9, width: 0.5, height: 0.4 };

    const operations = deterministicRepairOperations(snapshot);
    expect(operations.length).toBeGreaterThan(0);
    const move = operations.find(
      (operation) => operation.op === 'move' && operation.elementId === text.id,
    );
    expect(move).toBeDefined();
  });
});
