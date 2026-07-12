import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_STORYBENCH_SCHEMA_VERSION = 'nodeslide.storybench/v1' as const;

export type StoryBenchLicenseTier = 'A' | 'B' | 'C';
export type StoryBenchMaterialMode = 'embedded' | 'reference';

export type StoryBenchQualityDimension =
  | 'taskCompletion'
  | 'narrativeCoherence'
  | 'evidenceLineage'
  | 'editability'
  | 'visualIntegrity'
  | 'versionSafety';

export type StoryBenchDimension =
  | StoryBenchQualityDimension
  | 'latencyEfficiency'
  | 'costEfficiency';

export const STORYBENCH_DIMENSIONS: readonly StoryBenchDimension[] = Object.freeze([
  'taskCompletion',
  'narrativeCoherence',
  'evidenceLineage',
  'editability',
  'visualIntegrity',
  'versionSafety',
  'latencyEfficiency',
  'costEfficiency',
]);

export interface StoryBenchSourceProvenance {
  id: string;
  title: string;
  url: string;
  license: string;
  tier: StoryBenchLicenseTier;
  redistribution: 'allowed' | 'restricted' | 'unknown';
  verifiedAt: string;
}

export interface StoryBenchBudgets {
  maxLatencyMs: number;
  maxCostMicroUsd: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxSteps: number;
}

export interface StoryBenchCase {
  id: string;
  title: string;
  source: StoryBenchSourceProvenance;
  materialMode: StoryBenchMaterialMode;
  fixtureDigest: string;
  rubric: Partial<Record<StoryBenchDimension, number>>;
  budgets: StoryBenchBudgets;
  tags?: string[];
}

export interface StoryBenchSafetySignals {
  scopeSafe: boolean;
  versionSafe: boolean;
  noSecretLeak: boolean;
  noUnauthorizedEgress: boolean;
  artifactSafe: boolean;
  cleanupConfirmed: boolean;
}

export interface StoryBenchMetrics {
  latencyMs: number;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  steps: number;
}

export interface StoryBenchAdapterOutcome {
  status: 'completed' | 'failed';
  scores: Partial<Record<StoryBenchQualityDimension, number>>;
  safety: StoryBenchSafetySignals;
  metrics: StoryBenchMetrics;
  evidenceDigests: string[];
  failureCode?: string;
}

export interface StoryBenchAdapter {
  id: string;
  version: string;
  execute(testCase: Readonly<StoryBenchCase>): StoryBenchAdapterOutcome;
}

export interface StoryBenchCaseResult {
  caseId: string;
  adapterId: string;
  adapterVersion: string;
  fixtureDigest: string;
  sourceId: string;
  tier: StoryBenchLicenseTier;
  status: 'completed' | 'failed' | 'blocked';
  eligible: boolean;
  score: number;
  dimensions: Record<StoryBenchDimension, number>;
  safetyPassed: boolean;
  budgetPassed: boolean;
  completenessPassed: boolean;
  failures: string[];
  metrics: StoryBenchMetrics;
  evidenceDigests: string[];
  resultDigest: string;
}

export interface StoryBenchReport {
  schemaVersion: typeof NODESLIDE_STORYBENCH_SCHEMA_VERSION;
  suiteId: string;
  cases: Array<{
    id: string;
    tier: StoryBenchLicenseTier;
    fixtureDigest: string;
    provenancePassed: boolean;
    failures: string[];
  }>;
  adapters: Array<{ id: string; version: string }>;
  results: StoryBenchCaseResult[];
  provenancePassed: boolean;
  reportDigest: string;
}

export interface StoryBenchComparisonGates {
  minimumCases: number;
  minimumMeanImprovement: number;
  maximumDimensionRegression: number;
}

export interface StoryBenchComparison {
  baselineAdapterId: string;
  candidateAdapterId: string;
  decision: 'promote' | 'hold' | 'reject';
  reason: string;
  matchedCases: number;
  baselineMean: number;
  candidateMean: number;
  meanDelta: number;
  dimensionDeltas: Record<StoryBenchDimension, number>;
  confidence: 'insufficient' | 'directional';
  caveat: string;
  blockers: string[];
}

const DEFAULT_RUBRIC: Record<StoryBenchDimension, number> = {
  taskCompletion: 0.2,
  narrativeCoherence: 0.15,
  evidenceLineage: 0.15,
  editability: 0.15,
  visualIntegrity: 0.15,
  versionSafety: 0.1,
  latencyEfficiency: 0.05,
  costEfficiency: 0.05,
};

