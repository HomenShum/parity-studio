import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
const {
  runBoundary,
  ProducerOutcomeError,
  waitForRunReceipt,
  openGoldenSample,
  cleanupSyntheticC01,
  safeErrorClass,
} = loadProducerBoundary();

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

  it.each([
    { label: 'successful capture and cleanup', primary: false, cleanup: false },
    { label: 'failed capture with successful cleanup', primary: true, cleanup: false },
    { label: 'successful capture with failed cleanup', primary: false, cleanup: true },
    { label: 'failed capture and failed cleanup', primary: true, cleanup: true },
  ])('reports every outcome for the operator after $label', async (scenario) => {
    await verifyBoundaryScenario(scenario);
  });

  it('retains collected cases and an early stop when cleanup also fails', async () => {
    let cleanupCalls = 0;
    const outcome = await runBoundary(
      async (failures) => {
        failures.push(new ProducerOutcomeError('C01', 'UNSCORED', 'creation receipt unavailable'));
        failures.push(new ProducerOutcomeError('E01', 'UNSCORED', 'edit receipt unavailable'));
        throw new ProducerOutcomeError(
          'E01',
          'UNSCORED',
          'repeated identical live failure stopped the producer',
        );
      },
      async () => {
        cleanupCalls++;
        throw new ProducerOutcomeError(
          'C01',
          'FAIL',
          'synthetic deck cleanup could not recover the creation receipt',
        );
      },
    ).catch((error) => error);
    for (const stage of [
      'creation receipt unavailable',
      'edit receipt unavailable',
      'repeated identical live failure stopped the producer',
      'synthetic deck cleanup could not recover the creation receipt',
    ]) {
      expect(outcome.message).toContain(stage);
    }
    expect(cleanupCalls).toBe(1);
  });

  it('keeps unknown provider details out of the combined operator failure', async () => {
    const outcome = await runBoundary(
      async () => {
        throw new Error('synthetic-provider-body-private-marker');
      },
      async () => {
        throw new Error('synthetic-owner-capability-private-marker');
      },
    ).catch((error) => error);
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.message).toContain('the live producer was incomplete');
    expect(outcome.message).toContain('synthetic deck cleanup did not complete');
    expect(outcome.message).not.toContain('private-marker');
  });

  it('keeps concurrent operator runs isolated and awaits each cleanup exactly once', async () => {
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        verifyBoundaryScenario({
          primary: index % 2 === 0,
          cleanup: index % 3 === 0,
          label: `burst-${index}`,
        }),
      ),
    );
  });

  it('does not carry failures into later runs across sustained cleanup history', async () => {
    for (let index = 0; index < 500; index++) {
      await verifyBoundaryScenario({
        primary: index % 2 === 0,
        cleanup: index % 3 === 0,
        label: `history-${index}`,
      });
    }
  });

  it('distinguishes query and processing errors while preserving the two-failure stop', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic-private-provider-body'))
      .mockResolvedValueOnce({ job: null });
    const guard = new RepeatedLiveFailureGuard();
    const outcome = await waitForRunReceipt(
      { query },
      'C01',
      syntheticCapability(),
      guard,
      () => false,
      0,
    ).catch((error) => error);
    expect(query).toHaveBeenCalledTimes(2);
    expect(outcome).toBeInstanceOf(ProducerOutcomeError);
    expect(outcome.status).toBe('UNSCORED');
    expect(outcome.stage).toBe('repeated receipt query failure stopped the live run');
    expect(outcome.diagnostic).toBe('first=receipt_query:Error last=receipt_processing:TypeError');
    expect(outcome.message).not.toContain('private');
  });

  it('lets the operator receive a valid receipt after one transient query failure', async () => {
    const receipt = { job: { jobId: 'synthetic-job', status: 'awaiting_review' } };
    const query = vi.fn().mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(receipt);
    await expect(
      waitForRunReceipt(
        { query },
        'C01',
        syntheticCapability(),
        new RepeatedLiveFailureGuard(),
        () => true,
        0,
      ),
    ).resolves.toBe(receipt);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('attributes a readiness exception to processing rather than network failure', async () => {
    const query = vi.fn().mockResolvedValue({ job: { jobId: 'synthetic-job', status: 'running' } });
    const outcome = await waitForRunReceipt(
      { query },
      'C01',
      syntheticCapability(),
      new RepeatedLiveFailureGuard(),
      () => {
        throw new RangeError('synthetic-private-readiness-detail');
      },
      0,
    ).catch((error) => error);
    expect(query).toHaveBeenCalledTimes(2);
    expect(outcome.diagnostic).toBe(
      'first=receipt_processing:RangeError last=receipt_processing:RangeError',
    );
    expect(outcome.message).not.toContain('private');
  });

  it('omits private messages, data, causes, stacks and arbitrary error names', () => {
    const forbiddenRead = vi.fn(() => {
      throw new Error('synthetic-private-getter');
    });
    const unknown = Object.defineProperties(
      {},
      {
        name: { get: forbiddenRead },
        message: { get: forbiddenRead },
        data: { get: forbiddenRead },
        cause: { get: forbiddenRead },
        stack: { get: forbiddenRead },
      },
    );
    expect(safeErrorClass(unknown)).toBe('unknown');
    expect(forbiddenRead).not.toHaveBeenCalled();
    expect(
      safeErrorClass({ name: 'synthetic-private-name', message: 'private', data: 'private' }),
    ).toBe('unknown');
    expect(safeErrorClass(new Error('private'.repeat(200_000)))).toBe('Error');
    expect(
      safeErrorClass(new Proxy({}, { getOwnPropertyDescriptor: forbiddenRead })),
    ).toBe('unknown');
    expect(
      safeErrorClass(Object.assign(new Error('private'), { name: 'ConvexError', data: 'private' })),
    ).toBe('ConvexError');
    expect(safeErrorClass(Object.assign(new Error('private'), { name: 'TimeoutError' }))).toBe(
      'TimeoutError',
    );
    expect(safeErrorClass(Object.assign(new Error('private'), { name: 'AbortError' }))).toBe(
      'AbortError',
    );
  });

  it.each([
    'sample_navigation',
    'sample_session_reset',
    'sample_reload',
    'sample_landing_ready',
    'sample_session_check',
    'sample_button_ready',
    'sample_button_open',
    'sample_editor_ready',
    'sample_route_check',
  ])('tells the maintainer which golden-sample operation failed at %s', async (operation) => {
    const outcome = await openGoldenSample(syntheticGoldenPage(operation)).catch((error) => error);
    expect(outcome).toBeInstanceOf(ProducerOutcomeError);
    expect(outcome.status).toBe('UNSCORED');
    expect(outcome.stage).toBe('the deterministic golden sample was unavailable');
    expect(outcome.diagnostic).toContain(`operation=${operation} error=`);
    expect(outcome.diagnostic).not.toContain('private');
    expect(Buffer.byteLength(outcome.diagnostic, 'utf8')).toBeLessThanOrEqual(160);
  });

  it('opens the unchanged golden-sample path when every operation succeeds', async () => {
    await expect(openGoldenSample(syntheticGoldenPage())).resolves.toBe('synthetic-deck');
  });

  it('retains both failures and reaches no deletion after receipt recovery fails', async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error('synthetic-private-response')),
      mutation: vi.fn(),
    };
    const receiptFailureGuard = new RepeatedLiveFailureGuard();
    const job = syntheticCapability();
    const outcome = await runBoundary(
      () => waitForRunReceipt(client, 'C01', job, receiptFailureGuard, () => false, 0),
      () =>
        cleanupSyntheticC01({
          page: {},
          client,
          job,
          deck: null,
          dispatchAttempted: true,
          previousJobId: null,
          receiptFailureGuard,
        }),
    ).catch((error) => error);
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.mutation).not.toHaveBeenCalled();
    expect(outcome.message).toContain(
      'C01 UNSCORED (repeated receipt query failure stopped the live run)',
    );
    expect(outcome.message).toContain(
      'C01 FAIL (synthetic deck cleanup could not recover the creation receipt)',
    );
    expect(outcome.message).toContain('first=receipt_query:Error last=receipt_query:Error');
    expect(outcome.message).not.toContain('private');
    expect(Buffer.byteLength(outcome.message, 'utf8')).toBeLessThan(1024);
  });

  it('isolates receipt diagnostics across a burst of 100 operator runs', async () => {
    await Promise.all(Array.from({ length: 100 }, () => verifyReceiptDiagnosticScenario()));
  });

  it('retains no prior-run error payload across 500 sustained operator runs', async () => {
    for (let index = 0; index < 500; index++) await verifyReceiptDiagnosticScenario();
  });
});

