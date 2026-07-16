import type {
  DeckSnapshot,
  NodeSlideClaimSourceBinding,
  SlideElement,
  SourceRecord,
} from '../../shared/nodeslide';
import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_SOURCE_REFRESH_BATCH_LIMIT = 8 as const;

export type NodeSlideSourceChangeKind =
  | 'unchanged'
  | 'created'
  | 'updated'
  | 'removed'
  | 'replaced'
  | 'superseded';

/**
 * Explicitly relates snapshots whose persisted source IDs differ. Requiring the
 * pair prevents two unrelated sources from being interpreted as one revision.
 */
export interface NodeSlideSourceTransitionHint {
  kind: 'replacement' | 'supersession';
  beforeSourceId: string;
  afterSourceId: string;
  reason?: string;
}

/** A content-addressed logical revision; no SourceRecord schema field is needed. */
export interface NodeSlideSourceLogicalRevision {
  sourceId: string;
  deckId: string;
  revisionId: string;
  digest: string;
  retrievedAt: number;
  contentDigest?: string;
}

export interface NodeSlideSourceChangeDescriptor {
  kind: NodeSlideSourceChangeKind;
  logicalSourceId: string;
  beforeRevision?: NodeSlideSourceLogicalRevision;
  afterRevision?: NodeSlideSourceLogicalRevision;
  changedFields: Array<keyof SourceRecord>;
  /** Timestamp-only retrieval bookkeeping creates a revision but not stale deck content. */
  material: boolean;
  affectedSourceIds: string[];
  digest: string;
  reason: string;
  transitionHint?: NodeSlideSourceTransitionHint;
}

export interface NodeSlideAffectedSourceClaim {
  operationIndex: number;
  operation: NodeSlideClaimSourceBinding['operation'];
  slideId: string;
  elementId: string;
  sourceIds: string[];
  matchedSourceIds: string[];
  claimDigest: string;
  reason: string;
}

export interface NodeSlideAffectedSourceElement {
  slideId: string;
  elementId: string;
  sourceIds: string[];
  claimDigests: string[];
  reasons: Array<'element_source_binding' | 'claim_source_binding'>;
  reason: string;
}

export interface NodeSlideAffectedSourceSlide {
  slideId: string;
  elementIds: string[];
  claimDigests: string[];
  reason: string;
}

/** A proposal work item, deliberately not a PatchOperation or an implicit write. */
export interface NodeSlideSourceRefreshOperation {
  kind: 'refresh_source_bound_element';
  slideId: string;
  elementId: string;
  sourceIds: string[];
  claimDigests: string[];
  replacementSourceId?: string;
  reason: string;
}

export interface NodeSlideSourceRefreshBatch {
  index: number;
  operations: NodeSlideSourceRefreshOperation[];
  reason: string;
}

export interface NodeSlideSourceRefreshPlan {
  change: NodeSlideSourceChangeDescriptor;
  affectedSlides: NodeSlideAffectedSourceSlide[];
  affectedElements: NodeSlideAffectedSourceElement[];
  affectedClaims: NodeSlideAffectedSourceClaim[];
  batches: NodeSlideSourceRefreshBatch[];
  operationCount: number;
  digest: string;
  reason: string;
}

export interface DetectNodeSlideSourceChangeArgs {
  before: SourceRecord | null;
  after: SourceRecord | null;
  transitionHint?: NodeSlideSourceTransitionHint;
}

export interface PlanNodeSlideSourceRefreshArgs extends DetectNodeSlideSourceChangeArgs {
  snapshot: DeckSnapshot;
  claimSourceBindings?: readonly NodeSlideClaimSourceBinding[];
}

const SOURCE_FIELDS = [
  'id',
  'deckId',
  'title',
  'url',
  'sourceType',
  'retrievedAt',
  'citation',
  'license',
  'format',
  'contentDigest',
  'byteSize',
  'rowCount',
  'columns',
  'provider',
  'retention',
  'status',
  'lastRefreshedAt',
] as const satisfies readonly (keyof SourceRecord)[];

const BOOKKEEPING_FIELDS = new Set<keyof SourceRecord>(['retrievedAt', 'lastRefreshedAt']);

export function nodeSlideSourceLogicalRevision(
  source: SourceRecord,
): NodeSlideSourceLogicalRevision {
  const digest = nodeslideContentDigest(stableJson(source));
  return {
    sourceId: source.id,
    deckId: source.deckId,
    revisionId: `source-revision:${digest}`,
    digest,
    retrievedAt: source.retrievedAt,
    ...(source.contentDigest ? { contentDigest: source.contentDigest } : {}),
  };
}

