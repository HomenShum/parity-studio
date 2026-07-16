import { z } from 'zod';
import {
  type DeckSnapshot,
  type ElementKind,
  NODESLIDE_GROUP_ID_LIMIT,
  NODESLIDE_GROUP_MEMBER_LIMIT,
  NODESLIDE_SCHEMA_VERSION,
  type PatchOperation,
  type Slide,
  type SlideElement,
} from '../../../../shared/nodeslide';
import { NODESLIDE_JSON_LIMITS } from './importBounds';

export { NODESLIDE_JSON_LIMITS } from './importBounds';

export const NODESLIDE_JSON_FORMAT = 'nodeslide.deck-snapshot' as const;
export const NODESLIDE_JSON_VERSION = 1 as const;

export interface NodeSlideJsonBounds {
  maxInputBytes: number;
  maxSlides: number;
  maxElementsPerSlide: number;
  maxElements: number;
  maxSources: number;
  maxOperations: number;
}

export interface NodeSlideJsonEnvelopeV1 {
  format: typeof NODESLIDE_JSON_FORMAT;
  version: typeof NODESLIDE_JSON_VERSION;
  snapshot: DeckSnapshot;
}

export type NodeSlideJsonIssueCode =
  | 'invalid_json'
  | 'invalid_envelope'
  | 'unsupported_version'
  | 'input_too_large'
  | 'limit_exceeded'
  | 'invalid_snapshot';

export interface NodeSlideJsonIssue {
  code: NodeSlideJsonIssueCode;
  path: string;
  message: string;
}

export interface NodeSlideJsonPreview {
  deckId: string;
  title: string;
  schemaVersion: typeof NODESLIDE_SCHEMA_VERSION;
  slideCount: number;
  elementCount: number;
  sourceCount: number;
  elementKinds: Record<ElementKind, number>;
}

export type NodeSlideJsonFidelity = 'exact' | 'regenerated_metadata' | 'unsupported';

export type NodeSlideJsonFindingCode =
  | 'runtime_metadata_regenerated'
  | 'optional_field_normalized'
  | 'deck_identity_mismatch'
  | 'deck_property_unsupported'
  | 'slide_property_unsupported'
  | 'sources_unsupported'
  | 'element_sources_unsupported'
  | 'element_reparent_unsupported'
  | 'locked_element_unsupported'
  | 'locked_group_unsupported'
  | 'locked_reorder_unsupported'
  | 'operation_limit_exceeded';

export interface NodeSlideJsonFidelityFinding {
  code: NodeSlideJsonFindingCode;
  fidelity: Exclude<NodeSlideJsonFidelity, 'exact'>;
  path: string;
  message: string;
}

export interface NodeSlideJsonFidelityReport {
  fidelity: NodeSlideJsonFidelity;
  canApply: boolean;
  exactOperationCount: number;
  findings: NodeSlideJsonFidelityFinding[];
}

export interface NodeSlideJsonParseSuccess {
  ok: true;
  envelope: NodeSlideJsonEnvelopeV1;
  snapshot: DeckSnapshot;
  preview: NodeSlideJsonPreview;
  fidelity: NodeSlideJsonFidelityReport;
}

export interface NodeSlideJsonFailure {
  ok: false;
  issues: NodeSlideJsonIssue[];
}

export type NodeSlideJsonParseResult = NodeSlideJsonParseSuccess | NodeSlideJsonFailure;

export interface NodeSlideJsonExportSuccess extends NodeSlideJsonParseSuccess {
  json: string;
}

export type NodeSlideJsonExportResult = NodeSlideJsonExportSuccess | NodeSlideJsonFailure;

export interface NodeSlideJsonDiffPreview {
  deckTitleChanged: boolean;
  slidesAdded: number;
  slidesRemoved: number;
  slidesUpdated: number;
  slidesReordered: number;
  elementsAdded: number;
  elementsRemoved: number;
  elementsUpdated: number;
  elementsReordered: number;
  requiredOperationCount: number;
}

export interface NodeSlideJsonDiffSuccess {
  ok: true;
  operations: PatchOperation[];
  preview: NodeSlideJsonDiffPreview;
  fidelity: NodeSlideJsonFidelityReport;
}

export type NodeSlideJsonDiffResult = NodeSlideJsonDiffSuccess | NodeSlideJsonFailure;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_ID_LENGTH = 256;
const MAX_SHORT_TEXT_LENGTH = 16_384;
const MAX_CONTENT_LENGTH = 1_000_000;
const MAX_ARRAY_LENGTH = 8_192;

const idSchema = z.string().min(1).max(MAX_ID_LENGTH).regex(ID_PATTERN);
const shortTextSchema = z.string().max(MAX_SHORT_TEXT_LENGTH);
const contentSchema = z.string().max(MAX_CONTENT_LENGTH);
const finiteNumberSchema = z.number().finite();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();

const bboxSchema = z
  .object({
    x: finiteNumberSchema,
    y: finiteNumberSchema,
    width: finiteNumberSchema,
    height: finiteNumberSchema,
  })
  .strict();

const briefSchema = z
  .object({
    prompt: contentSchema,
    audience: shortTextSchema,
    purpose: contentSchema,
    successCriteria: z.array(shortTextSchema).max(256),
  })
  .strict();

const themeSchema = z
  .object({
    id: idSchema,
    name: shortTextSchema,
    mode: z.enum(['light', 'dark']),
    colors: z
      .object({
        canvas: shortTextSchema,
        ink: shortTextSchema,
        muted: shortTextSchema,
        accent: shortTextSchema,
        accentSoft: shortTextSchema,
        insight: shortTextSchema,
        insightInk: shortTextSchema,
        trace: shortTextSchema,
        border: shortTextSchema,
      })
      .strict(),
    typography: z
      .object({ display: shortTextSchema, body: shortTextSchema, data: shortTextSchema })
      .strict(),
    defaultRadius: finiteNumberSchema,
    spacingUnit: finiteNumberSchema,
  })
  .strict();

