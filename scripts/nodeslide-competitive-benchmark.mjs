import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const COMPETITIVE_BENCHMARK_SCHEMA = 'nodeslide-competitive-benchmark/v1';
export const COMPETITIVE_SYSTEMS = Object.freeze(['gamma', 'canva', 'nodeslide']);

const REQUIRED_METRICS = Object.freeze([
  'timeToFirstUsefulDeckSeconds',
  'supportedClaims',
  'totalClaims',
  'exactChartValues',
  'totalChartValues',
  'unsupportedClaims',
  'manualCorrections',
  'unrelatedChangesFromScopedEdit',
  'explainsChanges',
  'rejectPreservesDeck',
  'correctlyAffectedSlides',
  'totalAffectedSlides',
  'editablePptxObjects',
  'totalPptxObjects',
  'pptxFidelityPercent',
  'timeToUpdatedVersionSeconds',
  'audiencePreferenceWins',
  'audiencePreferencePairs',
]);

export function evaluateCompetitiveBenchmark(input) {
  const issues = validateInput(input);
  if (issues.length > 0) {
    return Object.freeze({
      schemaVersion: COMPETITIVE_BENCHMARK_SCHEMA,
      status: 'unscored',
      issues: Object.freeze(issues),
      systems: Object.freeze([]),
      positioning: null,
      digest: benchmarkDigest({ issues }),
    });
  }

  const systems = COMPETITIVE_SYSTEMS.map((system) => {
    const run = input.runs.find((candidate) => candidate.system === system);
    return Object.freeze({
      system,
      ...derivedMetrics(run.metrics),
      evidenceRefs: run.evidenceRefs,
    });
  });
  const bySystem = Object.fromEntries(systems.map((row) => [row.system, row]));
  const nodeslide = bySystem.nodeslide;
  const positioning = Object.freeze({
    firstDraftSpeedLeader: minimumLeader(systems, 'timeToFirstUsefulDeckSeconds'),
    designFlexibilityLeader: maximumLeader(systems, 'audiencePreferenceRate'),
    traceabilityLeader: maximumLeader(systems, 'claimSupportRate'),
    controlledRevisionLeader: minimumLeader(systems, 'unrelatedChangesFromScopedEdit'),
    dataFidelityLeader: maximumLeader(systems, 'chartFidelityRate'),
    refreshLeader: minimumLeader(systems, 'timeToUpdatedVersionSeconds'),
    nodeSlideHypothesisEarned:
      nodeslide.claimSupportRate >=
        Math.max(bySystem.gamma.claimSupportRate, bySystem.canva.claimSupportRate) &&
      nodeslide.chartFidelityRate >=
        Math.max(bySystem.gamma.chartFidelityRate, bySystem.canva.chartFidelityRate) &&
      nodeslide.unrelatedChangesFromScopedEdit <=
        Math.min(
          bySystem.gamma.unrelatedChangesFromScopedEdit,
          bySystem.canva.unrelatedChangesFromScopedEdit,
        ) &&
      nodeslide.timeToUpdatedVersionSeconds <=
        Math.min(
          bySystem.gamma.timeToUpdatedVersionSeconds,
          bySystem.canva.timeToUpdatedVersionSeconds,
        ) &&
      nodeslide.explainsChanges &&
      nodeslide.rejectPreservesDeck,
  });
  const report = {
    schemaVersion: COMPETITIVE_BENCHMARK_SCHEMA,
    status: 'scored',
    evidencePackDigest: input.evidencePackDigest,
    systems,
    positioning,
  };
  return Object.freeze({ ...report, digest: benchmarkDigest(report) });
}

function validateInput(input) {
  const issues = [];
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return ['input must be an object'];
  if (input.schemaVersion !== COMPETITIVE_BENCHMARK_SCHEMA) issues.push('schemaVersion is invalid');
  if (!/^sha256:[0-9a-f]{64}$/.test(input.evidencePackDigest ?? '')) {
    issues.push('evidencePackDigest must bind every run to one immutable evidence pack');
  }
  if (!Array.isArray(input.runs)) return [...issues, 'runs must be an array'];
  for (const system of COMPETITIVE_SYSTEMS) {
    const candidates = input.runs.filter((run) => run?.system === system);
    if (candidates.length !== 1) {
      issues.push(`${system} must have exactly one run`);
      continue;
    }
    const run = candidates[0];
    if (!Array.isArray(run.evidenceRefs) || run.evidenceRefs.length === 0) {
      issues.push(`${system} must include artifact evidence`);
    }
    for (const metric of REQUIRED_METRICS) {
      if (!(metric in (run.metrics ?? {}))) issues.push(`${system}.${metric} is missing`);
    }
    for (const [key, value] of Object.entries(run.metrics ?? {})) {
      if (typeof value !== 'number' && typeof value !== 'boolean') {
        issues.push(`${system}.${key} must be numeric or boolean`);
      }
      if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
        issues.push(`${system}.${key} must be a finite non-negative number`);
      }
    }
  }
  return [...new Set(issues)].sort();
}

function derivedMetrics(metrics) {
  return Object.freeze({
    ...metrics,
    claimSupportRate: ratio(metrics.supportedClaims, metrics.totalClaims),
    chartFidelityRate: ratio(metrics.exactChartValues, metrics.totalChartValues),
    affectedSlidePrecision: ratio(metrics.correctlyAffectedSlides, metrics.totalAffectedSlides),
    pptxEditabilityRate: ratio(metrics.editablePptxObjects, metrics.totalPptxObjects),
    audiencePreferenceRate: ratio(metrics.audiencePreferenceWins, metrics.audiencePreferencePairs),
  });
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : 0;
}

function minimumLeader(rows, key) {
  return [...rows].sort((a, b) => a[key] - b[key] || a.system.localeCompare(b.system))[0].system;
}

function maximumLeader(rows, key) {
  return [...rows].sort((a, b) => b[key] - a[key] || a.system.localeCompare(b.system))[0].system;
}

function benchmarkDigest(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath)
    throw new Error(
      'Usage: node scripts/nodeslide-competitive-benchmark.mjs <input.json> [output.json]',
    );
  const report = evaluateCompetitiveBenchmark(JSON.parse(await readFile(inputPath, 'utf8')));
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (process.argv[3]) await writeFile(process.argv[3], serialized, 'utf8');
  else process.stdout.write(serialized);
  if (report.status !== 'scored') process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
