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

interface PptxBox {
  x: number;
  y: number;
  w: number;
  h: number;
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
  return value.replace(/[;'"{}<>]/g, '').trim() || 'Aptos';
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
  pptxSlide.addImage({
    ...box,
    data: element.imageUrl.trim(),
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
  // Keep the sizeable MIT exporter out of the normal NodeSlide bundle until export is requested.
  const { default: PptxGenJSClass } = await import('pptxgenjs');
  const pptx = new PptxGenJSClass();
  const layoutName = 'NODESLIDE_WIDE';
  pptx.defineLayout({ name: layoutName, width: SLIDE_WIDTH_IN, height: SLIDE_HEIGHT_IN });
  pptx.layout = layoutName;
  pptx.author = 'NodeSlide';
  pptx.company = 'Parity Studio';
  pptx.subject = snapshot.deck.brief.purpose;
  pptx.title = snapshot.deck.title;
  pptx.theme = {
    headFontFace: safeFontFamily(snapshot.deck.theme.typography.display),
    bodyFontFace: safeFontFamily(snapshot.deck.theme.typography.body),
  };

  for (const slide of orderedSlides(snapshot)) {
    const pptxSlide = pptx.addSlide();
    pptxSlide.background = {
      color: colorToPptxHex(slide.background, snapshot.deck.theme.colors.canvas),
    };
    for (const element of orderedExportElements(snapshot, slide)) {
      addElement(pptx, pptxSlide, snapshot, element);
    }
    const notes = speakerNotesForSlide(snapshot, slide);
    if (notes) pptxSlide.addNotes(notes);
  }

  const output = await pptx.write({ outputType: 'arraybuffer', compression: true });
  return normalizeOutput(output);
}
