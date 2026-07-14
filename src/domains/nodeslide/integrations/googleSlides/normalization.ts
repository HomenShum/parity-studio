import type { ElementStyle } from '../../../../../shared/nodeslide';
import type {
  NormalizedPresentationElement,
  NormalizedPresentationSlide,
  NormalizedPresentationState,
  SyncDiagnostic,
} from '../syncContracts';
import type {
  GoogleAffineTransform,
  GoogleDimension,
  GoogleOpaqueColor,
  GooglePage,
  GooglePageElement,
  GoogleSlidesNormalizationHooks,
  GoogleSlidesPresentation,
  GoogleTextElement,
} from './types';

export const EMU_PER_POINT = 12_700;
const EMU_PER_PIXEL = 9_525;
const DEFAULT_PAGE_WIDTH_EMU = 12_192_000;
const DEFAULT_PAGE_HEIGHT_EMU = 6_858_000;

export interface GoogleSlidesNormalizationResult {
  presentation: NormalizedPresentationState;
  diagnostics: SyncDiagnostic[];
}

export function normalizeGoogleSlidesPresentation(
  source: GoogleSlidesPresentation,
  hooks: GoogleSlidesNormalizationHooks = {},
): GoogleSlidesNormalizationResult {
  const diagnostics: SyncDiagnostic[] = [];
  const presentationId = requiredId(source.presentationId, 'presentationId');
  const pageWidthEmu = dimensionToEmu(source.pageSize?.width) ?? DEFAULT_PAGE_WIDTH_EMU;
  const pageHeightEmu = dimensionToEmu(source.pageSize?.height) ?? DEFAULT_PAGE_HEIGHT_EMU;

  const slides = (source.slides ?? []).map((slide, slideIndex) => {
    const remoteId = requiredId(slide.objectId, `slides[${slideIndex}].objectId`);
    const context = { presentation: source, slide, slideIndex };
    const defaultTitle = inferSlideTitle(slide, slideIndex);
    const notes = inferSpeakerNotes(slide);
    const elements = flattenPageElements(slide.pageElements ?? []).flatMap(
      ({ element, groupLossy }, elementIndex) => {
        const normalized = normalizeElement(
          element,
          remoteId,
          pageWidthEmu,
          pageHeightEmu,
          groupLossy,
          diagnostics,
        );
        if (!normalized) return [];
        const hooked = hooks.normalizeElement?.({ ...context, element, elementIndex }, normalized);
        return hooked === null ? [] : [hooked ?? normalized];
      },
    );
    const normalizedNotes = hooks.normalizeSpeakerNotes?.(context, notes) ?? notes;
    let normalized: NormalizedPresentationSlide = {
      remoteId,
      title: hooks.normalizeSlideTitle?.(context, defaultTitle) ?? defaultTitle,
      background: pageBackground(slide) ?? '#ffffff',
      elements,
      ...(normalizedNotes !== undefined ? { notes: normalizedNotes } : {}),
    };
    normalized = hooks.normalizeSlide?.(context, normalized) ?? normalized;
    return normalized;
  });

  const presentation: NormalizedPresentationState = {
    provider: 'google_slides',
    remotePresentationId: presentationId,
    title: source.title?.trim() || 'Untitled presentation',
    pageWidthEmu,
    pageHeightEmu,
    slides,
    ...(source.revisionId ? { revisionId: source.revisionId } : {}),
  };
  if (!source.revisionId) {
    diagnostics.push({
      code: 'google_revision_unavailable',
      severity: 'warning',
      message:
        'presentations.get did not return revisionId. Google only returns it with edit access, so outbound writes are disabled.',
    });
  }
  return { presentation, diagnostics };
}

