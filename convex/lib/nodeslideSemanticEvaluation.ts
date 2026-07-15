import type {
  DeckPatch,
  DeckSnapshot,
  ElementKind,
  Slide,
  SlideElement,
  SourceRecord,
} from '../../shared/nodeslide';
import { NODESLIDE_SCHEMA_VERSION, NODESLIDE_TOOLCHAIN_VERSION } from '../../shared/nodeslide';
import { applyDeckPatch } from '../../shared/nodeslidePatch';
import { nodeSlideCandidateDigest } from './nodeslideCandidate';
import { nodeslideContentDigest, nodeslideStableId } from './nodeslideIds';

export const NODESLIDE_SEMANTIC_EVALUATION_SCHEMA_VERSION =
  'nodeslide.semantic-evaluation/v1' as const;

export const NODESLIDE_SEMANTIC_EVALUATION_LIMITS = Object.freeze({
  slides: 256,
  elements: 4_096,
  sources: 1_024,
  claims: 4_096,
  claimsPerElement: 8,
  evidencePerFinding: 16,
  findings: 512,
});

const DEFAULT_MAX_FINDINGS = 256;
const DEFAULT_MAX_SOURCE_AGE_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_SOURCE_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1_000;
const MAX_STORED_DRAFTS_PER_SEVERITY = 1_024;
const MAX_EVIDENCE_TEXT = 320;
const BOILERPLATE_ROLE = /^(?:decoration|footer|page_number|section)$/i;
const FACTUAL_ROLE = /(?:citation|data|evidence|metric|stat|source|claim|formula)/i;
const QUANTITATIVE_CLAIM =
  /(?:\b\d+(?:\.\d+)?\s?%|[$€£¥]\s?-?\d|\b(?:19|20)\d{2}\b|\b-?\d+(?:\.\d+)?\s?(?:million|billion|trillion|mn|bn|users?|customers?|seconds?|minutes?|hours?|days?)\b)/i;
const DISCLOSURE_REQUIRED =
  /(?:illustrative|example data|demo data|synthetic|sample data|assumption|estimated?|forecast|projected|projection|unverified|not independently verified|replace (?:with measured|before external|before publication)|not for (?:external )?publication)/i;
const DISCLOSURE_PRESENT =
  /(?:illustrative|example data|demo data|synthetic|sample data|assumption|estimated?|forecast|projected|projection|unverified|not independently verified|replace (?:with measured|before external|before publication)|not for (?:external )?publication|directional only)/i;

export type NodeSlideSemanticCategory =
  | 'chart'
  | 'claims'
  | 'narrative'
  | 'sources'
  | 'notes_disclosure'
  | 'structured_primitive'
  | 'evaluation';

export type NodeSlideSemanticSeverity = 'critical' | 'error' | 'warning' | 'info';
export type NodeSlideSemanticDisposition = 'hard_blocker' | 'advisory';

export type NodeSlideSemanticFindingCode =
  | 'chart_data_missing'
  | 'chart_label_value_mismatch'
  | 'chart_malformed_numeric_data'
  | 'chart_label_value_count_mismatch'
  | 'chart_non_finite_value'
  | 'chart_label_empty'
  | 'chart_duplicate_label'
  | 'chart_duplicate_label_conflict'
  | 'chart_series_name_duplicate'
  | 'chart_caption_value_mismatch'
  | 'chart_axis_label_mismatch'
  | 'chart_axis_unit_mismatch'
  | 'chart_donut_series_mismatch'
  | 'chart_donut_negative_value'
  | 'duplicate_claim'
  | 'contradictory_claim'
  | 'contradictory_numeric_claim'
  | 'contradictory_direction_claim'
  | 'contradictory_polarity_claim'
  | 'narrative_stage_gap'
  | 'narrative_stage_regression'
  | 'narrative_sequence_gap'
  | 'narrative_opening_missing'
  | 'narrative_close_missing'
  | 'narrative_content_missing'
  | 'narrative_gap'
  | 'orphaned_section'
  | 'factual_claim_unbound'
  | 'source_unbound'
  | 'source_missing'
  | 'source_reference_missing'
  | 'source_failed'
  | 'source_refreshing'
  | 'source_stale'
  | 'source_evidence_incomplete'
  | 'source_timestamp_invalid'
  | 'notes_missing'
  | 'disclosure_missing'
  | 'speaker_notes_missing'
  | 'required_disclosure_missing'
  | 'primitive_payload_missing'
  | 'primitive_payload_kind_mismatch'
  | 'primitive_source_binding_mismatch'
  | 'math_display_mismatch'
  | 'math_variable_missing_from_expression'
  | 'math_variable_conflict'
  | 'math_variable_value_mismatch'
  | 'image_placeholder_conflict'
  | 'image_credit_missing'
  | 'video_timing_invalid'
  | 'video_caption_metadata_incomplete'
  | 'diagram_structure_mismatch'
  | 'primitive_missing'
  | 'primitive_malformed'
  | 'evaluation_input_truncated'
  | 'evaluation_findings_truncated'
  | 'unsupported_input'
  | 'inconsistent_input';

export type NodeSlideSemanticValue = string | number | boolean | string[] | number[];

export interface NodeSlideSemanticEvidence {
  digest: string;
  kind: 'chart_data' | 'text_claim' | 'slide' | 'source' | 'primitive' | 'limit';
  path: string;
  observed: NodeSlideSemanticValue;
  expected?: NodeSlideSemanticValue;
  slideId?: string;
  elementId?: string;
  sourceId?: string;
}

export interface NodeSlideSemanticFinding {
  id: string;
  rank: number;
  code: NodeSlideSemanticFindingCode;
  category: NodeSlideSemanticCategory;
  severity: NodeSlideSemanticSeverity;
  disposition: NodeSlideSemanticDisposition;
  message: string;
  bindings: {
    slideIds: string[];
    elementIds: string[];
    sourceIds: string[];
  };
  evidence: NodeSlideSemanticEvidence[];
  details: Record<string, NodeSlideSemanticValue>;
  evidenceDigest: string;
  /** Primary bindings retained for compact consumers; complete bindings remain above. */
  slideId?: string;
  elementId?: string;
  sourceId?: string;
  related: Array<{
    slideId?: string;
    elementId?: string;
    sourceId?: string;
    path: string;
  }>;
}

export type NodeSlideSemanticPrimitiveKind = ElementKind;

export interface NodeSlideSemanticPrimitiveCoverageItem {
  kind: NodeSlideSemanticPrimitiveKind;
  required: boolean;
  count: number;
  validCount: number;
  malformedCount: number;
  covered: boolean;
}

export interface NodeSlideSemanticPrimitiveCoverage {
  complete: boolean;
  items: Record<NodeSlideSemanticPrimitiveKind, NodeSlideSemanticPrimitiveCoverageItem>;
}

export interface NodeSlideSemanticSourceCoverage {
  bindingAssessable: boolean;
  total: number;
  bound: number;
  unbound: number;
  stale: number;
  missingReferences: number;
}

/** Narrow structural subset of the existing planning spec accepted for pre-snapshot checks. */
export interface NodeSlideSemanticDeckSpec {
  title: string;
  narrative: string[];
  slides: Array<{
    title: string;
    section: string;
    headline: string;
    body: string;
    bullets: string[];
    chart?: unknown;
    formula?: unknown;
    image?: unknown;
    video?: unknown;
    diagram?: unknown;
  }>;
}

export interface NodeSlideSemanticPolicy {
  maxSourceAgeMs: number;
  staleSourceTypes: Array<SourceRecord['sourceType']>;
  maxFindings: number;
  requireSpeakerNotes: boolean;
  requireDisclosures: boolean;
  requireOpeningAndClose: boolean;
}

export interface NodeSlideSemanticEvaluationOptions {
  /** Required for wall-clock freshness; defaults to the candidate's persisted update time. */
  referenceTime?: number;
  policy?: Partial<NodeSlideSemanticPolicy>;
  /** Compatibility alias for referenceTime. Supplying both with different values is invalid. */
  evaluatedAt?: number;
  /** Compatibility alias for policy.maxSourceAgeMs. */
  sourceStaleAfterMs?: number;
  /** Optional explicit primitive requirements for this candidate. */
  requiredPrimitives?: readonly NodeSlideSemanticPrimitiveKind[];
}

export type NodeSlideSemanticPatch = Pick<DeckPatch, 'baseDeckVersion' | 'scope' | 'operations'>;

export type NodeSlideSemanticEvaluationTarget =
  | { kind: 'snapshot'; snapshot: DeckSnapshot; spec?: NodeSlideSemanticDeckSpec }
  | {
      kind: 'patch';
      base: DeckSnapshot;
      patch: NodeSlideSemanticPatch;
      spec?: NodeSlideSemanticDeckSpec;
    };

export type NodeSlideSemanticEvaluationInput =
  | NodeSlideSemanticEvaluationTarget
  | { kind: 'spec'; spec: NodeSlideSemanticDeckSpec }
  | { kind: string; [key: string]: unknown };

export interface NodeSlideSemanticEvaluationReceipt {
  schemaVersion: typeof NODESLIDE_SEMANTIC_EVALUATION_SCHEMA_VERSION;
  id: string;
  verdict: 'pass' | 'advisory' | 'blocked';
  outcome: 'passed' | 'blocked' | 'unsupported' | 'inconsistent';
  ok: boolean;
  publishOk: boolean;
  inputKind: string;
  inputDigest: string;
  target: {
    kind: string;
    deckId: string;
    baseDeckVersion: number;
    candidateDeckVersion: number;
    snapshotDigest: string;
    patchDigest?: string;
  };
  referenceTime: number;
  policy: NodeSlideSemanticPolicy;
  policyDigest: string;
  findings: NodeSlideSemanticFinding[];
  blockerFindingIds: string[];
  advisoryFindingIds: string[];
  summary: {
    hardBlockers: number;
    advisories: number;
    bySeverity: Record<NodeSlideSemanticSeverity, number>;
    byCategory: Record<NodeSlideSemanticCategory, number>;
  };
  primitiveCoverage: NodeSlideSemanticPrimitiveCoverage;
  sourceCoverage: NodeSlideSemanticSourceCoverage;
  bounds: {
    limits: typeof NODESLIDE_SEMANTIC_EVALUATION_LIMITS;
    processedSlides: number;
    processedElements: number;
    processedSources: number;
    processedClaims: number;
    observedFindings: number;
    returnedFindings: number;
    inputTruncated: boolean;
    findingsTruncated: boolean;
  };
  receiptDigest: string;
}

interface EvaluationContext {
  snapshot: DeckSnapshot;
  slides: Slide[];
  elements: SlideElement[];
  sources: SourceRecord[];
  slideById: Map<string, Slide>;
  elementsBySlide: Map<string, SlideElement[]>;
  sourceById: Map<string, SourceRecord>;
  slideRank: Map<string, number>;
  elementRank: Map<string, number>;
  slideSnapshotIndex: Map<string, number>;
  elementSnapshotIndex: Map<string, number>;
  sourceSnapshotIndex: Map<string, number>;
  referenceTime: number;
  policy: NodeSlideSemanticPolicy;
  collector: FindingCollector;
  inputTruncated: boolean;
}

interface FindingDraft {
  code: NodeSlideSemanticFindingCode;
  category: NodeSlideSemanticCategory;
  severity: NodeSlideSemanticSeverity;
  disposition: NodeSlideSemanticDisposition;
  message: string;
  slideIds?: string[];
  elementIds?: string[];
  sourceIds?: string[];
  evidence: NodeSlideSemanticEvidence[];
  details?: Record<string, NodeSlideSemanticValue>;
}

interface ClaimOccurrence {
  origin: 'text' | 'slide_title' | 'chart';
  text: string;
  canonical: string;
  slideId: string;
  elementId?: string;
  sourceIds: string[];
  path: string;
  numeric?: NumericFact;
  direction?: DirectionFact;
  polarity?: PolarityFact;
}

interface NumericFact {
  key: string;
  value: number;
  unit: string;
}

interface DirectionFact {
  key: string;
  direction: 'up' | 'down';
}

interface PolarityFact {
  key: string;
  polarity: 'positive' | 'negative';
}

interface SourceUse {
  slideId: string;
  elementId: string;
  path: string;
}

interface NarrativeStage {
  id: 'opening' | 'context' | 'evidence' | 'approach' | 'proof' | 'close' | 'appendix';
  rank: number;
}

const SEVERITY_RANK: Record<NodeSlideSemanticSeverity, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

const CATEGORY_KEYS: NodeSlideSemanticCategory[] = [
  'chart',
  'claims',
  'narrative',
  'sources',
  'notes_disclosure',
  'structured_primitive',
  'evaluation',
];

const SOURCE_TYPE_KEYS: Array<SourceRecord['sourceType']> = [
  'internal',
  'url',
  'document',
  'spreadsheet',
  'note',
];

const PRIMITIVE_KIND_KEYS: NodeSlideSemanticPrimitiveKind[] = [
  'text',
  'shape',
  'image',
  'chart',
  'math',
  'video',
  'connector',
];

/**
 * Pure, deterministic semantic preflight. Patch targets are materialized in memory with the
 * base snapshot's persisted timestamp, so no wall clock or external service influences output.
 */
