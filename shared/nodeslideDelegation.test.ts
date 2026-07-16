import { describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../convex/lib/nodeslideSeed';
import type { PatchOperation } from './nodeslide';
import {
  evaluateNodeSlideDelegationAutoCommit,
  nodeSlideDelegationCandidateViolations,
  nodeSlideDelegationCompositionRequiresReview,
  nodeSlideDelegationOperationRequiresReview,
} from './nodeslideDelegation';

describe('NodeSlide delegated semantic review policy', () => {
  it('permits Turbo only for an active authority, validation-clean candidate, and Deck CI pass', () => {
    const snapshot = buildGoldenNodeSlide('delegation-turbo-policy', 1_000).snapshot;
    const operation = textOperation('A bounded, validated edit');
    const proposal = {
      deckId: snapshot.deck.id,
      scope: {
        kind: 'elements' as const,
        deckId: snapshot.deck.id,
        slideIds: ['slide-a'],
        elementIds: ['element-a'],
        operationMode: 'copy' as const,
      },
      operations: [operation],
      source: 'agent' as const,
      proposalKind: 'edit' as const,
      traceId: 'trace-turbo',
    };
    const grant = {
      deckId: snapshot.deck.id,
      expiresAt: 2_000,
      useCount: 0,
      maxUses: 4,
      maxOperations: 8,
    };

    expect(
      evaluateNodeSlideDelegationAutoCommit({
        grant,
        proposal,
        evaluatedAt: 1_500,
        candidateValidationPassed: true,
        deckCiPassed: true,
      }),
    ).toEqual({ outcome: 'commit', reason: 'allowed' });
    expect(
      evaluateNodeSlideDelegationAutoCommit({
        grant,
        proposal,
        evaluatedAt: 1_500,
        candidateValidationPassed: true,
        deckCiPassed: false,
      }),
    ).toEqual({ outcome: 'awaiting_review', reason: 'deck_ci_pass_required' });
    expect(
      evaluateNodeSlideDelegationAutoCommit({
        grant: { ...grant, useCount: grant.maxUses },
        proposal,
        evaluatedAt: 1_500,
        candidateValidationPassed: true,
        deckCiPassed: true,
      }),
    ).toEqual({ outcome: 'failed', reason: 'grant_inactive' });
  });

  it.each([
    ['zero-width text', textOperation('\u200B\u200D')],
    ['short transparent hex', styleOperation({ fill: '#0000' })],
    ['modern RGB alpha', styleOperation({ color: 'rgb(0 0 0 / 0)' })],
    ['modern percentage alpha', styleOperation({ color: 'oklch(50% 0.2 20 / 0%)' })],
    ['same opaque foreground and fill', styleOperation({ color: '#fff', fill: '#ffffff' })],
    [
      'equivalent RGB foreground and fill',
      styleOperation({ color: '#fff', fill: 'rgb(255, 255, 255)' }),
    ],
    ['current color paint', styleOperation({ fill: 'currentColor' })],
    ['named paint alias', styleOperation({ fill: 'red' })],
    ['unparsed HSL paint', styleOperation({ fill: 'hsl(0 100% 50%)' })],
    ['negative alpha', styleOperation({ fill: 'rgb(0 0 0 / -1)' })],
    ['exponent alpha', styleOperation({ fill: 'rgb(0 0 0 / 0e0)' })],
    ['calculated alpha', styleOperation({ fill: 'rgb(0 0 0 / calc(0))' })],
    ['hangul filler text', textOperation('\u115F\u1160')],
    ['oversized padding', styleOperation({ padding: 10_000 })],
    ['oversized stroke', styleOperation({ strokeWidth: 10_000 })],
    ['unbounded shadow', styleOperation({ shadow: '0 0 0 100vmax #000' })],
  ])('requires review for %s', (_label, operation) => {
    expect(nodeSlideDelegationOperationRequiresReview(operation)).toBe(true);
  });

  it('requires review for any image replacement and transparent chart series', () => {
    expect(
      nodeSlideDelegationOperationRequiresReview({
        op: 'update_image',
        slideId: 'slide-a',
        elementId: 'element-a',
        imageUrl: 'data:image/png;base64,transparent',
        altText: 'A meaningful description',
      }),
    ).toBe(true);
    expect(
      nodeSlideDelegationOperationRequiresReview({
        op: 'update_chart',
        slideId: 'slide-a',
        elementId: 'element-a',
        chart: {
          chartType: 'line',
          labels: ['A'],
          series: [{ name: 'Series', values: [1], color: 'transparent' }],
        },
      }),
    ).toBe(true);
    expect(
      nodeSlideDelegationOperationRequiresReview({
        op: 'reorder_element_v1',
        slideId: 'slide-a',
        elementId: 'element-a',
        index: 0,
      }),
    ).toBe(true);
  });

  it('requires review when individually bounded operations compose into a cover or erase', () => {
    const snapshot = buildGoldenNodeSlide('delegation-composition-test', 1_000).snapshot;
    const element = structuredClone(snapshot.elements[0]);
    if (!element) throw new Error('Expected a seeded slide element.');
    element.id = 'element-composed-cover';
    element.locked = false;
    element.bbox = { x: 0, y: 0, width: 0.1, height: 0.1 };
    element.style = { fill: '#000000', opacity: 1 };
    expect(
      nodeSlideDelegationCompositionRequiresReview([
        { op: 'add_element', slideId: element.slideId, element },
        {
          op: 'resize',
          slideId: element.slideId,
          elementId: element.id,
          width: 1,
          height: 1,
        },
      ]),
    ).toBe(true);
    expect(
      nodeSlideDelegationCompositionRequiresReview([
        styleOperation({ color: '#fff' }),
        styleOperation({ fill: 'rgb(255 255 255)' }),
      ]),
    ).toBe(true);
  });

  it('evaluates the authoritative composed candidate against existing style', () => {
    const baseline = buildGoldenNodeSlide('delegation-candidate-test', 1_000).snapshot;
    const before = baseline.elements[0];
    if (!before) throw new Error('Expected a seeded slide element.');
    before.style.fill = '#ffffff';
    const candidate = structuredClone(baseline);
    const after = candidate.elements.find((element) => element.id === before.id);
    if (!after) throw new Error('Expected candidate element.');
    after.style.color = 'rgb(255, 255, 255)';
    const operations: PatchOperation[] = [
      {
        op: 'update_style',
        slideId: before.slideId,
        elementId: before.id,
        properties: { color: 'rgb(255, 255, 255)' },
      },
    ];
    expect(nodeSlideDelegationCandidateViolations({ baseline, candidate, operations })).toContain(
      'The composed candidate makes content unreadable.',
    );
  });

  it('stops geometry, style, and visibility aliases that can reveal a full-slide cover', () => {
    const baseline = buildGoldenNodeSlide('delegation-cover-alias-test', 1_000).snapshot;
    const before = baseline.elements[0];
    if (!before) throw new Error('Expected a seeded slide element.');
    before.locked = false;
    before.visible = true;
    before.bbox = { x: 0, y: 0, width: 1, height: 1 };
    before.style = { fill: '#000000', opacity: 1 };

    const moved = structuredClone(baseline);
    expect(
      nodeSlideDelegationCandidateViolations({
        baseline,
        candidate: moved,
        operations: [{ op: 'move', slideId: before.slideId, elementId: before.id, x: 0, y: 0 }],
      }),
    ).toContain('The composed candidate hides or covers slide content.');

    const styleBaseline = structuredClone(baseline);
    const styleBefore = styleBaseline.elements[0];
    if (!styleBefore) throw new Error('Expected a seeded style element.');
    styleBefore.style = { opacity: 1 };
    const styled = structuredClone(styleBaseline);
    const styleAfter = styled.elements[0];
    if (!styleAfter) throw new Error('Expected a candidate style element.');
    styleAfter.style.fill = '#000000';
    expect(
      nodeSlideDelegationCandidateViolations({
        baseline: styleBaseline,
        candidate: styled,
        operations: [
          {
            op: 'update_style',
            slideId: styleBefore.slideId,
            elementId: styleBefore.id,
            properties: { fill: '#000000' },
          },
        ],
      }),
    ).toContain('The composed candidate hides or covers slide content.');

    const hiddenBaseline = structuredClone(baseline);
    const hiddenBefore = hiddenBaseline.elements[0];
    if (!hiddenBefore) throw new Error('Expected a seeded hidden element.');
    hiddenBefore.visible = false;
    const revealed = structuredClone(hiddenBaseline);
    const revealedAfter = revealed.elements[0];
    if (!revealedAfter) throw new Error('Expected a candidate revealed element.');
    revealedAfter.visible = true;
    expect(
      nodeSlideDelegationCandidateViolations({
        baseline: hiddenBaseline,
        candidate: revealed,
        operations: [
          {
            op: 'set_visibility_v1',
            slideId: hiddenBefore.slideId,
            elementId: hiddenBefore.id,
            visible: true,
          },
        ],
      }),
    ).toContain('The composed candidate reveals content that can cover the slide.');
  });

  it('requires review for a locked full-slide cover added above existing content', () => {
    const snapshot = buildGoldenNodeSlide('delegation-cover-test', 1_000).snapshot;
    const element = structuredClone(snapshot.elements[0]);
    if (!element) throw new Error('Expected a seeded slide element.');
    element.id = 'element-cover';
    element.locked = true;
    element.bbox = { x: 0, y: 0, width: 1, height: 1 };
    element.style = { fill: '#000000', opacity: 1 };

    expect(
      nodeSlideDelegationOperationRequiresReview({
        op: 'add_element',
        slideId: element.slideId,
        element,
      }),
    ).toBe(true);
  });

  it('still auto-applies ordinary visible copy and bounded layout edits', () => {
    expect(nodeSlideDelegationOperationRequiresReview(textOperation('Visible takeaway'))).toBe(
      false,
    );
    expect(nodeSlideDelegationOperationRequiresReview(styleOperation({ color: '#1b2430' }))).toBe(
      false,
    );
    expect(
      nodeSlideDelegationOperationRequiresReview({
        op: 'move',
        slideId: 'slide-a',
        elementId: 'element-a',
        x: 0.1,
        y: 0.2,
      }),
    ).toBe(false);
    expect(
      nodeSlideDelegationOperationRequiresReview({
        op: 'update_chart',
        slideId: 'slide-a',
        elementId: 'element-a',
        chart: {
          chartType: 'bar',
          labels: ['A'],
          series: [{ name: 'Series', values: [1], color: '#1b2430' }],
        },
      }),
    ).toBe(false);
  });
});

function textOperation(text: string): PatchOperation {
  return { op: 'replace_text', slideId: 'slide-a', elementId: 'element-a', text };
}

function styleOperation(
  properties: Extract<PatchOperation, { op: 'update_style' }>['properties'],
): PatchOperation {
  return {
    op: 'update_style',
    slideId: 'slide-a',
    elementId: 'element-a',
    properties,
  };
}
