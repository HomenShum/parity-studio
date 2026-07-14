import type {
  ChartData,
  DeckPatch,
  ElementStyle,
  PatchOperation,
  SlideElement,
} from '../../../../shared/nodeslide';

export const JSON_PREVIEW_CHARACTER_LIMIT = 48_000;
export const JSON_EDITOR_CHARACTER_LIMIT = 100_000;

export interface BoundedJsonPreview {
  text: string;
  truncated: boolean;
  totalCharacters: number;
}

export type JsonEditResult =
  | { ok: true; operations: PatchOperation[] }
  | { ok: false; error: string };

const ELEMENT_KEYS = new Set<keyof SlideElement>([
  'id',
  'slideId',
  'name',
  'kind',
  'role',
  'bbox',
  'rotation',
  'content',
  'style',
  'chart',
  'math',
  'video',
  'image',
  'imageUrl',
  'altText',
  'sourceIds',
  'locked',
  'visible',
  'groupId',
  'exportCapabilities',
  'version',
]);

const READ_ONLY_FIELDS: ReadonlyArray<keyof SlideElement> = [
  'id',
  'slideId',
  'name',
  'kind',
  'role',
  'rotation',
  'video',
  'locked',
  'groupId',
  'exportCapabilities',
  'version',
];

const STYLE_KEYS = new Set<keyof ElementStyle>([
  'fill',
  'stroke',
  'strokeWidth',
  'color',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'verticalAlign',
  'radius',
  'opacity',
  'padding',
  'shadow',
]);

const STRING_STYLE_KEYS = new Set<keyof ElementStyle>([
  'fill',
  'stroke',
  'color',
  'fontFamily',
  'shadow',
]);

export function jsonForCopy(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return `${serialized ?? 'null'}\n`;
}

export function boundedJsonPreview(
  value: unknown,
  characterLimit = JSON_PREVIEW_CHARACTER_LIMIT,
): BoundedJsonPreview {
  const full = jsonForCopy(value);
  const safeLimit = Math.max(1, Math.floor(characterLimit));
  if (full.length <= safeLimit) {
    return { text: full, truncated: false, totalCharacters: full.length };
  }
  return {
    text: `${full.slice(0, safeLimit)}\n\u2026 preview truncated`,
    truncated: true,
    totalCharacters: full.length,
  };
}

export function latestDeckPatch(patches: readonly DeckPatch[]): DeckPatch | null {
  return (
    [...patches].sort(
      (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id),
    )[0] ?? null
  );
}

