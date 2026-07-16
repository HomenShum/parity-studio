import type { DeckSnapshot, Slide, SlideElement } from './nodeslide';
import type { NodeSlideAuthoringPolicyBundle } from './nodeslideAuthoringPolicy';
import { createDefaultNodeSlideAuthoringPolicy } from './nodeslideAuthoringPolicy';
import { nodeSlideDurableDigest } from './nodeslideDurableSession';
import type { NodeSlideJourneyProofInput } from './nodeslideJourneyProof';
import { verifyNodeSlideJourneyProof } from './nodeslideJourneyProof';

export const NODESLIDE_PRESENTATION_QUALITY_VERSION = 'nodeslide.presentation-quality/v1' as const;

export type NodeSlidePresentationQualityDimension =
  | 'communication_job'
  | 'narrative'
  | 'evidence'
  | 'visual'
  | 'editability'
  | 'artifact_proof';

export interface NodeSlidePresentationQualityIssue {
  code: string;
  dimension: NodeSlidePresentationQualityDimension;
  severity: 'critical' | 'error' | 'warning' | 'info';
  blocker: boolean;
  message: string;
  slideIds: string[];
  elementIds: string[];
}

export interface NodeSlidePresentationQualityReceipt {
  schemaVersion: typeof NODESLIDE_PRESENTATION_QUALITY_VERSION;
  policyId: string;
  deckId: string;
  deckVersion: number;
  status: 'pass' | 'warn' | 'fail';
  communicationJob: {
    audience: string;
    purpose: string;
    centralTakeaway: string;
  };
  scores: Record<NodeSlidePresentationQualityDimension, number> & { overall: number };
  metrics: {
    slideCount: number;
    uniqueTitleRatio: number;
    sourcedClaimRatio: number;
    editableElementRatio: number;
    consecutiveLayoutRepeats: number;
    slidesWithNonTextVisuals: number;
    overloadedSlides: number;
    decorativeCharts: number;
  };
  issues: NodeSlidePresentationQualityIssue[];
  blockerCount: number;
  digest: string;
}

export interface NodeSlidePresentationQualityOptions {
  policy?: NodeSlideAuthoringPolicyBundle;
  journeyProof?: NodeSlideJourneyProofInput;
  requireJourneyProof?: boolean;
  referenceReceipt?: NodeSlidePresentationQualityReceipt;
  maxReferenceGap?: number;
}

