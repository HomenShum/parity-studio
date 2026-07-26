import { describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type PublishedDeckSnapshot,
  type PublishedNodeSlide,
  type SlideElement,
  type ThemeSpec,
} from '../../../../shared/nodeslide';
import { buildShareProjection, parseShareSlug, publicRenderInput } from './shareProjection';

const SHARE_SLUG = 'share-4f2a91c07b6d48e3a05cf1b28d63e947a1c8';
const ORIGIN = 'https://nodeslide.vercel.app';
const NOTE_SENTINEL = 'SPEAKER_NOTE_MUST_NOT_REACH_THE_PUBLIC_PAGE_A41F';
const INTERNAL_SOURCE_SENTINEL = 'INTERNAL_SOURCE_MUST_NOT_REACH_THE_PUBLIC_PAGE_9C02';
const EMBEDDED_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const THEME: ThemeSpec = {
  id: 'theme:night',
  name: 'Night signal',
  mode: 'dark',
  colors: {
    canvas: '#10131a',
    ink: '#f7f4ec',
    muted: '#b9c0cb',
    accent: '#f6b94a',
    accentSoft: '#3b3222',
    insight: '#d9f99d',
    insightInk: '#17210b',
    trace: '#7dd3fc',
    border: '#3a4351',
  },
  typography: { display: 'Aptos Display', body: 'Aptos', data: 'Aptos Mono' },
  defaultRadius: 16,
  spacingUnit: 8,
};

function textElement(slideId: string, id: string, role: string, content: string): SlideElement {
  return {
    id,
    slideId,
    name: `${role} on ${slideId}`,
    kind: 'text',
    role,
    bbox: { x: 0.06, y: role === 'title' ? 0.08 : 0.3, width: 0.62, height: 0.16 },
    rotation: 0,
    content,
    style: { fontSize: role === 'title' ? 54 : 24, color: '#f7f4ec' },
    sourceIds: [],
    locked: false,
    exportCapabilities: ['pptx', 'html'],
    version: 1,
  };
}

function publishedDeck(
  overrides: {
    title?: string;
    slideCount?: number;
    bodyText?: string;
  } = {},
): PublishedNodeSlide {
  const deckId = 'deck:quarterly-review';
  const slideCount = overrides.slideCount ?? 3;
  const slides = Array.from({ length: slideCount }, (_, index) => ({
    id: `slide:${index + 1}`,
    deckId,
    title: `Slide ${index + 1} — pipeline coverage`,
    background: '#10131a',
    elementOrder: [`element:${index + 1}:title`, `element:${index + 1}:body`],
    version: 2,
  }));
  const elements = slides.flatMap((slide, index) => [
    textElement(slide.id, `element:${index + 1}:title`, 'title', slide.title),
    textElement(
      slide.id,
      `element:${index + 1}:body`,
      'body',
      overrides.bodyText ?? `Section ${index + 1} narrative for the published review.`,
    ),
  ]);
  const snapshot: PublishedDeckSnapshot = {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: deckId,
      title: overrides.title ?? 'Quarterly pipeline review',
      theme: THEME,
      slideOrder: slides.map((slide) => slide.id),
      version: 7,
      status: 'published',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_500_000,
    },
    slides,
    elements,
    sources: [
      {
        id: 'source:public',
        deckId,
        title: 'Published market note',
        url: 'https://example.com/market-note',
        sourceType: 'url',
        retrievedAt: 1_700_000_000_000,
        citation: 'Example, Market note, 2026.',
      },
    ],
  };
  return {
    publication: {
      id: 'publication:1',
      deckId,
      shareSlug: SHARE_SLUG,
      revision: 2,
      deckVersion: 7,
      validationId: 'validation:1',
      status: 'active',
      publishedAt: 1_700_000_600_000,
    },
    snapshot,
  };
}

