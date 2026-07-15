import { describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../convex/lib/nodeslideSeed';
import type { PatchOperation } from './nodeslide';
import { nodeSlideDelegationOperationRequiresReview } from './nodeslideDelegation';

describe('NodeSlide delegated semantic review policy', () => {
  it.each([
    ['zero-width text', textOperation('\u200B\u200D')],
    ['short transparent hex', styleOperation({ fill: '#0000' })],
    ['modern RGB alpha', styleOperation({ color: 'rgb(0 0 0 / 0)' })],
    ['modern percentage alpha', styleOperation({ color: 'oklch(50% 0.2 20 / 0%)' })],
    ['same opaque foreground and fill', styleOperation({ color: '#fff', fill: '#ffffff' })],
  ])('requires review for %s', (_label, operation) => {
    expect(nodeSlideDelegationOperationRequiresReview(operation)).toBe(true);
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
