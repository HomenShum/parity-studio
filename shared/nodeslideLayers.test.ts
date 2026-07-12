import { describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../convex/lib/nodeslideSeed';
import type { DeckSnapshot, PatchOperation, PatchScope, SlideElement } from './nodeslide';
import { applyDeckPatch } from './nodeslidePatch';

function apply(
  snapshot: DeckSnapshot,
  scope: PatchScope,
  operations: PatchOperation[],
): DeckSnapshot {
  return applyDeckPatch(
    snapshot,
    { baseDeckVersion: snapshot.deck.version, scope, operations },
    snapshot.deck.updatedAt + 1,
  ).snapshot;
}

describe('NodeSlide layers/v1 operations', () => {
  it('applies visibility, flat grouping, ungrouping, and element z-order deterministically', () => {
    let snapshot = buildGoldenNodeSlide('layers-v1', 1_700_000_000_000).snapshot;
    const slide = snapshot.slides.find(
      (candidate) =>
        snapshot.elements.filter((element) => element.slideId === candidate.id && !element.locked)
          .length >= 3,
    );
    if (!slide) throw new Error('Expected layer fixture slide.');
    const members = slide.elementOrder
      .map((id) => snapshot.elements.find((element) => element.id === id))
      .filter((element): element is SlideElement => Boolean(element && !element.locked))
      .slice(0, 3);
    const [first, second, third] = members;
    if (!first || !second || !third) throw new Error('Expected layer fixture elements.');

    snapshot = apply(
      snapshot,
      {
        kind: 'elements',
        deckId: snapshot.deck.id,
        slideIds: [slide.id],
        elementIds: [first.id],
        operationMode: 'style',
      },
      [
        {
          op: 'set_visibility_v1',
          slideId: slide.id,
          elementId: first.id,
          visible: false,
        },
      ],
    );
    expect(snapshot.elements.find((element) => element.id === first.id)?.visible).toBe(false);

    const groupIds = [first.id, third.id];
    snapshot = apply(
      snapshot,
      {
        kind: 'elements',
        deckId: snapshot.deck.id,
        slideIds: [slide.id],
        elementIds: groupIds,
        operationMode: 'layout',
      },
      [
        {
          op: 'group_elements_v1',
          slideId: slide.id,
          elementIds: groupIds,
          groupId: 'group:layers-v1',
        },
      ],
    );
    expect(
      snapshot.elements.filter((element) => element.groupId === 'group:layers-v1').map((e) => e.id),
    ).toEqual(expect.arrayContaining(groupIds));
    const groupedSlide = snapshot.slides.find((candidate) => candidate.id === slide.id);
    if (!groupedSlide) throw new Error('Grouped slide disappeared.');
    const groupedOrder = groupedSlide.elementOrder;
    expect(Math.abs(groupedOrder.indexOf(first.id) - groupedOrder.indexOf(third.id))).toBe(1);

    snapshot = apply(
      snapshot,
      {
        kind: 'elements',
        deckId: snapshot.deck.id,
        slideIds: [slide.id],
        elementIds: groupIds,
        operationMode: 'layout',
      },
      [
        {
          op: 'ungroup_elements_v1',
          slideId: slide.id,
          elementIds: groupIds,
          groupId: 'group:layers-v1',
        },
      ],
    );
    expect(snapshot.elements.some((element) => element.groupId === 'group:layers-v1')).toBe(false);

    const ungroupedSlide = snapshot.slides.find((candidate) => candidate.id === slide.id);
    if (!ungroupedSlide) throw new Error('Ungrouped slide disappeared.');
    const beforeOrder = ungroupedSlide.elementOrder;
    const previousIndex = beforeOrder.indexOf(second.id);
    const nextIndex = previousIndex === 0 ? 1 : 0;
    snapshot = apply(
      snapshot,
      {
        kind: 'elements',
        deckId: snapshot.deck.id,
        slideIds: [slide.id],
        elementIds: [second.id],
        operationMode: 'layout',
      },
      [
        {
          op: 'reorder_element_v1',
          slideId: slide.id,
          elementId: second.id,
          index: nextIndex,
        },
      ],
    );
    const reorderedSlide = snapshot.slides.find((candidate) => candidate.id === slide.id);
    if (!reorderedSlide) throw new Error('Reordered slide disappeared.');
    expect(reorderedSlide.elementOrder.indexOf(second.id)).toBe(nextIndex);
  });

  it('rejects regrouping locked elements', () => {
    const snapshot = buildGoldenNodeSlide('layers-locks', 1_700_000_000_000).snapshot;
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Expected slide fixture.');
    const members = snapshot.elements.filter((element) => element.slideId === slide.id).slice(0, 2);
    if (!members[0] || !members[1]) throw new Error('Expected lock fixture.');
    members[0].locked = true;
    expect(() =>
      apply(
        snapshot,
        {
          kind: 'elements',
          deckId: snapshot.deck.id,
          slideIds: [slide.id],
          elementIds: members.map((element) => element.id),
          operationMode: 'layout',
        },
        [
          {
            op: 'group_elements_v1',
            slideId: slide.id,
            elementIds: members.map((element) => element.id),
            groupId: 'group:locked',
          },
        ],
      ),
    ).toThrow(/locked/);
  });
});
