import { describe, expect, it } from 'vitest';
import type { PatchOperation, PatchScope } from '../../shared/nodeslide';
import { resolveNodeSlideAgenticControls } from './nodeslideAgenticControls';
import { nodeSlideOperationDigest, nodeSlideSnapshotDigest } from './nodeslideDeckRepl';
import { nodeslideStableId } from './nodeslideIds';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import {
  NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK,
  type NodeSlideShadowComparison,
  assertNodeSlideShadowComparisonBaselineBinding,
  assertNodeSlideShadowComparisonBounds,
  createNodeSlideShadowComparison,
  nodeSlideEditTurnInputDigest,
  nodeSlideShadowComparisonExpected,
  nodeSlideShadowComparisonRetentionPlan,
} from './nodeslideShadowComparison';

const NOW = 1_700_000_000_000;
const OWNER_ACCESS_KEY = 'a'.repeat(43);

function fixture() {
  const snapshot = buildGoldenNodeSlide('shadow-comparison-tests', NOW).snapshot;
  const target = snapshot.elements.find((element) => element.kind === 'text' && !element.locked);
  if (!target) throw new Error('Expected an unlocked text fixture.');
  const slide = snapshot.slides.find((candidate) => candidate.id === target.slideId);
  if (!slide) throw new Error('Expected target slide fixture.');
  const scope: PatchScope = {
    kind: 'elements',
    deckId: snapshot.deck.id,
    slideIds: [slide.id],
    elementIds: [target.id],
    operationMode: 'copy',
  };
  const baselineOperations: PatchOperation[] = [
    {
      op: 'replace_text',
      slideId: slide.id,
      elementId: target.id,
      text: 'BASELINE_SENTINEL_TEXT',
    },
  ];
  const candidateOperations: PatchOperation[] = [
    {
      op: 'replace_text',
      slideId: slide.id,
      elementId: target.id,
      text: 'CANDIDATE_SENTINEL_TEXT',
    },
  ];
  const request = {
    instruction: 'Replace the selected headline.',
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: { [target.id]: target.version },
    scope,
  };
  const patchId = nodeslideStableId('patch', 'shadow-comparison-test');
  const traceId = nodeslideStableId('trace', patchId);
  const comparison = createNodeSlideShadowComparison({
    id: nodeslideStableId('shadow_comparison', patchId),
    deckId: snapshot.deck.id,
    actorSubject: OWNER_ACCESS_KEY,
    turnId: nodeslideStableId('turn', patchId),
    baselinePatchId: patchId,
    baselineTraceId: traceId,
    turnInputDigest: nodeSlideEditTurnInputDigest(request),
    baseSnapshotDigest: nodeSlideSnapshotDigest(snapshot),
    baseDeckVersion: snapshot.deck.version,
    controlsDigest: resolveNodeSlideAgenticControls({
      NODESLIDE_AGENTIC_GLOBAL_ENABLED: 'true',
      NODESLIDE_AGENTIC_SHADOW_ENABLED: 'true',
    }).controlsDigest,
    baseline: {
      adapterId: 'nodeslide/single-shot-edit-planner',
      adapterVersion: '1.0.0',
      origin: 'free_route',
      outcome: 'proposed',
      terminalReason: 'completed',
      proposalDigest: nodeSlideOperationDigest(baselineOperations),
      operationCount: baselineOperations.length,
      elapsedMs: 20,
    },
    candidate: {
      adapterId: 'nodeslide/deterministic-edit-shadow',
      adapterVersion: '1.0.0',
      outcome: 'proposed',
      terminalReason: 'completed',
      proposalDigest: nodeSlideOperationDigest(candidateOperations),
      operationCount: candidateOperations.length,
      elapsedMs: 3,
    },
    createdAt: NOW,
    completedAt: NOW + 23,
  });
  return { comparison, baselineOperations, candidateOperations };
}

