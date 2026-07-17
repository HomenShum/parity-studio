import type {
  DeckSnapshot,
  SlideElement,
  ValidationIssue,
  ValidationResult,
} from '../../shared/nodeslide';
import { NODESLIDE_TOOLCHAIN_VERSION } from '../../shared/nodeslide';
import {
  type NodeSlidePresentationQualityReceipt,
  verifyNodeSlidePresentationQualityReceipt,
} from '../../shared/nodeslideAuthoringQuality';
import { nodeslideArtifactPresenceChecks } from './nodeslideArtifactPresence';
import {
  type NodeSlideSemanticCoverageReceipt,
  nodeSlideCandidateDigest,
  nodeSlideSemanticCoverageReceiptMatches,
} from './nodeslideCandidate';
import { nodeslideContentDigest, nodeslideStableId } from './nodeslideIds';
import {
  type NodeSlideSemanticEvaluationOptions,
  type NodeSlideSemanticFinding,
  evaluateNodeSlideSemantics,
} from './nodeslideSemanticEvaluation';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

export const NODESLIDE_DECK_CI_SCHEMA_VERSION = 'nodeslide.deck-ci/v1' as const;

export type NodeSlideDeckCiStatus = 'pass' | 'warn' | 'fail';
export type NodeSlideDeckCiSeverity = 'critical' | 'error' | 'warning' | 'info';
export type NodeSlideDeckCiCategory =
  | 'evidence'
  | 'claims'
  | 'source_binding'
  | 'layout'
  | 'structure'
  | 'export';
export type NodeSlideDeckCiOrigin =
  | 'semantic'
  | 'presentation_quality'
  | 'validation'
  | 'layout_structure_hook'
  | 'export_readiness_hook';

export interface NodeSlideDeckCiCheck {
  id: string;
  code: string;
  category: NodeSlideDeckCiCategory;
  origin: NodeSlideDeckCiOrigin;
  severity: NodeSlideDeckCiSeverity;
  blocker: boolean;
  message: string;
  slideIds: string[];
  elementIds: string[];
  sourceIds: string[];
}

/**
 * Result supplied by a pure layout/structure or export adapter. Passing adapter output rather
 * than an I/O callback keeps Deck CI replayable in tests, workers, and durable jobs.
 */
export interface NodeSlideDeckCiHookCheckInput {
  code: string;
  status: 'pass' | 'warning' | 'fail';
  message: string;
  /** Failed hook checks block by default. Warnings and passes do not. */
  blocker?: boolean;
  slideIds?: readonly string[];
  elementIds?: readonly string[];
  sourceIds?: readonly string[];
}

export interface NodeSlideDeckCiOptions {
  /** Defaults to the persisted deck update time; wall-clock time is never read. */
  referenceTime?: number;
  /** Optional authoritative receipt. Stale/mismatched receipts fail closed and are recomputed. */
  validation?: ValidationResult;
  semantic?: Omit<NodeSlideSemanticEvaluationOptions, 'referenceTime' | 'evaluatedAt'>;
  /** Pure integration input for render-aware layout and structure checks. */
  layoutStructureChecks?: readonly NodeSlideDeckCiHookCheckInput[];
  /** Pure integration input for renderer- or format-specific export checks. */
  exportReadinessChecks?: readonly NodeSlideDeckCiHookCheckInput[];
  /** Source revisions in the triggering change; used only to calculate dependency impact. */
  changedSourceIds?: readonly string[];
  /** Exact planner-intent coverage for this materialized candidate. */
  semanticCoverage?: NodeSlideSemanticCoverageReceipt;
  /** Optional release-quality receipt. When supplied it must bind to this exact deck version. */
  presentationQuality?: NodeSlidePresentationQualityReceipt;
}

export interface NodeSlideDeckCiInput extends NodeSlideDeckCiOptions {
  snapshot: DeckSnapshot;
}

