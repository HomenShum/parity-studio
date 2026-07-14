import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { EditorCanvasModes } from './EditorCanvasModes';

describe('EditorCanvasModes candidate scope', () => {
  it('shows the exact bounded slide count in Compare', () => {
    const snapshot = buildGoldenNodeSlide('compare-multi-slide-scope', 1_000).snapshot;
    const activeSlide = snapshot.slides[0];
    if (!activeSlide) throw new Error('Fixture requires a slide.');
    const html = renderToStaticMarkup(
      <EditorCanvasModes
        mode="compare"
        onModeChange={() => undefined}
        compareMode="side-by-side"
        onCompareModeChange={() => undefined}
        slides={snapshot.slides}
        elements={snapshot.elements}
        theme={snapshot.deck.theme}
        activeSlideId={activeSlide.id}
        editCanvas={<div>Editor</div>}
        candidateSlide={activeSlide}
        candidateScopeLabel="2 slides"
      />,
    );

    expect(html).toContain('data-testid="compare-scope-label"');
    expect(html).toContain('2 slides');
  });
});