async function verifyBoundaryScenario({ primary, cleanup, label }) {
  let cleanupCalls = 0;
  const outcome = await runBoundary(
    async (failures) => {
      if (primary)
        failures.push(new ProducerOutcomeError('C01', 'UNSCORED', `${label} receipt unavailable`));
    },
    async () => {
      cleanupCalls++;
      await Promise.resolve();
      if (cleanup) throw new ProducerOutcomeError('C01', 'FAIL', `${label} cleanup unavailable`);
    },
  ).catch((error) => error);
  expect(cleanupCalls).toBe(1);
  if (!primary && !cleanup) {
    expect(outcome).toBeUndefined();
    return;
  }
  expect(outcome).toBeInstanceOf(Error);
  expect(outcome.message.includes(`${label} receipt unavailable`)).toBe(primary);
  expect(outcome.message.includes(`${label} cleanup unavailable`)).toBe(cleanup);
}

function syntheticCapability() {
  return {
    jobId: 'synthetic-job',
    ownerAccessKey: 'synthetic-private-owner-capability',
    kind: 'create_deck',
    deckId: null,
  };
}

async function verifyReceiptDiagnosticScenario() {
  const query = vi.fn().mockRejectedValue(new Error('synthetic-private-response'));
  const outcome = await waitForRunReceipt(
    { query },
    'C01',
    syntheticCapability(),
    new RepeatedLiveFailureGuard(),
    () => false,
    0,
  ).catch((error) => error);
  expect(query).toHaveBeenCalledTimes(2);
  expect(outcome.status).toBe('UNSCORED');
  expect(outcome.diagnostic).toBe('first=receipt_query:Error last=receipt_query:Error');
  expect(Buffer.byteLength(outcome.diagnostic, 'utf8')).toBeLessThanOrEqual(160);
  expect(outcome.diagnostic).not.toContain('private');
}

