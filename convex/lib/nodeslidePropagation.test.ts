import { describe, expect, it } from 'vitest';
import type { DeckPatch, SlideElement } from '../../shared/nodeslide';
import { planNodeSlidePropagation } from './nodeslidePropagation';
import { buildGoldenNodeSlide } from './nodeslideSeed';

describe('NodeSlide propagation proposals', () => {
  it('creates a separate bounded proposal from deterministic semantic-role matches', () => {
    const snapshot = buildGoldenNodeSlide('propagation-separation', 1_700_000_000_000).snapshot;
    const groups = new Map<string, SlideElement[]>();
    for (const element of snapshot.elements.filter(
      (candidate) => !candidate.locked && candidate.role,
    )) {
      const key = `${element.kind}:${element.role}`;
      groups.set(key, [...(groups.get(key) ?? []), element]);
    }
    const matches = [...groups.values()].find(
      (elements) => new Set(elements.map((element) => element.slideId)).size > 1,
    );
    if (!matches?.[0]) throw new Error('Expected repeated semantic-role fixture.');
    const source = matches[0];
    source.style = { ...source.style, opacity: 0.73 };
    const parentOperations: DeckPatch['operations'] = [
      {
        op: 'update_style',
        slideId: source.slideId,
        elementId: source.id,
        properties: { opacity: 0.73 },
      },
    ];
    const parentBefore = structuredClone(parentOperations);
    const plan = planNodeSlidePropagation(snapshot, {
      id: 'accepted-source-patch',
      deckId: snapshot.deck.id,
      status: 'accepted',
      operations: parentOperations,
      proposalKind: 'edit',
    });

    expect(plan.parentPatchId).toBe('accepted-source-patch');
    expect(plan.operations.length).toBeGreaterThan(0);
    expect(
      plan.operations.every(
        (operation) => !('slideId' in operation) || operation.slideId !== source.slideId,
      ),
    ).toBe(true);
    expect(plan.affectedSlideIds).not.toContain(source.slideId);
    expect(plan.affectedSlideDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parentOperations).toEqual(parentBefore);
  });
});