function normalizeElement(
  element: GooglePageElement,
  remoteSlideId: string,
  pageWidthEmu: number,
  pageHeightEmu: number,
  groupLossy: boolean,
  diagnostics: SyncDiagnostic[],
): NormalizedPresentationElement | null {
  if (!element.objectId) {
    diagnostics.push({
      code: 'google_element_without_object_id',
      severity: 'warning',
      message: `Ignored a page element on ${remoteSlideId} because it has no objectId.`,
      remoteId: remoteSlideId,
    });
    return null;
  }

  const geometry = normalizedGeometry(element, pageWidthEmu, pageHeightEmu);
  const rawKind = googleElementKind(element);
  const text = shapeText(element);
  const style = elementStyle(element);
  const kind = normalizedKind(element, text);
  const lossy = groupLossy || geometry.lossy || kind === 'unsupported';
  if (lossy) {
    diagnostics.push({
      code: 'google_element_lossy_normalization',
      severity: 'warning',
      message: `Element ${element.objectId} (${rawKind}) cannot be represented losslessly in NodeSlide.`,
      remoteId: element.objectId,
    });
  }

  return {
    remoteId: element.objectId,
    remoteSlideId,
    kind,
    name: element.title?.trim() || `${friendlyKind(rawKind)} ${element.objectId}`,
    bbox: geometry.bbox,
    rotation: geometry.rotation,
    intrinsicWidthEmu: geometry.intrinsicWidthEmu,
    intrinsicHeightEmu: geometry.intrinsicHeightEmu,
    style,
    rawKind,
    writable: !groupLossy && kind !== 'unsupported' && rawKind !== 'table',
    lossy,
    ...(text !== undefined ? { content: text } : {}),
    // contentUrl is account-bound and short-lived; only retain the insertion source URL.
    ...(element.image?.sourceUrl?.trim() ? { imageUrl: element.image.sourceUrl } : {}),
    ...(element.description ? { altText: element.description } : {}),
  };
}

function normalizedKind(
  element: GooglePageElement,
  text: string | undefined,
): NormalizedPresentationElement['kind'] {
  if (element.shape) return text !== undefined ? 'text' : 'shape';
  if (element.image) return 'image';
  if (element.video) return 'video';
  if (element.line) return 'connector';
  if (element.sheetsChart) return 'chart';
  if (element.wordArt) return 'text';
  return 'unsupported';
}

function normalizedGeometry(
  element: GooglePageElement,
  pageWidthEmu: number,
  pageHeightEmu: number,
): {
  bbox: { x: number; y: number; width: number; height: number };
  rotation: number;
  intrinsicWidthEmu: number;
  intrinsicHeightEmu: number;
  lossy: boolean;
} {
  const transform = element.transform ?? {};
  const widthEmu = dimensionToEmu(element.size?.width) ?? 1;
  const heightEmu = dimensionToEmu(element.size?.height) ?? 1;
  const scaleX = finiteOr(transform.scaleX, 1);
  const scaleY = finiteOr(transform.scaleY, 1);
  const shearX = finiteOr(transform.shearX, 0);
  const shearY = finiteOr(transform.shearY, 0);
  const translateX = transformDistanceToEmu(transform.translateX, transform);
  const translateY = transformDistanceToEmu(transform.translateY, transform);
  const visualWidth = Math.abs(widthEmu * scaleX);
  const visualHeight = Math.abs(heightEmu * scaleY);
  const rotation = (Math.atan2(shearY, scaleX) * 180) / Math.PI;
  return {
    bbox: {
      x: clamp01(translateX / pageWidthEmu),
      y: clamp01(translateY / pageHeightEmu),
      width: clampPositive(visualWidth / pageWidthEmu),
      height: clampPositive(visualHeight / pageHeightEmu),
    },
    rotation: Number.isFinite(rotation) ? rotation : 0,
    intrinsicWidthEmu: widthEmu,
    intrinsicHeightEmu: heightEmu,
    lossy: Math.abs(shearX) > 1e-9 || Math.abs(shearY) > 1e-9,
  };
}

function elementStyle(element: GooglePageElement): ElementStyle {
  const runs = element.shape?.text?.textElements ?? [];
  const firstRun = runs.find((candidate) => candidate.textRun?.style)?.textRun?.style;
  const firstParagraph = runs.find((candidate) => candidate.paragraphMarker?.style)?.paragraphMarker
    ?.style;
  const fill = element.shape?.shapeProperties?.shapeBackgroundFill?.solidFill;
  const outline = element.shape?.shapeProperties?.outline;
  const style: ElementStyle = {};
  const foreground = opaqueColorToHex(firstRun?.foregroundColor?.opaqueColor);
  const fillColor = opaqueColorToHex(fill?.color);
  const stroke = opaqueColorToHex(outline?.outlineFill?.solidFill?.color);
  const fontSize = dimensionToPoints(firstRun?.fontSize);
  if (foreground) style.color = foreground;
  if (fillColor) style.fill = fillColor;
  if (stroke) style.stroke = stroke;
  if (fontSize !== undefined) style.fontSize = fontSize;
  if (firstRun?.fontFamily) style.fontFamily = firstRun.fontFamily;
  if (firstRun?.bold !== undefined) style.fontWeight = firstRun.bold ? 700 : 400;
  const textAlign = paragraphAlignment(firstParagraph?.alignment);
  if (textAlign) style.textAlign = textAlign;
  const strokeWidth = dimensionToPoints(outline?.weight);
  if (strokeWidth !== undefined) style.strokeWidth = strokeWidth;
  if (fill?.alpha !== undefined) style.opacity = clamp01(fill.alpha);
  return style;
}

