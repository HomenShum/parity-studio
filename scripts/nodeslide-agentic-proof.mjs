import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const FIXED_NOW = Date.parse('2026-07-11T12:00:00.000Z');
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(rootDirectory, 'docs', 'dogfood', 'nodeslide-agentic-authoring');

const scenarios = [
  {
    id: 'founder',
    title: 'NodeSlide — Founder launch narrative',
    themeId: 'editorial-signal',
    brief: {
      prompt:
        'Explain why NodeSlide turns presentation creation into a living, inspectable, source-aware system while keeping every consequential change reviewable.',
      audience: 'founders and design-forward operators evaluating the private preview',
      purpose: 'earn confidence for a bounded private-preview launch',
      successCriteria: [
        'Make the product wedge memorable',
        'Show the human-review boundary',
        'State the controlled launch decision clearly',
      ],
    },
  },
  {
    id: 'investor',
    title: 'NodeSlide — Investor strategy brief',
    themeId: 'quiet-precision',
    brief: {
      prompt:
        'Present NodeSlide as infrastructure for editable, source-grounded presentation workflows, separating demonstrated product capability from future market hypotheses.',
      audience: 'seed investors and strategic partners',
      purpose: 'support a rigorous product and market diligence conversation',
      successCriteria: [
        'Separate proof from hypothesis',
        'Make defensibility inspectable',
        'End with the next diligence milestone',
      ],
    },
  },
  {
    id: 'technical',
    title: 'NodeSlide — Agentic authoring architecture',
    themeId: 'night-briefing',
    brief: {
      prompt:
        'Explain the provider-neutral Deck REPL, immutable snapshot and compare-and-set model, bounded analysis kernels, render-observe-repair loop, and hard launch gates.',
      audience: 'senior engineers, security reviewers, and technical product leaders',
      purpose: 'make the architecture and safety boundary independently reviewable',
      successCriteria: [
        'Trace authority from intent to patch',
        'Show default-deny execution controls',
        'Preserve the public multi-tenant no-go boundary',
      ],
    },
  },
];

const vite = await createServer({
  appType: 'custom',
  root: rootDirectory,
  server: { hmr: false, middlewareMode: true },
});