const ZERO_SAFETY: StoryBenchSafetySignals = {
  scopeSafe: false,
  versionSafe: false,
  noSecretLeak: false,
  noUnauthorizedEgress: false,
  artifactSafe: false,
  cleanupConfirmed: false,
};

const ZERO_METRICS: StoryBenchMetrics = {
  latencyMs: 0,
  costMicroUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  steps: 0,
};

const DEFAULT_COMPARISON_GATES: StoryBenchComparisonGates = {
  minimumCases: 2,
  minimumMeanImprovement: 0.02,
  maximumDimensionRegression: 0.03,
};

export function runNodeSlideStoryBench(args: {
  suiteId: string;
  cases: readonly StoryBenchCase[];
  adapters: readonly StoryBenchAdapter[];
}): StoryBenchReport {
  const suiteId = cleanId(args.suiteId) || 'invalid-suite';
  const cases = [...args.cases].sort((left, right) => left.id.localeCompare(right.id));
  const adapters = [...args.adapters].sort((left, right) =>
    `${left.id}:${left.version}`.localeCompare(`${right.id}:${right.version}`),
  );
  const caseRecords = cases.map((testCase) => {
    const failures = validateCase(testCase);
    return {
      id: cleanId(testCase.id),
      tier: testCase.source.tier,
      fixtureDigest: cleanDigest(testCase.fixtureDigest),
      provenancePassed: failures.length === 0,
      failures,
    };
  });
  const results: StoryBenchCaseResult[] = [];

  for (const testCase of cases) {
    const provenanceFailures = validateCase(testCase);
    for (const adapter of adapters) {
      const adapterId = cleanId(adapter.id);
      const adapterVersion = cleanId(adapter.version);
      if (provenanceFailures.length > 0 || !adapterId || !adapterVersion) {
        results.push(
          blockedResult(
            testCase,
            adapterId || 'invalid-adapter',
            adapterVersion || 'invalid-version',
            provenanceFailures.length > 0 ? provenanceFailures : ['adapter_identity_missing'],
          ),
        );
        continue;
      }

      let outcome: StoryBenchAdapterOutcome;
      try {
        outcome = adapter.execute(structuredClone(testCase));
      } catch (error) {
        outcome = {
          status: 'failed',
          scores: {},
          safety: ZERO_SAFETY,
          metrics: ZERO_METRICS,
          evidenceDigests: [],
          failureCode: sanitizedFailure(error),
        };
      }
      results.push(evaluateOutcome(testCase, adapterId, adapterVersion, outcome));
    }
  }

  const partial = {
    schemaVersion: NODESLIDE_STORYBENCH_SCHEMA_VERSION,
    suiteId,
    cases: caseRecords,
    adapters: adapters.map((adapter) => ({
      id: cleanId(adapter.id),
      version: cleanId(adapter.version),
    })),
    results,
    provenancePassed: caseRecords.length > 0 && caseRecords.every((item) => item.provenancePassed),
  };
  return {
    ...partial,
    reportDigest: `storybench_${nodeslideContentDigest(stableSerialize(partial))}`,
  };
}

