import type { DeckBrief } from '../../shared/nodeslide';
import type { NodeSlideProviderResult } from './nodeslideProvider';
import { buildBriefNodeSlide } from './nodeslideSeed';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

const MAX_REPORT_VALIDATION_ISSUES = 12;
const MAX_REPORT_PROMPT_BYTES = 4_000;

export type NodeSlideSyntheticCreationFault = 'drop_requested_chart';

export interface NodeSlideSyntheticFaultResult {
  spec: unknown;
  fault: NodeSlideSyntheticCreationFault;
  applied: boolean;
  traceLabel: string;
}

export interface NodeSlideSyntheticRepairReport {
  issueCount: number;
  missingRequestedChart: boolean;
  validationIssues: Array<{
    severity: 'error' | 'warning';
    code: string;
    message: string;
    slideId?: string;
  }>;
}

export type NodeSlideSyntheticRepairDecision =
  | 'not_needed'
  | 'revised'
  | 'revision_failed'
  | 'revision_not_better';

export interface NodeSlideSyntheticRepairOutcome {
  spec: unknown;
  passes: 1 | 2;
  decision: NodeSlideSyntheticRepairDecision;
  summary: string;
  firstReport: NodeSlideSyntheticRepairReport;
  chosenReport: NodeSlideSyntheticRepairReport;
  revision: NodeSlideProviderResult | null;
}

/**
 * The demo is opt-in twice: an explicit development runtime marker and one
 * allowlisted fault. Missing, misspelled, and production markers fail closed.
 */
export function resolveNodeSlideSyntheticCreationFault(input: {
  runtimeEnvironment?: string;
  faultFlag?: string;
}): NodeSlideSyntheticCreationFault | null {
  if (input.runtimeEnvironment?.trim().toLowerCase() !== 'development') return null;
  return input.faultFlag?.trim().toLowerCase() === 'drop_requested_chart'
    ? 'drop_requested_chart'
    : null;
}

/**
 * Deliberately damage a live provider spec before the repair pass. The clone
 * removes provider-supplied charts only when the brief actually requested one.
 */
export function injectNodeSlideSyntheticCreationFault(input: {
  rawSpec: unknown;
  brief: DeckBrief;
  fault: NodeSlideSyntheticCreationFault;
}): NodeSlideSyntheticFaultResult {
  const tracePrefix = 'Development-only synthetic fault (drop_requested_chart)';
  if (!chartRequested(input.brief) || !isRecord(input.rawSpec)) {
    return notApplicable(input.rawSpec, input.fault, tracePrefix);
  }
  const slides = input.rawSpec['slides'];
  if (!Array.isArray(slides)) {
    return notApplicable(input.rawSpec, input.fault, tracePrefix);
  }

  let removedCharts = 0;
  const faultedSlides = slides.map((slide) => {
    if (!isRecord(slide) || !Object.hasOwn(slide, 'chart')) return slide;
    removedCharts += 1;
    const { chart: _removedChart, ...slideWithoutChart } = slide;
    // The deterministic materializer can fill a primitive-empty evidence slot.
    // Keep pass 1 genuinely chartless with an explicitly synthetic placeholder.
    if (!slideWithoutChart['formula'] && !slideWithoutChart['image']) {
      slideWithoutChart['image'] = {
        altText: 'Development-only synthetic fault placeholder',
        credit: 'NodeSlide fault injection',
      };
    }
    return slideWithoutChart;
  });

  if (removedCharts === 0) {
    return {
      spec: input.rawSpec,
      fault: input.fault,
      applied: false,
      traceLabel: `${tracePrefix}: requested but the provider emitted no chart to remove.`,
    };
  }
  return {
    spec: { ...input.rawSpec, slides: faultedSlides },
    fault: input.fault,
    applied: true,
    traceLabel: `${tracePrefix}: removed ${removedCharts} provider-supplied requested chart${
      removedCharts === 1 ? '' : 's'
    } before pass 1.`,
  };
}

/**
 * Run the actual materializer and validator around the injected pass, request
 * one real provider revision, and adopt it only when it restores the requested
 * chart while strictly reducing concrete issues.
 */
