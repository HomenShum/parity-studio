import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
} from '../../../../shared/nodeslide';
import { renderSlideHtml } from './html';
import { buildPptx } from './pptx';

// A real 1x1 PNG: small enough to inline, valid enough for pptxgenjs to embed for real.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), (character) => character.charCodeAt(0));
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
const REMOTE_URL = 'https://cdn.example.com/governed-creativity.png';
const PLACEHOLDER_MARKER = 'Static image unavailable';

function snapshotWithImages(...imageUrls: string[]): DeckSnapshot {
  const deckId = 'deck:remote-image';
  const slideId = 'slide:remote-image';
  const elementIds = imageUrls.map((_, index) => `element:image-${index}`);
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: deckId,
      projectId: 'project:remote-image',
      title: 'Remote image export',
      brief: {
        prompt: 'Export a deck whose imagery lives on a hosted URL.',
        audience: 'Product',
        purpose: 'Prove hosted imagery survives export.',
        successCriteria: ['Hosted image is embedded, not placeholdered'],
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
      version: 1,
      status: 'ready',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_123,
    },
    slides: [
      {
        id: slideId,
        deckId,
        title: 'Hosted imagery',
        notes: '',
        background: '#10131a',
        elementOrder: elementIds,
        version: 1,
      },
    ],
    sources: [],
    elements: imageUrls.map((imageUrl, index) => ({
      id: elementIds[index] as string,
      slideId,
      name: `Hosted image ${index}`,
      kind: 'image',
      role: 'image',
      bbox: { x: 0.08, y: 0.12 + index * 0.02, width: 0.4, height: 0.3 },
      rotation: 0,
      style: { fill: '#3b3222', stroke: '#f6b94a', strokeWidth: 2 },
      imageUrl,
      altText: `Hosted image ${index}`,
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
    })),
  } as DeckSnapshot;
}

function imageResponse(
  bytes: Uint8Array,
  contentType = 'image/png',
  headers: Record<string, string> = {},
): Response {
  return new Response(bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: { 'content-type': contentType, ...headers },
  });
}