export function compareNodeSlideStoryBench(
  report: StoryBenchReport,
  baselineAdapterId: string,
  candidateAdapterId: string,
  requestedGates: Partial<StoryBenchComparisonGates> = {},
): StoryBenchComparison {
  const gates = validComparisonGates(requestedGates);
  const baselineId = cleanId(baselineAdapterId);
  const candidateId = cleanId(candidateAdapterId);
  const blockers: string[] = [];
  if (!report.provenancePassed) blockers.push('suite_provenance_failed');
  if (report.cases.some((item) => item.tier === 'C')) blockers.push('quarantined_material_present');
  if (!baselineId || !candidateId || baselineId === candidateId)
    blockers.push('invalid_adapter_pair');

  const baseline = new Map(
    report.results
      .filter((result) => result.adapterId === baselineId)
      .map((result) => [result.caseId, result]),
  );
  const candidate = new Map(
    report.results
      .filter((result) => result.adapterId === candidateId)
      .map((result) => [result.caseId, result]),
  );
  const caseIds = [...new Set([...baseline.keys(), ...candidate.keys()])].sort();
  const matched = caseIds.flatMap((caseId) => {
    const base = baseline.get(caseId);
    const next = candidate.get(caseId);
    return base && next ? [[base, next] as const] : [];
  });

  if (matched.length < gates.minimumCases) blockers.push('insufficient_matched_cases');
  for (const [base, next] of matched) {
    if (base.status !== 'completed') blockers.push(`baseline_incomplete:${base.caseId}`);
    if (next.status !== 'completed') blockers.push(`candidate_incomplete:${next.caseId}`);
    if (!base.eligible || !next.eligible) blockers.push(`ineligible_case:${next.caseId}`);
    if (!next.safetyPassed) blockers.push(`candidate_safety_failed:${next.caseId}`);
    if (!next.budgetPassed) blockers.push(`candidate_budget_failed:${next.caseId}`);
    if (!next.completenessPassed) blockers.push(`candidate_incomplete_scores:${next.caseId}`);
  }

  const baselineMean = mean(matched.map(([base]) => base.score));
  const candidateMean = mean(matched.map(([, next]) => next.score));
  const meanDelta = roundScore(candidateMean - baselineMean);
  const dimensionDeltas = Object.fromEntries(
    STORYBENCH_DIMENSIONS.map((dimension) => [
      dimension,
      roundScore(
        mean(matched.map(([, next]) => next.dimensions[dimension])) -
          mean(matched.map(([base]) => base.dimensions[dimension])),
      ),
    ]),
  ) as Record<StoryBenchDimension, number>;
  const regressed = STORYBENCH_DIMENSIONS.filter(
    (dimension) => dimensionDeltas[dimension] < -gates.maximumDimensionRegression,
  );
  for (const dimension of regressed) blockers.push(`dimension_regressed:${dimension}`);

  const uniqueBlockers = [...new Set(blockers)].sort();
  let decision: StoryBenchComparison['decision'];
  let reason: string;
  if (uniqueBlockers.length > 0) {
    decision = 'reject';
    reason = `Promotion is blocked by ${uniqueBlockers[0]}.`;
  } else if (meanDelta >= gates.minimumMeanImprovement) {
    decision = 'promote';
    reason = `Candidate improved the matched-case mean by ${meanDelta.toFixed(4)} without a gated regression.`;
  } else if (meanDelta < 0) {
    decision = 'reject';
    reason = `Candidate regressed the matched-case mean by ${Math.abs(meanDelta).toFixed(4)}.`;
  } else {
    decision = 'hold';
    reason = `Observed delta ${meanDelta.toFixed(4)} is below the promotion threshold.`;
  }

  return {
    baselineAdapterId: baselineId,
    candidateAdapterId: candidateId,
    decision,
    reason,
    matchedCases: matched.length,
    baselineMean,
    candidateMean,
    meanDelta,
    dimensionDeltas,
    confidence: matched.length >= 5 ? 'directional' : 'insufficient',
    caveat:
      'This deterministic comparison reports matched-case direction and bounded effect only; it does not claim statistical significance or population-level generalization.',
    blockers: uniqueBlockers,
  };
}

export function serializeNodeSlideStoryBench(report: StoryBenchReport): string {
  return stableSerialize(sanitizeValue(report));
}