export function evaluateNodeSlideSemantics(
  input: NodeSlideSemanticEvaluationInput,
  options: NodeSlideSemanticEvaluationOptions = {},
): NodeSlideSemanticEvaluationReceipt {
  const inputDigest = nodeslideContentDigest(stableSerialize(input));
  if (input.kind === 'spec') {
    if (!isDeckSpec(input.spec)) {
      return terminalReceipt(
        'spec',
        'inconsistent',
        'inconsistent_input',
        'The supplied planning spec is structurally inconsistent.',
        inputDigest,
        options,
      );
    }
    return evaluateSpecInput(input.spec, options, inputDigest);
  }
  if (input.kind !== 'snapshot' && input.kind !== 'patch') {
    return terminalReceipt(
      input.kind,
      'unsupported',
      'unsupported_input',
      `Semantic evaluation does not support input kind ${input.kind || 'unknown'}.`,
      inputDigest,
      options,
    );
  }
  if (input.kind === 'snapshot' && !isDeckSnapshot(input.snapshot)) {
    return terminalReceipt(
      'snapshot',
      'inconsistent',
      'inconsistent_input',
      'The supplied DeckSnapshot is structurally inconsistent.',
      inputDigest,
      options,
    );
  }
  if (input.kind === 'patch' && (!isDeckSnapshot(input.base) || !isSemanticPatch(input.patch))) {
    return terminalReceipt(
      'patch',
      'inconsistent',
      'inconsistent_input',
      'The supplied base snapshot or patch is structurally inconsistent.',
      inputDigest,
      options,
    );
  }
  const target = input as NodeSlideSemanticEvaluationTarget;
  let candidate: DeckSnapshot;
  try {
    candidate =
      target.kind === 'snapshot'
        ? target.snapshot
        : applyDeckPatch(target.base, target.patch, target.base.deck.updatedAt).snapshot;
  } catch (error) {
    return terminalReceipt(
      target.kind,
      'inconsistent',
      'inconsistent_input',
      `The semantic candidate could not be materialized: ${errorMessage(error)}`,
      inputDigest,
      options,
    );
  }
  const referenceTime = resolvedReferenceTime(options, candidate.deck.updatedAt);
  const policy = resolvedPolicy(options);
  const requiredPrimitives = resolvedRequiredPrimitives(options.requiredPrimitives);
  const collector = new FindingCollector();
  const context = evaluationContext(candidate, referenceTime, policy, collector);

  reportInputBounds(context);
  evaluateStructuredPrimitives(context);
  const primitiveCoverage = evaluatePrimitiveCoverage(context, requiredPrimitives);
  const claims = extractClaims(context);
  evaluateClaims(context, claims);
  evaluateNarrative(context, target.spec);
  evaluateSources(context);
  const sourceCoverage = evaluateSourceCoverage(context);
  evaluateNotesAndDisclosures(context);

  const finalized = finalizeFindings(context);
  const snapshotDigest = nodeSlideCandidateDigest(candidate);
  const patchDigest =
    target.kind === 'patch' ? nodeslideContentDigest(stableSerialize(target.patch)) : undefined;
  const policyDigest = nodeslideContentDigest(stableSerialize({ policy, requiredPrimitives }));
  const blockerFindingIds = finalized.findings
    .filter((finding) => finding.disposition === 'hard_blocker')
    .map((finding) => finding.id);
  const advisoryFindingIds = finalized.findings
    .filter((finding) => finding.disposition === 'advisory')
    .map((finding) => finding.id);
  const verdict =
    blockerFindingIds.length > 0
      ? ('blocked' as const)
      : advisoryFindingIds.length > 0
        ? ('advisory' as const)
        : ('pass' as const);
  const inconsistent = finalized.findings.some(
    (finding) =>
      finding.code === 'source_timestamp_invalid' || finding.code === 'inconsistent_input',
  );
  const outcome = inconsistent
    ? ('inconsistent' as const)
    : verdict === 'blocked'
      ? ('blocked' as const)
      : ('passed' as const);
  const partial = {
    schemaVersion: NODESLIDE_SEMANTIC_EVALUATION_SCHEMA_VERSION,
    id: nodeslideStableId(
      'semantic_evaluation',
      snapshotDigest,
      patchDigest ?? 'snapshot',
      policyDigest,
      String(referenceTime),
    ),
    verdict,
    outcome,
    ok: verdict !== 'blocked',
    publishOk: verdict !== 'blocked',
    inputKind: target.kind,
    inputDigest,
    target: {
      kind: target.kind,
      deckId: candidate.deck.id,
      baseDeckVersion: target.kind === 'patch' ? target.base.deck.version : candidate.deck.version,
      candidateDeckVersion: candidate.deck.version,
      snapshotDigest,
      ...(patchDigest ? { patchDigest } : {}),
    },
    referenceTime,
    policy,
    policyDigest,
    findings: finalized.findings,
    blockerFindingIds,
    advisoryFindingIds,
    summary: summarizeFindings(finalized.findings),
    primitiveCoverage,
    sourceCoverage,
    bounds: {
      limits: NODESLIDE_SEMANTIC_EVALUATION_LIMITS,
      processedSlides: context.slides.length,
      processedElements: context.elements.length,
      processedSources: context.sources.length,
      processedClaims: claims.length,
      observedFindings: finalized.observedFindings,
      returnedFindings: finalized.findings.length,
      inputTruncated: context.inputTruncated,
      findingsTruncated: finalized.findingsTruncated,
    },
  };
  return {
    ...partial,
    receiptDigest: nodeslideContentDigest(stableSerialize(partial)),
  };
}

function evaluateSpecInput(
  spec: NodeSlideSemanticDeckSpec,
  options: NodeSlideSemanticEvaluationOptions,
  inputDigest: string,
): NodeSlideSemanticEvaluationReceipt {
  const referenceTime = resolvedReferenceTime(options, 0);
  const snapshot = snapshotFromSpec(spec, referenceTime);
  const receipt = evaluateNodeSlideSemantics(
    { kind: 'snapshot', snapshot },
    {
      ...options,
      referenceTime,
      evaluatedAt: referenceTime,
      policy: {
        ...options.policy,
        requireSpeakerNotes: false,
        requireDisclosures: false,
        requireOpeningAndClose: false,
      },
    },
  );
  const { receiptDigest: _receiptDigest, ...base } = receipt;
  const partial = {
    ...base,
    id: nodeslideStableId('semantic_evaluation', inputDigest, receipt.policyDigest, 'spec'),
    inputKind: 'spec',
    inputDigest,
    target: { ...receipt.target, kind: 'spec' },
    sourceCoverage: {
      bindingAssessable: false,
      total: 0,
      bound: 0,
      unbound: 0,
      stale: 0,
      missingReferences: 0,
    },
  };
  return {
    ...partial,
    receiptDigest: nodeslideContentDigest(stableSerialize(partial)),
  };
}

function snapshotFromSpec(spec: NodeSlideSemanticDeckSpec, now: number): DeckSnapshot {
  const deckId = nodeslideStableId('semantic_spec_deck', stableSerialize(spec));
  const slides: Slide[] = spec.slides.map((planned, index) => {
    const slideId = nodeslideStableId('semantic_spec_slide', deckId, String(index), planned.title);
    return {
      id: slideId,
      deckId,
      title: planned.title,
      section: planned.section,
      notes: 'Planning-spec semantic beat.',
      background: '#ffffff',
      elementOrder: [nodeslideStableId('semantic_spec_element', slideId)],
      version: 1,
    };
  });
  const elements: SlideElement[] = slides.map((slide, index) => {
    const planned = spec.slides[index];
    return {
      id: slide.elementOrder[0] ?? nodeslideStableId('semantic_spec_element', slide.id),
      slideId: slide.id,
      name: 'Planned narrative content',
      kind: 'text',
      role: 'body',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      rotation: 0,
      content: [planned?.headline ?? '', planned?.body ?? '', ...(planned?.bullets ?? [])]
        .filter(Boolean)
        .join(' '),
      style: {},
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable'],
      version: 1,
    };
  });
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: deckId,
      projectId: nodeslideStableId('semantic_spec_project', deckId),
      title: spec.title,
      brief: {
        prompt: spec.narrative.join(' '),
        audience: 'Planning-spec evaluator',
        purpose: 'Deterministic semantic preflight',
        successCriteria: [...spec.narrative],
      },
      theme: {
        id: 'semantic-spec-theme',
        name: 'Semantic spec theme',
        mode: 'light',
        colors: {
          canvas: '#ffffff',
          ink: '#111111',
          muted: '#555555',
          accent: '#3355aa',
          accentSoft: '#eef2ff',
          insight: '#eef8f1',
          insightInk: '#16442d',
          trace: '#6655cc',
          border: '#dddddd',
        },
        typography: { display: 'serif', body: 'sans-serif', data: 'monospace' },
        defaultRadius: 8,
        spacingUnit: 8,
      },
      slideOrder: slides.map((slide) => slide.id),
      version: 1,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    },
    slides,
    elements,
    sources: [],
  };
}

function terminalReceipt(
  inputKind: string,
  outcome: 'unsupported' | 'inconsistent',
  code: 'unsupported_input' | 'inconsistent_input',
  message: string,
  inputDigest: string,
  options: NodeSlideSemanticEvaluationOptions,
): NodeSlideSemanticEvaluationReceipt {
  const referenceTime = resolvedReferenceTime(options, 0);
  const policy = resolvedPolicy(options);
  const requiredPrimitives = resolvedRequiredPrimitives(options.requiredPrimitives);
  const policyDigest = nodeslideContentDigest(stableSerialize({ policy, requiredPrimitives }));
  const evidence = makeEvidence('limit', '/', inputKind, 'snapshot, patch, or spec');
  const identity = { code, inputKind, evidence: evidence.digest };
  const finding: NodeSlideSemanticFinding = {
    id: nodeslideStableId('semantic_finding', stableSerialize(identity)),
    rank: 1,
    code,
    category: 'evaluation',
    severity: 'critical',
    disposition: 'hard_blocker',
    message: cleanEvidenceText(message),
    bindings: { slideIds: [], elementIds: [], sourceIds: [] },
    evidence: [evidence],
    details: { inputKind },
    evidenceDigest: nodeslideContentDigest(stableSerialize(identity)),
    related: [],
  };
  const primitiveCoverage = emptyPrimitiveCoverage(requiredPrimitives);
  const partial = {
    schemaVersion: NODESLIDE_SEMANTIC_EVALUATION_SCHEMA_VERSION,
    id: nodeslideStableId('semantic_evaluation', inputDigest, outcome, policyDigest),
    verdict: 'blocked' as const,
    outcome,
    ok: false,
    publishOk: false,
    inputKind,
    inputDigest,
    target: {
      kind: inputKind,
      deckId: '',
      baseDeckVersion: 0,
      candidateDeckVersion: 0,
      snapshotDigest: inputDigest,
    },
    referenceTime,
    policy,
    policyDigest,
    findings: [finding],
    blockerFindingIds: [finding.id],
    advisoryFindingIds: [],
    summary: summarizeFindings([finding]),
    primitiveCoverage,
    sourceCoverage: {
      bindingAssessable: false,
      total: 0,
      bound: 0,
      unbound: 0,
      stale: 0,
      missingReferences: 0,
    },
    bounds: {
      limits: NODESLIDE_SEMANTIC_EVALUATION_LIMITS,
      processedSlides: 0,
      processedElements: 0,
      processedSources: 0,
      processedClaims: 0,
      observedFindings: 1,
      returnedFindings: 1,
      inputTruncated: false,
      findingsTruncated: false,
    },
  };
  return {
    ...partial,
    receiptDigest: nodeslideContentDigest(stableSerialize(partial)),
  };
}

function emptyPrimitiveCoverage(
  requiredPrimitives: readonly NodeSlideSemanticPrimitiveKind[],
): NodeSlideSemanticPrimitiveCoverage {
  const required = new Set(requiredPrimitives);
  const items = Object.fromEntries(
    PRIMITIVE_KIND_KEYS.map((kind) => [
      kind,
      {
        kind,
        required: required.has(kind),
        count: 0,
        validCount: 0,
        malformedCount: 0,
        covered: false,
      },
    ]),
  ) as Record<NodeSlideSemanticPrimitiveKind, NodeSlideSemanticPrimitiveCoverageItem>;
  return { complete: required.size === 0, items };
}

class FindingCollector {
  readonly buckets: Record<NodeSlideSemanticSeverity, FindingDraft[]> = {
    critical: [],
    error: [],
    warning: [],
    info: [],
  };

  observed = 0;
  discarded = 0;

  add(draft: FindingDraft): void {
    this.observed += 1;
    const bucket = this.buckets[draft.severity];
    if (bucket.length >= MAX_STORED_DRAFTS_PER_SEVERITY) {
      this.discarded += 1;
      return;
    }
    bucket.push(draft);
  }

  drafts(): FindingDraft[] {
    return [
      ...this.buckets.critical,
      ...this.buckets.error,
      ...this.buckets.warning,
      ...this.buckets.info,
    ];
  }
}