const styleSchema = z
  .object({
    fill: shortTextSchema.optional(),
    stroke: shortTextSchema.optional(),
    strokeWidth: finiteNumberSchema.optional(),
    color: shortTextSchema.optional(),
    fontFamily: shortTextSchema.optional(),
    fontSize: finiteNumberSchema.optional(),
    fontWeight: finiteNumberSchema.optional(),
    lineHeight: finiteNumberSchema.optional(),
    letterSpacing: finiteNumberSchema.optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    radius: finiteNumberSchema.optional(),
    opacity: finiteNumberSchema.optional(),
    padding: finiteNumberSchema.optional(),
    shadow: shortTextSchema.optional(),
  })
  .strict();

const chartSchema = z
  .object({
    chartType: z.enum(['bar', 'line', 'area', 'donut']),
    labels: z.array(shortTextSchema).max(MAX_ARRAY_LENGTH),
    series: z
      .array(
        z
          .object({
            name: shortTextSchema,
            values: z.array(finiteNumberSchema).max(MAX_ARRAY_LENGTH),
            color: shortTextSchema.optional(),
          })
          .strict(),
      )
      .max(512),
    unit: shortTextSchema.optional(),
    sourceId: idSchema.optional(),
  })
  .strict();

const mathSchema = z
  .object({
    expression: contentSchema,
    syntax: z.enum(['plain', 'latex']).optional(),
    displayMode: z.enum(['inline', 'block']).optional(),
    description: contentSchema.optional(),
    display: contentSchema.optional(),
    variables: z
      .array(
        z
          .object({
            label: shortTextSchema,
            value: finiteNumberSchema,
            unit: shortTextSchema.optional(),
          })
          .strict(),
      )
      .max(512)
      .optional(),
    sourceId: idSchema.optional(),
  })
  .strict();

const videoSchema = z
  .object({
    url: contentSchema,
    posterUrl: contentSchema.optional(),
    title: shortTextSchema.optional(),
    captionsUrl: contentSchema.optional(),
    captionsLanguage: shortTextSchema.optional(),
    startAtSeconds: finiteNumberSchema.optional(),
    endAtSeconds: finiteNumberSchema.optional(),
  })
  .strict();

const imageSchema = z
  .object({
    placeholder: z.boolean(),
    credit: shortTextSchema.optional(),
    sourceId: idSchema.optional(),
  })
  .strict();

const elementKindSchema = z.enum(['text', 'shape', 'image', 'chart', 'math', 'video', 'connector']);

const exportCapabilitySchema = z.enum([
  'web_native',
  'pptx_editable',
  'pptx_static_fallback',
  'google_importable',
  'web_only',
]);

const elementSchema = z
  .object({
    id: idSchema,
    slideId: idSchema,
    name: shortTextSchema,
    kind: elementKindSchema,
    role: shortTextSchema.optional(),
    bbox: bboxSchema,
    rotation: finiteNumberSchema,
    content: contentSchema.optional(),
    style: styleSchema,
    chart: chartSchema.optional(),
    math: mathSchema.optional(),
    video: videoSchema.optional(),
    image: imageSchema.optional(),
    imageUrl: contentSchema.optional(),
    altText: contentSchema.optional(),
    sourceIds: z.array(idSchema).max(MAX_ARRAY_LENGTH),
    locked: z.boolean(),
    visible: z.boolean().optional(),
    groupId: idSchema.max(NODESLIDE_GROUP_ID_LIMIT).optional(),
    exportCapabilities: z.array(exportCapabilitySchema).max(16),
    version: positiveIntegerSchema,
  })
  .strict();

const slideSchema = z
  .object({
    id: idSchema,
    deckId: idSchema,
    title: shortTextSchema,
    section: shortTextSchema.optional(),
    notes: contentSchema.optional(),
    background: shortTextSchema,
    elementOrder: z.array(idSchema).max(MAX_ARRAY_LENGTH),
    version: positiveIntegerSchema,
  })
  .strict();

const deckSchema = z
  .object({
    schemaVersion: z.literal(NODESLIDE_SCHEMA_VERSION),
    toolchainVersion: shortTextSchema,
    id: idSchema,
    projectId: idSchema,
    title: z
      .string()
      .min(1)
      .max(160)
      .refine((value) => value.trim() === value && value.length > 0, {
        message: 'Deck titles must be non-blank and cannot have surrounding whitespace.',
      }),
    brief: briefSchema,
    theme: themeSchema,
    slideOrder: z.array(idSchema).min(1).max(MAX_ARRAY_LENGTH),
    version: positiveIntegerSchema,
    status: z.enum(['draft', 'validating', 'ready', 'published']),
    activeSignatureProfileId: idSchema.optional(),
    activeSignatureProfileDigest: shortTextSchema.optional(),
    shareSlug: shortTextSchema.optional(),
    createdAt: nonNegativeIntegerSchema,
    updatedAt: nonNegativeIntegerSchema,
  })
  .strict();

const sourceSchema = z
  .object({
    id: idSchema,
    deckId: idSchema,
    title: shortTextSchema,
    url: contentSchema.optional(),
    sourceType: z.enum(['internal', 'url', 'document', 'spreadsheet', 'note']),
    retrievedAt: nonNegativeIntegerSchema,
    citation: contentSchema,
    license: shortTextSchema.optional(),
    format: z.enum(['csv', 'json', 'txt', 'md', 'pdf', 'web']).optional(),
    contentDigest: shortTextSchema.optional(),
    byteSize: nonNegativeIntegerSchema.optional(),
    rowCount: nonNegativeIntegerSchema.optional(),
    columns: z.array(shortTextSchema).max(1_024).optional(),
    provider: shortTextSchema.optional(),
    retention: z.enum(['until_deleted', 'public_snapshot']).optional(),
    status: z.enum(['ready', 'refreshing', 'failed']).optional(),
    lastRefreshedAt: nonNegativeIntegerSchema.optional(),
  })
  .strict();

const snapshotSchema = z
  .object({
    deck: deckSchema,
    slides: z.array(slideSchema).min(1).max(NODESLIDE_JSON_LIMITS.maxSlides),
    elements: z.array(elementSchema).max(NODESLIDE_JSON_LIMITS.maxElements),
    sources: z.array(sourceSchema).max(NODESLIDE_JSON_LIMITS.maxSources),
  })
  .strict();

