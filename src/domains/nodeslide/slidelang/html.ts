import type { ChartData, DeckSnapshot, Slide, SlideElement } from '../../../../shared/nodeslide';
import { type SlideSourceReference, elementSourceIds, slideSourceReferences } from './provenance';
import {
  SVG_HEIGHT,
  SVG_WIDTH,
  clamp,
  colorToHex,
  escapeHtml,
  isEmbeddedImageData,
  normalizeBoundingBox,
  orderedExportElements,
  orderedSlides,
  stableDomId,
} from './utils';

interface SvgBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CHART_COLORS = ['#f6b94a', '#7dd3fc', '#d9f99d', '#f0abfc', '#fb7185'];
const DECORATIVE_ROLE =
  /(?:^|[-_\s])(?:accent|background|decoration|decorative|divider|ornament)(?:$|[-_\s])/i;
const HEADING_ROLE = /(?:^|[-_\s])(?:heading|headline|title)(?:$|[-_\s])/i;
const UNORDERED_LIST_ITEM = /^\s*(?:[-*\u2022\u2023\u25aa])\s+(.+?)\s*$/;
const ORDERED_LIST_ITEM = /^\s*\d+[.)]\s+(.+?)\s*$/;
const VISUALLY_HIDDEN_STYLE =
  'position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;clip-path:inset(50%)!important;white-space:normal!important;border:0!important';

