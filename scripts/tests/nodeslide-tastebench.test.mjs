import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  appendTasteReport,
  evaluateTastePair,
  loadTasteArtifact,
  loadTasteJudge,
  loadTasteRules,
  parseAndValidateLog,
  tasteRulesDigest,
} from '../nodeslide-tastebench.mjs';
import { STATUS, sha256 } from '../nodeslide-uxbench.mjs';

let rules;
const temporaryDirectories = [];

beforeAll(async () => {
  rules = await loadTasteRules();
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('TasteBench evidence policy', () => {
  it('is deterministic and UNSCORED without pixels and an independent judge', () => {
    const first = evaluateTastePair({
      rules,
      before: null,
      after: null,
      judge: null,
      caseId: 'T09',
    });
    const second = evaluateTastePair({
      rules,
      before: null,
      after: null,
      judge: null,
      caseId: 'T09',
    });

    expect(second).toEqual(first);
    expect(first.status).toBe(STATUS.UNSCORED);
    expect(first.proofPolicy.selfReportedUiStringsAccepted).toBe(false);
    expect(first.checks.map(({ status }) => status)).toEqual([
      STATUS.UNSCORED,
      STATUS.UNSCORED,
      STATUS.UNSCORED,
    ]);
  });

  it('passes complete pixel-bound independent judgment under held-out rules', async () => {
    const inputs = await writeTasteInputs(await temporaryDirectory());
    const loaded = await loadInputs(inputs);
    const first = evaluateTastePair({ rules, ...loaded });
    const second = evaluateTastePair({ rules, ...loaded });

    expect(first).toEqual(second);
    expect(first.status).toBe(STATUS.PASS);
    expect(first.metrics).toEqual({ weightedAfter: 3.5, weightedDelta: 1.5, regressions: 0 });
    expect(first.checks.every(({ status }) => status === STATUS.PASS)).toBe(true);
    expect(first.checks.every(({ evidenceRefs }) => evidenceRefs.length > 0)).toBe(true);
    expect(first.provenance.rulesDigest).toBe(tasteRulesDigest(rules));
  });

  it('rejects manifest-binding and judge-independence provenance failures as UNSCORED', async () => {
    const mismatchInputs = await writeTasteInputs(await temporaryDirectory(), {
      beforeBinding: `sha256:${'f'.repeat(64)}`,
    });
    const mismatch = evaluateTastePair({ rules, ...(await loadInputs(mismatchInputs)) });
    expect(mismatch.status).toBe(STATUS.UNSCORED);
    expect(mismatch.checks).toContainEqual(
      expect.objectContaining({ id: 'paired-provenance', status: STATUS.UNSCORED }),
    );

    const sameProducerInputs = await writeTasteInputs(await temporaryDirectory(), {
      judgeProducer: 'pixel-capture-harness',
    });
    const sameProducer = evaluateTastePair({
      rules,
      ...(await loadInputs(sameProducerInputs)),
    });
    expect(sameProducer.status).toBe(STATUS.UNSCORED);
    expect(sameProducer.checks.find(({ id }) => id === 'paired-provenance').message).toMatch(
      /independent/,
    );

    const identicalPixelsInputs = await writeTasteInputs(await temporaryDirectory(), {
      identicalPixels: true,
    });
    const identicalPixels = evaluateTastePair({
      rules,
      ...(await loadInputs(identicalPixelsInputs)),
    });
    expect(identicalPixels.status).toBe(STATUS.UNSCORED);
    expect(identicalPixels.checks.find(({ id }) => id === 'paired-provenance').message).toMatch(
      /byte-identical/,
    );
  });

  it('does not accept self-reported UI strings in place of pixel proof', async () => {
    const inputs = await writeTasteInputs(await temporaryDirectory(), { addUiStrings: true });
    const before = await loadTasteArtifact(inputs.beforePath, 'before');
    const after = await loadTasteArtifact(inputs.afterPath, 'after');
    const judge = await loadTasteJudge(inputs.judgePath, rules);
    const report = evaluateTastePair({ rules, before, after, judge });

    expect(before.ok).toBe(false);
    expect(before.errors.join(' ')).toMatch(/unknown key uiStrings/);
    expect(report.status).toBe(STATUS.UNSCORED);
    expect(report.checks.some(({ status }) => status === STATUS.PASS)).toBe(true);
    expect(report.checks.some(({ status }) => status === STATUS.UNSCORED)).toBe(true);
  });

  it('remains UNSCORED when verified pixels have no judge evidence', async () => {
    const inputs = await writeTasteInputs(await temporaryDirectory());
    const before = await loadTasteArtifact(inputs.beforePath, 'before');
    const after = await loadTasteArtifact(inputs.afterPath, 'after');
    const report = evaluateTastePair({ rules, before, after, judge: null });

    expect(before.ok).toBe(true);
    expect(after.ok).toBe(true);
    expect(report.status).toBe(STATUS.UNSCORED);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'independent-judge', status: STATUS.UNSCORED }),
    );
  });
});