function evaluationContext(
  snapshot: DeckSnapshot,
  referenceTime: number,
  policy: NodeSlideSemanticPolicy,
  collector: FindingCollector,
): EvaluationContext {
  const slideRank = new Map(snapshot.deck.slideOrder.map((id, index) => [id, index]));
  const slideByIdForOrder = new Map(snapshot.slides.map((slide) => [slide.id, slide]));
  const orderedSlides = [
    ...snapshot.deck.slideOrder
      .map((slideId) => slideByIdForOrder.get(slideId))
      .filter((slide): slide is Slide => Boolean(slide)),
    ...snapshot.slides
      .filter((slide) => !slideRank.has(slide.id))
      .sort((left, right) => left.id.localeCompare(right.id)),
  ];
  const uniqueSlides = uniqueById(orderedSlides).slice(
    0,
    NODESLIDE_SEMANTIC_EVALUATION_LIMITS.slides,
  );
  const retainedSlideIds = new Set(uniqueSlides.map((slide) => slide.id));
  const elementOrderRanks = new Map<string, number>();
  for (const slide of uniqueSlides) {
    slide.elementOrder.forEach((elementId, index) => {
      elementOrderRanks.set(`${slide.id}\u001f${elementId}`, index);
    });
  }
  const orderedElements = [...snapshot.elements]
    .filter((element) => retainedSlideIds.has(element.slideId))
    .sort((left, right) => {
      const slideDifference =
        (slideRank.get(left.slideId) ?? Number.MAX_SAFE_INTEGER) -
        (slideRank.get(right.slideId) ?? Number.MAX_SAFE_INTEGER);
      if (slideDifference !== 0) return slideDifference;
      const orderDifference =
        (elementOrderRanks.get(`${left.slideId}\u001f${left.id}`) ?? Number.MAX_SAFE_INTEGER) -
        (elementOrderRanks.get(`${right.slideId}\u001f${right.id}`) ?? Number.MAX_SAFE_INTEGER);
      return orderDifference || left.id.localeCompare(right.id);
    });
  const elements = uniqueById(orderedElements).slice(
    0,
    NODESLIDE_SEMANTIC_EVALUATION_LIMITS.elements,
  );
  const sources = uniqueById(
    [...snapshot.sources].sort((left, right) => left.id.localeCompare(right.id)),
  ).slice(0, NODESLIDE_SEMANTIC_EVALUATION_LIMITS.sources);
  const elementsBySlide = new Map<string, SlideElement[]>();
  elements.forEach((element, index) => {
    const existing = elementsBySlide.get(element.slideId) ?? [];
    existing.push(element);
    elementsBySlide.set(element.slideId, existing);
    elementOrderRanks.set(element.id, index);
  });
  const inputTruncated =
    snapshot.slides.length > uniqueSlides.length ||
    snapshot.elements.length > elements.length ||
    snapshot.sources.length > sources.length;
  return {
    snapshot,
    slides: uniqueSlides,
    elements,
    sources,
    slideById: new Map(uniqueSlides.map((slide) => [slide.id, slide])),
    elementsBySlide,
    sourceById: new Map(sources.map((source) => [source.id, source])),
    slideRank: new Map(uniqueSlides.map((slide, index) => [slide.id, index])),
    elementRank: new Map(elements.map((element, index) => [element.id, index])),
    slideSnapshotIndex: firstIndexById(snapshot.slides),
    elementSnapshotIndex: firstIndexById(snapshot.elements),
    sourceSnapshotIndex: firstIndexById(snapshot.sources),
    referenceTime,
    policy,
    collector,
    inputTruncated,
  };
}

function reportInputBounds(context: EvaluationContext): void {
  const observed = [
    context.snapshot.slides.length,
    context.snapshot.elements.length,
    context.snapshot.sources.length,
  ];
  const expected = [
    NODESLIDE_SEMANTIC_EVALUATION_LIMITS.slides,
    NODESLIDE_SEMANTIC_EVALUATION_LIMITS.elements,
    NODESLIDE_SEMANTIC_EVALUATION_LIMITS.sources,
  ];
  if (!context.inputTruncated) return;
  context.collector.add({
    code: 'evaluation_input_truncated',
    category: 'evaluation',
    severity: 'critical',
    disposition: 'hard_blocker',
    message: 'Semantic evaluation input exceeded a deterministic processing bound.',
    evidence: [makeEvidence('limit', '/', observed, expected)],
    details: {
      observedSlides: observed[0] ?? 0,
      observedElements: observed[1] ?? 0,
      observedSources: observed[2] ?? 0,
    },
  });
}

function evaluateStructuredPrimitives(context: EvaluationContext): void {
  const diagramGroups = new Map<string, SlideElement[]>();
  for (const element of context.elements) {
    evaluatePayloadKinds(context, element);
    evaluateStructuredSourceBinding(context, element);
    if (element.kind === 'chart' && element.chart) evaluateChart(context, element);
    if (element.kind === 'math' && element.math) evaluateMath(context, element);
    if (element.kind === 'image') evaluateImage(context, element);
    if (element.kind === 'video' && element.video) evaluateVideo(context, element);
    if (/^diagram_(?:node|connector)$/i.test(element.role ?? '')) {
      const key = `${element.slideId}\u001f${element.groupId ?? `ungrouped:${element.id}`}`;
      const existing = diagramGroups.get(key) ?? [];
      existing.push(element);
      diagramGroups.set(key, existing);
    }
  }
  for (const members of diagramGroups.values()) evaluateDiagramGroup(context, members);
}

function evaluatePayloadKinds(context: EvaluationContext, element: SlideElement): void {
  const payloads = [
    ['chart', element.chart],
    ['math', element.math],
    ['image', element.image],
    ['video', element.video],
  ] as const;
  const requiredPayload =
    element.kind === 'chart' || element.kind === 'math' || element.kind === 'video'
      ? element.kind
      : element.kind === 'image' && !element.image && !element.imageUrl
        ? 'image'
        : null;
  if (requiredPayload && !payloads.find(([kind]) => kind === requiredPayload)?.[1]) {
    addElementFinding(context, element, {
      code: 'primitive_payload_missing',
      category: 'structured_primitive',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `${capitalize(requiredPayload)} element ${element.id} is missing its structured payload.`,
      evidence: [
        elementEvidence(context, element, 'primitive', `/${requiredPayload}`, false, true),
      ],
      details: { requiredPayload },
    });
  }
  for (const [payloadKind, payload] of payloads) {
    if (!payload || element.kind === payloadKind) continue;
    addElementFinding(context, element, {
      code: 'primitive_payload_kind_mismatch',
      category: 'structured_primitive',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Element ${element.id} is ${element.kind} but carries a ${payloadKind} payload.`,
      evidence: [
        elementEvidence(
          context,
          element,
          'primitive',
          `/${payloadKind}`,
          payloadKind,
          element.kind,
        ),
      ],
      details: { elementKind: element.kind, payloadKind },
    });
  }
}

function evaluateStructuredSourceBinding(context: EvaluationContext, element: SlideElement): void {
  const structured = [
    ['chart', element.chart?.sourceId],
    ['math', element.math?.sourceId],
    ['image', element.image?.sourceId],
  ] as const;
  for (const [payload, sourceId] of structured) {
    if (!sourceId || element.sourceIds.includes(sourceId)) continue;
    addElementFinding(context, element, {
      code: 'primitive_source_binding_mismatch',
      category: 'structured_primitive',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Element ${element.id} does not bind its ${payload} source ${sourceId} at element level.`,
      sourceIds: [sourceId, ...element.sourceIds],
      evidence: [
        elementEvidence(
          context,
          element,
          'primitive',
          `/${payload}/sourceId`,
          sourceId,
          element.sourceIds,
        ),
      ],
      details: { payload, structuredSourceId: sourceId, elementSourceIds: element.sourceIds },
    });
  }
}

function evaluateChart(context: EvaluationContext, element: SlideElement): void {
  const chart = element.chart;
  if (!chart) return;
  const sourceIds = sourceIdsForElement(element);
  if (chart.labels.length === 0 || chart.series.length === 0) {
    addElementFinding(context, element, {
      code: 'chart_data_missing',
      category: 'chart',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Chart ${element.id} has no plottable labels or series.`,
      sourceIds,
      evidence: [
        elementEvidence(
          context,
          element,
          'chart_data',
          '/chart',
          [chart.labels.length, chart.series.length],
          [1, 1],
        ),
      ],
      details: { labelCount: chart.labels.length, seriesCount: chart.series.length },
    });
  }
  chart.labels.forEach((label, labelIndex) => {
    if (label.trim()) return;
    addElementFinding(context, element, {
      code: 'chart_label_empty',
      category: 'chart',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Chart ${element.id} has an empty category label at index ${labelIndex}.`,
      sourceIds,
      evidence: [
        elementEvidence(
          context,
          element,
          'chart_data',
          `/chart/labels/${labelIndex}`,
          label,
          'non-empty label',
        ),
      ],
      details: { labelIndex },
    });
  });
  chart.series.forEach((series, seriesIndex) => {
    if (series.values.length !== chart.labels.length) {
      addElementFinding(context, element, {
        code: 'chart_label_value_mismatch',
        category: 'chart',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Chart ${element.id} series ${series.name || seriesIndex} has ${series.values.length} values for ${chart.labels.length} labels.`,
        sourceIds,
        evidence: [
          elementEvidence(
            context,
            element,
            'chart_data',
            `/chart/series/${seriesIndex}/values`,
            series.values.length,
            chart.labels.length,
          ),
        ],
        details: {
          seriesIndex,
          seriesName: series.name,
          labelCount: chart.labels.length,
          valueCount: series.values.length,
        },
      });
    }
    series.values.forEach((value, valueIndex) => {
      if (Number.isFinite(value)) return;
      addElementFinding(context, element, {
        code: 'chart_malformed_numeric_data',
        category: 'chart',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Chart ${element.id} contains a non-finite value.`,
        sourceIds,
        evidence: [
          elementEvidence(
            context,
            element,
            'chart_data',
            `/chart/series/${seriesIndex}/values/${valueIndex}`,
            String(value),
            'finite number',
          ),
        ],
        details: { seriesIndex, valueIndex },
      });
    });
  });
  evaluateDuplicateChartLabels(context, element);
  evaluateDuplicateSeriesNames(context, element);
  if (chart.chartType === 'donut') evaluateDonut(context, element);
  evaluateChartCompanions(context, element);
}

function evaluateDuplicateChartLabels(context: EvaluationContext, element: SlideElement): void {
  const chart = element.chart;
  if (!chart) return;
  const indexesByLabel = new Map<string, number[]>();
  chart.labels.forEach((label, index) => {
    const key = normalizeClaim(label);
    if (!key) return;
    const indexes = indexesByLabel.get(key) ?? [];
    indexes.push(index);
    indexesByLabel.set(key, indexes);
  });
  for (const [label, indexes] of indexesByLabel) {
    if (indexes.length < 2) continue;
    const conflicting = chart.series.some((series) => {
      const values = indexes.map((index) => series.values[index]);
      return new Set(values.map(normalizedNumber)).size > 1;
    });
    addElementFinding(context, element, {
      code: conflicting ? 'chart_duplicate_label_conflict' : 'chart_duplicate_label',
      category: 'chart',
      severity: conflicting ? 'error' : 'warning',
      disposition: conflicting ? 'hard_blocker' : 'advisory',
      message: conflicting
        ? `Chart ${element.id} repeats category ${label} with conflicting values.`
        : `Chart ${element.id} repeats category ${label}.`,
      sourceIds: sourceIdsForElement(element),
      evidence: [
        elementEvidence(
          context,
          element,
          'chart_data',
          '/chart/labels',
          indexes.map((index) => chart.labels[index] ?? ''),
          'unique category labels',
        ),
      ],
      details: { normalizedLabel: label, labelIndexes: indexes.map(String) },
    });
  }
}

function evaluateDuplicateSeriesNames(context: EvaluationContext, element: SlideElement): void {
  const chart = element.chart;
  if (!chart) return;
  const indexesByName = new Map<string, number[]>();
  chart.series.forEach((series, index) => {
    const key = normalizeClaim(series.name);
    const indexes = indexesByName.get(key) ?? [];
    indexes.push(index);
    indexesByName.set(key, indexes);
  });
  for (const [name, indexes] of indexesByName) {
    if (!name || indexes.length < 2) continue;
    addElementFinding(context, element, {
      code: 'chart_series_name_duplicate',
      category: 'chart',
      severity: 'warning',
      disposition: 'advisory',
      message: `Chart ${element.id} repeats series name ${name}.`,
      sourceIds: sourceIdsForElement(element),
      evidence: [
        elementEvidence(
          context,
          element,
          'chart_data',
          '/chart/series',
          indexes.map((index) => chart.series[index]?.name ?? ''),
          'unique series names',
        ),
      ],
      details: { normalizedSeriesName: name, seriesIndexes: indexes.map(String) },
    });
  }
}