const envelopeSchema = z
  .object({
    format: z.literal(NODESLIDE_JSON_FORMAT),
    version: z.literal(NODESLIDE_JSON_VERSION),
    snapshot: snapshotSchema,
  })
  .strict();

export function parseNodeSlideJson(
  json: string,
  bounds?: Partial<NodeSlideJsonBounds>,
): NodeSlideJsonParseResult {
  const resolvedBounds = resolveBounds(bounds);
  const inputBytes = new TextEncoder().encode(json).byteLength;
  if (inputBytes > resolvedBounds.maxInputBytes) {
    return failure(
      'input_too_large',
      '$',
      `JSON input is ${inputBytes} bytes; the limit is ${resolvedBounds.maxInputBytes}.`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return failure(
      'invalid_json',
      '$',
      error instanceof Error ? error.message : 'Input is not valid JSON.',
    );
  }

  if (
    isRecord(raw) &&
    raw['format'] === NODESLIDE_JSON_FORMAT &&
    raw['version'] !== NODESLIDE_JSON_VERSION
  ) {
    return failure(
      'unsupported_version',
      '$.version',
      `Unsupported NodeSlide JSON version ${String(raw['version'])}; expected ${NODESLIDE_JSON_VERSION}.`,
    );
  }

  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'invalid_envelope',
        path: zodPath(issue.path),
        message: issue.message,
      })),
    };
  }

  const snapshot = parsed.data.snapshot as DeckSnapshot;
  const issues = validateSnapshotStructure(snapshot, resolvedBounds);
  if (issues.length > 0) return { ok: false, issues };
  const envelope = parsed.data as NodeSlideJsonEnvelopeV1;
  return {
    ok: true,
    envelope,
    snapshot,
    preview: previewSnapshot(snapshot),
    fidelity: exactFidelity(0),
  };
}

export function exportNodeSlideJson(
  snapshot: DeckSnapshot,
  options: { bounds?: Partial<NodeSlideJsonBounds>; space?: number } = {},
): NodeSlideJsonExportResult {
  const resolvedBounds = resolveBounds(options.bounds);
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'invalid_snapshot',
        path: zodPath(['snapshot', ...issue.path]),
        message: issue.message,
      })),
    };
  }
  const validatedSnapshot = parsed.data as DeckSnapshot;
  const issues = validateSnapshotStructure(validatedSnapshot, resolvedBounds);
  if (issues.length > 0) return { ok: false, issues };

  const envelope: NodeSlideJsonEnvelopeV1 = {
    format: NODESLIDE_JSON_FORMAT,
    version: NODESLIDE_JSON_VERSION,
    snapshot: structuredClone(validatedSnapshot),
  };
  const space = Math.max(0, Math.min(10, Math.trunc(options.space ?? 2)));
  const json = JSON.stringify(envelope, null, space);
  const inputBytes = new TextEncoder().encode(json).byteLength;
  if (inputBytes > resolvedBounds.maxInputBytes) {
    return failure(
      'input_too_large',
      '$',
      `Export is ${inputBytes} bytes; the limit is ${resolvedBounds.maxInputBytes}.`,
    );
  }
  return {
    ok: true,
    json,
    envelope,
    snapshot: envelope.snapshot,
    preview: previewSnapshot(envelope.snapshot),
    fidelity: exactFidelity(0),
  };
}

export function diffNodeSlideSnapshots(
  current: DeckSnapshot,
  imported: DeckSnapshot,
  bounds?: Partial<NodeSlideJsonBounds>,
): NodeSlideJsonDiffResult {
  const resolvedBounds = resolveBounds(bounds);
  const currentIssues = validateSnapshotForDiff(current, resolvedBounds, 'current');
  const importedIssues = validateSnapshotForDiff(imported, resolvedBounds, 'imported');
  if (currentIssues.length > 0 || importedIssues.length > 0) {
    return { ok: false, issues: [...currentIssues, ...importedIssues] };
  }

  const operations: PatchOperation[] = [];
  const findings: NodeSlideJsonFidelityFinding[] = [];
  const preview = emptyDiffPreview();

  if (current.deck.id !== imported.deck.id) {
    findings.push({
      code: 'deck_identity_mismatch',
      fidelity: 'unsupported',
      path: 'snapshot.deck.id',
      message: `Imported deck ${imported.deck.id} cannot be applied to deck ${current.deck.id} without rewriting stable IDs.`,
    });
    return diffSuccess([], preview, findings);
  }

  const currentElements = byId(current.elements);
  const importedElements = byId(imported.elements);
  const reparentedElement = imported.elements.find((element) => {
    const existing = currentElements.get(element.id);
    return existing !== undefined && existing.slideId !== element.slideId;
  });
  if (reparentedElement) {
    findings.push({
      code: 'element_reparent_unsupported',
      fidelity: 'unsupported',
      path: `snapshot.elements.${reparentedElement.id}.slideId`,
      message: `Element ${reparentedElement.id} moves between slides; no atomic reparent operation exists.`,
    });
    return diffSuccess([], preview, findings);
  }

  if (current.deck.title !== imported.deck.title) {
    operations.push({ op: 'update_deck', properties: { title: imported.deck.title } });
    preview.deckTitleChanged = true;
  }

  compareDeckProperties(current, imported, findings);
  if (!sameValue(current.sources, imported.sources)) {
    findings.push({
      code: 'sources_unsupported',
      fidelity: 'unsupported',
      path: 'snapshot.sources',
      message: 'Source records differ, but PatchOperation has no source-record mutation operation.',
    });
  }
  const currentSlides = byId(current.slides);
  const importedSlides = byId(imported.slides);
  const workingSlideOrder = [...current.deck.slideOrder];

  imported.deck.slideOrder.forEach((slideId, targetIndex) => {
    if (currentSlides.has(slideId)) return;
    const slide = importedSlides.get(slideId);
    if (!slide) return;
    operations.push({
      op: 'add_slide',
      slide: structuredClone(slide),
      elements: slide.elementOrder.flatMap((elementId) => {
        const element = importedElements.get(elementId);
        return element ? [structuredClone(element)] : [];
      }),
      index: Math.min(targetIndex, workingSlideOrder.length),
    });
    workingSlideOrder.splice(Math.min(targetIndex, workingSlideOrder.length), 0, slideId);
    preview.slidesAdded += 1;
    preview.elementsAdded += slide.elementOrder.length;
  });

  for (const slideId of current.deck.slideOrder) {
    if (importedSlides.has(slideId)) continue;
    operations.push({ op: 'remove_slide', slideId });
    const index = workingSlideOrder.indexOf(slideId);
    if (index >= 0) workingSlideOrder.splice(index, 1);
    preview.slidesRemoved += 1;
    preview.elementsRemoved += currentSlides.get(slideId)?.elementOrder.length ?? 0;
  }

  for (const slideId of imported.deck.slideOrder) {
    const currentSlide = currentSlides.get(slideId);
    const importedSlide = importedSlides.get(slideId);
    if (!currentSlide || !importedSlide) continue;
    diffCommonSlide(
      currentSlide,
      importedSlide,
      currentElements,
      importedElements,
      operations,
      findings,
      preview,
    );
  }

  imported.deck.slideOrder.forEach((slideId, targetIndex) => {
    const currentIndex = workingSlideOrder.indexOf(slideId);
    if (currentIndex === targetIndex || currentIndex < 0) return;
    operations.push({ op: 'reorder_slide', slideId, index: targetIndex });
    workingSlideOrder.splice(currentIndex, 1);
    workingSlideOrder.splice(targetIndex, 0, slideId);
    preview.slidesReordered += 1;
  });

  preview.requiredOperationCount = operations.length;
  reportRuntimeMetadata(current, imported, findings, operations.length > 0);
  if (operations.length > resolvedBounds.maxOperations) {
    findings.push({
      code: 'operation_limit_exceeded',
      fidelity: 'unsupported',
      path: 'operations',
      message: `Import requires ${operations.length} operations; the limit is ${resolvedBounds.maxOperations}.`,
    });
    return diffSuccess([], preview, findings);
  }
  return diffSuccess(operations, preview, findings);
}

