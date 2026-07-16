import { mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  appendTasteReport,
  evaluateTastePair,
  loadTasteArtifact,
  loadTasteJudge,
  loadTasteRules,
  tasteRulesDigest,
} from './nodeslide-tastebench.mjs';
import {
  STATUS,
  aggregateStatus,
  digestValue,
  fixtureDigest,
  loadFixtures,
  loadRegistry,
  loadSupplementalFixtures,
  loadUxArtifact,
  runUxBench,
  sha256,
  stableStringify,
  writeDeterministicJson,
} from './nodeslide-uxbench.mjs';

export const BENCHMARK_GATE_VERSION = '1.0.0';
export const BENCHMARK_SUMMARY_SCHEMA = 'nodeslide-benchmark-gate-summary/v1';
export const BENCHMARK_RUN_LOG_SCHEMA = 'nodeslide-benchmark-run-log/v1';
export const BENCHMARK_REWARD_LOG_SCHEMA = 'nodeslide-benchmark-reward-log/v1';
export const EXPECTED_REQUEST_COUNT = 167;
export const EXPECTED_FIXTURE_COUNT = 20;
export const EXPECTED_REGISTRY_SOURCE_SHA256 =
  '2254643bb268e2affd5a177e8b572818ed3c94b16f1f382354ebaa8a7462c862';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_DIRECTORY = path.resolve(scriptDirectory, '..');
export const DEFAULT_OUTPUT_DIRECTORY = path.join(
  REPOSITORY_DIRECTORY,
  '.tmp',
  'nodeslide-benchmark',
);
export const CORPUS_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'qa', 'nodeslide-agent-corpus');

const SCHEMA_EXPECTATIONS = Object.freeze({
  'fixture.schema.json': 'nodeslide-agent-fixture/v1',
  'run-artifact.schema.json': 'nodeslide-ux-run-manifest/v1',
  'run-record.schema.json': 'nodeslide-ux-run-record/v1',
  'taste-artifact.schema.json': 'nodeslide-taste-artifact/v1',
  'taste-judge.schema.json': 'nodeslide-taste-judge/v1',
  'automation.schema.json': null,
});