function evaluateDonut(context: EvaluationContext, element: SlideElement): void {
  const chart = element.chart;
  if (!chart) return;
  if (chart.series.length !== 1) {
    addElementFinding(context, element, {
      code: 'chart_donut_series_mismatch',
      category: 'chart',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Donut chart ${element.id} must have exactly one series.`,
      sourceIds: sourceIdsForElement(element),
      evidence: [
        elementEvidence(context, element, 'chart_data', '/chart/series', chart.series.length, 1),
      ],
      details: { seriesCount: chart.series.length },
    });
  }
  const negativeIndexes = (chart.series[0]?.values ?? [])
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value < 0)
    .map(({ index }) => index);
  if (negativeIndexes.length === 0) return;
  addElementFinding(context, element, {
    code: 'chart_donut_negative_value',
    category: 'chart',
    severity: 'error',
    disposition: 'hard_blocker',
    message: `Donut chart ${element.id} contains negative segments.`,
    sourceIds: sourceIdsForElement(element),
    evidence: [
      elementEvidence(
        context,
        element,
        'chart_data',
        '/chart/series/0/values',
        negativeIndexes.map((index) => chart.series[0]?.values[index] ?? 0),
        'non-negative values',
      ),
    ],
    details: { negativeIndexes: negativeIndexes.map(String) },
  });
}

function evaluateChartCompanions(context: EvaluationContext, chartElement: SlideElement): void {
  const chart = chartElement.chart;
  if (!chart) return;
  const slideElements = context.elementsBySlide.get(chartElement.slideId) ?? [];
  const charts = slideElements.filter((element) => element.kind === 'chart');
  const companions = slideElements.filter((element) => {
    if (element.id === chartElement.id || element.visible === false || element.kind !== 'text') {
      return false;
    }
    const role = `${element.role ?? ''} ${element.name}`.toLowerCase();
    if (
      !/(?:caption|data[_ -]?label|chart[_ -]?title|x[_ -]?axis|y[_ -]?axis|category axis|value axis|axis labels?)/i.test(
        role,
      )
    ) {
      return false;
    }
    if (charts.length === 1) return true;
    if (chartElement.groupId && chartElement.groupId === element.groupId) return true;
    return intersects(sourceIdsForElement(chartElement), sourceIdsForElement(element));
  });
  for (const companion of companions) {
    const content = companion.content?.trim();
    if (!content) continue;
    const semanticRole = `${companion.role ?? ''} ${companion.name}`.toLowerCase();
    if (/(?:x[_ -]?axis|category axis|axis labels?)/i.test(semanticRole)) {
      const labels = delimitedAxisLabels(content);
      if (labels && !sameNormalizedSequence(labels, chart.labels)) {
        addCompanionFinding(context, chartElement, companion, {
          code: 'chart_axis_label_mismatch',
          category: 'chart',
          severity: 'error',
          disposition: 'hard_blocker',
          message: `Chart ${chartElement.id} labels disagree with axis element ${companion.id}.`,
          sourceIds: sourceIdsForElement(chartElement),
          evidence: [
            elementEvidence(context, chartElement, 'chart_data', '/chart/labels', chart.labels),
            elementEvidence(context, companion, 'text_claim', '/content', labels, chart.labels),
          ],
          details: { chartLabels: chart.labels, axisLabels: labels },
        });
      }
    }
    if (/(?:y[_ -]?axis|value axis)/i.test(semanticRole)) {
      const chartUnit = normalizeUnit(chart.unit ?? '');
      const axisUnit = detectUnit(content);
      if (chartUnit && axisUnit && chartUnit !== axisUnit) {
        addCompanionFinding(context, chartElement, companion, {
          code: 'chart_axis_unit_mismatch',
          category: 'chart',
          severity: 'error',
          disposition: 'hard_blocker',
          message: `Chart ${chartElement.id} unit ${chartUnit} disagrees with axis unit ${axisUnit}.`,
          sourceIds: sourceIdsForElement(chartElement),
          evidence: [
            elementEvidence(context, chartElement, 'chart_data', '/chart/unit', chartUnit),
            elementEvidence(context, companion, 'text_claim', '/content', axisUnit, chartUnit),
          ],
          details: { chartUnit, axisUnit },
        });
      }
    }
    if (/(?:caption|data[_ -]?label|chart[_ -]?title)/i.test(semanticRole)) {
      evaluateChartCaptionValues(context, chartElement, companion, content);
    }
  }
  if (chartElement.content?.trim()) {
    evaluateChartCaptionValues(context, chartElement, chartElement, chartElement.content.trim());
  }
}

function evaluateChartCaptionValues(
  context: EvaluationContext,
  chartElement: SlideElement,
  captionElement: SlideElement,
  content: string,
): void {
  const chart = chartElement.chart;
  if (!chart) return;
  chart.labels.forEach((label, labelIndex) => {
    chart.series.forEach((series, seriesIndex) => {
      const observed = captionValue(
        content,
        label,
        chart.series.length === 1 ? undefined : series.name,
      );
      const expected = series.values[labelIndex];
      if (
        observed === null ||
        expected === undefined ||
        numericEquivalent(observed, expected, chart.unit)
      ) {
        return;
      }
      addCompanionFinding(context, chartElement, captionElement, {
        code: 'chart_caption_value_mismatch',
        category: 'chart',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Chart ${chartElement.id} value for ${series.name}/${label} disagrees with caption ${captionElement.id}.`,
        sourceIds: sourceIdsForElement(chartElement),
        evidence: [
          elementEvidence(
            context,
            chartElement,
            'chart_data',
            `/chart/series/${seriesIndex}/values/${labelIndex}`,
            expected,
          ),
          elementEvidence(context, captionElement, 'text_claim', '/content', observed, expected),
        ],
        details: { label, seriesName: series.name, chartValue: expected, captionValue: observed },
      });
    });
  });
}

function evaluateMath(context: EvaluationContext, element: SlideElement): void {
  const math = element.math;
  if (!math) return;
  if (
    math.display?.trim() &&
    element.content?.trim() &&
    normalizeFormula(math.display) !== normalizeFormula(element.content)
  ) {
    addElementFinding(context, element, {
      code: 'math_display_mismatch',
      category: 'structured_primitive',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Math element ${element.id} content disagrees with its structured display.`,
      sourceIds: sourceIdsForElement(element),
      evidence: [
        elementEvidence(context, element, 'primitive', '/content', element.content ?? ''),
        elementEvidence(context, element, 'primitive', '/math/display', math.display),
      ],
      details: { content: element.content, structuredDisplay: math.display },
    });
  }
  const variablesByLabel = new Map<string, NonNullable<typeof math.variables>>();
  for (const variable of math.variables ?? []) {
    const label = normalizeClaim(variable.label);
    const existing = variablesByLabel.get(label) ?? [];
    existing.push(variable);
    variablesByLabel.set(label, existing);
  }
  for (const [label, variables] of variablesByLabel) {
    const values = new Set(
      variables.map(
        (variable) => `${normalizedNumber(variable.value)}:${normalizeUnit(variable.unit ?? '')}`,
      ),
    );
    if (!label || values.size > 1) {
      addElementFinding(context, element, {
        code: 'math_variable_conflict',
        category: 'structured_primitive',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Math element ${element.id} has conflicting variable metadata for ${label || 'an empty label'}.`,
        sourceIds: sourceIdsForElement(element),
        evidence: [
          elementEvidence(
            context,
            element,
            'primitive',
            '/math/variables',
            [...values],
            'one value and unit per variable label',
          ),
        ],
        details: { variableLabel: label, observedDefinitions: [...values] },
      });
    }
    const variable = variables[0];
    if (!variable || !label) continue;
    if (!expressionContainsVariable(math.expression, variable.label)) {
      addElementFinding(context, element, {
        code: 'math_variable_missing_from_expression',
        category: 'structured_primitive',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Math element ${element.id} declares ${variable.label} but does not use it in the expression.`,
        sourceIds: sourceIdsForElement(element),
        evidence: [
          elementEvidence(
            context,
            element,
            'primitive',
            '/math/expression',
            math.expression,
            variable.label,
          ),
        ],
        details: { variableLabel: variable.label },
      });
    }
    const displayedValue = explicitVariableValue(
      `${math.display ?? ''} ${element.content ?? ''}`,
      variable.label,
    );
    if (
      displayedValue !== null &&
      Number.isFinite(variable.value) &&
      !numericEquivalent(displayedValue, variable.value, variable.unit)
    ) {
      addElementFinding(context, element, {
        code: 'math_variable_value_mismatch',
        category: 'structured_primitive',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Math element ${element.id} displays a different value for ${variable.label}.`,
        sourceIds: sourceIdsForElement(element),
        evidence: [
          elementEvidence(context, element, 'primitive', '/math/variables', variable.value),
          elementEvidence(
            context,
            element,
            'primitive',
            '/content',
            displayedValue,
            variable.value,
          ),
        ],
        details: {
          variableLabel: variable.label,
          declaredValue: variable.value,
          displayedValue,
        },
      });
    }
  }
}

function evaluateImage(context: EvaluationContext, element: SlideElement): void {
  const placeholder = element.image?.placeholder;
  const hasAsset = Boolean(element.imageUrl?.trim());
  if ((placeholder === true && hasAsset) || (placeholder === false && !hasAsset)) {
    addElementFinding(context, element, {
      code: 'image_placeholder_conflict',
      category: 'structured_primitive',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Image ${element.id} placeholder state contradicts its asset state.`,
      sourceIds: sourceIdsForElement(element),
      evidence: [
        elementEvidence(
          context,
          element,
          'primitive',
          '/image/placeholder',
          placeholder ?? 'missing',
          !hasAsset,
        ),
        elementEvidence(context, element, 'primitive', '/imageUrl', hasAsset),
      ],
      details: { placeholder: placeholder ?? 'missing', hasAsset },
    });
  }
  if (hasAsset && !element.image?.credit?.trim()) {
    addElementFinding(context, element, {
      code: 'image_credit_missing',
      category: 'structured_primitive',
      severity: 'warning',
      disposition: 'advisory',
      message: `Image ${element.id} has an asset but no structured credit.`,
      sourceIds: sourceIdsForElement(element),
      evidence: [
        elementEvidence(context, element, 'primitive', '/image/credit', '', 'credit text'),
      ],
      details: { hasAsset },
    });
  }
}

function evaluateVideo(context: EvaluationContext, element: SlideElement): void {
  const video = element.video;
  if (!video) return;
  const invalidStart =
    video.startAtSeconds !== undefined &&
    (!Number.isFinite(video.startAtSeconds) || video.startAtSeconds < 0);
  const invalidEnd =
    video.endAtSeconds !== undefined &&
    (!Number.isFinite(video.endAtSeconds) || video.endAtSeconds <= (video.startAtSeconds ?? 0));
  if (invalidStart || invalidEnd) {
    addElementFinding(context, element, {
      code: 'video_timing_invalid',
      category: 'structured_primitive',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Video ${element.id} has contradictory start/end timing.`,
      sourceIds: sourceIdsForElement(element),
      evidence: [
        elementEvidence(
          context,
          element,
          'primitive',
          '/video',
          [video.startAtSeconds ?? 0, video.endAtSeconds ?? -1],
          '0 <= start < end',
        ),
      ],
      details: {
        startAtSeconds: video.startAtSeconds ?? 0,
        endAtSeconds: video.endAtSeconds ?? -1,
      },
    });
  }
  if (Boolean(video.captionsUrl?.trim()) !== Boolean(video.captionsLanguage?.trim())) {
    addElementFinding(context, element, {
      code: 'video_caption_metadata_incomplete',
      category: 'structured_primitive',
      severity: 'warning',
      disposition: 'advisory',
      message: `Video ${element.id} must pair caption URL and language metadata.`,
      sourceIds: sourceIdsForElement(element),
      evidence: [
        elementEvidence(
          context,
          element,
          'primitive',
          '/video/captionsUrl',
          Boolean(video.captionsUrl?.trim()),
          Boolean(video.captionsLanguage?.trim()),
        ),
      ],
      details: {
        hasCaptionsUrl: Boolean(video.captionsUrl?.trim()),
        hasCaptionsLanguage: Boolean(video.captionsLanguage?.trim()),
      },
    });
  }
}