function diffCommonSlide(
  currentSlide: Slide,
  importedSlide: Slide,
  currentElements: ReadonlyMap<string, SlideElement>,
  importedElements: ReadonlyMap<string, SlideElement>,
  operations: PatchOperation[],
  findings: NodeSlideJsonFidelityFinding[],
  preview: NodeSlideJsonDiffPreview,
): void {
  const properties: Extract<PatchOperation, { op: 'update_slide' }>['properties'] = {};
  if (currentSlide.title !== importedSlide.title) properties.title = importedSlide.title;
  if (currentSlide.notes !== importedSlide.notes) {
    properties.notes = importedSlide.notes ?? '';
    if (importedSlide.notes === undefined) {
      findings.push({
        code: 'optional_field_normalized',
        fidelity: 'regenerated_metadata',
        path: `snapshot.slides.${importedSlide.id}.notes`,
        message:
          'PatchOperation clears notes to an empty string; it cannot restore the legacy omitted-field representation.',
      });
    }
  }
  if (currentSlide.background !== importedSlide.background)
    properties.background = importedSlide.background;
  if (Object.keys(properties).length > 0) {
    operations.push({ op: 'update_slide', slideId: currentSlide.id, properties });
    preview.slidesUpdated += 1;
  }
  if (currentSlide.section !== importedSlide.section) {
    findings.push({
      code: 'slide_property_unsupported',
      fidelity: 'unsupported',
      path: `snapshot.slides.${importedSlide.id}.section`,
      message: 'Slide sections cannot be changed through update_slide.',
    });
  }

  const currentIds = new Set(currentSlide.elementOrder);
  const importedIds = new Set(importedSlide.elementOrder);
  const replacementIds = new Set<string>();
  const skippedIds = new Set<string>();
  const granular = new Map<string, PatchOperation[]>();

  for (const elementId of currentSlide.elementOrder) {
    if (importedIds.has(elementId)) continue;
    const moved = importedElements.get(elementId);
    if (moved && moved.slideId !== currentSlide.id) skippedIds.add(elementId);
  }

  for (const elementId of importedSlide.elementOrder) {
    if (currentIds.has(elementId)) continue;
    const existing = currentElements.get(elementId);
    if (!existing || existing.slideId === importedSlide.id) continue;
    findings.push({
      code: 'element_reparent_unsupported',
      fidelity: 'unsupported',
      path: `snapshot.elements.${elementId}.slideId`,
      message: `Element ${elementId} moves between slides; no atomic reparent operation exists.`,
    });
    skippedIds.add(elementId);
  }

  for (const elementId of importedSlide.elementOrder) {
    if (!currentIds.has(elementId)) continue;
    const currentElement = currentElements.get(elementId);
    const importedElement = importedElements.get(elementId);
    if (!currentElement || !importedElement || sameElementContent(currentElement, importedElement))
      continue;
    const plan = planElementUpdate(currentElement, importedElement, findings);
    if (plan.kind === 'unsupported') {
      skippedIds.add(elementId);
    } else if (plan.kind === 'replace') {
      replacementIds.add(elementId);
    } else {
      granular.set(elementId, plan.operations);
    }
  }

  const structuralIds = new Set([
    ...[...currentIds].filter((id) => !importedIds.has(id)),
    ...[...importedIds].filter((id) => !currentIds.has(id)),
    ...replacementIds,
  ]);
  const groupsChanged = !sameGroupAssignments(
    currentSlide,
    importedSlide,
    currentElements,
    importedElements,
  );
  const orderChanged =
    replacementIds.size > 0 || !sameValue(currentSlide.elementOrder, importedSlide.elementOrder);
  const replacementTouchesGroup = [...replacementIds].some(
    (id) => currentElements.get(id)?.groupId || importedElements.get(id)?.groupId,
  );
  const resetGroups =
    groupsChanged ||
    replacementTouchesGroup ||
    (orderChanged && hasAnyGroups(currentSlide, importedSlide, currentElements, importedElements));
  let groupResetBlocked = false;

  if (resetGroups) {
    const lockedCurrentGroup = groupedElements(currentSlide, currentElements).find(
      (element) => element.locked,
    );
    const lockedImportedGroup = groupedElements(importedSlide, importedElements).find(
      (element) => element.locked,
    );
    if (lockedCurrentGroup || lockedImportedGroup) {
      groupResetBlocked = true;
      const element = lockedCurrentGroup ?? lockedImportedGroup;
      findings.push({
        code: 'locked_group_unsupported',
        fidelity: 'unsupported',
        path: `snapshot.elements.${element?.id}.groupId`,
        message:
          'Changing this group or its order requires a group operation, but a member is locked.',
      });
      for (const elementId of structuralIds) skippedIds.add(elementId);
    } else {
      for (const [groupId, elementIds] of groupsForSlide(currentSlide, currentElements)) {
        operations.push({
          op: 'ungroup_elements_v1',
          slideId: currentSlide.id,
          elementIds,
          groupId,
        });
      }
    }
  }

  for (const elementId of currentSlide.elementOrder) {
    if (importedIds.has(elementId) && !replacementIds.has(elementId)) continue;
    if (skippedIds.has(elementId)) continue;
    const element = currentElements.get(elementId);
    if (!element) continue;
    if (element.locked) {
      findings.push({
        code: 'locked_element_unsupported',
        fidelity: 'unsupported',
        path: `snapshot.elements.${elementId}`,
        message: `Locked element ${elementId} cannot be removed or replaced.`,
      });
      skippedIds.add(elementId);
      continue;
    }
    operations.push({ op: 'remove_element', slideId: currentSlide.id, elementId });
    preview.elementsRemoved += importedIds.has(elementId) ? 0 : 1;
  }

  for (const elementId of importedSlide.elementOrder) {
    if (currentIds.has(elementId) && !replacementIds.has(elementId)) continue;
    if (skippedIds.has(elementId)) continue;
    const element = importedElements.get(elementId);
    if (!element) continue;
    operations.push({
      op: 'add_element',
      slideId: importedSlide.id,
      element: withoutGroup(element),
    });
    preview.elementsAdded += currentIds.has(elementId) ? 0 : 1;
    if (replacementIds.has(elementId)) preview.elementsUpdated += 1;
  }

  for (const [elementId, elementOperations] of granular) {
    if (skippedIds.has(elementId)) continue;
    operations.push(...elementOperations);
    if (elementOperations.length > 0) preview.elementsUpdated += 1;
  }

  let reorderBlocked = false;
  if (orderChanged && skippedIds.size === 0 && !groupResetBlocked) {
    const workingOrder = currentSlide.elementOrder.filter(
      (id) => importedIds.has(id) && !replacementIds.has(id),
    );
    for (const elementId of importedSlide.elementOrder) {
      if (!workingOrder.includes(elementId)) workingOrder.push(elementId);
    }
    importedSlide.elementOrder.forEach((elementId, targetIndex) => {
      const currentIndex = workingOrder.indexOf(elementId);
      if (currentIndex === targetIndex || currentIndex < 0) return;
      const element = importedElements.get(elementId);
      if (element?.locked) {
        reorderBlocked = true;
        findings.push({
          code: 'locked_reorder_unsupported',
          fidelity: 'unsupported',
          path: `snapshot.slides.${importedSlide.id}.elementOrder`,
          message: `Reaching the imported element order requires moving locked element ${elementId}.`,
        });
        return;
      }
      operations.push({
        op: 'reorder_element_v1',
        slideId: importedSlide.id,
        elementId,
        index: targetIndex,
      });
      workingOrder.splice(currentIndex, 1);
      workingOrder.splice(targetIndex, 0, elementId);
      preview.elementsReordered += 1;
    });
  }

  if (resetGroups && skippedIds.size === 0 && !groupResetBlocked && !reorderBlocked) {
    for (const [groupId, elementIds] of groupsForSlide(importedSlide, importedElements)) {
      operations.push({ op: 'group_elements_v1', slideId: importedSlide.id, elementIds, groupId });
    }
  }
}