export interface NodeSlideDeckCiResult {
  schemaVersion: typeof NODESLIDE_DECK_CI_SCHEMA_VERSION;
  deckId: string;
  deckVersion: number;
  snapshotDigest: string;
  referenceTime: number;
  status: NodeSlideDeckCiStatus;
  checks: NodeSlideDeckCiCheck[];
  blockerCount: number;
  severityCounts: Record<NodeSlideDeckCiSeverity, number>;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  affectedSourceIds: string[];
  changedSourceImpact: {
    changedSourceIds: string[];
    boundSourceIds: string[];
    unboundSourceIds: string[];
    missingSourceIds: string[];
    slideIds: string[];
    elementIds: string[];
  };
  validation: {
    id: string;
    supplied: boolean;
    inputAccepted: boolean;
    ok: boolean;
    publishOk: boolean;
    cleanOk: boolean;
  };
  semantic: {
    id: string;
    verdict: 'pass' | 'advisory' | 'blocked';
  };
  presentationQuality?: {
    digest: string;
    status: NodeSlidePresentationQualityReceipt['status'];
    overall: number;
    blockerCount: number;
  };
  digest: string;
}

/**
 * Turbo is deliberately stricter than publication readiness alone. A candidate
 * may auto-commit only when the complete deterministic Deck CI receipt is a
 * clean pass for the exact materialized snapshot. Warnings remain reviewable.
 */
export function nodeSlideDeckCiAllowsAutoCommit(
  result: Pick<NodeSlideDeckCiResult, 'status' | 'blockerCount' | 'validation'>,
): boolean {
  return (
    result.status === 'pass' &&
    result.blockerCount === 0 &&
    result.validation.ok &&
    result.validation.publishOk &&
    result.validation.cleanOk
  );
}

const SEMANTIC_CODES = new Set([
  'factual_claim_unbound',
  'source_evidence_incomplete',
  'source_failed',
  'source_missing',
  'source_reference_missing',
  'source_refreshing',
  'source_stale',
  'source_timestamp_invalid',
]);

const SEVERITY_RANK: Record<NodeSlideDeckCiSeverity, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

const CATEGORY_RANK: Record<NodeSlideDeckCiCategory, number> = {
  evidence: 0,
  claims: 1,
  source_binding: 2,
  structure: 3,
  layout: 4,
  export: 5,
};