async function exportedZip(snapshot: DeckSnapshot) {
  const zip = await JSZip.loadAsync(await buildPptx(snapshot));
  const slideXml = (await zip.file('ppt/slides/slide1.xml')?.async('string')) ?? '';
  const mediaFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith('ppt/media/') && zip.files[name]?.dir === false,
  );
  return { zip, slideXml, mediaFiles };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildPptx hosted image embedding', () => {
  it('embeds a hosted image into the package without FileReader, which Node does not expose', async () => {
    // This is the regression the export path shipped with: hydration keyed on FileReader, so
    // every non-browser export (the proof scripts, this suite) silently produced a placeholder.
    expect(typeof FileReader).toBe('undefined');
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(PNG_BYTES));
    vi.stubGlobal('fetch', fetchMock);

    const { slideXml, mediaFiles } = await exportedZip(snapshotWithImages(REMOTE_URL));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(REMOTE_URL);
    expect(mediaFiles).toHaveLength(1);
    expect(slideXml).toContain('<a:blip');
    expect(slideXml).not.toContain(PLACEHOLDER_MARKER);
  });

  it('leaves an already-embedded data URL untouched and never reaches the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { mediaFiles, slideXml } = await exportedZip(snapshotWithImages(PNG_DATA_URL));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mediaFiles).toHaveLength(1);
    expect(slideXml).not.toContain(PLACEHOLDER_MARKER);
  });

  it('still exports a usable deck when the image host is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const { slideXml, mediaFiles } = await exportedZip(snapshotWithImages(REMOTE_URL));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mediaFiles).toHaveLength(0);
    expect(slideXml).toContain(PLACEHOLDER_MARKER);
  });

  it('degrades to a placeholder when the host answers with an error status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const { slideXml, mediaFiles } = await exportedZip(snapshotWithImages(REMOTE_URL));

    // Asserted so this cannot pass by never attempting the fetch at all.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mediaFiles).toHaveLength(0);
    expect(slideXml).toContain(PLACEHOLDER_MARKER);
  });

  it('refuses a non-image body served from an image URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(imageResponse(PNG_BYTES, 'text/html; charset=utf-8'));
    vi.stubGlobal('fetch', fetchMock);

    const { slideXml, mediaFiles } = await exportedZip(snapshotWithImages(REMOTE_URL));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mediaFiles).toHaveLength(0);
    expect(slideXml).toContain(PLACEHOLDER_MARKER);
  });

  it('rejects an oversized image on its declared length without reading the body', async () => {
    const response = imageResponse(PNG_BYTES, 'image/png', { 'content-length': '900000' });
    const blobSpy = vi.spyOn(response, 'blob');
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    const { slideXml, mediaFiles } = await exportedZip(snapshotWithImages(REMOTE_URL));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(blobSpy).not.toHaveBeenCalled();
    expect(mediaFiles).toHaveLength(0);
    expect(slideXml).toContain(PLACEHOLDER_MARKER);
  });

  it('rejects an oversized image whose host understated its content length', async () => {
    const oversized = new Uint8Array(800_000);
    oversized.set(PNG_BYTES);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(imageResponse(oversized, 'image/png', { 'content-length': '10' }));
    vi.stubGlobal('fetch', fetchMock);

    const { slideXml, mediaFiles } = await exportedZip(snapshotWithImages(REMOTE_URL));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mediaFiles).toHaveLength(0);
    expect(slideXml).toContain(PLACEHOLDER_MARKER);
  });

  it('never fetches a plaintext http URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { slideXml } = await exportedZip(snapshotWithImages('http://cdn.example.com/x.png'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(slideXml).toContain(PLACEHOLDER_MARKER);
  });

  it('hydrates a gallery of hosted images concurrently, fetching each exactly once', async () => {
    const urls = Array.from(
      { length: 12 },
      (_, index) => `https://cdn.example.com/img-${index}.png`,
    );
    const inFlight = { current: 0, peak: 0 };
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight.current += 1;
      inFlight.peak = Math.max(inFlight.peak, inFlight.current);
      await Promise.resolve();
      inFlight.current -= 1;
      return imageResponse(PNG_BYTES);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { slideXml, mediaFiles } = await exportedZip(snapshotWithImages(...urls));

    expect(fetchMock).toHaveBeenCalledTimes(urls.length);
    expect(new Set(fetchMock.mock.calls.map((call) => call[0])).size).toBe(urls.length);
    expect(inFlight.peak).toBeGreaterThan(1);
    expect(mediaFiles).toHaveLength(urls.length);
    expect(slideXml).not.toContain(PLACEHOLDER_MARKER);
  });
});

describe('renderSlideHtml hosted image preview', () => {
  it('emits a hosted https image as a live <image> href, not a placeholder', () => {
    const snapshot = snapshotWithImages(REMOTE_URL);
    const html = renderSlideHtml(snapshot, 'slide:remote-image');

    expect(html).toContain(`href="${REMOTE_URL}"`);
    expect(html).not.toContain('Image unavailable');
  });

  it('still emits an embedded data URL directly', () => {
    const snapshot = snapshotWithImages(PNG_DATA_URL);
    const html = renderSlideHtml(snapshot, 'slide:remote-image');

    expect(html).toContain(PNG_DATA_URL);
    expect(html).not.toContain('Image unavailable');
  });

  it('falls back to the unavailable placeholder for a plaintext http image', () => {
    const snapshot = snapshotWithImages('http://cdn.example.com/x.png');
    const html = renderSlideHtml(snapshot, 'slide:remote-image');

    expect(html).not.toContain('href="http://cdn.example.com/x.png"');
    expect(html).toContain('Hosted image 0');
  });
});