try {
  const seed = await vite.ssrLoadModule('/convex/lib/nodeslideSeed.ts');
  const ids = await vite.ssrLoadModule('/convex/lib/nodeslideIds.ts');
  const validationModule = await vite.ssrLoadModule('/convex/lib/nodeslideValidation.ts');
  const deckRepl = await vite.ssrLoadModule('/convex/lib/nodeslideDeckRepl.ts');
  const editPlanner = await vite.ssrLoadModule('/convex/lib/nodeslideEditPlanner.ts');
  const editShadowPlanner = await vite.ssrLoadModule('/convex/lib/nodeslideEditShadowPlanner.ts');
  const executionTrace = await vite.ssrLoadModule('/convex/lib/nodeslideExecutionTrace.ts');
  const telemetry = await vite.ssrLoadModule('/convex/lib/nodeslideAgenticTelemetry.ts');
  const controlsModule = await vite.ssrLoadModule('/convex/lib/nodeslideAgenticControls.ts');
  const kernelModule = await vite.ssrLoadModule('/convex/lib/nodeslideAnalysisKernel.ts');
  const managedKernelModule = await vite.ssrLoadModule('/convex/lib/nodeslideManagedKernel.ts');
  const repairModule = await vite.ssrLoadModule('/convex/lib/nodeslideRenderRepairLoop.ts');
  const patchModule = await vite.ssrLoadModule('/convex/lib/nodeslidePatches.ts');
  const storyBenchModule = await vite.ssrLoadModule('/convex/lib/nodeslideStoryBench.ts');
  const shadowComparisonModule = await vite.ssrLoadModule(
    '/convex/lib/nodeslideShadowComparison.ts',
  );
  const tasteModule = await vite.ssrLoadModule('/convex/lib/nodeslideTasteMismatch.ts');
  const tastePacks = await vite.ssrLoadModule('/src/domains/nodeslide/signature/packs/index.ts');
  const slideLang = await vite.ssrLoadModule('/src/domains/nodeslide/slidelang/index.ts');
  const shadowControls = controlsModule.resolveNodeSlideAgenticControls({
    NODESLIDE_AGENTIC_GLOBAL_ENABLED: 'true',
    NODESLIDE_AGENTIC_SHADOW_ENABLED: 'true',
  });

  await mkdir(outputDirectory, { recursive: true });
  const artifacts = [];
  const outcomes = new Map();
  const traces = [];
  const shadowComparisons = [];

  for (const [index, scenario] of scenarios.entries()) {
    const built = seed.buildBriefNodeSlide({
      deckId: `deck_agentic_${scenario.id}`,
      projectId: `project_agentic_${scenario.id}`,
      title: scenario.title,
      brief: scenario.brief,
      themeId: scenario.themeId,
      now: FIXED_NOW,
    });
    const snapshot = built.snapshot;
    const validation = validationModule.validateNodeSlideSnapshot(
      snapshot,
      FIXED_NOW,
      `validation_agentic_${scenario.id}`,
    );
    const html = slideLang.renderDeckHtml(snapshot);
    const pptxBinary = await slideLang.buildPptx(snapshot);
    const pptx = Buffer.from(
      pptxBinary instanceof ArrayBuffer
        ? new Uint8Array(pptxBinary)
        : pptxBinary instanceof Uint8Array
          ? pptxBinary
          : new Uint8Array(await pptxBinary.arrayBuffer()),
    );
    const htmlName = `${scenario.id}.html`;
    const pptxName = `${scenario.id}.pptx`;
    await writeFile(path.join(outputDirectory, htmlName), html, 'utf8');
    await writeFile(path.join(outputDirectory, pptxName), pptx);

    const target = snapshot.elements.find(
      (element) => element.kind === 'text' && !element.locked && element.content,
    );
    assert(target, `${scenario.id} deck has no editable text target.`);
    const comparisonInstruction = 'Rewrite the selected text as "Independent shadow candidate".';
    const comparisonRequest = {
      instruction: comparisonInstruction,
      deckId: snapshot.deck.id,
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: Object.fromEntries(
        snapshot.slides.map((slide) => [slide.id, slide.version]),
      ),
      baseElementVersions: Object.fromEntries(
        snapshot.elements.map((element) => [element.id, element.version]),
      ),
      scope: {
        kind: 'elements',
        deckId: snapshot.deck.id,
        slideIds: [target.slideId],
        elementIds: [target.id],
        operationMode: 'copy',
      },
    };
    const baselinePlan = await editPlanner.planNodeSlideEdit(
      { snapshot, scopedComment: null, request: comparisonRequest },
      {
        callProvider: async () => ({
          ok: false,
          reason: 'Deterministic proof route; no provider contacted.',
        }),
      },
    );
    assert(baselinePlan.ok, `${scenario.id} baseline planner did not produce.`);
    const command = {
      id: `proposal-${scenario.id}`,
      type: 'propose_patch',
      baseDeckVersion: comparisonRequest.baseDeckVersion,
      baseSlideVersions: comparisonRequest.baseSlideVersions,
      baseElementVersions: comparisonRequest.baseElementVersions,
      scope: comparisonRequest.scope,
      operations: baselinePlan.operations,
    };
    const replResult = deckRepl.runNodeSlideDeckRepl({
      sessionId: `agentic-proof-${scenario.id}`,
      traceId: `trace-agentic-${scenario.id}`,
      snapshot,
      expectedSnapshotDigest: deckRepl.nodeSlideSnapshotDigest(snapshot),
      commands: [{ id: `inspect-${scenario.id}`, type: 'inspect_deck' }, command],
      now: () => FIXED_NOW,
    });
    assert(replResult.terminalReason === 'completed', `${scenario.id} Deck REPL did not complete.`);
    assert(
      replResult.proposals.length === 1,
      `${scenario.id} Deck REPL did not return one proposal.`,
    );
    const candidatePlan = editShadowPlanner.planNodeSlideEditShadow({
      snapshot,
      ...comparisonRequest,
    });
    assert(candidatePlan.outcome === 'ready', `${scenario.id} shadow planner did not produce.`);
    const candidateResult = deckRepl.runNodeSlideDeckRepl({
      sessionId: `paired-shadow-${scenario.id}`,
      traceId: `paired-shadow-trace-${scenario.id}`,
      snapshot,
      expectedSnapshotDigest: deckRepl.nodeSlideSnapshotDigest(snapshot),
      commands: [candidatePlan.command],
      now: () => FIXED_NOW,
    });
    assert(
      candidateResult.terminalReason === 'completed' && candidateResult.proposals.length === 1,
      `${scenario.id} paired shadow candidate did not validate.`,
    );
    const patchId = ids.nodeslideStableId('patch_proof', scenario.id);
    const pairedReceipt = shadowComparisonModule.createNodeSlideShadowComparison({
      id: ids.nodeslideStableId('shadow_comparison', patchId),
      deckId: snapshot.deck.id,
      actorSubject: `ephemeral-proof-owner-${scenario.id}`,
      turnId: ids.nodeslideStableId('turn', patchId),
      baselinePatchId: patchId,
      baselineTraceId: ids.nodeslideStableId('trace', patchId),
      turnInputDigest: shadowComparisonModule.nodeSlideEditTurnInputDigest(comparisonRequest),
      baseSnapshotDigest: deckRepl.nodeSlideSnapshotDigest(snapshot),
      baseDeckVersion: snapshot.deck.version,
      controlsDigest: shadowControls.controlsDigest,
      baseline: {
        adapterId: 'nodeslide/single-shot-edit-planner',
        adapterVersion: '1.0.0',
        origin: baselinePlan.receipt.origin,
        outcome: 'proposed',
        terminalReason: 'completed',
        proposalDigest: deckRepl.nodeSlideOperationDigest(command.operations),
        operationCount: command.operations.length,
        elapsedMs: 0,
      },
      candidate: {
        adapterId: candidatePlan.adapterId,
        adapterVersion: candidatePlan.adapterVersion,
        outcome: 'proposed',
        terminalReason: 'completed',
        proposalDigest: candidateResult.proposals[0].operationDigest,
        operationCount: candidateResult.proposals[0].operations.length,
        elapsedMs: 0,
      },
      createdAt: FIXED_NOW + index,
      completedAt: FIXED_NOW + index,
    });
    assert(
      pairedReceipt.candidateExposed === false && pairedReceipt.candidateCommitted === false,
      `${scenario.id} paired shadow authority invariant failed.`,
    );
    assert(
      !JSON.stringify(pairedReceipt).includes('Independent shadow candidate'),
      `${scenario.id} paired receipt leaked candidate content.`,
    );
    shadowComparisons.push(pairedReceipt);
    const trace = executionTrace.executionTraceFromDeckRepl({
      result: replResult,
      deckId: snapshot.deck.id,
      actorSubject: `ephemeral-proof-owner-${scenario.id}`,
      createdAt: FIXED_NOW + index,
      cohort: 'local-ci-reference',
      controlsDigest: shadowControls.controlsDigest,
    });
    traces.push(trace);

    const snapshotDigest = deckRepl.nodeSlideSnapshotDigest(snapshot);
    const taste = tasteModule.evaluateNodeSlideTasteMismatch({
      snapshot,
      profile: tastePacks.STARTUP_NARRATIVE_TASTE_PACK,
      renderDigest: `render_${ids.nodeslideContentDigest(html)}`,
      maxRepairOperations: 128,
    });
    const quality = qualityScores(snapshot, validation);
    const sourceIds = new Set(snapshot.sources.map((source) => source.id));
    const noSecretLeak = !/(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}/i.test(
      JSON.stringify({ replResult, trace, taste }),
    );
    const outcome = {
      status: 'completed',
      scores: quality,
      safety: {
        scopeSafe: replResult.proposals.length === 1,
        versionSafe: replResult.baseDeckVersion === snapshot.deck.version,
        noSecretLeak,
        noUnauthorizedEgress: trace.egressMode === 'deny' && trace.allowedHosts.length === 0,
        artifactSafe:
          pptx.subarray(0, 2).toString('ascii') === 'PK' &&
          snapshot.elements.every((element) => element.sourceIds.every((id) => sourceIds.has(id))),
        cleanupConfirmed: trace.cleanupConfirmed,
      },
      metrics: {
        latencyMs: replResult.usage.elapsedMs,
        costMicroUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        steps: replResult.usage.steps,
      },
      evidenceDigests: [snapshotDigest, trace.traceDigest, taste.receiptDigest],
    };
    outcomes.set(scenario.id, outcome);
    artifacts.push({
      id: scenario.id,
      title: scenario.title,
      deckId: snapshot.deck.id,
      deckVersion: snapshot.deck.version,
      slides: snapshot.slides.length,
      elements: snapshot.elements.length,
      sources: snapshot.sources.length,
      snapshotDigest,
      validation: {
        ok: validation.ok,
        cleanOk: validation.cleanOk,
        publishOk: validation.publishOk,
        issueCounts: countBy(validation.issues.map((issue) => issue.code)),
      },
      deckRepl: {
        terminalReason: replResult.terminalReason,
        steps: replResult.usage.steps,
        proposals: replResult.proposals.length,
        operations: replResult.usage.operations,
        egressMode: trace.egressMode,
        traceDigest: trace.traceDigest,
      },
      taste: {
        receiptDigest: taste.receiptDigest,
        violationCounts: taste.violationCounts,
        repairStatus: taste.repair.status,
        repairOperations: taste.repair.candidateOperationCount,
        blockers: taste.repair.blockers,
      },
      html: {
        file: htmlName,
        bytes: Buffer.byteLength(html),
        slideRegions: count(html, /data-slide-id=/g),
      },
      pptx: {
        file: pptxName,
        bytes: pptx.byteLength,
        zipSignature: pptx.subarray(0, 2).toString('ascii'),
      },
    });
  }

  const storyCases = scenarios.map((scenario, index) => ({
    id: scenario.id,
    title: scenario.title,
    source: {
      id: `nodeslide-internal-${scenario.id}`,
      title: `${scenario.title} internal evaluation fixture`,
      url: 'https://github.com/HomenShum/parity-studio',
      license: 'Author-owned internal evaluation fixture; redistribution restricted',
      tier: 'A',
      redistribution: 'restricted',
      verifiedAt: '2026-07-11',
    },
    materialMode: 'reference',
    fixtureDigest: artifacts[index].snapshotDigest,
    rubric: {},
    budgets: {
      maxLatencyMs: 5_000,
      maxCostMicroUsd: 1,
      maxInputTokens: 1,
      maxOutputTokens: 1,
      maxSteps: 8,
    },
    tags: ['internal', scenario.id, 'private-preview'],
  }));
  const baselineAdapter = {
    id: 'nodeslide/single-shot-reference',
    version: '1.0.0',
    execute: (testCase) => structuredClone(outcomes.get(testCase.id)),
  };
  const candidateAdapter = {
    id: 'nodeslide/deck-repl-shadow',
    version: '1.0.0',
    execute: (testCase) => structuredClone(outcomes.get(testCase.id)),
  };
  const storyBench = storyBenchModule.runNodeSlideStoryBench({
    suiteId: 'nodeslide-private-preview-reference-2026-07-11',
    cases: storyCases,
    adapters: [baselineAdapter, candidateAdapter],
  });
  const comparison = storyBenchModule.compareNodeSlideStoryBench(
    storyBench,
    baselineAdapter.id,
    candidateAdapter.id,
    { minimumCases: 3, minimumMeanImprovement: 0.02, maximumDimensionRegression: 0.03 },
  );
  assert(storyBench.provenancePassed, 'StoryBench provenance did not pass.');
  assert(comparison.decision === 'hold', 'An evidence-identical candidate must remain on hold.');

  const kernel = kernelModule.createDeterministicNodeSlideKernel();
  const kernelConformance = kernelModule.runNodeSlideKernelConformance(kernel);
  const kernelResult = kernelModule.runNodeSlideAnalysisKernel({
    adapter: kernel,
    request: {
      sessionId: 'agentic-proof-analysis',
      traceId: 'agentic-proof-analysis-trace',
      job: { type: 'derive_series', operation: 'percent_change', values: [100, 125, 150] },
    },
    now: () => FIXED_NOW,
  });
  assert(kernelConformance.passed, 'Deterministic analysis kernel failed conformance.');
  assert(
    kernelResult.terminalReason === 'completed',
    'Deterministic analysis job did not complete.',
  );
  assert(kernelResult.cleanupConfirmed, 'Deterministic analysis cleanup was not confirmed.');

  const managedKernelControls = controlsModule.resolveNodeSlideAgenticControls({
    NODESLIDE_AGENTIC_GLOBAL_ENABLED: 'true',
    NODESLIDE_AGENTIC_SHADOW_ENABLED: 'true',
    NODESLIDE_AGENTIC_KERNEL_ENABLED: 'true',
    NODESLIDE_AGENTIC_KERNEL_ALLOWLIST: 'openai/code-interpreter',
  });
  let managedCleanupCalled = false;
  const managedAdapter = managedKernelModule.createOpenAiCodeInterpreterKernelAdapter({
    model: 'gpt-5-fixture-no-provider',
    transport: {
      open: async ({ signal }) => {
        assert(!signal.aborted, 'Managed kernel opened with an aborted deadline.');
        return { opaqueSessionId: 'ephemeral-managed-proof-session' };
      },
      execute: async (_session, _job, { signal }) => {
        assert(!signal.aborted, 'Managed kernel executed with an aborted deadline.');
        return {
          output: { values: [0, 25, 20] },
          steps: 3,
          telemetry: {
            provider: 'openai',
            resolvedModel: 'gpt-5-fixture-no-provider',
            inputTokens: 0,
            outputTokens: 0,
            costMicroUsd: 0,
            latencyMs: 0,
            retries: 0,
            fallbackUsed: false,
          },
        };
      },
      cancel: async () => undefined,
      cleanup: async () => {
        managedCleanupCalled = true;
      },
    },
  });
  const managedKernelResult = await managedKernelModule.runNodeSlideManagedKernel({
    adapter: managedAdapter,
    request: {
      sessionId: 'agentic-proof-managed-analysis',
      traceId: 'agentic-proof-managed-analysis-trace',
      job: { type: 'derive_series', operation: 'percent_change', values: [100, 125, 150] },
    },
    controls: managedKernelControls,
    now: () => FIXED_NOW,
  });
  assert(
    managedKernelResult.terminalReason === 'completed',
    'Injected managed-kernel seam did not complete.',
  );
  assert(managedKernelResult.network.mode === 'deny', 'Managed-kernel proof allowed egress.');
  assert(
    managedKernelResult.cleanupConfirmed && managedCleanupCalled,
    'Managed-kernel cleanup was not confirmed.',
  );

  const repairFixture = seed.buildGoldenNodeSlide('agentic-repair-proof', FIXED_NOW).snapshot;
  const repairTarget = repairFixture.elements.find(
    (element) => element.kind === 'text' && !element.locked && element.content,
  );
  assert(repairTarget, 'Repair proof has no editable target.');
  const repairedText = 'Bounded render repair proof';
  const renderRepair = repairModule.runNodeSlideRenderRepairLoop({
    base: repairFixture,
    expectedBaseDigest: deckRepl.nodeSlideSnapshotDigest(repairFixture),
    budget: { maxAttempts: 1 },
    callbacks: {
      validate: (snapshot) => ({
        clean:
          snapshot.elements.find((element) => element.id === repairTarget.id)?.content ===
          repairedText,
        safetyPassed: true,
        issues: [],
      }),
      render: ({ snapshotDigest }) => ({ artifact: { snapshotDigest }, bytes: 128 }),
      observe: () => ({
        clean: false,
        observations: [
          { code: 'overflow', severity: 'error', message: 'Bounded proof observation.' },
        ],
      }),
      proposeRepair: (request) => {
        const operation = {
          op: 'replace_text',
          slideId: repairTarget.slideId,
          elementId: repairTarget.id,
          text: repairedText,
        };
        return {
          deckId: request.snapshot.deck.id,
          baseDeckVersion: request.snapshot.deck.version,
          ...patchModule.clocksForNodeSlideOperations(request.snapshot, [operation]),
          scope: {
            kind: 'elements',
            deckId: request.snapshot.deck.id,
            slideIds: [repairTarget.slideId],
            elementIds: [repairTarget.id],
            operationMode: 'copy',
          },
          operations: [operation],
        };
      },
    },
    now: () => FIXED_NOW,
  });
  assert(renderRepair.terminalReason === 'clean', 'Bounded repair loop did not reach clean state.');
  assert(renderRepair.usage.attempts === 1, 'Repair proof did not use exactly one attempt.');

  const closedControls = controlsModule.resolveNodeSlideAgenticControls({});
  const closedAuthorization = controlsModule.authorizeNodeSlideAgenticOperation(closedControls, {
    operation: 'deck_repl_shadow',
  });
  const shadowAuthorization = controlsModule.authorizeNodeSlideAgenticOperation(shadowControls, {
    operation: 'deck_repl_shadow',
  });
  const publicationAuthorization = controlsModule.authorizeNodeSlideAgenticOperation(
    shadowControls,
    {
      operation: 'publication',
    },
  );
  assert(!closedAuthorization.allowed, 'Absent controls did not fail closed.');
  assert(shadowAuthorization.allowed, 'Explicit local shadow controls did not authorize R1.');
  assert(!publicationAuthorization.allowed, 'Agentic publication was not independently closed.');

  const telemetrySummary = telemetry.summarizeNodeSlideExecutionTraces(traces);
  const switchProof = await readSwitchProof();
  const switchExercise = switchProof?.switchExercise;
  const stagingSwitchReady = Boolean(
    switchProof?.deployment === 'isolated-staging' &&
      switchProof?.productionTouched === false &&
      switchExercise?.disabledBefore === true &&
      switchExercise?.enabledCompleted === true &&
      switchExercise?.candidateExposed === false &&
      switchExercise?.candidateCommitted === false &&
      switchExercise?.pairedComparisonPersisted === true &&
      switchExercise?.pairedCandidateExposed === false &&
      switchExercise?.pairedCandidateCommitted === false &&
      switchExercise?.disabledAfter === true &&
      switchExercise?.rollbackConfirmed === true,
  );
  const proof = {
    schemaVersion: 'nodeslide.agentic-proof/v1',
    generatedAt: new Date().toISOString(),
    deterministicFixtureTime: new Date(FIXED_NOW).toISOString(),
    route: 'local-ci-reference-no-provider',
    scope: 'controlled-private-preview-r1-shadow',
    artifacts,
    controls: {
      closedControlsDigest: closedControls.controlsDigest,
      closedAuthorization,
      shadowControlsDigest: shadowControls.controlsDigest,
      shadowAuthorization,
      publicationAuthorization,
      networkEgress: shadowControls.networkEgress,
      automaticContinuation: shadowControls.automaticContinuation,
    },
    telemetry: telemetrySummary,
    stagingSwitchProof: switchProof,
    pairedEditShadow: shadowComparisons,
    kernel: {
      adapterId: kernel.id,
      adapterVersion: kernel.version,
      conformance: kernelConformance,
      terminalReason: kernelResult.terminalReason,
      network: kernelResult.network,
      cleanupConfirmed: kernelResult.cleanupConfirmed,
      outputDigest: kernelResult.outputDigest,
    },
    managedKernelSeam: {
      providerContacted: false,
      transport: 'injected-fixture-no-provider',
      adapterId: managedAdapter.id,
      adapterVersion: managedAdapter.version,
      terminalReason: managedKernelResult.terminalReason,
      network: managedKernelResult.network,
      cleanupConfirmed: managedKernelResult.cleanupConfirmed,
      outputDigest: managedKernelResult.outputDigest,
    },
    renderRepair: {
      terminalReason: renderRepair.terminalReason,
      attempts: renderRepair.usage.attempts,
      operations: renderRepair.usage.operations,
      baseSnapshotDigest: renderRepair.baseSnapshotDigest,
      candidateSnapshotDigest: renderRepair.candidateSnapshotDigest,
    },
    storyBench: {
      report: storyBench,
      comparison,
    },
    verdict: {
      r0LocalReference: 'GO',
      r1PrivatePreviewShadow: stagingSwitchReady ? 'GO' : 'GO_AFTER_STAGING_SWITCH_EXERCISE',
      r2ReviewedAgenticProposals: 'HOLD',
      publicMultiTenant: 'NO_GO',
      rationale: stagingSwitchReady
        ? 'The isolated staging switch and rollback passed without exposing or committing a shadow candidate. R2 remains on hold because the matched candidate is StoryBench-score-identical to baseline; public identity, lifecycle, tenancy, and managed-kernel gates remain unresolved.'
        : 'The candidate is safety-clean and StoryBench-score-identical to baseline, so promotion remains on hold; public identity, lifecycle, tenancy, and managed-kernel gates remain unresolved.',
    },
  };
  await writeFile(
    path.join(outputDirectory, 'agentic-proof.json'),
    `${JSON.stringify(proof, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify({ outputDirectory, verdict: proof.verdict }, null, 2)}\n`);
} finally {
  await vite.close();
}

