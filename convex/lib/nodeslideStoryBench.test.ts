import { describe, expect, it, vi } from 'vitest';
import {
  type StoryBenchAdapter,
  type StoryBenchAdapterOutcome,
  type StoryBenchCase,
  type StoryBenchLicenseTier,
  type StoryBenchMaterialMode,
  type StoryBenchQualityDimension,
  compareNodeSlideStoryBench,
  runNodeSlideStoryBench,
  serializeNodeSlideStoryBench,
} from './nodeslideStoryBench';

const QUALITY_DIMENSIONS: readonly StoryBenchQualityDimension[] = [
  'taskCompletion',
  'narrativeCoherence',
  'evidenceLineage',
  'editability',
  'visualIntegrity',
  'versionSafety',
];

function testCase(
  id: string,
  tier: StoryBenchLicenseTier = 'A',
  materialMode: StoryBenchMaterialMode = tier === 'A' ? 'embedded' : 'reference',
): StoryBenchCase {
  return {
    id,
    title: `Case ${id}`,
    source: {
      id: `source-${id}`,
      title: `Source ${id}`,
      url: `https://example.com/${id}`,
      license: tier === 'A' ? 'CC BY 4.0' : 'evaluation-by-reference',
      tier,
      redistribution: tier === 'A' ? 'allowed' : 'restricted',
      verifiedAt: '2026-07-11',
    },
    materialMode,
    fixtureDigest: `fixture_${id}_abc123`,
    rubric: {},
    budgets: {
      maxLatencyMs: 10_000,
      maxCostMicroUsd: 10_000,
      maxInputTokens: 20_000,
      maxOutputTokens: 10_000,
      maxSteps: 20,
    },
  };
}

function outcome(score: number): StoryBenchAdapterOutcome {
  return {
    status: 'completed',
    scores: Object.fromEntries(QUALITY_DIMENSIONS.map((dimension) => [dimension, score])) as Record<
      StoryBenchQualityDimension,
      number
    >,
    safety: {
      scopeSafe: true,
      versionSafe: true,
      noSecretLeak: true,
      noUnauthorizedEgress: true,
      artifactSafe: true,
      cleanupConfirmed: true,
    },
    metrics: {
      latencyMs: 1_000,
      costMicroUsd: 1_000,
      inputTokens: 1_000,
      outputTokens: 500,
      steps: 5,
    },
    evidenceDigests: ['evidence_abc123'],
  };
}

function adapter(
  id: string,
  score: number,
  transform?: (value: StoryBenchAdapterOutcome) => void,
): StoryBenchAdapter {
  return {
    id,
    version: '1.0.0',
    execute: () => {
      const value = outcome(score);
      transform?.(value);
      return value;
    },
  };
}

describe('NodeSlide StoryBench provenance and scoring', () => {
  it('blocks Tier C and embedded Tier B material before adapter execution', () => {
    const execute = vi.fn(() => outcome(0.8));
    const report = runNodeSlideStoryBench({
      suiteId: 'provenance-suite',
      cases: [testCase('c', 'C'), testCase('b', 'B', 'embedded')],
      adapters: [{ id: 'candidate', version: '1', execute }],
    });

    expect(execute).not.toHaveBeenCalled();
    expect(report.provenancePassed).toBe(false);
    expect(report.results.every((result) => result.status === 'blocked')).toBe(true);
    expect(report.cases.find((item) => item.id === 'c')?.failures).toContain('source_quarantined');
    expect(report.cases.find((item) => item.id === 'b')?.failures).toContain(
      'tier_b_must_be_reference_only',
    );
  });

  it('allows a properly attributed Tier B reference case', () => {
    const report = runNodeSlideStoryBench({
      suiteId: 'reference-suite',
      cases: [testCase('b-reference', 'B', 'reference')],
      adapters: [adapter('candidate', 0.8)],
    });

    expect(report.provenancePassed).toBe(true);
    expect(report.reportDigest).toMatch(/^storybench_sha256:[0-9a-f]{64}$/);
    expect(report.results[0]?.status).toBe('completed');
    expect(report.results[0]?.eligible).toBe(true);
    expect(report.results[0]?.resultDigest).toMatch(/^result_sha256:[0-9a-f]{64}$/);
  });

  it('is deterministic and orders cases and adapters canonically', () => {
    const first = runNodeSlideStoryBench({
      suiteId: 'deterministic-suite',
      cases: [testCase('z'), testCase('a')],
      adapters: [adapter('zeta', 0.7), adapter('alpha', 0.7)],
    });
    const second = runNodeSlideStoryBench({
      suiteId: 'deterministic-suite',
      cases: [testCase('a'), testCase('z')],
      adapters: [adapter('alpha', 0.7), adapter('zeta', 0.7)],
    });

    expect(first).toEqual(second);
    expect(first.results.map((result) => `${result.caseId}:${result.adapterId}`)).toEqual([
      'a:alpha',
      'a:zeta',
      'z:alpha',
      'z:zeta',
    ]);
  });

  it('turns missing or non-finite dimensions and metrics into bounded failures', () => {
    const broken: StoryBenchAdapter = {
      id: 'broken',
      version: '1',
      execute: () => ({
        ...outcome(0.7),
        scores: { taskCompletion: Number.NaN, narrativeCoherence: Number.POSITIVE_INFINITY },
        metrics: {
          latencyMs: Number.POSITIVE_INFINITY,
          costMicroUsd: -1,
          inputTokens: Number.NaN,
          outputTokens: 1,
          steps: 1,
        },
      }),
    };
    const report = runNodeSlideStoryBench({
      suiteId: 'finite-suite',
      cases: [testCase('finite')],
      adapters: [broken],
    });
    const result = report.results[0];

    expect(result?.completenessPassed).toBe(false);
    expect(result?.eligible).toBe(false);
    expect(result?.score).toBeTypeOf('number');
    expect(Number.isFinite(result?.score)).toBe(true);
    expect(serializeNodeSlideStoryBench(report)).not.toMatch(/NaN|Infinity/);
    expect(result?.failures).toContain('score_missing_or_invalid:visualIntegrity');
    expect(result?.failures).toContain('metric_invalid:latencyMs');
  });

  it('fails hard safety and every resource budget deterministically', () => {
    const report = runNodeSlideStoryBench({
      suiteId: 'budget-suite',
      cases: [testCase('budget')],
      adapters: [
        adapter('over-budget', 0.9, (value) => {
          value.safety.noUnauthorizedEgress = false;
          value.metrics = {
            latencyMs: 10_001,
            costMicroUsd: 10_001,
            inputTokens: 20_001,
            outputTokens: 10_001,
            steps: 21,
          };
        }),
      ],
    });
    const result = report.results[0];

    expect(result?.safetyPassed).toBe(false);
    expect(result?.budgetPassed).toBe(false);
    expect(result?.eligible).toBe(false);
    expect(result?.failures).toEqual(
      expect.arrayContaining([
        'hard_safety_gate_failed',
        'budget_exceeded:latency',
        'budget_exceeded:cost',
        'budget_exceeded:input_tokens',
        'budget_exceeded:output_tokens',
        'budget_exceeded:steps',
      ]),
    );
  });

  it('requires result evidence provenance', () => {
    const report = runNodeSlideStoryBench({
      suiteId: 'evidence-suite',
      cases: [testCase('evidence')],
      adapters: [
        adapter('candidate', 0.8, (value) => {
          value.evidenceDigests = [];
        }),
      ],
    });

    expect(report.results[0]?.eligible).toBe(false);
    expect(report.results[0]?.failures).toContain('result_evidence_missing');
  });
});

