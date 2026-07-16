import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BENCHMARK_REWARD_LOG_SCHEMA,
  BENCHMARK_RUN_LOG_SCHEMA,
  aggregateEvidenceStatus,
  appendHashChainedRecord,
  buildComparability,
  checkRunnerIsolation,
  compareBaseline,
  exitCodeForStatus,
  makeCheck,
  makeSummary,
  parseHashChain,
  runGate,
  validateCorpusShape,
  validateSchemaDocuments,
} from '../nodeslide-benchmark-gate.mjs';
import { loadTasteRules } from '../nodeslide-tastebench.mjs';
import { STATUS, loadFixtures, loadRegistry } from '../nodeslide-uxbench.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-benchmark-gate-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('NodeSlide benchmark automation gate', () => {
  it('passes the fixed corpus, schema, determinism, and isolation PR lane', async () => {
    const directory = await temporaryDirectory();
    const result = await runGate({ mode: 'pr', outDir: directory });

    expect(result.summary.status).toBe(STATUS.PASS);
    expect(result.summary.checks.map(({ id }) => id)).toEqual([
      'fixed-corpus',
      'schemas',
      'runner-determinism',
      'no-network-no-model',
    ]);
    expect(result.exitCode).toBe(0);
    expect(validateCorpusShape(await loadRegistry(), await loadFixtures())).toEqual([]);
    expect(await checkRunnerIsolation()).toEqual([]);
  });

  it('keeps the scheduled producer fixed to C01, E01, A05 and fail-closed visual judging', async () => {
    const workflow = await readFile(
      new URL('../../.github/workflows/nodeslide-bench.yml', import.meta.url),
      'utf8',
    );

    expect(workflow).toContain('pnpm nodeslide:bench:produce-live');
    expect(workflow).toContain('pnpm nodeslide:bench:taste-judge');
    expect(workflow).toContain('--case C01');
    expect(workflow).toContain('--case E01');
    expect(workflow).toContain('--case A05');
    expect(workflow).toContain('--enforce');
    expect(workflow).toContain('NODESLIDE_BENCH_ALLOW_LIVE_WRITE');
    expect(workflow).not.toMatch(/OPENROUTER_API_KEY:\s*['"][a-z0-9_-]{20,}/iu);
  });

  it('emits honest UNSCORED output without evidence and enforces it only on request', async () => {
    const directory = await temporaryDirectory();
    const result = await runGate({ mode: 'evidence', outDir: directory });

    expect(result.summary.status).toBe(STATUS.UNSCORED);
    expect(result.summary.ux.status).toBe(STATUS.UNSCORED);
    expect(result.summary.taste.status).toBe(STATUS.UNSCORED);
    expect(result.exitCode).toBe(2);
    expect(exitCodeForStatus(STATUS.UNSCORED, true)).toBe(1);
    expect(result.summary.taste.reportCount).toBe(1);
    expect(result.summary.taste.reportId).toMatch(/^sha256:/);
  });

  it('can select a supplemental live case without changing the P0 fixture contract', async () => {
    const directory = await temporaryDirectory();
    const result = await runGate({
      mode: 'evidence',
      outDir: directory,
      selectedCaseIds: ['A05'],
    });

    expect(result.summary.status).toBe(STATUS.UNSCORED);
    expect(result.summary.comparability.fixtureCount).toBe(20);
    expect(result.summary.checks.find(({ id }) => id === 'uxbench')?.message).toContain(
      'across 1 selected fixtures',
    );
  });

  it('never aggregates missing TasteBench evidence into a fabricated PASS', () => {
    expect(
      aggregateEvidenceStatus({ status: STATUS.PASS }, { status: STATUS.PASS }, [], {
        provided: false,
      }),
    ).toBe(STATUS.PASS);
    expect(aggregateEvidenceStatus({ status: STATUS.PASS }, { status: STATUS.UNSCORED })).toBe(
      STATUS.UNSCORED,
    );
    expect(exitCodeForStatus(STATUS.FAIL)).toBe(1);
    expect(exitCodeForStatus(STATUS.UNSCORED)).toBe(2);
  });

  it('writes deterministic reports and idempotent hash-chained run/reward records', async () => {
    const directory = await temporaryDirectory();
    const first = await runGate({ mode: 'evidence', outDir: directory });
    const firstSummaryBytes = await readFile(
      path.join(directory, 'benchmark-summary.json'),
      'utf8',
    );
    const firstRunLog = await readFile(path.join(directory, 'run-records.ndjson'), 'utf8');
    const firstRewardLog = await readFile(path.join(directory, 'reward-records.ndjson'), 'utf8');
    const second = await runGate({ mode: 'evidence', outDir: directory });

    expect(second.summary).toEqual(first.summary);
    expect(await readFile(path.join(directory, 'benchmark-summary.json'), 'utf8')).toBe(
      firstSummaryBytes,
    );
    expect(await readFile(path.join(directory, 'run-records.ndjson'), 'utf8')).toBe(firstRunLog);
    expect(await readFile(path.join(directory, 'reward-records.ndjson'), 'utf8')).toBe(
      firstRewardLog,
    );
    expect(parseHashChain(firstRunLog, BENCHMARK_RUN_LOG_SCHEMA)).toHaveLength(1);
    expect(parseHashChain(firstRewardLog, BENCHMARK_REWARD_LOG_SCHEMA)).toHaveLength(1);
    expect(first.summary.status).toBe(STATUS.UNSCORED);
  });

  it('detects broken chains and refuses incomparable baselines', async () => {
    const directory = await temporaryDirectory();
    const outputPath = path.join(directory, 'records.ndjson');
    const record = { kind: 'run', summaryId: 'sha256:test', status: STATUS.UNSCORED };
    const first = await appendHashChainedRecord(outputPath, BENCHMARK_RUN_LOG_SCHEMA, record);
    const replay = await appendHashChainedRecord(outputPath, BENCHMARK_RUN_LOG_SCHEMA, record);
    expect(first.appended).toBe(true);
    expect(replay.appended).toBe(false);

    const tampered = `${(await readFile(outputPath, 'utf8')).replace('UNSCORED', 'PASS')}`;
    await writeFile(outputPath, tampered);
    expect(() => parseHashChain(tampered, BENCHMARK_RUN_LOG_SCHEMA)).toThrow(/digest/);

    const registry = await loadRegistry();
    const fixtures = await loadFixtures({ registry });
    const tasteRules = await loadTasteRules();
    const schemas = await validateSchemaDocuments();
    const comparability = buildComparability(registry, fixtures, tasteRules, schemas.digests);
    const baseline = makeSummary({
      lane: 'evidence',
      status: STATUS.UNSCORED,
      checks: [makeCheck('baseline', STATUS.UNSCORED, 'no evidence')],
      comparability,
    });
    expect(compareBaseline(comparability, baseline)).toEqual({
      comparable: true,
      reason: 'baseline corpus, fixtures, rules, and schemas match',
    });
    expect(
      compareBaseline(comparability, {
        ...baseline,
        comparability: { ...comparability, fixtureCount: 19 },
      }).comparable,
    ).toBe(false);
  });
});