export function evaluateNodeSlidePresentationQuality(
  snapshot: DeckSnapshot,
  options: NodeSlidePresentationQualityOptions = {},
): NodeSlidePresentationQualityReceipt {
  const policy = options.policy ?? createDefaultNodeSlideAuthoringPolicy();
  const issues: NodeSlidePresentationQualityIssue[] = [];
  const slideElements = new Map(
    snapshot.slides.map((slide) => [
      slide.id,
      snapshot.elements.filter(
        (element) => element.slideId === slide.id && element.visible !== false,
      ),
    ]),
  );
  const communicationJob = {
    audience: snapshot.deck.brief.audience.trim(),
    purpose: snapshot.deck.brief.purpose.trim(),
    centralTakeaway: centralTakeaway(snapshot),
  };

  const communicationJobScore = scoreCommunicationJob(snapshot, communicationJob, issues);
  const narrativeScore = scoreNarrative(snapshot, slideElements, issues);
  const evidence = scoreEvidence(snapshot, issues);
  const visual = scoreVisual(snapshot, slideElements, policy, issues);
  const editability = scoreEditability(snapshot, issues);
  const artifactProof = scoreArtifactProof(options, policy, issues);
  const scores = {
    communication_job: communicationJobScore,
    narrative: narrativeScore,
    evidence: evidence.score,
    visual: visual.score,
    editability: editability.score,
    artifact_proof: artifactProof,
    overall: 0,
  };
  scores.overall = weightedOverall(scores);

  if (options.referenceReceipt) {
    const gap = options.referenceReceipt.scores.overall - scores.overall;
    if (gap > (options.maxReferenceGap ?? 10)) {
      issues.push(
        issue(
          'reference_quality_gap',
          'visual',
          'error',
          true,
          `The deck trails the approved reference by ${gap} quality points.`,
        ),
      );
    }
  } else if (policy.requireReferenceComparison) {
    issues.push(
      issue(
        'reference_comparison_missing',
        'visual',
        'warning',
        false,
        'No approved reference-quality receipt was supplied for comparison.',
      ),
    );
  }

  const dimensions: NodeSlidePresentationQualityDimension[] = [
    'communication_job',
    'narrative',
    'evidence',
    'visual',
    'editability',
    'artifact_proof',
  ];
  for (const dimension of dimensions) {
    if (scores[dimension] < policy.thresholds.perDimension) {
      issues.push(
        issue(
          'dimension_below_release_floor',
          dimension,
          'error',
          true,
          `${dimension.replace(/_/g, ' ')} scored ${scores[dimension]}, below the ${policy.thresholds.perDimension} release floor.`,
        ),
      );
    }
  }
  if (scores.overall < policy.thresholds.overall) {
    issues.push(
      issue(
        'overall_quality_below_release_floor',
        'narrative',
        'error',
        true,
        `Overall presentation quality scored ${scores.overall}, below the ${policy.thresholds.overall} release floor.`,
      ),
    );
  }

  const dedupedIssues = dedupeIssues(issues);
  const blockerCount = dedupedIssues.filter((candidate) => candidate.blocker).length;
  const status: NodeSlidePresentationQualityReceipt['status'] =
    blockerCount > 0
      ? 'fail'
      : dedupedIssues.some((item) => item.severity === 'warning')
        ? 'warn'
        : 'pass';
  const partial = {
    schemaVersion: NODESLIDE_PRESENTATION_QUALITY_VERSION,
    policyId: policy.id,
    deckId: snapshot.deck.id,
    deckVersion: snapshot.deck.version,
    status,
    communicationJob,
    scores,
    metrics: {
      slideCount: snapshot.slides.length,
      uniqueTitleRatio: ratio(
        new Set(snapshot.slides.map((slide) => normalized(slide.title))).size,
        snapshot.slides.length,
      ),
      sourcedClaimRatio: evidence.sourcedClaimRatio,
      editableElementRatio: editability.editableElementRatio,
      consecutiveLayoutRepeats: visual.consecutiveLayoutRepeats,
      slidesWithNonTextVisuals: visual.slidesWithNonTextVisuals,
      overloadedSlides: visual.overloadedSlides,
      decorativeCharts: visual.decorativeCharts,
    },
    issues: dedupedIssues,
    blockerCount,
  };
  return { ...partial, digest: nodeSlideDurableDigest(partial) };
}

export function verifyNodeSlidePresentationQualityReceipt(
  receipt: NodeSlidePresentationQualityReceipt,
): boolean {
  const { digest, ...partial } = receipt;
  return (
    receipt.schemaVersion === NODESLIDE_PRESENTATION_QUALITY_VERSION &&
    digest === nodeSlideDurableDigest(partial)
  );
}

function scoreCommunicationJob(
  snapshot: DeckSnapshot,
  job: NodeSlidePresentationQualityReceipt['communicationJob'],
  issues: NodeSlidePresentationQualityIssue[],
): number {
  let score = 100;
  if (!job.audience || /^(general|everyone|all)$/iu.test(job.audience)) {
    score -= 35;
    issues.push(
      issue(
        'audience_unspecified',
        'communication_job',
        'error',
        true,
        'The intended audience is not specific.',
      ),
    );
  }
  if (!job.purpose || job.purpose.length < 12) {
    score -= 30;
    issues.push(
      issue(
        'purpose_unspecified',
        'communication_job',
        'error',
        true,
        'The presentation purpose is not decision- or outcome-specific.',
      ),
    );
  }
  if (!job.centralTakeaway || genericTitle(job.centralTakeaway)) {
    score -= 25;
    issues.push(
      issue(
        'central_takeaway_weak',
        'communication_job',
        'warning',
        false,
        'The deck lacks a concrete central takeaway.',
      ),
    );
  }
  if (snapshot.deck.brief.successCriteria.length === 0) {
    score -= 10;
    issues.push(
      issue(
        'success_criteria_missing',
        'communication_job',
        'warning',
        false,
        'No audience outcome or success criteria are defined.',
      ),
    );
  }
  return clamp(score);
}

