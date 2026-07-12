import type {
  DeckSnapshot,
  ElementStyle,
  PatchOperation,
  SlideElement,
} from '../../shared/nodeslide';
import { applyDeckPatch } from '../../shared/nodeslidePatch';
import type { SignatureProfile } from '../../shared/nodeslideSignature';
import { resolveSignatureTheme } from '../../shared/nodeslideSignatureApply';
import {
  NODESLIDE_VARIANT_COUNT,
  NODESLIDE_VARIANT_OPERATION_LIMIT,
  NODESLIDE_VARIATION_SCHEMA_VERSION,
  type SlideVariation,
  type VariationAxes,
  type VariationOrigin,
  type VariationStatus,
} from '../../shared/nodeslideVariation';
import { nodeslideContentDigest, nodeslideHash, nodeslideStableId } from './nodeslideIds';
import { summarizePatchOperations, validateNodeSlidePatch } from './nodeslidePatches';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

export const NODESLIDE_VARIATION_ELEMENT_LIMIT = 64;
export const NODESLIDE_VARIATION_PROMPT_LIMIT = 96_000;
export const NODESLIDE_VARIATION_CANDIDATE_BYTE_LIMIT = 64_000;
export const NODESLIDE_VARIATION_LIST_BYTE_LIMIT = 2_000_000;
export const NODESLIDE_VARIATION_BATCH_LIMIT = 50;
export const NODESLIDE_VARIATION_RECORD_LIMIT = 150;
export const NODESLIDE_VARIATION_DECISION_LIMIT = 100;
export const NODESLIDE_VARIATION_REASON_LIMIT = 240;
export const NODESLIDE_VARIATION_SUMMARY_LIMIT = 500;
export const NODESLIDE_VARIATION_DIAGNOSTIC_LIMIT = 500;
export const NODESLIDE_VARIATION_OWNER_QUOTA = 60;
export const NODESLIDE_VARIATION_GLOBAL_QUOTA = 500;
export const NODESLIDE_VARIATION_DEFAULT_LIST_LIMIT = 30;
export const NODESLIDE_VARIATION_MAX_LIST_LIMIT = 100;

export const NODESLIDE_DEFAULT_VARIATION_AXES: readonly VariationAxes[] = [
  { contentAngle: 'data_led', density: 'executive', layoutArchetype: 'evidence' },
  { contentAngle: 'narrative_led', density: 'balanced', layoutArchetype: 'headline' },
  { contentAngle: 'balanced', density: 'detail', layoutArchetype: 'split' },
];

const ALLOWED_OPERATION_NAMES = new Set<PatchOperation['op']>([
  'replace_text',
  'update_style',
  'move',
  'resize',
  'update_slide',
]);
const STYLE_STRING_KEYS = ['fill', 'stroke', 'color', 'fontFamily', 'shadow'] as const;
const STYLE_NUMBER_RANGES = {
  strokeWidth: [0, 24],
  fontSize: [6, 200],
  fontWeight: [1, 1_000],
  lineHeight: [0.5, 4],
  letterSpacing: [-20, 40],
  radius: [0, 200],
  opacity: [0, 1],
  padding: [0, 200],
} as const;

export type VariationFailureCode =
  | 'invalid_request'
  | 'source_bounds'
  | 'generation_failed'
  | 'quota_exceeded'
  | 'selection_in_progress';

export class NodeSlideVariationError extends Error {
  constructor(
    readonly code: VariationFailureCode,
    message: string,
  ) {
    super(`[NODESLIDE_VARIATION_${code.toUpperCase()}] ${message}`);
    this.name = 'NodeSlideVariationError';
  }
}

export type VariationProviderOutcome = { ok: true; value: unknown } | { ok: false; reason: string };

export interface VariationBuildResult {
  variations: SlideVariation[];
  origin: VariationOrigin;
  fallbackReason?: string;
}

export interface VariationDecisionTrace {
  id: string;
  eventName: 'variation_generated' | 'variation_selected' | 'variation_rejected';
  deckId: string;
  slideId: string;
  batchId: string;
  variationId: string;
  deckVersion: number;
  traceId: string;
  axes: VariationAxes;
  origin: VariationOrigin;
  reason?: string;
  selectedPatchId?: string;
  createdAt: number;
}

export interface VariationDecisionUpdate {
  id: string;
  status: VariationStatus;
  selectedPatchId?: string;
  reason?: string;
  decidedAt: number;
}

export function variationPreviewQuotaBuckets(ownerAccessKey: string) {
  return [
    {
      key: `variation:${nodeslideContentDigest(ownerAccessKey)}`,
      limit: NODESLIDE_VARIATION_OWNER_QUOTA,
      windowMs: 86_400_000,
    },
    {
      key: 'variation:global',
      limit: NODESLIDE_VARIATION_GLOBAL_QUOTA,
      windowMs: 3_600_000,
    },
  ];
}

export function boundedVariationListLimit(limit: number | undefined): number {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new NodeSlideVariationError('invalid_request', 'List limit must be a positive integer.');
  }
  return Math.min(
    NODESLIDE_VARIATION_MAX_LIST_LIMIT,
    limit ?? NODESLIDE_VARIATION_DEFAULT_LIST_LIMIT,
  );
}

interface ParsedProviderEntry {
  axes: VariationAxes | null;
  operations: PatchOperation[] | null;
  reason?: string;
}

interface MaterializedCandidate {
  operations: PatchOperation[];
  candidate: SlideVariation['candidate'];
  validation: SlideVariation['validation'];
}

interface FallbackOperations {
  operations: PatchOperation[];
  insufficientSourceStructure: boolean;
}

interface VariationProviderRecord extends Record<string, unknown> {
  variants?: unknown;
  axes?: unknown;
  operations?: unknown;
  contentAngle?: unknown;
  density?: unknown;
  layoutArchetype?: unknown;
  op?: unknown;
  slideId?: unknown;
  elementId?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  text?: unknown;
  properties?: unknown;
  textAlign?: unknown;
  verticalAlign?: unknown;
  title?: unknown;
  notes?: unknown;
  background?: unknown;
}