function svgBox(element: SlideElement): SvgBox {
  const bbox = normalizeBoundingBox(element.bbox);
  return {
    x: bbox.x * SVG_WIDTH,
    y: bbox.y * SVG_HEIGHT,
    width: bbox.width * SVG_WIDTH,
    height: bbox.height * SVG_HEIGHT,
  };
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeFontFamily(value: string): string {
  const cleaned = value.replace(/[;'"{}<>]/g, '').trim() || 'system-ui';
  return `'${escapeHtml(cleaned)}', system-ui, sans-serif`;
}

function rotationTransform(element: SlideElement, box: SvgBox): string {
  const rotation = finite(element.rotation, 0);
  if (rotation === 0) return '';
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return ` transform="rotate(${rotation} ${centerX} ${centerY})"`;
}

function textHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br/>');
}

function sourceIdsAttribute(sourceIds: readonly string[]): string {
  return sourceIds.length > 0 ? ` data-source-ids="${escapeHtml(sourceIds.join(' '))}"` : '';
}

function isDecorativeElement(element: SlideElement): boolean {
  if (DECORATIVE_ROLE.test(element.role ?? '')) return true;
  if (element.kind === 'connector') return true;
  return element.kind === 'shape' && !element.content?.trim();
}

function semanticElementAttributes(element: SlideElement): string {
  return `data-semantic-element data-element-id="${escapeHtml(element.id)}" data-element-kind="${element.kind}"${sourceIdsAttribute(elementSourceIds(element))} aria-label="${escapeHtml(element.name)}"`;
}

function renderSemanticTextBlocks(content: string): string {
  const blocks: string[] = [];
  let listKind: 'ol' | 'ul' | null = null;
  let listItems: string[] = [];
  const flushList = () => {
    if (!listKind || listItems.length === 0) return;
    blocks.push(
      `<${listKind}>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${listKind}>`,
    );
    listKind = null;
    listItems = [];
  };

  for (const line of content.split(/\r?\n/)) {
    const unordered = UNORDERED_LIST_ITEM.exec(line);
    const ordered = ORDERED_LIST_ITEM.exec(line);
    const nextKind = unordered ? 'ul' : ordered ? 'ol' : null;
    const item = unordered?.[1] ?? ordered?.[1];
    if (nextKind && item) {
      if (listKind !== nextKind) flushList();
      listKind = nextKind;
      listItems.push(item);
      continue;
    }
    flushList();
    const paragraph = line.trim();
    if (paragraph) blocks.push(`<p>${escapeHtml(paragraph)}</p>`);
  }
  flushList();
  return blocks.join('');
}

function renderSemanticTextElement(element: SlideElement): string {
  const content = element.content?.trim();
  if (!content) return '';
  const attributes = semanticElementAttributes(element);
  if (HEADING_ROLE.test(element.role ?? '')) {
    return `<h3 ${attributes}>${escapeHtml(content.replace(/\s+/g, ' '))}</h3>`;
  }
  return `<div ${attributes}>${renderSemanticTextBlocks(content)}</div>`;
}

function chartLabels(chart: ChartData): string[] {
  const rowCount = Math.max(
    0,
    chart.labels.length,
    ...chart.series.map((series) => series.values.length),
  );
  return Array.from({ length: rowCount }, (_, index) => {
    const label = chart.labels[index]?.trim();
    return label || `Category ${index + 1}`;
  });
}

function chartValueText(value: number | undefined, unit: string | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not available';
  return unit?.trim() ? `${value} ${unit.trim()}` : String(value);
}

function renderSemanticChart(element: SlideElement): string {
  const attributes = semanticElementAttributes(element);
  const chart = element.chart;
  if (!chart || chart.series.length === 0) {
    return `<figure ${attributes}><figcaption>${escapeHtml(element.name)}</figcaption><p>Chart data unavailable.</p></figure>`;
  }

  const labels = chartLabels(chart);
  const summary = chart.series
    .map((series) => {
      const values = labels
        .map((label, index) => `${label}: ${chartValueText(series.values[index], chart.unit)}`)
        .join('; ');
      return `${series.name}: ${values}`;
    })
    .join('. ');
  const header = chart.series
    .map((series) => {
      const unit = chart.unit?.trim();
      return `<th scope="col">${escapeHtml(`${series.name}${unit ? ` (${unit})` : ''}`)}</th>`;
    })
    .join('');
  const rows = labels
    .map(
      (label, index) =>
        `<tr><th scope="row">${escapeHtml(label)}</th>${chart.series
          .map((series) => {
            const value = series.values[index];
            return `<td>${typeof value === 'number' && Number.isFinite(value) ? escapeHtml(String(value)) : 'Not available'}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');

  return `<figure ${attributes}><figcaption>${escapeHtml(`${element.name}, ${chart.chartType} chart`)}</figcaption><p data-chart-summary>${escapeHtml(summary || 'No chart values are available.')}</p><table><caption>${escapeHtml(`${element.name} data`)}</caption><thead><tr><th scope="col">Category</th>${header}</tr></thead><tbody>${rows}</tbody></table></figure>`;
}

function renderSemanticImage(element: SlideElement): string {
  const label = element.altText?.trim() || element.name;
  const credit = element.image?.credit?.trim()
    ? `<p data-image-credit>${escapeHtml(element.image.credit.trim())}</p>`
    : '';
  const status = element.image?.placeholder ? '<p data-image-placeholder>Replace image</p>' : '';
  return `<figure ${semanticElementAttributes(element)}><figcaption>${escapeHtml(label)}</figcaption>${status}${credit}</figure>`;
}

function renderSemanticMath(element: SlideElement): string {
  const math = element.math;
  if (!math) {
    return `<div ${semanticElementAttributes(element)} role="math">Formula data unavailable.</div>`;
  }
  const expression = math.expression.trim() || element.content?.trim() || 'Formula unavailable';
  const description = math.description?.trim();
  const display = math.display?.trim() || description || expression;
  const variables = (math.variables ?? [])
    .map(
      (variable) =>
        `<div><dt>${escapeHtml(variable.label)}</dt><dd>${escapeHtml(`${variable.value}${variable.unit ? ` ${variable.unit}` : ''}`)}</dd></div>`,
    )
    .join('');
  return `<figure ${semanticElementAttributes(element)} role="math" data-expression="${escapeHtml(expression)}"><figcaption>${escapeHtml(display)}</figcaption><math aria-label="${escapeHtml(description || expression)}"><mtext>${escapeHtml(expression)}</mtext></math>${variables ? `<dl>${variables}</dl>` : ''}</figure>`;
}

function renderSemanticVideo(element: SlideElement): string {
  const title = element.video?.title?.trim() || element.altText?.trim() || element.name;
  const url = element.video?.url.trim();
  return `<figure ${semanticElementAttributes(element)}><figcaption>${escapeHtml(title)}</figcaption>${url ? `<p>Video source: ${escapeHtml(url)}</p>` : '<p>Video unavailable.</p>'}</figure>`;
}

function renderSemanticElement(element: SlideElement): string {
  if (isDecorativeElement(element)) return '';
  if (element.kind === 'chart') return renderSemanticChart(element);
  if (element.kind === 'image') return renderSemanticImage(element);
  if (element.kind === 'math') return renderSemanticMath(element);
  if (element.kind === 'video') return renderSemanticVideo(element);
  return renderSemanticTextElement(element);
}

function renderSemanticSource(reference: SlideSourceReference): string {
  const source = reference.source;
  if (!source) {
    return `<li data-source-id="${escapeHtml(reference.id)}" data-source-record-missing="true"><strong>Missing source record</strong><p>Source ID: ${escapeHtml(reference.id)}</p></li>`;
  }
  const url = source.url?.trim()
    ? `<div><dt>URL</dt><dd data-source-url>${escapeHtml(source.url.trim())}</dd></div>`
    : '';
  const disclaimer = source.license?.trim()
    ? `<div><dt>Disclaimer</dt><dd data-source-disclaimer>${escapeHtml(source.license.trim())}</dd></div>`
    : '';
  return `<li data-source-record data-source-id="${escapeHtml(source.id)}" data-source-deck-id="${escapeHtml(source.deckId)}" data-source-type="${source.sourceType}" data-source-retrieved-at="${source.retrievedAt}"><strong>${escapeHtml(source.title)}</strong><p><cite data-source-citation>${escapeHtml(source.citation)}</cite></p><dl><div><dt>Source ID</dt><dd>${escapeHtml(source.id)}</dd></div><div><dt>Type</dt><dd>${source.sourceType}</dd></div><div><dt>Retrieved</dt><dd>${source.retrievedAt}</dd></div>${url}${disclaimer}</dl></li>`;
}

function renderSemanticSlide(
  snapshot: DeckSnapshot,
  slide: Slide,
  index: number,
  total: number,
  references: readonly SlideSourceReference[],
): string {
  const headingId = `${stableDomId(slide.id)}-semantic-title`;
  const elements = orderedExportElements(snapshot, slide).map(renderSemanticElement).join('');
  const sources =
    references.length > 0
      ? `<aside data-slide-sources aria-labelledby="${stableDomId(`${slide.id}:sources`)}"><h3 id="${stableDomId(`${slide.id}:sources`)}">Sources</h3><ol>${references.map(renderSemanticSource).join('')}</ol></aside>`
      : '';
  return `<div class="slide-semantics" data-slide-semantics style="${VISUALLY_HIDDEN_STYLE}"><h2 id="${headingId}">Slide ${index + 1} of ${total}: ${escapeHtml(slide.title)}</h2>${elements}${sources}</div>`;
}

function serializeJsonForHtml(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  return json.replace(/[<>&\u2028\u2029]/g, (character) => {
    if (character === '<') return '\\u003c';
    if (character === '>') return '\\u003e';
    if (character === '&') return '\\u0026';
    if (character === '\u2028') return '\\u2028';
    return '\\u2029';
  });
}

function exportedSourceRecords(
  snapshot: DeckSnapshot,
  slides: readonly Slide[],
): DeckSnapshot['sources'] {
  const sourceIds = new Set<string>();
  for (const slide of slides) {
    for (const element of orderedExportElements(snapshot, slide)) {
      for (const sourceId of elementSourceIds(element)) sourceIds.add(sourceId);
    }
  }
  return snapshot.sources.filter((source) => sourceIds.has(source.id));
}

function renderTextBox(
  snapshot: DeckSnapshot,
  element: SlideElement,
  box: SvgBox,
  content = element.content ?? '',
): string {
  const style = element.style;
  const fontFamily =
    style.fontFamily ??
    (/(?:title|headline|display)/i.test(element.role ?? '')
      ? snapshot.deck.theme.typography.display
      : snapshot.deck.theme.typography.body);
  const color = colorToHex(style.color, snapshot.deck.theme.colors.ink);
  const fontSize = clamp(finite(style.fontSize, 24), 1, 240);
  const fontWeight = clamp(finite(style.fontWeight, 400), 100, 900);
  const lineHeight = clamp(finite(style.lineHeight, 1.2), 0.8, 3);
  const letterSpacing = clamp(finite(style.letterSpacing, 0), -10, 40);
  const padding = clamp(finite(style.padding, 0), 0, Math.min(box.width, box.height) / 3);
  const align = style.textAlign ?? 'left';
  const alignItems = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
  const justifyContent =
    style.verticalAlign === 'middle'
      ? 'center'
      : style.verticalAlign === 'bottom'
        ? 'flex-end'
        : 'flex-start';
  return `<foreignObject x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;align-items:${alignItems};justify-content:${justifyContent};overflow:hidden;padding:${padding}px;color:${color};font-family:${safeFontFamily(fontFamily)};font-size:${fontSize}px;font-weight:${fontWeight};line-height:${lineHeight};letter-spacing:${letterSpacing}px;text-align:${align};white-space:pre-wrap;overflow-wrap:anywhere">${textHtml(content)}</div></foreignObject>`;
}

function renderShape(snapshot: DeckSnapshot, element: SlideElement, box: SvgBox): string {
  const fill = colorToHex(element.style.fill, 'transparent');
  const stroke = colorToHex(element.style.stroke, snapshot.deck.theme.colors.border);
  const strokeWidth = clamp(finite(element.style.strokeWidth, element.style.stroke ? 1 : 0), 0, 40);
  const radius = clamp(finite(element.style.radius, snapshot.deck.theme.defaultRadius), 0, 200);
  const opacity = clamp(finite(element.style.opacity, 1), 0, 1);
  const rect = `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`;
  const content = element.content?.trim()
    ? renderTextBox(snapshot, element, box, element.content)
    : '';
  return `${rect}${content}`;
}

function renderImage(snapshot: DeckSnapshot, element: SlideElement, box: SvgBox): string {
  if (isEmbeddedImageData(element.imageUrl)) {
    return `<image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" href="${escapeHtml(element.imageUrl.trim())}" preserveAspectRatio="xMidYMid slice" opacity="${clamp(finite(element.style.opacity, 1), 0, 1)}"/>`;
  }
  const fill = colorToHex(element.style.fill, snapshot.deck.theme.colors.accentSoft);
  const stroke = colorToHex(element.style.stroke, snapshot.deck.theme.colors.border);
  const label = element.altText?.trim() || element.name || 'Image unavailable';
  return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-dasharray="10 8"/><text x="${box.x + box.width / 2}" y="${box.y + box.height / 2}" fill="${colorToHex(snapshot.deck.theme.colors.muted, '#777777')}" font-family="system-ui, sans-serif" font-size="18" text-anchor="middle" dominant-baseline="middle">${escapeHtml(label)} · static asset unavailable</text>`;
}

function chartRange(chart: ChartData): { minimum: number; maximum: number } {
  const values = chart.series.flatMap((series) => series.values).filter(Number.isFinite);
  if (values.length === 0) return { minimum: 0, maximum: 1 };
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  return minimum === maximum ? { minimum, maximum: minimum + 1 } : { minimum, maximum };
}

function chartColor(snapshot: DeckSnapshot, seriesIndex: number, explicit?: string): string {
  return colorToHex(
    explicit,
    CHART_COLORS[seriesIndex % CHART_COLORS.length] ?? snapshot.deck.theme.colors.accent,
  );
}

function renderCartesianChart(snapshot: DeckSnapshot, chart: ChartData, box: SvgBox): string {
  const left = box.x + box.width * 0.08;
  const top = box.y + box.height * 0.08;
  const width = box.width * 0.86;
  const height = box.height * 0.78;
  const { minimum, maximum } = chartRange(chart);
  const valueY = (value: number): number =>
    top + height - ((value - minimum) / (maximum - minimum)) * height;
  const baseline = valueY(0);
  const labels = chart.labels.length > 0 ? chart.labels : [''];
  const axisColor = colorToHex(snapshot.deck.theme.colors.border, '#555555');
  const ink = colorToHex(snapshot.deck.theme.colors.muted, '#777777');
  const parts = [
    `<line x1="${left}" y1="${baseline}" x2="${left + width}" y2="${baseline}" stroke="${axisColor}" stroke-width="2"/>`,
  ];

  if (chart.chartType === 'bar') {
    const groupWidth = width / labels.length;
    const seriesCount = Math.max(1, chart.series.length);
    const barWidth = (groupWidth * 0.72) / seriesCount;
    chart.series.forEach((series, seriesIndex) => {
      series.values.forEach((value, valueIndex) => {
        const y = valueY(value);
        const x = left + valueIndex * groupWidth + groupWidth * 0.14 + seriesIndex * barWidth;
        parts.push(
          `<rect x="${x}" y="${Math.min(y, baseline)}" width="${Math.max(1, barWidth - 3)}" height="${Math.max(1, Math.abs(baseline - y))}" rx="3" fill="${chartColor(snapshot, seriesIndex, series.color)}"/>`,
        );
      });
    });
  } else {
    chart.series.forEach((series, seriesIndex) => {
      const denominator = Math.max(1, labels.length - 1);
      const points = series.values
        .map((value, index) => `${left + (index / denominator) * width},${valueY(value)}`)
        .join(' ');
      const color = chartColor(snapshot, seriesIndex, series.color);
      if (chart.chartType === 'area' && points) {
        const firstX = left;
        const lastX = left + width;
        parts.push(
          `<polygon points="${firstX},${baseline} ${points} ${lastX},${baseline}" fill="${color}" opacity="0.22"/>`,
        );
      }
      parts.push(
        `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
      series.values.forEach((value, index) => {
        const x = left + (index / denominator) * width;
        parts.push(`<circle cx="${x}" cy="${valueY(value)}" r="5" fill="${color}"/>`);
      });
    });
  }

  const labelStep = labels.length > 8 ? Math.ceil(labels.length / 8) : 1;
  labels.forEach((label, index) => {
    if (index % labelStep !== 0) return;
    const denominator = chart.chartType === 'bar' ? labels.length : Math.max(1, labels.length - 1);
    const offset = chart.chartType === 'bar' ? 0.5 : 0;
    const x = left + ((index + offset) / denominator) * width;
    parts.push(
      `<text x="${x}" y="${top + height + 28}" fill="${ink}" font-family="system-ui, sans-serif" font-size="15" text-anchor="middle">${escapeHtml(label)}</text>`,
    );
  });
  return parts.join('');
}

