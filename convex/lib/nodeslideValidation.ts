import {
  type BoundingBox,
  type DeckSnapshot,
  NODESLIDE_ELEMENT_SOURCE_LIMIT,
  NODESLIDE_GROUP_ID_LIMIT,
  NODESLIDE_GROUP_MEMBER_LIMIT,
  NODESLIDE_MIN_READABLE_FONT_SIZE,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type SlideElement,
  type ValidationIssue,
  type ValidationResult,
} from '../../shared/nodeslide';
import type { SignatureProfile } from '../../shared/nodeslideSignature';
import { onBrandIssues } from '../../shared/nodeslideSignatureApply';
import { nodeslideStableId } from './nodeslideIds';

export interface NodeSlideValidationOptions {
  signatureProfile?: SignatureProfile;
}

export function validateNodeSlideSnapshot(
  snapshot: DeckSnapshot,
  checkedAt: number,
  validationId?: string,
  options: NodeSlideValidationOptions = {},
): ValidationResult {
  const resolvedValidationId =
    validationId ??
    nodeslideStableId(
      'validation',
      snapshot.deck.id,
      String(snapshot.deck.version),
      options.signatureProfile?.source.digest ?? 'no-signature',
    );
  const issues: ValidationIssue[] = [];
  const addIssue = (issue: Omit<ValidationIssue, 'id'>, discriminator = String(issues.length)) => {
    issues.push({
      ...issue,
      id: nodeslideStableId(
        'issue',
        resolvedValidationId,
        issue.code,
        issue.slideId ?? '',
        issue.elementId ?? '',
        discriminator,
      ),
    });
  };

  if (snapshot.deck.schemaVersion !== NODESLIDE_SCHEMA_VERSION) {
    addIssue({
      severity: 'error',
      code: 'schema',
      message: `Unsupported schema version ${snapshot.deck.schemaVersion}.`,
    });
  }
  if (!snapshot.deck.id || !snapshot.deck.projectId || !snapshot.deck.title.trim()) {
    addIssue({
      severity: 'error',
      code: 'schema',
      message: 'Deck id, project id, and title are required.',
    });
  }
  if (!Number.isInteger(snapshot.deck.version) || snapshot.deck.version < 1) {
    addIssue({
      severity: 'error',
      code: 'schema',
      message: 'Deck version must be a positive integer.',
    });
  }

  const slideIds = snapshot.slides.map((slide) => slide.id);
  const uniqueSlideIds = new Set(slideIds);
  if (snapshot.slides.length === 0) {
    addIssue({
      severity: 'error',
      code: 'schema',
      message: 'Deck must contain at least one slide.',
    });
  }
  if (uniqueSlideIds.size !== slideIds.length) {
    addIssue({ severity: 'error', code: 'schema', message: 'Slide IDs must be unique.' });
  }
  if (!sameMembers(snapshot.deck.slideOrder, slideIds)) {
    addIssue({
      severity: 'error',
      code: 'schema',
      message: 'deck.slideOrder must contain every slide exactly once.',
    });
  }

  const sourceIds = new Set(snapshot.sources.map((source) => source.id));
  if (sourceIds.size !== snapshot.sources.length) {
    addIssue({ severity: 'error', code: 'source', message: 'Source IDs must be unique.' });
  }
  for (const source of snapshot.sources) {
    if (source.deckId !== snapshot.deck.id) {
      addIssue({
        severity: 'error',
        code: 'source',
        message: `Source ${source.id} belongs to another deck.`,
      });
    }
    if (!source.title.trim() || !source.citation.trim()) {
      addIssue({
        severity: 'warning',
        code: 'source',
        message: `Source ${source.id} needs both a title and citation.`,
      });
    }
  }

  const elementIds = snapshot.elements.map((element) => element.id);
  if (new Set(elementIds).size !== elementIds.length) {
    addIssue({ severity: 'error', code: 'schema', message: 'Element IDs must be unique.' });
  }
  const elementsBySlide = new Map<string, SlideElement[]>();
  for (const element of snapshot.elements) {
    const existing = elementsBySlide.get(element.slideId) ?? [];
    existing.push(element);
    elementsBySlide.set(element.slideId, existing);
  }

  for (const slide of snapshot.slides) {
    if (slide.deckId !== snapshot.deck.id) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Slide ${slide.id} belongs to another deck.`,
        slideId: slide.id,
      });
    }
    if (!slide.title.trim() || !slide.background.trim()) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Slide ${slide.id} requires a title and background.`,
        slideId: slide.id,
      });
    }
    if (!Number.isInteger(slide.version) || slide.version < 1) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Slide ${slide.id} has an invalid version.`,
        slideId: slide.id,
      });
    }
    const slideElements = elementsBySlide.get(slide.id) ?? [];
    if (slideElements.length === 0) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Slide ${slide.id} has no elements.`,
        slideId: slide.id,
      });
    }
    if (
      !sameMembers(
        slide.elementOrder,
        slideElements.map((element) => element.id),
      )
    ) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Slide ${slide.id} elementOrder is incomplete or contains duplicates.`,
        slideId: slide.id,
      });
    }

    for (const element of slideElements) {
      validateElement(element, slide.background, sourceIds, addIssue);
    }
    validateFlatGroups(slide.elementOrder, slideElements, slide.id, addIssue);
    validateCollisions(
      slideElements.filter((element) => element.visible !== false),
      slide.id,
      addIssue,
    );
  }

  for (const [slideId, orphaned] of elementsBySlide.entries()) {
    if (!uniqueSlideIds.has(slideId)) {
      for (const element of orphaned) {
        addIssue({
          severity: 'error',
          code: 'schema',
          message: `Element ${element.id} references unknown slide ${slideId}.`,
          slideId,
          elementId: element.id,
        });
      }
    }
  }

  const illustrativeSources = new Set(
    snapshot.sources
      .filter((source) =>
        /illustrative|example data|replace with measured|not for (?:external )?publication/i.test(
          `${source.title} ${source.citation}`,
        ),
      )
      .map((source) => source.id),
  );
  for (const element of snapshot.elements) {
    const referencedIllustrative = [
      ...element.sourceIds,
      ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ].filter((sourceId) => illustrativeSources.has(sourceId));
    if (referencedIllustrative.length === 0) continue;
    const slide = snapshot.slides.find((candidate) => candidate.id === element.slideId);
    const slideCopy = (elementsBySlide.get(element.slideId) ?? [])
      .map((candidate) => candidate.content ?? '')
      .join(' ');
    const visiblyDisclosed = /illustrative|example data|demo data|replace with measured/i.test(
      `${slideCopy} ${slide?.notes ?? ''}`,
    );
    if (!visiblyDisclosed) {
      addIssue(
        {
          severity: 'warning',
          code: 'source',
          message: `Element ${element.id} uses illustrative evidence without a visible slide or notes disclosure.`,
          slideId: element.slideId,
          elementId: element.id,
        },
        `illustrative:${element.id}`,
      );
    }
  }

  if (options.signatureProfile) {
    onBrandIssues(snapshot, options.signatureProfile).forEach((issue, index) => {
      addIssue(issue, `on-brand:${index}:${issue.code}`);
    });
  }

  const hasErrors = issues.some((issue) => issue.severity === 'error');
  const hasPublishBlocker = issues.some(
    (issue) =>
      issue.severity === 'error' ||
      (issue.severity === 'warning' &&
        (issue.code === 'source' ||
          issue.code === 'missing_asset' ||
          issue.code === 'export' ||
          issue.code === 'contrast' ||
          issue.code === 'font_size' ||
          issue.code.startsWith('on_brand_'))),
  );
  const hasCleanupIssue = issues.some((issue) => issue.severity !== 'info');
  return {
    id: resolvedValidationId,
    deckId: snapshot.deck.id,
    deckVersion: snapshot.deck.version,
    ok: !hasErrors,
    publishOk: !hasPublishBlocker,
    cleanOk: !hasCleanupIssue,
    issues,
    checkedAt,
    toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
  };
}

export function isNormalizedBoundingBox(bbox: BoundingBox): boolean {
  return (
    Number.isFinite(bbox.x) &&
    Number.isFinite(bbox.y) &&
    Number.isFinite(bbox.width) &&
    Number.isFinite(bbox.height) &&
    bbox.x >= 0 &&
    bbox.y >= 0 &&
    bbox.width > 0 &&
    bbox.height > 0 &&
    bbox.x <= 1 &&
    bbox.y <= 1 &&
    bbox.width <= 1 &&
    bbox.height <= 1 &&
    bbox.x + bbox.width <= 1 + Number.EPSILON &&
    bbox.y + bbox.height <= 1 + Number.EPSILON
  );
}

export function boundingBoxesIntersect(left: BoundingBox, right: BoundingBox): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function validateElement(
  element: SlideElement,
  slideBackground: string,
  sourceIds: ReadonlySet<string>,
  addIssue: (issue: Omit<ValidationIssue, 'id'>, discriminator?: string) => void,
) {
  if (element.sourceIds.length > NODESLIDE_ELEMENT_SOURCE_LIMIT) {
    addIssue({
      severity: 'error',
      code: 'source',
      message: `Element ${element.id} exceeds the source-reference limit.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if (
    element.groupId !== undefined &&
    (!element.groupId || element.groupId.length > NODESLIDE_GROUP_ID_LIMIT)
  ) {
    addIssue({
      severity: 'error',
      code: 'schema',
      message: `Element ${element.id} has invalid flat-group metadata.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if (!element.name.trim()) {
    addIssue({
      severity: 'error',
      code: 'schema',
      message: `Element ${element.id} requires a name.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if (!Number.isInteger(element.version) || element.version < 1) {
    addIssue({
      severity: 'error',
      code: 'schema',
      message: `Element ${element.id} has an invalid version.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if (!isNormalizedBoundingBox(element.bbox)) {
    addIssue({
      severity: 'error',
      code: 'overflow',
      message: `Element ${element.id} has a non-normalized or overflowing bounding box.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if ((element.kind === 'text' || element.kind === 'math') && !element.content?.trim()) {
    addIssue({
      severity: 'warning',
      code: 'schema',
      message: `${element.kind === 'math' ? 'Math' : 'Text'} element ${element.id} is empty.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if (
    (element.kind === 'text' || element.kind === 'math') &&
    element.style.fontSize !== undefined &&
    element.style.fontSize < NODESLIDE_MIN_READABLE_FONT_SIZE &&
    element.role !== 'footer' &&
    element.role !== 'page_number'
  ) {
    addIssue({
      severity: 'warning',
      code: 'font_size',
      message: `Text element ${element.id} is below the ${NODESLIDE_MIN_READABLE_FONT_SIZE}pt readability floor.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if (
    (element.kind === 'text' || element.kind === 'math') &&
    element.style.color !== undefined &&
    contrastRatio(element.style.color, element.style.fill ?? slideBackground) !== null
  ) {
    const ratio = contrastRatio(element.style.color, element.style.fill ?? slideBackground);
    const largeText =
      (element.style.fontSize ?? 16) >= 18 ||
      ((element.style.fontSize ?? 16) >= 14 && (element.style.fontWeight ?? 400) >= 700);
    const minimum = largeText ? 3 : 4.5;
    if (ratio !== null && ratio < minimum) {
      addIssue({
        severity: 'warning',
        code: 'contrast',
        message: `Text element ${element.id} has ${ratio.toFixed(2)}:1 contrast; target at least ${minimum}:1.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
  }
  if (
    element.kind === 'image' &&
    !element.imageUrl?.trim() &&
    element.image?.placeholder !== true
  ) {
    addIssue({
      severity: 'error',
      code: 'missing_asset',
      message: `Image element ${element.id} has no asset URL.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if (element.kind === 'math') {
    const math = element.math;
    if (!math?.expression.trim()) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Math element ${element.id} has no structured expression.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    } else if (math.expression.length > 4_000) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Math element ${element.id} exceeds the expression limit.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    } else if ((math.variables ?? []).some((variable) => !Number.isFinite(variable.value))) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Math element ${element.id} contains a non-finite variable value.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (math?.sourceId && !sourceIds.has(math.sourceId)) {
      addIssue({
        severity: 'error',
        code: 'source',
        message: `Math element ${element.id} references unknown source ${math.sourceId}.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
  }
  if (
    element.kind === 'image' &&
    element.image?.sourceId &&
    !sourceIds.has(element.image.sourceId)
  ) {
    addIssue({
      severity: 'error',
      code: 'source',
      message: `Image element ${element.id} references unknown source ${element.image.sourceId}.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if (element.kind === 'image' && !element.altText?.trim()) {
    addIssue({
      severity: 'warning',
      code: 'missing_asset',
      message: `Image element ${element.id} needs alt text.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if (element.kind === 'chart') {
    const chart = element.chart;
    if (!chart || chart.labels.length === 0 || chart.series.length === 0) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Chart element ${element.id} has no plottable data.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    } else if (chart.series.some((series) => series.values.length !== chart.labels.length)) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Chart element ${element.id} has mismatched label and series lengths.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (chart?.sourceId && !sourceIds.has(chart.sourceId)) {
      addIssue({
        severity: 'error',
        code: 'source',
        message: `Chart element ${element.id} references unknown source ${chart.sourceId}.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
  }
  if (element.kind === 'video') {
    const video = element.video;
    if (!video?.url.trim()) {
      addIssue({
        severity: 'error',
        code: 'missing_asset',
        message: `Video element ${element.id} has no media URL.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    } else if (!isSafeMediaUrl(video.url, 'video')) {
      addIssue({
        severity: 'error',
        code: 'missing_asset',
        message: `Video element ${element.id} uses an unsupported media URL.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (video?.posterUrl && !isSafeMediaUrl(video.posterUrl, 'image')) {
      addIssue({
        severity: 'error',
        code: 'missing_asset',
        message: `Video element ${element.id} uses an unsupported poster URL.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (video?.captionsUrl && !isSafeCaptionUrl(video.captionsUrl)) {
      addIssue({
        severity: 'error',
        code: 'missing_asset',
        message: `Video element ${element.id} uses an unsupported caption URL.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (video?.captionsLanguage && video.captionsLanguage.trim().length > 32) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Video element ${element.id} has an invalid caption language.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (
      video?.startAtSeconds !== undefined &&
      (!Number.isFinite(video.startAtSeconds) || video.startAtSeconds < 0)
    ) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Video element ${element.id} has an invalid start time.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (
      video?.endAtSeconds !== undefined &&
      (!Number.isFinite(video.endAtSeconds) || video.endAtSeconds <= (video.startAtSeconds ?? 0))
    ) {
      addIssue({
        severity: 'error',
        code: 'schema',
        message: `Video element ${element.id} has an invalid end time.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
  }
  for (const sourceId of element.sourceIds) {
    if (!sourceIds.has(sourceId)) {
      addIssue({
        severity: 'error',
        code: 'source',
        message: `Element ${element.id} references unknown source ${sourceId}.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
  }
  if (element.exportCapabilities.length === 0) {
    addIssue({
      severity: 'warning',
      code: 'export',
      message: `Element ${element.id} declares no export capability.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
}

function isSafeMediaUrl(value: string, kind: 'image' | 'video'): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('https://')) return true;
  return normalized.startsWith(`data:${kind}/`);
}

function isSafeCaptionUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('https://') || normalized.startsWith('data:text/vtt');
}

function validateFlatGroups(
  elementOrder: readonly string[],
  elements: readonly SlideElement[],
  slideId: string,
  addIssue: (issue: Omit<ValidationIssue, 'id'>, discriminator?: string) => void,
): void {
  const groups = new Map<string, string[]>();
  for (const element of elements) {
    if (!element.groupId) continue;
    const members = groups.get(element.groupId) ?? [];
    members.push(element.id);
    groups.set(element.groupId, members);
  }
  for (const [groupId, members] of groups) {
    const indexes = members
      .map((id) => elementOrder.indexOf(id))
      .sort((left, right) => left - right);
    const contiguous = indexes.every(
      (value, index) => index === 0 || value === (indexes[index - 1] ?? value) + 1,
    );
    if (members.length < 2 || members.length > NODESLIDE_GROUP_MEMBER_LIMIT || !contiguous) {
      addIssue(
        {
          severity: 'error',
          code: 'schema',
          message: `Flat group ${groupId} must contain 2-${NODESLIDE_GROUP_MEMBER_LIMIT} contiguous same-slide elements.`,
          slideId,
        },
        `group:${groupId}`,
      );
    }
  }
}

function validateCollisions(
  elements: readonly SlideElement[],
  slideId: string,
  addIssue: (issue: Omit<ValidationIssue, 'id'>, discriminator?: string) => void,
) {
  const contentElements = elements.filter(
    (element) =>
      element.kind !== 'shape' &&
      element.kind !== 'connector' &&
      element.role !== 'footer' &&
      element.role !== 'page_number',
  );
  for (let leftIndex = 0; leftIndex < contentElements.length; leftIndex += 1) {
    const left = contentElements[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < contentElements.length; rightIndex += 1) {
      const right = contentElements[rightIndex];
      if (!right) continue;
      const overlap = overlapRatio(left.bbox, right.bbox);
      if (overlap >= 0.35) {
        addIssue(
          {
            severity: 'warning',
            code: 'collision',
            message: `Elements ${left.id} and ${right.id} overlap by ${Math.round(overlap * 100)}% of the smaller region.`,
            slideId,
            elementId: right.id,
          },
          `${left.id}:${right.id}`,
        );
      }
    }
  }
}

function overlapRatio(left: BoundingBox, right: BoundingBox): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const overlap = width * height;
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 ? overlap / smallerArea : 0;
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  if (leftSet.size !== left.length) return false;
  return right.every((value) => leftSet.has(value));
}

function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  if (!fg || !bg) return null;
  const foregroundLuminance = relativeLuminance(fg);
  const backgroundLuminance = relativeLuminance(bg);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHexColor(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, '');
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const convert = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * convert(red) + 0.7152 * convert(green) + 0.0722 * convert(blue);
}