export function assertVariationSourceBounds(snapshot: DeckSnapshot, slideId: string): void {
  if (snapshot.slides.length !== 1 || snapshot.slides[0]?.id !== slideId) {
    throw new NodeSlideVariationError(
      'source_bounds',
      'Variation generation must receive exactly the requested slide.',
    );
  }
  const elements = snapshot.elements.filter((element) => element.slideId === slideId);
  if (elements.length === 0 || elements.length > NODESLIDE_VARIATION_ELEMENT_LIMIT) {
    throw new NodeSlideVariationError(
      'source_bounds',
      `The slide must contain between 1 and ${NODESLIDE_VARIATION_ELEMENT_LIMIT} elements.`,
    );
  }
  if (snapshot.elements.some((element) => element.slideId !== slideId)) {
    throw new NodeSlideVariationError(
      'source_bounds',
      'Variation generation cannot read elements from another slide.',
    );
  }
  if (
    snapshot.deck.id.length > 256 ||
    slideId.length > 256 ||
    elements.some(
      (element) =>
        element.id.length > 256 ||
        element.slideId.length > 256 ||
        element.sourceIds.some((sourceId) => sourceId.length > 256),
    )
  ) {
    throw new NodeSlideVariationError(
      'source_bounds',
      'The selected slide contains oversized IDs.',
    );
  }
  const candidateBytes = serializedByteLength({ slide: snapshot.slides[0], elements });
  if (candidateBytes > NODESLIDE_VARIATION_CANDIDATE_BYTE_LIMIT) {
    throw new NodeSlideVariationError('source_bounds', 'The selected slide exceeds bounded size.');
  }
}

export function buildVariationProviderPrompt(
  snapshot: DeckSnapshot,
  slideId: string,
  signatureProfile?: SignatureProfile,
): {
  systemPrompt: string;
  userText: string;
} {
  assertVariationSourceBounds(snapshot, slideId);
  const slide = snapshot.slides[0];
  if (!slide) throw new NodeSlideVariationError('invalid_request', 'The slide was not found.');
  const unlockedElements = orderedSlideElements(snapshot, slideId)
    .filter((element) => !element.locked)
    .map(promptElement);
  const signatureResolution = signatureProfile ? resolveSignatureTheme(signatureProfile) : null;
  if (signatureProfile && (!signatureResolution || !signatureResolution.ok)) {
    throw new NodeSlideVariationError(
      'generation_failed',
      'The active signature profile could not be resolved safely.',
    );
  }
  const userText = JSON.stringify({
    schema: {
      exactShape: { variants: [{ axes: 'one requested tuple', operations: '1..8 operations' }] },
      allowedOperations: [...ALLOWED_OPERATION_NAMES],
      forbidden: ['new IDs', 'new elements', 'removed elements', 'locked edits', 'other slides'],
    },
    axes: NODESLIDE_DEFAULT_VARIATION_AXES,
    ...(signatureResolution?.ok
      ? {
          activeSignature: {
            id: signatureProfile?.id,
            allowedColors: [
              signatureResolution.theme.colors.canvas,
              signatureResolution.theme.colors.ink,
              signatureResolution.theme.colors.muted,
              signatureResolution.theme.colors.accent,
              signatureResolution.theme.colors.accentSoft,
              signatureResolution.theme.colors.border,
              ...signatureResolution.theme.colors.data,
            ],
            allowedFontFamilies: [
              signatureResolution.theme.typography.display,
              signatureResolution.theme.typography.body,
              signatureResolution.theme.typography.data,
            ],
            typeScalePt: {
              title: signatureResolution.theme.typography.titlePt,
              body: signatureResolution.theme.typography.bodyPt,
              data: signatureResolution.theme.typography.dataPt,
            },
          },
        }
      : {}),
    deckBrief: {
      prompt: boundedText(snapshot.deck.brief.prompt, 1_200),
      audience: boundedText(snapshot.deck.brief.audience, 400),
      purpose: boundedText(snapshot.deck.brief.purpose, 400),
      successCriteria: snapshot.deck.brief.successCriteria
        .slice(0, 8)
        .map((criterion) => boundedText(criterion, 300)),
    },
    slide: {
      id: slide.id,
      title: boundedText(slide.title, 160),
      notes: slide.notes ? boundedText(slide.notes, 1_200) : undefined,
      background: safePromptVisualString(slide.background, 128),
      version: slide.version,
    },
    allowedElementIds: unlockedElements.map((element) => element.id),
    elements: unlockedElements,
  });
  if (userText.length > NODESLIDE_VARIATION_PROMPT_LIMIT) {
    throw new NodeSlideVariationError(
      'source_bounds',
      'The bounded variation prompt is too large.',
    );
  }
  return {
    systemPrompt:
      "You are NodeSlide's bounded slide-variation planner. Return strict JSON only, with exactly the supplied top-level shape and exactly three variants. Preserve every supplied fact and source relationship. Use each requested axis tuple exactly once. Use only replace_text, update_style, move, resize, and update_slide; 1 to 8 operations per variant. Target only supplied slide and unlocked element IDs. When activeSignature is supplied, preserve existing colors, font-family values, font sizes, and slide background so role-specific on-brand mappings remain intact; vary weight, spacing, opacity, geometry, alignment, and grounded copy instead. Do not add or remove anything, invent claims or data, fetch URLs, or include markdown or extra keys.",
    userText,
  };
}

