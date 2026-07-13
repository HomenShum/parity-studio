import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type SlideElement,
} from '../../../../shared/nodeslide';
import { createHostedSlideLangAdapter } from './hosted';
import { createLocalSlideLangAdapter } from './localAdapter';

const HIDDEN_ELEMENT_ID = 'element:hidden-export-sentinel';
const HIDDEN_ELEMENT_NAME = 'Hidden export sentinel label';
const HIDDEN_TEXT = 'HIDDEN_TEXT_MUST_NOT_EXPORT_7F31';
const HIDDEN_SOURCE_ID = 'source:hidden-export-sentinel';

function cleanSnapshot(): DeckSnapshot {
  const deckId = 'deck:golden';
  const slideId = 'slide:overview';
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: deckId,
      projectId: 'project:golden',
      title: 'Native export overview',
      brief: {
        prompt: 'Explain the native export path.',
        audience: 'Product and engineering',
        purpose: 'Show editable output without hidden rasterization.',
        successCriteria: ['Clean validation', 'Editable PowerPoint objects'],
      },
      theme: {
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
      },
      slideOrder: [slideId],
      version: 3,
      status: 'ready',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_123,
    },
    slides: [
      {
        id: slideId,
        deckId,
        title: 'Overview',
        notes: 'Advance after explaining that every object remains editable.',
        background: '#10131a',
        elementOrder: ['element:headline', 'element:body', 'element:accent', 'element:chart'],
        version: 2,
      },
    ],
    elements: [
      {
        id: 'element:headline',
        slideId,
        name: 'Headline',
        kind: 'text',
        role: 'title',
        bbox: { x: 0.06, y: 0.07, width: 0.62, height: 0.14 },
        rotation: 0,
        content: 'Editable native headline',
        style: {
          color: '#f7f4ec',
          fontFamily: 'Aptos Display',
          fontSize: 40,
          fontWeight: 700,
          lineHeight: 1.05,
        },
        sourceIds: ['source:adoption'],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: 'element:body',
        slideId,
        name: 'Summary',
        kind: 'text',
        role: 'body',
        bbox: { x: 0.06, y: 0.23, width: 0.58, height: 0.1 },
        rotation: 0,
        content: 'Semantic HTML and native Office objects share one canonical snapshot.',
        style: {
          color: '#b9c0cb',
          fontFamily: 'Aptos',
          fontSize: 20,
          lineHeight: 1.2,
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: 'element:accent',
        slideId,
        name: 'Accent block',
        kind: 'shape',
        role: 'decoration',
        bbox: { x: 0.72, y: 0.08, width: 0.2, height: 0.22 },
        rotation: 0,
        style: { fill: '#f6b94a', radius: 18 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: 'element:chart',
        slideId,
        name: 'Adoption chart',
        kind: 'chart',
        role: 'data',
        bbox: { x: 0.06, y: 0.4, width: 0.86, height: 0.45 },
        rotation: 0,
        style: {},
        chart: {
          chartType: 'bar',
          labels: ['Alpha', 'Beta', 'GA'],
          series: [{ name: 'Teams', values: [12, 28, 47], color: '#7dd3fc' }],
          unit: 'teams',
          sourceId: 'source:adoption',
        },
        sourceIds: ['source:adoption'],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
    ],
    sources: [
      {
        id: 'source:adoption',
        deckId,
        title: 'Internal adoption snapshot',
        sourceType: 'internal',
        retrievedAt: 1_700_000_000_000,
        citation: 'Internal adoption snapshot, Q4.',
        url: 'https://sources.example.test/adoption',
        license: 'Internal planning data; not independently audited.',
      },
      {
        id: 'source:unused',
        deckId,
        title: 'Unused research note',
        sourceType: 'note',
        retrievedAt: 1_700_000_000_001,
        citation: 'This source is not referenced by the overview slide.',
      },
    ],
  };
}

function addHiddenTextElement(snapshot: DeckSnapshot): SlideElement {
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Missing slide fixture.');
  const body = snapshot.elements.find((element) => element.id === 'element:body');
  if (!body) throw new Error('Missing body fixture.');
  body.visible = true;

  const hidden: SlideElement = {
    id: HIDDEN_ELEMENT_ID,
    slideId: slide.id,
    name: HIDDEN_ELEMENT_NAME,
    kind: 'text',
    role: 'body',
    bbox: { x: 0.06, y: 0.34, width: 0.58, height: 0.08 },
    rotation: 0,
    content: HIDDEN_TEXT,
    style: { color: '#fb7185', fontFamily: 'Aptos', fontSize: 18 },
    sourceIds: [HIDDEN_SOURCE_ID],
    locked: false,
    visible: false,
    exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
    version: 1,
  };
  snapshot.elements.push(hidden);
  slide.elementOrder.splice(1, 0, hidden.id);
  snapshot.sources.push({
    id: HIDDEN_SOURCE_ID,
    deckId: snapshot.deck.id,
    title: HIDDEN_ELEMENT_NAME,
    sourceType: 'note',
    retrievedAt: 1_700_000_000_002,
    citation: HIDDEN_TEXT,
  });
  return hidden;
}

describe('local SlideLangAdapter', () => {
  const adapter = createLocalSlideLangAdapter();

  it('returns a clean, deterministic success contract for a golden-ish snapshot', () => {
    const snapshot = cleanSnapshot();
    const first = adapter.validate(snapshot);
    const second = adapter.check(snapshot);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, publishOk: true, cleanOk: true, issues: [] });
    expect(first.checkedAt).toBe(snapshot.deck.updatedAt);
  });

  it('matches server readability policy for footer and page-number chrome', () => {
    const snapshot = cleanSnapshot();
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Missing slide fixture.');
    snapshot.elements.push(
      {
        id: 'element:footer',
        slideId: slide.id,
        name: 'Deck footer',
        kind: 'text',
        role: 'footer',
        bbox: { x: 0.06, y: 0.93, width: 0.7, height: 0.035 },
        rotation: 0,
        content: 'INTERNAL PREVIEW',
        style: { color: '#b9c0cb', fontFamily: 'Aptos Mono', fontSize: 10 },
        sourceIds: [],
        locked: true,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: 'element:page-number',
        slideId: slide.id,
        name: 'Page number',
        kind: 'text',
        role: 'page_number',
        bbox: { x: 0.88, y: 0.92, width: 0.06, height: 0.05 },
        rotation: 0,
        content: '01',
        style: { color: '#f6b94a', fontFamily: 'Aptos Mono', fontSize: 13 },
        sourceIds: [],
        locked: true,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: 'element:near-footer',
        slideId: slide.id,
        name: 'Closing point',
        kind: 'text',
        role: 'bullet',
        bbox: { x: 0.06, y: 0.88, width: 0.38, height: 0.08 },
        rotation: 0,
        content: 'Hand off editable structure',
        style: { color: '#f7f4ec', fontFamily: 'Aptos', fontSize: 16 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
    );
    slide.elementOrder.push('element:near-footer', 'element:footer', 'element:page-number');

    const validation = adapter.validate(snapshot);
    expect(validation.issues.filter((issue) => issue.code === 'font_size')).toEqual([]);
    expect(validation.issues.filter((issue) => issue.code === 'collision')).toEqual([]);
    expect(validation.publishOk).toBe(true);
  });

  it('blocks publish for important collisions and estimated text overflow', () => {
    const snapshot = cleanSnapshot();
    const body = snapshot.elements.find((element) => element.id === 'element:body');
    if (!body) throw new Error('Missing body fixture.');
    body.bbox = { x: 0.06, y: 0.07, width: 0.28, height: 0.07 };
    body.content =
      'This intentionally overlong copy cannot fit in the tiny box and also overlaps the headline.';
    body.style.fontSize = 30;

    const validation = adapter.validate(snapshot);
    expect(validation.ok).toBe(true);
    expect(validation.publishOk).toBe(false);
    expect(validation.cleanOk).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['collision', 'overflow']),
    );
    expect(adapter.getRepairPlan(validation)).toEqual(adapter.getRepairPlan(validation));
    expect(adapter.getRepairPlan(validation).actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fit_text' })]),
    );
  });

  it('preserves provenance and parallel semantic slide content in HTML exports', () => {
    const snapshot = cleanSnapshot();
    const body = snapshot.elements.find((element) => element.id === 'element:body');
    if (!body) throw new Error('Missing body fixture.');
    body.content =
      'Semantic HTML and native Office objects share one canonical snapshot.\n\u2022 Stable source IDs\n\u2022 Deduplicated citations';

    const html = adapter.renderSlideHtml(snapshot, 'slide:overview');
    expect(html).toContain('data-slide-id="slide:overview"');
    expect(html).toContain('data-source-ids="source:adoption"');
    expect(html).toContain('data-element-id="element:headline"');
    expect(html).toContain('data-element-kind="text"');
    expect(html).toContain('data-slide-semantics');
    expect(html).toContain('Slide 1 of 1: Overview</h2>');
    expect(html).toContain('>Editable native headline</h3>');
    expect(html).toContain(
      '<p>Semantic HTML and native Office objects share one canonical snapshot.</p>',
    );
    expect(html).toContain('<ul><li>Stable source IDs</li><li>Deduplicated citations</li></ul>');
    expect(html).toContain('<table><caption>Adoption chart data</caption>');
    expect(html).toContain('<th scope="col">Teams (teams)</th>');
    expect(html).toContain('<th scope="row">Beta</th><td>28</td>');
    expect(html).toContain('data-source-record data-source-id="source:adoption"');
    expect(html).toContain('<cite data-source-citation>Internal adoption snapshot, Q4.</cite>');
    expect(html).toContain(
      '<dd data-source-disclaimer>Internal planning data; not independently audited.</dd>',
    );
    expect(html).toContain('data-slide-visual aria-hidden="true" focusable="false"');
    expect(html).toContain(
      'data-element-id="element:accent" data-element-kind="shape" aria-hidden="true"',
    );

    const deckHtml = adapter.renderDeckHtml(snapshot);
    expect(deckHtml).toContain('Presenter navigation');
    expect(deckHtml).toContain('data-nodeslide-source-records');
    expect(deckHtml).toContain('data-source-count="1"');
    expect(deckHtml).toContain('"id":"source:adoption"');
    expect(deckHtml).not.toContain('"id":"source:unused"');
  });

  it('renders first-class math and video with honest export capabilities', () => {
    const snapshot = cleanSnapshot();
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Missing slide fixture.');
    const math: SlideElement = {
      id: 'element:math',
      slideId: slide.id,
      name: 'Conversion formula',
      kind: 'math',
      role: 'formula',
      bbox: { x: 0.06, y: 0.87, width: 0.38, height: 0.08 },
      rotation: 0,
      content: '172 ÷ 64 = 2.69',
      style: { color: '#f7f4ec', fontFamily: 'Aptos Mono', fontSize: 20 },
      math: {
        expression: '172 ÷ 64 = 2.69',
        syntax: 'plain',
        displayMode: 'block',
        description: 'Goals per match',
      },
      sourceIds: ['source:adoption'],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
    };
    const video: SlideElement = {
      id: 'element:video',
      slideId: slide.id,
      name: 'Product walkthrough',
      kind: 'video',
      role: 'evidence_video',
      bbox: { x: 0.5, y: 0.87, width: 0.42, height: 0.08 },
      rotation: 0,
      style: {},
      video: {
        url: 'https://example.com/walkthrough.mp4',
        title: 'Product walkthrough',
        captionsUrl: 'https://example.com/walkthrough.vtt',
        captionsLanguage: 'en',
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_static_fallback', 'google_importable'],
      version: 1,
    };
    snapshot.elements.push(math, video);
    slide.elementOrder.push(math.id, video.id);

    const html = adapter.renderSlideHtml(snapshot, slide.id);
    expect(html).toContain('data-element-kind="math"');
    expect(html).toContain('<math aria-label="Goals per match">');
    expect(html).toContain('172 ÷ 64 = 2.69');
    expect(html).toContain('data-element-kind="video"');
    expect(html).toContain('https://example.com/walkthrough.mp4');
    expect(html).toContain('kind="captions"');
    expect(html).toContain('https://example.com/walkthrough.vtt');
    expect(adapter.getElementCapability(math).pptx).toBe('native');
    expect(adapter.getElementCapability(video).pptx).toBe('static_fallback');
  });

  it('exports structured math and an editable replace-image placeholder without rasterizing them', async () => {
    const snapshot = cleanSnapshot();
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Missing slide fixture.');
    const capabilities = ['web_native', 'pptx_editable', 'google_importable'] as const;
    snapshot.elements = [
      {
        id: 'element:formula',
        slideId: slide.id,
        name: 'Goals per match formula',
        kind: 'math',
        role: 'formula',
        bbox: { x: 0.08, y: 0.14, width: 0.84, height: 0.24 },
        rotation: 0,
        content: '172 ÷ 64 = 2.69 goals per match',
        style: {
          fill: '#d9f99d',
          color: '#17210b',
          fontFamily: 'Aptos Mono',
          fontSize: 28,
          fontWeight: 700,
          textAlign: 'center',
          verticalAlign: 'middle',
        },
        math: {
          expression: 'goals / matches',
          display: '172 ÷ 64 = 2.69 goals per match',
          variables: [
            { label: 'goals', value: 172 },
            { label: 'matches', value: 64 },
          ],
          sourceId: 'source:adoption',
        },
        sourceIds: ['source:adoption'],
        locked: false,
        exportCapabilities: [...capabilities],
        version: 1,
      },
      {
        id: 'element:image-placeholder',
        slideId: slide.id,
        name: 'Lusail Stadium image',
        kind: 'image',
        role: 'image',
        bbox: { x: 0.08, y: 0.5, width: 0.84, height: 0.34 },
        rotation: 0,
        style: { fill: '#3b3222', stroke: '#f6b94a', strokeWidth: 2 },
        image: {
          placeholder: true,
          credit: 'Licensed FIFA image and photographer credit required',
          sourceId: 'source:adoption',
        },
        altText: 'Lusail Stadium image placeholder',
        sourceIds: ['source:adoption'],
        locked: false,
        exportCapabilities: [...capabilities],
        version: 1,
      },
    ];
    slide.elementOrder = snapshot.elements.map((element) => element.id);

    const validation = adapter.validate(snapshot);
    expect(validation.issues).toEqual([]);

    const html = adapter.renderSlideHtml(snapshot, slide.id);
    expect(html).toContain('data-element-kind="math"');
    expect(html).toContain('role="math"');
    expect(html).toContain('data-expression="goals / matches"');
    expect(html).toContain('data-image-placeholder>Replace image</p>');
    expect(html).toContain('Licensed FIFA image and photographer credit required');

    const binary = await adapter.buildPptx(snapshot);
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    expect(slideXml).toContain('<a:t>172 ÷ 64 = 2.69 goals per match</a:t>');
    expect(slideXml).toContain('<a:t>Replace image</a:t>');
    expect(slideXml).toContain('<a:t>Licensed FIFA image and photographer credit required</a:t>');
  });

  it('omits hidden text from HTML visual, semantic, accessibility, and provenance output', () => {
    const snapshot = cleanSnapshot();
    const hidden = addHiddenTextElement(snapshot);
    expect(snapshot.elements.find((element) => element.id === 'element:headline')?.visible).toBe(
      undefined,
    );
    expect(snapshot.elements.find((element) => element.id === 'element:chart')?.visible).toBe(
      undefined,
    );
    const slideHtml = adapter.renderSlideHtml(snapshot, 'slide:overview');
    const deckHtml = adapter.renderDeckHtml(snapshot);

    for (const html of [slideHtml, deckHtml]) {
      expect(html).not.toContain(HIDDEN_TEXT);
      expect(html).not.toContain(HIDDEN_ELEMENT_ID);
      expect(html).not.toContain(HIDDEN_ELEMENT_NAME);
      expect(html).not.toContain(HIDDEN_SOURCE_ID);
      expect(html).toContain('Editable native headline');
      expect(html).toContain('source:adoption');
      expect(html).toContain(
        'Semantic HTML and native Office objects share one canonical snapshot.',
      );
    }
    expect(deckHtml).toContain('data-source-count="1"');
    expect(deckHtml).toContain('"id":"source:adoption"');
    expect(deckHtml).not.toContain('"id":"source:unused"');

    const visualMarker = slideHtml.indexOf('data-slide-visual');
    const visualStart = slideHtml.lastIndexOf('<svg', visualMarker);
    const visualEnd = slideHtml.indexOf('</svg>', visualMarker);
    const visualHtml = slideHtml.slice(visualStart, visualEnd);
    let previousIndex = -1;
    for (const elementId of [
      'element:headline',
      'element:body',
      'element:accent',
      'element:chart',
    ]) {
      const elementIndex = visualHtml.indexOf(`data-element-id="${elementId}"`);
      expect(elementIndex).toBeGreaterThan(previousIndex);
      previousIndex = elementIndex;
    }

    expect(snapshot.elements).toContain(hidden);
    expect(hidden.visible).toBe(false);
    expect(snapshot.slides[0]?.elementOrder).toContain(hidden.id);
  });

  it('writes native objects and deduplicated source notes into the PPTX ZIP', async () => {
    const binary = await adapter.buildPptx(cleanSnapshot());
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    const notesXml = await zip.file('ppt/notesSlides/notesSlide1.xml')?.async('string');

    expect(slideXml).toContain('<a:t>Editable native headline</a:t>');
    expect(slideXml).toContain('<p:sp>');
    expect(Object.keys(zip.files).some((path) => /^ppt\/charts\/chart\d+\.xml$/.test(path))).toBe(
      true,
    );
    expect(notesXml).toContain('<a:t>Advance after explaining that every object remains editable.');
    expect(notesXml).toContain('NodeSlide sources');
    expect(notesXml).toContain('Citation: Internal adoption snapshot, Q4.');
    expect(notesXml).toContain('Disclaimer: Internal planning data; not independently audited.');
    expect(notesXml).not.toContain('This source is not referenced by the overview slide.');
    expect(notesXml?.match(/Citation: Internal adoption snapshot, Q4\./g)).toHaveLength(1);
  });

  it('omits hidden text and its provenance from PPTX while preserving visible object order', async () => {
    const snapshot = cleanSnapshot();
    const hidden = addHiddenTextElement(snapshot);
    const binary = await adapter.buildPptx(snapshot);
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    if (!slideXml) throw new Error('Missing exported slide XML.');
    const packageXml = (
      await Promise.all(
        Object.values(zip.files)
          .filter((file) => !file.dir && file.name.endsWith('.xml'))
          .map((file) => file.async('string')),
      )
    ).join('\n');

    expect(packageXml).not.toContain(HIDDEN_TEXT);
    expect(packageXml).not.toContain(HIDDEN_ELEMENT_ID);
    expect(packageXml).not.toContain(HIDDEN_ELEMENT_NAME);
    expect(packageXml).not.toContain(HIDDEN_SOURCE_ID);
    const headlineIndex = slideXml.indexOf('<a:t>Editable native headline</a:t>');
    const bodyIndex = slideXml.indexOf(
      '<a:t>Semantic HTML and native Office objects share one canonical snapshot.</a:t>',
    );
    expect(headlineIndex).toBeGreaterThan(-1);
    expect(bodyIndex).toBeGreaterThan(headlineIndex);

    expect(snapshot.elements).toContain(hidden);
    expect(hidden.visible).toBe(false);
    expect(snapshot.slides[0]?.elementOrder).toContain(hidden.id);
  });
});

describe('hosted SlideLang seam', () => {
  it('uses the documented check route without auth and maps official summary fields', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      return new Response(JSON.stringify({ ok: true, publish_ok: true, clean_ok: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const hosted = createHostedSlideLangAdapter({
      environment: { SLIDELANG_API_BASE_URL: 'https://slides.example.test/' },
      fetch: fetchMock,
    });

    const response = await hosted.check({ project: 'demo', workflow: 'slidemaker', files: [] });
    const call = calls[0];
    expect(call?.url).toBe('https://slides.example.test/api/projects/check');
    expect(new Headers(call?.init?.headers).has('authorization')).toBe(false);
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      project: 'demo',
      workflow: 'slidemaker',
      files: [],
    });
    expect(hosted.mapValidationSummary(response, { deckId: 'demo', deckVersion: 1 })).toMatchObject(
      { ok: true, publishOk: true, cleanOk: false },
    );
    expect(hosted.presenterUrl('demo', 'slidemaker')).toBe(
      'https://slides.example.test/present/demo/slidemaker/',
    );
  });
});