/** Detects a source transition without mutating either supplied snapshot. */
export function detectNodeSlideSourceChange(
  args: DetectNodeSlideSourceChangeArgs,
): NodeSlideSourceChangeDescriptor {
  const { before, after, transitionHint } = args;
  if (!before && !after)
    throw new Error('Source change detection requires a before or after source.');
  if (before && after && before.deckId !== after.deckId) {
    throw new Error('Source revisions must belong to the same deck.');
  }

  validateTransitionHint(before, after, transitionHint);

  const beforeRevision = before ? nodeSlideSourceLogicalRevision(before) : undefined;
  const afterRevision = after ? nodeSlideSourceLogicalRevision(after) : undefined;
  const changedFields = changedSourceFields(before, after);
  const kind = sourceChangeKind(before, after, beforeRevision, afterRevision, transitionHint);
  const material =
    kind !== 'unchanged' &&
    (kind !== 'updated' || changedFields.some((field) => !BOOKKEEPING_FIELDS.has(field)));
  const affectedSourceIds = material
    ? uniqueSorted([before?.id, after?.id].filter((id): id is string => Boolean(id)))
    : [];
  const logicalSourceId = before?.id ?? after?.id ?? '';
  const reason = changeReason(kind, material, changedFields, transitionHint);
  const descriptorForDigest = {
    kind,
    logicalSourceId,
    beforeRevision: beforeRevision?.digest ?? null,
    afterRevision: afterRevision?.digest ?? null,
    changedFields,
    material,
    affectedSourceIds,
    transitionHint: transitionHint ?? null,
  };

  return {
    kind,
    logicalSourceId,
    ...(beforeRevision ? { beforeRevision } : {}),
    ...(afterRevision ? { afterRevision } : {}),
    changedFields,
    material,
    affectedSourceIds,
    digest: nodeslideContentDigest(stableJson(descriptorForDigest)),
    reason,
    ...(transitionHint ? { transitionHint: { ...transitionHint } } : {}),
  };
}

/**
 * Joins a logical source change to current element and claim bindings. Output is
 * deterministic and proposal-only; callers decide how each work item is executed.
 */
export function planNodeSlideSourceRefresh(
  args: PlanNodeSlideSourceRefreshArgs,
): NodeSlideSourceRefreshPlan {
  const change = detectNodeSlideSourceChange(args);
  assertDeckScope(args.snapshot, args.before, args.after);

  const affectedSourceIds = new Set(change.affectedSourceIds);
  const slideRank = rank(args.snapshot.deck.slideOrder);
  const slideById = new Map(args.snapshot.slides.map((slide) => [slide.id, slide]));
  const elementById = new Map(args.snapshot.elements.map((element) => [element.id, element]));
  const elementOrderRank = new Map<string, number>();
  for (const slide of args.snapshot.slides) {
    slide.elementOrder.forEach((elementId, index) => elementOrderRank.set(elementId, index));
  }

  const affectedClaims = deduplicateClaims(
    (args.claimSourceBindings ?? []).flatMap((binding): NodeSlideAffectedSourceClaim[] => {
      const element = elementById.get(binding.elementId);
      if (!element || element.slideId !== binding.slideId || !slideById.has(binding.slideId))
        return [];
      const matchedSourceIds = uniqueSorted(
        binding.sourceIds.filter((sourceId) => affectedSourceIds.has(sourceId)),
      );
      if (matchedSourceIds.length === 0) return [];
      return [
        {
          operationIndex: binding.operationIndex,
          operation: binding.operation,
          slideId: binding.slideId,
          elementId: binding.elementId,
          sourceIds: uniqueSorted(binding.sourceIds),
          matchedSourceIds,
          claimDigest: binding.claimDigest,
          reason: `Claim ${binding.claimDigest} is bound to changed source ${matchedSourceIds.join(', ')}.`,
        },
      ];
    }),
  ).sort((left, right) => compareImpact(left, right, slideRank, elementOrderRank));

  const claimsByElement = groupClaimsByElement(affectedClaims);
  const affectedElements = args.snapshot.elements
    .flatMap((element): NodeSlideAffectedSourceElement[] => {
      if (!slideById.has(element.slideId)) return [];
      const directlyMatchedSourceIds = boundSourceIds(element).filter((sourceId) =>
        affectedSourceIds.has(sourceId),
      );
      const claims = claimsByElement.get(element.id) ?? [];
      const sourceIds = uniqueSorted([
        ...directlyMatchedSourceIds,
        ...claims.flatMap((claim) => claim.matchedSourceIds),
      ]);
      if (sourceIds.length === 0) return [];
      const reasons: NodeSlideAffectedSourceElement['reasons'] = [];
      if (directlyMatchedSourceIds.length > 0) reasons.push('element_source_binding');
      if (claims.length > 0) reasons.push('claim_source_binding');
      const claimDigests = uniqueSorted(claims.map((claim) => claim.claimDigest));
      return [
        {
          slideId: element.slideId,
          elementId: element.id,
          sourceIds,
          claimDigests,
          reasons,
          reason: elementReason(sourceIds, claimDigests),
        },
      ];
    })
    .sort((left, right) => compareImpact(left, right, slideRank, elementOrderRank));

  const affectedSlides = buildAffectedSlides(affectedElements, slideRank);
  const replacementSourceId = replacementTarget(change);
  const operations = affectedElements.map(
    (element): NodeSlideSourceRefreshOperation => ({
      kind: 'refresh_source_bound_element',
      slideId: element.slideId,
      elementId: element.elementId,
      sourceIds: [...element.sourceIds],
      claimDigests: [...element.claimDigests],
      ...(replacementSourceId ? { replacementSourceId } : {}),
      reason: `${element.reason} ${change.reason}`,
    }),
  );
  const batches = chunkOperations(operations);
  const reason = planReason(change, affectedElements.length);
  const planForDigest = {
    changeDigest: change.digest,
    affectedSlides,
    affectedElements,
    affectedClaims,
    batches,
    operationCount: operations.length,
  };

  return {
    change,
    affectedSlides,
    affectedElements,
    affectedClaims,
    batches,
    operationCount: operations.length,
    digest: nodeslideContentDigest(stableJson(planForDigest)),
    reason,
  };
}