export async function runNodeSlideSyntheticCreationRepairDemo(input: {
  firstSpec: unknown;
  title: string;
  brief: DeckBrief;
  themeId: string;
  now: number;
  requestRevision: (promptReport: string) => Promise<NodeSlideProviderResult>;
}): Promise<NodeSlideSyntheticRepairOutcome> {
  const reportInput = {
    title: input.title,
    brief: input.brief,
    themeId: input.themeId,
    now: input.now,
  };
  const firstReport = collectSyntheticRepairReport({
    ...reportInput,
    rawSpec: input.firstSpec,
  });
  if (!firstReport.missingRequestedChart) {
    return {
      spec: input.firstSpec,
      passes: 1,
      decision: 'not_needed',
      summary: '1 pass; the requested chart was already present, so no synthetic repair ran',
      firstReport,
      chosenReport: firstReport,
      revision: null,
    };
  }

  let revision: NodeSlideProviderResult;
  try {
    revision = await input.requestRevision(syntheticRepairPromptReport(firstReport));
  } catch (error) {
    revision = {
      ok: false,
      reason: error instanceof Error ? error.message : 'revision call threw',
    };
  }
  if (revision.ok !== true) {
    return {
      spec: input.firstSpec,
      passes: 2,
      decision: 'revision_failed',
      summary: `2 passes: synthetic repair call failed (${revision.reason.slice(0, 120)}); kept pass 1`,
      firstReport,
      chosenReport: firstReport,
      revision,
    };
  }

  const secondReport = collectSyntheticRepairReport({
    ...reportInput,
    rawSpec: revision.value,
  });
  if (!secondReport.missingRequestedChart && secondReport.issueCount < firstReport.issueCount) {
    return {
      spec: revision.value,
      passes: 2,
      decision: 'revised',
      summary: `2 passes: real revision restored the requested chart (${firstReport.issueCount} -> ${secondReport.issueCount} issues)`,
      firstReport,
      chosenReport: secondReport,
      revision,
    };
  }
  return {
    spec: input.firstSpec,
    passes: 2,
    decision: 'revision_not_better',
    summary: `2 passes: revision did not restore a strictly better requested-chart result (${firstReport.issueCount} -> ${secondReport.issueCount} issues); kept pass 1`,
    firstReport,
    chosenReport: firstReport,
    revision,
  };
}

function collectSyntheticRepairReport(input: {
  rawSpec: unknown;
  title: string;
  brief: DeckBrief;
  themeId: string;
  now: number;
}): NodeSlideSyntheticRepairReport {
  const built = buildBriefNodeSlide({
    deckId: 'deck_synthetic_repair_preview',
    projectId: 'project_synthetic_repair_preview',
    title: input.title,
    brief: input.brief,
    themeId: input.themeId,
    rawSpec: input.rawSpec,
    now: input.now,
  });
  const validationIssues = validateNodeSlideSnapshot(built.snapshot, input.now)
    .issues.filter(
      (issue): issue is typeof issue & { severity: 'error' | 'warning' } =>
        issue.severity === 'error' || issue.severity === 'warning',
    )
    .slice(0, MAX_REPORT_VALIDATION_ISSUES)
    .map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      message: issue.message.slice(0, 220),
      ...(issue.slideId ? { slideId: issue.slideId } : {}),
    }));
  const missingRequestedChart =
    chartRequested(input.brief) && !built.spec.slides.some((slide) => slide.chart !== undefined);
  return {
    issueCount: validationIssues.length + (missingRequestedChart ? 1 : 0),
    missingRequestedChart,
    validationIssues,
  };
}

function syntheticRepairPromptReport(report: NodeSlideSyntheticRepairReport): string {
  return JSON.stringify({
    missingPrimitives: report.missingRequestedChart ? ['chart'] : [],
    validationIssues: report.validationIssues,
  }).slice(0, MAX_REPORT_PROMPT_BYTES);
}

function chartRequested(brief: DeckBrief): boolean {
  return /\bcharts?\b|\bgraphs?\b/iu.test(
    `${brief.prompt} ${brief.purpose} ${brief.successCriteria.join(' ')}`,
  );
}

function notApplicable(
  spec: unknown,
  fault: NodeSlideSyntheticCreationFault,
  tracePrefix: string,
): NodeSlideSyntheticFaultResult {
  return {
    spec,
    fault,
    applied: false,
    traceLabel: `${tracePrefix}: requested but not applicable; pass 1 was not modified.`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
