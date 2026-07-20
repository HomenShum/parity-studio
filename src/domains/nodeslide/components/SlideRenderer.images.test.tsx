// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import { SlideRenderer } from './SlideRenderer';

const theme: ThemeSpec = {
  id: 'theme-image-test',
  name: 'Image test',
  mode: 'light',
  colors: {
    canvas: '#ffffff',
    ink: '#111111',
    muted: '#666666',
    accent: '#3355ff',
    accentSoft: '#dde3ff',
    insight: '#fff3d6',
    insightInk: '#7a5200',
    trace: '#f0f0f0',
    border: '#e0e0e0',
  },
  typography: { display: 'Georgia', body: 'Helvetica', data: 'monospace' },
  defaultRadius: 8,
  spacingUnit: 8,
};

const slide: Slide = {
  id: 'slide-1',
  deckId: 'deck-1',
  title: 'Image framing',
  background: '#ffffff',
  elementOrder: ['image-1'],
  version: 1,
};

afterEach(cleanup);

describe('SlideRenderer image framing', () => {
  it('maps fit and continuous focal point to the browser image primitive', () => {
    const element: SlideElement = {
      id: 'image-1',
      slideId: 'slide-1',
      name: 'Harbor',
      kind: 'image',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
      rotation: 0,
      style: {},
      imageUrl: 'data:image/webp;base64,UklGRg==',
      altText: 'A calm harbor',
      image: { placeholder: false, fit: 'contain', focalPoint: { x: 0.2, y: 0.8 } },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_static_fallback'],
      version: 1,
    };

    const { container } = render(
      <SlideRenderer elements={[element]} slide={slide} theme={theme} />,
    );
    const image = container.querySelector('img');
    expect(image?.style.objectFit).toBe('contain');
    expect(image?.style.objectPosition).toBe('20% 80%');
    expect(image?.getAttribute('alt')).toBe('A calm harbor');
  });
});