function validateTransitionHint(
  before: SourceRecord | null,
  after: SourceRecord | null,
  hint: NodeSlideSourceTransitionHint | undefined,
): void {
  if (before && after && before.id !== after.id && !hint) {
    throw new Error('Different source IDs require an explicit replacement or supersession hint.');
  }
  if (!hint) return;
  if (!before || !after) {
    throw new Error('A source transition hint requires both before and after sources.');
  }
  if (
    hint.beforeSourceId !== before.id ||
    hint.afterSourceId !== after.id ||
    hint.beforeSourceId === hint.afterSourceId
  ) {
    throw new Error('Source transition hint IDs must exactly match distinct source snapshots.');
  }
  if (hint.reason !== undefined && !hint.reason.trim()) {
    throw new Error('Source transition hint reason must be non-empty when supplied.');
  }
}

function assertDeckScope(
  snapshot: DeckSnapshot,
  before: SourceRecord | null,
  after: SourceRecord | null,
): void {
  for (const source of [before, after]) {
    if (source && source.deckId !== snapshot.deck.id) {
      throw new Error('Source refresh planning is restricted to the snapshot deck.');
    }
  }
}

function sourceChangeKind(
  before: SourceRecord | null,
  after: SourceRecord | null,
  beforeRevision: NodeSlideSourceLogicalRevision | undefined,
  afterRevision: NodeSlideSourceLogicalRevision | undefined,
  hint: NodeSlideSourceTransitionHint | undefined,
): NodeSlideSourceChangeKind {
  if (!before) return 'created';
  if (!after) return 'removed';
  if (hint) return hint.kind === 'replacement' ? 'replaced' : 'superseded';
  return beforeRevision?.digest === afterRevision?.digest ? 'unchanged' : 'updated';
}

function changedSourceFields(
  before: SourceRecord | null,
  after: SourceRecord | null,
): Array<keyof SourceRecord> {
  if (!before || !after) return [...SOURCE_FIELDS];
  return SOURCE_FIELDS.filter((field) => stableJson(before[field]) !== stableJson(after[field]));
}

function changeReason(
  kind: NodeSlideSourceChangeKind,
  material: boolean,
  changedFields: readonly (keyof SourceRecord)[],
  hint: NodeSlideSourceTransitionHint | undefined,
): string {
  if (kind === 'unchanged') return 'The source snapshots resolve to the same logical revision.';
  if (!material) {
    return `Only source retrieval bookkeeping changed (${changedFields.join(', ')}); deck content is not stale.`;
  }
  if (kind === 'created')
    return 'A source was created and its current bindings require refresh review.';
  if (kind === 'removed')
    return 'A bound source was removed and its dependent content requires review.';
  if (kind === 'replaced' || kind === 'superseded') {
    const transition =
      hint?.reason?.trim() ?? `Source ${hint?.beforeSourceId} -> ${hint?.afterSourceId}`;
    return `${kind === 'replaced' ? 'Replacement' : 'Supersession'}: ${transition}.`;
  }
  return `Source fields changed (${changedFields.join(', ')}), creating a new logical revision.`;
}

function replacementTarget(change: NodeSlideSourceChangeDescriptor): string | undefined {
  return change.kind === 'replaced' || change.kind === 'superseded'
    ? change.transitionHint?.afterSourceId
    : undefined;
}

function boundSourceIds(element: SlideElement): string[] {
  return uniqueSorted(
    [
      ...element.sourceIds,
      element.chart?.sourceId,
      element.math?.sourceId,
      element.image?.sourceId,
    ].filter((sourceId): sourceId is string => Boolean(sourceId)),
  );
}

