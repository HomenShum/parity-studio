import { describe, expect, it, vi } from 'vitest';
import type { DeckComment, DeckPatch } from '../../shared/nodeslide';
import { authorizeBeforeConsumingQuota, nodeSlideActorQuotaKey } from './nodeslideAuthority';
import { validateNodeSlidePatch } from './nodeslidePatches';
import { buildGoldenNodeSlide } from './nodeslideSeed';

describe('NodeSlide quota authority ordering', () => {
  it('never consumes quota when owner authorization fails', async () => {
    const consume = vi.fn(async () => undefined);
    await expect(
      authorizeBeforeConsumingQuota({
        authorize: async () => {
          throw new Error('owner denied');
        },
        consume,
      }),
    ).rejects.toThrow('owner denied');
    expect(consume).not.toHaveBeenCalled();
  });

  it('partitions actors with the full SHA-256 digest', () => {
    const key = nodeSlideActorQuotaKey('edit', 'owner-capability');
    expect(key).toMatch(/^edit:sha256:[0-9a-f]{64}$/);
  });

  it('rejects comment-scoped writes that escape the authoritative anchor', () => {
    const snapshot = buildGoldenNodeSlide('comment-authority', 1_000).snapshot;
    const anchorSlide = snapshot.slides[0];
    const otherSlide = snapshot.slides[1];
    if (!anchorSlide || !otherSlide) throw new Error('Fixture needs two slides.');
    const otherElement = snapshot.elements.find(
      (element) => element.slideId === otherSlide.id && element.kind === 'text' && !element.locked,
    );
    if (!otherElement) throw new Error('Fixture needs an editable element on another slide.');
    const comment: DeckComment = {
      id: 'comment-authority-scope',
      deckId: snapshot.deck.id,
      anchor: { type: 'slide', deckId: snapshot.deck.id, slideId: anchorSlide.id },
      authorId: 'reviewer',
      authorName: 'Reviewer',
      text: 'Review this slide.',
      status: 'open',
      createdAt: 1_000,
      updatedAt: 1_000,
    };
    const patch: Pick<
      DeckPatch,
      | 'deckId'
      | 'baseDeckVersion'
      | 'baseSlideVersions'
      | 'baseElementVersions'
      | 'scope'
      | 'operations'
    > = {
      deckId: snapshot.deck.id,
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: { [otherSlide.id]: otherSlide.version },
      baseElementVersions: { [otherElement.id]: otherElement.version },
      scope: {
        kind: 'comment',
        deckId: snapshot.deck.id,
        slideIds: [otherSlide.id],
        elementIds: [otherElement.id],
        commentId: comment.id,
        operationMode: 'copy',
      },
      operations: [
        {
          op: 'replace_text',
          slideId: otherSlide.id,
          elementId: otherElement.id,
          text: 'Escaped anchor',
        },
      ],
    };

    expect(validateNodeSlidePatch(snapshot, patch, comment)).toEqual(
      expect.arrayContaining([
        `Comment ${comment.id} scope targets slide ${otherSlide.id} outside its anchor.`,
        `Comment ${comment.id} scope targets element ${otherElement.id} outside its anchor.`,
      ]),
    );
  });

  it('rejects whole-slide mutations under comment-scoped element authority', () => {
    const snapshot = buildGoldenNodeSlide('comment-slide-escape', 2_000).snapshot;
    const slide = snapshot.slides[0];
    const element = snapshot.elements.find(
      (candidate) => candidate.slideId === slide?.id && !candidate.locked,
    );
    if (!slide || !element) throw new Error('Fixture needs an editable element.');
    const comment: DeckComment = {
      id: 'comment-element-anchor',
      deckId: snapshot.deck.id,
      anchor: {
        type: 'element',
        deckId: snapshot.deck.id,
        slideId: slide.id,
        elementId: element.id,
      },
      authorId: 'reviewer',
      authorName: 'Reviewer',
      text: 'Review this element only.',
      status: 'open',
      createdAt: 2_000,
      updatedAt: 2_000,
    };
    const patch: Pick<
      DeckPatch,
      | 'deckId'
      | 'baseDeckVersion'
      | 'baseSlideVersions'
      | 'baseElementVersions'
      | 'scope'
      | 'operations'
    > = {
      deckId: snapshot.deck.id,
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: { [slide.id]: slide.version },
      baseElementVersions: { [element.id]: element.version },
      scope: {
        kind: 'comment',
        deckId: snapshot.deck.id,
        slideIds: [slide.id],
        elementIds: [element.id],
        commentId: comment.id,
        operationMode: 'unrestricted',
      },
      operations: [{ op: 'update_slide', slideId: slide.id, properties: { title: 'Escaped' } }],
    };

    expect(validateNodeSlidePatch(snapshot, patch, comment)).toContain(
      'Operation update_slide targets a whole slide outside element-scoped authority.',
    );
  });
});