const FORBIDDEN_RUNNER_PATTERNS = Object.freeze([
  { label: 'network fetch', pattern: /\bfetch\s*\(/i },
  { label: 'network client import', pattern: /(?:from|require\s*\()\s*['"](?:node:)?https?['"]/i },
  { label: 'network URL construction', pattern: /\bhttps?:\/\//i },
  { label: 'network socket import', pattern: /(?:node:)?(?:net|tls|dgram)\b/i },
  { label: 'model provider import', pattern: /\b(?:openai|anthropic|gemini|vertexai)\b/i },
  {
    label: 'model invocation',
    pattern: /\b(?:generateText|streamText|model\.invoke|chat\.completions)\s*\(/i,
  },
  { label: 'process execution', pattern: /\b(?:exec|execFile|spawn|fork)\s*\(/i },
]);

export function makeCheck(id, status, message, evidenceRefs = []) {
  return { id, status, message, evidenceRefs };
}

export function validateCorpusShape(registry, fixtures) {
  const issues = [];
  if (registry?.caseCount !== EXPECTED_REQUEST_COUNT) {
    issues.push(`registry caseCount must be ${EXPECTED_REQUEST_COUNT}`);
  }
  if (!Array.isArray(registry?.cases) || registry.cases.length !== EXPECTED_REQUEST_COUNT) {
    issues.push(`registry must contain exactly ${EXPECTED_REQUEST_COUNT} cases`);
  }
  const cases = Array.isArray(registry?.cases) ? registry.cases : [];
  const ids = cases.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) issues.push('registry case IDs must be unique');
  const requests = cases.map(({ request }) => request);
  if (requests.some((request) => typeof request !== 'string' || request.length === 0)) {
    issues.push('every registry case must contain a nonempty exact request string');
  }
  if (new Set(requests).size !== requests.length)
    issues.push('registry request strings must be unique');
  if (registry?.source?.sha256 !== EXPECTED_REGISTRY_SOURCE_SHA256) {
    issues.push('registry source digest does not match the committed fixed corpus');
  }
  if (!Array.isArray(registry?.categories) || registry.categories.length !== 16) {
    issues.push('registry must contain exactly 16 categories');
  } else if (
    registry.categories.reduce((sum, category) => sum + (category.caseCount ?? 0), 0) !==
    EXPECTED_REQUEST_COUNT
  ) {
    issues.push('registry category counts must sum to 167');
  }
  if (
    !Array.isArray(registry?.minimumReleaseCaseIds) ||
    registry.minimumReleaseCaseIds.length !== EXPECTED_FIXTURE_COUNT
  ) {
    issues.push(`minimumReleaseCaseIds must contain exactly ${EXPECTED_FIXTURE_COUNT} IDs`);
  }
  if (!Array.isArray(fixtures) || fixtures.length !== EXPECTED_FIXTURE_COUNT) {
    issues.push(`fixtures must contain exactly ${EXPECTED_FIXTURE_COUNT} files`);
  }
  const fixtureIds = Array.isArray(fixtures) ? fixtures.map(({ id }) => id) : [];
  if (new Set(fixtureIds).size !== fixtureIds.length) issues.push('fixture IDs must be unique');
  if (
    stableStringify([...fixtureIds].sort()) !==
    stableStringify([...(registry?.minimumReleaseCaseIds ?? [])].sort())
  ) {
    issues.push('fixtures must exactly cover the minimum-release IDs');
  }
  const registryById = new Map(cases.map((entry) => [entry.id, entry]));
  for (const fixture of fixtures ?? []) {
    if (fixture.request?.text !== registryById.get(fixture.id)?.request) {
      issues.push(`${fixture.id}: fixture request does not exactly match the registry`);
    }
  }
  return issues;
}

export async function validateSchemaDocuments(corpusDirectory = CORPUS_DIRECTORY) {
  const issues = [];
  const digests = {};
  for (const [name, expectedSchemaVersion] of Object.entries(SCHEMA_EXPECTATIONS)) {
    const schemaPath = path.join(corpusDirectory, name);
    let bytes;
    let schema;
    try {
      bytes = await readFile(schemaPath);
      schema = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      issues.push(`${name}: cannot read valid JSON (${errorMessage(error)})`);
      continue;
    }
    digests[name] = sha256(bytes);
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
      issues.push(`${name}: must use JSON Schema draft 2020-12`);
    }
    if (schema.type !== 'object') issues.push(`${name}: root type must be object`);
    if (schema.additionalProperties !== false) {
      issues.push(`${name}: root additionalProperties must be false`);
    }
    if (
      expectedSchemaVersion &&
      schema.properties?.schemaVersion?.const !== expectedSchemaVersion
    ) {
      issues.push(`${name}: schemaVersion const is incorrect`);
    }
    if (!Array.isArray(schema.required) || schema.required.length === 0) {
      issues.push(`${name}: required must be a nonempty array`);
    }
    if (
      name === 'automation.schema.json' &&
      schema.properties?.schemaVersion?.const !== BENCHMARK_SUMMARY_SCHEMA
    ) {
      issues.push(`${name}: benchmark summary contract is missing`);
    }
  }
  return { issues, digests };
}

export async function checkRunnerIsolation(repositoryDirectory = REPOSITORY_DIRECTORY) {
  const issues = [];
  for (const relativePath of [
    'scripts/nodeslide-uxbench.mjs',
    'scripts/nodeslide-tastebench.mjs',
  ]) {
    const sourcePath = path.join(repositoryDirectory, relativePath);
    let source;
    try {
      source = await readFile(sourcePath, 'utf8');
    } catch (error) {
      issues.push(`${relativePath}: cannot read runner (${errorMessage(error)})`);
      continue;
    }
    for (const { label, pattern } of FORBIDDEN_RUNNER_PATTERNS) {
      if (pattern.test(source)) issues.push(`${relativePath}: forbidden ${label} path`);
    }
  }
  return issues;
}

export function checkRunnerDeterminism(registry, fixtures, tasteRules) {
  const uxFirst = runUxBench({ registry, fixtures, artifacts: [] });
  const uxSecond = runUxBench({ registry, fixtures, artifacts: [] });
  const tasteFirst = evaluateTastePair({
    rules: tasteRules,
    before: null,
    after: null,
    judge: null,
    caseId: null,
  });
  const tasteSecond = evaluateTastePair({
    rules: tasteRules,
    before: null,
    after: null,
    judge: null,
    caseId: null,
  });
  const issues = [];
  if (stableStringify(uxFirst) !== stableStringify(uxSecond))
    issues.push('UXBench output is not deterministic');
  if (stableStringify(tasteFirst) !== stableStringify(tasteSecond))
    issues.push('TasteBench output is not deterministic');
  if (uxFirst.status !== STATUS.UNSCORED || tasteFirst.status !== STATUS.UNSCORED) {
    issues.push('runners must refuse fabricated PASS without supplied evidence');
  }
  return { issues, uxReport: uxFirst, tasteReport: tasteFirst };
}

export function buildComparability(registry, fixtures, tasteRules, schemaDigests) {
  return {
    corpusVersion: registry.corpusVersion,
    registryDigest: digestValue(registry),
    registrySourceSha256: registry.source.sha256,
    requestCount: registry.cases.length,
    fixtureCount: fixtures.length,
    fixtureIds: fixtures.map(({ id }) => id),
    fixtureDigests: Object.fromEntries(
      fixtures.map((fixture) => [fixture.id, fixtureDigest(fixture)]),
    ),
    tasteRulesDigest: tasteRulesDigest(tasteRules),
    schemaDigests,
  };
}

export function compareBaseline(comparability, baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    return { comparable: false, reason: 'baseline must be a benchmark summary object' };
  }
  if (baseline.schemaVersion !== BENCHMARK_SUMMARY_SCHEMA) {
    return { comparable: false, reason: 'baseline schemaVersion is not comparable' };
  }
  if (
    !baseline.comparability ||
    stableStringify(baseline.comparability) !== stableStringify(comparability)
  ) {
    return { comparable: false, reason: 'baseline corpus, fixtures, rules, or schemas differ' };
  }
  return { comparable: true, reason: 'baseline corpus, fixtures, rules, and schemas match' };
}

export function aggregateEvidenceStatus(
  uxReport,
  tasteAggregate,
  inputIssues = [],
  baselineCheck = null,
) {
  const statuses = [
    uxReport.status,
    tasteAggregate.status,
    ...inputIssues.map(() => STATUS.UNSCORED),
  ];
  if (baselineCheck?.provided && !baselineCheck.comparable) statuses.push(STATUS.UNSCORED);
  return aggregateStatus(statuses);
}

export function exitCodeForStatus(status, enforce = false) {
  if (status === STATUS.PASS) return 0;
  if (status === STATUS.FAIL) return 1;
  return enforce ? 1 : 2;
}

export function parseHashChain(content, expectedSchemaVersion) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const envelopes = [];
  let previousDigest = null;
  for (const [index, line] of lines.entries()) {
    let envelope;
    try {
      envelope = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid benchmark log JSON on line ${index + 1}: ${errorMessage(error)}`);
    }
    if (!envelope || envelope.schemaVersion !== expectedSchemaVersion || !envelope.record) {
      throw new Error(`Invalid benchmark log envelope on line ${index + 1}.`);
    }
    if (envelope.previousRecordDigest !== previousDigest) {
      throw new Error(`Broken benchmark hash chain on line ${index + 1}.`);
    }
    if (envelope.recordId !== digestValue(envelope.record)) {
      throw new Error(`Invalid benchmark record digest on line ${index + 1}.`);
    }
    envelopes.push(envelope);
    previousDigest = digestValue(envelope);
  }
  return envelopes;
}

export async function appendHashChainedRecord(outputPath, schemaVersion, record) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const lockPath = `${outputPath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('Benchmark log is locked by another writer.');
    throw error;
  }
  try {
    let content = '';
    try {
      content = await readFile(outputPath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const envelopes = parseHashChain(content, schemaVersion);
    const recordId = digestValue(record);
    const existing = envelopes.find((envelope) => envelope.recordId === recordId);
    if (existing) return { appended: false, envelope: existing };
    const envelope = {
      schemaVersion,
      recordId,
      previousRecordDigest: envelopes.length === 0 ? null : digestValue(envelopes.at(-1)),
      record,
    };
    const handle = await open(outputPath, 'a');
    try {
      await handle.write(`${JSON.stringify(envelope)}\n`, null, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { appended: true, envelope };
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

export function makeSummary({
  lane,
  status,
  checks,
  comparability,
  ux = null,
  taste = null,
  artifacts = null,
  baseline = { provided: false },
}) {
  const withoutId = {
    schemaVersion: BENCHMARK_SUMMARY_SCHEMA,
    harness: { name: 'nodeslide-benchmark-gate', version: BENCHMARK_GATE_VERSION },
    lane,
    status,
    checks,
    comparability,
    ux,
    taste,
    artifacts,
    baseline,
  };
  return { ...withoutId, summaryId: digestValue(withoutId) };
}

async function runPrLane({ registry, fixtures, tasteRules, comparability, schemaCheck }) {
  const corpusIssues = validateCorpusShape(registry, fixtures);
  const determinism = checkRunnerDeterminism(registry, fixtures, tasteRules);
  const isolationIssues = await checkRunnerIsolation();
  const checks = [
    makeCheck(
      'fixed-corpus',
      corpusIssues.length === 0 ? STATUS.PASS : STATUS.FAIL,
      corpusIssues.length === 0
        ? 'All 167 exact registry requests and 20 minimum-release fixtures are bound.'
        : corpusIssues.join('; '),
    ),
    makeCheck(
      'schemas',
      schemaCheck.issues.length === 0 ? STATUS.PASS : STATUS.FAIL,
      schemaCheck.issues.length === 0
        ? 'All benchmark evidence and automation schemas are valid and pinned.'
        : schemaCheck.issues.join('; '),
    ),
    makeCheck(
      'runner-determinism',
      determinism.issues.length === 0 ? STATUS.PASS : STATUS.FAIL,
      determinism.issues.length === 0
        ? 'UXBench and TasteBench are deterministic and UNSCORED without evidence.'
        : determinism.issues.join('; '),
    ),
    makeCheck(
      'no-network-no-model',
      isolationIssues.length === 0 ? STATUS.PASS : STATUS.FAIL,
      isolationIssues.length === 0
        ? 'Benchmark runners contain no network, model invocation, or process execution path.'
        : isolationIssues.join('; '),
    ),
  ];
  return makeSummary({
    lane: 'pr',
    status: aggregateStatus(checks.map(({ status }) => status)),
    checks,
    comparability,
    ux: { status: determinism.uxReport.status, reportId: determinism.uxReport.reportId },
    taste: { status: determinism.tasteReport.status, reportId: determinism.tasteReport.reportId },
  });
}

async function listEvidenceFiles(input) {
  const metadata = await stat(input);
  if (metadata.isFile()) return [input];
  if (!metadata.isDirectory())
    throw new Error(`Evidence input is neither a file nor directory: ${input}`);
  const entries = await readdir(input, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter(
        (entry) =>
          !entry.name.startsWith('.') && (entry.isDirectory() || entry.name.endsWith('.json')),
      )
      .map((entry) => listEvidenceFiles(path.join(input, entry.name))),
  );
  return nested.flat().sort();
}

async function classifyEvidenceInputs(inputs) {
  const classified = { ux: [], before: [], after: [], judge: [], issues: [] };
  const files = [];
  for (const input of inputs) {
    try {
      files.push(...(await listEvidenceFiles(input)));
    } catch (error) {
      classified.issues.push(`${input}: cannot read supplied evidence (${errorMessage(error)})`);
    }
  }
  const uniqueFiles = [...new Set(files)].sort();
  for (const file of uniqueFiles) {
    let document;
    try {
      document = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      classified.issues.push(
        `${path.basename(file)}: cannot classify manifest (${errorMessage(error)})`,
      );
      continue;
    }
    if (document.schemaVersion === 'nodeslide-ux-run-manifest/v1') classified.ux.push(file);
    else if (
      document.schemaVersion === 'nodeslide-taste-artifact/v1' &&
      document.phase === 'before'
    ) {
      classified.before.push(file);
    } else if (
      document.schemaVersion === 'nodeslide-taste-artifact/v1' &&
      document.phase === 'after'
    ) {
      classified.after.push(file);
    } else if (document.schemaVersion === 'nodeslide-taste-judge/v1') classified.judge.push(file);
    else classified.issues.push(`${path.basename(file)}: unsupported supplied manifest schema`);
  }
  return classified;
}

async function expandInputPaths(inputs) {
  const paths = [];
  for (const input of inputs) {
    try {
      paths.push(...(await listEvidenceFiles(input)));
    } catch {
      paths.push(input);
    }
  }
  return [...new Set(paths)].sort();
}

async function loadTasteEvidence(paths, kind, rules) {
  if (kind === 'before' || kind === 'after') {
    return Promise.all(paths.map((manifestPath) => loadTasteArtifact(manifestPath, kind)));
  }
  return Promise.all(paths.map((manifestPath) => loadTasteJudge(manifestPath, rules)));
}

function makeTasteAggregate(reports) {
  const withoutId = {
    schemaVersion: 'nodeslide-tastebench-gate-report/v1',
    harness: { name: 'nodeslide-benchmark-gate', version: BENCHMARK_GATE_VERSION },
    status: aggregateStatus(reports.map(({ status }) => status)),
    summary: {
      pass: reports.filter(({ status }) => status === STATUS.PASS).length,
      fail: reports.filter(({ status }) => status === STATUS.FAIL).length,
      unscored: reports.filter(({ status }) => status === STATUS.UNSCORED).length,
    },
    reports,
  };
  return { ...withoutId, reportId: digestValue(withoutId) };
}

async function runEvidenceLane({
  registry,
  fixtures,
  supplementalFixtures,
  tasteRules,
  comparability,
  options,
}) {
  const classified = await classifyEvidenceInputs(options.evidenceInputs);
  const uxPaths = [
    ...new Set([...(await expandInputPaths(options.uxArtifactInputs)), ...classified.ux]),
  ].sort();
  const artifacts = await Promise.all(uxPaths.map((manifestPath) => loadUxArtifact(manifestPath)));
  const evaluationFixtures = [...fixtures, ...supplementalFixtures];
  const knownCaseIds = new Set(evaluationFixtures.map(({ id }) => id));
  for (const caseId of options.selectedCaseIds) {
    if (!knownCaseIds.has(caseId)) classified.issues.push(`unknown selected case ${caseId}`);
  }
  const uxReport = runUxBench({
    registry,
    fixtures: evaluationFixtures,
    artifacts,
    selectedCaseIds: options.selectedCaseIds,
  });

  const beforePaths = [...new Set([...options.tasteBeforeInputs, ...classified.before])].sort();
  const afterPaths = [...new Set([...options.tasteAfterInputs, ...classified.after])].sort();
  const judgePaths = [...new Set([...options.tasteJudgeInputs, ...classified.judge])].sort();
  const [befores, afters, judges] = await Promise.all([
    loadTasteEvidence(beforePaths, 'before', tasteRules),
    loadTasteEvidence(afterPaths, 'after', tasteRules),
    loadTasteEvidence(judgePaths, 'judge', tasteRules),
  ]);
  const tasteCaseIds = new Set(
    [
      options.tasteCaseId,
      ...befores.map((input) => input.caseId),
      ...afters.map((input) => input.caseId),
      ...judges.map((input) => input.caseId),
    ].filter(Boolean),
  );
  if (tasteCaseIds.size === 0) tasteCaseIds.add(null);
  const tasteReports = [...tasteCaseIds].sort().map((caseId) => {
    const before = befores.find((input) => input.caseId === caseId) ?? null;
    const after = afters.find((input) => input.caseId === caseId) ?? null;
    const judge = judges.find((input) => input.caseId === caseId) ?? null;
    return evaluateTastePair({ rules: tasteRules, before, after, judge, caseId });
  });
  const tasteAggregate = makeTasteAggregate(tasteReports);
  const baseline = await loadBaseline(options.baselinePath, comparability);
  const status = aggregateEvidenceStatus(uxReport, tasteAggregate, classified.issues, baseline);
  const checks = [
    makeCheck(
      'uxbench',
      uxReport.status,
      `UXBench status is ${uxReport.status} across ${
        options.selectedCaseIds.length || evaluationFixtures.length
      } selected fixtures.`,
    ),
    makeCheck(
      'tastebench',
      tasteAggregate.status,
      `TasteBench status is ${tasteAggregate.status}.`,
    ),
    ...classified.issues.map((issue, index) =>
      makeCheck(`evidence-input-${index + 1}`, STATUS.UNSCORED, issue),
    ),
    ...(baseline.provided && !baseline.comparable
      ? [makeCheck('baseline-comparability', STATUS.UNSCORED, baseline.reason)]
      : []),
  ];
  return {
    summary: makeSummary({
      lane: 'evidence',
      status,
      checks,
      comparability,
      ux: {
        status: uxReport.status,
        reportId: uxReport.reportId,
        artifactCount: artifacts.length,
      },
      taste: {
        status: tasteAggregate.status,
        reportId: tasteAggregate.reportId,
        reportCount: tasteReports.length,
      },
      artifacts: {
        uxManifestDigests: artifacts
          .map((artifact) => artifact.manifestDigest)
          .filter(Boolean)
          .sort(),
        tasteManifestDigests: [...befores, ...afters, ...judges]
          .map((input) => input.manifestDigest)
          .filter(Boolean)
          .sort(),
      },
      baseline,
    }),
    uxReport,
    tasteReports,
    tasteAggregate,
    artifacts: [...artifacts, ...befores, ...afters, ...judges],
  };
}

async function loadBaseline(baselinePath, comparability) {
  if (!baselinePath) return { provided: false };
  try {
    const bytes = await readFile(baselinePath);
    const baseline = JSON.parse(bytes.toString('utf8'));
    const comparison = compareBaseline(comparability, baseline);
    return {
      provided: true,
      comparable: comparison.comparable,
      reason: comparison.reason,
      summaryId: baseline.summaryId ?? null,
      digest: sha256(bytes),
    };
  } catch (error) {
    return {
      provided: true,
      comparable: false,
      reason: `baseline could not be read: ${errorMessage(error)}`,
      summaryId: null,
      digest: null,
    };
  }
}

async function writeEvidenceOutputs(outputDirectory, result) {
  await mkdir(outputDirectory, { recursive: true });
  await writeDeterministicJson(path.join(outputDirectory, 'uxbench-report.json'), result.uxReport);
  await writeDeterministicJson(
    path.join(outputDirectory, 'tastebench-report.json'),
    result.tasteAggregate,
  );
  for (const report of result.tasteReports) {
    await appendTasteReport(path.join(outputDirectory, 'tastebench-results.ndjson'), report);
  }
  const runRecord = {
    schemaVersion: BENCHMARK_SUMMARY_SCHEMA,
    lane: 'evidence',
    summaryId: result.summary.summaryId,
    status: result.summary.status,
    comparabilityDigest: digestValue(result.summary.comparability),
    uxReportId: result.uxReport.reportId,
    tasteReportId: result.tasteAggregate.reportId,
    artifactManifestDigests: result.summary.artifacts.uxManifestDigests.concat(
      result.summary.artifacts.tasteManifestDigests,
    ),
  };
  const rewardRecord = {
    schemaVersion: BENCHMARK_SUMMARY_SCHEMA,
    summaryId: result.summary.summaryId,
    status: result.summary.status,
    reward: result.summary.status === STATUS.PASS ? 1 : 0,
    rewardStatus: result.summary.status.toLowerCase(),
    gateable: result.summary.status === STATUS.PASS,
  };
  await appendHashChainedRecord(
    path.join(outputDirectory, 'run-records.ndjson'),
    BENCHMARK_RUN_LOG_SCHEMA,
    runRecord,
  );
  await appendHashChainedRecord(
    path.join(outputDirectory, 'reward-records.ndjson'),
    BENCHMARK_REWARD_LOG_SCHEMA,
    rewardRecord,
  );
  await writeDeterministicJson(
    path.join(outputDirectory, 'benchmark-summary.json'),
    result.summary,
  );
}

export async function runGate({
  mode = 'evidence',
  outDir = DEFAULT_OUTPUT_DIRECTORY,
  enforce = false,
  evidenceInputs = [],
  uxArtifactInputs = [],
  tasteBeforeInputs = [],
  tasteAfterInputs = [],
  tasteJudgeInputs = [],
  tasteCaseId = null,
  selectedCaseIds = [],
  baselinePath = null,
} = {}) {
  if (!['pr', 'evidence'].includes(mode)) throw new Error(`Unknown benchmark gate mode: ${mode}`);
  const [registry, fixtures, supplementalFixtures, tasteRules, schemaCheck] = await Promise.all([
    loadRegistry(),
    loadFixtures(),
    loadSupplementalFixtures(),
    loadTasteRules(),
    validateSchemaDocuments(),
  ]);
  const comparability = buildComparability(registry, fixtures, tasteRules, schemaCheck.digests);
  let summary;
  if (mode === 'pr') {
    summary = await runPrLane({ registry, fixtures, tasteRules, comparability, schemaCheck });
    await mkdir(outDir, { recursive: true });
    await writeDeterministicJson(path.join(outDir, 'benchmark-summary.json'), summary);
  } else {
    const result = await runEvidenceLane({
      registry,
      fixtures,
      supplementalFixtures,
      tasteRules,
      comparability,
      options: {
        evidenceInputs,
        uxArtifactInputs,
        tasteBeforeInputs,
        tasteAfterInputs,
        tasteJudgeInputs,
        tasteCaseId,
        selectedCaseIds,
        baselinePath,
      },
    });
    summary = result.summary;
    await writeEvidenceOutputs(outDir, result);
  }
  return { summary, exitCode: exitCodeForStatus(summary.status, enforce) };
}

function parseCliArguments(argv) {
  const options = {
    mode: 'evidence',
    outDir: DEFAULT_OUTPUT_DIRECTORY,
    enforce: false,
    evidenceInputs: [],
    uxArtifactInputs: [],
    tasteBeforeInputs: [],
    tasteAfterInputs: [],
    tasteJudgeInputs: [],
    tasteCaseId: null,
    selectedCaseIds: [],
    baselinePath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--mode') {
      if (!value) throw new Error('--mode requires pr or evidence');
      options.mode = value;
      index += 1;
    } else if (argument === '--out') {
      if (!value) throw new Error('--out requires a directory');
      options.outDir = path.resolve(value);
      index += 1;
    } else if (argument === '--evidence' || argument === '--evidence-dir') {
      if (!value) throw new Error(`${argument} requires a path`);
      options.evidenceInputs.push(path.resolve(value));
      index += 1;
    } else if (
      argument === '--ux-artifact' ||
      argument === '--ux-artifacts' ||
      argument === '--artifact' ||
      argument === '--artifacts'
    ) {
      if (!value) throw new Error(`${argument} requires a path`);
      options.uxArtifactInputs.push(path.resolve(value));
      index += 1;
    } else if (argument === '--taste-before') {
      if (!value) throw new Error('--taste-before requires a manifest path');
      options.tasteBeforeInputs.push(path.resolve(value));
      index += 1;
    } else if (argument === '--taste-after') {
      if (!value) throw new Error('--taste-after requires a manifest path');
      options.tasteAfterInputs.push(path.resolve(value));
      index += 1;
    } else if (argument === '--taste-judge') {
      if (!value) throw new Error('--taste-judge requires a manifest path');
      options.tasteJudgeInputs.push(path.resolve(value));
      index += 1;
    } else if (argument === '--taste-case') {
      if (!value) throw new Error('--taste-case requires a case ID');
      options.tasteCaseId = value;
      index += 1;
    } else if (argument === '--case') {
      if (!value) throw new Error('--case requires an ID');
      options.selectedCaseIds.push(value);
      index += 1;
    } else if (argument === '--baseline') {
      if (!value) throw new Error('--baseline requires a summary path');
      options.baselinePath = path.resolve(value);
      index += 1;
    } else if (argument === '--enforce') {
      options.enforce = true;
    } else {
      throw new Error(`Unknown argument ${argument}`);
    }
  }
  return options;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function cli(argv) {
  try {
    const options = parseCliArguments(argv);
    const result = await runGate(options);
    process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli(process.argv.slice(2));
}