function evaluateDiagramGroup(context: EvaluationContext, members: SlideElement[]): void {
  const first = members[0];
  if (!first) return;
  const nodes = members.filter((element) => /^diagram_node$/i.test(element.role ?? ''));
  const connectors = members.filter((element) => /^diagram_connector$/i.test(element.role ?? ''));
  const kindMismatch =
    nodes.some(
      (element) => !['shape', 'text'].includes(element.kind) || !element.content?.trim(),
    ) || connectors.some((element) => element.kind !== 'connector');
  const expectedConnectors = Math.max(0, nodes.length - 1);
  const sourceSignatures = new Set(
    members.map((element) => [...sourceIdsForElement(element)].sort().join('\u001f')),
  );
  if (
    !first.groupId ||
    nodes.length < 2 ||
    connectors.length !== expectedConnectors ||
    kindMismatch ||
    sourceSignatures.size > 1
  ) {
    context.collector.add({
      code: 'diagram_structure_mismatch',
      category: 'structured_primitive',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Diagram on slide ${first.slideId} is not a consistent node/connector sequence.`,
      slideIds: [first.slideId],
      elementIds: members.map((element) => element.id),
      sourceIds: uniqueSorted(members.flatMap(sourceIdsForElement)),
      evidence: members
        .slice(0, NODESLIDE_SEMANTIC_EVALUATION_LIMITS.evidencePerFinding)
        .map((element) =>
          elementEvidence(
            context,
            element,
            'primitive',
            '/role',
            `${element.kind}:${element.role ?? ''}`,
            'ordered diagram node or connector',
          ),
        ),
      details: {
        groupId: first.groupId ?? '',
        nodeCount: nodes.length,
        connectorCount: connectors.length,
        expectedConnectorCount: expectedConnectors,
        sourceSignatureCount: sourceSignatures.size,
      },
    });
  }
}

function evaluatePrimitiveCoverage(
  context: EvaluationContext,
  requiredPrimitives: readonly NodeSlideSemanticPrimitiveKind[],
): NodeSlideSemanticPrimitiveCoverage {
  const required = new Set(requiredPrimitives);
  const items = Object.fromEntries(
    PRIMITIVE_KIND_KEYS.map((kind) => {
      const elements = context.elements.filter((element) => element.kind === kind);
      const malformed = elements.filter((element) => !isSemanticallyValidPrimitive(element));
      for (const element of malformed) {
        addElementFinding(context, element, {
          code: 'primitive_malformed',
          category: 'structured_primitive',
          severity: 'error',
          disposition: 'hard_blocker',
          message: `${capitalize(kind)} primitive ${element.id} is semantically malformed.`,
          sourceIds: sourceIdsForElement(element),
          evidence: [
            elementEvidence(
              context,
              element,
              'primitive',
              '',
              primitiveSemanticSummary(element),
              `valid ${kind} primitive`,
            ),
          ],
          details: { primitiveKind: kind },
        });
      }
      const item: NodeSlideSemanticPrimitiveCoverageItem = {
        kind,
        required: required.has(kind),
        count: elements.length,
        validCount: elements.length - malformed.length,
        malformedCount: malformed.length,
        covered: elements.length > 0 && malformed.length === 0,
      };
      return [kind, item];
    }),
  ) as Record<NodeSlideSemanticPrimitiveKind, NodeSlideSemanticPrimitiveCoverageItem>;
  for (const kind of required) {
    if (items[kind].covered) continue;
    context.collector.add({
      code: 'primitive_missing',
      category: 'structured_primitive',
      severity: 'error',
      disposition: 'hard_blocker',
      message:
        items[kind].count === 0
          ? `Required ${kind} primitive is missing.`
          : `Required ${kind} primitive has no semantically valid instance.`,
      elementIds: context.elements
        .filter((element) => element.kind === kind)
        .map((element) => element.id),
      slideIds: context.elements
        .filter((element) => element.kind === kind)
        .map((element) => element.slideId),
      sourceIds: context.elements
        .filter((element) => element.kind === kind)
        .flatMap(sourceIdsForElement),
      evidence: [makeEvidence('primitive', '/elements', items[kind].validCount, 1)],
      details: { primitiveKind: kind, observedCount: items[kind].count },
    });
  }
  return {
    complete: [...required].every((kind) => items[kind].covered),
    items,
  };
}

function isSemanticallyValidPrimitive(element: SlideElement): boolean {
  if (element.kind === 'text') return Boolean(element.content?.trim());
  if (element.kind === 'chart') {
    const chart = element.chart;
    return Boolean(
      chart &&
        chart.labels.length > 0 &&
        chart.series.length > 0 &&
        chart.labels.every((label) => Boolean(label.trim())) &&
        chart.series.every(
          (series) =>
            Boolean(series.name.trim()) &&
            series.values.length === chart.labels.length &&
            series.values.every((value) => typeof value === 'number' && Number.isFinite(value)),
        ),
    );
  }
  if (element.kind === 'math') {
    const math = element.math;
    return Boolean(
      math?.expression.trim() &&
        (math.variables ?? []).every(
          (variable) =>
            Boolean(variable.label.trim()) &&
            Number.isFinite(variable.value) &&
            expressionContainsVariable(math.expression, variable.label),
        ),
    );
  }
  if (element.kind === 'image') {
    if (!element.image) return Boolean(element.imageUrl?.trim());
    return element.image.placeholder
      ? !element.imageUrl?.trim()
      : Boolean(element.imageUrl?.trim());
  }
  if (element.kind === 'video') {
    const video = element.video;
    return Boolean(
      video?.url.trim() &&
        (video.startAtSeconds === undefined ||
          (Number.isFinite(video.startAtSeconds) && video.startAtSeconds >= 0)) &&
        (video.endAtSeconds === undefined ||
          (Number.isFinite(video.endAtSeconds) &&
            video.endAtSeconds > (video.startAtSeconds ?? 0))),
    );
  }
  if (/^diagram_node$/i.test(element.role ?? '')) return Boolean(element.content?.trim());
  return true;
}

function primitiveSemanticSummary(element: SlideElement): string {
  if (element.kind === 'text') return element.content ?? '';
  if (element.kind === 'chart') {
    return `labels=${element.chart?.labels.length ?? 0};series=${element.chart?.series.length ?? 0}`;
  }
  if (element.kind === 'math') return element.math?.expression ?? '';
  if (element.kind === 'image') {
    return `placeholder=${String(element.image?.placeholder)};asset=${Boolean(element.imageUrl?.trim())}`;
  }
  if (element.kind === 'video') return element.video?.url ?? '';
  return `${element.kind}:${element.role ?? ''}`;
}

function extractClaims(context: EvaluationContext): ClaimOccurrence[] {
  const claims: ClaimOccurrence[] = [];
  let observedClaims = 0;
  const push = (claim: ClaimOccurrence) => {
    observedClaims += 1;
    if (claims.length < NODESLIDE_SEMANTIC_EVALUATION_LIMITS.claims) claims.push(claim);
  };
  for (const slide of context.slides) {
    const title = cleanedClaim(slide.title);
    if (title) {
      push(
        claimOccurrence({
          origin: 'slide_title',
          text: title,
          slideId: slide.id,
          sourceIds: [],
          path: `${slidePath(context, slide.id)}/title`,
        }),
      );
    }
  }
  for (const element of context.elements) {
    if (element.visible === false) continue;
    if (element.kind === 'chart' && element.chart) {
      const unit = normalizeUnit(element.chart.unit ?? '');
      element.chart.series.forEach((series, seriesIndex) => {
        element.chart?.labels.forEach((label, labelIndex) => {
          const value = series.values[labelIndex];
          if (value === undefined || !Number.isFinite(value)) return;
          const subject = normalizeSubject(`${series.name} ${label}`);
          push({
            origin: 'chart',
            text: `${series.name} ${label}: ${value}${element.chart?.unit ?? ''}`,
            canonical: '',
            slideId: element.slideId,
            elementId: element.id,
            sourceIds: sourceIdsForElement(element),
            path: `${elementPath(context, element.id)}/chart/series/${seriesIndex}/values/${labelIndex}`,
            numeric: { key: subject, value, unit },
          });
        });
      });
    }
    if (!element.content?.trim() || BOILERPLATE_ROLE.test(element.role ?? '')) continue;
    for (const sentence of splitClaims(element.content).slice(
      0,
      NODESLIDE_SEMANTIC_EVALUATION_LIMITS.claimsPerElement,
    )) {
      push(
        claimOccurrence({
          origin: 'text',
          text: sentence,
          slideId: element.slideId,
          elementId: element.id,
          sourceIds: sourceIdsForElement(element),
          path: `${elementPath(context, element.id)}/content`,
          fallbackSubject: element.name,
        }),
      );
    }
  }
  if (observedClaims > NODESLIDE_SEMANTIC_EVALUATION_LIMITS.claims) {
    context.collector.add({
      code: 'evaluation_input_truncated',
      category: 'evaluation',
      severity: 'critical',
      disposition: 'hard_blocker',
      message: 'Semantic claim extraction reached its deterministic processing bound.',
      evidence: [
        makeEvidence(
          'limit',
          '/elements',
          observedClaims,
          NODESLIDE_SEMANTIC_EVALUATION_LIMITS.claims,
        ),
      ],
      details: { observedClaims, processedClaims: claims.length },
    });
    context.inputTruncated = true;
  }
  return claims;
}

function evaluateClaims(context: EvaluationContext, claims: ClaimOccurrence[]): void {
  evaluateDuplicateClaims(context, claims);
  evaluateNumericContradictions(context, claims);
  evaluateDirectionContradictions(context, claims);
  evaluatePolarityContradictions(context, claims);
}

function evaluateDuplicateClaims(context: EvaluationContext, claims: ClaimOccurrence[]): void {
  const groups = new Map<string, ClaimOccurrence[]>();
  for (const claim of claims) {
    if (claim.origin === 'chart' || !substantiveDuplicateClaim(claim.canonical)) continue;
    const existing = groups.get(claim.canonical) ?? [];
    existing.push(claim);
    groups.set(claim.canonical, existing);
  }
  for (const [canonical, occurrences] of groups) {
    if (new Set(occurrences.map((occurrence) => occurrence.slideId)).size < 2) continue;
    context.collector.add(
      claimFindingDraft(context, occurrences, {
        code: 'duplicate_claim',
        category: 'claims',
        severity: 'warning',
        disposition: 'advisory',
        message: `The same claim is repeated across ${new Set(occurrences.map((item) => item.slideId)).size} slides.`,
        details: { normalizedClaim: canonical, occurrenceCount: occurrences.length },
      }),
    );
  }
}

function evaluateNumericContradictions(
  context: EvaluationContext,
  claims: ClaimOccurrence[],
): void {
  const groups = new Map<string, ClaimOccurrence[]>();
  for (const claim of claims) {
    if (!claim.numeric?.key || !Number.isFinite(claim.numeric.value)) continue;
    const key = `${claim.numeric.key}\u001f${claim.numeric.unit}`;
    const existing = groups.get(key) ?? [];
    existing.push(claim);
    groups.set(key, existing);
  }
  for (const [key, occurrences] of groups) {
    const values = uniqueSorted(
      occurrences.map((occurrence) => normalizedNumber(occurrence.numeric?.value ?? 0)),
    );
    if (values.length < 2) continue;
    context.collector.add(
      claimFindingDraft(context, occurrences, {
        code: 'contradictory_claim',
        category: 'claims',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Claims for ${key.split('\u001f')[0] ?? 'the same metric'} use contradictory values.`,
        details: { contradictionKind: 'numeric', claimKey: key, observedValues: values },
      }),
    );
  }
}

function evaluateDirectionContradictions(
  context: EvaluationContext,
  claims: ClaimOccurrence[],
): void {
  const groups = new Map<string, ClaimOccurrence[]>();
  for (const claim of claims) {
    if (!claim.direction?.key) continue;
    const existing = groups.get(claim.direction.key) ?? [];
    existing.push(claim);
    groups.set(claim.direction.key, existing);
  }
  for (const [key, occurrences] of groups) {
    const directions = new Set(occurrences.map((occurrence) => occurrence.direction?.direction));
    if (!directions.has('up') || !directions.has('down')) continue;
    context.collector.add(
      claimFindingDraft(context, occurrences, {
        code: 'contradictory_claim',
        category: 'claims',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Claims for ${key} assert opposite directions.`,
        details: {
          contradictionKind: 'direction',
          claimKey: key,
          observedDirections: ['up', 'down'],
        },
      }),
    );
  }
}

function evaluatePolarityContradictions(
  context: EvaluationContext,
  claims: ClaimOccurrence[],
): void {
  const groups = new Map<string, ClaimOccurrence[]>();
  for (const claim of claims) {
    if (!claim.polarity?.key) continue;
    const existing = groups.get(claim.polarity.key) ?? [];
    existing.push(claim);
    groups.set(claim.polarity.key, existing);
  }
  for (const [key, occurrences] of groups) {
    const polarities = new Set(occurrences.map((occurrence) => occurrence.polarity?.polarity));
    if (!polarities.has('positive') || !polarities.has('negative')) continue;
    context.collector.add(
      claimFindingDraft(context, occurrences, {
        code: 'contradictory_claim',
        category: 'claims',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Claims for ${key} assert and negate the same proposition.`,
        details: {
          contradictionKind: 'polarity',
          claimKey: key,
          observedPolarities: ['positive', 'negative'],
        },
      }),
    );
  }
}

function evaluateNarrative(
  context: EvaluationContext,
  spec: NodeSlideSemanticDeckSpec | undefined,
): void {
  const stages = context.slides.map((slide) => ({ slide, stage: narrativeStage(context, slide) }));
  for (const { slide } of stages) {
    const substantive = (context.elementsBySlide.get(slide.id) ?? []).some(
      (element) =>
        element.visible !== false &&
        !BOILERPLATE_ROLE.test(element.role ?? '') &&
        (Boolean(element.content?.trim()) ||
          ['chart', 'math', 'image', 'video'].includes(element.kind)),
    );
    if (substantive) continue;
    context.collector.add({
      code: 'narrative_content_missing',
      category: 'narrative',
      severity: 'warning',
      disposition: 'advisory',
      message: `Slide ${slide.id} has no substantive narrative content.`,
      slideIds: [slide.id],
      evidence: [slideEvidence(context, slide, '/elementOrder', slide.elementOrder)],
      details: { elementCount: slide.elementOrder.length },
    });
  }
  evaluateSectionContinuity(context);
  if (spec) evaluatePlannedNarrativeCoverage(context, spec);
  for (let index = 1; index < stages.length; index += 1) {
    const previous = stages[index - 1];
    const current = stages[index];
    if (!previous || !current) continue;
    const previousSequence = sectionSequence(previous.slide.section);
    const currentSequence = sectionSequence(current.slide.section);
    if (
      previousSequence !== null &&
      currentSequence !== null &&
      currentSequence !== previousSequence + 1
    ) {
      context.collector.add({
        code: 'narrative_sequence_gap',
        category: 'narrative',
        severity: 'warning',
        disposition: 'advisory',
        message: `Slide sequence moves from ${previousSequence} to ${currentSequence}.`,
        slideIds: [previous.slide.id, current.slide.id],
        evidence: [
          slideEvidence(context, previous.slide, '/section', previous.slide.section ?? ''),
          slideEvidence(
            context,
            current.slide,
            '/section',
            current.slide.section ?? '',
            previousSequence + 1,
          ),
        ],
        details: { previousSequence, currentSequence },
      });
    }
    if (!previous.stage || !current.stage) continue;
    const difference = current.stage.rank - previous.stage.rank;
    if (difference < -1 || (previous.stage.id === 'close' && current.stage.id !== 'appendix')) {
      context.collector.add({
        code: 'narrative_stage_regression',
        category: 'narrative',
        severity: 'warning',
        disposition: 'advisory',
        message: `Narrative regresses from ${previous.stage.id} to ${current.stage.id}.`,
        slideIds: [previous.slide.id, current.slide.id],
        evidence: [
          slideEvidence(context, previous.slide, '/section', previous.stage.id),
          slideEvidence(context, current.slide, '/section', current.stage.id),
        ],
        details: { previousStage: previous.stage.id, currentStage: current.stage.id },
      });
    }
  }
  if (!context.policy.requireOpeningAndClose || stages.length < 4) return;
  const first = stages[0];
  const last = stages[stages.length - 1];
  if (first?.stage && !['opening', 'context'].includes(first.stage.id)) {
    context.collector.add({
      code: 'narrative_opening_missing',
      category: 'narrative',
      severity: 'info',
      disposition: 'advisory',
      message: 'The deck opens after the expected opening/context stage.',
      slideIds: [first.slide.id],
      evidence: [
        slideEvidence(context, first.slide, '/section', first.stage.id, 'opening or context'),
      ],
      details: { observedStage: first.stage.id },
    });
  }
  if (last?.stage && !['close', 'appendix'].includes(last.stage.id)) {
    context.collector.add({
      code: 'narrative_close_missing',
      category: 'narrative',
      severity: 'info',
      disposition: 'advisory',
      message: 'The deck ends without a recognized close/next-step stage.',
      slideIds: [last.slide.id],
      evidence: [
        slideEvidence(context, last.slide, '/section', last.stage.id, 'close or appendix'),
      ],
      details: { observedStage: last.stage.id },
    });
  }
}

