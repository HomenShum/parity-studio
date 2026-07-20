import type PptxGenJS from 'pptxgenjs';
import {
  type DeckSnapshot,
  SLIDE_HEIGHT_IN,
  SLIDE_WIDTH_IN,
  type Slide,
  type SlideElement,
} from '../../../../shared/nodeslide';
import { type SlideSourceReference, slideSourceReferences } from './provenance';
import type { PptxBinary } from './types';
import {
  clamp,
  colorToPptxHex,
  isEmbeddedImageData,
  normalizeBoundingBox,
  orderedExportElements,
  orderedSlides,
} from './utils';

type PptxSlide = ReturnType<PptxGenJS['addSlide']>;

export const NODESLIDE_PPTX_SLIDE_ID_PREFIX = 'nodeslide-slide-id:';

interface PptxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function uint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function positiveDimensions(width: number, height: number): ImageDimensions | null {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = uint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      return positiveDimensions(
        uint16BigEndian(bytes, offset + 5),
        uint16BigEndian(bytes, offset + 3),
      );
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = ascii(bytes, offset, 4);
    const length = uint32LittleEndian(bytes, offset + 4);
    const data = offset + 8;
    if (data + length > bytes.length) return null;
    if (chunk === 'VP8X' && length >= 10) {
      return positiveDimensions(
        uint24LittleEndian(bytes, data + 4) + 1,
        uint24LittleEndian(bytes, data + 7) + 1,
      );
    }
    if (chunk === 'VP8 ' && length >= 10 && ascii(bytes, data + 3, 3) === '\u009d\u0001\u002a') {
      return positiveDimensions(
        uint16LittleEndian(bytes, data + 6) & 0x3fff,
        uint16LittleEndian(bytes, data + 8) & 0x3fff,
      );
    }
    if (chunk === 'VP8L' && length >= 5 && bytes[data] === 0x2f) {
      const b1 = bytes[data + 1] ?? 0;
      const b2 = bytes[data + 2] ?? 0;
      const b3 = bytes[data + 3] ?? 0;
      const b4 = bytes[data + 4] ?? 0;
      return positiveDimensions(
        1 + (((b2 & 0x3f) << 8) | b1),
        1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      );
    }
    offset = data + length + (length % 2);
  }
  return null;
}