type ElementUpdatePlan =
  | { kind: 'granular'; operations: PatchOperation[] }
  | { kind: 'replace' }
  | { kind: 'unsupported' };

function planElementUpdate(
  current: SlideElement,
  imported: SlideElement,
  findings: NodeSlideJsonFidelityFinding[],
): ElementUpdatePlan {
  if (current.locked) {
    findings.push({
      code: 'locked_element_unsupported',
      fidelity: 'unsupported',
      path: `snapshot.elements.${imported.id}`,
      message: `Locked element ${imported.id} cannot be changed through PatchOperation.`,
    });
    return { kind: 'unsupported' };
  }

  const sourceIdsChanged = !sameValue(current.sourceIds, imported.sourceIds);
  if (sourceIdsChanged && imported.kind !== 'text' && imported.kind !== 'image') {
    findings.push({
      code: 'element_sources_unsupported',
      fidelity: 'unsupported',
      path: `snapshot.elements.${imported.id}.sourceIds`,
      message: `Element source bindings for ${imported.kind} elements cannot be changed by an existing operation.`,
    });
    return { kind: 'unsupported' };
  }

  const replace =
    current.slideId !== imported.slideId ||
    current.name !== imported.name ||
    current.kind !== imported.kind ||
    current.role !== imported.role ||
    current.rotation !== imported.rotation ||
    current.locked !== imported.locked ||
    (current.content !== undefined && imported.content === undefined) ||
    !sameValue(current.math, imported.math) ||
    !sameValue(current.video, imported.video) ||
    !sameValue(current.exportCapabilities, imported.exportCapabilities) ||
    styleRequiresReplacement(current.style, imported.style) ||
    chartRequiresReplacement(current, imported) ||
    imageRequiresReplacement(current, imported);
  if (replace) return { kind: 'replace' };

  const operations: PatchOperation[] = [];
  const moved = current.bbox.x !== imported.bbox.x || current.bbox.y !== imported.bbox.y;
  const resized =
    current.bbox.width !== imported.bbox.width || current.bbox.height !== imported.bbox.height;
  const move: PatchOperation = {
    op: 'move',
    slideId: imported.slideId,
    elementId: imported.id,
    x: imported.bbox.x,
    y: imported.bbox.y,
  };
  const resize: PatchOperation = {
    op: 'resize',
    slideId: imported.slideId,
    elementId: imported.id,
    width: imported.bbox.width,
    height: imported.bbox.height,
  };
  if (moved && resized) {
    const resizeFirst =
      current.bbox.x + imported.bbox.width <= 1 && current.bbox.y + imported.bbox.height <= 1;
    operations.push(...(resizeFirst ? [resize, move] : [move, resize]));
  } else if (moved) {
    operations.push(move);
  } else if (resized) {
    operations.push(resize);
  }
  if (current.content !== imported.content || (sourceIdsChanged && imported.kind === 'text')) {
    operations.push({
      op: 'replace_text',
      slideId: imported.slideId,
      elementId: imported.id,
      text: imported.content ?? '',
      ...(sourceIdsChanged ? { sourceIds: [...imported.sourceIds] } : {}),
    });
  }
  if (!sameValue(current.style, imported.style)) {
    operations.push({
      op: 'update_style',
      slideId: imported.slideId,
      elementId: imported.id,
      properties: structuredClone(imported.style),
    });
  }
  if (!sameValue(current.chart, imported.chart) && imported.chart) {
    operations.push({
      op: 'update_chart',
      slideId: imported.slideId,
      elementId: imported.id,
      chart: structuredClone(imported.chart),
    });
  }
  if (imported.kind === 'image' && imageOperationNeeded(current, imported)) {
    operations.push({
      op: 'update_image',
      slideId: imported.slideId,
      elementId: imported.id,
      imageUrl: imported.imageUrl ?? '',
      altText: imported.altText ?? '',
      ...(imported.image?.credit ? { credit: imported.image.credit } : {}),
      ...(sourceIdsChanged ? { sourceIds: [...imported.sourceIds] } : {}),
    });
  }
  if ((current.visible ?? true) !== (imported.visible ?? true)) {
    operations.push({
      op: 'set_visibility_v1',
      slideId: imported.slideId,
      elementId: imported.id,
      visible: imported.visible ?? true,
    });
  }
  return { kind: 'granular', operations };
}