function evaluateSectionContinuity(context: EvaluationContext): void {
  const lastIndexByFamily = new Map<string, number>();
  context.slides.forEach((slide, index) => {
    const family = normalizeClaim((slide.section ?? '').split(/[\/#]/)[0] ?? '');
    const elements = context.elementsBySlide.get(slide.id) ?? [];
    const substantive = elements.some(
      (element) =>
        element.visible !== false &&
        !BOILERPLATE_ROLE.test(element.role ?? '') &&
        (Boolean(element.content?.trim()) ||
          ['chart', 'math', 'image', 'video'].includes(element.kind)),
    );
    if (!family && substantive) {
      context.collector.add({
        code: 'orphaned_section',
        category: 'narrative',
        severity: 'warning',
        disposition: 'advisory',
        message: `Substantive slide ${slide.id} is not attached to a narrative section.`,
        slideIds: [slide.id],
        elementIds: elements.map((element) => element.id),
        evidence: [slideEvidence(context, slide, '/section', '', 'section label')],
        details: { sectionFamily: '' },
      });
      return;
    }
    const previousIndex = lastIndexByFamily.get(family);
    if (family && previousIndex !== undefined && previousIndex < index - 1) {
      const previousSlide = context.slides[previousIndex];
      context.collector.add({
        code: 'orphaned_section',
        category: 'narrative',
        severity: 'warning',
        disposition: 'advisory',
        message: `Section ${family} resumes after an unrelated section, fragmenting the narrative.`,
        slideIds: [previousSlide?.id ?? slide.id, slide.id],
        evidence: [
          ...(previousSlide
            ? [slideEvidence(context, previousSlide, '/section', previousSlide.section ?? '')]
            : []),
          slideEvidence(context, slide, '/section', slide.section ?? ''),
        ],
        details: { sectionFamily: family, previousIndex, resumedIndex: index },
      });
    }
    if (family) lastIndexByFamily.set(family, index);
  });
}

function evaluatePlannedNarrativeCoverage(
  context: EvaluationContext,
  spec: NodeSlideSemanticDeckSpec,
): void {
  const candidateText = normalizeClaim(
    [
      context.snapshot.deck.title,
      ...context.slides.flatMap((slide) => [slide.title, slide.section ?? '']),
      ...context.elements
        .filter((element) => element.visible !== false)
        .map((element) => element.content ?? ''),
    ].join(' '),
  );
  for (const plannedStep of spec.narrative.slice(0, NODESLIDE_SEMANTIC_EVALUATION_LIMITS.slides)) {
    const normalized = normalizeClaim(plannedStep);
    if (!normalized || narrativeStepCovered(candidateText, normalized)) continue;
    context.collector.add({
      code: 'narrative_gap',
      category: 'narrative',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Planned narrative step is not represented in the candidate: ${plannedStep}`,
      evidence: [
        makeEvidence('slide', '/spec/narrative', plannedStep, 'covered candidate story beat'),
      ],
      details: { plannedStep },
    });
  }
}

function narrativeStepCovered(candidateText: string, normalizedStep: string): boolean {
  if (candidateText.includes(normalizedStep)) return true;
  const tokens = normalizedStep
    .split(' ')
    .filter((token) => token.length >= 4 && !['with', 'from', 'that', 'this'].includes(token));
  return tokens.length > 0 && tokens.every((token) => candidateText.includes(token));
}

function evaluateSources(context: EvaluationContext): void {
  const usesBySource = new Map<string, SourceUse[]>();
  for (const element of context.elements) {
    if (element.visible === false || !isFactualElement(element)) continue;
    const sourceIds = sourceIdsForElement(element);
    if (sourceIds.length === 0) {
      addElementFinding(context, element, {
        code: 'factual_claim_unbound',
        category: 'sources',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Factual element ${element.id} has no bound source.`,
        evidence: [
          elementEvidence(context, element, 'source', '/sourceIds', [], 'one or more source IDs'),
        ],
        details: { elementKind: element.kind, role: element.role ?? '' },
      });
      continue;
    }
    for (const sourceId of sourceIds) {
      const source = context.sourceById.get(sourceId);
      if (!source) {
        addElementFinding(context, element, {
          code: 'source_missing',
          category: 'sources',
          severity: 'error',
          disposition: 'hard_blocker',
          message: `Element ${element.id} references missing source ${sourceId}.`,
          sourceIds: [sourceId],
          evidence: [
            elementEvidence(
              context,
              element,
              'source',
              '/sourceIds',
              sourceId,
              'existing source ID',
            ),
          ],
          details: { missingSourceId: sourceId },
        });
        continue;
      }
      const uses = usesBySource.get(sourceId) ?? [];
      uses.push({
        slideId: element.slideId,
        elementId: element.id,
        path: `${elementPath(context, element.id)}/sourceIds`,
      });
      usesBySource.set(sourceId, uses);
    }
  }
  for (const [sourceId, uses] of usesBySource) {
    const source = context.sourceById.get(sourceId);
    if (!source) continue;
    const slideIds = uniqueSorted(uses.map((use) => use.slideId));
    const elementIds = uniqueSorted(uses.map((use) => use.elementId));
    const sourceEvidence = sourceRecordEvidence(context, source);
    if (!source.title.trim() || !source.citation.trim()) {
      context.collector.add({
        code: 'source_evidence_incomplete',
        category: 'sources',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Source ${sourceId} lacks a title or citation required to support factual claims.`,
        slideIds,
        elementIds,
        sourceIds: [sourceId],
        evidence: [sourceEvidence],
        details: {
          hasTitle: Boolean(source.title.trim()),
          hasCitation: Boolean(source.citation.trim()),
        },
      });
    }
    if (source.status === 'failed') {
      context.collector.add({
        code: 'source_failed',
        category: 'sources',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Source ${sourceId} is failed but still supports factual claims.`,
        slideIds,
        elementIds,
        sourceIds: [sourceId],
        evidence: [sourceEvidence],
        details: { sourceStatus: source.status },
      });
    } else if (source.status === 'refreshing') {
      context.collector.add({
        code: 'source_refreshing',
        category: 'sources',
        severity: 'warning',
        disposition: 'advisory',
        message: `Source ${sourceId} is refreshing while supporting factual claims.`,
        slideIds,
        elementIds,
        sourceIds: [sourceId],
        evidence: [sourceEvidence],
        details: { sourceStatus: source.status },
      });
    }
    const freshness = source.lastRefreshedAt ?? source.retrievedAt;
    if (!Number.isFinite(freshness) || freshness < 0 || freshness > context.referenceTime) {
      const futureTimestamp = freshness > context.referenceTime;
      context.collector.add({
        code: 'source_timestamp_invalid',
        category: 'sources',
        severity: 'error',
        disposition: 'hard_blocker',
        message: futureTimestamp
          ? `Source ${sourceId} has a freshness timestamp after the evaluation reference time.`
          : `Source ${sourceId} has an invalid freshness timestamp.`,
        slideIds,
        elementIds,
        sourceIds: [sourceId],
        evidence: [
          makeEvidence(
            'source',
            `${sourcePath(context, sourceId)}/${source.lastRefreshedAt === undefined ? 'retrievedAt' : 'lastRefreshedAt'}`,
            freshness,
            `<= ${context.referenceTime}`,
            { sourceId },
          ),
        ],
        details: {
          freshnessTimestamp: String(freshness),
          referenceTime: context.referenceTime,
          futureTimestamp,
        },
      });
    } else if (
      context.policy.staleSourceTypes.includes(source.sourceType) &&
      context.referenceTime - freshness > context.policy.maxSourceAgeMs
    ) {
      const ageMs = context.referenceTime - freshness;
      context.collector.add({
        code: 'source_stale',
        category: 'sources',
        severity: 'error',
        disposition: 'hard_blocker',
        message: `Source ${sourceId} is stale for factual use.`,
        slideIds,
        elementIds,
        sourceIds: [sourceId],
        evidence: [
          makeEvidence(
            'source',
            `${sourcePath(context, sourceId)}/retrievedAt`,
            ageMs,
            context.policy.maxSourceAgeMs,
            {
              sourceId,
            },
          ),
        ],
        details: { sourceAgeMs: ageMs, maximumSourceAgeMs: context.policy.maxSourceAgeMs },
      });
    }
  }
}

function evaluateSourceCoverage(context: EvaluationContext): NodeSlideSemanticSourceCoverage {
  const referencedIds = uniqueSorted(context.elements.flatMap(sourceIdsForElement));
  const boundIds = referencedIds.filter((sourceId) => context.sourceById.has(sourceId));
  const missingIds = referencedIds.filter((sourceId) => !context.sourceById.has(sourceId));
  const boundSet = new Set(boundIds);
  const unboundSources = context.sources.filter((source) => !boundSet.has(source.id));
  for (const source of unboundSources) {
    context.collector.add({
      code: 'source_unbound',
      category: 'sources',
      severity: 'warning',
      disposition: 'advisory',
      message: `Source ${source.id} is not bound to any candidate element.`,
      sourceIds: [source.id],
      evidence: [sourceRecordEvidence(context, source)],
      details: { sourceStatus: source.status ?? 'legacy', sourceType: source.sourceType },
    });
  }
  const stale = boundIds.filter((sourceId) => {
    const source = context.sourceById.get(sourceId);
    if (!source || !context.policy.staleSourceTypes.includes(source.sourceType)) return false;
    const freshness = source.lastRefreshedAt ?? source.retrievedAt;
    return (
      Number.isFinite(freshness) &&
      freshness >= 0 &&
      context.referenceTime - freshness > context.policy.maxSourceAgeMs
    );
  }).length;
  return {
    bindingAssessable: true,
    total: context.sources.length,
    bound: boundIds.length,
    unbound: unboundSources.length,
    stale,
    missingReferences: missingIds.length,
  };
}

function evaluateNotesAndDisclosures(context: EvaluationContext): void {
  for (const slide of context.slides) {
    const elements = (context.elementsBySlide.get(slide.id) ?? []).filter(
      (element) => element.visible !== false,
    );
    const requiresNotes = elements.some(
      (element) =>
        !BOILERPLATE_ROLE.test(element.role ?? '') &&
        (isFactualElement(element) || ['image', 'video'].includes(element.kind)),
    );
    if (context.policy.requireSpeakerNotes && requiresNotes && !slide.notes?.trim()) {
      context.collector.add({
        code: 'notes_missing',
        category: 'notes_disclosure',
        severity: 'warning',
        disposition: 'advisory',
        message: `Slide ${slide.id} has substantive content but no speaker notes.`,
        slideIds: [slide.id],
        elementIds: elements.map((element) => element.id),
        sourceIds: uniqueSorted(elements.flatMap(sourceIdsForElement)),
        evidence: [slideEvidence(context, slide, '/notes', '', 'speaker notes')],
        details: { evidenceElementCount: elements.filter(isFactualElement).length },
      });
    }
    if (!context.policy.requireDisclosures) continue;
    const referencedSources = uniqueSorted(elements.flatMap(sourceIdsForElement))
      .map((sourceId) => context.sourceById.get(sourceId))
      .filter((source): source is SourceRecord => Boolean(source));
    const disclosureSources = referencedSources.filter((source) =>
      DISCLOSURE_REQUIRED.test(`${source.title} ${source.citation} ${source.license ?? ''}`),
    );
    const placeholderElements = elements.filter(
      (element) => element.kind === 'image' && element.image?.placeholder === true,
    );
    const claimRequiresDisclosure = elements.some((element) =>
      DISCLOSURE_REQUIRED.test(element.content ?? ''),
    );
    if (
      disclosureSources.length === 0 &&
      placeholderElements.length === 0 &&
      !claimRequiresDisclosure
    ) {
      continue;
    }
    const visibleAndPrivateDisclosure = `${elements.map((element) => element.content ?? '').join(' ')} ${slide.notes ?? ''}`;
    if (DISCLOSURE_PRESENT.test(visibleAndPrivateDisclosure)) continue;
    const sourceIds = disclosureSources.map((source) => source.id);
    context.collector.add({
      code: 'disclosure_missing',
      category: 'notes_disclosure',
      severity: 'error',
      disposition: 'hard_blocker',
      message: `Slide ${slide.id} uses conditional or illustrative evidence without a disclosure.`,
      slideIds: [slide.id],
      elementIds: uniqueSorted([
        ...placeholderElements.map((element) => element.id),
        ...elements
          .filter((element) => intersects(sourceIdsForElement(element), sourceIds))
          .map((element) => element.id),
      ]),
      sourceIds,
      evidence: [
        slideEvidence(
          context,
          slide,
          '/notes',
          slide.notes ?? '',
          'illustrative/estimate disclosure',
        ),
        ...disclosureSources
          .slice(0, NODESLIDE_SEMANTIC_EVALUATION_LIMITS.evidencePerFinding - 1)
          .map((source) => sourceRecordEvidence(context, source)),
      ],
      details: {
        disclosureSourceCount: disclosureSources.length,
        placeholderCount: placeholderElements.length,
      },
    });
  }
}

function finalizeFindings(context: EvaluationContext): {
  findings: NodeSlideSemanticFinding[];
  observedFindings: number;
  findingsTruncated: boolean;
} {
  const observedBeforeTruncation = context.collector.observed;
  const findingsTruncated =
    context.collector.discarded > 0 || observedBeforeTruncation > context.policy.maxFindings;
  let drafts = context.collector.drafts();
  if (findingsTruncated) {
    drafts = [
      {
        code: 'evaluation_findings_truncated',
        category: 'evaluation',
        severity: 'critical',
        disposition: 'hard_blocker',
        message: 'Semantic findings exceeded the deterministic receipt bound.',
        evidence: [
          makeEvidence('limit', '/findings', observedBeforeTruncation, context.policy.maxFindings),
        ],
        details: {
          observedFindings: observedBeforeTruncation,
          returnedFindingLimit: context.policy.maxFindings,
        },
      },
      ...drafts,
    ];
  }
  const byId = new Map<string, NodeSlideSemanticFinding>();
  for (const draft of drafts) {
    const finding = materializeFinding(context, draft);
    if (!byId.has(finding.id)) byId.set(finding.id, finding);
  }
  const sorted = [...byId.values()].sort((left, right) => compareFindings(context, left, right));
  const findings = sorted.slice(0, context.policy.maxFindings).map((finding, index) => ({
    ...finding,
    rank: index + 1,
  }));
  return {
    findings,
    observedFindings: observedBeforeTruncation + (findingsTruncated ? 1 : 0),
    findingsTruncated,
  };
}

function materializeFinding(
  context: EvaluationContext,
  draft: FindingDraft,
): NodeSlideSemanticFinding {
  const bindings = {
    slideIds: orderedIds(draft.slideIds ?? [], context.slideRank),
    elementIds: orderedIds(draft.elementIds ?? [], context.elementRank),
    sourceIds: uniqueSorted(draft.sourceIds ?? []),
  };
  const evidence = uniqueEvidence(draft.evidence).slice(
    0,
    NODESLIDE_SEMANTIC_EVALUATION_LIMITS.evidencePerFinding,
  );
  const details = canonicalDetails(draft.details ?? {});
  const related = evidence
    .filter((item) => item.slideId || item.elementId || item.sourceId)
    .map((item) => ({
      ...(item.slideId ? { slideId: item.slideId } : {}),
      ...(item.elementId ? { elementId: item.elementId } : {}),
      ...(item.sourceId ? { sourceId: item.sourceId } : {}),
      path: item.path,
    }));
  const identity = {
    code: draft.code,
    category: draft.category,
    severity: draft.severity,
    disposition: draft.disposition,
    bindings,
    evidence: evidence.map((item) => item.digest),
    details,
  };
  return {
    id: nodeslideStableId('semantic_finding', stableSerialize(identity)),
    rank: 0,
    code: draft.code,
    category: draft.category,
    severity: draft.severity,
    disposition: draft.disposition,
    message: cleanEvidenceText(draft.message),
    bindings,
    evidence,
    details,
    evidenceDigest: nodeslideContentDigest(stableSerialize(identity)),
    ...(bindings.slideIds[0] ? { slideId: bindings.slideIds[0] } : {}),
    ...(bindings.elementIds[0] ? { elementId: bindings.elementIds[0] } : {}),
    ...(bindings.sourceIds[0] ? { sourceId: bindings.sourceIds[0] } : {}),
    related,
  };
}

function compareFindings(
  context: EvaluationContext,
  left: NodeSlideSemanticFinding,
  right: NodeSlideSemanticFinding,
): number {
  const dispositionDifference =
    (left.disposition === 'hard_blocker' ? 0 : 1) - (right.disposition === 'hard_blocker' ? 0 : 1);
  if (dispositionDifference !== 0) return dispositionDifference;
  const severityDifference = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severityDifference !== 0) return severityDifference;
  const slideDifference =
    (context.slideRank.get(left.bindings.slideIds[0] ?? '') ?? Number.MAX_SAFE_INTEGER) -
    (context.slideRank.get(right.bindings.slideIds[0] ?? '') ?? Number.MAX_SAFE_INTEGER);
  if (slideDifference !== 0) return slideDifference;
  return `${left.category}:${left.code}:${left.bindings.elementIds.join(',')}:${left.id}`.localeCompare(
    `${right.category}:${right.code}:${right.bindings.elementIds.join(',')}:${right.id}`,
  );
}

function summarizeFindings(findings: NodeSlideSemanticFinding[]) {
  const bySeverity: Record<NodeSlideSemanticSeverity, number> = {
    critical: 0,
    error: 0,
    warning: 0,
    info: 0,
  };
  const byCategory = Object.fromEntries(CATEGORY_KEYS.map((category) => [category, 0])) as Record<
    NodeSlideSemanticCategory,
    number
  >;
  let hardBlockers = 0;
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byCategory[finding.category] += 1;
    if (finding.disposition === 'hard_blocker') hardBlockers += 1;
  }
  return {
    hardBlockers,
    advisories: findings.length - hardBlockers,
    bySeverity,
    byCategory,
  };
}