export function evaluateNodeSlideDeckCi(input: NodeSlideDeckCiInput): NodeSlideDeckCiResult;
export function evaluateNodeSlideDeckCi(
  snapshot: DeckSnapshot,
  options?: NodeSlideDeckCiOptions,
): NodeSlideDeckCiResult;
export function evaluateNodeSlideDeckCi(
  input: NodeSlideDeckCiInput | DeckSnapshot,
  options: NodeSlideDeckCiOptions = {},
): NodeSlideDeckCiResult {
  const { snapshot, resolvedOptions } = normalizeInput(input, options);
  const referenceTime = resolvedReferenceTime(snapshot, resolvedOptions.referenceTime);
  const snapshotDigest = nodeSlideCandidateDigest(snapshot);
  const validationInputAccepted = validationMatchesSnapshot(snapshot, resolvedOptions.validation);
  const validation = validationInputAccepted
    ? (resolvedOptions.validation as ValidationResult)
    : validateNodeSlideSnapshot(snapshot, referenceTime);
  const semantic = evaluateNodeSlideSemantics(
    { kind: 'snapshot', snapshot },
    {
      ...resolvedOptions.semantic,
      referenceTime,
    },
  );

  const drafts: CheckDraft[] = [];
  if (resolvedOptions.validation && !validationInputAccepted) {
    drafts.push({
      code: 'validation_input_mismatch',
      category: 'structure',
      origin: 'validation',
      severity: 'error',
      blocker: true,
      message:
        'The supplied validation receipt does not match this exact deck version and toolchain.',
      slideIds: [],
      elementIds: [],
      sourceIds: [],
    });
  }
  if (resolvedOptions.semanticCoverage) {
    drafts.push(...checksFromSemanticCoverage(snapshot, resolvedOptions.semanticCoverage));
  }
  if (resolvedOptions.presentationQuality) {
    drafts.push(...checksFromPresentationQuality(snapshot, resolvedOptions.presentationQuality));
  }
  for (const finding of semantic.findings) {
    if (SEMANTIC_CODES.has(finding.code)) drafts.push(checkFromSemanticFinding(finding));
  }
  drafts.push(...checksFromValidation(snapshot, validation));
  drafts.push(
    ...checksFromHookInputs(
      'layout_structure_hook',
      // Artifact presence is computed here, not caller-supplied, so no Deck CI run
      // can skip verifying that every ordered element actually renders.
      [
        ...nodeslideArtifactPresenceChecks(snapshot),
        ...(resolvedOptions.layoutStructureChecks ?? []),
      ],
      'layout',
    ),
    ...checksFromHookInputs(
      'export_readiness_hook',
      resolvedOptions.exportReadinessChecks,
      'export',
    ),
  );

  const checks = materializeChecks(snapshot, drafts);
  const severityCounts = countSeverities(checks);
  const blockerCount = checks.filter((check) => check.blocker).length;
  const status: NodeSlideDeckCiStatus =
    blockerCount > 0 ? 'fail' : severityCounts.error + severityCounts.warning > 0 ? 'warn' : 'pass';
  const affectedSlideIds = orderedSlideIds(
    snapshot,
    checks.flatMap((check) => check.slideIds),
  );
  const affectedElementIds = orderedElementIds(
    snapshot,
    checks.flatMap((check) => check.elementIds),
  );
  const affectedSourceIds = uniqueSorted(checks.flatMap((check) => check.sourceIds));
  const changedSourceImpact = sourceChangeImpact(snapshot, resolvedOptions.changedSourceIds ?? []);

  const partial = {
    schemaVersion: NODESLIDE_DECK_CI_SCHEMA_VERSION,
    deckId: snapshot.deck.id,
    deckVersion: snapshot.deck.version,
    snapshotDigest,
    referenceTime,
    status,
    checks,
    blockerCount,
    severityCounts,
    affectedSlideIds,
    affectedElementIds,
    affectedSourceIds,
    changedSourceImpact,
    validation: {
      id: validation.id,
      supplied: resolvedOptions.validation !== undefined,
      inputAccepted: validationInputAccepted,
      ok: validation.ok,
      publishOk: validation.publishOk,
      cleanOk: validation.cleanOk,
    },
    semantic: { id: semantic.id, verdict: semantic.verdict },
    ...(resolvedOptions.presentationQuality
      ? {
          presentationQuality: {
            digest: resolvedOptions.presentationQuality.digest,
            status: resolvedOptions.presentationQuality.status,
            overall: resolvedOptions.presentationQuality.scores.overall,
            blockerCount: resolvedOptions.presentationQuality.blockerCount,
          },
        }
      : {}),
  };
  return { ...partial, digest: nodeslideContentDigest(stableSerialize(partial)) };
}

interface CheckDraft extends Omit<NodeSlideDeckCiCheck, 'id'> {}

function normalizeInput(
  input: NodeSlideDeckCiInput | DeckSnapshot,
  options: NodeSlideDeckCiOptions,
): { snapshot: DeckSnapshot; resolvedOptions: NodeSlideDeckCiOptions } {
  if ('snapshot' in input) {
    const { snapshot, ...embeddedOptions } = input;
    return { snapshot, resolvedOptions: embeddedOptions };
  }
  return { snapshot: input, resolvedOptions: options };
}

function resolvedReferenceTime(snapshot: DeckSnapshot, value: number | undefined): number {
  const referenceTime = value ?? snapshot.deck.updatedAt;
  if (!Number.isSafeInteger(referenceTime) || referenceTime < 0) {
    throw new Error('Deck CI referenceTime must be a non-negative safe integer.');
  }
  return referenceTime;
}

function validationMatchesSnapshot(
  snapshot: DeckSnapshot,
  validation: ValidationResult | undefined,
): validation is ValidationResult {
  return Boolean(
    validation &&
      validation.deckId === snapshot.deck.id &&
      validation.deckVersion === snapshot.deck.version &&
      validation.toolchainVersion === snapshot.deck.toolchainVersion &&
      validation.toolchainVersion === NODESLIDE_TOOLCHAIN_VERSION,
  );
}

