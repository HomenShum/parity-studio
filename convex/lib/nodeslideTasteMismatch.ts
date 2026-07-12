import type { DeckSnapshot, PatchOperation, PatchScope } from '../../shared/nodeslide';
import type { PreferenceSignal } from '../../shared/nodeslidePreference';
import type { SignatureProfile } from '../../shared/nodeslideSignature';
import { onBrandIssues, planSignatureApplication } from '../../shared/nodeslideSignatureApply';
import { nodeSlideSnapshotDigest } from './nodeslideDeckRepl';
import { nodeslideContentDigest } from './nodeslideIds';
import type { NodeSlidePatchInput } from './nodeslidePatches';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

export const NODESLIDE_TASTE_MISMATCH_SCHEMA_VERSION = 'nodeslide.taste-mismatch/v1' as const;

const MAX_VIOLATIONS = 256;
const MAX_SOFT_PREFERENCES = 32;
const DEFAULT_MAX_REPAIR_OPERATIONS = 64;
const MAX_REPAIR_OPERATIONS = 128;

export type NodeSlideTasteViolationCategory =
  | 'color'
  | 'font'
  | 'type_scale'
  | 'background'
  | 'spacing'
  | 'density'
  | 'export_capability';

export interface NodeSlideTasteViolation {
  id: string;
  category: NodeSlideTasteViolationCategory;
  severity: 'error' | 'warning' | 'info';
  slideId?: string;
  elementId?: string;
  expectedDigest: string;
  evidenceDigest: string;
}

export interface NodeSlideSoftPreferenceObservation {
  signalId: string;
  dimension: PreferenceSignal['dimension'];
  value: string;
  polarity: PreferenceSignal['polarity'];
  confidence: number;
  provenanceDigest: string;
}

export interface NodeSlideTasteMismatchReceipt {
  schemaVersion: typeof NODESLIDE_TASTE_MISMATCH_SCHEMA_VERSION;
  target: {
    profileId: string;
    profileDigest: string;
    sourceDigest: string;
  };
  candidate: {
    deckId: string;
    deckVersion: number;
    snapshotDigest: string;
    renderDigest: string;
  };
  violations: NodeSlideTasteViolation[];
  violationCounts: Record<NodeSlideTasteViolationCategory, number>;
  violationsTruncated: boolean;
  softPreferences: NodeSlideSoftPreferenceObservation[];
  repair: {
    status: 'none' | 'complete' | 'partial' | 'blocked';
    proposal: NodeSlidePatchInput | null;
    candidateOperationCount: number;
    candidateOperationDigest: string;
    unresolvedCategories: NodeSlideTasteViolationCategory[];
    blockers: string[];
  };
  humanDecision: {
    status: 'pending' | 'accepted' | 'rejected' | 'modified' | 'chosen_alternative';
    eventId?: string;
  };
  receiptDigest: string;
}