export function buildSlideVariations(args: {
  snapshot: DeckSnapshot;
  slideId: string;
  batchId: string;
  createdAt: number;
  provider: VariationProviderOutcome;
  signatureProfile?: SignatureProfile;
}): VariationBuildResult {
  assertVariationSourceBounds(args.snapshot, args.slideId);
  const parsed = args.provider.ok
    ? parseProviderEnvelope(args.provider.value)
    : {
        ok: false as const,
        reason: cleanDiagnostic(args.provider.reason || 'provider_unavailable'),
      };
  const providerEntries = parsed.ok ? parsed.entries : [];
  const usedEntries = new Set<number>();
  const fingerprints = new Set<string>();
  const candidateFingerprints = new Set<string>();
  const variations: SlideVariation[] = [];

  for (const axes of NODESLIDE_DEFAULT_VARIATION_AXES) {
    const variationId = nodeslideStableId('variation', args.batchId, axesKey(axes));
    const providerIndex = providerEntries.findIndex(
      (entry, index) =>
        !usedEntries.has(index) && entry.axes !== null && sameAxes(entry.axes, axes),
    );
    const providerEntry = providerIndex >= 0 ? providerEntries[providerIndex] : undefined;
    if (providerIndex >= 0) usedEntries.add(providerIndex);
    let materialized: MaterializedCandidate | null = null;
    let fallbackReason = parsed.ok ? providerEntry?.reason : parsed.reason;

    if (
      providerEntry?.operations &&
      variationIntroducesUnsupportedFactualAdditions(
        args.snapshot,
        args.slideId,
        providerEntry.operations,
      )
    ) {
      fallbackReason = 'unsupported_factual_addition';
    } else if (providerEntry?.operations) {
      materialized = materializeWithOneRepair(
        args.snapshot,
        args.slideId,
        providerEntry.operations,
        variationId,
        args.createdAt,
        args.signatureProfile,
      );
      if (!materialized) fallbackReason = 'provider_candidate_failed_validation';
      else if (
        fingerprints.has(variationOperationFingerprint(materialized.operations)) ||
        candidateFingerprints.has(variationMaterializedFingerprint(materialized.candidate))
      ) {
        materialized = null;
        fallbackReason = 'duplicate_provider_variant';
      }
    } else if (parsed.ok && !fallbackReason) {
      fallbackReason = providerEntry ? 'invalid_provider_candidate' : 'missing_axis_tuple';
    }

    let origin: VariationOrigin = 'free_route';
    if (!materialized) {
      origin = 'deterministic_fallback';
      const fallback = deterministicVariationOperations(
        args.snapshot,
        args.slideId,
        axes,
        args.signatureProfile,
      );
      materialized = materializeCandidate(
        args.snapshot,
        args.slideId,
        fallback.operations,
        variationId,
        args.createdAt,
        args.signatureProfile,
      );
      if (
        materialized &&
        (fingerprints.has(variationOperationFingerprint(materialized.operations)) ||
          candidateFingerprints.has(variationMaterializedFingerprint(materialized.candidate)))
      ) {
        materialized = materializeDistinctFallback(
          args.snapshot,
          args.slideId,
          axes,
          fallback.operations,
          variationId,
          args.createdAt,
          fingerprints,
          candidateFingerprints,
          args.signatureProfile,
        );
        fallbackReason = joinDiagnostics(
          fallbackReason,
          providerEntry ? 'duplicate_provider_variant' : 'duplicate_fallback_candidate',
        );
      }
      if (!materialized) {
        throw new NodeSlideVariationError(
          'generation_failed',
          `A distinct validation-clean fallback could not be materialized for ${axesKey(axes)}.`,
        );
      }
      fallbackReason = joinDiagnostics(
        fallbackReason ?? 'provider_candidate_unavailable',
        fallback.insufficientSourceStructure ? 'insufficient_source_structure' : undefined,
      );
    }

    const fingerprint = variationOperationFingerprint(materialized.operations);
    const candidateFingerprint = variationMaterializedFingerprint(materialized.candidate);
    if (fingerprints.has(fingerprint) || candidateFingerprints.has(candidateFingerprint)) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'Three distinct operation fingerprints and materialized candidates could not be produced.',
      );
    }
    fingerprints.add(fingerprint);
    candidateFingerprints.add(candidateFingerprint);
    const sourceSlide = args.snapshot.slides[0];
    if (!sourceSlide) throw new NodeSlideVariationError('invalid_request', 'Slide not found.');
    variations.push({
      schemaVersion: NODESLIDE_VARIATION_SCHEMA_VERSION,
      id: variationId,
      batchId: args.batchId,
      deckId: args.snapshot.deck.id,
      slideId: args.slideId,
      baseDeckVersion: args.snapshot.deck.version,
      baseSlideVersion: sourceSlide.version,
      baseElementVersions: Object.fromEntries(
        orderedSlideElements(args.snapshot, args.slideId).map((element) => [
          element.id,
          element.version,
        ]),
      ),
      axes,
      origin,
      ...(origin === 'deterministic_fallback'
        ? { fallbackReason: cleanDiagnostic(fallbackReason ?? 'deterministic_fallback') }
        : {}),
      operations: materialized.operations,
      candidate: materialized.candidate,
      validation: materialized.validation,
      status: 'ready',
      createdAt: args.createdAt,
    });
  }

  if (
    variations.length !== NODESLIDE_VARIANT_COUNT ||
    new Set(variations.map((variation) => axesKey(variation.axes))).size !==
      NODESLIDE_VARIANT_COUNT ||
    fingerprints.size !== NODESLIDE_VARIANT_COUNT ||
    candidateFingerprints.size !== NODESLIDE_VARIANT_COUNT
  ) {
    throw new NodeSlideVariationError(
      'generation_failed',
      'The variation set did not satisfy exact-count and diversity bounds.',
    );
  }
  const fallbackReasons = variations.flatMap((variation) =>
    variation.fallbackReason ? [variation.fallbackReason] : [],
  );
  const origin = variations.every((variation) => variation.origin === 'free_route')
    ? 'free_route'
    : 'deterministic_fallback';
  return {
    variations,
    origin,
    ...(fallbackReasons.length > 0
      ? { fallbackReason: cleanDiagnostic([...new Set(fallbackReasons)].join('; ')) }
      : {}),
  };
}

function materializeDistinctFallback(
  snapshot: DeckSnapshot,
  slideId: string,
  axes: VariationAxes,
  operations: PatchOperation[],
  variationId: string,
  checkedAt: number,
  usedFingerprints: ReadonlySet<string>,
  usedCandidateFingerprints: ReadonlySet<string>,
  signatureProfile?: SignatureProfile,
): MaterializedCandidate | null {
  const target = orderedSlideElements(snapshot, slideId).find((element) => !element.locked);
  if (!target) return null;
  const axisOffset = NODESLIDE_DEFAULT_VARIATION_AXES.findIndex((candidate) =>
    sameAxes(candidate, axes),
  );
  const markers: Array<Partial<ElementStyle>> = [
    { opacity: distinctNumber(target.style.opacity, 0.81 + axisOffset * 0.03, 0.79) },
    { radius: distinctNumber(target.style.radius, 7 + axisOffset, 11 + axisOffset) },
    {
      strokeWidth: distinctNumber(
        target.style.strokeWidth,
        1.25 + axisOffset * 0.25,
        2.25 + axisOffset * 0.25,
      ),
    },
  ];
  for (const [index, properties] of markers.entries()) {
    const marker: PatchOperation = {
      op: 'update_style',
      slideId,
      elementId: target.id,
      properties,
    };
    const candidateOperations: PatchOperation[] = [...operations, marker].slice(
      0,
      NODESLIDE_VARIANT_OPERATION_LIMIT,
    );
    const materialized = materializeCandidate(
      snapshot,
      slideId,
      candidateOperations,
      `${variationId}_distinct_${index}`,
      checkedAt,
      signatureProfile,
    );
    if (
      materialized &&
      !usedFingerprints.has(variationOperationFingerprint(materialized.operations)) &&
      !usedCandidateFingerprints.has(variationMaterializedFingerprint(materialized.candidate))
    ) {
      return materialized;
    }
  }
  return null;
}