function compareDeckProperties(
  current: DeckSnapshot,
  imported: DeckSnapshot,
  findings: NodeSlideJsonFidelityFinding[],
): void {
  const properties: Array<keyof DeckSnapshot['deck']> = [
    'projectId',
    'brief',
    'theme',
    'status',
    'activeSignatureProfileId',
    'activeSignatureProfileDigest',
    'shareSlug',
    'toolchainVersion',
  ];
  for (const property of properties) {
    if (sameValue(current.deck[property], imported.deck[property])) continue;
    findings.push({
      code: 'deck_property_unsupported',
      fidelity: 'unsupported',
      path: `snapshot.deck.${property}`,
      message: `Deck property ${property} cannot be changed through update_deck.`,
    });
  }
}

function reportRuntimeMetadata(
  current: DeckSnapshot,
  imported: DeckSnapshot,
  findings: NodeSlideJsonFidelityFinding[],
  willApplyOperations: boolean,
): void {
  const importedSlides = byId(imported.slides);
  const importedElements = byId(imported.elements);
  const changed =
    willApplyOperations ||
    current.deck.version !== imported.deck.version ||
    current.deck.createdAt !== imported.deck.createdAt ||
    current.deck.updatedAt !== imported.deck.updatedAt ||
    current.slides.some((slide) => {
      const importedSlide = importedSlides.get(slide.id);
      return importedSlide !== undefined && slide.version !== importedSlide.version;
    }) ||
    current.elements.some((element) => {
      const importedElement = importedElements.get(element.id);
      return importedElement !== undefined && element.version !== importedElement.version;
    });
  if (!changed) return;
  findings.push({
    code: 'runtime_metadata_regenerated',
    fidelity: 'regenerated_metadata',
    path: 'snapshot.*.version',
    message:
      'Version clocks and deck timestamps are regenerated by patch application and are not copied from the import.',
  });
}

function validateSnapshotForDiff(
  snapshot: DeckSnapshot,
  bounds: NodeSlideJsonBounds,
  label: string,
): NodeSlideJsonIssue[] {
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      code: 'invalid_snapshot',
      path: `${label}.${zodPath(issue.path)}`,
      message: issue.message,
    }));
  }
  return validateSnapshotStructure(parsed.data as DeckSnapshot, bounds).map((issue) => ({
    ...issue,
    path: `${label}.${issue.path}`,
  }));
}