function scoreNarrative(
  snapshot: DeckSnapshot,
  slideElements: Map<string, SlideElement[]>,
  issues: NodeSlidePresentationQualityIssue[],
): number {
  let score = 100;
  if (snapshot.slides.length < 3) score -= 20;
  const normalizedTitles = snapshot.slides.map((slide) => normalized(slide.title));
  const uniqueRatio = ratio(new Set(normalizedTitles).size, normalizedTitles.length);
  if (uniqueRatio < 0.9) {
    score -= 20;
    issues.push(
      issue(
        'duplicate_slide_jobs',
        'narrative',
        'error',
        true,
        'Multiple slides repeat the same narrative job.',
      ),
    );
  }
  const genericSlides = snapshot.slides.filter((slide) => genericTitle(slide.title));
  if (genericSlides.length > 0) {
    score -= Math.min(30, genericSlides.length * 8);
    issues.push(
      issue(
        'generic_slide_titles',
        'narrative',
        'warning',
        false,
        'Topic labels replace takeaway-style slide titles.',
        genericSlides.map((slide) => slide.id),
      ),
    );
  }
  const close = snapshot.slides.at(-1);
  const closeText = close ? slideText(close, slideElements.get(close.id) ?? []) : '';
  if (!/\b(?:approve|adopt|decide|choose|start|next|recommend|commit|action)\b/iu.test(closeText)) {
    score -= 15;
    issues.push(
      issue(
        'close_without_outcome',
        'narrative',
        'warning',
        false,
        'The final slide does not resolve the story with a decision, action, or implication.',
        close ? [close.id] : [],
      ),
    );
  }
  const consecutiveStarts = snapshot.slides.filter((slide, index) => {
    if (index === 0) return false;
    const prior = snapshot.slides[index - 1];
    return prior && firstWords(slide.title) === firstWords(prior.title);
  });
  if (consecutiveStarts.length > 1) score -= 10;
  return clamp(score);
}

function scoreEvidence(
  snapshot: DeckSnapshot,
  issues: NodeSlidePresentationQualityIssue[],
): { score: number; sourcedClaimRatio: number } {
  const claims = snapshot.elements.filter(
    (element) =>
      element.visible !== false &&
      ((element.kind === 'text' &&
        /\b\d+(?:[.,]\d+)?\s*(?:%|x|×|k|m|b)?\b/iu.test(element.content ?? '')) ||
        element.kind === 'chart'),
  );
  const sourced = claims.filter(
    (element) =>
      element.sourceIds.length > 0 ||
      Boolean(element.chart?.sourceId) ||
      Boolean(element.image?.sourceId),
  );
  const sourcedClaimRatio = ratio(sourced.length, claims.length, 1);
  if (sourcedClaimRatio < 1) {
    const unbound = claims.filter((element) => !sourced.includes(element));
    issues.push(
      issue(
        'material_claims_unbound',
        'evidence',
        'error',
        true,
        `${unbound.length} material claim(s) lack source bindings.`,
        unique(unbound.map((element) => element.slideId)),
        unbound.map((element) => element.id),
      ),
    );
  }
  let score = claims.length === 0 ? 70 : Math.round(sourcedClaimRatio * 100);
  if (snapshot.sources.some((source) => source.status === 'failed')) score -= 20;
  return { score: clamp(score), sourcedClaimRatio };
}