describe('NodeSlide paired shadow comparison receipt', () => {
  it('binds both opaque lanes to one input and snapshot without raw operations', () => {
    const { comparison } = fixture();
    expect(() => assertNodeSlideShadowComparisonBounds(comparison)).not.toThrow();
    expect(comparison.turnInputDigest).toMatch(/^turn_sha256:[0-9a-f]{64}$/);
    expect(comparison.baseSnapshotDigest).toMatch(/^snap_sha256:[0-9a-f]{64}$/);
    expect(comparison.baseline.proposalDigest).toMatch(/^ops_sha256:[0-9a-f]{64}$/);
    expect(comparison.candidate.proposalDigest).toMatch(/^ops_sha256:[0-9a-f]{64}$/);
    expect(comparison.candidateExposed).toBe(false);
    expect(comparison.candidateCommitted).toBe(false);
    expect(JSON.stringify(comparison)).not.toContain('BASELINE_SENTINEL_TEXT');
    expect(JSON.stringify(comparison)).not.toContain('CANDIDATE_SENTINEL_TEXT');
    expect(JSON.stringify(comparison)).not.toContain('replace_text');
  });

  it('rejects digest tampering', () => {
    const { comparison } = fixture();
    const tampered = structuredClone(comparison);
    tampered.candidate.operationCount = 2;
    expect(() => assertNodeSlideShadowComparisonBounds(tampered)).toThrow(
      'Shadow comparison digest is invalid.',
    );
  });

  it('rejects proposal metadata on a skipped candidate lane', () => {
    const { comparison } = fixture();
    const invalid = structuredClone(comparison) as NodeSlideShadowComparison;
    invalid.candidate.outcome = 'skipped';
    invalid.candidate.terminalReason = 'skipped_unsupported_instruction';
    expect(() => assertNodeSlideShadowComparisonBounds(invalid)).toThrow(
      'Shadow comparison non-proposal lane contains proposal metadata.',
    );
  });

  it('expires old rows and caps active evidence per deck', () => {
    const { comparison } = fixture();
    const rows = Array.from(
      { length: NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK + 2 },
      (_, index) => ({
        id: `comparison-${index}`,
        createdAt: NOW + index,
        expiresAt: NOW + 10_000,
      }),
    );
    rows.push({ id: 'expired', createdAt: NOW - 10, expiresAt: NOW });
    const removals = nodeSlideShadowComparisonRetentionPlan(rows, NOW + 1);
    expect(removals).toContain('expired');
    expect(removals).toHaveLength(3);
    expect(comparison.expiresAt).toBeGreaterThan(comparison.completedAt);
  });

  it('requires the atomically persisted baseline trace to bind input, snapshot, and controls', () => {
    const { comparison, baselineOperations } = fixture();
    const baselinePatch = {
      id: comparison.baselinePatchId,
      deckId: comparison.deckId,
      traceId: comparison.baselineTraceId,
      source: 'agent',
      status: 'ready',
      baseDeckVersion: comparison.baseDeckVersion,
      operations: baselineOperations,
    };
    const baselineTrace = {
      id: comparison.baselineTraceId,
      deckId: comparison.deckId,
      patchId: comparison.baselinePatchId,
      planningInputDigest: comparison.turnInputDigest,
      planningSnapshotDigest: comparison.baseSnapshotDigest,
      shadowComparisonExpected: true,
      shadowControlsDigest: comparison.controlsDigest,
    };
    expect(() =>
      assertNodeSlideShadowComparisonBaselineBinding({
        comparison,
        baselinePatch,
        baselineTrace,
      }),
    ).not.toThrow();

    expect(() =>
      assertNodeSlideShadowComparisonBaselineBinding({
        comparison,
        baselinePatch,
        baselineTrace: { ...baselineTrace, planningSnapshotDigest: 'snap_sha256:'.padEnd(76, '0') },
      }),
    ).toThrow('Shadow comparison baseline binding mismatch.');
    expect(() =>
      assertNodeSlideShadowComparisonBaselineBinding({
        comparison,
        baselinePatch: { ...baselinePatch, status: 'stale' },
        baselineTrace: { ...baselineTrace, shadowComparisonExpected: false },
      }),
    ).toThrow('Shadow comparison baseline binding mismatch.');
  });

  it('expects a row only when the atomic baseline proposal is not stale', () => {
    expect(nodeSlideShadowComparisonExpected(true, 'ready')).toBe(true);
    expect(nodeSlideShadowComparisonExpected(true, 'accepted')).toBe(true);
    expect(nodeSlideShadowComparisonExpected(true, 'stale')).toBe(false);
    expect(nodeSlideShadowComparisonExpected(false, 'ready')).toBe(false);
  });
});