function evaluateOutcome(
  testCase: StoryBenchCase,
  adapterId: string,
  adapterVersion: string,
  outcome: StoryBenchAdapterOutcome,
): StoryBenchCaseResult {
  const failures: string[] = [];
  const metrics = sanitizeMetrics(outcome.metrics, failures);
  const safety = sanitizeSafety(outcome.safety);
  const safetyPassed = Object.values(safety).every(Boolean);
  if (!safetyPassed) failures.push('hard_safety_gate_failed');
  const budgetFailures = evaluateBudgets(metrics, testCase.budgets);
  failures.push(...budgetFailures);
  const budgetPassed = budgetFailures.length === 0;
  const evidenceDigests = Array.isArray(outcome.evidenceDigests)
    ? outcome.evidenceDigests.map(cleanDigest).filter(Boolean).slice(0, 64)
    : [];
  if (evidenceDigests.length === 0) failures.push('result_evidence_missing');
  if (outcome.status !== 'completed') {
    failures.push(cleanId(outcome.failureCode) || 'adapter_failed');
  }

  const dimensions = {} as Record<StoryBenchDimension, number>;
  let completenessPassed = true;
  for (const dimension of STORYBENCH_DIMENSIONS) {
    if (dimension === 'latencyEfficiency') {
      dimensions[dimension] = efficiency(metrics.latencyMs, testCase.budgets.maxLatencyMs);
      continue;
    }
    if (dimension === 'costEfficiency') {
      dimensions[dimension] = efficiency(metrics.costMicroUsd, testCase.budgets.maxCostMicroUsd);
      continue;
    }
    const value = outcome.scores?.[dimension];
    if (!Number.isFinite(value) || (value as number) < 0 || (value as number) > 1) {
      dimensions[dimension] = 0;
      completenessPassed = false;
      failures.push(`score_missing_or_invalid:${dimension}`);
    } else {
      dimensions[dimension] = roundScore(value as number);
    }
  }
  const rubric = normalizedRubric(testCase.rubric);
  const score = roundScore(
    STORYBENCH_DIMENSIONS.reduce(
      (sum, dimension) => sum + dimensions[dimension] * rubric[dimension],
      0,
    ),
  );
  const status: StoryBenchCaseResult['status'] =
    outcome.status === 'completed' ? 'completed' : 'failed';
  const eligible =
    status === 'completed' &&
    safetyPassed &&
    budgetPassed &&
    completenessPassed &&
    evidenceDigests.length > 0;
  const partial = {
    caseId: cleanId(testCase.id),
    adapterId,
    adapterVersion,
    fixtureDigest: cleanDigest(testCase.fixtureDigest),
    sourceId: cleanId(testCase.source.id),
    tier: testCase.source.tier,
    status,
    eligible,
    score,
    dimensions,
    safetyPassed,
    budgetPassed,
    completenessPassed,
    failures: [...new Set(failures)].sort(),
    metrics,
    evidenceDigests,
  };
  return {
    ...partial,
    resultDigest: `result_${nodeslideContentDigest(stableSerialize(partial))}`,
  };
}

function blockedResult(
  testCase: StoryBenchCase,
  adapterId: string,
  adapterVersion: string,
  failures: string[],
): StoryBenchCaseResult {
  const dimensions = Object.fromEntries(
    STORYBENCH_DIMENSIONS.map((dimension) => [dimension, 0]),
  ) as Record<StoryBenchDimension, number>;
  const partial = {
    caseId: cleanId(testCase.id),
    adapterId,
    adapterVersion,
    fixtureDigest: cleanDigest(testCase.fixtureDigest),
    sourceId: cleanId(testCase.source.id),
    tier: testCase.source.tier,
    status: 'blocked' as const,
    eligible: false,
    score: 0,
    dimensions,
    safetyPassed: false,
    budgetPassed: false,
    completenessPassed: false,
    failures: [...new Set(failures)].sort(),
    metrics: ZERO_METRICS,
    evidenceDigests: [],
  };
  return {
    ...partial,
    resultDigest: `result_${nodeslideContentDigest(stableSerialize(partial))}`,
  };
}

function validateCase(testCase: StoryBenchCase): string[] {
  const failures: string[] = [];
  if (!cleanId(testCase.id)) failures.push('case_id_missing');
  if (!cleanId(testCase.title)) failures.push('case_title_missing');
  if (!cleanDigest(testCase.fixtureDigest)) failures.push('fixture_digest_missing');
  if (!cleanId(testCase.source?.id)) failures.push('source_id_missing');
  if (!validUrl(testCase.source?.url)) failures.push('source_url_missing_or_invalid');
  if (!cleanId(testCase.source?.license)) failures.push('explicit_license_missing');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testCase.source?.verifiedAt ?? '')) {
    failures.push('provenance_verification_date_invalid');
  }
  if (testCase.source?.tier === 'C') failures.push('source_quarantined');
  if (testCase.source?.tier === 'B' && testCase.materialMode !== 'reference') {
    failures.push('tier_b_must_be_reference_only');
  }
  if (testCase.source?.redistribution === 'restricted' && testCase.materialMode === 'embedded') {
    failures.push('restricted_material_embedded');
  }
  validateBudgets(testCase.budgets, failures);
  try {
    normalizedRubric(testCase.rubric);
  } catch {
    failures.push('rubric_invalid');
  }
  return [...new Set(failures)].sort();
}

function validateBudgets(budgets: StoryBenchBudgets, failures: string[]): void {
  for (const [key, value] of Object.entries(budgets ?? {})) {
    if (!Number.isSafeInteger(value) || value <= 0) failures.push(`budget_invalid:${key}`);
  }
  if (!budgets || Object.keys(budgets).length !== 5) failures.push('budget_shape_invalid');
}