function renderDonutChart(snapshot: DeckSnapshot, chart: ChartData, box: SvgBox): string {
  const values = chart.series[0]?.values.map((value) => Math.max(0, value)) ?? [];
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const radius = Math.max(1, Math.min(box.width, box.height) * 0.3);
  const circumference = 2 * Math.PI * radius;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  let offset = 0;
  const parts = [
    `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="${colorToHex(snapshot.deck.theme.colors.border, '#555555')}" stroke-width="${radius * 0.38}" opacity="0.35"/>`,
  ];
  values.forEach((value, index) => {
    const length = (value / total) * circumference;
    parts.push(
      `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="${chartColor(snapshot, index, chart.series[0]?.color)}" stroke-width="${radius * 0.38}" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${centerX} ${centerY})"/>`,
    );
    offset += length;
  });
  parts.push(
    `<text x="${centerX}" y="${centerY}" fill="${colorToHex(snapshot.deck.theme.colors.ink, '#ffffff')}" font-family="system-ui, sans-serif" font-size="${Math.max(18, radius * 0.32)}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escapeHtml(chart.unit ?? '')}</text>`,
  );
  return parts.join('');
}

function renderChart(snapshot: DeckSnapshot, element: SlideElement, box: SvgBox): string {
  if (!element.chart) {
    return renderImage(snapshot, { ...element, altText: 'Chart data unavailable' }, box);
  }
  const chart = element.chart;
  return chart.chartType === 'donut'
    ? renderDonutChart(snapshot, chart, box)
    : renderCartesianChart(snapshot, chart, box);
}