export function evaluateNodeSlideTasteMismatch(args: {
  snapshot: DeckSnapshot;
  profile: SignatureProfile;
  renderDigest: string;
  scope?: PatchScope;
  softPreferenceSignals?: readonly PreferenceSignal[];
  maxRepairOperations?: number;
  humanDecision?: NodeSlideTasteMismatchReceipt['humanDecision'];
}): NodeSlideTasteMismatchReceipt {
  const renderDigest = cleanDigest(args.renderDigest);
  if (!renderDigest || renderDigest !== args.renderDigest) {
    throw new Error('Taste mismatch requires a valid render digest.');
  }
  const profileDigest = `profile_${nodeslideContentDigest(stableSerialize(args.profile))}`;
  const snapshotDigest = nodeSlideSnapshotDigest(args.snapshot);
  const maxRepairOperations = boundedRepairLimit(args.maxRepairOperations);
  const blockers = new Set<string>();
  const violations = deterministicViolations(args.snapshot, args.profile, args.scope);
  const validation = validateNodeSlideSnapshot(args.snapshot, 1, 'taste-mismatch-safety');
  for (const issue of validation.issues) {
    if (issue.code === 'source') blockers.add('source_lineage');
    if (['contrast', 'font_size', 'overflow'].includes(issue.code) && issue.severity === 'error') {
      blockers.add('readability_or_accessibility');
    }
    if (issue.code === 'missing_asset') blockers.add('artifact_or_accessibility');
    if (['schema', 'collision'].includes(issue.code) && issue.severity === 'error') {
      blockers.add('candidate_safety');
    }
  }

  const planned = planSignatureApplication(args.snapshot, args.profile, {
    ...(args.scope ? { scope: args.scope } : {}),
  });
  let operations: PatchOperation[] = [];
  let scope: PatchScope =
    args.scope ??
    ({ kind: 'deck', deckId: args.snapshot.deck.id, operationMode: 'unrestricted' } as const);
  let baseSlideVersions: Record<string, number> = {};
  let baseElementVersions: Record<string, number> = {};
  if (planned.ok) {
    operations = planned.plan.operations;
    scope = planned.plan.scope;
    baseSlideVersions = planned.plan.baseSlideVersions;
    baseElementVersions = planned.plan.baseElementVersions;
    if (planned.plan.skippedLockedElementIds.length > 0) blockers.add('locked_elements');
  } else if (planned.error.code !== 'already_applied') {
    blockers.add(
      planned.error.code === 'scope'
        ? 'scope_policy'
        : planned.error.code === 'operation_limit_exceeded'
          ? 'operation_budget'
          : 'target_profile_invalid',
    );
  }
  if (operations.length > maxRepairOperations) blockers.add('operation_budget');
  if (violations.length > MAX_VIOLATIONS) blockers.add('violation_limit');

  const retainedViolations = violations.slice(0, MAX_VIOLATIONS);
  const unresolvedCategories = uniqueSorted(
    retainedViolations
      .map((violation) => violation.category)
      .filter((category) => ['spacing', 'density', 'export_capability'].includes(category)),
  ) as NodeSlideTasteViolationCategory[];
  const candidateOperationDigest = `operations_${nodeslideContentDigest(stableSerialize(operations))}`;
  const blockerList = [...blockers].sort();
  const proposal =
    blockerList.length === 0 && operations.length > 0
      ? {
          deckId: args.snapshot.deck.id,
          baseDeckVersion: args.snapshot.deck.version,
          baseSlideVersions,
          baseElementVersions,
          scope,
          operations: structuredClone(operations),
        }
      : null;
  const repairStatus: NodeSlideTasteMismatchReceipt['repair']['status'] = blockerList.length
    ? 'blocked'
    : operations.length === 0 && unresolvedCategories.length === 0
      ? 'none'
      : unresolvedCategories.length > 0
        ? 'partial'
        : 'complete';
  const softPreferences = sanitizeSoftPreferences(args.softPreferenceSignals ?? []);
  const humanDecision = sanitizeHumanDecision(args.humanDecision);
  const partial = {
    schemaVersion: NODESLIDE_TASTE_MISMATCH_SCHEMA_VERSION,
    target: {
      profileId: cleanId(args.profile.id),
      profileDigest,
      sourceDigest: cleanDigest(args.profile.source.digest),
    },
    candidate: {
      deckId: cleanId(args.snapshot.deck.id),
      deckVersion: args.snapshot.deck.version,
      snapshotDigest,
      renderDigest,
    },
    violations: retainedViolations,
    violationCounts: countViolations(violations),
    violationsTruncated: violations.length > MAX_VIOLATIONS,
    softPreferences,
    repair: {
      status: repairStatus,
      proposal,
      candidateOperationCount: operations.length,
      candidateOperationDigest,
      unresolvedCategories,
      blockers: blockerList,
    },
    humanDecision,
  };
  return {
    ...partial,
    receiptDigest: `taste_${nodeslideContentDigest(stableSerialize(partial))}`,
  };
}

function deterministicViolations(
  snapshot: DeckSnapshot,
  profile: SignatureProfile,
  scope: PatchScope | undefined,
): NodeSlideTasteViolation[] {
  const violations: NodeSlideTasteViolation[] = [];
  const expectedDigests = targetDigests(profile, snapshot.deck.theme.spacingUnit);
  const brandIssues = onBrandIssues(snapshot, profile, {
    ...(scope ? { scope } : {}),
    skipLocked: false,
    maxIssues: MAX_VIOLATIONS + 1,
  });
  for (const issue of brandIssues) {
    const category = categoryForBrandCode(issue.code);
    if (!category) continue;
    violations.push(
      makeViolation(
        category,
        issue.severity,
        expectedDigests[category],
        issue.slideId,
        issue.elementId,
      ),
    );
  }

  const spacingUnit = snapshot.deck.theme.spacingUnit;
  if (Number.isFinite(spacingUnit) && spacingUnit > 0) {
    for (const element of snapshot.elements) {
      const padding = element.style.padding;
      if (padding === undefined || !Number.isFinite(padding)) continue;
      const remainder = Math.abs(padding % spacingUnit);
      if (remainder > 0.01 && Math.abs(remainder - spacingUnit) > 0.01) {
        violations.push(
          makeViolation('spacing', 'info', expectedDigests.spacing, element.slideId, element.id),
        );
      }
    }
  }

  const slideCount = Math.max(1, snapshot.slides.length);
  const averageElements = snapshot.elements.length / slideCount;
  const targetAverage = profile.layout.averageShapesPerSlide;
  const densityTolerance = Math.max(2, targetAverage * 0.35);
  if (
    Number.isFinite(targetAverage) &&
    Math.abs(averageElements - targetAverage) > densityTolerance
  ) {
    violations.push(makeViolation('density', 'info', expectedDigests.density));
  }

  for (const element of snapshot.elements) {
    const capabilities = new Set(element.exportCapabilities);
    if (
      !capabilities.has('web_native') ||
      (!capabilities.has('pptx_editable') && !capabilities.has('pptx_static_fallback'))
    ) {
      violations.push(
        makeViolation(
          'export_capability',
          'warning',
          expectedDigests.export_capability,
          element.slideId,
          element.id,
        ),
      );
    }
  }
  return violations.sort((left, right) =>
    `${left.category}:${left.slideId ?? ''}:${left.elementId ?? ''}:${left.id}`.localeCompare(
      `${right.category}:${right.slideId ?? ''}:${right.elementId ?? ''}:${right.id}`,
    ),
  );
}

