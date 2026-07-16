import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../convex/lib/nodeslideSeed';
import {
  FIXED_LIVE_CASES,
  RepeatedLiveFailureGuard,
  assertArtifactSafe,
  buildBudgetRunRecord,
  buildCreateRunRecord,
  buildEditRunRecord,
  resolveProducerOutputDirectory,
  writeTasteArtifact,
  writeUxRunArtifact,
} from '../nodeslide-benchmark-producer-lib.mjs';
import { loadUxArtifact, sha256 } from '../nodeslide-uxbench.mjs';

const temporaryDirectories = [];
const sourceRevision = 'a'.repeat(40);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('NodeSlide live benchmark producer', () => {
  it('binds creation evidence to the exact corpus request and reports the current review gap', () => {
    const fixture = createFixture();
    const record = buildCreateRunRecord(fixture, createReceipt());

    expect(record.request.text).toBe(FIXED_LIVE_CASES.C01);
    expect(record.operations.filter(({ type }) => type === 'create_slide')).toHaveLength(6);
    expect(record.result.deck.slides.map(({ job }) => job)).toEqual([
      'Problem',
      'Product',
      'Traction',
      'Market',
      'Business model',
      'Next milestone',
    ]);
    expect(record.authority).toMatchObject({
      proposalRequired: false,
      canonicalMutationBeforeReview: true,
    });
    expect(record.forbiddenBehaviorsObserved).toEqual(['canonical_mutation_before_review']);
    expect(() =>
      buildCreateRunRecord(fixture, {
        ...createReceipt(),
        requestBinding: {
          requestDigest: 'sha256:request',
          userRequestDigest: sha256(Buffer.from('a different request', 'utf8')),
        },
      }),
    ).toThrow(/request binding/u);
  });

  it('projects one selected-element patch without leaking the owner capability', () => {
    const record = buildEditRunRecord(editFixture(), editReceipt());

    expect(record.request.text).toBe(FIXED_LIVE_CASES.E01);
    expect(record.operations).toEqual([
      expect.objectContaining({
        type: 'replace_text',
        scope: 'selected_element',
        targets: ['headline-problem'],
      }),
    ]);
    expect(record.authority).toMatchObject({
      proposalRequired: true,
      canonicalMutationBeforeReview: false,
    });
    expect(record.result).toMatchObject({
      before: { text: 'The problem' },
      after: { text: 'A costly problem investors can solve now' },
      changedElementIds: ['headline-problem'],
    });
    expect(JSON.stringify(record)).not.toContain('owner-secret');
  });

  it('materializes the canonical E01 selected headline from the deterministic seed', async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL('../../qa/nodeslide-agent-corpus/fixtures/E01.json', import.meta.url),
        'utf8',
      ),
    );
    const snapshot = buildGoldenNodeSlide('founder-roadshow-v1', 1).snapshot;
    const selected = snapshot.elements.find(({ id }) => id === fixture.setup.selectedElementIds[0]);

    expect(snapshot.deck.id).toBe('deck_golden_01be29i');
    expect(snapshot.deck.version).toBe(fixture.setup.context.canonicalBefore.deckVersion);
    expect(snapshot.slides[0].id).toBe(fixture.setup.activeSlideId);
    const expected = fixture.setup.context.canonicalBefore.element;
    expect(selected).toMatchObject({
      id: expected.id,
      version: expected.version,
      content: expected.text,
      sourceIds: expected.sourceIds,
      locked: expected.locked,
    });
  });

  it('turns the persisted one-dollar ledger into enforceable A05 evidence', () => {
    const record = buildBudgetRunRecord(budgetFixture(), budgetReceipt());

    expect(record.request.text).toBe(FIXED_LIVE_CASES.A05);
    expect(record.operations).toEqual([
      expect.objectContaining({ type: 'set_run_budget', scope: 'run' }),
    ]);
    expect(record.authority.events).toEqual(['budget_configured', 'budget_enforced']);
    expect(record.result.budget).toMatchObject({
      exposureMicroUsd: 125_000,
      exposureWithinCap: true,
      cap: { maxCostMicroUsd: 1_000_000 },
    });
    expect(record.trace.map(({ stage }) => stage)).toContain('budget_reservation');
    expect(record.trace.map(({ stage }) => stage)).toContain('budget_reconciliation');
  });

  it('writes hash-bound run and pixel manifests and rejects sensitive or fake evidence', async () => {
    const directory = await temporaryDirectory();
    const fixture = editFixture();
    const record = buildEditRunRecord(fixture, editReceipt());
    const written = await writeUxRunArtifact({
      outputDirectory: directory,
      fixture,
      record,
      sourceRevision,
      environment: { name: 'test', mode: 'local' },
      capturedAt: '2026-07-15T20:00:00.000Z',
    });
    const loaded = await loadUxArtifact(written.manifestPath);
    expect(loaded.ok).toBe(true);
    expect(loaded.record).toEqual(record);

    const pixels = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from('real-pixel-bytes'),
    ]);
    const taste = await writeTasteArtifact({
      outputDirectory: directory,
      caseId: 'E01',
      phase: 'before',
      slideId: 'slide-problem',
      state: { version: 7 },
      pixelBytes: pixels,
      width: 1280,
      height: 720,
      sourceRevision,
      capturedAt: '2026-07-15T20:00:01.000Z',
    });
    const manifestBytes = await readFile(taste.manifestPath);
    expect(sha256(manifestBytes)).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(taste.manifest.pixels[0]).toMatchObject({
      byteLength: pixels.byteLength,
      width: 1280,
      height: 720,
      mediaType: 'image/png',
    });

    expect(() => assertArtifactSafe({ ownerAccessKey: 'owner-secret' })).toThrow(/sensitive/u);
    await expect(
      writeTasteArtifact({
        outputDirectory: directory,
        caseId: 'E01',
        phase: 'after',
        slideId: 'slide-problem',
        state: {},
        pixelBytes: Buffer.from('not-an-image'),
        width: 1,
        height: 1,
        sourceRevision,
      }),
    ).rejects.toThrow(/real PNG/u);
  });

  it('constrains output paths and stops after two identical live failures', () => {
    const repo = path.resolve('D:/repo');
    expect(resolveProducerOutputDirectory(repo, 'benchmark-results/live')).toBe(
      path.resolve(repo, 'benchmark-results/live'),
    );
    expect(() => resolveProducerOutputDirectory(repo, '../outside')).toThrow(/inside/u);

    const guard = new RepeatedLiveFailureGuard();
    expect(guard.observe(new Error('Provider timeout 123'))).toBe('Provider timeout <n>');
    expect(() => guard.observe(new Error('Provider timeout 456'))).toThrow(/stopped after two/u);
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-producer-'));
  temporaryDirectories.push(directory);
  return directory;
}

function baseFixture(id, text) {
  return {
    schemaVersion: 'nodeslide-agent-fixture/v1',
    id,
    request: { text, attachmentIds: [], webResearch: false },
    setup: { selectedElementIds: [] },
  };
}

function createFixture() {
  return baseFixture('C01', FIXED_LIVE_CASES.C01);
}

function editFixture() {
  return {
    ...baseFixture('E01', FIXED_LIVE_CASES.E01),
    setup: { selectedElementIds: ['headline-problem'] },
  };
}

function budgetFixture() {
  return baseFixture('A05', FIXED_LIVE_CASES.A05);
}

function baseReceipt(jobId, kind = 'edit_proposal', requestText = FIXED_LIVE_CASES.E01) {
  return {
    job: { jobId, kind, status: 'awaiting_review' },
    requestBinding: {
      requestDigest: 'sha256:request',
      userRequestDigest: sha256(Buffer.from(requestText, 'utf8')),
    },
    capability: { provider: 'nebius', model: 'zai-org/GLM-5.2' },
    journal: [{ kind: 'model', operation: 'chat' }],
    telemetry: { spans: [{ operationName: 'plan_bounded_edit' }] },
  };
}

function createReceipt() {
  const slides = [
    'Problem',
    'Product',
    'Traction',
    'Market',
    'Business model',
    'Next milestone',
  ].map((title, index) => ({ id: `slide-${index + 1}`, title }));
  return {
    ...baseReceipt('job-create', 'create_deck', FIXED_LIVE_CASES.C01),
    job: { jobId: 'job-create', kind: 'create_deck', status: 'succeeded' },
    snapshot: {
      deck: { id: 'deck-created', version: 1 },
      slides,
      elements: [],
      validation: { ok: true },
    },
  };
}

function editReceipt() {
  return {
    ...baseReceipt('job-edit'),
    snapshot: {
      deck: { id: 'deck-created', version: 7 },
      slides: [{ id: 'slide-problem', job: 'Problem' }],
      elements: [{ id: 'headline-problem', content: 'The problem' }],
      validation: { ok: true },
    },
    patch: {
      id: 'patch-edit',
      status: 'ready',
      baseDeckVersion: 7,
      scope: {
        kind: 'elements',
        slideIds: ['slide-problem'],
        elementIds: ['headline-problem'],
      },
      operations: [
        {
          op: 'replace_text',
          slideId: 'slide-problem',
          elementId: 'headline-problem',
          text: 'A costly problem investors can solve now',
        },
      ],
      candidateValidation: { ok: true },
    },
  };
}

function budgetReceipt() {
  return {
    ...baseReceipt('job-budget', 'edit_proposal', FIXED_LIVE_CASES.A05),
    job: { jobId: 'job-budget', kind: 'edit_proposal', status: 'failed' },
    budget: {
      budgetId: 'budget-job',
      status: 'finalized',
      cap: { maxCostMicroUsd: 1_000_000 },
      spend: { actualMicroUsd: 100_000, reservedMicroUsd: 0, unreconciledMicroUsd: 25_000 },
      accumulated: {
        inputTokens: 10,
        outputTokens: 20,
        elapsedMs: 30,
        iterations: 1,
        toolCalls: 1,
      },
      events: [{ kind: 'reserved' }, { kind: 'unreconciled' }],
    },
  };
}