function renderMath(snapshot: DeckSnapshot, element: SlideElement, box: SvgBox): string {
  const expression = element.math?.expression ?? element.content ?? 'Formula unavailable';
  return renderTextBox(snapshot, element, box, expression);
}

function mediaFragmentUrl(url: string, start?: number, end?: number): string {
  if (start === undefined && end === undefined) return url;
  const fragment = `t=${Math.max(0, start ?? 0)}${end === undefined ? '' : `,${Math.max(0, end)}`}`;
  return `${url.split('#')[0]}#${fragment}`;
}

function renderVideo(snapshot: DeckSnapshot, element: SlideElement, box: SvgBox): string {
  const video = element.video;
  if (!video?.url.trim()) {
    return renderImage(snapshot, { ...element, altText: 'Video unavailable' }, box);
  }
  const poster = video.posterUrl?.trim() ? ` poster="${escapeHtml(video.posterUrl.trim())}"` : '';
  const label = video.title?.trim() || element.altText?.trim() || element.name;
  const captions = video.captionsUrl?.trim()
    ? `<track default="default" kind="captions" src="${escapeHtml(video.captionsUrl.trim())}" srclang="${escapeHtml(video.captionsLanguage?.trim() || 'en')}" />`
    : '';
  return `<foreignObject x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"><video xmlns="http://www.w3.org/1999/xhtml" controls="controls" preload="metadata" src="${escapeHtml(mediaFragmentUrl(video.url.trim(), video.startAtSeconds, video.endAtSeconds))}"${poster} aria-label="${escapeHtml(label)}" style="display:block;width:100%;height:100%;object-fit:cover;background:#111">${captions}</video></foreignObject>`;
}