function scoreVisual(
  snapshot: DeckSnapshot,
  slideElements: Map<string, SlideElement[]>,
  policy: NodeSlideAuthoringPolicyBundle,
  issues: NodeSlidePresentationQualityIssue[],
): {
  score: number;
  consecutiveLayoutRepeats: number;
  slidesWithNonTextVisuals: number;
  overloadedSlides: number;
  decorativeCharts: number;
} {
  let score = 100;
  const fingerprints = snapshot.slides.map((slide) =>
    layoutFingerprint(slideElements.get(slide.id) ?? []),
  );
  const consecutiveLayoutRepeats = maxConsecutiveRepeats(fingerprints);
  if (consecutiveLayoutRepeats > policy.thresholds.maxConsecutiveLayoutRepeats) {
    score -= 20;
    issues.push(
      issue(
        'layout_repetition_excessive',
        'visual',
        'error',
        true,
        `The same primary composition repeats ${consecutiveLayoutRepeats} times consecutively.`,
      ),
    );
  }
  const slidesWithNonTextVisuals = snapshot.slides.filter((slide) =>
    (slideElements.get(slide.id) ?? []).some(
      (element) => !['text', 'shape', 'connector'].includes(element.kind),
    ),
  ).length;
  if (snapshot.slides.length >= 5 && slidesWithNonTextVisuals / snapshot.slides.length < 0.3) {
    score -= 15;
    issues.push(
      issue(
        'visual_materials_sparse',
        'visual',
        'warning',
        false,
        'Too few slides use explanatory visual material.',
      ),
    );
  }
  const overloaded = snapshot.slides.filter(
    (slide) => wordCount(slideText(slide, slideElements.get(slide.id) ?? [])) > 110,
  );
  if (overloaded.length > 0) {
    score -= Math.min(25, overloaded.length * 8);
    issues.push(
      issue(
        'slide_text_overloaded',
        'visual',
        'error',
        true,
        'One or more slides exceed the presentation text-density budget.',
        overloaded.map((slide) => slide.id),
      ),
    );
  }
  const tiny = snapshot.elements.filter(
    (element) =>
      element.visible !== false && element.kind === 'text' && (element.style.fontSize ?? 18) < 14,
  );
  if (tiny.length > 0) {
    score -= 15;
    issues.push(
      issue(
        'unreadable_text',
        'visual',
        'error',
        true,
        'Visible text falls below the minimum readable size.',
        unique(tiny.map((element) => element.slideId)),
        tiny.map((element) => element.id),
      ),
    );
  }
  const decorativeCharts = snapshot.elements.filter((element) => decorativeChart(element)).length;
  if (decorativeCharts > 0) {
    score -= decorativeCharts * 15;
    issues.push(
      issue(
        'decorative_chart',
        'visual',
        'error',
        true,
        'A chart lacks the data meaning, unit, or provenance needed to support a claim.',
      ),
    );
  }
  return {
    score: clamp(score),
    consecutiveLayoutRepeats,
    slidesWithNonTextVisuals,
    overloadedSlides: overloaded.length,
    decorativeCharts,
  };
}

function scoreEditability(
  snapshot: DeckSnapshot,
  issues: NodeSlidePresentationQualityIssue[],
): { score: number; editableElementRatio: number } {
  const visible = snapshot.elements.filter((element) => element.visible !== false);
  const editable = visible.filter((element) =>
    element.exportCapabilities.includes('pptx_editable'),
  );
  const editableElementRatio = ratio(editable.length, visible.length, 1);
  if (editableElementRatio < 0.9) {
    const fallback = visible.filter((element) => !editable.includes(element));
    issues.push(
      issue(
        'editability_below_floor',
        'editability',
        'error',
        true,
        'Too many visible elements require static or web-only export fallbacks.',
        unique(fallback.map((element) => element.slideId)),
        fallback.map((element) => element.id),
      ),
    );
  }
  return { score: clamp(Math.round(editableElementRatio * 100)), editableElementRatio };
}

function scoreArtifactProof(
  options: NodeSlidePresentationQualityOptions,
  policy: NodeSlideAuthoringPolicyBundle,
  issues: NodeSlidePresentationQualityIssue[],
): number {
  const required = options.requireJourneyProof ?? policy.requireJourneyProof;
  if (!options.journeyProof) {
    if (required)
      issues.push(
        issue(
          'journey_proof_missing',
          'artifact_proof',
          'error',
          true,
          'Release requires raw recording, GIF, final screenshot, exported deck, and run manifest.',
        ),
      );
    return required ? 0 : 100;
  }
  const result = verifyNodeSlideJourneyProof(options.journeyProof);
  for (const finding of result.findings) {
    issues.push(issue(finding.code, 'artifact_proof', 'critical', true, finding.message));
  }
  return result.ok ? 100 : 0;
}