function addElementFinding(
  context: EvaluationContext,
  element: SlideElement,
  draft: Omit<FindingDraft, 'slideIds' | 'elementIds'>,
): void {
  context.collector.add({
    ...draft,
    slideIds: [element.slideId],
    elementIds: [element.id],
  });
}

function addCompanionFinding(
  context: EvaluationContext,
  chart: SlideElement,
  companion: SlideElement,
  draft: Omit<FindingDraft, 'slideIds' | 'elementIds'>,
): void {
  context.collector.add({
    ...draft,
    slideIds: [chart.slideId],
    elementIds: [chart.id, companion.id],
  });
}

function claimFindingDraft(
  _context: EvaluationContext,
  occurrences: ClaimOccurrence[],
  draft: Pick<
    FindingDraft,
    'code' | 'category' | 'severity' | 'disposition' | 'message' | 'details'
  >,
): FindingDraft {
  const retained = occurrences.slice(0, NODESLIDE_SEMANTIC_EVALUATION_LIMITS.evidencePerFinding);
  return {
    ...draft,
    slideIds: occurrences.map((occurrence) => occurrence.slideId),
    elementIds: occurrences.flatMap((occurrence) =>
      occurrence.elementId ? [occurrence.elementId] : [],
    ),
    sourceIds: occurrences.flatMap((occurrence) => occurrence.sourceIds),
    evidence: retained.map((occurrence) =>
      makeEvidence('text_claim', occurrence.path, occurrence.text, undefined, {
        slideId: occurrence.slideId,
        ...(occurrence.elementId ? { elementId: occurrence.elementId } : {}),
      }),
    ),
    details: {
      ...draft.details,
      evidenceOccurrenceCount: retained.length,
      totalOccurrenceCount: occurrences.length,
    },
  };
}

function elementEvidence(
  context: EvaluationContext,
  element: SlideElement,
  kind: NodeSlideSemanticEvidence['kind'],
  suffix: string,
  observed: NodeSlideSemanticValue | undefined,
  expected?: NodeSlideSemanticValue,
): NodeSlideSemanticEvidence {
  return makeEvidence(
    kind,
    `${elementPath(context, element.id)}${suffix}`,
    observed ?? '',
    expected,
    {
      slideId: element.slideId,
      elementId: element.id,
    },
  );
}

function slideEvidence(
  context: EvaluationContext,
  slide: Slide,
  suffix: string,
  observed: NodeSlideSemanticValue,
  expected?: NodeSlideSemanticValue,
): NodeSlideSemanticEvidence {
  return makeEvidence('slide', `${slidePath(context, slide.id)}${suffix}`, observed, expected, {
    slideId: slide.id,
  });
}

function sourceRecordEvidence(
  context: EvaluationContext,
  source: SourceRecord,
): NodeSlideSemanticEvidence {
  return makeEvidence(
    'source',
    sourcePath(context, source.id),
    `${source.title} | ${source.citation}`,
    undefined,
    { sourceId: source.id },
  );
}

function makeEvidence(
  kind: NodeSlideSemanticEvidence['kind'],
  path: string,
  observed: NodeSlideSemanticValue,
  expected?: NodeSlideSemanticValue,
  binding: Pick<NodeSlideSemanticEvidence, 'slideId' | 'elementId' | 'sourceId'> = {},
): NodeSlideSemanticEvidence {
  const normalizedObserved = cleanSemanticValue(observed);
  const normalizedExpected = expected === undefined ? undefined : cleanSemanticValue(expected);
  const partial = {
    kind,
    path,
    observed: normalizedObserved,
    ...(normalizedExpected !== undefined ? { expected: normalizedExpected } : {}),
    ...(binding.slideId ? { slideId: binding.slideId } : {}),
    ...(binding.elementId ? { elementId: binding.elementId } : {}),
    ...(binding.sourceId ? { sourceId: binding.sourceId } : {}),
  };
  return { digest: nodeslideContentDigest(stableSerialize(partial)), ...partial };
}

function claimOccurrence(args: {
  origin: ClaimOccurrence['origin'];
  text: string;
  slideId: string;
  elementId?: string;
  sourceIds: string[];
  path: string;
  fallbackSubject?: string;
}): ClaimOccurrence {
  const text = cleanedClaim(args.text);
  const partial = {
    origin: args.origin,
    text,
    canonical: normalizeClaim(text),
    slideId: args.slideId,
    ...(args.elementId ? { elementId: args.elementId } : {}),
    sourceIds: uniqueSorted(args.sourceIds),
    path: args.path,
  };
  const numeric = numericFact(text, args.fallbackSubject);
  const direction = directionFact(text);
  const polarity = polarityFact(text);
  return {
    ...partial,
    ...(numeric ? { numeric } : {}),
    ...(direction ? { direction } : {}),
    ...(polarity ? { polarity } : {}),
  };
}

function numericFact(text: string, fallbackSubject?: string): NumericFact | undefined {
  const cleaned = cleanedClaim(text);
  const pattern =
    /^(.{2,120}?)(?:\s+(?:is|are|was|were|equals?|reached?|hit|totals?|totaled|stands? at|grew to|rose to|fell to|declined to)|\s*[:=])\s*([$€£¥])?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(%|percent|percentage points?|pp|[kmbt]|thousand|million|billion|trillion|mn|bn|users?|customers?|seconds?|minutes?|hours?|days?)?\b(.*)$/i;
  const match = cleaned.match(pattern);
  if (match) {
    const subject = normalizeSubject(match[1] ?? '');
    const value = parsedNumber(match[3] ?? '', match[4]);
    if (!subject || value === null) return undefined;
    return {
      key: `${subject}${temporalContext(match[5] ?? '')}`,
      value,
      unit: normalizeUnit(`${match[2] ?? ''}${match[4] ?? ''}`),
    };
  }
  const valueOnly = cleaned.match(
    /^\s*([$€£¥])?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(%|percent|[kmbt]|thousand|million|billion|trillion|mn|bn)?\s*$/i,
  );
  const fallback = normalizeSubject(fallbackSubject ?? '');
  if (!valueOnly || !fallback || /^(?:primary )?metric|value|stat$/i.test(fallback))
    return undefined;
  const value = parsedNumber(valueOnly[2] ?? '', valueOnly[3]);
  if (value === null) return undefined;
  return {
    key: fallback,
    value,
    unit: normalizeUnit(`${valueOnly[1] ?? ''}${valueOnly[3] ?? ''}`),
  };
}

function directionFact(text: string): DirectionFact | undefined {
  const match = cleanedClaim(text).match(
    /^(.{2,120}?)\s+(?:has |have |is |are |was |were )?(increased|grew|risen|rose|improved|accelerated|expanded|higher|decreased|declined|fell|fallen|dropped|contracted|lower)\b(.*)$/i,
  );
  if (!match) return undefined;
  const key = `${normalizeSubject(match[1] ?? '')}${temporalContext(match[3] ?? '')}`;
  if (!key) return undefined;
  const down = /^(?:decreased|declined|fell|fallen|dropped|contracted|lower)$/i.test(
    match[2] ?? '',
  );
  return { key, direction: down ? 'down' : 'up' };
}

function polarityFact(text: string): PolarityFact | undefined {
  const match = cleanedClaim(text).match(
    /^(.{2,100}?)\s+(is|are|was|were|can|will|does|do|has|have)\s+(not\s+|no longer\s+)?(.{2,140})$/i,
  );
  if (!match) return undefined;
  const subject = normalizeSubject(match[1] ?? '');
  const predicate = normalizeClaim(match[4] ?? '');
  if (!subject || !predicate || QUANTITATIVE_CLAIM.test(predicate)) return undefined;
  return {
    key: `${subject} ${normalizeClaim(match[2] ?? '')} ${predicate}`,
    polarity: match[3] ? 'negative' : 'positive',
  };
}

function narrativeStage(context: EvaluationContext, slide: Slide): NarrativeStage | undefined {
  const elements = context.elementsBySlide.get(slide.id) ?? [];
  const roleFromNotes = slide.notes?.match(/narrative role:\s*([^\n.]+)/i)?.[1] ?? '';
  const semanticCopy = elements
    .filter((element) => /^(?:section|title|headline)$/i.test(element.role ?? ''))
    .map((element) => element.content ?? '')
    .join(' ');
  const text =
    `${slide.section ?? ''} ${slide.title} ${roleFromNotes} ${semanticCopy}`.toLowerCase();
  const stages: Array<[NarrativeStage, RegExp]> = [
    [{ id: 'appendix', rank: 6 }, /\b(?:appendix|methodology|references?|backup)\b/],
    [{ id: 'opening', rank: 0 }, /\b(?:opening|overview|agenda|intro|introduction|title)\b/],
    [{ id: 'close', rank: 5 }, /\b(?:close|closing|next|call to action|decision|ask)\b/],
    [
      { id: 'proof', rank: 4 },
      /\b(?:proof|trust|delivery|implementation|validation|results?|roadmap|plan)\b/,
    ],
    [
      { id: 'approach', rank: 3 },
      /\b(?:approach|solution|workflow|strategy|recommendation|how it works|execution)\b/,
    ],
    [
      { id: 'evidence', rank: 2 },
      /\b(?:evidence|insight|foundation|findings?|data|opportunity|analysis)\b/,
    ],
    [
      { id: 'context', rank: 1 },
      /\b(?:context|problem|challenge|scenario|current state|why now|pain)\b/,
    ],
  ];
  return stages.find(([, pattern]) => pattern.test(text))?.[0];
}

