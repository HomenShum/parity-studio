import { describe, expect, it } from 'vitest';
import {
  COMPETITIVE_BENCHMARK_SCHEMA,
  evaluateCompetitiveBenchmark,
} from '../nodeslide-competitive-benchmark.mjs';

const digest = `sha256:${'a'.repeat(64)}`;

function run(system, overrides = {}) {
  return {
    system,
    evidenceRefs: [`artifacts/${system}.json`, `artifacts/${system}.png`],
    metrics: {
      timeToFirstUsefulDeckSeconds: 90,
      supportedClaims: 9,
      totalClaims: 10,
      exactChartValues: 9,
      totalChartValues: 10,
      unsupportedClaims: 1,
      manualCorrections: 2,
      unrelatedChangesFromScopedEdit: 1,
      explainsChanges: true,
      rejectPreservesDeck: true,
      correctlyAffectedSlides: 4,
      totalAffectedSlides: 5,
      editablePptxObjects: 9,
      totalPptxObjects: 10,
      pptxFidelityPercent: 90,
      timeToUpdatedVersionSeconds: 60,
      audiencePreferenceWins: 3,
      audiencePreferencePairs: 5,
      ...overrides,
    },
  };
}

function input() {
  return {
    schemaVersion: COMPETITIVE_BENCHMARK_SCHEMA,
    evidencePackDigest: digest,
    runs: [
      run('gamma', { timeToFirstUsefulDeckSeconds: 30, timeToUpdatedVersionSeconds: 100 }),
      run('canva', { audiencePreferenceWins: 5, timeToUpdatedVersionSeconds: 120 }),
      run('nodeslide', {
        supportedClaims: 10,
        exactChartValues: 10,
        unrelatedChangesFromScopedEdit: 0,
        timeToUpdatedVersionSeconds: 40,
      }),
    ],
  };
}

describe('NodeSlide competitive benchmark', () => {
  it('scores one artifact-backed run per competitor and tests the differentiation hypothesis', () => {
    const report = evaluateCompetitiveBenchmark(input());
    expect(report.status).toBe('scored');
    expect(report.positioning).toEqual(
      expect.objectContaining({
        firstDraftSpeedLeader: 'gamma',
        designFlexibilityLeader: 'canva',
        traceabilityLeader: 'nodeslide',
        dataFidelityLeader: 'nodeslide',
        refreshLeader: 'nodeslide',
        nodeSlideHypothesisEarned: true,
      }),
    );
  });

  it('refuses to fabricate a score when any competitor or evidence artifact is missing', () => {
    const invalid = input();
    invalid.runs = invalid.runs.filter((candidate) => candidate.system !== 'canva');
    invalid.runs[0].evidenceRefs = [];
    const report = evaluateCompetitiveBenchmark(invalid);
    expect(report.status).toBe('unscored');
    expect(report.issues).toContain('canva must have exactly one run');
    expect(report.issues).toContain('gamma must include artifact evidence');
  });

  it('is deterministic for identical evidence', () => {
    expect(evaluateCompetitiveBenchmark(input())).toEqual(evaluateCompetitiveBenchmark(input()));
  });
});