export function parseProviderVariationSet(
  value: unknown,
):
  | { ok: true; variants: Array<{ axes: VariationAxes; operations: PatchOperation[] }> }
  | { ok: false; reason: string } {
  const parsed = parseProviderEnvelope(value);
  if (!parsed.ok) return parsed;
  if (parsed.entries.some((entry) => entry.axes === null || entry.operations === null)) {
    return { ok: false, reason: 'invalid_provider_candidate' };
  }
  const variants = parsed.entries.map((entry) => ({
    axes: entry.axes as VariationAxes,
    operations: entry.operations as PatchOperation[],
  }));
  if (new Set(variants.map((variant) => axesKey(variant.axes))).size !== NODESLIDE_VARIANT_COUNT) {
    return { ok: false, reason: 'duplicate_or_missing_axis_tuple' };
  }
  return { ok: true, variants };
}

export function variationIntroducesUnsupportedFactualAdditions(
  snapshot: DeckSnapshot,
  slideId: string,
  operations: readonly PatchOperation[],
): boolean {
  const candidateTexts = operations.flatMap((operation) => {
    if (operation.op === 'replace_text') return [operation.text];
    if (operation.op !== 'update_slide') return [];
    return [operation.properties.title, operation.properties.notes].filter(
      (value): value is string => typeof value === 'string',
    );
  });
  if (candidateTexts.length === 0) return false;
  const groundingSegments = variationGroundingSegments(snapshot, slideId);
  return candidateTexts.some((text) => {
    const candidate = normalizeGroundingText(text);
    return (
      candidate.length > 0 && !groundingSegments.some((segment) => segment.includes(candidate))
    );
  });
}

export function deterministicVariationOperations(
  snapshot: DeckSnapshot,
  slideId: string,
  axes: VariationAxes,
  signatureProfile?: SignatureProfile,
): FallbackOperations {
  const eligible = orderedSlideElements(snapshot, slideId).filter((element) => !element.locked);
  if (eligible.length === 0) return { operations: [], insufficientSourceStructure: true };
  const textElements = eligible.filter(
    (element) => element.kind === 'text' && Boolean(element.content?.trim()),
  );
  const evidence = eligible.find(
    (element) =>
      element.kind === 'chart' ||
      element.sourceIds.length > 0 ||
      Boolean(element.chart?.sourceId) ||
      /metric|evidence|data|chart|proof/i.test(`${element.role ?? ''} ${element.name}`),
  );
  const semanticHeadline = textElements.find((element) =>
    /headline|title|takeaway|insight/i.test(`${element.role ?? ''} ${element.name}`),
  );
  const headline = semanticHeadline ?? textElements[0];
  const signatureResolution = signatureProfile ? resolveSignatureTheme(signatureProfile) : null;
  const accent =
    signatureResolution?.ok === true
      ? signatureResolution.theme.colors.accent
      : snapshot.deck.theme.colors.accent;
  const ink =
    signatureResolution?.ok === true
      ? signatureResolution.theme.colors.ink
      : snapshot.deck.theme.colors.ink;

  if (axes.contentAngle === 'data_led') {
    const target = evidence ?? textElements[0] ?? eligible[0];
    if (!target) return { operations: [], insufficientSourceStructure: true };
    const operations: PatchOperation[] = [
      {
        op: 'update_style',
        slideId,
        elementId: target.id,
        properties:
          target.kind === 'text'
            ? {
                ...(signatureProfile ? {} : { color: accent }),
                fontWeight: distinctNumber(target.style.fontWeight, 720, 680),
                opacity: distinctNumber(target.style.opacity, 1, 0.96),
              }
            : {
                ...(signatureProfile ? {} : { stroke: accent }),
                strokeWidth: distinctNumber(target.style.strokeWidth, 2, 1.5),
                opacity: distinctNumber(target.style.opacity, 1, 0.96),
              },
      },
    ];
    const support = textElements.find((element) => element.id !== target.id);
    const tightened = support?.content ? tightenExistingCopy(support.content, 180) : null;
    if (support?.content && tightened && tightened !== support.content) {
      operations.push({
        op: 'replace_text',
        slideId,
        elementId: support.id,
        text: tightened,
      });
    }
    return {
      operations: operations.slice(0, NODESLIDE_VARIANT_OPERATION_LIMIT),
      insufficientSourceStructure: evidence === undefined,
    };
  }

  if (axes.contentAngle === 'narrative_led') {
    const target = headline ?? eligible[0];
    if (!target) return { operations: [], insufficientSourceStructure: true };
    const operations: PatchOperation[] = [
      {
        op: 'update_style',
        slideId,
        elementId: target.id,
        properties:
          target.kind === 'text'
            ? {
                ...(signatureProfile ? {} : { color: ink }),
                fontWeight: distinctNumber(target.style.fontWeight, 760, 700),
              }
            : {
                opacity: distinctNumber(target.style.opacity, 0.9, 0.84),
                radius: distinctNumber(target.style.radius, 8, 10),
              },
      },
    ];
    const secondary = textElements.find((element) => element.id !== target.id);
    const simplified = secondary?.content ? tightenExistingCopy(secondary.content, 140) : null;
    if (secondary?.content && simplified && simplified !== secondary.content) {
      operations.push({
        op: 'replace_text',
        slideId,
        elementId: secondary.id,
        text: simplified,
      });
    }
    return {
      operations: operations.slice(0, NODESLIDE_VARIANT_OPERATION_LIMIT),
      insufficientSourceStructure: semanticHeadline === undefined,
    };
  }

  const target = evidence ?? textElements[0] ?? eligible[0];
  if (!target) return { operations: [], insufficientSourceStructure: true };
  const operations: PatchOperation[] = [
    {
      op: 'update_style',
      slideId,
      elementId: target.id,
      properties:
        target.kind === 'text'
          ? {
              lineHeight: distinctNumber(target.style.lineHeight, 1.16, 1.12),
              letterSpacing: distinctNumber(target.style.letterSpacing, -0.1, -0.2),
            }
          : {
              opacity: distinctNumber(target.style.opacity, 0.94, 0.9),
              radius: distinctNumber(target.style.radius, 12, 9),
            },
    },
  ];
  const companion = eligible.find((element) => element.id !== target.id);
  if (companion) {
    operations.push({
      op: 'update_style',
      slideId,
      elementId: companion.id,
      properties: {
        opacity: distinctNumber(companion.style.opacity, 0.88, 0.92),
      },
    });
  }
  return {
    operations: operations.slice(0, NODESLIDE_VARIANT_OPERATION_LIMIT),
    insufficientSourceStructure: evidence === undefined || eligible.length < 2,
  };
}