function syntheticGoldenPage(failureOperation) {
  let evaluations = 0;
  const perform = async (operation, value) => {
    if (operation === failureOperation) {
      throw Object.assign(new Error('synthetic-private-browser-payload'), { name: 'TimeoutError' });
    }
    return value;
  };
  return {
    goto: () => perform('sample_navigation'),
    evaluate: () => {
      evaluations++;
      if (evaluations === 1) return perform('sample_session_reset');
      return Promise.resolve(
        failureOperation === 'sample_session_check'
          ? 'synthetic-private-wrong-session'
          : 'founder-roadshow-v1',
      );
    },
    reload: () => perform('sample_reload'),
    getByTestId: (id) => ({
      waitFor: () =>
        perform(id === 'nodeslide-landing' ? 'sample_landing_ready' : 'sample_editor_ready'),
    }),
    getByRole: () => ({
      waitFor: () => perform('sample_button_ready'),
      click: () => perform('sample_button_open'),
    }),
    url: () =>
      failureOperation === 'sample_route_check'
        ? 'https://example.invalid/'
        : 'https://example.invalid/?deck=synthetic-deck',
  };
}

function loadProducerBoundary() {
  // Run the real reporting boundary without importing live browser/provider code.
  // Only case operations and cleanup are replaced; catches, finally and summary stay intact.
  const filename = new URL(
    '../../tests/e2e/nodeslide-benchmark-producer.live.spec.ts',
    import.meta.url,
  );
  const source = readFileSync(filename, 'utf8');
  const tree = ts.createSourceFile(filename.pathname, source, ts.ScriptTarget.Latest, true);
  let callback;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === 'test' &&
      node.arguments[0]?.text === 'captures C01, A05, and E01 without retaining live credentials'
    ) {
      callback = node.arguments[1];
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const boundary = callback.body.statements.find(ts.isTryStatement);
  const summary = boundary.tryBlock.statements
    .filter(
      (node) => ts.isIfStatement(node) && node.expression.getText(tree) === 'failures.length > 0',
    )
    .map((node) => node.getText(tree))
    .join('\n');
  const runSource = `${source.slice(boundary.getStart(tree), boundary.tryBlock.getStart(tree) + 1)}
await exercise(failures);
${summary}
${source.slice(boundary.tryBlock.end - 1, boundary.end)}`;
  const after = callback.body.statements
    .filter((node) => node.pos >= boundary.end)
    .map((node) => node.getText(tree))
    .join('\n');
  const constants = tree.statements
    .filter(ts.isVariableStatement)
    .filter((node) =>
      node.declarationList.declarations.some((declaration) =>
        [
          'LIVE_RECEIPT_TIMEOUT_MS',
          'ACTIVE_JOB_STATUSES',
          'SESSION_ID_KEY',
          'GOLDEN_SESSION_ID',
        ].includes(declaration.name.getText(tree)),
      ),
    )
    .map((node) => node.getText(tree))
    .join('\n');
  const helpers = tree.statements
    .filter((node) =>
      [
        'ProducerOutcomeError',
        'asProducerOutcome',
        'safeErrorClass',
        'waitForRunReceipt',
        'isSettledReceipt',
        'openGoldenSample',
        'cleanupSyntheticC01',
      ].includes(node.name?.text),
    )
    .map((node) => node.getText(tree))
    .join('\n');
  const compiled = ts.transpileModule(
    `${constants}\n${helpers}\nasync function runBoundary(exercise, cleanupSyntheticC01) {
    const failures = [];
    const page = {}, convexClient = null, c01Job = null, c01Deck = null;
    const c01DispatchAttempted = false, c01PreviousJobId = null, receiptFailureGuard = {};
    ${runSource}\n${after}
  }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return new Function(
    'api',
    'delay',
    `${compiled}\nreturn {
      runBoundary,
      ProducerOutcomeError,
      waitForRunReceipt,
      openGoldenSample,
      cleanupSyntheticC01,
      safeErrorClass,
    };`,
  )(
    {
      nodeslideJobs: { getRunReceipt: 'synthetic-receipt' },
      nodeslide: { deleteDeck: 'synthetic-delete', getWorkspace: 'synthetic-workspace' },
    },
    () => Promise.resolve(),
  );
}

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