function checkFromSemanticFinding(finding: NodeSlideSemanticFinding): CheckDraft {
  return {
    code:
      finding.code === 'factual_claim_unbound'
        ? 'unsupported_consequential_claim'
        : finding.code === 'source_missing'
          ? 'source_reference_missing'
          : finding.code,
    category:
      finding.code === 'factual_claim_unbound'
        ? 'claims'
        : finding.code === 'source_missing' || finding.code === 'source_reference_missing'
          ? 'source_binding'
          : 'evidence',
    origin: 'semantic',
    severity: finding.severity,
    blocker: finding.disposition === 'hard_blocker',
    message: finding.message,
    slideIds: finding.bindings.slideIds,
    elementIds: finding.bindings.elementIds,
    sourceIds: finding.bindings.sourceIds,
  };
}

function checksFromSemanticCoverage(
  snapshot: DeckSnapshot,
  receipt: NodeSlideSemanticCoverageReceipt,
): CheckDraft[] {
  if (!nodeSlideSemanticCoverageReceiptMatches(receipt, snapshot)) {
    return [
      {
        code: 'semantic_coverage_receipt_mismatch',
        category: 'claims',
        origin: 'semantic',
        severity: 'critical',
        blocker: true,
        message: 'The semantic-coverage receipt is invalid or belongs to a different candidate.',
        slideIds: [],
        elementIds: [],
        sourceIds: [],
      },
    ];
  }
  if (receipt.status !== 'blocked') return [];
  const missing = new Set(receipt.missingObligationIds);
  const obligations = receipt.obligations.filter((obligation) => missing.has(obligation.id));
  return [
    {
      code: 'semantic_coverage_undercovered',
      category: 'claims',
      origin: 'semantic',
      severity: 'critical',
      blocker: true,
      message: `The candidate covers ${receipt.coveredObligationIds.length} of ${receipt.obligations.length} explicitly requested targets.`,
      slideIds: obligations.map((obligation) => obligation.slideId),
      elementIds: obligations.flatMap((obligation) =>
        obligation.elementId ? [obligation.elementId] : [],
      ),
      sourceIds: [],
    },
  ];
}

function checksFromPresentationQuality(
  snapshot: DeckSnapshot,
  receipt: NodeSlidePresentationQualityReceipt,
): CheckDraft[] {
  if (
    receipt.deckId !== snapshot.deck.id ||
    receipt.deckVersion !== snapshot.deck.version ||
    !verifyNodeSlidePresentationQualityReceipt(receipt)
  ) {
    return [
      {
        code: 'presentation_quality_receipt_mismatch',
        category: 'claims',
        origin: 'presentation_quality',
        severity: 'critical',
        blocker: true,
        message: 'The presentation-quality receipt is invalid or belongs to another deck version.',
        slideIds: [],
        elementIds: [],
        sourceIds: [],
      },
    ];
  }
  return receipt.issues.map((qualityIssue) => ({
    code: qualityIssue.code,
    category:
      qualityIssue.dimension === 'evidence'
        ? 'evidence'
        : qualityIssue.dimension === 'visual'
          ? 'layout'
          : qualityIssue.dimension === 'editability' || qualityIssue.dimension === 'artifact_proof'
            ? 'export'
            : 'claims',
    origin: 'presentation_quality',
    severity: qualityIssue.severity,
    blocker: qualityIssue.blocker,
    message: qualityIssue.message,
    slideIds: qualityIssue.slideIds,
    elementIds: qualityIssue.elementIds,
    sourceIds: [],
  }));
}

function checksFromValidation(snapshot: DeckSnapshot, validation: ValidationResult): CheckDraft[] {
  const checks = validation.issues.flatMap((issue) => checksFromValidationIssue(snapshot, issue));
  const errorIssues = validation.issues.filter((issue) => issue.severity === 'error');
  if (!validation.publishOk && errorIssues.length === 0) {
    const warnings = validation.issues.filter((issue) => issue.severity === 'warning');
    checks.push({
      code: 'validation_publish_not_ready',
      category: 'export',
      origin: 'validation',
      severity: 'error',
      blocker: true,
      message: 'The authoritative validation receipt is not ready for publication or export.',
      slideIds: warnings.flatMap((issue) => (issue.slideId ? [issue.slideId] : [])),
      elementIds: warnings.flatMap((issue) => (issue.elementId ? [issue.elementId] : [])),
      sourceIds: [],
    });
  }
  return checks;
}