function evaluateBudgets(metrics: StoryBenchMetrics, budgets: StoryBenchBudgets): string[] {
  const failures: string[] = [];
  if (metrics.latencyMs > budgets.maxLatencyMs) failures.push('budget_exceeded:latency');
  if (metrics.costMicroUsd > budgets.maxCostMicroUsd) failures.push('budget_exceeded:cost');
  if (metrics.inputTokens > budgets.maxInputTokens) failures.push('budget_exceeded:input_tokens');
  if (metrics.outputTokens > budgets.maxOutputTokens)
    failures.push('budget_exceeded:output_tokens');
  if (metrics.steps > budgets.maxSteps) failures.push('budget_exceeded:steps');
  return failures;
}

function sanitizeMetrics(metrics: StoryBenchMetrics, failures: string[]): StoryBenchMetrics {
  return Object.fromEntries(
    Object.entries(ZERO_METRICS).map(([key]) => {
      const value = metrics?.[key as keyof StoryBenchMetrics];
      if (!Number.isSafeInteger(value) || (value as number) < 0) {
        failures.push(`metric_invalid:${key}`);
        return [key, 0];
      }
      return [key, value];
    }),
  ) as unknown as StoryBenchMetrics;
}

function sanitizeSafety(value: StoryBenchSafetySignals): StoryBenchSafetySignals {
  return Object.fromEntries(
    Object.keys(ZERO_SAFETY).map((key) => [
      key,
      value?.[key as keyof StoryBenchSafetySignals] === true,
    ]),
  ) as unknown as StoryBenchSafetySignals;
}

function normalizedRubric(
  requested: Partial<Record<StoryBenchDimension, number>>,
): Record<StoryBenchDimension, number> {
  const combined = { ...DEFAULT_RUBRIC, ...requested };
  for (const dimension of STORYBENCH_DIMENSIONS) {
    const weight = combined[dimension];
    if (!Number.isFinite(weight) || weight < 0 || weight > 1)
      throw new Error('Invalid rubric weight.');
  }
  const total = STORYBENCH_DIMENSIONS.reduce((sum, dimension) => sum + combined[dimension], 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Rubric must have positive weight.');
  return Object.fromEntries(
    STORYBENCH_DIMENSIONS.map((dimension) => [dimension, combined[dimension] / total]),
  ) as Record<StoryBenchDimension, number>;
}

function validComparisonGates(
  requested: Partial<StoryBenchComparisonGates>,
): StoryBenchComparisonGates {
  const gates = { ...DEFAULT_COMPARISON_GATES, ...requested };
  return {
    minimumCases:
      Number.isSafeInteger(gates.minimumCases) && gates.minimumCases > 0
        ? gates.minimumCases
        : DEFAULT_COMPARISON_GATES.minimumCases,
    minimumMeanImprovement:
      Number.isFinite(gates.minimumMeanImprovement) && gates.minimumMeanImprovement >= 0
        ? Math.min(1, gates.minimumMeanImprovement)
        : DEFAULT_COMPARISON_GATES.minimumMeanImprovement,
    maximumDimensionRegression:
      Number.isFinite(gates.maximumDimensionRegression) && gates.maximumDimensionRegression >= 0
        ? Math.min(1, gates.maximumDimensionRegression)
        : DEFAULT_COMPARISON_GATES.maximumDimensionRegression,
  };
}

function efficiency(actual: number, maximum: number): number {
  if (!Number.isFinite(actual) || !Number.isFinite(maximum) || maximum <= 0 || actual < 0) return 0;
  if (actual === 0) return 1;
  return roundScore(Math.max(0, Math.min(1, 1 - actual / maximum)));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return roundScore(values.reduce((sum, value) => sum + finiteScore(value), 0) / values.length);
}

function finiteScore(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function cleanId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^A-Za-z0-9._:/+ -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function cleanDigest(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 180);
}

function validUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizedFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : 'adapter_failed';
  return (
    cleanId(
      message
        .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
        .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]'),
    ) || 'adapter_failed'
  );
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') {
    return stripControlCharacters(value)
      .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
      .slice(0, 1_000);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value))
    return value.slice(0, 10_000).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]),
    );
  }
  return undefined;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
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