function renderConnector(
  snapshot: DeckSnapshot,
  element: SlideElement,
  box: SvgBox,
  markerId: string,
): string {
  const stroke = colorToHex(element.style.stroke, snapshot.deck.theme.colors.trace);
  const width = clamp(finite(element.style.strokeWidth, 2), 1, 20);
  return `<line x1="${box.x}" y1="${box.y + box.height}" x2="${box.x + box.width}" y2="${box.y}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" marker-end="url(#${markerId})"/>`;
}

function renderElement(snapshot: DeckSnapshot, element: SlideElement, markerId: string): string {
  const box = svgBox(element);
  let body: string;
  if (element.kind === 'text') body = renderTextBox(snapshot, element, box);
  else if (element.kind === 'shape') body = renderShape(snapshot, element, box);
  else if (element.kind === 'image') body = renderImage(snapshot, element, box);
  else if (element.kind === 'chart') body = renderChart(snapshot, element, box);
  else if (element.kind === 'math') body = renderMath(snapshot, element, box);
  else if (element.kind === 'video') body = renderVideo(snapshot, element, box);
  else body = renderConnector(snapshot, element, box, markerId);
  const accessibility = isDecorativeElement(element)
    ? ' aria-hidden="true"'
    : ` role="group" aria-label="${escapeHtml(element.name)}"`;
  const title = isDecorativeElement(element) ? '' : `<title>${escapeHtml(element.name)}</title>`;
  return `<g data-element-id="${escapeHtml(element.id)}" data-element-kind="${element.kind}"${sourceIdsAttribute(elementSourceIds(element))}${accessibility}${rotationTransform(element, box)}>${title}${body}</g>`;
}