function checksFromValidationIssue(snapshot: DeckSnapshot, issue: ValidationIssue): CheckDraft[] {
  const missingSourceIds = missingSourceIdsForIssue(snapshot, issue);
  if (missingSourceIds.length > 0) {
    return missingSourceIds.map((sourceId) => ({
      code: 'source_reference_missing',
      category: 'source_binding',
      origin: 'validation',
      severity: issue.severity,
      blocker: issue.severity === 'error',
      message: issue.message,
      slideIds: issue.slideId ? [issue.slideId] : [],
      elementIds: issue.elementId ? [issue.elementId] : [],
      sourceIds: [sourceId],
    }));
  }
  return [
    {
      code: `validation_${issue.code}`,
      category: validationCategory(issue),
      origin: 'validation',
      severity: issue.severity,
      blocker: issue.severity === 'error',
      message: issue.message,
      slideIds: issue.slideId ? [issue.slideId] : [],
      elementIds: issue.elementId ? [issue.elementId] : [],
      sourceIds: [],
    },
  ];
}

function missingSourceIdsForIssue(snapshot: DeckSnapshot, issue: ValidationIssue): string[] {
  if (issue.code !== 'source' || !issue.elementId || !/unknown source/i.test(issue.message)) {
    return [];
  }
  const sourceIds = new Set(snapshot.sources.map((source) => source.id));
  const element = snapshot.elements.find((candidate) => candidate.id === issue.elementId);
  if (!element) return [];
  return sourceIdsForElement(element).filter((sourceId) => !sourceIds.has(sourceId));
}

function validationCategory(issue: ValidationIssue): NodeSlideDeckCiCategory {
  if (issue.code === 'export' || issue.code === 'missing_asset') return 'export';
  if (
    issue.code === 'overflow' ||
    issue.code === 'collision' ||
    issue.code === 'contrast' ||
    issue.code === 'font_size' ||
    issue.code.startsWith('on_brand_')
  ) {
    return 'layout';
  }
  return issue.code === 'source' ? 'source_binding' : 'structure';
}

function checksFromHookInputs(
  origin: Extract<NodeSlideDeckCiOrigin, 'layout_structure_hook' | 'export_readiness_hook'>,
  inputs: readonly NodeSlideDeckCiHookCheckInput[] | undefined,
  category: Extract<NodeSlideDeckCiCategory, 'layout' | 'export'>,
): CheckDraft[] {
  return (inputs ?? [])
    .filter((input) => input.status !== 'pass')
    .map((input) => ({
      code: normalizedHookCode(input.code),
      category,
      origin,
      severity: input.status === 'fail' ? 'error' : 'warning',
      blocker: input.blocker ?? input.status === 'fail',
      message: normalizedHookMessage(input.message),
      slideIds: uniqueSorted(input.slideIds ?? []),
      elementIds: uniqueSorted(input.elementIds ?? []),
      sourceIds: uniqueSorted(input.sourceIds ?? []),
    }));
}

function normalizedHookCode(value: string): string {
  const code = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!code || code.length > 96) throw new Error('Deck CI hook codes must be 1-96 characters.');
  return code;
}

function normalizedHookMessage(value: string): string {
  const message = value.replace(/\s+/g, ' ').trim();
  if (!message || message.length > 500) {
    throw new Error('Deck CI hook messages must be 1-500 characters.');
  }
  return message;
}

function materializeChecks(
  snapshot: DeckSnapshot,
  drafts: readonly CheckDraft[],
): NodeSlideDeckCiCheck[] {
  const byIdentity = new Map<string, NodeSlideDeckCiCheck>();
  for (const draft of drafts) {
    const normalized: CheckDraft = {
      ...draft,
      slideIds: orderedSlideIds(snapshot, draft.slideIds),
      elementIds: orderedElementIds(snapshot, draft.elementIds),
      sourceIds: uniqueSorted(draft.sourceIds),
    };
    const identity = stableSerialize(normalized);
    const check = { id: nodeslideStableId('deck_ci_check', identity), ...normalized };
    const dedupeKey = stableSerialize({
      code: check.code,
      category: check.category,
      blocker: check.blocker,
      slideIds: check.slideIds,
      elementIds: check.elementIds,
      sourceIds: check.sourceIds,
    });
    const existing = byIdentity.get(dedupeKey);
    if (!existing || preferredCheck(check, existing) < 0) byIdentity.set(dedupeKey, check);
  }
  return [...byIdentity.values()].sort((left, right) => compareChecks(snapshot, left, right));
}

