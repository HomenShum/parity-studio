import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type Slide,
  type SlideElement,
  type ValidationIssue,
  type ValidationResult,
} from '../../../../shared/nodeslide';
import type { SignatureProfile } from '../../../../shared/nodeslideSignature';
import { onBrandIssues } from '../../../../shared/nodeslideSignatureApply';
import { getElementCapability } from './capabilities';
import {
  MIN_READABLE_FONT_SIZE,
  boxContains,
  contrastRatio,
  estimateTextFit,
  intersectionRatio,
  isStableId,
  orderedElements,
  stableHash,
} from './utils';

type IssueDraft = Omit<ValidationIssue, 'id'>;

const SOURCE_WORTHY_ROLE = /(?:citation|data|evidence|metric|stat|source)/i;
const QUANTITATIVE_CLAIM =
  /(?:\b\d+(?:\.\d+)?%|[$€£¥]\s?\d|\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?\s?(?:million|billion|trillion|mn|bn)\b)/i;

function makeIssue(snapshot: DeckSnapshot, draft: IssueDraft): ValidationIssue {
  const target = `${draft.slideId ?? 'deck'}:${draft.elementId ?? 'deck'}`;
  return {
    id: `issue:${snapshot.deck.id}:${draft.code}:${stableHash(`${target}:${draft.message}`)}`,
    severity: draft.severity,
    code: draft.code,
    message: draft.message,
    ...(draft.slideId ? { slideId: draft.slideId } : {}),
    ...(draft.elementId ? { elementId: draft.elementId } : {}),
  };
}

function addIssue(issues: ValidationIssue[], snapshot: DeckSnapshot, draft: IssueDraft): void {
  issues.push(makeIssue(snapshot, draft));
}

function reportStableId(
  issues: ValidationIssue[],
  snapshot: DeckSnapshot,
  label: string,
  id: string,
  target: Pick<IssueDraft, 'slideId' | 'elementId'> = {},
): void {
  if (isStableId(id)) return;
  addIssue(issues, snapshot, {
    severity: 'error',
    code: 'schema',
    message: `${label} ID "${id}" must be non-empty and use only stable URL-safe ID characters.`,
    ...target,
  });
}

function reportDuplicateIds(
  issues: ValidationIssue[],
  snapshot: DeckSnapshot,
  label: string,
  ids: readonly string[],
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `${label} ID "${id}" is not unique.`,
      });
    }
    seen.add(id);
  }
}

function validateDeckStructure(snapshot: DeckSnapshot, issues: ValidationIssue[]): void {
  reportStableId(issues, snapshot, 'Deck', snapshot.deck.id);
  if (snapshot.deck.schemaVersion !== NODESLIDE_SCHEMA_VERSION) {
    addIssue(issues, snapshot, {
      severity: 'error',
      code: 'schema',
      message: `Unsupported schema version "${snapshot.deck.schemaVersion}"; expected "${NODESLIDE_SCHEMA_VERSION}".`,
    });
  }

  reportDuplicateIds(
    issues,
    snapshot,
    'Slide',
    snapshot.slides.map((slide) => slide.id),
  );
  reportDuplicateIds(
    issues,
    snapshot,
    'Element',
    snapshot.elements.map((element) => element.id),
  );
  reportDuplicateIds(
    issues,
    snapshot,
    'Source',
    snapshot.sources.map((source) => source.id),
  );

  const slidesById = new Map(snapshot.slides.map((slide) => [slide.id, slide]));
  const slideOrderSeen = new Set<string>();
  for (const slideId of snapshot.deck.slideOrder) {
    if (slideOrderSeen.has(slideId)) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Slide order contains duplicate ID "${slideId}".`,
      });
    }
    slideOrderSeen.add(slideId);
    if (!slidesById.has(slideId)) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Slide order references missing slide "${slideId}".`,
      });
    }
  }

  for (const slide of snapshot.slides) {
    reportStableId(issues, snapshot, 'Slide', slide.id, { slideId: slide.id });
    if (slide.deckId !== snapshot.deck.id) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Slide "${slide.id}" belongs to deck "${slide.deckId}", not "${snapshot.deck.id}".`,
        slideId: slide.id,
      });
    }
    if (!slideOrderSeen.has(slide.id)) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Slide "${slide.id}" is missing from deck.slideOrder.`,
        slideId: slide.id,
      });
    }
    validateElementOrder(snapshot, slide, issues);
  }

  for (const source of snapshot.sources) {
    reportStableId(issues, snapshot, 'Source', source.id);
    if (source.deckId !== snapshot.deck.id) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Source "${source.id}" belongs to another deck.`,
      });
    }
  }
}

function validateElementOrder(
  snapshot: DeckSnapshot,
  slide: Slide,
  issues: ValidationIssue[],
): void {
  const elements = snapshot.elements.filter((element) => element.slideId === slide.id);
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const seen = new Set<string>();
  for (const elementId of slide.elementOrder) {
    if (seen.has(elementId)) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Element order contains duplicate ID "${elementId}".`,
        slideId: slide.id,
        elementId,
      });
    }
    seen.add(elementId);
    if (!elementsById.has(elementId)) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Element order references missing or cross-slide element "${elementId}".`,
        slideId: slide.id,
        elementId,
      });
    }
  }
  for (const element of elements) {
    if (!seen.has(element.id)) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Element "${element.id}" is missing from slide.elementOrder.`,
        slideId: slide.id,
        elementId: element.id,
      });
    }
  }
}