describe('TasteBench append-only output', () => {
  it('appends a hash-chained report once and is idempotent on replay', async () => {
    const directory = await temporaryDirectory();
    const inputs = await writeTasteInputs(directory);
    const report = evaluateTastePair({ rules, ...(await loadInputs(inputs)) });
    const outputPath = path.join(directory, 'taste-results.ndjson');

    const first = await appendTasteReport(outputPath, report);
    const duplicate = await appendTasteReport(outputPath, report);
    const unscored = evaluateTastePair({
      rules,
      before: null,
      after: null,
      judge: null,
      caseId: 'V07',
    });
    const second = await appendTasteReport(outputPath, unscored);
    const replayFirst = await appendTasteReport(outputPath, report);

    expect(first.appended).toBe(true);
    expect(duplicate.appended).toBe(false);
    expect(second.appended).toBe(true);
    expect(replayFirst.appended).toBe(false);
    const envelopes = parseAndValidateLog(await readFile(outputPath, 'utf8'));
    expect(envelopes).toHaveLength(2);
    expect(envelopes[0].previousRecordDigest).toBeNull();
    expect(envelopes[1].previousRecordDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(envelopes.map(({ recordId }) => recordId)).toEqual([report.reportId, unscored.reportId]);
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-tastebench-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeTasteInputs(
  directory,
  {
    addUiStrings = false,
    beforeBinding = null,
    judgeProducer = 'independent-visual-judge',
    identicalPixels = false,
  } = {},
) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const beforeBytes = Buffer.concat([pngSignature, Buffer.from('before-pixel-evidence')]);
  const afterBytes = identicalPixels
    ? beforeBytes
    : Buffer.concat([pngSignature, Buffer.from('after-pixel-evidence')]);
  await writeFile(path.join(directory, 'before.png'), beforeBytes);
  await writeFile(path.join(directory, 'after.png'), afterBytes);

  const manifest = (phase, bytes) => ({
    schemaVersion: 'nodeslide-taste-artifact/v1',
    artifactId: `${phase}-artifact-t09`,
    caseId: 'T09',
    phase,
    provenance: {
      capturedAt: phase === 'before' ? '2026-07-15T20:00:00.000Z' : '2026-07-15T20:01:00.000Z',
      producer: { name: 'pixel-capture-harness', version: '1.0.0' },
      sourceRevision: 'b'.repeat(40),
      captureMethod: 'browser_screenshot',
    },
    capture: {
      slideId: 'slide-proof',
      stateDigest: `sha256:${phase === 'before' ? '1'.repeat(64) : '2'.repeat(64)}`,
      viewport: { width: 1512, height: 812, deviceScaleFactor: 1 },
    },
    pixels: [
      {
        id: `${phase}-slide`,
        path: `${phase}.png`,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
        width: 1512,
        height: 812,
        mediaType: 'image/png',
      },
    ],
    ...(phase === 'before' && addUiStrings ? { uiStrings: ['Looks polished', 'PASS'] } : {}),
  });
  const beforeManifest = manifest('before', beforeBytes);
  const afterManifest = manifest('after', afterBytes);
  const beforeSerialized = `${JSON.stringify(beforeManifest, null, 2)}\n`;
  const afterSerialized = `${JSON.stringify(afterManifest, null, 2)}\n`;
  const beforePath = path.join(directory, 'before.manifest.json');
  const afterPath = path.join(directory, 'after.manifest.json');
  await writeFile(beforePath, beforeSerialized);
  await writeFile(afterPath, afterSerialized);

  const pixelPair = { beforePixelId: 'before-slide', afterPixelId: 'after-slide' };
  const judge = {
    schemaVersion: 'nodeslide-taste-judge/v1',
    judgmentId: 'judge-t09-1',
    caseId: 'T09',
    bindings: {
      beforeArtifactId: 'before-artifact-t09',
      beforeManifestDigest: beforeBinding ?? sha256(Buffer.from(beforeSerialized)),
      afterArtifactId: 'after-artifact-t09',
      afterManifestDigest: sha256(Buffer.from(afterSerialized)),
      pixelPairs: [pixelPair],
    },
    rubric: { id: rules.rubricId, digest: tasteRulesDigest(rules) },
    provenance: {
      judgedAt: '2026-07-15T20:02:00.000Z',
      judgeType: 'independent_visual_judge',
      producer: { name: judgeProducer, version: '1.0.0' },
      model: { provider: 'test-provider', name: 'visual-rubric-judge', version: '2026-07-15' },
      promptDigest: `sha256:${'3'.repeat(64)}`,
    },
    assessments: rules.rules.map((rule) => ({
      ruleId: rule.id,
      beforeScore: 2,
      afterScore: 3.5,
      confidence: 0.9,
      pixelPairs: [pixelPair],
      rationale: 'Independent judgment bound to the supplied before and after pixels.',
    })),
  };
  const judgePath = path.join(directory, 'judge.json');
  await writeFile(judgePath, `${JSON.stringify(judge, null, 2)}\n`);
  return { beforePath, afterPath, judgePath };
}

async function loadInputs({ beforePath, afterPath, judgePath }) {
  const before = await loadTasteArtifact(beforePath, 'before');
  const after = await loadTasteArtifact(afterPath, 'after');
  const judge = await loadTasteJudge(judgePath, rules);
  expect(before.ok).toBe(true);
  expect(after.ok).toBe(true);
  expect(judge.ok).toBe(true);
  return { before, after, judge };
}