function sectionSequence(section: string | undefined): number | null {
  const match = section?.trim().match(/(?:^|[/#\s-])(\d{1,3})\s*$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

function isFactualElement(element: SlideElement): boolean {
  if (element.kind === 'chart' || element.kind === 'math') return true;
  if (element.kind !== 'text' && element.kind !== 'shape') return false;
  const content = element.content?.replace(/^\s*(?:[•·]|\d{1,2}[.)])\s*/, '') ?? '';
  return FACTUAL_ROLE.test(element.role ?? '') || QUANTITATIVE_CLAIM.test(content);
}

function sourceIdsForElement(element: SlideElement): string[] {
  return uniqueSorted([
    ...element.sourceIds,
    ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ...(element.math?.sourceId ? [element.math.sourceId] : []),
    ...(element.image?.sourceId ? [element.image.sourceId] : []),
  ]);
}

function splitClaims(content: string): string[] {
  return content
    .replace(/\r/g, '')
    .split(/(?:\n+|(?<=[.!?])\s+|\s+[•·]\s+|\s*;\s*)/)
    .map(cleanedClaim)
    .filter(Boolean);
}

function cleanedClaim(value: string): string {
  return cleanEvidenceText(value.replace(/^\s*(?:[•·]|\d{1,2}[.)])\s*/, ''));
}

function normalizeClaim(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9%$€£¥]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSubject(value: string): string {
  return normalizeClaim(value)
    .replace(/^(?:the|a|an|our|this|that)\s+/, '')
    .replace(/\s+(?:metric|measure|figure)$/, '')
    .trim();
}

function substantiveDuplicateClaim(canonical: string): boolean {
  return canonical.length >= 24 && canonical.split(' ').filter(Boolean).length >= 4;
}

function temporalContext(value: string): string {
  const match = value.match(
    /\b(?:in|for|during|as of)\s+((?:q[1-4]|h[12]|fy)?\s*(?:19|20)?\d{2,4}|today|this (?:month|quarter|year))\b/i,
  );
  return match ? ` ${normalizeClaim(match[1] ?? '')}` : '';
}

function captionValue(content: string, label: string, seriesName?: string): number | null {
  const number =
    '([$€£¥])?\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*(%|percent|[kmbt]|thousand|million|billion|trillion|mn|bn)?';
  const labelPattern = escapeRegExp(label);
  const prefixes = seriesName
    ? [
        `${escapeRegExp(seriesName)}\\s+(?:${labelPattern})`,
        `${labelPattern}\\s+(?:${escapeRegExp(seriesName)})`,
      ]
    : [labelPattern];
  for (const prefix of prefixes) {
    const match = content.match(
      new RegExp(`(?:^|\\b)${prefix}\\s*(?::|=|is\\b|was\\b|at\\b)\\s*${number}`, 'i'),
    );
    if (!match) continue;
    return parsedNumber(match[2] ?? '', match[3]);
  }
  return null;
}

function explicitVariableValue(content: string, label: string): number | null {
  const match = content.match(
    new RegExp(
      `(?:^|[^A-Za-z0-9_])${escapeRegExp(label)}\\s*(?:=|:|is\\b)\\s*([$€£¥])?\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*(%|percent|[kmbt]|thousand|million|billion|trillion|mn|bn)?`,
      'i',
    ),
  );
  return match ? parsedNumber(match[2] ?? '', match[3]) : null;
}

function parsedNumber(raw: string, suffix: string | undefined): number | null {
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const normalizedSuffix = (suffix ?? '').toLowerCase();
  const multiplier = /^(?:k|thousand)$/.test(normalizedSuffix)
    ? 1_000
    : /^(?:m|mn|million)$/.test(normalizedSuffix)
      ? 1_000_000
      : /^(?:b|bn|billion)$/.test(normalizedSuffix)
        ? 1_000_000_000
        : /^(?:t|trillion)$/.test(normalizedSuffix)
          ? 1_000_000_000_000
          : 1;
  return value * multiplier;
}

function numericEquivalent(left: number, right: number, unit: string | undefined): boolean {
  const tolerance = Math.max(1e-9, Math.max(Math.abs(left), Math.abs(right)) * 1e-9);
  if (Math.abs(left - right) <= tolerance) return true;
  if (normalizeUnit(unit ?? '') === '%' && Math.min(Math.abs(left), Math.abs(right)) <= 1) {
    return Math.abs(left * 100 - right) <= tolerance || Math.abs(right * 100 - left) <= tolerance;
  }
  return false;
}

function normalizedNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return String(value);
  return Number(value.toPrecision(12)).toString();
}

function normalizeUnit(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (/%|percent|percentage/.test(normalized)) return '%';
  if (/\$|usd|dollars?/.test(normalized)) return '$';
  if (/€|eur|euros?/.test(normalized)) return '€';
  if (/£|gbp|pounds?/.test(normalized)) return '£';
  if (/¥|jpy|yen/.test(normalized)) return '¥';
  if (/milliseconds?|\bms\b/.test(normalized)) return 'ms';
  if (/seconds?|\bsec\b/.test(normalized)) return 's';
  if (/minutes?|\bmin\b/.test(normalized)) return 'min';
  if (/hours?|\bhr\b/.test(normalized)) return 'h';
  if (/days?/.test(normalized)) return 'day';
  return normalizeClaim(normalized);
}

function detectUnit(content: string): string {
  const candidates = content.match(
    /%|percent(?:age)?|[$€£¥]|usd|eur|gbp|jpy|milliseconds?|\bms\b|seconds?|\bsec\b|minutes?|\bmin\b|hours?|\bhr\b|days?/i,
  );
  return normalizeUnit(candidates?.[0] ?? '');
}

function delimitedAxisLabels(content: string): string[] | null {
  const withoutPrefix = content.replace(
    /^\s*(?:x[_ -]?axis|category axis|axis labels?|categories)\s*[:=-]\s*/i,
    '',
  );
  if (!/[|,;]|(?:\s+->\s+)|(?:\s+→\s+)/.test(withoutPrefix)) return null;
  const labels = withoutPrefix
    .split(/\s*(?:\||,|;|->|→)\s*/)
    .map((label) => label.replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
  return labels.length >= 2 ? labels : null;
}

function sameNormalizedSequence(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => normalizeClaim(value) === normalizeClaim(right[index] ?? ''))
  );
}

function normalizeFormula(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').replace(/[−–—]/g, '-').toLowerCase();
}

function expressionContainsVariable(expression: string, label: string): boolean {
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(label)}(?:$|[^A-Za-z0-9_])`, 'i').test(
    expression,
  );
}

function resolvedReferenceTime(
  options: NodeSlideSemanticEvaluationOptions,
  fallback: number,
): number {
  if (
    options.referenceTime !== undefined &&
    options.evaluatedAt !== undefined &&
    options.referenceTime !== options.evaluatedAt
  ) {
    throw new Error('Semantic referenceTime and evaluatedAt aliases must match.');
  }
  const resolved = options.referenceTime ?? options.evaluatedAt ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error('Semantic evaluation referenceTime must be a non-negative safe integer.');
  }
  return resolved;
}

function resolvedPolicy(options: NodeSlideSemanticEvaluationOptions): NodeSlideSemanticPolicy {
  const policy = options.policy;
  if (
    options.sourceStaleAfterMs !== undefined &&
    policy?.maxSourceAgeMs !== undefined &&
    options.sourceStaleAfterMs !== policy.maxSourceAgeMs
  ) {
    throw new Error('Semantic source freshness aliases must match.');
  }
  const maxSourceAgeMs =
    policy?.maxSourceAgeMs ?? options.sourceStaleAfterMs ?? DEFAULT_MAX_SOURCE_AGE_MS;
  if (
    !Number.isSafeInteger(maxSourceAgeMs) ||
    maxSourceAgeMs <= 0 ||
    maxSourceAgeMs > MAX_SOURCE_AGE_MS
  ) {
    throw new Error(`Semantic maxSourceAgeMs must be between 1 and ${MAX_SOURCE_AGE_MS}.`);
  }
  const maxFindings = policy?.maxFindings ?? DEFAULT_MAX_FINDINGS;
  if (
    !Number.isSafeInteger(maxFindings) ||
    maxFindings <= 0 ||
    maxFindings > NODESLIDE_SEMANTIC_EVALUATION_LIMITS.findings
  ) {
    throw new Error(
      `Semantic maxFindings must be between 1 and ${NODESLIDE_SEMANTIC_EVALUATION_LIMITS.findings}.`,
    );
  }
  const staleSourceTypes = uniqueSorted(policy?.staleSourceTypes ?? ['url', 'spreadsheet']);
  if (
    staleSourceTypes.length === 0 ||
    staleSourceTypes.some(
      (sourceType) => !SOURCE_TYPE_KEYS.includes(sourceType as SourceRecord['sourceType']),
    )
  ) {
    throw new Error('Semantic staleSourceTypes must contain known source types.');
  }
  return {
    maxSourceAgeMs,
    staleSourceTypes: staleSourceTypes as Array<SourceRecord['sourceType']>,
    maxFindings,
    requireSpeakerNotes: policy?.requireSpeakerNotes ?? true,
    requireDisclosures: policy?.requireDisclosures ?? true,
    requireOpeningAndClose: policy?.requireOpeningAndClose ?? true,
  };
}

function resolvedRequiredPrimitives(
  values: readonly NodeSlideSemanticPrimitiveKind[] | undefined,
): NodeSlideSemanticPrimitiveKind[] {
  const resolved = uniqueSorted(values ?? []);
  if (resolved.some((kind) => !PRIMITIVE_KIND_KEYS.includes(kind))) {
    throw new Error('Semantic requiredPrimitives contains an unknown primitive kind.');
  }
  return resolved;
}

function isDeckSnapshot(value: unknown): value is DeckSnapshot {
  if (!isRecord(value) || !isRecord(value['deck'])) return false;
  const deck = value['deck'];
  return (
    typeof deck['id'] === 'string' &&
    typeof deck['version'] === 'number' &&
    typeof deck['updatedAt'] === 'number' &&
    Array.isArray(value['slides']) &&
    Array.isArray(value['elements']) &&
    Array.isArray(value['sources'])
  );
}

function isSemanticPatch(value: unknown): value is NodeSlideSemanticPatch {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value['baseDeckVersion']) &&
    isRecord(value['scope']) &&
    Array.isArray(value['operations'])
  );
}

function isDeckSpec(value: unknown): value is NodeSlideSemanticDeckSpec {
  if (
    !isRecord(value) ||
    typeof value['title'] !== 'string' ||
    !Array.isArray(value['narrative']) ||
    !value['narrative'].every((item) => typeof item === 'string') ||
    !Array.isArray(value['slides'])
  ) {
    return false;
  }
  return value['slides'].every(
    (slide) =>
      isRecord(slide) &&
      typeof slide['title'] === 'string' &&
      typeof slide['section'] === 'string' &&
      typeof slide['headline'] === 'string' &&
      typeof slide['body'] === 'string' &&
      Array.isArray(slide['bullets']) &&
      slide['bullets'].every((item) => typeof item === 'string'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function elementPath(context: EvaluationContext, elementId: string): string {
  return `/elements/${context.elementSnapshotIndex.get(elementId) ?? -1}`;
}

function slidePath(context: EvaluationContext, slideId: string): string {
  return `/slides/${context.slideSnapshotIndex.get(slideId) ?? -1}`;
}

function sourcePath(context: EvaluationContext, sourceId: string): string {
  return `/sources/${context.sourceSnapshotIndex.get(sourceId) ?? -1}`;
}

function firstIndexById<T extends { id: string }>(values: readonly T[]): Map<string, number> {
  const indexes = new Map<string, number>();
  values.forEach((value, index) => {
    if (!indexes.has(value.id)) indexes.set(value.id, index);
  });
  return indexes;
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

function orderedIds(values: readonly string[], ranks: ReadonlyMap<string, number>): string[] {
  return uniqueSorted(values).sort(
    (left, right) =>
      (ranks.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (ranks.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right),
  );
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueEvidence(
  evidence: readonly NodeSlideSemanticEvidence[],
): NodeSlideSemanticEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    if (seen.has(item.digest)) return false;
    seen.add(item.digest);
    return true;
  });
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function canonicalDetails(
  details: Record<string, NodeSlideSemanticValue>,
): Record<string, NodeSlideSemanticValue> {
  return Object.fromEntries(
    Object.entries(details)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, cleanSemanticValue(value)]),
  );
}

function cleanSemanticValue(value: NodeSlideSemanticValue): NodeSlideSemanticValue {
  if (typeof value === 'string') return cleanEvidenceText(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 64)
      .map((item) =>
        typeof item === 'string'
          ? cleanEvidenceText(item)
          : Number.isFinite(item)
            ? item
            : String(item),
      ) as string[] | number[];
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

function cleanEvidenceText(value: string): string {
  const clean = value
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length <= MAX_EVIDENCE_TEXT
    ? clean
    : `${clean.slice(0, MAX_EVIDENCE_TEXT - 1).trimEnd()}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
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
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  return value;
}