function validateSnapshotStructure(
  snapshot: DeckSnapshot,
  bounds: NodeSlideJsonBounds,
): NodeSlideJsonIssue[] {
  const issues: NodeSlideJsonIssue[] = [];
  if (snapshot.slides.length > bounds.maxSlides) {
    issues.push(limitIssue('snapshot.slides', snapshot.slides.length, bounds.maxSlides));
  }
  if (snapshot.elements.length > bounds.maxElements) {
    issues.push(limitIssue('snapshot.elements', snapshot.elements.length, bounds.maxElements));
  }
  if (snapshot.sources.length > bounds.maxSources) {
    issues.push(limitIssue('snapshot.sources', snapshot.sources.length, bounds.maxSources));
  }

  const slides = byId(snapshot.slides);
  const elements = byId(snapshot.elements);
  const sources = byId(snapshot.sources);
  checkUniqueIds(snapshot.slides, 'snapshot.slides', issues);
  checkUniqueIds(snapshot.elements, 'snapshot.elements', issues);
  checkUniqueIds(snapshot.sources, 'snapshot.sources', issues);
  checkCanonicalOrder(
    snapshot.deck.slideOrder,
    snapshot.slides.map((slide) => slide.id),
    'snapshot.deck.slideOrder',
    issues,
  );

  for (const slide of snapshot.slides) {
    if (slide.deckId !== snapshot.deck.id) {
      issues.push(
        invalidIssue(
          `snapshot.slides.${slide.id}.deckId`,
          'Slide deckId must match snapshot.deck.id.',
        ),
      );
    }
    const slideElements = snapshot.elements.filter((element) => element.slideId === slide.id);
    if (slideElements.length > bounds.maxElementsPerSlide) {
      issues.push(
        limitIssue(
          `snapshot.slides.${slide.id}.elementOrder`,
          slideElements.length,
          bounds.maxElementsPerSlide,
        ),
      );
    }
    checkCanonicalOrder(
      slide.elementOrder,
      slideElements.map((element) => element.id),
      `snapshot.slides.${slide.id}.elementOrder`,
      issues,
    );
    validateGroups(slide, slideElements, issues);
  }
  for (const element of snapshot.elements) {
    if (!slides.has(element.slideId)) {
      issues.push(
        invalidIssue(
          `snapshot.elements.${element.id}.slideId`,
          `Unknown slide ${element.slideId}.`,
        ),
      );
    }
    if (
      element.bbox.x < 0 ||
      element.bbox.y < 0 ||
      element.bbox.width <= 0 ||
      element.bbox.height <= 0 ||
      element.bbox.x + element.bbox.width > 1 ||
      element.bbox.y + element.bbox.height > 1
    ) {
      issues.push(
        invalidIssue(
          `snapshot.elements.${element.id}.bbox`,
          'Bounding boxes must use normalized in-slide coordinates with positive width and height.',
        ),
      );
    }
    if (new Set(element.sourceIds).size !== element.sourceIds.length) {
      issues.push(
        invalidIssue(
          `snapshot.elements.${element.id}.sourceIds`,
          'Element sourceIds must be unique.',
        ),
      );
    }
    for (const sourceId of elementSourceReferences(element)) {
      if (!sources.has(sourceId)) {
        issues.push(
          invalidIssue(`snapshot.elements.${element.id}.sourceIds`, `Unknown source ${sourceId}.`),
        );
      }
    }
  }
  for (const source of snapshot.sources) {
    if (source.deckId !== snapshot.deck.id) {
      issues.push(
        invalidIssue(
          `snapshot.sources.${source.id}.deckId`,
          'Source deckId must match snapshot.deck.id.',
        ),
      );
    }
  }
  if (
    elements.size !== snapshot.elements.length ||
    slides.size !== snapshot.slides.length ||
    sources.size !== snapshot.sources.length
  ) {
    // Duplicate-specific issues above carry the useful paths.
  }
  return issues;
}

function validateGroups(
  slide: Slide,
  elements: readonly SlideElement[],
  issues: NodeSlideJsonIssue[],
): void {
  const groups = groupsForSlide(slide, byId(elements));
  for (const [groupId, elementIds] of groups) {
    if (elementIds.length < 2 || elementIds.length > NODESLIDE_GROUP_MEMBER_LIMIT) {
      issues.push(
        invalidIssue(
          `snapshot.slides.${slide.id}.elementOrder`,
          `Group ${groupId} must contain 2-${NODESLIDE_GROUP_MEMBER_LIMIT} elements.`,
        ),
      );
      continue;
    }
    const indexes = elementIds
      .map((id) => slide.elementOrder.indexOf(id))
      .sort((left, right) => left - right);
    if (
      indexes.some((index, position) => position > 0 && index !== (indexes[position - 1] ?? 0) + 1)
    ) {
      issues.push(
        invalidIssue(
          `snapshot.slides.${slide.id}.elementOrder`,
          `Group ${groupId} must be contiguous.`,
        ),
      );
    }
  }
}

function checkUniqueIds(
  values: readonly { id: string }[],
  path: string,
  issues: NodeSlideJsonIssue[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id))
      issues.push(invalidIssue(`${path}.${value.id}`, `Duplicate ID ${value.id}.`));
    seen.add(value.id);
  }
}

function checkCanonicalOrder(
  order: readonly string[],
  expectedIds: readonly string[],
  path: string,
  issues: NodeSlideJsonIssue[],
): void {
  const orderSet = new Set(order);
  const expectedSet = new Set(expectedIds);
  if (
    orderSet.size !== order.length ||
    order.length !== expectedIds.length ||
    [...orderSet].some((id) => !expectedSet.has(id))
  ) {
    issues.push(invalidIssue(path, 'Order must contain every corresponding ID exactly once.'));
  }
}

function elementSourceReferences(element: SlideElement): string[] {
  return [
    ...element.sourceIds,
    ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ...(element.math?.sourceId ? [element.math.sourceId] : []),
    ...(element.image?.sourceId ? [element.image.sourceId] : []),
  ];
}

function resolveBounds(bounds?: Partial<NodeSlideJsonBounds>): NodeSlideJsonBounds {
  return {
    maxInputBytes: boundedLimit(bounds?.maxInputBytes, NODESLIDE_JSON_LIMITS.maxInputBytes),
    maxSlides: boundedLimit(bounds?.maxSlides, NODESLIDE_JSON_LIMITS.maxSlides),
    maxElementsPerSlide: boundedLimit(
      bounds?.maxElementsPerSlide,
      NODESLIDE_JSON_LIMITS.maxElementsPerSlide,
    ),
    maxElements: boundedLimit(bounds?.maxElements, NODESLIDE_JSON_LIMITS.maxElements),
    maxSources: boundedLimit(bounds?.maxSources, NODESLIDE_JSON_LIMITS.maxSources),
    maxOperations: boundedLimit(bounds?.maxOperations, NODESLIDE_JSON_LIMITS.maxOperations),
  };
}

function boundedLimit(value: number | undefined, hardLimit: number): number {
  if (value === undefined || !Number.isFinite(value)) return hardLimit;
  return Math.max(1, Math.min(hardLimit, Math.trunc(value)));
}