export function variationOperationFingerprint(operations: readonly PatchOperation[]): string {
  return `ops-${nodeslideHash(stableStringify(operations))}`;
}

export function variationMaterializedFingerprint(candidate: SlideVariation['candidate']): string {
  return `candidate-${nodeslideHash(
    stableStringify(comparableCandidate(candidate.slide, candidate.elements)),
  )}`;
}

export function boundVariationListByBytes(
  variations: readonly SlideVariation[],
  requestedLimit: number,
  byteLimit = NODESLIDE_VARIATION_LIST_BYTE_LIMIT,
): SlideVariation[] {
  const limit = Math.min(boundedVariationListLimit(requestedLimit), variations.length);
  if (!Number.isInteger(byteLimit) || byteLimit < 1) {
    throw new NodeSlideVariationError('invalid_request', 'List byte limit must be positive.');
  }
  const result: SlideVariation[] = [];
  for (let index = 0; index < limit; ) {
    const batchId = variations[index]?.batchId;
    if (!batchId) break;
    const batch: SlideVariation[] = [];
    while (index < limit && variations[index]?.batchId === batchId) {
      const variation = variations[index];
      if (variation) batch.push(variation);
      index += 1;
    }
    if (result.length + batch.length > limit) break;
    const candidate = [...result, ...batch];
    if (serializedByteLength(candidate) > byteLimit) {
      if (result.length === 0) {
        throw new NodeSlideVariationError(
          'source_bounds',
          'The latest variation batch exceeds the bounded list response size.',
        );
      }
      break;
    }
    result.push(...batch);
  }
  return result;
}

export function summarizeVariationOperations(operations: readonly PatchOperation[]): string {
  return boundedText(summarizePatchOperations(operations), NODESLIDE_VARIATION_SUMMARY_LIMIT);
}

export function planVariationGeneration(
  variations: readonly SlideVariation[],
): VariationDecisionTrace[] {
  return variations.map((variation) =>
    variationTrace(variation, 'variation_generated', variation.createdAt),
  );
}

export function planVariationAcceptance(
  variations: readonly SlideVariation[],
  selectedVariationId: string,
  selectedPatchId: string,
  decidedAt: number,
): { updates: VariationDecisionUpdate[]; traces: VariationDecisionTrace[] } {
  const selected = variations.find((variation) => variation.id === selectedVariationId);
  if (!selected || selected.status !== 'ready') return { updates: [], traces: [] };
  const acceptedSibling = variations.find(
    (variation) => variation.id !== selected.id && variation.status === 'accepted',
  );
  if (acceptedSibling) {
    const reason = 'sibling_selected';
    return {
      updates: [{ id: selected.id, status: 'rejected', reason, decidedAt }],
      traces: [variationTrace(selected, 'variation_rejected', decidedAt, reason)],
    };
  }
  const updates: VariationDecisionUpdate[] = [
    { id: selected.id, status: 'accepted', selectedPatchId, decidedAt },
  ];
  const traces: VariationDecisionTrace[] = [
    variationTrace(selected, 'variation_selected', decidedAt, undefined, selectedPatchId),
  ];
  for (const sibling of variations) {
    if (sibling.id === selected.id || sibling.status !== 'ready') continue;
    updates.push({
      id: sibling.id,
      status: 'rejected',
      reason: 'sibling_selected',
      decidedAt,
    });
    traces.push(variationTrace(sibling, 'variation_rejected', decidedAt, 'sibling_selected'));
  }
  return { updates, traces };
}

export function planVariationRejection(
  variation: SlideVariation,
  reason: string | undefined,
  decidedAt: number,
): { update: VariationDecisionUpdate | null; trace: VariationDecisionTrace | null } {
  if (variation.status !== 'ready') return { update: null, trace: null };
  const cleanReason = cleanReasonText(reason || 'user_rejected');
  return {
    update: { id: variation.id, status: 'rejected', reason: cleanReason, decidedAt },
    trace: variationTrace(variation, 'variation_rejected', decidedAt, cleanReason),
  };
}

export function variationRetentionPlan(
  batches: ReadonlyArray<{
    id: string;
    status: 'generating' | 'ready' | 'failed';
    createdAt: number;
    prunable?: boolean;
  }>,
  decisions: ReadonlyArray<{ id: string; createdAt: number }>,
): { batchIdsToDelete: string[]; decisionIdsToDelete: string[]; unprunableBatchCount: number } {
  const excessBatches = Math.max(0, batches.length - NODESLIDE_VARIATION_BATCH_LIMIT);
  const batchIdsToDelete = [...batches]
    .filter((batch) => batch.status !== 'generating' && batch.prunable !== false)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(0, excessBatches)
    .map((batch) => batch.id);
  const decisionIdsToDelete = [...decisions]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, decisions.length - NODESLIDE_VARIATION_DECISION_LIMIT))
    .map((decision) => decision.id);
  return {
    batchIdsToDelete,
    decisionIdsToDelete,
    unprunableBatchCount: Math.max(0, excessBatches - batchIdsToDelete.length),
  };
}

export function cleanReasonText(value: string): string {
  return boundedText(value, NODESLIDE_VARIATION_REASON_LIMIT) || 'user_rejected';
}

export function cleanDiagnostic(value: string): string {
  return boundedText(value, NODESLIDE_VARIATION_DIAGNOSTIC_LIMIT) || 'provider_unavailable';
}