function validateGeometry(
  snapshot: DeckSnapshot,
  element: SlideElement,
  issues: ValidationIssue[],
): void {
  const { x, y, width, height } = element.bbox;
  const values = [x, y, width, height];
  const withinBounds =
    values.every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 + Number.EPSILON &&
    y + height <= 1 + Number.EPSILON;
  if (!withinBounds) {
    addIssue(issues, snapshot, {
      severity: 'error',
      code: 'schema',
      message: `Element "${element.id}" geometry must be finite, positive, and contained within normalized slide bounds.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  if (!Number.isFinite(element.rotation)) {
    addIssue(issues, snapshot, {
      severity: 'error',
      code: 'schema',
      message: `Element "${element.id}" rotation must be finite.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
}

function validateElementContent(
  snapshot: DeckSnapshot,
  element: SlideElement,
  issues: ValidationIssue[],
): void {
  if (
    element.kind === 'image' &&
    !element.imageUrl?.trim() &&
    element.image?.placeholder !== true
  ) {
    addIssue(issues, snapshot, {
      severity: 'error',
      code: 'missing_asset',
      message: `Image element "${element.id}" has no imageUrl.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }

  if (element.kind === 'math') {
    if (!element.math?.expression.trim()) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Math element "${element.id}" has no structured expression.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    } else if (element.math.expression.length > 4_000) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Math element "${element.id}" exceeds the expression limit.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    } else if (
      (element.math.variables ?? []).some((variable) => !Number.isFinite(variable.value))
    ) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Math element "${element.id}" contains a non-finite variable value.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
  }

  if (element.kind === 'chart') {
    if (!element.chart) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Chart element "${element.id}" has no chart data.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    } else {
      for (const series of element.chart.series) {
        if (
          series.values.length !== element.chart.labels.length ||
          !series.values.every(Number.isFinite)
        ) {
          addIssue(issues, snapshot, {
            severity: 'error',
            code: 'schema',
            message: `Chart series "${series.name}" must contain one finite value per label.`,
            slideId: element.slideId,
            elementId: element.id,
          });
        }
      }
    }
  }

  if (element.kind === 'video') {
    if (!element.video?.url.trim()) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'missing_asset',
        message: `Video element "${element.id}" has no media URL.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    } else if (!isSafeMediaUrl(element.video.url, 'video')) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'missing_asset',
        message: `Video element "${element.id}" uses an unsupported media URL.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (element.video?.posterUrl && !isSafeMediaUrl(element.video.posterUrl, 'image')) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'missing_asset',
        message: `Video element "${element.id}" uses an unsupported poster URL.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (element.video?.captionsUrl && !isSafeCaptionUrl(element.video.captionsUrl)) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'missing_asset',
        message: `Video element "${element.id}" uses an unsupported caption URL.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (element.video?.captionsLanguage && element.video.captionsLanguage.trim().length > 32) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Video element "${element.id}" has an invalid caption language.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (
      element.video?.startAtSeconds !== undefined &&
      (!Number.isFinite(element.video.startAtSeconds) || element.video.startAtSeconds < 0)
    ) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Video element "${element.id}" has an invalid start time.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    if (
      element.video?.endAtSeconds !== undefined &&
      (!Number.isFinite(element.video.endAtSeconds) ||
        element.video.endAtSeconds <= (element.video.startAtSeconds ?? 0))
    ) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Video element "${element.id}" has an invalid end time.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
  }

  const textLikeContent =
    element.kind === 'math' ? element.math?.expression : element.content?.trim();
  if (
    (element.kind === 'text' || element.kind === 'shape' || element.kind === 'math') &&
    textLikeContent
  ) {
    const fit = estimateTextFit({ ...element, content: textLikeContent });
    if (fit.overflow) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'overflow',
        message: `Text is estimated at ${fit.estimatedLines} lines but "${element.id}" fits about ${fit.availableLines}.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
  }
}

function textBackground(snapshot: DeckSnapshot, slide: Slide, element: SlideElement): string {
  if (element.style.fill) return element.style.fill;
  const elements = orderedElements(snapshot, slide);
  const textIndex = elements.findIndex((candidate) => candidate.id === element.id);
  const containingShape = elements
    .slice(0, Math.max(0, textIndex))
    .reverse()
    .find(
      (candidate) =>
        candidate.kind === 'shape' &&
        candidate.style.fill &&
        boxContains(candidate.bbox, element.bbox),
    );
  return containingShape?.style.fill ?? slide.background;
}

function validateTextQuality(
  snapshot: DeckSnapshot,
  slide: Slide,
  element: SlideElement,
  issues: ValidationIssue[],
): void {
  if ((element.kind !== 'text' && element.kind !== 'math') || !element.content?.trim()) return;
  const fontSize = element.style.fontSize ?? 24;
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    addIssue(issues, snapshot, {
      severity: 'error',
      code: 'schema',
      message: `Text element "${element.id}" has an invalid font size.`,
      slideId: slide.id,
      elementId: element.id,
    });
  } else if (
    fontSize < MIN_READABLE_FONT_SIZE &&
    element.role !== 'footer' &&
    element.role !== 'page_number'
  ) {
    addIssue(issues, snapshot, {
      severity: 'warning',
      code: 'font_size',
      message: `Text element "${element.id}" uses ${fontSize}pt type; use at least ${MIN_READABLE_FONT_SIZE}pt.`,
      slideId: slide.id,
      elementId: element.id,
    });
  }

  const fontFamily = element.style.fontFamily ?? snapshot.deck.theme.typography.body;
  if (!fontFamily.trim()) {
    addIssue(issues, snapshot, {
      severity: 'warning',
      code: 'font_size',
      message: `Text element "${element.id}" has no usable font family.`,
      slideId: slide.id,
      elementId: element.id,
    });
  }

  const foreground = element.style.color ?? snapshot.deck.theme.colors.ink;
  const background = textBackground(snapshot, slide, element);
  const ratio = contrastRatio(foreground, background);
  const isLarge = fontSize >= 24 || (fontSize >= 18 && (element.style.fontWeight ?? 400) >= 700);
  const minimumRatio = isLarge ? 3 : 4.5;
  if (ratio === null) {
    addIssue(issues, snapshot, {
      severity: 'warning',
      code: 'contrast',
      message: `Contrast for "${element.id}" cannot be evaluated from its color values.`,
      slideId: slide.id,
      elementId: element.id,
    });
  } else if (ratio < minimumRatio) {
    addIssue(issues, snapshot, {
      severity: 'warning',
      code: 'contrast',
      message: `Text contrast for "${element.id}" is ${ratio.toFixed(2)}:1; target at least ${minimumRatio}:1.`,
      slideId: slide.id,
      elementId: element.id,
    });
  }
}

function sourceWorthy(element: SlideElement): boolean {
  if (element.kind === 'chart' || element.kind === 'math') return true;
  if (element.kind !== 'text') return false;
  return (
    SOURCE_WORTHY_ROLE.test(element.role ?? '') || QUANTITATIVE_CLAIM.test(element.content ?? '')
  );
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

function validateSources(
  snapshot: DeckSnapshot,
  element: SlideElement,
  issues: ValidationIssue[],
): void {
  const sourcesById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const sourceIds = new Set(sourcesById.keys());
  for (const sourceId of element.sourceIds) {
    if (!sourceIds.has(sourceId)) {
      addIssue(issues, snapshot, {
        severity: 'warning',
        code: 'source',
        message: `Element "${element.id}" references missing source "${sourceId}".`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
  }
  if (sourceWorthy(element) && element.sourceIds.length === 0) {
    addIssue(issues, snapshot, {
      severity: 'warning',
      code: 'source',
      message: `Element "${element.id}" contains a quantitative claim or chart without a source.`,
      slideId: element.slideId,
      elementId: element.id,
    });
  }
  const illustrative = [
    ...element.sourceIds,
    ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ...(element.math?.sourceId ? [element.math.sourceId] : []),
    ...(element.image?.sourceId ? [element.image.sourceId] : []),
  ]
    .map((sourceId) => sourcesById.get(sourceId))
    .filter((source): source is NonNullable<typeof source> =>
      Boolean(
        source &&
          /illustrative|example data|replace with measured|not for (?:external )?publication/i.test(
            `${source.title} ${source.citation}`,
          ),
      ),
    );
  if (illustrative.length > 0) {
    const slide = snapshot.slides.find((candidate) => candidate.id === element.slideId);
    const slideCopy = snapshot.elements
      .filter((candidate) => candidate.slideId === element.slideId)
      .map((candidate) => candidate.content ?? '')
      .join(' ');
    if (
      !/illustrative|example data|demo data|replace with measured/i.test(
        `${slideCopy} ${slide?.notes ?? ''}`,
      )
    ) {
      addIssue(issues, snapshot, {
        severity: 'warning',
        code: 'source',
        message: `Element "${element.id}" uses illustrative evidence without a visible slide or notes disclosure.`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
  }
}

function isCollisionCandidate(element: SlideElement): boolean {
  if (element.kind === 'connector') return false;
  if (element.role === 'footer' || element.role === 'page_number') return false;
  if (/(?:background|decorative|decoration|watermark)/i.test(element.role ?? '')) return false;
  return element.kind !== 'shape' || Boolean(element.content?.trim());
}

function shouldIgnoreContainedShape(first: SlideElement, second: SlideElement): boolean {
  if (first.kind === 'shape' && boxContains(first.bbox, second.bbox)) return true;
  if (second.kind === 'shape' && boxContains(second.bbox, first.bbox)) return true;
  return false;
}

function validateCollisions(snapshot: DeckSnapshot, slide: Slide, issues: ValidationIssue[]): void {
  const elements = orderedElements(snapshot, slide).filter(isCollisionCandidate);
  for (let firstIndex = 0; firstIndex < elements.length; firstIndex += 1) {
    const first = elements[firstIndex];
    if (!first) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < elements.length; secondIndex += 1) {
      const second = elements[secondIndex];
      if (!second || shouldIgnoreContainedShape(first, second)) continue;
      const overlap = intersectionRatio(first.bbox, second.bbox);
      if (overlap < 0.2) continue;
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'collision',
        message: `Important elements "${first.id}" and "${second.id}" overlap by ${Math.round(overlap * 100)}% of the smaller element.`,
        slideId: slide.id,
        elementId: second.id,
      });
    }
  }
}

function validateExportCapabilities(
  snapshot: DeckSnapshot,
  element: SlideElement,
  issues: ValidationIssue[],
): void {
  const report = getElementCapability(element);
  if (report.warnings.length === 0) return;
  addIssue(issues, snapshot, {
    severity: 'warning',
    code: 'export',
    message: report.warnings.join(' '),
    slideId: element.slideId,
    elementId: element.id,
  });
}

function sortIssues(snapshot: DeckSnapshot, issues: ValidationIssue[]): ValidationIssue[] {
  const severityOrder: Record<ValidationIssue['severity'], number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  const slideOrder = new Map(snapshot.deck.slideOrder.map((id, index) => [id, index]));
  const elementOrder = new Map<string, number>();
  for (const slide of snapshot.slides) {
    slide.elementOrder.forEach((id, index) => elementOrder.set(id, index));
  }
  return issues.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      (slideOrder.get(left.slideId ?? '') ?? Number.MAX_SAFE_INTEGER) -
        (slideOrder.get(right.slideId ?? '') ?? Number.MAX_SAFE_INTEGER) ||
      (elementOrder.get(left.elementId ?? '') ?? Number.MAX_SAFE_INTEGER) -
        (elementOrder.get(right.elementId ?? '') ?? Number.MAX_SAFE_INTEGER) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

export interface ValidateSnapshotOptions {
  signatureProfile?: SignatureProfile;
}

export function validateSnapshot(
  snapshot: DeckSnapshot,
  options: ValidateSnapshotOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  validateDeckStructure(snapshot, issues);
  const slidesById = new Map(snapshot.slides.map((slide) => [slide.id, slide]));

  for (const element of snapshot.elements) {
    reportStableId(issues, snapshot, 'Element', element.id, {
      slideId: element.slideId,
      elementId: element.id,
    });
    const slide = slidesById.get(element.slideId);
    if (!slide) {
      addIssue(issues, snapshot, {
        severity: 'error',
        code: 'schema',
        message: `Element "${element.id}" references missing slide "${element.slideId}".`,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    validateGeometry(snapshot, element, issues);
    validateElementContent(snapshot, element, issues);
    validateSources(snapshot, element, issues);
    validateExportCapabilities(snapshot, element, issues);
    if (slide) validateTextQuality(snapshot, slide, element, issues);
  }

  for (const slide of snapshot.slides) validateCollisions(snapshot, slide, issues);

  if (options.signatureProfile) {
    for (const issue of onBrandIssues(snapshot, options.signatureProfile)) {
      addIssue(issues, snapshot, issue);
    }
  }

  const sortedIssues = sortIssues(snapshot, issues);
  const hasBlockingIssue = sortedIssues.some(
    (issue) =>
      issue.severity === 'error' ||
      (issue.severity === 'warning' &&
        (['source', 'missing_asset', 'export', 'contrast', 'font_size'].includes(issue.code) ||
          issue.code.startsWith('on_brand_'))),
  );
  const hasRepairableIssue = sortedIssues.some((issue) => issue.severity === 'warning');
  const hasCompilationIssue = sortedIssues.some(
    (issue) => issue.severity === 'error' && (issue.code === 'schema' || issue.code === 'scope'),
  );
  const issueFingerprint = stableHash(sortedIssues.map((issue) => issue.id).join('|'));

  return {
    id: `validation:${snapshot.deck.id}:v${snapshot.deck.version}:${issueFingerprint}`,
    deckId: snapshot.deck.id,
    deckVersion: snapshot.deck.version,
    ok: !hasCompilationIssue,
    publishOk: !hasBlockingIssue,
    cleanOk: !hasBlockingIssue && !hasRepairableIssue,
    issues: sortedIssues,
    checkedAt: Number.isFinite(snapshot.deck.updatedAt) ? snapshot.deck.updatedAt : 0,
    toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
  };
}