export function embeddedImageDimensions(dataUrl: string): ImageDimensions | null {
  const encoded = /^[^,]+;base64,([A-Za-z0-9+/=\s]+)$/u.exec(dataUrl.trim())?.[1];
  if (!encoded) return null;
  try {
    const binary = atob(encoded.replace(/\s+/gu, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (
      bytes.length >= 24 &&
      bytes[0] === 0x89 &&
      ascii(bytes, 1, 3) === 'PNG' &&
      ascii(bytes, 12, 4) === 'IHDR'
    ) {
      return positiveDimensions(uint32BigEndian(bytes, 16), uint32BigEndian(bytes, 20));
    }
    if (
      bytes.length >= 10 &&
      (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')
    ) {
      return positiveDimensions(uint16LittleEndian(bytes, 6), uint16LittleEndian(bytes, 8));
    }
    return jpegDimensions(bytes) ?? webpDimensions(bytes);
  } catch {
    return null;
  }
}

function imageSizing(
  element: SlideElement,
  box: PptxBox,
): Pick<PptxBox, 'w' | 'h'> & {
  sizing?: {
    type: 'contain' | 'crop';
    x?: number;
    y?: number;
    w: number;
    h: number;
  };
} {
  const dimensions = embeddedImageDimensions(element.imageUrl ?? '');
  if (!dimensions) return { w: box.w, h: box.h };
  const sourceAspect = dimensions.width / dimensions.height;
  const frameAspect = box.w / box.h;
  if (element.image?.fit === 'contain') {
    return {
      w: sourceAspect,
      h: 1,
      sizing: { type: 'contain', w: box.w, h: box.h },
    };
  }

  const focalPoint = element.image?.focalPoint ?? { x: 0.5, y: 0.5 };
  const cropWidth = sourceAspect > frameAspect ? frameAspect / sourceAspect : 1;
  const cropHeight = sourceAspect < frameAspect ? sourceAspect / frameAspect : 1;
  const left = clamp(focalPoint.x - cropWidth / 2, 0, 1 - cropWidth);
  const top = clamp(focalPoint.y - cropHeight / 2, 0, 1 - cropHeight);
  const virtualWidth = box.w / cropWidth;
  const virtualHeight = box.h / cropHeight;
  return {
    w: virtualWidth,
    h: virtualHeight,
    sizing: {
      type: 'crop',
      x: left * virtualWidth,
      y: top * virtualHeight,
      w: box.w,
      h: box.h,
    },
  };
}

function boxFor(element: SlideElement): PptxBox {
  const bbox = normalizeBoundingBox(element.bbox);
  return {
    x: bbox.x * SLIDE_WIDTH_IN,
    y: bbox.y * SLIDE_HEIGHT_IN,
    w: bbox.width * SLIDE_WIDTH_IN,
    h: bbox.height * SLIDE_HEIGHT_IN,
  };
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function transparency(element: SlideElement): number {
  return Math.round((1 - clamp(finite(element.style.opacity, 1), 0, 1)) * 100);
}

function safeFontFamily(value: string): string {
  const cleaned = value.replace(/[;'"{}<>]/g, '').trim() || 'Aptos';
  // PowerPoint can mis-measure an unavailable variable font during normAutofit,
  // including duplicating the word at a line-wrap boundary. Keep the web face
  // intact in the snapshot while using a portable serif fallback in PPTX.
  if (/^Fraunces(?: Variable)?$/i.test(cleaned)) return 'Georgia';
  return cleaned;
}

function sourceNoteLines(reference: SlideSourceReference): string[] {
  const source = reference.source;
  if (!source) {
    return [
      `[${reference.id}] Source record unavailable.`,
      'Disclaimer: Verify this source before presenting or redistributing the slide.',
    ];
  }
  const lines = [`[${source.id}] ${source.title}`, `Citation: ${source.citation}`];
  if (source.url?.trim()) lines.push(`URL: ${source.url.trim()}`);
  lines.push(
    `Disclaimer: ${source.license?.trim() || 'No license or usage terms were provided in the source record.'}`,
  );
  return lines;
}

function speakerNotesForSlide(snapshot: DeckSnapshot, slide: Slide): string | undefined {
  const existingNotes = slide.notes ?? '';
  const references = slideSourceReferences(snapshot, slide);
  if (references.length === 0) return existingNotes.trim() ? existingNotes : undefined;

  const sourceBlock = [
    'NodeSlide sources',
    ...references.flatMap((reference, index) => [
      ...(index > 0 ? [''] : []),
      ...sourceNoteLines(reference),
    ]),
  ].join('\n');
  if (!existingNotes.trim()) return sourceBlock;
  return `${existingNotes}${existingNotes.endsWith('\n') ? '\n' : '\n\n'}${sourceBlock}`;
}

function addNativeText(
  pptxSlide: PptxSlide,
  snapshot: DeckSnapshot,
  element: SlideElement,
  box: PptxBox,
  content = element.content ?? '',
  objectName = element.id,
): void {
  const style = element.style;
  const fontFamily =
    style.fontFamily ??
    (/(?:title|headline|display)/i.test(element.role ?? '')
      ? snapshot.deck.theme.typography.display
      : snapshot.deck.theme.typography.body);
  pptxSlide.addText(content, {
    ...box,
    objectName,
    isTextBox: true,
    fontFace: safeFontFamily(fontFamily),
    fontSize: clamp(finite(style.fontSize, 24), 1, 240),
    color: colorToPptxHex(style.color, snapshot.deck.theme.colors.ink),
    bold: finite(style.fontWeight, 400) >= 600,
    align: style.textAlign ?? 'left',
    valign: style.verticalAlign ?? 'top',
    margin: clamp(finite(style.padding, 0), 0, 22),
    breakLine: false,
    fit: 'shrink',
    wrap: true,
    lineSpacingMultiple: clamp(finite(style.lineHeight, 1.2), 0.8, 3),
    charSpacing: clamp(finite(style.letterSpacing, 0), -10, 40),
    rotate: clamp(finite(element.rotation, 0), -360, 360),
    transparency: transparency(element),
  });
}

function addNativeShape(
  pptx: PptxGenJS,
  pptxSlide: PptxSlide,
  snapshot: DeckSnapshot,
  element: SlideElement,
  box: PptxBox,
): void {
  const hasFill = Boolean(element.style.fill);
  const hasStroke = Boolean(element.style.stroke || element.style.strokeWidth);
  const radius = finite(element.style.radius, snapshot.deck.theme.defaultRadius);
  pptxSlide.addShape(radius > 0 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    ...box,
    objectName: element.id,
    fill: hasFill
      ? {
          color: colorToPptxHex(element.style.fill, snapshot.deck.theme.colors.canvas),
          transparency: transparency(element),
        }
      : { color: 'FFFFFF', transparency: 100 },
    line: hasStroke
      ? {
          color: colorToPptxHex(element.style.stroke, snapshot.deck.theme.colors.border),
          width: clamp(finite(element.style.strokeWidth, 1), 0.1, 40),
          transparency: transparency(element),
        }
      : { color: 'FFFFFF', transparency: 100 },
    rotate: clamp(finite(element.rotation, 0), -360, 360),
  });
  if (element.content?.trim()) {
    addNativeText(pptxSlide, snapshot, element, box, element.content, `${element.id}:text`);
  }
}

function addNativeConnector(
  pptx: PptxGenJS,
  pptxSlide: PptxSlide,
  snapshot: DeckSnapshot,
  element: SlideElement,
  box: PptxBox,
): void {
  pptxSlide.addShape(pptx.ShapeType.line, {
    ...box,
    h: 0,
    objectName: element.id,
    line: {
      color: colorToPptxHex(element.style.stroke, snapshot.deck.theme.colors.trace),
      width: clamp(finite(element.style.strokeWidth, 2), 0.5, 40),
      transparency: transparency(element),
      endArrowType: 'triangle',
    },
  });
}

function addEditablePlaceholder(
  pptx: PptxGenJS,
  pptxSlide: PptxSlide,
  snapshot: DeckSnapshot,
  element: SlideElement,
  box: PptxBox,
  label: string,
): void {
  pptxSlide.addShape(pptx.ShapeType.roundRect, {
    ...box,
    objectName: `${element.id}:fallback-shape`,
    fill: { color: colorToPptxHex(element.style.fill, snapshot.deck.theme.colors.accentSoft) },
    line: {
      color: colorToPptxHex(element.style.stroke, snapshot.deck.theme.colors.border),
      width: 1.5,
      dashType: 'dash',
    },
  });
  pptxSlide.addText(label, {
    ...box,
    objectName: `${element.id}:fallback-label`,
    fontFace: safeFontFamily(snapshot.deck.theme.typography.body),
    fontSize: 14,
    color: colorToPptxHex(snapshot.deck.theme.colors.muted, '#777777'),
    align: 'center',
    valign: 'middle',
    margin: 8,
    fit: 'shrink',
  });
}

function addStaticImage(
  pptx: PptxGenJS,
  pptxSlide: PptxSlide,
  snapshot: DeckSnapshot,
  element: SlideElement,
  box: PptxBox,
): void {
  if (!isEmbeddedImageData(element.imageUrl)) {
    addEditablePlaceholder(
      pptx,
      pptxSlide,
      snapshot,
      element,
      box,
      element.image?.placeholder
        ? `${element.altText?.trim() || element.name}\nReplace image\n${element.image.credit ?? 'Credit required'}`
        : `${element.altText?.trim() || element.name}\nStatic image unavailable`,
    );
    return;
  }
  const framing = imageSizing(element, box);
  pptxSlide.addImage({
    ...box,
    w: framing.w,
    h: framing.h,
    data: element.imageUrl.trim(),
    ...(framing.sizing ? { sizing: framing.sizing } : {}),
    objectName: `${element.id} [static image fallback]`,
    altText: element.altText ?? `${element.name}; static image fallback`,
    rotate: clamp(finite(element.rotation, 0), -360, 360),
    transparency: transparency(element),
  });
}

function addNativeChart(
  pptx: PptxGenJS,
  pptxSlide: PptxSlide,
  snapshot: DeckSnapshot,
  element: SlideElement,
  box: PptxBox,
): void {
  const chart = element.chart;
  if (!chart || chart.series.length === 0) {
    addEditablePlaceholder(
      pptx,
      pptxSlide,
      snapshot,
      element,
      box,
      `${element.name}\nChart data unavailable`,
    );
    return;
  }

  const chartType =
    chart.chartType === 'donut'
      ? pptx.ChartType.doughnut
      : chart.chartType === 'area'
        ? pptx.ChartType.area
        : chart.chartType === 'line'
          ? pptx.ChartType.line
          : pptx.ChartType.bar;
  const data = chart.series.map((series) => ({
    name: series.name,
    labels: chart.labels,
    values: series.values,
  }));
  const chartColors = chart.series.map((series, index) =>
    colorToPptxHex(
      series.color,
      index === 0 ? snapshot.deck.theme.colors.accent : snapshot.deck.theme.colors.trace,
    ),
  );
  pptxSlide.addChart(chartType, data, {
    ...box,
    objectName: element.id,
    showTitle: false,
    showLegend: chart.series.length > 1,
    showValue: false,
    showPercent: chart.chartType === 'donut',
    showLabel: chart.chartType === 'donut',
    chartColors,
    chartArea: {
      fill: {
        color: colorToPptxHex(element.style.fill, snapshot.deck.theme.colors.canvas),
        transparency: 100,
      },
    },
    catAxisLabelColor: colorToPptxHex(snapshot.deck.theme.colors.muted, '#777777'),
    catAxisLabelFontFace: safeFontFamily(snapshot.deck.theme.typography.data),
    catAxisLabelFontSize: 10,
    valAxisLabelColor: colorToPptxHex(snapshot.deck.theme.colors.muted, '#777777'),
    valAxisLabelFontFace: safeFontFamily(snapshot.deck.theme.typography.data),
    valAxisLabelFontSize: 10,
    ...(chart.chartType === 'donut' ? { holeSize: 58 } : {}),
  });
}

function addNativeMath(
  pptxSlide: PptxSlide,
  snapshot: DeckSnapshot,
  element: SlideElement,
  box: PptxBox,
): void {
  const expression = element.math?.display ?? element.math?.expression ?? element.content ?? '';
  addNativeText(pptxSlide, snapshot, element, box, expression, element.id);
}

function addVideoFallback(
  pptx: PptxGenJS,
  pptxSlide: PptxSlide,
  snapshot: DeckSnapshot,
  element: SlideElement,
  box: PptxBox,
): void {
  const video = element.video;
  const title = video?.title?.trim() || element.altText?.trim() || element.name;
  const source = video?.url.trim() || 'Video URL unavailable';
  addEditablePlaceholder(
    pptx,
    pptxSlide,
    snapshot,
    element,
    box,
    `${title}\nLinked web video · ${source}`,
  );
}

function addElement(
  pptx: PptxGenJS,
  pptxSlide: PptxSlide,
  snapshot: DeckSnapshot,
  element: SlideElement,
): void {
  const box = boxFor(element);
  if (element.kind === 'text') addNativeText(pptxSlide, snapshot, element, box);
  else if (element.kind === 'shape') addNativeShape(pptx, pptxSlide, snapshot, element, box);
  else if (element.kind === 'connector') {
    addNativeConnector(pptx, pptxSlide, snapshot, element, box);
  } else if (element.kind === 'chart') {
    addNativeChart(pptx, pptxSlide, snapshot, element, box);
  } else if (element.kind === 'math') {
    addNativeMath(pptxSlide, snapshot, element, box);
  } else if (element.kind === 'video') {
    addVideoFallback(pptx, pptxSlide, snapshot, element, box);
  } else {
    addStaticImage(pptx, pptxSlide, snapshot, element, box);
  }
}

function normalizeOutput(
  output: string | ArrayBuffer | Blob | Uint8Array,
): Promise<PptxBinary> | PptxBinary {
  if (output instanceof ArrayBuffer || output instanceof Uint8Array) return output;
  if (typeof Blob !== 'undefined' && output instanceof Blob) return output.arrayBuffer();
  throw new Error('pptxgenjs returned an unexpected non-binary output.');
}

export async function buildPptx(snapshot: DeckSnapshot): Promise<PptxBinary> {
  const exportSnapshot = await hydrateRemoteImages(snapshot);
  // Keep the sizeable MIT exporter out of the normal NodeSlide bundle until export is requested.
  const { default: PptxGenJSClass } = await import('pptxgenjs');
  const pptx = new PptxGenJSClass();
  const layoutName = 'NODESLIDE_WIDE';
  pptx.defineLayout({ name: layoutName, width: SLIDE_WIDTH_IN, height: SLIDE_HEIGHT_IN });
  pptx.layout = layoutName;
  pptx.author = 'NodeSlide';
  pptx.company = 'Parity Studio';
  pptx.subject = exportSnapshot.deck.brief.purpose;
  pptx.title = exportSnapshot.deck.title;
  pptx.theme = {
    headFontFace: safeFontFamily(exportSnapshot.deck.theme.typography.display),
    bodyFontFace: safeFontFamily(exportSnapshot.deck.theme.typography.body),
  };

  for (const slide of orderedSlides(exportSnapshot)) {
    const pptxSlide = pptx.addSlide();
    pptxSlide.background = {
      color: colorToPptxHex(slide.background, exportSnapshot.deck.theme.colors.canvas),
    };
    // PowerPoint has no stable public slide object-name field. Keep a non-rendering marker in the
    // package so NodeSlide exports can recover the canonical slide identity on re-import. The
    // importer removes this marker before materializing editable slide elements.
    pptxSlide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.001,
      h: 0.001,
      objectName: `${NODESLIDE_PPTX_SLIDE_ID_PREFIX}${slide.id}`,
      fill: { color: 'FFFFFF', transparency: 100 },
      line: { color: 'FFFFFF', transparency: 100 },
    });
    for (const element of orderedExportElements(exportSnapshot, slide)) {
      addElement(pptx, pptxSlide, exportSnapshot, element);
    }
    const notes = speakerNotesForSlide(exportSnapshot, slide);
    if (notes) pptxSlide.addNotes(notes);
  }

  const output = await pptx.write({ outputType: 'arraybuffer', compression: true });
  return normalizeOutput(output);
}

const REMOTE_IMAGE_TIMEOUT_MS = 8_000;
const REMOTE_IMAGE_MAX_BYTES = 700_000;
const BASE64_CHUNK_BYTES = 0x8000;

async function hydrateRemoteImages(snapshot: DeckSnapshot): Promise<DeckSnapshot> {
  if (typeof fetch !== 'function') return snapshot;
  const elements = await Promise.all(
    snapshot.elements.map(async (element) => {
      const url = element.kind === 'image' ? element.imageUrl?.trim() : undefined;
      if (!url?.startsWith('https://') || isEmbeddedImageData(url)) return element;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS) });
        if (!response.ok) return element;
        // Reject on the declared length before buffering, so an oversized body is never read.
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > REMOTE_IMAGE_MAX_BYTES) return element;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || blob.size > REMOTE_IMAGE_MAX_BYTES) return element;
        return { ...element, imageUrl: await blobDataUrl(blob) };
      } catch {
        return element;
      }
    }),
  );
  return { ...snapshot, elements };
}

// Export runs in the browser and under Node (the proof scripts), so this deliberately avoids
// FileReader, which Node does not expose. btoa and Blob#arrayBuffer exist in both.
async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK_BYTES));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