function parseProviderEnvelope(
  value: unknown,
): { ok: true; entries: ParsedProviderEntry[] } | { ok: false; reason: string } {
  if (!isExactRecord(value, ['variants']) || !Array.isArray(value.variants)) {
    return { ok: false, reason: 'malformed_provider_json' };
  }
  if (value.variants.length !== NODESLIDE_VARIANT_COUNT) {
    return { ok: false, reason: 'partial_provider_result' };
  }
  return { ok: true, entries: value.variants.map(parseProviderEntry) };
}

function parseProviderEntry(value: unknown): ParsedProviderEntry {
  if (!isExactRecord(value, ['axes', 'operations'])) {
    return { axes: null, operations: null, reason: 'invalid_provider_candidate' };
  }
  const axes = parseAxes(value.axes);
  if (!axes || !Array.isArray(value.operations)) {
    return { axes, operations: null, reason: 'invalid_provider_candidate' };
  }
  if (
    value.operations.length === 0 ||
    value.operations.length > NODESLIDE_VARIANT_OPERATION_LIMIT
  ) {
    return { axes, operations: null, reason: 'invalid_operation_count' };
  }
  const operations = value.operations.map(parseProviderOperation);
  if (operations.some((operation) => operation === null)) {
    return { axes, operations: null, reason: 'invalid_provider_operation' };
  }
  return { axes, operations: operations as PatchOperation[] };
}

function parseAxes(value: unknown): VariationAxes | null {
  if (!isExactRecord(value, ['contentAngle', 'density', 'layoutArchetype'])) return null;
  if (
    value.contentAngle !== 'data_led' &&
    value.contentAngle !== 'narrative_led' &&
    value.contentAngle !== 'balanced'
  ) {
    return null;
  }
  if (value.density !== 'executive' && value.density !== 'detail' && value.density !== 'balanced') {
    return null;
  }
  if (
    value.layoutArchetype !== 'headline' &&
    value.layoutArchetype !== 'split' &&
    value.layoutArchetype !== 'evidence' &&
    value.layoutArchetype !== 'comparison'
  ) {
    return null;
  }
  return {
    contentAngle: value.contentAngle,
    density: value.density,
    layoutArchetype: value.layoutArchetype,
  };
}

function parseProviderOperation(value: unknown): PatchOperation | null {
  if (
    !isRecord(value) ||
    typeof value.op !== 'string' ||
    !ALLOWED_OPERATION_NAMES.has(value.op as PatchOperation['op'])
  ) {
    return null;
  }
  if (
    value.op === 'move' &&
    isExactRecord(value, ['op', 'slideId', 'elementId', 'x', 'y']) &&
    boundedIdentifier(value.slideId) &&
    boundedIdentifier(value.elementId) &&
    finiteNumber(value.x) &&
    finiteNumber(value.y)
  ) {
    return {
      op: 'move',
      slideId: value.slideId,
      elementId: value.elementId,
      x: value.x,
      y: value.y,
    };
  }
  if (
    value.op === 'resize' &&
    isExactRecord(value, ['op', 'slideId', 'elementId', 'width', 'height']) &&
    boundedIdentifier(value.slideId) &&
    boundedIdentifier(value.elementId) &&
    finiteNumber(value.width) &&
    finiteNumber(value.height)
  ) {
    return {
      op: 'resize',
      slideId: value.slideId,
      elementId: value.elementId,
      width: value.width,
      height: value.height,
    };
  }
  if (
    value.op === 'replace_text' &&
    isExactRecord(value, ['op', 'slideId', 'elementId', 'text']) &&
    boundedIdentifier(value.slideId) &&
    boundedIdentifier(value.elementId) &&
    typeof value.text === 'string' &&
    value.text.length <= 4_000
  ) {
    return {
      op: 'replace_text',
      slideId: value.slideId,
      elementId: value.elementId,
      text: value.text,
    };
  }
  if (
    value.op === 'update_style' &&
    isExactRecord(value, ['op', 'slideId', 'elementId', 'properties']) &&
    boundedIdentifier(value.slideId) &&
    boundedIdentifier(value.elementId)
  ) {
    const properties = parseProviderStyle(value.properties);
    return properties
      ? { op: 'update_style', slideId: value.slideId, elementId: value.elementId, properties }
      : null;
  }
  if (
    value.op === 'update_slide' &&
    isExactRecord(value, ['op', 'slideId', 'properties']) &&
    boundedIdentifier(value.slideId)
  ) {
    const properties = parseProviderSlideProperties(value.properties);
    return properties ? { op: 'update_slide', slideId: value.slideId, properties } : null;
  }
  return null;
}

function parseProviderStyle(value: unknown): Partial<ElementStyle> | null {
  if (!isRecord(value)) return null;
  const allowedKeys = [
    ...STYLE_STRING_KEYS,
    ...Object.keys(STYLE_NUMBER_RANGES),
    'textAlign',
    'verticalAlign',
  ];
  if (!hasOnlyKeys(value, allowedKeys) || Object.keys(value).length === 0) return null;
  const style: Partial<ElementStyle> = {};
  for (const key of STYLE_STRING_KEYS) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'string' || candidate.length > 256 || !isSafeVisualString(candidate)) {
      return null;
    }
    style[key] = candidate;
  }
  for (const [key, range] of Object.entries(STYLE_NUMBER_RANGES)) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (!finiteNumber(candidate) || candidate < range[0] || candidate > range[1]) return null;
    (style as Record<string, unknown>)[key] = candidate;
  }
  if (value.textAlign !== undefined) {
    if (value.textAlign !== 'left' && value.textAlign !== 'center' && value.textAlign !== 'right') {
      return null;
    }
    style.textAlign = value.textAlign;
  }
  if (value.verticalAlign !== undefined) {
    if (
      value.verticalAlign !== 'top' &&
      value.verticalAlign !== 'middle' &&
      value.verticalAlign !== 'bottom'
    ) {
      return null;
    }
    style.verticalAlign = value.verticalAlign;
  }
  return style;
}

