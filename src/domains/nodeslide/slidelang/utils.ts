import {
  type BoundingBox,
  type DeckSnapshot,
  NODESLIDE_MIN_READABLE_FONT_SIZE,
  type Slide,
  type SlideElement,
} from '../../../../shared/nodeslide';

export const SVG_WIDTH = 1600;
export const SVG_HEIGHT = 900;
export const MIN_READABLE_FONT_SIZE = NODESLIDE_MIN_READABLE_FONT_SIZE;

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const DATA_IMAGE_PATTERN =
  /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function isStableId(value: string): boolean {
  return STABLE_ID_PATTERN.test(value);
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function stableDomId(value: string): string {
  return `sl-${stableHash(value)}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function isEmbeddedImageData(value: string | undefined): value is string {
  return typeof value === 'string' && DATA_IMAGE_PATTERN.test(value.trim());
}

export function orderedSlides(snapshot: DeckSnapshot): Slide[] {
  const byId = new Map(snapshot.slides.map((slide) => [slide.id, slide]));
  const ordered = snapshot.deck.slideOrder.flatMap((slideId) => {
    const slide = byId.get(slideId);
    return slide ? [slide] : [];
  });
  const seen = new Set(ordered.map((slide) => slide.id));
  return [...ordered, ...snapshot.slides.filter((slide) => !seen.has(slide.id))];
}

export function orderedElements(snapshot: DeckSnapshot, slide: Slide): SlideElement[] {
  const candidates = snapshot.elements.filter((element) => element.slideId === slide.id);
  const byId = new Map(candidates.map((element) => [element.id, element]));
  const ordered = slide.elementOrder.flatMap((elementId) => {
    const element = byId.get(elementId);
    return element ? [element] : [];
  });
  const seen = new Set(ordered.map((element) => element.id));
  return [...ordered, ...candidates.filter((element) => !seen.has(element.id))];
}

/** Non-mutating element view shared by every SlideLang export path. */
export function orderedExportElements(snapshot: DeckSnapshot, slide: Slide): SlideElement[] {
  return orderedElements(snapshot, slide).filter((element) => element.visible !== false);
}

export function cloneSnapshot(snapshot: DeckSnapshot): DeckSnapshot {
  return structuredClone(snapshot);
}

export function normalizeBoundingBox(bbox: BoundingBox): BoundingBox {
  const width = clamp(Number.isFinite(bbox.width) ? bbox.width : 0.01, 0.01, 1);
  const height = clamp(Number.isFinite(bbox.height) ? bbox.height : 0.01, 0.01, 1);
  const x = clamp(Number.isFinite(bbox.x) ? bbox.x : 0, 0, 1 - width);
  const y = clamp(Number.isFinite(bbox.y) ? bbox.y : 0, 0, 1 - height);
  return { x, y, width, height };
}

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export function parseColor(value: string | undefined): RgbColor | null {
  if (!value) return null;
  const normalized = value.trim();
  const shortHex = /^#([\da-f])([\da-f])([\da-f])$/i.exec(normalized);
  if (shortHex) {
    const [, red = '0', green = '0', blue = '0'] = shortHex;
    return {
      red: Number.parseInt(`${red}${red}`, 16),
      green: Number.parseInt(`${green}${green}`, 16),
      blue: Number.parseInt(`${blue}${blue}`, 16),
    };
  }

  const longHex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})(?:[\da-f]{2})?$/i.exec(normalized);
  if (longHex) {
    const [, red = '00', green = '00', blue = '00'] = longHex;
    return {
      red: Number.parseInt(red, 16),
      green: Number.parseInt(green, 16),
      blue: Number.parseInt(blue, 16),
    };
  }

  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,[^)]*)?\)$/i.exec(
    normalized,
  );
  if (!rgb) return null;
  return {
    red: clamp(Number(rgb[1]), 0, 255),
    green: clamp(Number(rgb[2]), 0, 255),
    blue: clamp(Number(rgb[3]), 0, 255),
  };
}

export function colorToHex(value: string | undefined, fallback: string): string {
  const color = parseColor(value) ?? parseColor(fallback) ?? { red: 0, green: 0, blue: 0 };
  return `#${[color.red, color.green, color.blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function colorToPptxHex(value: string | undefined, fallback: string): string {
  return colorToHex(value, fallback).slice(1).toUpperCase();
}

function relativeLuminance(color: RgbColor): number {
  const channels = [color.red, color.green, color.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

export function contrastRatio(
  foreground: string | undefined,
  background: string | undefined,
): number | null {
  const foregroundColor = parseColor(foreground);
  const backgroundColor = parseColor(background);
  if (!foregroundColor || !backgroundColor) return null;
  const foregroundLuminance = relativeLuminance(foregroundColor);
  const backgroundLuminance = relativeLuminance(backgroundColor);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function chooseReadableTextColor(background: string | undefined): string {
  const blackContrast = contrastRatio('#000000', background) ?? 0;
  const whiteContrast = contrastRatio('#ffffff', background) ?? 0;
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
}

export interface TextFitEstimate {
  overflow: boolean;
  estimatedLines: number;
  availableLines: number;
  estimatedCharactersPerLine: number;
}

export function estimateTextFit(element: SlideElement): TextFitEstimate {
  const content = element.content ?? '';
  const fontSize = Number.isFinite(element.style.fontSize)
    ? Math.max(1, element.style.fontSize ?? 24)
    : 24;
  const lineHeight = Number.isFinite(element.style.lineHeight)
    ? Math.max(0.8, element.style.lineHeight ?? 1.2)
    : 1.2;
  const padding = Number.isFinite(element.style.padding)
    ? Math.max(0, element.style.padding ?? 0)
    : 0;
  const innerWidth = Math.max(1, element.bbox.width * SVG_WIDTH - padding * 2);
  const innerHeight = Math.max(1, element.bbox.height * SVG_HEIGHT - padding * 2);
  const averageCharacterWidth = fontSize * 0.52;
  const charactersPerLine = Math.max(1, Math.floor(innerWidth / averageCharacterWidth));
  const availableLines = Math.max(1, Math.floor(innerHeight / (fontSize * lineHeight)));

  let estimatedLines = 0;
  for (const paragraph of content.split(/\r?\n/)) {
    if (paragraph.length === 0) {
      estimatedLines += 1;
      continue;
    }
    let lineLength = 0;
    let lines = 1;
    for (const word of paragraph.split(/\s+/)) {
      const wordLength = Math.max(1, word.length);
      if (wordLength > charactersPerLine) {
        const wrappedWordLines = Math.ceil(wordLength / charactersPerLine);
        lines += Math.max(0, wrappedWordLines - (lineLength === 0 ? 1 : 0));
        lineLength = wordLength % charactersPerLine;
      } else if (lineLength === 0) {
        lineLength = wordLength;
      } else if (lineLength + 1 + wordLength <= charactersPerLine) {
        lineLength += 1 + wordLength;
      } else {
        lines += 1;
        lineLength = wordLength;
      }
    }
    estimatedLines += lines;
  }

  return {
    overflow: estimatedLines > availableLines,
    estimatedLines,
    availableLines,
    estimatedCharactersPerLine: charactersPerLine,
  };
}

export function intersectionRatio(first: BoundingBox, second: BoundingBox): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
  );
  const intersection = width * height;
  const smallerArea = Math.min(first.width * first.height, second.width * second.height);
  return smallerArea > 0 ? intersection / smallerArea : 0;
}

export function boxContains(
  container: BoundingBox,
  content: BoundingBox,
  tolerance = 0.005,
): boolean {
  return (
    container.x <= content.x + tolerance &&
    container.y <= content.y + tolerance &&
    container.x + container.width >= content.x + content.width - tolerance &&
    container.y + container.height >= content.y + content.height - tolerance
  );
}