function makeViolation(
  category: NodeSlideTasteViolationCategory,
  severity: NodeSlideTasteViolation['severity'],
  expectedDigest: string,
  slideId?: string,
  elementId?: string,
): NodeSlideTasteViolation {
  const evidence = {
    category,
    severity,
    expectedDigest,
    slideId: slideId ?? '',
    elementId: elementId ?? '',
  };
  return {
    id: `violation_${nodeslideContentDigest(stableSerialize(evidence))}`,
    category,
    severity,
    ...(slideId ? { slideId: cleanId(slideId) } : {}),
    ...(elementId ? { elementId: cleanId(elementId) } : {}),
    expectedDigest,
    evidenceDigest: `evidence_${nodeslideContentDigest(stableSerialize(evidence))}`,
  };
}

function targetDigests(
  profile: SignatureProfile,
  spacingUnit: number,
): Record<NodeSlideTasteViolationCategory, string> {
  const digest = (value: unknown) => `target_${nodeslideContentDigest(stableSerialize(value))}`;
  return {
    color: digest(profile.tokens.colors),
    font: digest(profile.tokens.fontFamilies),
    type_scale: digest(profile.tokens.fontSizes),
    background: digest(profile.tokens.colors),
    spacing: digest({ spacingUnit, policy: 'deck-theme-spacing-unit/v1' }),
    density: digest(profile.layout),
    export_capability: digest({
      policy: 'nodeslide-export-capability/v1',
      required: ['web_native', 'pptx_editable|pptx_static_fallback'],
    }),
  };
}

function categoryForBrandCode(code: string): NodeSlideTasteViolationCategory | undefined {
  if (code === 'on_brand_color') return 'color';
  if (code === 'on_brand_font') return 'font';
  if (code === 'on_brand_type_scale') return 'type_scale';
  if (code === 'on_brand_background') return 'background';
  return undefined;
}

function sanitizeSoftPreferences(
  signals: readonly PreferenceSignal[],
): NodeSlideSoftPreferenceObservation[] {
  return signals
    .filter((signal) => signal.evaluator.passed)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, MAX_SOFT_PREFERENCES)
    .map((signal) => ({
      signalId: cleanId(signal.id),
      dimension: signal.dimension,
      value: cleanText(signal.value, 160),
      polarity: signal.polarity,
      confidence: roundConfidence(signal.confidence),
      provenanceDigest: `preference_${nodeslideContentDigest(
        stableSerialize({
          signalId: signal.id,
          evidenceEventIds: [...signal.evidenceEventIds].sort(),
          evaluatorVersion: signal.evaluator.evaluatorVersion,
          inputEventIds: [...signal.evaluator.inputEventIds].sort(),
        }),
      )}`,
    }));
}

function sanitizeHumanDecision(
  decision: NodeSlideTasteMismatchReceipt['humanDecision'] | undefined,
): NodeSlideTasteMismatchReceipt['humanDecision'] {
  if (!decision) return { status: 'pending' };
  if (
    !['pending', 'accepted', 'rejected', 'modified', 'chosen_alternative'].includes(decision.status)
  ) {
    throw new Error('Taste mismatch human decision is invalid.');
  }
  const eventId = decision.eventId ? cleanId(decision.eventId) : '';
  if (decision.status !== 'pending' && !eventId) {
    throw new Error('Taste mismatch decisions require an event ID.');
  }
  return { status: decision.status, ...(eventId ? { eventId } : {}) };
}

function boundedRepairLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_REPAIR_OPERATIONS;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_REPAIR_OPERATIONS) {
    throw new Error(`Taste repair operation limit must be between 1 and ${MAX_REPAIR_OPERATIONS}.`);
  }
  return value;
}

function countViolations(
  violations: readonly NodeSlideTasteViolation[],
): Record<NodeSlideTasteViolationCategory, number> {
  const counts: Record<NodeSlideTasteViolationCategory, number> = {
    color: 0,
    font: 0,
    type_scale: 0,
    background: 0,
    spacing: 0,
    density: 0,
    export_capability: 0,
  };
  for (const violation of violations) counts[violation.category] += 1;
  return counts;
}

function cleanId(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._:/+ -]/g, '')
    .trim()
    .slice(0, 180);
}

function cleanDigest(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 180);
}

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function roundConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000) / 1_000;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return value;
}
