import type { DeckSnapshot, SlideElement } from '../../shared/nodeslide';
import { nodeslideStableId } from './nodeslideIds';

const FORK_TITLE_LIMIT = 160;

/**
 * D11 retention: fork a deck into a brand-new identity. Every id (deck, project,
 * slides, elements, sources, groups) is remapped deterministically from the new
 * deck id, all cross-references (elementOrder, slideId, sourceIds, chart/math/
 * image sourceId, groupId) follow the same maps, and history starts fresh:
 * version clocks reset to 1, share slug and signature-profile bindings are
 * dropped (they reference rows owned by the source deck).
 */
export function forkNodeSlideSnapshot(
  source: DeckSnapshot,
  args: { deckId: string; projectId: string; now: number },
): DeckSnapshot {
  const mapSlideId = (slideId: string) => nodeslideStableId('slide_fork', args.deckId, slideId);
  const mapElementId = (elementId: string) =>
    nodeslideStableId('element_fork', args.deckId, elementId);
  const mapSourceId = (sourceId: string) => nodeslideStableId('source_fork', args.deckId, sourceId);
  const mapGroupId = (groupId: string) => nodeslideStableId('group_fork', args.deckId, groupId);

  const {
    shareSlug: _shareSlug,
    activeSignatureProfileId: _profileId,
    activeSignatureProfileDigest: _profileDigest,
    ...deckRest
  } = source.deck;

  return {
    deck: {
      ...structuredClone(deckRest),
      id: args.deckId,
      projectId: args.projectId,
      title: `Copy of ${source.deck.title}`.slice(0, FORK_TITLE_LIMIT),
      slideOrder: source.deck.slideOrder.map(mapSlideId),
      version: 1,
      status: 'ready',
      createdAt: args.now,
      updatedAt: args.now,
    },
    slides: source.slides.map((slide) => ({
      ...structuredClone(slide),
      id: mapSlideId(slide.id),
      deckId: args.deckId,
      elementOrder: slide.elementOrder.map(mapElementId),
      version: 1,
    })),
    elements: source.elements.map((element) =>
      forkElement(element, args.deckId, {
        mapElementId,
        mapSlideId,
        mapSourceId,
        mapGroupId,
      }),
    ),
    sources: source.sources.map((record) => ({
      ...structuredClone(record),
      id: mapSourceId(record.id),
      deckId: args.deckId,
    })),
  };
}

function forkElement(
  element: SlideElement,
  _deckId: string,
  maps: {
    mapElementId: (id: string) => string;
    mapSlideId: (id: string) => string;
    mapSourceId: (id: string) => string;
    mapGroupId: (id: string) => string;
  },
): SlideElement {
  const cloned = structuredClone(element);
  return {
    ...cloned,
    id: maps.mapElementId(element.id),
    slideId: maps.mapSlideId(element.slideId),
    sourceIds: element.sourceIds.map(maps.mapSourceId),
    ...(cloned.groupId !== undefined ? { groupId: maps.mapGroupId(cloned.groupId) } : {}),
    ...(cloned.chart
      ? {
          chart: {
            ...cloned.chart,
            ...(cloned.chart.sourceId !== undefined
              ? { sourceId: maps.mapSourceId(cloned.chart.sourceId) }
              : {}),
          },
        }
      : {}),
    ...(cloned.math
      ? {
          math: {
            ...cloned.math,
            ...(cloned.math.sourceId !== undefined
              ? { sourceId: maps.mapSourceId(cloned.math.sourceId) }
              : {}),
          },
        }
      : {}),
    ...(cloned.image
      ? {
          image: {
            ...cloned.image,
            ...(cloned.image.sourceId !== undefined
              ? { sourceId: maps.mapSourceId(cloned.image.sourceId) }
              : {}),
          },
        }
      : {}),
    version: 1,
  };
}
