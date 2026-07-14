import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import { SlideRenderer } from './SlideRenderer';

describe('NodeSlide connector rendering', () => {
  it('uses the declared stroke for the SVG line without drawing a wrapper border', () => {
    const slide: Slide = {
      id: 'slide-1',
      deckId: 'deck-1',
      title: 'Editable diagram',
      background: '#ffffff',
      elementOrder: ['connector-1'],
      version: 1,
    };
    const connector: SlideElement = {
      id: 'connector-1',
      slideId: slide.id,
      name: 'Diagram connector 1',
      kind: 'connector',
      role: 'diagram_connector',
      bbox: { x: 0.4, y: 0.5, width: 0.2, height: 0.05 },
      rotation: 0,
      style: { stroke: '#123456', strokeWidth: 3 },
      sourceIds: ['source-1'],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
    };

    const html = renderToStaticMarkup(
      <SlideRenderer slide={slide} elements={[connector]} theme={theme()} />,
    );
    const wrapper = html.match(/<div class="ns-slide-element[^>]+>/u)?.[0] ?? '';

    expect(wrapper).toContain('color:#123456');
    expect(wrapper).not.toContain('border-color');
    expect(wrapper).not.toContain('border-style');
    expect(html).toContain('marker-end="url(#arrow-connector-1)"');
  });
});

function theme(): ThemeSpec {
  return {
    id: 'test-theme',
    name: 'Test theme',
    mode: 'light',
    colors: {
      canvas: '#ffffff',
      ink: '#111111',
      muted: '#666666',
      accent: '#b44a2d',
      accentSoft: '#f2ded3',
      insight: '#e5e9d6',
      insightInk: '#34452c',
      trace: '#7566a8',
      border: '#ded7cc',
    },
    typography: { display: 'serif', body: 'sans-serif', data: 'monospace' },
    defaultRadius: 12,
    spacingUnit: 8,
  };
}