function renderSlideSection(
  snapshot: DeckSnapshot,
  slide: Slide,
  index: number,
  total: number,
): string {
  const background = colorToHex(slide.background, snapshot.deck.theme.colors.canvas);
  const markerId = `${stableDomId(slide.id)}-arrow`;
  const semanticHeadingId = `${stableDomId(slide.id)}-semantic-title`;
  const sourceReferences = slideSourceReferences(snapshot, slide);
  const elements = orderedExportElements(snapshot, slide)
    .map((element) => renderElement(snapshot, element, markerId))
    .join('');
  const semantics = renderSemanticSlide(snapshot, slide, index, total, sourceReferences);
  const notes = slide.notes?.trim()
    ? `<aside data-presenter-notes hidden>${escapeHtml(slide.notes)}</aside>`
    : '';
  return `<section data-slide-id="${escapeHtml(slide.id)}" data-slide-index="${index}"${sourceIdsAttribute(sourceReferences.map((reference) => reference.id))} role="region" aria-labelledby="${semanticHeadingId}" style="position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:${background};box-shadow:0 24px 80px rgba(0,0,0,.35)">${semantics}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="100%" height="100%" data-slide-visual aria-hidden="true" focusable="false" style="display:block;background:${background}"><title>Visual rendering of ${escapeHtml(slide.title)}</title><defs><marker id="${markerId}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${colorToHex(snapshot.deck.theme.colors.trace, '#7dd3fc')}"/></marker></defs>${elements}</svg>${notes}</section>`;
}

export function renderSlideHtml(snapshot: DeckSnapshot, slideId: string): string {
  const slides = orderedSlides(snapshot);
  const index = slides.findIndex((slide) => slide.id === slideId);
  const slide = slides[index];
  if (!slide) throw new Error(`Unknown slide ${slideId}.`);
  return renderSlideSection(snapshot, slide, index, slides.length);
}