export function diffSelectedElementJson(
  current: SlideElement,
  draft: string,
  validSourceIds?: ReadonlySet<string>,
): JsonEditResult {
  if (draft.length > JSON_EDITOR_CHARACTER_LIMIT) {
    return {
      ok: false,
      error: `Element JSON is limited to ${JSON_EDITOR_CHARACTER_LIMIT.toLocaleString()} characters.`,
    };
  }
  if (current.locked) {
    return { ok: false, error: `${current.name} is locked and cannot be edited.` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(draft);
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : 'check the document syntax.'}`,
    };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'Selected-element JSON must be one object.' };
  }

  const unknownKeys = Object.keys(parsed).filter(
    (key) => !ELEMENT_KEYS.has(key as keyof SlideElement),
  );
  if (unknownKeys.length > 0) {
    return { ok: false, error: `Unsupported element field: ${unknownKeys.join(', ')}.` };
  }

  const candidate = parsed as Partial<SlideElement>;
  for (const field of READ_ONLY_FIELDS) {
    if (!sameJson(candidate[field], current[field])) {
      const detail = field === 'rotation' ? ' Rotation has no typed patch operation yet.' : '';
      return { ok: false, error: `“${field}” is read-only in Source.${detail}` };
    }
  }

  const bboxError = validateBoundingBox(candidate.bbox);
  if (bboxError) return { ok: false, error: bboxError };
  const styleError = validateStyle(candidate.style);
  if (styleError) return { ok: false, error: styleError };
  const sourceError = validateSourceIds(candidate.sourceIds, validSourceIds);
  if (sourceError) return { ok: false, error: sourceError };

  const operations: PatchOperation[] = [];
  const bbox = candidate.bbox as SlideElement['bbox'];
  const style = candidate.style as ElementStyle;
  const sourceIds = candidate.sourceIds as string[];
  const moved = bbox.x !== current.bbox.x || bbox.y !== current.bbox.y;
  const resized = bbox.width !== current.bbox.width || bbox.height !== current.bbox.height;
  if (moved || resized) {
    const finalInBounds =
      bbox.x + bbox.width <= 1 + Number.EPSILON && bbox.y + bbox.height <= 1 + Number.EPSILON;
    if (!finalInBounds) {
      return { ok: false, error: 'The edited bbox must remain inside normalized slide bounds.' };
    }
    const resizeFirst =
      current.bbox.x + bbox.width <= 1 + Number.EPSILON &&
      current.bbox.y + bbox.height <= 1 + Number.EPSILON;
    const moveFirst =
      bbox.x + current.bbox.width <= 1 + Number.EPSILON &&
      bbox.y + current.bbox.height <= 1 + Number.EPSILON;
    if (moved && resized && !resizeFirst && !moveFirst) {
      return {
        ok: false,
        error:
          'This bbox change has no valid move/resize order. Apply the position and size changes separately.',
      };
    }
    const move: PatchOperation = {
      op: 'move',
      slideId: current.slideId,
      elementId: current.id,
      x: bbox.x,
      y: bbox.y,
    };
    const resize: PatchOperation = {
      op: 'resize',
      slideId: current.slideId,
      elementId: current.id,
      width: bbox.width,
      height: bbox.height,
    };
    if (moved && resized) operations.push(...(resizeFirst ? [resize, move] : [move, resize]));
    else if (moved) operations.push(move);
    else operations.push(resize);
  }

  const styleProperties = changedStyleProperties(current.style, style);
  if ('error' in styleProperties) return { ok: false, error: styleProperties.error };
  if (Object.keys(styleProperties.properties).length > 0) {
    operations.push({
      op: 'update_style',
      slideId: current.slideId,
      elementId: current.id,
      properties: styleProperties.properties,
    });
  }

  const contentChanged = candidate.content !== current.content;
  const sourceIdsChanged = !sameJson(candidate.sourceIds, current.sourceIds);
  if (contentChanged) {
    if (current.kind !== 'text' && current.kind !== 'math') {
      return {
        ok: false,
        error: `“content” cannot be edited on a ${current.kind} element with existing operations.`,
      };
    }
    if (typeof candidate.content !== 'string') {
      return { ok: false, error: '“content” must be a string; deleting it is not supported.' };
    }
    if (current.kind === 'math') {
      const expectedMath = current.math
        ? { ...current.math, expression: candidate.content, display: candidate.content }
        : current.math;
      if (!sameJson(candidate.math, expectedMath)) {
        return {
          ok: false,
          error: 'Math text edits must set math.expression and math.display to the same content.',
        };
      }
    } else if (!sameJson(candidate.math, current.math)) {
      return { ok: false, error: '“math” is read-only in Source.' };
    }
    operations.push({
      op: 'replace_text',
      slideId: current.slideId,
      elementId: current.id,
      text: candidate.content,
      ...(sourceIdsChanged ? { sourceIds: [...sourceIds] } : {}),
    });
  } else if (!sameJson(candidate.math, current.math)) {
    return { ok: false, error: '“math” is read-only in Source.' };
  }

  const chartChanged = !sameJson(candidate.chart, current.chart);
  if (chartChanged) {
    if (current.kind !== 'chart') {
      return { ok: false, error: '“chart” can only be edited on a chart element.' };
    }
    const chartError = validateChart(candidate.chart);
    if (chartError) return { ok: false, error: chartError };
    const chart = candidate.chart as ChartData;
    operations.push({
      op: 'update_chart',
      slideId: current.slideId,
      elementId: current.id,
      chart,
    });
  }

  const imageResult = imageOperation(current, candidate, sourceIdsChanged);
  if ('error' in imageResult) return { ok: false, error: imageResult.error };
  if (imageResult.operation) operations.push(imageResult.operation);

  if (sourceIdsChanged && !contentChanged && !imageResult.operation) {
    return {
      ok: false,
      error: 'Source bindings can only change with a text/math content edit or an image update.',
    };
  }

  const visibilityResult = visibilityOperation(current, candidate, parsed);
  if ('error' in visibilityResult) return { ok: false, error: visibilityResult.error };
  if (visibilityResult.operation) operations.push(visibilityResult.operation);

  return { ok: true, operations };
}

function validateBoundingBox(value: unknown): string | null {
  if (!isRecord(value)) return '“bbox” must be an object.';
  const keys = Object.keys(value);
  if (keys.some((key) => !['x', 'y', 'width', 'height'].includes(key))) {
    return '“bbox” only supports x, y, width, and height.';
  }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      return `bbox.${key} must be a finite number.`;
    }
  }
  const x = value['x'] as number;
  const y = value['y'] as number;
  const width = value['width'] as number;
  const height = value['height'] as number;
  if (x < 0 || y < 0 || width < 0.01 || height < 0.01) {
    return 'bbox coordinates must be non-negative and dimensions must be at least 0.01.';
  }
  if (x > 1 || y > 1 || width > 1 || height > 1) {
    return 'bbox values must use normalized 0–1 coordinates.';
  }
  return null;
}

function validateStyle(value: unknown): string | null {
  if (!isRecord(value)) return '“style” must be an object.';
  for (const [key, entry] of Object.entries(value)) {
    if (!STYLE_KEYS.has(key as keyof ElementStyle)) return `Unsupported style field: ${key}.`;
    if (STRING_STYLE_KEYS.has(key as keyof ElementStyle)) {
      if (typeof entry !== 'string') return `style.${key} must be a string.`;
      continue;
    }
    if (key === 'textAlign') {
      if (entry !== 'left' && entry !== 'center' && entry !== 'right') {
        return 'style.textAlign must be left, center, or right.';
      }
      continue;
    }
    if (key === 'verticalAlign') {
      if (entry !== 'top' && entry !== 'middle' && entry !== 'bottom') {
        return 'style.verticalAlign must be top, middle, or bottom.';
      }
      continue;
    }
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      return `style.${key} must be a finite number.`;
    }
  }
  return null;
}

function changedStyleProperties(
  current: ElementStyle,
  candidate: ElementStyle,
): { properties: Partial<ElementStyle> } | { error: string } {
  const removed = Object.keys(current).filter(
    (key) => !Object.prototype.hasOwnProperty.call(candidate, key),
  );
  if (removed.length > 0) {
    return {
      error: `Style properties cannot be deleted with existing operations: ${removed.join(', ')}.`,
    };
  }
  const properties = Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) => current[key as keyof ElementStyle] !== value,
    ),
  ) as Partial<ElementStyle>;
  return { properties };
}

function validateSourceIds(value: unknown, validSourceIds?: ReadonlySet<string>): string | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return '“sourceIds” must be an array of strings.';
  }
  if (value.length > 64 || new Set(value).size !== value.length) {
    return '“sourceIds” supports at most 64 unique IDs.';
  }
  const unknown = validSourceIds ? value.filter((sourceId) => !validSourceIds.has(sourceId)) : [];
  return unknown.length > 0 ? `Unknown source binding: ${unknown.join(', ')}.` : null;
}

function validateChart(value: unknown): string | null {
  if (!isRecord(value)) return '“chart” must be a structured chart object.';
  const unknownChartKeys = Object.keys(value).filter(
    (key) => !['chartType', 'labels', 'series', 'unit', 'sourceId'].includes(key),
  );
  if (unknownChartKeys.length > 0) {
    return `Unsupported chart field: ${unknownChartKeys.join(', ')}.`;
  }
  const chartType = value['chartType'];
  const labels = value['labels'];
  const seriesList = value['series'];
  if (!['bar', 'line', 'area', 'donut'].includes(String(chartType))) {
    return 'chart.chartType must be bar, line, area, or donut.';
  }
  if (
    !Array.isArray(labels) ||
    labels.length < 1 ||
    labels.length > 24 ||
    labels.some((label) => typeof label !== 'string')
  ) {
    return 'Charts require 1–24 string labels.';
  }
  if (
    !Array.isArray(seriesList) ||
    seriesList.length < 1 ||
    seriesList.length > 6 ||
    seriesList.some((series) => !validChartSeries(series, labels.length))
  ) {
    return 'Charts require 1–6 named finite series aligned to the labels.';
  }
  if (value['unit'] !== undefined && typeof value['unit'] !== 'string') {
    return 'chart.unit must be a string.';
  }
  if (value['sourceId'] !== undefined && typeof value['sourceId'] !== 'string') {
    return 'chart.sourceId must be a string.';
  }
  return null;
}

function validChartSeries(value: unknown, labelCount: number): boolean {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !['name', 'values', 'color'].includes(key))) return false;
  return (
    typeof value['name'] === 'string' &&
    value['name'].trim().length > 0 &&
    Array.isArray(value['values']) &&
    value['values'].length === labelCount &&
    value['values'].every((entry) => typeof entry === 'number' && Number.isFinite(entry)) &&
    (value['color'] === undefined || typeof value['color'] === 'string')
  );
}

function imageOperation(
  current: SlideElement,
  candidate: Partial<SlideElement>,
  sourceIdsChanged: boolean,
): { operation: PatchOperation | null } | { error: string } {
  const imageFieldsChanged =
    candidate.imageUrl !== current.imageUrl ||
    candidate.altText !== current.altText ||
    !sameJson(candidate.image, current.image);
  if (!imageFieldsChanged && !sourceIdsChanged) return { operation: null };
  if (current.kind !== 'image') {
    if (imageFieldsChanged)
      return { error: 'Image fields can only be edited on an image element.' };
    return { operation: null };
  }
  if (!isRecord(candidate.image)) return { error: '“image” must be an image metadata object.' };
  if (
    Object.keys(candidate.image).some((key) => !['placeholder', 'credit', 'sourceId'].includes(key))
  ) {
    return { error: '“image” only supports placeholder, credit, and sourceId.' };
  }
  if (candidate.image.sourceId !== current.image?.sourceId) {
    return { error: 'image.sourceId is read-only in Source.' };
  }
  if (candidate.image.placeholder !== false) {
    return { error: 'An image update must set image.placeholder to false.' };
  }
  if (typeof candidate.imageUrl !== 'string') {
    return { error: 'An image update requires an embedded imageUrl.' };
  }
  if (
    !/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/iu.test(candidate.imageUrl) ||
    candidate.imageUrl.length > 700_000 ||
    candidate.imageUrl !== candidate.imageUrl.trim()
  ) {
    return { error: 'imageUrl must be an embedded PNG, JPEG, WebP, or GIF under 700 KB.' };
  }
  if (
    typeof candidate.altText !== 'string' ||
    candidate.altText.length < 1 ||
    candidate.altText.length > 320 ||
    candidate.altText !== candidate.altText.replace(/\s+/gu, ' ').trim()
  ) {
    return { error: 'altText must be normalized text between 1 and 320 characters.' };
  }
  if (
    candidate.image.credit !== undefined &&
    (typeof candidate.image.credit !== 'string' ||
      candidate.image.credit.length === 0 ||
      candidate.image.credit.length > 320 ||
      candidate.image.credit !== candidate.image.credit.trim())
  ) {
    return {
      error: 'image.credit must be trimmed text no longer than 320 characters; omit it to clear.',
    };
  }
  const operationChangesImage =
    candidate.imageUrl !== current.imageUrl ||
    candidate.altText !== current.altText ||
    candidate.image.credit !== current.image?.credit;
  if (!operationChangesImage) {
    return {
      error:
        'Source bindings or placeholder state cannot change without an image URL, alt text, or credit edit.',
    };
  }
  return {
    operation: {
      op: 'update_image',
      slideId: current.slideId,
      elementId: current.id,
      imageUrl: candidate.imageUrl,
      altText: candidate.altText,
      ...(candidate.image.credit ? { credit: candidate.image.credit } : {}),
      ...(sourceIdsChanged ? { sourceIds: [...(candidate.sourceIds ?? [])] } : {}),
    },
  };
}

function visibilityOperation(
  current: SlideElement,
  candidate: Partial<SlideElement>,
  parsed: Record<string, unknown>,
): { operation: PatchOperation | null } | { error: string } {
  const hasVisible = Object.prototype.hasOwnProperty.call(parsed, 'visible');
  if (!hasVisible) {
    if (current.visible !== undefined) {
      return { error: '“visible” cannot be deleted; set it to true or false.' };
    }
    return { operation: null };
  }
  if (typeof candidate.visible !== 'boolean') return { error: '“visible” must be a boolean.' };
  const currentVisible = current.visible ?? true;
  if (candidate.visible === currentVisible) {
    if (current.visible === undefined) {
      return { error: '“visible” is already true by default; omit it unless setting false.' };
    }
    return { operation: null };
  }
  return {
    operation: {
      op: 'set_visibility_v1',
      slideId: current.slideId,
      elementId: current.id,
      visible: candidate.visible,
    },
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