function preferredCheck(left: NodeSlideDeckCiCheck, right: NodeSlideDeckCiCheck): number {
  const originRank: Record<NodeSlideDeckCiOrigin, number> = {
    semantic: 0,
    presentation_quality: 1,
    validation: 2,
    layout_structure_hook: 3,
    export_readiness_hook: 4,
  };
  return originRank[left.origin] - originRank[right.origin];
}

function compareChecks(
  snapshot: DeckSnapshot,
  left: NodeSlideDeckCiCheck,
  right: NodeSlideDeckCiCheck,
): number {
  const blockerDifference = Number(right.blocker) - Number(left.blocker);
  if (blockerDifference !== 0) return blockerDifference;
  const severityDifference = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severityDifference !== 0) return severityDifference;
  const categoryDifference = CATEGORY_RANK[left.category] - CATEGORY_RANK[right.category];
  if (categoryDifference !== 0) return categoryDifference;
  const slideRank = new Map(snapshot.deck.slideOrder.map((id, index) => [id, index]));
  const slideDifference =
    (slideRank.get(left.slideIds[0] ?? '') ?? Number.MAX_SAFE_INTEGER) -
    (slideRank.get(right.slideIds[0] ?? '') ?? Number.MAX_SAFE_INTEGER);
  if (slideDifference !== 0) return slideDifference;
  return left.code.localeCompare(right.code) || left.id.localeCompare(right.id);
}

function countSeverities(
  checks: readonly NodeSlideDeckCiCheck[],
): Record<NodeSlideDeckCiSeverity, number> {
  const counts: Record<NodeSlideDeckCiSeverity, number> = {
    critical: 0,
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const check of checks) counts[check.severity] += 1;
  return counts;
}

function sourceChangeImpact(
  snapshot: DeckSnapshot,
  changedSourceIds: readonly string[],
): NodeSlideDeckCiResult['changedSourceImpact'] {
  const changed = uniqueSorted(changedSourceIds);
  const knownSourceIds = new Set(snapshot.sources.map((source) => source.id));
  const bindings = snapshot.elements.flatMap((element) =>
    sourceIdsForElement(element)
      .filter((sourceId) => changed.includes(sourceId))
      .map((sourceId) => ({ sourceId, slideId: element.slideId, elementId: element.id })),
  );
  const boundSourceIds = uniqueSorted(bindings.map((binding) => binding.sourceId));
  return {
    changedSourceIds: changed,
    boundSourceIds,
    unboundSourceIds: changed.filter(
      (sourceId) => knownSourceIds.has(sourceId) && !boundSourceIds.includes(sourceId),
    ),
    missingSourceIds: changed.filter((sourceId) => !knownSourceIds.has(sourceId)),
    slideIds: orderedSlideIds(
      snapshot,
      bindings.map((binding) => binding.slideId),
    ),
    elementIds: orderedElementIds(
      snapshot,
      bindings.map((binding) => binding.elementId),
    ),
  };
}

function sourceIdsForElement(element: SlideElement): string[] {
  return uniqueSorted([
    ...element.sourceIds,
    ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ...(element.math?.sourceId ? [element.math.sourceId] : []),
    ...(element.image?.sourceId ? [element.image.sourceId] : []),
  ]);
}

function orderedSlideIds(snapshot: DeckSnapshot, ids: readonly string[]): string[] {
  const rank = new Map(snapshot.deck.slideOrder.map((id, index) => [id, index]));
  return uniqueSorted(ids).sort(
    (left, right) =>
      (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right),
  );
}

function orderedElementIds(snapshot: DeckSnapshot, ids: readonly string[]): string[] {
  const rank = new Map<string, number>();
  let index = 0;
  for (const slideId of snapshot.deck.slideOrder) {
    const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
    for (const elementId of slide?.elementOrder ?? []) rank.set(elementId, index++);
  }
  return uniqueSorted(ids).sort(
    (left, right) =>
      (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right),
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  return value;
}