function parseProviderSlideProperties(
  value: unknown,
): Partial<{ title: string; notes: string; background: string }> | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['title', 'notes', 'background'])) return null;
  const properties: Partial<{ title: string; notes: string; background: string }> = {};
  if (value.title !== undefined) {
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160)
      return null;
    properties.title = value.title;
  }
  if (value.notes !== undefined) {
    if (typeof value.notes !== 'string' || value.notes.length > 4_000) return null;
    properties.notes = value.notes;
  }
  if (value.background !== undefined) {
    if (
      typeof value.background !== 'string' ||
      !value.background.trim() ||
      value.background.length > 128 ||
      !isSafeVisualString(value.background)
    ) {
      return null;
    }
    properties.background = value.background;
  }
  return Object.keys(properties).length > 0 ? properties : null;
}

function materializeWithOneRepair(
  snapshot: DeckSnapshot,
  slideId: string,
  operations: PatchOperation[],
  variationId: string,
  checkedAt: number,
  signatureProfile?: SignatureProfile,
): MaterializedCandidate | null {
  const initial = materializeCandidate(
    snapshot,
    slideId,
    operations,
    variationId,
    checkedAt,
    signatureProfile,
  );
  if (initial) return initial;
  const repaired = repairVariationOperations(snapshot, slideId, operations);
  return materializeCandidate(
    snapshot,
    slideId,
    repaired,
    variationId,
    checkedAt,
    signatureProfile,
  );
}

function materializeCandidate(
  snapshot: DeckSnapshot,
  slideId: string,
  operations: PatchOperation[],
  variationId: string,
  checkedAt: number,
  signatureProfile?: SignatureProfile,
): MaterializedCandidate | null {
  if (
    operations.length === 0 ||
    operations.length > NODESLIDE_VARIANT_OPERATION_LIMIT ||
    operations.some((operation) => !ALLOWED_OPERATION_NAMES.has(operation.op))
  ) {
    return null;
  }
  const scope = {
    kind: 'slide' as const,
    deckId: snapshot.deck.id,
    slideIds: [slideId],
    operationMode: 'unrestricted' as const,
  };
  const errors = validateNodeSlidePatch(snapshot, {
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: { [slideId]: snapshot.slides[0]?.version ?? 0 },
    baseElementVersions: Object.fromEntries(
      snapshot.elements.map((element) => [element.id, element.version]),
    ),
    scope,
    operations,
  });
  if (errors.length > 0) return null;
  try {
    const applied = applyDeckPatch(
      structuredClone(snapshot),
      { baseDeckVersion: snapshot.deck.version, scope, operations },
      checkedAt,
    );
    const validation = validateNodeSlideSnapshot(
      applied.snapshot,
      checkedAt,
      nodeslideStableId('variation_validation', variationId),
      signatureProfile ? { signatureProfile } : {},
    );
    if (!validation.publishOk || validation.issues.some((issue) => issue.severity === 'error'))
      return null;
    if (variationIntroducesTextOverflow(snapshot, applied.snapshot, operations)) return null;
    const slide = applied.snapshot.slides.find((candidate) => candidate.id === slideId);
    const elements = orderedSlideElements(applied.snapshot, slideId);
    const sourceElementCount = snapshot.elements.filter(
      (element) => element.slideId === slideId,
    ).length;
    if (
      !slide ||
      elements.length !== sourceElementCount ||
      serializedByteLength({ slide, elements }) > NODESLIDE_VARIATION_CANDIDATE_BYTE_LIMIT
    ) {
      return null;
    }
    const sourceSlide = snapshot.slides.find((candidate) => candidate.id === slideId);
    const sourceElements = orderedSlideElements(snapshot, slideId);
    if (
      !sourceSlide ||
      stableStringify(comparableCandidate(sourceSlide, sourceElements)) ===
        stableStringify(comparableCandidate(slide, elements))
    ) {
      return null;
    }
    return {
      operations,
      candidate: { slide, elements },
      validation,
    };
  } catch {
    return null;
  }
}

export function variationIntroducesTextOverflow(
  before: DeckSnapshot,
  after: DeckSnapshot,
  operations: readonly PatchOperation[],
): boolean {
  const touchedTextIds = new Set(
    operations.flatMap((operation) => {
      if (
        operation.op === 'replace_text' ||
        operation.op === 'update_style' ||
        operation.op === 'resize'
      ) {
        return [operation.elementId];
      }
      return [];
    }),
  );
  for (const elementId of touchedTextIds) {
    const source = before.elements.find((element) => element.id === elementId);
    const candidate = after.elements.find((element) => element.id === elementId);
    if (!source || !candidate || candidate.kind !== 'text') continue;
    const sourceLength = source.content?.replace(/\s+/g, ' ').trim().length ?? 0;
    const candidateLength = candidate.content?.replace(/\s+/g, ' ').trim().length ?? 0;
    const sourceCapacity = estimatedTextCapacity(source);
    const candidateCapacity = estimatedTextCapacity(candidate);
    const sourceOverflow = sourceLength > sourceCapacity * 1.25;
    const candidateOverflow = candidateLength > candidateCapacity * 1.25;
    if (!sourceOverflow && candidateOverflow) return true;
    if (
      sourceOverflow &&
      candidateOverflow &&
      candidateLength / candidateCapacity > sourceLength / sourceCapacity + 0.1
    ) {
      return true;
    }
    if (candidateLength > Math.max(240, sourceLength * 1.5, candidateCapacity * 1.5)) {
      return true;
    }
  }
  return false;
}

function estimatedTextCapacity(element: SlideElement): number {
  const fontSize = Math.max(6, element.style.fontSize ?? 18);
  const padding = Math.max(0, element.style.padding ?? 0) * 2;
  const usableWidth = Math.max(8, element.bbox.width * 960 - padding);
  const usableHeight = Math.max(8, element.bbox.height * 540 - padding);
  const characterWidth = Math.max(3, fontSize * 0.55 + (element.style.letterSpacing ?? 0));
  const lineHeight = Math.max(fontSize, fontSize * (element.style.lineHeight ?? 1.2));
  return Math.max(
    24,
    Math.floor(usableWidth / characterWidth) * Math.floor(usableHeight / lineHeight),
  );
}

function comparableCandidate(
  slide: DeckSnapshot['slides'][number],
  elements: readonly SlideElement[],
) {
  return {
    slide: {
      title: slide.title,
      notes: slide.notes,
      background: slide.background,
    },
    elements: elements.map((element) => ({
      id: element.id,
      bbox: element.bbox,
      content: element.content,
      style: element.style,
    })),
  };
}