function inferSlideTitle(slide: GooglePage, slideIndex: number): string {
  const titleShape = (slide.pageElements ?? []).find((element) => {
    const placeholder = element.shape?.placeholder?.type;
    return placeholder === 'TITLE' || placeholder === 'CENTERED_TITLE';
  });
  const title = titleShape ? shapeText(titleShape) : undefined;
  if (title?.trim()) return title.trim();
  for (const element of slide.pageElements ?? []) {
    const candidate = shapeText(element)?.trim();
    if (candidate) return candidate.split('\n')[0]?.slice(0, 160) || `Slide ${slideIndex + 1}`;
  }
  return `Slide ${slideIndex + 1}`;
}

function inferSpeakerNotes(slide: GooglePage): string | undefined {
  const notesPage = slide.slideProperties?.notesPage;
  const notesObjectId = notesPage?.notesProperties?.speakerNotesObjectId;
  const shape = notesPage?.pageElements?.find((element) => element.objectId === notesObjectId);
  const notes = shape ? shapeText(shape)?.trim() : undefined;
  return notes || undefined;
}

function pageBackground(slide: GooglePage): string | undefined {
  return opaqueColorToHex(slide.pageProperties?.pageBackgroundFill?.solidFill?.color);
}

function shapeText(element: GooglePageElement): string | undefined {
  if (element.wordArt?.renderedText !== undefined) return element.wordArt.renderedText;
  const textElements: GoogleTextElement[] | undefined = element.shape?.text?.textElements;
  if (!textElements) return undefined;
  const content = textElements.map((item) => item.textRun?.content ?? '').join('');
  return content.endsWith('\n') ? content.slice(0, -1) : content;
}

function flattenPageElements(
  elements: readonly GooglePageElement[],
  parentGrouped = false,
): Array<{ element: GooglePageElement; groupLossy: boolean }> {
  return elements.flatMap((element) => {
    const children = element.elementGroup?.children;
    if (!children?.length) return [{ element, groupLossy: parentGrouped }];
    return flattenPageElements(children, true);
  });
}

function googleElementKind(element: GooglePageElement): string {
  if (element.elementGroup) return 'group';
  if (element.shape) return 'shape';
  if (element.image) return 'image';
  if (element.video) return 'video';
  if (element.line) return 'line';
  if (element.table) return 'table';
  if (element.wordArt) return 'wordArt';
  if (element.sheetsChart) return 'sheetsChart';
  if (element.speakerSpotlight) return 'speakerSpotlight';
  return 'unknown';
}

function friendlyKind(kind: string): string {
  return kind.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase());
}

export function dimensionToEmu(dimension: GoogleDimension | undefined): number | undefined {
  if (!dimension || !Number.isFinite(dimension.magnitude)) return undefined;
  const magnitude = dimension.magnitude as number;
  if (dimension.unit === 'PT') return magnitude * EMU_PER_POINT;
  if (dimension.unit === 'PX') return magnitude * EMU_PER_PIXEL;
  return magnitude;
}

function dimensionToPoints(dimension: GoogleDimension | undefined): number | undefined {
  const emu = dimensionToEmu(dimension);
  return emu === undefined ? undefined : emu / EMU_PER_POINT;
}

function transformDistanceToEmu(
  magnitude: number | undefined,
  transform: GoogleAffineTransform,
): number {
  if (!Number.isFinite(magnitude)) return 0;
  if (transform.unit === 'PT') return (magnitude as number) * EMU_PER_POINT;
  if (transform.unit === 'PX') return (magnitude as number) * EMU_PER_PIXEL;
  return magnitude as number;
}

function opaqueColorToHex(color: GoogleOpaqueColor | undefined): string | undefined {
  const rgb = color?.rgbColor;
  if (!rgb) return undefined;
  const channels = [rgb.red ?? 0, rgb.green ?? 0, rgb.blue ?? 0].map((value) =>
    Math.round(clamp01(value) * 255)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${channels.join('')}`;
}

function paragraphAlignment(alignment: string | undefined): ElementStyle['textAlign'] | undefined {
  if (alignment === 'CENTER') return 'center';
  if (alignment === 'END') return 'right';
  if (alignment === 'START') return 'left';
  return undefined;
}

function requiredId(value: string | undefined, path: string): string {
  if (!value?.trim()) throw new Error(`Google Slides response is missing ${path}.`);
  return value;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clampPositive(value: number): number {
  return Math.max(0.000_001, Math.min(1, Number.isFinite(value) ? value : 0.000_001));
}