function centralTakeaway(snapshot: DeckSnapshot): string {
  const first = snapshot.slides[0];
  if (!first) return '';
  const headline = snapshot.elements.find(
    (element) =>
      element.slideId === first.id &&
      element.kind === 'text' &&
      /\b(?:headline|title)\b/iu.test(`${element.role ?? ''} ${element.name}`),
  );
  return (headline?.content ?? first.title).trim();
}

function weightedOverall(
  scores: Omit<NodeSlidePresentationQualityReceipt['scores'], 'overall'> & { overall: number },
): number {
  return Math.round(
    scores.communication_job * 0.15 +
      scores.narrative * 0.25 +
      scores.evidence * 0.2 +
      scores.visual * 0.2 +
      scores.editability * 0.1 +
      scores.artifact_proof * 0.1,
  );
}

function decorativeChart(element: SlideElement): boolean {
  if (element.kind !== 'chart' || !element.chart) return false;
  const values = element.chart.series.flatMap((series) => series.values);
  return (
    !element.chart.sourceId ||
    !element.chart.unit ||
    values.length === 0 ||
    new Set(values).size === 1
  );
}

function layoutFingerprint(elements: readonly SlideElement[]): string {
  return elements
    .filter((element) => element.visible !== false && !element.locked)
    .map(
      (element) =>
        `${element.kind}:${element.role ?? element.name}:${bucket(element.bbox.x)}:${bucket(element.bbox.y)}:${bucket(element.bbox.width)}:${bucket(element.bbox.height)}`,
    )
    .sort()
    .join('|');
}

function maxConsecutiveRepeats(values: readonly string[]): number {
  let best = values.length > 0 ? 1 : 0;
  let current = best;
  for (let index = 1; index < values.length; index += 1) {
    current = values[index] === values[index - 1] ? current + 1 : 1;
    best = Math.max(best, current);
  }
  return best;
}

function slideText(slide: Slide, elements: readonly SlideElement[]): string {
  return [
    slide.title,
    ...elements
      .filter((element) => element.kind === 'text')
      .map((element) => element.content ?? ''),
  ].join(' ');
}

function genericTitle(value: string): boolean {
  const title = normalized(value);
  return (
    /^(agenda|overview|introduction|summary|next steps|conclusion|proof|workflow|trust|quality|context|problem|solution)$/u.test(
      title,
    ) || title.split(' ').length < 3
  );
}

function firstWords(value: string): string {
  return normalized(value).split(' ').slice(0, 2).join(' ');
}

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function bucket(value: number): number {
  return Math.round(value * 10);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function ratio(numerator: number, denominator: number, empty = 0): number {
  return denominator === 0 ? empty : Number((numerator / denominator).toFixed(3));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function issue(
  code: string,
  dimension: NodeSlidePresentationQualityDimension,
  severity: NodeSlidePresentationQualityIssue['severity'],
  blocker: boolean,
  message: string,
  slideIds: string[] = [],
  elementIds: string[] = [],
): NodeSlidePresentationQualityIssue {
  return {
    code,
    dimension,
    severity,
    blocker,
    message,
    slideIds: unique(slideIds),
    elementIds: unique(elementIds),
  };
}

function dedupeIssues(
  issues: readonly NodeSlidePresentationQualityIssue[],
): NodeSlidePresentationQualityIssue[] {
  return [
    ...new Map(
      issues.map((candidate) => [
        `${candidate.code}:${candidate.dimension}:${candidate.slideIds.join(',')}:${candidate.elementIds.join(',')}`,
        candidate,
      ]),
    ).values(),
  ].sort(
    (left, right) =>
      Number(right.blocker) - Number(left.blocker) || left.code.localeCompare(right.code),
  );
}