function variationGroundingSegments(snapshot: DeckSnapshot, slideId: string): string[] {
  const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
  const elements = orderedSlideElements(snapshot, slideId).filter((element) => !element.locked);
  return [
    snapshot.deck.brief.prompt,
    snapshot.deck.brief.audience,
    snapshot.deck.brief.purpose,
    ...snapshot.deck.brief.successCriteria,
    slide?.title,
    slide?.notes,
    ...elements.flatMap((element) => [
      element.name,
      element.role,
      element.content,
      ...element.sourceIds,
      element.chart?.chartType,
      element.chart?.unit,
      element.chart?.sourceId,
      ...(element.chart?.labels ?? []),
      ...(element.chart?.series.flatMap((series) => [series.name, ...series.values]) ?? []),
    ]),
  ]
    .filter(
      (value): value is string | number => typeof value === 'string' || typeof value === 'number',
    )
    .map((value) => normalizeGroundingText(String(value)))
    .filter(Boolean);
}

function normalizeGroundingText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}

function repairVariationOperations(
  snapshot: DeckSnapshot,
  slideId: string,
  operations: readonly PatchOperation[],
): PatchOperation[] {
  const elements = new Map(
    snapshot.elements
      .filter((element) => element.slideId === slideId)
      .map((element) => [element.id, structuredClone(element)]),
  );
  return operations.map((operation) => {
    if (operation.op === 'move') {
      const element = elements.get(operation.elementId);
      if (!element) return operation;
      const x = roundNormalized(clamp(operation.x, 0, 1 - element.bbox.width));
      const y = roundNormalized(clamp(operation.y, 0, 1 - element.bbox.height));
      element.bbox.x = x;
      element.bbox.y = y;
      return { ...operation, x, y };
    }
    if (operation.op === 'resize') {
      const element = elements.get(operation.elementId);
      if (!element) return operation;
      const width = roundNormalized(clamp(operation.width, 0.01, 1 - element.bbox.x));
      const height = roundNormalized(clamp(operation.height, 0.01, 1 - element.bbox.y));
      element.bbox.width = width;
      element.bbox.height = height;
      return { ...operation, width, height };
    }
    return operation;
  });
}

function orderedSlideElements(snapshot: DeckSnapshot, slideId: string): SlideElement[] {
  const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
  const rank = new Map((slide?.elementOrder ?? []).map((id, index) => [id, index]));
  return snapshot.elements
    .filter((element) => element.slideId === slideId)
    .sort(
      (left, right) =>
        (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id),
    );
}

function promptElement(element: SlideElement) {
  return {
    id: element.id,
    kind: element.kind,
    role: element.role ? boundedText(element.role, 128) : undefined,
    name: boundedText(element.name, 160),
    content: element.content ? boundedText(element.content, 1_200) : undefined,
    bbox: element.bbox,
    style: promptStyle(element.style),
    sourceIds: element.sourceIds.slice(0, 16).map((sourceId) => boundedText(sourceId, 256)),
    chart: element.chart
      ? {
          chartType: element.chart.chartType,
          labels: element.chart.labels.slice(0, 24).map((label) => boundedText(label, 160)),
          series: element.chart.series.slice(0, 4).map((series) => ({
            name: boundedText(series.name, 160),
            values: series.values.slice(0, 24),
          })),
          unit: element.chart.unit ? boundedText(element.chart.unit, 64) : undefined,
          sourceId: element.chart.sourceId ? boundedText(element.chart.sourceId, 256) : undefined,
        }
      : undefined,
    version: element.version,
  };
}

function promptStyle(style: ElementStyle): Partial<ElementStyle> {
  const bounded: Partial<ElementStyle> = {};
  for (const key of STYLE_STRING_KEYS) {
    const value = style[key];
    if (value !== undefined && isSafeVisualString(value)) bounded[key] = boundedText(value, 256);
  }
  for (const key of Object.keys(STYLE_NUMBER_RANGES) as Array<keyof typeof STYLE_NUMBER_RANGES>) {
    const value = style[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      (bounded as Record<string, unknown>)[key] = value;
    }
  }
  if (style.textAlign !== undefined) bounded.textAlign = style.textAlign;
  if (style.verticalAlign !== undefined) bounded.verticalAlign = style.verticalAlign;
  return bounded;
}

function safePromptVisualString(value: string, max: number): string | undefined {
  return isSafeVisualString(value) ? boundedText(value, max) : undefined;
}

function variationTrace(
  variation: SlideVariation,
  eventName: VariationDecisionTrace['eventName'],
  createdAt: number,
  reason?: string,
  selectedPatchId?: string,
): VariationDecisionTrace {
  return {
    id: nodeslideStableId('variation_decision', variation.id, eventName),
    eventName,
    deckId: variation.deckId,
    slideId: variation.slideId,
    batchId: variation.batchId,
    variationId: variation.id,
    deckVersion: variation.baseDeckVersion,
    traceId: variation.id,
    axes: variation.axes,
    origin: variation.origin,
    ...(reason ? { reason: cleanReasonText(reason) } : {}),
    ...(selectedPatchId ? { selectedPatchId } : {}),
    createdAt,
  };
}

function axesKey(axes: VariationAxes): string {
  return `${axes.contentAngle}:${axes.density}:${axes.layoutArchetype}`;
}

function sameAxes(left: VariationAxes, right: VariationAxes): boolean {
  return axesKey(left) === axesKey(right);
}

function tightenExistingCopy(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  const firstSentence = clean.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (firstSentence && firstSentence.length >= 12 && firstSentence.length < clean.length) {
    return firstSentence;
  }
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return slice.slice(0, lastSpace > max * 0.65 ? lastSpace : max).trimEnd();
}

function distinctNumber(current: number | undefined, preferred: number, alternate: number): number {
  return current === preferred ? alternate : preferred;
}

function joinDiagnostics(...values: Array<string | undefined>): string {
  return cleanDiagnostic(
    [...new Set(values.filter((value): value is string => Boolean(value)))].join('; '),
  );
}

function boundedText(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is VariationProviderRecord {
  return isRecord(value) && Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function hasOnlyKeys(value: VariationProviderRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is VariationProviderRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isSafeVisualString(value: string): boolean {
  return !/(?:url\s*\(|https?:|data:|javascript:)/i.test(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundNormalized(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