async function readSwitchProof() {
  try {
    return JSON.parse(
      await readFile(path.join(outputDirectory, 'local-switch-proof.json'), 'utf8'),
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function qualityScores(snapshot, validation) {
  const sourceIds = new Set(snapshot.sources.map((source) => source.id));
  const sourced = snapshot.elements.filter((element) =>
    element.sourceIds.every((sourceId) => sourceIds.has(sourceId)),
  ).length;
  const editable = snapshot.elements.filter((element) =>
    element.exportCapabilities.includes('pptx_editable'),
  ).length;
  const coherentSlides = snapshot.slides.filter(
    (slide) => slide.title.trim() && slide.section?.trim() && slide.notes?.trim(),
  ).length;
  const errors = validation.issues.filter((issue) => issue.severity === 'error').length;
  const warnings = validation.issues.filter((issue) => issue.severity === 'warning').length;
  return {
    taskCompletion: snapshot.slides.length === 7 ? 1 : ratio(snapshot.slides.length, 7),
    narrativeCoherence: ratio(coherentSlides, snapshot.slides.length),
    evidenceLineage: ratio(sourced, snapshot.elements.length),
    editability: ratio(editable, snapshot.elements.length),
    visualIntegrity: Math.max(0, 1 - errors * 0.2 - warnings * 0.03),
    versionSafety:
      Number.isSafeInteger(snapshot.deck.version) &&
      snapshot.slides.every((slide) => Number.isSafeInteger(slide.version)) &&
      snapshot.elements.every((element) => Number.isSafeInteger(element.version))
        ? 1
        : 0,
  };
}

function ratio(numerator, denominator) {
  if (denominator <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, numerator / denominator)) * 10_000) / 10_000;
}

function count(value, pattern) {
  return (value.match(pattern) ?? []).length;
}

function countBy(values) {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((candidate) => candidate === value).length]),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