export function renderDeckHtml(snapshot: DeckSnapshot): string {
  const slides = orderedSlides(snapshot);
  const renderedSlides = slides
    .map((slide, index) => renderSlideSection(snapshot, slide, index, slides.length))
    .join('');
  const title = escapeHtml(snapshot.deck.title);
  const exportedSources = exportedSourceRecords(snapshot, slides);
  const sourceRecords = serializeJsonForHtml(exportedSources);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="generator" content="${escapeHtml(snapshot.deck.toolchainVersion)}"/>
  <meta name="nodeslide-deck-id" content="${escapeHtml(snapshot.deck.id)}"/>
  <title>${title}</title>
  <style>
    :root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#080a0e;color:#f7f4ec}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0,#252b38 0,#080a0e 58%);overflow:hidden}
    main{height:100vh;display:grid;place-items:center;padding:3.5rem 1rem}.deck-stage{width:min(calc(100vw - 2rem),calc((100vh - 7rem)*16/9));max-height:calc(100vh - 7rem)}
    [data-slide-id][hidden]{display:none!important}nav{position:fixed;inset:auto 0 0;display:flex;align-items:center;justify-content:center;gap:.75rem;padding:.75rem;background:linear-gradient(transparent,rgba(0,0,0,.82));z-index:5}
    button{appearance:none;border:1px solid #4b5563;border-radius:999px;background:#171b23;color:#f7f4ec;padding:.55rem .9rem;font:600 .9rem/1 system-ui;cursor:pointer}button:hover{background:#252c38}button:disabled{opacity:.35;cursor:not-allowed}
    output{min-width:5rem;text-align:center;font-variant-numeric:tabular-nums;color:#cbd5e1}aside[data-presenter-notes]:not([hidden]){position:fixed;z-index:10;inset:auto 1rem 4.5rem;max-height:30vh;overflow:auto;padding:1rem;border:1px solid #475569;border-radius:.75rem;background:rgba(15,23,42,.96);white-space:pre-wrap}
  </style>
</head>
<body>
  <main aria-label="${title} presentation"><div class="deck-stage">${renderedSlides}</div></main>
  <script type="application/json" data-nodeslide-source-records data-deck-id="${escapeHtml(snapshot.deck.id)}" data-source-count="${exportedSources.length}">${sourceRecords}</script>
  <nav aria-label="Presenter navigation"><button type="button" data-action="previous" aria-label="Previous slide">← Previous</button><output aria-live="polite">1 / ${slides.length}</output><button type="button" data-action="next" aria-label="Next slide">Next →</button></nav>
  <script>
    (()=>{const slides=[...document.querySelectorAll('[data-slide-id]')];const output=document.querySelector('output');const previous=document.querySelector('[data-action="previous"]');const next=document.querySelector('[data-action="next"]');let index=Math.max(0,slides.findIndex(slide=>decodeURIComponent(location.hash.slice(1))===slide.dataset.slideId));const show=(value)=>{index=Math.max(0,Math.min(slides.length-1,value));slides.forEach((slide,i)=>{slide.hidden=i!==index;slide.setAttribute('aria-hidden',String(i!==index));});if(output)output.textContent=(index+1)+' / '+slides.length;if(previous)previous.disabled=index===0;if(next)next.disabled=index===slides.length-1;const id=slides[index]?.dataset.slideId;if(id&&location.hash.slice(1)!==encodeURIComponent(id))history.replaceState(null,'','#'+encodeURIComponent(id));};previous?.addEventListener('click',()=>show(index-1));next?.addEventListener('click',()=>show(index+1));addEventListener('keydown',(event)=>{if(['ArrowRight','PageDown',' '].includes(event.key)){event.preventDefault();show(index+1);}else if(['ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();show(index-1);}else if(event.key==='Home')show(0);else if(event.key==='End')show(slides.length-1);else if(event.key.toLowerCase()==='p'){const notes=slides[index]?.querySelector('[data-presenter-notes]');if(notes)notes.hidden=!notes.hidden;}});addEventListener('hashchange',()=>{const target=slides.findIndex(slide=>decodeURIComponent(location.hash.slice(1))===slide.dataset.slideId);if(target>=0)show(target);});show(index);})();
  </script>
</body>
</html>`;
}