function bodyText(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('share slug parsing', () => {
  it('reads the slug from the public path and from the rewritten query', () => {
    expect(parseShareSlug(`/s/${SHARE_SLUG}`)).toBe(SHARE_SLUG);
    expect(parseShareSlug(`/s/${SHARE_SLUG}/`)).toBe(SHARE_SLUG);
    expect(parseShareSlug(`/api/share?share=${SHARE_SLUG}`)).toBe(SHARE_SLUG);
    expect(parseShareSlug(`${ORIGIN}/s/${SHARE_SLUG}`)).toBe(SHARE_SLUG);
  });

  it('refuses addresses that are not a share link', () => {
    for (const url of [
      '/',
      '/s/',
      '/s/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/api/share?share=',
      '/api/share?share=Share-UPPERCASE',
      '/api/share?share=<script>alert(1)</script>',
      `/api/share?share=${'a'.repeat(129)}`,
      '/api/share?deck=deck:secret',
    ]) {
      expect(parseShareSlug(url), url).toBeNull();
    }
  });
});

describe('a reviewer opens a link the owner just published', () => {
  it('answers with the deck as readable HTML, not an empty shell', async () => {
    const loadPublishedDeck = vi.fn(async () => publishedDeck());
    const projection = await buildShareProjection({
      url: `/api/share?share=${SHARE_SLUG}`,
      origin: ORIGIN,
      loadPublishedDeck,
    });

    expect(loadPublishedDeck).toHaveBeenCalledWith(SHARE_SLUG);
    expect(projection.status).toBe(200);
    expect(projection.headers['content-type']).toBe('text/html; charset=utf-8');

    const text = bodyText(projection.body);
    expect(text.length).toBeGreaterThan(400);
    expect(text).toContain('Quarterly pipeline review');
    expect(text).toContain('Slide 1 — pipeline coverage');
    expect(text).toContain('Slide 3 — pipeline coverage');
    expect(text).toContain('Section 2 narrative for the published review.');
  });

  it('gives a link preview a title, a description, and a canonical address', async () => {
    const projection = await buildShareProjection({
      url: `/s/${SHARE_SLUG}`,
      origin: ORIGIN,
      loadPublishedDeck: async () => publishedDeck(),
    });

    expect(projection.body).toContain('<title>Quarterly pipeline review — NodeSlide</title>');
    expect(projection.body).toContain(
      '<meta property="og:title" content="Quarterly pipeline review"/>',
    );
    expect(projection.body).toMatch(
      /<meta property="og:description" content="[^"]*pipeline coverage[^"]*"\/>/,
    );
    expect(projection.body).toContain(`<link rel="canonical" href="${ORIGIN}/s/${SHARE_SLUG}"/>`);
    // The interactive presenter is still reachable from the projection.
    expect(projection.body).toContain(`${ORIGIN}/?share=${SHARE_SLUG}&amp;present=1`);
  });

  it('keeps a capability URL out of search indexes while still answering the fetch', async () => {
    const projection = await buildShareProjection({
      url: `/s/${SHARE_SLUG}`,
      origin: ORIGIN,
      loadPublishedDeck: async () => publishedDeck(),
    });

    expect(projection.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(projection.headers['cache-control']).toBe('no-store');
    expect(projection.body).toContain('<meta name="robots" content="noindex, nofollow"/>');
  });
});

describe('the owner revokes the link, or it never existed', () => {
  it('refuses with 404 and never renders deck content', async () => {
    const projection = await buildShareProjection({
      url: `/s/${SHARE_SLUG}`,
      origin: ORIGIN,
      // getPresenterSnapshot returns null for revoked, superseded, and unknown
      // slugs alike. The route does not re-derive that decision.
      loadPublishedDeck: async () => null,
    });

    expect(projection.status).toBe(404);
    expect(projection.headers['cache-control']).toBe('no-store');
    expect(projection.body).toContain('This presentation link is unavailable');
    expect(projection.body).not.toContain('Quarterly pipeline review');
  });

  it('refuses a malformed slug without asking the backend at all', async () => {
    const loadPublishedDeck = vi.fn(async () => publishedDeck());
    const projection = await buildShareProjection({
      url: '/api/share?share=../../convex/nodeslide',
      origin: ORIGIN,
      loadPublishedDeck,
    });

    expect(projection.status).toBe(400);
    expect(loadPublishedDeck).not.toHaveBeenCalled();
    expect(projection.body).not.toContain('Quarterly pipeline review');
  });
});

describe('the projection never widens what a published snapshot exposes', () => {
  it('drops speaker notes and non-URL sources even if a snapshot carries them', async () => {
    const published = publishedDeck();
    // Simulates a regression in the publish-time sanitiser: the reading surface
    // must not be the place where private content first becomes crawlable.
    const leaky = {
      ...published,
      snapshot: {
        ...published.snapshot,
        slides: published.snapshot.slides.map((slide) => ({ ...slide, notes: NOTE_SENTINEL })),
        sources: [
          ...published.snapshot.sources,
          {
            id: 'source:internal',
            deckId: published.snapshot.deck.id,
            title: INTERNAL_SOURCE_SENTINEL,
            sourceType: 'internal',
            retrievedAt: 1_700_000_000_000,
            citation: INTERNAL_SOURCE_SENTINEL,
          },
        ],
      },
    } as PublishedNodeSlide;

    const input = publicRenderInput(leaky);
    expect(input.slides.every((slide) => !('notes' in slide))).toBe(true);
    expect(input.sources).toHaveLength(1);

    const projection = await buildShareProjection({
      url: `/s/${SHARE_SLUG}`,
      origin: ORIGIN,
      loadPublishedDeck: async () => leaky,
    });
    expect(projection.body).not.toContain(NOTE_SENTINEL);
    expect(projection.body).not.toContain(INTERNAL_SOURCE_SENTINEL);
    expect(projection.body).not.toContain('data-presenter-notes');
  });

  it('escapes deck content instead of executing it', async () => {
    const published = publishedDeck({
      title: '<script>alert("deck")</script>',
      bodyText: '</section><img src=x onerror="alert(1)">',
    });
    const projection = await buildShareProjection({
      url: `/s/${SHARE_SLUG}`,
      origin: ORIGIN,
      loadPublishedDeck: async () => published,
    });

    expect(projection.body).not.toContain('<script>alert');
    expect(projection.body).not.toContain('onerror="alert(1)"');
    expect(projection.body).toContain('&lt;script&gt;');
  });

  it('leaves embedded image payloads out of a page a preview fetcher has to download', async () => {
    const published = publishedDeck();
    const imageElement: SlideElement = {
      ...textElement('slide:1', 'element:1:image', 'illustration', ''),
      kind: 'image',
      imageUrl: EMBEDDED_IMAGE,
      altText: 'Pipeline coverage chart',
    };
    const withImage: PublishedNodeSlide = {
      ...published,
      snapshot: {
        ...published.snapshot,
        slides: published.snapshot.slides.map((slide) =>
          slide.id === 'slide:1'
            ? { ...slide, elementOrder: [...slide.elementOrder, 'element:1:image'] }
            : slide,
        ),
        elements: [...published.snapshot.elements, imageElement],
      },
    };

    const projection = await buildShareProjection({
      url: `/s/${SHARE_SLUG}`,
      origin: ORIGIN,
      loadPublishedDeck: async () => withImage,
    });

    expect(projection.status).toBe(200);
    expect(projection.body).not.toContain('data:image/png;base64');
    // The element is still announced, with its alt text, as an unavailable asset.
    expect(projection.body).toContain('Pipeline coverage chart');
  });
});

describe('the projection stays bounded and fails closed', () => {
  it('stops after the projected slide budget and says how many are left', async () => {
    const projection = await buildShareProjection({
      url: `/s/${SHARE_SLUG}`,
      origin: ORIGIN,
      loadPublishedDeck: async () => publishedDeck({ slideCount: 130 }),
    });

    const sections = projection.body.match(/data-slide-id="/g) ?? [];
    expect(sections).toHaveLength(120);
    expect(projection.body).toContain('10 further slides are in the presentation');
  });

  it('refuses with 503 when the deployment has no backend binding', async () => {
    const projection = await buildShareProjection({
      url: `/s/${SHARE_SLUG}`,
      origin: ORIGIN,
      loadPublishedDeck: null,
    });

    expect(projection.status).toBe(503);
    expect(projection.body).toContain('This presentation cannot be read right now');
  });

  it('refuses with 502 when the backend throws, and leaks no failure detail', async () => {
    const projection = await buildShareProjection({
      url: `/s/${SHARE_SLUG}`,
      origin: ORIGIN,
      loadPublishedDeck: async () => {
        throw new Error('convex deployment prod:nodeslide-1234 refused the connection');
      },
    });

    expect(projection.status).toBe(502);
    expect(projection.body).not.toContain('prod:nodeslide-1234');
    expect(projection.body).toContain('This presentation cannot be read right now');
  });
});
