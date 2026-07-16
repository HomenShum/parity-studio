import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  STATUS,
  applyOperator,
  fixtureDigest,
  loadFixtures,
  loadRegistry,
  loadSupplementalFixtures,
  loadUxArtifact,
  runUxBench,
  sha256,
  validateFixture,
  writeDeterministicJson,
} from '../nodeslide-uxbench.mjs';

let registry;
let fixtures;
const temporaryDirectories = [];

beforeAll(async () => {
  registry = await loadRegistry();
  fixtures = await loadFixtures({ registry });
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('NodeSlide Agent Request Corpus fixtures', () => {
  it('covers every registry case and exactly the 20 minimum-release fixtures', async () => {
    expect(registry.caseCount).toBe(167);
    expect(registry.cases).toHaveLength(167);
    expect(registry.categories).toHaveLength(16);
    expect(new Set(registry.cases.map(({ id }) => id)).size).toBe(167);
    expect(registry.categories.reduce((sum, category) => sum + category.caseCount, 0)).toBe(167);
    expect(registry.source.sha256).toBe(
      '2254643bb268e2affd5a177e8b572818ed3c94b16f1f382354ebaa8a7462c862',
    );

    expect(fixtures).toHaveLength(20);
    expect(fixtures.map(({ id }) => id).sort()).toEqual([...registry.minimumReleaseCaseIds].sort());
    const registryById = new Map(registry.cases.map((entry) => [entry.id, entry]));
    for (const fixture of fixtures) {
      expect(validateFixture(fixture, registryById.get(fixture.id))).toEqual([]);
      expect(fixture.assertions.length).toBeGreaterThan(0);
      expect(fixture.trace.mustInclude.length).toBeGreaterThan(0);
      expect(fixture.forbidden.length).toBeGreaterThan(0);
      expect(fixture.expected.authority.boundaryBehavior.length).toBeGreaterThan(0);
    }
    const fixtureWithInventedScore = structuredClone(fixtures[0]);
    fixtureWithInventedScore.expected.fabricatedPass = true;
    expect(
      validateFixture(fixtureWithInventedScore, registryById.get(fixtureWithInventedScore.id)),
    ).toContain('expected has unknown key fabricatedPass');

    const fixtureSchema = JSON.parse(
      await readFile(
        new URL('../../qa/nodeslide-agent-corpus/fixture.schema.json', import.meta.url),
        'utf8',
      ),
    );
    expect(fixtureSchema.properties.schemaVersion.const).toBe('nodeslide-agent-fixture/v1');
  });

  it('preserves every P0 prompt exactly from the source-bound registry', () => {
    const registryById = new Map(registry.cases.map((entry) => [entry.id, entry]));
    for (const fixture of fixtures) {
      expect(fixture.request.text).toBe(registryById.get(fixture.id).request);
    }
    expect(registryById.get('C01').request).toBe(
      'Create a six-slide investor deck explaining the problem, product, traction, market, business model, and next milestone.',
    );
    expect(registryById.get('R01').request).toBe(
      'Comment: “This feels too technical for the audience.” → Send to AI',
    );
    expect(registryById.get('F08').request).toBe('Proposal based on stale element version');
  });

  it('loads live-only cases without changing the fixed P0 comparability set', async () => {
    const supplemental = await loadSupplementalFixtures({ registry });
    expect(supplemental.map(({ id }) => id)).toEqual(['A05']);
    expect(supplemental[0].minimumRelease).toBe(false);
    expect(supplemental[0].request.text).toBe('Spend no more than $1 on this run.');
    expect(
      validateFixture(
        supplemental[0],
        registry.cases.find(({ id }) => id === 'A05'),
        { minimumRelease: false },
      ),
    ).toEqual([]);
    expect(fixtures).toHaveLength(20);
  });
});

describe('UXBench evidence evaluation', () => {
  it('evaluates the canonical assertion operators deterministically', () => {
    expect(applyOperator('equals', { b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(applyOperator('not_equals', 1, 2)).toBe(true);
    expect(applyOperator('length_equals', ['a', 'b'], 2)).toBe(true);
    expect(applyOperator('contains', ['a', 'b'], 'b')).toBe(true);
    expect(applyOperator('contains_all', ['a', 'b'], ['b', 'a'])).toBe(true);
    expect(applyOperator('set_equals', ['b', 'a'], ['a', 'b'])).toBe(true);
    expect(applyOperator('all_nonempty', ['a', ['b'], { c: true }])).toBe(true);
    expect(applyOperator('all_unique', [{ a: 1 }, { a: 2 }])).toBe(true);
    expect(applyOperator('unchanged', [1, 2], undefined, [1, 2])).toBe(true);
    expect(applyOperator('changed', [1, 2], undefined, [1, 3])).toBe(true);
    expect(applyOperator('truthy', 'evidence')).toBe(true);
    expect(applyOperator('falsy', '')).toBe(true);
    expect(applyOperator('greater_than_or_equal', 4, 4)).toBe(true);
    expect(applyOperator('less_than_or_equal', 0.25, 0.25)).toBe(true);
  });

  it('is deterministic and never fabricates PASS when no artifact is supplied', () => {
    const first = runUxBench({
      registry,
      fixtures,
      artifacts: [],
      selectedCaseIds: ['C01'],
    });
    const second = runUxBench({
      registry,
      fixtures,
      artifacts: [],
      selectedCaseIds: ['C01'],
    });

    expect(second).toEqual(first);
    expect(first.status).toBe(STATUS.UNSCORED);
    expect(first.cases[0].status).toBe(STATUS.UNSCORED);
    expect(first.cases[0].checks).toEqual([
      expect.objectContaining({
        id: 'artifact-supplied',
        status: STATUS.UNSCORED,
        evidenceRefs: [],
      }),
    ]);
    expect(JSON.stringify(first)).not.toContain('"status":"PASS"');
  });

  it('passes only a complete hash-verified run record and emits evidence references', async () => {
    const directory = await temporaryDirectory();
    const fixture = fixtureById('C01');
    const manifestPath = await writeC01Artifact(directory, fixture);
    const artifact = await loadUxArtifact(manifestPath);
    const report = runUxBench({
      registry,
      fixtures,
      artifacts: [artifact],
      selectedCaseIds: ['C01'],
    });

    expect(artifact.ok).toBe(true);
    expect(report.status).toBe(STATUS.PASS);
    expect(report.cases[0].status).toBe(STATUS.PASS);
    expect(report.cases[0].checks.every(({ status }) => status === STATUS.PASS)).toBe(true);
    expect(report.cases[0].checks.every(({ evidenceRefs }) => evidenceRefs.length > 0)).toBe(true);
  });

  it('returns FAIL for a proven deterministic assertion mismatch', async () => {
    const directory = await temporaryDirectory();
    const fixture = fixtureById('C01');
    const manifestPath = await writeC01Artifact(directory, fixture, { resultSlideCount: 5 });
    const artifact = await loadUxArtifact(manifestPath);
    const report = runUxBench({
      registry,
      fixtures,
      artifacts: [artifact],
      selectedCaseIds: ['C01'],
    });

    expect(artifact.ok).toBe(true);
    expect(report.status).toBe(STATUS.FAIL);
    expect(report.cases[0].checks).toContainEqual(
      expect.objectContaining({ id: 'assertion-exactly-six-slides', status: STATUS.FAIL }),
    );
  });

  it('rejects bad evidence provenance and stale fixture bindings as UNSCORED', async () => {
    const fixture = fixtureById('C01');
    const badDigestDirectory = await temporaryDirectory();
    const badDigestPath = await writeC01Artifact(badDigestDirectory, fixture, {
      evidenceDigest: `sha256:${'0'.repeat(64)}`,
    });
    const badDigestArtifact = await loadUxArtifact(badDigestPath);
    const badDigestReport = runUxBench({
      registry,
      fixtures,
      artifacts: [badDigestArtifact],
      selectedCaseIds: ['C01'],
    });
    expect(badDigestArtifact.ok).toBe(false);
    expect(badDigestReport.status).toBe(STATUS.UNSCORED);
    expect(badDigestReport.cases[0].checks[0].id).toBe('artifact-provenance');

    const staleFixtureDirectory = await temporaryDirectory();
    const staleFixturePath = await writeC01Artifact(staleFixtureDirectory, fixture, {
      fixtureBinding: `sha256:${'f'.repeat(64)}`,
    });
    const staleFixtureArtifact = await loadUxArtifact(staleFixturePath);
    const staleFixtureReport = runUxBench({
      registry,
      fixtures,
      artifacts: [staleFixtureArtifact],
      selectedCaseIds: ['C01'],
    });
    expect(staleFixtureArtifact.ok).toBe(true);
    expect(staleFixtureReport.status).toBe(STATUS.UNSCORED);
    expect(staleFixtureReport.cases[0].checks).toContainEqual(
      expect.objectContaining({ id: 'fixture-binding', status: STATUS.UNSCORED }),
    );
  });

  it('writes deterministic reports idempotently and refuses replacement', async () => {
    const directory = await temporaryDirectory();
    const reportPath = path.join(directory, 'ux-report.json');
    const report = runUxBench({
      registry,
      fixtures,
      artifacts: [],
      selectedCaseIds: ['C01'],
    });

    await expect(writeDeterministicJson(reportPath, report)).resolves.toEqual({
      written: true,
      identical: false,
    });
    await expect(writeDeterministicJson(reportPath, report)).resolves.toEqual({
      written: false,
      identical: true,
    });
    await expect(
      writeDeterministicJson(reportPath, { ...report, artifactCount: 99 }),
    ).rejects.toThrow(/Refusing to overwrite/);
  });

  it('contains no network or model invocation path', async () => {
    const source = await readFile(new URL('../nodeslide-uxbench.mjs', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/openai|anthropic|gemini|openrouter/i);
  });
});

function fixtureById(id) {
  return fixtures.find((fixture) => fixture.id === id);
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-uxbench-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeC01Artifact(
  directory,
  fixture,
  { resultSlideCount = 6, evidenceDigest = null, fixtureBinding = null } = {},
) {
  const runId = 'run-c01-verified';
  const slides = Array.from({ length: resultSlideCount }, (_, index) => ({
    id: `slide-${index + 1}`,
    job: ['problem', 'product', 'traction', 'market', 'business model', 'next milestone'][index],
  }));
  const operations = [
    { id: 'op-deck', type: 'create_deck', scope: 'deck', targets: ['candidate-deck'] },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `op-slide-${index + 1}`,
      type: 'create_slide',
      scope: 'deck',
      targets: [`slide-${index + 1}`],
    })),
  ];
  const record = {
    schemaVersion: 'nodeslide-ux-run-record/v1',
    runId,
    caseId: fixture.id,
    request: fixture.request,
    operations,
    authority: {
      mode: fixture.expected.authority.mode,
      proposalRequired: fixture.expected.authority.proposalRequired,
      canonicalMutationBeforeReview: fixture.expected.authority.canonicalMutationBeforeReview,
      events: fixture.expected.authority.requiredEvents,
    },
    trace: fixture.trace.mustInclude.map((stage, sequence) => ({ sequence, stage })),
    forbiddenBehaviorsObserved: [],
    result: { deck: { slides } },
  };
  const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  const recordPath = path.join(directory, 'C01.run-record.json');
  await writeFile(recordPath, recordBytes);
  const manifest = {
    schemaVersion: 'nodeslide-ux-run-manifest/v1',
    artifactId: 'artifact-c01-verified',
    runId,
    caseId: fixture.id,
    fixtureDigest: fixtureBinding ?? fixtureDigest(fixture),
    provenance: {
      capturedAt: '2026-07-15T20:00:00.000Z',
      recorder: { name: 'nodeslide-test-recorder', version: '1.0.0' },
      sourceRevision: 'a'.repeat(40),
      environment: { name: 'vitest', mode: 'local' },
    },
    evidence: [
      {
        id: 'run-record',
        kind: 'run_record',
        path: 'C01.run-record.json',
        sha256: evidenceDigest ?? sha256(recordBytes),
        byteLength: recordBytes.byteLength,
        mediaType: 'application/json',
      },
    ],
  };
  const manifestPath = path.join(directory, 'C01.manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}
