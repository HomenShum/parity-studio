import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DeckSnapshot } from '../../shared/nodeslide';
import type { SlideVariation } from '../../shared/nodeslideVariation';
import { AiInspector } from '../../src/domains/nodeslide/inspector/AiInspector';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import { buildSlideVariations } from './nodeslideVariationHarness';

describe('NodeSlide variation inspector states', () => {
  it('renders honest fallback evidence and an explicit return-to-original control', () => {
    const { snapshot, variations } = fixture();
    const first = variations[0];
    if (!first) throw new Error('Missing variation fixture.');
    const markup = renderInspector(snapshot, variations, {
      previewedVariationId: first.id,
    });

    expect(markup).toContain('Generate 3 directions');
    expect(markup).toContain('Deterministic fallback');
    expect(markup).toContain('Return to original');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('Validation clean');
    expect(markup).toContain('Judge #1');
    expect(markup).toContain('Why the judge ranked this #1');
    expect(markup).toContain('Validation ');
  });

  it('labels legacy saved directions honestly when no judge receipt exists', () => {
    const { snapshot, variations } = fixture();
    const legacy = variations.map((variation) => {
      const { judge, ...copy } = structuredClone(variation);
      if (!judge) throw new Error('Fixture should include a judge receipt.');
      return copy;
    });

    expect(renderInspector(snapshot, legacy)).toContain('Legacy direction · not ranked');
  });

  it('renders loading, error, stale, and all-rejected states accessibly', () => {
    const { snapshot, variations } = fixture();
    const rejected = variations.map((variation) => ({
      ...variation,
      status: 'rejected' as const,
      decidedAt: 2_000,
    }));
    const allRejectedMarkup = renderInspector(snapshot, rejected);
    expect(allRejectedMarkup).toContain('All three directions were rejected');
    expect(allRejectedMarkup).toContain('The original slide remains unchanged');

    const stale: SlideVariation[] = variations.map((variation, index) =>
      index === 0 ? { ...variation, status: 'stale', decidedAt: 2_000 } : variation,
    );
    const staleMarkup = renderInspector(snapshot, stale, {
      previewedVariationId: stale[0]?.id ?? null,
    });
    expect(staleMarkup).toContain('Stale direction');
    expect(staleMarkup).not.toContain('Previewing <strong>');
    expect(staleMarkup).not.toContain('Return to original');

    const loadingAndError = renderInspector(snapshot, [], {
      variationBusy: true,
      variationGenerating: true,
      variationError: 'Typed generation failure',
    });
    expect(loadingAndError).toContain('aria-busy="true"');
    expect(loadingAndError).toContain('Generating, materializing, and validating');
    expect(loadingAndError).toContain('role="alert"');
    expect(loadingAndError).toContain('Typed generation failure');
  });
});

function fixture(): { snapshot: DeckSnapshot; variations: SlideVariation[] } {
  const full = buildGoldenNodeSlide('variation-inspector-test', 1_000).snapshot;
  const slide = full.slides.find((candidate) =>
    full.elements.some((element) => element.slideId === candidate.id && !element.locked),
  );
  if (!slide) throw new Error('Golden fixture needs an unlocked slide.');
  const elements = full.elements.filter((element) => element.slideId === slide.id);
  const sourceIds = new Set(
    elements.flatMap((element) => [
      ...element.sourceIds,
      ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ]),
  );
  const snapshot: DeckSnapshot = {
    deck: { ...full.deck, slideOrder: [slide.id] },
    slides: [slide],
    elements,
    sources: full.sources.filter((source) => sourceIds.has(source.id)),
  };
  return {
    snapshot,
    variations: buildSlideVariations({
      snapshot,
      slideId: slide.id,
      batchId: 'batch-inspector',
      createdAt: 1_000,
      provider: { ok: false, reason: 'provider_unavailable' },
    }).variations,
  };
}

function renderInspector(
  snapshot: DeckSnapshot,
  variations: SlideVariation[],
  overrides: Partial<{
    variationBusy: boolean;
    variationGenerating: boolean;
    variationError: string | null;
    previewedVariationId: string | null;
  }> = {},
) {
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Missing slide fixture.');
  return renderToStaticMarkup(
    <AiInspector
      deck={snapshot.deck}
      slide={slide}
      selectedElements={[]}
      patches={[]}
      traces={[]}
      variations={variations}
      variationsLoading={false}
      isSubmitting={false}
      variationBusy={overrides.variationBusy ?? false}
      variationGenerating={overrides.variationGenerating ?? false}
      variationError={overrides.variationError ?? null}
      previewedVariationId={overrides.previewedVariationId ?? null}
      onPropose={() => undefined}
      onAccept={() => undefined}
      onReject={() => undefined}
      onGenerateVariations={() => undefined}
      onPreviewVariation={() => undefined}
      onAcceptVariation={() => undefined}
      onRejectVariation={() => undefined}
    />,
  );
}