function deduplicateClaims(
  claims: readonly NodeSlideAffectedSourceClaim[],
): NodeSlideAffectedSourceClaim[] {
  const unique = new Map<string, NodeSlideAffectedSourceClaim>();
  for (const claim of claims) {
    const key = stableJson({
      operationIndex: claim.operationIndex,
      operation: claim.operation,
      slideId: claim.slideId,
      elementId: claim.elementId,
      sourceIds: claim.sourceIds,
      claimDigest: claim.claimDigest,
    });
    if (!unique.has(key)) unique.set(key, claim);
  }
  return [...unique.values()];
}

function groupClaimsByElement(
  claims: readonly NodeSlideAffectedSourceClaim[],
): Map<string, NodeSlideAffectedSourceClaim[]> {
  const grouped = new Map<string, NodeSlideAffectedSourceClaim[]>();
  for (const claim of claims) {
    const existing = grouped.get(claim.elementId) ?? [];
    existing.push(claim);
    grouped.set(claim.elementId, existing);
  }
  return grouped;
}

function buildAffectedSlides(
  elements: readonly NodeSlideAffectedSourceElement[],
  slideRank: ReadonlyMap<string, number>,
): NodeSlideAffectedSourceSlide[] {
  const grouped = new Map<string, NodeSlideAffectedSourceElement[]>();
  for (const element of elements) {
    const existing = grouped.get(element.slideId) ?? [];
    existing.push(element);
    grouped.set(element.slideId, existing);
  }
  return [...grouped.entries()]
    .map(([slideId, slideElements]) => {
      const elementIds = slideElements.map((element) => element.elementId);
      const claimDigests = uniqueSorted(slideElements.flatMap((element) => element.claimDigests));
      return {
        slideId,
        elementIds,
        claimDigests,
        reason: `${elementIds.length} source-bound element${elementIds.length === 1 ? '' : 's'} require refresh review.`,
      };
    })
    .sort(
      (left, right) =>
        (slideRank.get(left.slideId) ?? Number.MAX_SAFE_INTEGER) -
          (slideRank.get(right.slideId) ?? Number.MAX_SAFE_INTEGER) ||
        left.slideId.localeCompare(right.slideId),
    );
}

function elementReason(sourceIds: readonly string[], claimDigests: readonly string[]): string {
  const claimReason =
    claimDigests.length > 0
      ? ` It carries ${claimDigests.length} affected claim${claimDigests.length === 1 ? '' : 's'}.`
      : '';
  return `Element is bound to changed source ${sourceIds.join(', ')}.${claimReason}`;
}

function planReason(change: NodeSlideSourceChangeDescriptor, operationCount: number): string {
  if (!change.material) return `${change.reason} No refresh operations were planned.`;
  if (operationCount === 0) {
    return `${change.reason} No slide elements or claims are bound to the affected source IDs.`;
  }
  return `${change.reason} Planned ${operationCount} bounded refresh operation${operationCount === 1 ? '' : 's'}.`;
}

function chunkOperations(
  operations: readonly NodeSlideSourceRefreshOperation[],
): NodeSlideSourceRefreshBatch[] {
  const batches: NodeSlideSourceRefreshBatch[] = [];
  for (let start = 0; start < operations.length; start += NODESLIDE_SOURCE_REFRESH_BATCH_LIMIT) {
    const batchOperations = operations
      .slice(start, start + NODESLIDE_SOURCE_REFRESH_BATCH_LIMIT)
      .map((operation) => ({ ...operation }));
    batches.push({
      index: batches.length,
      operations: batchOperations,
      reason: `Bounded refresh batch ${batches.length + 1} contains ${batchOperations.length} operation${batchOperations.length === 1 ? '' : 's'}.`,
    });
  }
  return batches;
}

function compareImpact(
  left: { slideId: string; elementId: string; operationIndex?: number; claimDigest?: string },
  right: { slideId: string; elementId: string; operationIndex?: number; claimDigest?: string },
  slideRank: ReadonlyMap<string, number>,
  elementRank: ReadonlyMap<string, number>,
): number {
  return (
    (slideRank.get(left.slideId) ?? Number.MAX_SAFE_INTEGER) -
      (slideRank.get(right.slideId) ?? Number.MAX_SAFE_INTEGER) ||
    left.slideId.localeCompare(right.slideId) ||
    (elementRank.get(left.elementId) ?? Number.MAX_SAFE_INTEGER) -
      (elementRank.get(right.elementId) ?? Number.MAX_SAFE_INTEGER) ||
    left.elementId.localeCompare(right.elementId) ||
    (left.operationIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.operationIndex ?? Number.MAX_SAFE_INTEGER) ||
    (left.claimDigest ?? '').localeCompare(right.claimDigest ?? '')
  );
}

function rank(ids: readonly string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, index]));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