describe('NodeSlide StoryBench comparison gates', () => {
  it('promotes a safe, complete, budgeted matched-case improvement', () => {
    const report = runNodeSlideStoryBench({
      suiteId: 'promotion-suite',
      cases: [testCase('one'), testCase('two')],
      adapters: [adapter('baseline', 0.55), adapter('candidate', 0.8)],
    });
    const comparison = compareNodeSlideStoryBench(report, 'baseline', 'candidate');

    expect(comparison.decision).toBe('promote');
    expect(comparison.meanDelta).toBeGreaterThan(0.02);
    expect(comparison.blockers).toEqual([]);
    expect(comparison.confidence).toBe('insufficient');
    expect(comparison.caveat).toContain('does not claim statistical significance');
  });

  it('rejects a quality regression', () => {
    const report = runNodeSlideStoryBench({
      suiteId: 'regression-suite',
      cases: [testCase('one'), testCase('two')],
      adapters: [adapter('baseline', 0.8), adapter('candidate', 0.5)],
    });
    const comparison = compareNodeSlideStoryBench(report, 'baseline', 'candidate');

    expect(comparison.decision).toBe('reject');
    expect(comparison.meanDelta).toBeLessThan(0);
  });

  it('holds a tie below the declared improvement threshold', () => {
    const report = runNodeSlideStoryBench({
      suiteId: 'tie-suite',
      cases: [testCase('one'), testCase('two')],
      adapters: [adapter('baseline', 0.7), adapter('candidate', 0.7)],
    });
    const comparison = compareNodeSlideStoryBench(report, 'baseline', 'candidate');

    expect(comparison.decision).toBe('hold');
    expect(comparison.meanDelta).toBe(0);
  });

  it('cannot promote when provenance, completion, safety, or budgets fail', () => {
    const missing = testCase('missing');
    missing.source.license = '';
    const provenanceReport = runNodeSlideStoryBench({
      suiteId: 'blocked-provenance',
      cases: [missing, testCase('quarantine', 'C')],
      adapters: [adapter('baseline', 0.5), adapter('candidate', 0.9)],
    });
    const provenance = compareNodeSlideStoryBench(provenanceReport, 'baseline', 'candidate');
    expect(provenance.decision).toBe('reject');
    expect(provenance.blockers).toEqual(
      expect.arrayContaining(['suite_provenance_failed', 'quarantined_material_present']),
    );

    const safetyReport = runNodeSlideStoryBench({
      suiteId: 'blocked-safety',
      cases: [testCase('one'), testCase('two')],
      adapters: [
        adapter('baseline', 0.5),
        adapter('candidate', 0.9, (value) => {
          value.safety.scopeSafe = false;
        }),
      ],
    });
    const safety = compareNodeSlideStoryBench(safetyReport, 'baseline', 'candidate');
    expect(safety.decision).toBe('reject');
    expect(safety.blockers.some((blocker) => blocker.startsWith('candidate_safety_failed'))).toBe(
      true,
    );
  });

  it('redacts secret-like adapter failures in serialized reports', () => {
    const report = runNodeSlideStoryBench({
      suiteId: 'redaction-suite',
      cases: [testCase('redaction')],
      adapters: [
        {
          id: 'throws',
          version: '1',
          execute: () => {
            throw new Error('Bearer secret-token-value sk-supersecret123456789');
          },
        },
      ],
    });
    const serialized = serializeNodeSlideStoryBench(report);

    expect(serialized).not.toContain('secret-token-value');
    expect(serialized).not.toContain('supersecret123456789');
    expect(serialized).toContain('REDACTED');
  });
});