function previewSnapshot(snapshot: DeckSnapshot): NodeSlideJsonPreview {
  const elementKinds: Record<ElementKind, number> = {
    text: 0,
    shape: 0,
    image: 0,
    chart: 0,
    math: 0,
    video: 0,
    connector: 0,
  };
  for (const element of snapshot.elements) elementKinds[element.kind] += 1;
  return {
    deckId: snapshot.deck.id,
    title: snapshot.deck.title,
    schemaVersion: snapshot.deck.schemaVersion,
    slideCount: snapshot.slides.length,
    elementCount: snapshot.elements.length,
    sourceCount: snapshot.sources.length,
    elementKinds,
  };
}

function exactFidelity(exactOperationCount: number): NodeSlideJsonFidelityReport {
  return { fidelity: 'exact', canApply: true, exactOperationCount, findings: [] };
}

function diffSuccess(
  operations: PatchOperation[],
  preview: NodeSlideJsonDiffPreview,
  findings: NodeSlideJsonFidelityFinding[],
): NodeSlideJsonDiffSuccess {
  const unsupported = findings.some((finding) => finding.fidelity === 'unsupported');
  const regenerated = findings.some((finding) => finding.fidelity === 'regenerated_metadata');
  return {
    ok: true,
    operations,
    preview,
    fidelity: {
      fidelity: unsupported ? 'unsupported' : regenerated ? 'regenerated_metadata' : 'exact',
      canApply: !unsupported,
      exactOperationCount: operations.length,
      findings,
    },
  };
}

function emptyDiffPreview(): NodeSlideJsonDiffPreview {
  return {
    deckTitleChanged: false,
    slidesAdded: 0,
    slidesRemoved: 0,
    slidesUpdated: 0,
    slidesReordered: 0,
    elementsAdded: 0,
    elementsRemoved: 0,
    elementsUpdated: 0,
    elementsReordered: 0,
    requiredOperationCount: 0,
  };
}

function failure(
  code: NodeSlideJsonIssueCode,
  path: string,
  message: string,
): NodeSlideJsonFailure {
  return { ok: false, issues: [{ code, path, message }] };
}

function invalidIssue(path: string, message: string): NodeSlideJsonIssue {
  return { code: 'invalid_snapshot', path, message };
}

function limitIssue(path: string, actual: number, limit: number): NodeSlideJsonIssue {
  return { code: 'limit_exceeded', path, message: `${actual} items exceed the limit of ${limit}.` };
}

function zodPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '$' : `$.${path.map(String).join('.')}`;
}

function byId<T extends { id: string }>(values: readonly T[]): Map<string, T> {
  return new Map(values.map((value) => [value.id, value]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left)
    .filter((key) => left[key] !== undefined)
    .sort();
  const rightKeys = Object.keys(right)
    .filter((key) => right[key] !== undefined)
    .sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]))
  );
}

function sameElementContent(left: SlideElement, right: SlideElement): boolean {
  const { version: _leftVersion, ...leftContent } = left;
  const { version: _rightVersion, ...rightContent } = right;
  return sameValue(leftContent, rightContent);
}

function styleRequiresReplacement(
  current: SlideElement['style'],
  imported: SlideElement['style'],
): boolean {
  return Object.keys(current).some(
    (key) => !(key in imported) && current[key as keyof SlideElement['style']] !== undefined,
  );
}

function chartRequiresReplacement(current: SlideElement, imported: SlideElement): boolean {
  if (sameValue(current.chart, imported.chart)) return false;
  return imported.kind !== 'chart' || imported.chart === undefined;
}

function imageRequiresReplacement(current: SlideElement, imported: SlideElement): boolean {
  if (imported.kind !== 'image')
    return (
      !sameValue(current.image, imported.image) ||
      current.imageUrl !== imported.imageUrl ||
      current.altText !== imported.altText
    );
  if (!imageOperationNeeded(current, imported)) return false;
  if (
    imported.imageUrl === undefined ||
    imported.altText === undefined ||
    imported.image?.placeholder !== false
  )
    return true;
  if (imported.image.credit === '') return true;
  return current.image?.sourceId !== imported.image.sourceId;
}

function imageOperationNeeded(current: SlideElement, imported: SlideElement): boolean {
  return (
    current.imageUrl !== imported.imageUrl ||
    current.altText !== imported.altText ||
    !sameValue(current.image, imported.image) ||
    !sameValue(current.sourceIds, imported.sourceIds)
  );
}

function withoutGroup(element: SlideElement): SlideElement {
  const clone = structuredClone(element);
  // biome-ignore lint/performance/noDelete: add_element explicitly rejects partial group membership.
  delete clone.groupId;
  return clone;
}

function groupsForSlide(
  slide: Slide,
  elements: ReadonlyMap<string, SlideElement>,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const elementId of slide.elementOrder) {
    const groupId = elements.get(elementId)?.groupId;
    if (!groupId) continue;
    const members = groups.get(groupId) ?? [];
    members.push(elementId);
    groups.set(groupId, members);
  }
  return groups;
}

function groupedElements(
  slide: Slide,
  elements: ReadonlyMap<string, SlideElement>,
): SlideElement[] {
  return slide.elementOrder.flatMap((id) => {
    const element = elements.get(id);
    return element?.groupId ? [element] : [];
  });
}

function hasAnyGroups(
  currentSlide: Slide,
  importedSlide: Slide,
  currentElements: ReadonlyMap<string, SlideElement>,
  importedElements: ReadonlyMap<string, SlideElement>,
): boolean {
  return (
    groupedElements(currentSlide, currentElements).length > 0 ||
    groupedElements(importedSlide, importedElements).length > 0
  );
}

function sameGroupAssignments(
  currentSlide: Slide,
  importedSlide: Slide,
  currentElements: ReadonlyMap<string, SlideElement>,
  importedElements: ReadonlyMap<string, SlideElement>,
): boolean {
  const ids = new Set([...currentSlide.elementOrder, ...importedSlide.elementOrder]);
  return [...ids].every(
    (id) => currentElements.get(id)?.groupId === importedElements.get(id)?.groupId,
  );
}
