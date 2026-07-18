import { describe, expect, it } from 'vitest';
import { forkNodeSlideSnapshot } from './nodeslideDeckFork';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

const NOW = 1_700_000_000_000;
const FORK_ARGS = { deckId: 'deck_fork_test', projectId: 'project_fork_test', now: NOW + 1000 };

describe('forkNodeSlideSnapshot', () => {
  it('produces a fully re-identified deck with fresh history and intact references', () => {
    const source = buildGoldenNodeSlide('fork-tests', NOW).snapshot;
    const fork = forkNodeSlideSnapshot(source, FORK_ARGS);

    expect(fork.deck.id).toBe('deck_fork_test');
    expect(fork.deck.title).toBe(`Copy of ${source.deck.title}`);
    expect(fork.deck.version).toBe(1);
    expect(fork.deck.shareSlug).toBeUndefined();
    expect(fork.deck.activeSignatureProfileId).toBeUndefined();

    // No id may survive from the source (global stable-id indexes would collide).
    const sourceIds = new Set([
      source.deck.id,
      ...source.slides.map((slide) => slide.id),
      ...source.elements.map((element) => element.id),
      ...source.sources.map((record) => record.id),
    ]);
    for (const id of [
      fork.deck.id,
      ...fork.slides.map((slide) => slide.id),
      ...fork.elements.map((element) => element.id),
      ...fork.sources.map((record) => record.id),
    ]) {
      expect(sourceIds.has(id)).toBe(false);
    }

    // Referential integrity: order lists, ownership, and source bindings all resolve.
    const slideIds = new Set(fork.slides.map((slide) => slide.id));
    const elementIds = new Set(fork.elements.map((element) => element.id));
    const forkSourceIds = new Set(fork.sources.map((record) => record.id));
    expect(fork.deck.slideOrder.every((slideId) => slideIds.has(slideId))).toBe(true);
    for (const slide of fork.slides) {
      expect(slide.deckId).toBe('deck_fork_test');
      expect(slide.version).toBe(1);
      expect(slide.elementOrder.every((elementId) => elementIds.has(elementId))).toBe(true);
    }
    for (const element of fork.elements) {
      expect(slideIds.has(element.slideId)).toBe(true);
      expect(element.version).toBe(1);
      expect(element.sourceIds.every((sourceId) => forkSourceIds.has(sourceId))).toBe(true);
      if (element.chart?.sourceId) expect(forkSourceIds.has(element.chart.sourceId)).toBe(true);
      if (element.math?.sourceId) expect(forkSourceIds.has(element.math.sourceId)).toBe(true);
      if (element.image?.sourceId) expect(forkSourceIds.has(element.image.sourceId)).toBe(true);
    }

    // The fork must be as valid as its source.
    const validation = validateNodeSlideSnapshot(fork, FORK_ARGS.now);
    expect(validation.ok).toBe(true);
  });

  it('is deterministic for the same target identity and leaves the source untouched', () => {
    const source = buildGoldenNodeSlide('fork-determinism', NOW).snapshot;
    const before = JSON.stringify(source);
    const first = forkNodeSlideSnapshot(source, FORK_ARGS);
    const second = forkNodeSlideSnapshot(source, FORK_ARGS);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(source)).toBe(before);
  });
});
