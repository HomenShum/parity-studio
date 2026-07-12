import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

const execFileAsync = promisify(execFile);
const DEPLOYMENT = 'anonymous:anonymous-parity-studio';
const CONVEX_URL = 'http://127.0.0.1:3210';
const FLAGS = ['NODESLIDE_AGENTIC_GLOBAL_ENABLED', 'NODESLIDE_AGENTIC_SHADOW_ENABLED'];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(rootDirectory, 'docs', 'dogfood', 'nodeslide-agentic-authoring');
const outputPath = path.join(outputDirectory, 'local-switch-proof.json');

const client = new ConvexHttpClient(CONVEX_URL);
let workspace;
let disabledBefore = false;
let disabledAfter = false;

try {
  await setFlags(false);
  workspace = await client.mutation(api.nodeslide.ensureWorkspace, {
    clientSessionId: `agentic-local-switch-${Date.now().toString(36)}`,
  });
  const ownerAccessKey = workspace.ownerAccessKey;
  assert(ownerAccessKey, 'Local proof deck did not return its owner capability.');
  disabledBefore = await expectsFeatureDisabled(() =>
    runShadow(workspace.deck.id, ownerAccessKey, 'disabled-before'),
  );
  assert(disabledBefore, 'Shadow action did not fail closed before flags were enabled.');

  await setFlags(true);
  const result = await runShadow(workspace.deck.id, ownerAccessKey, 'enabled');
  assert(result.terminalReason === 'completed', 'Enabled shadow action did not complete.');
  assert(result.proposalCount === 0, 'Inspect-only shadow action returned a proposal.');
  assert(result.candidateExposed === false, 'Shadow action exposed a candidate.');
  assert(result.candidateCommitted === false, 'Shadow action committed a candidate.');
  const editTarget = workspace.elements.find(
    (element) =>
      element.kind === 'text' &&
      !element.locked &&
      element.content &&
      !element.content.includes('"'),
  );
  assert(editTarget, 'Local proof deck has no eligible paired-shadow edit target.');
  const editSlide = workspace.slides.find((slide) => slide.id === editTarget.slideId);
  assert(editSlide, 'Local proof deck is missing the paired-shadow target slide.');
  const pairedProposal = await client.action(api.nodeslideAgent.proposeEdit, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    instruction: `Replace "${editTarget.content}" with "Local paired shadow evidence".`,
    baseDeckVersion: workspace.deck.version,
    baseSlideVersions: { [editSlide.id]: editSlide.version },
    baseElementVersions: { [editTarget.id]: editTarget.version },
    scope: {
      kind: 'elements',
      deckId: workspace.deck.id,
      slideIds: [editSlide.id],
      elementIds: [editTarget.id],
      operationMode: 'copy',
    },
  });
  const traces = await client.query(api.nodeslide.listExecutionTraces, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    limit: 10,
  });
  const telemetry = await client.query(api.nodeslide.getExecutionTelemetrySummary, {
    deckId: workspace.deck.id,
    ownerAccessKey,
  });
  const comparisons = await waitForShadowComparison(
    workspace.deck.id,
    ownerAccessKey,
    pairedProposal.patch.id,
  );
  const currentWorkspace = await client.query(api.nodeslide.getWorkspace, {
    deckId: workspace.deck.id,
    ownerAccessKey,
  });
  const pairedBaselineTrace = currentWorkspace?.traces.find(
    (trace) => trace.patchId === pairedProposal.patch.id,
  );
  assert(traces.length === 1, 'Enabled shadow action did not persist exactly one trace.');
  assert(telemetry.sampleSize === 1, 'Telemetry did not aggregate the persisted trace.');
  assert(comparisons.length === 1, 'Enabled edit did not persist exactly one paired comparison.');
  assert(
    pairedBaselineTrace?.shadowComparisonExpected === true,
    'Baseline trace did not record the expected comparison marker.',
  );
  assert(
    comparisons[0]?.baselinePatchId === pairedProposal.patch.id,
    'Paired comparison is not bound to the persisted baseline patch.',
  );
  assert(comparisons[0]?.candidateExposed === false, 'Paired comparison exposed its candidate.');
  assert(
    comparisons[0]?.candidateCommitted === false,
    'Paired comparison committed its candidate.',
  );
  assert(
    !JSON.stringify(comparisons[0]).includes('Local paired shadow evidence'),
    'Paired comparison persisted candidate content.',
  );
  assert(
    pairedBaselineTrace?.planningInputDigest === comparisons[0]?.turnInputDigest &&
      pairedBaselineTrace?.planningSnapshotDigest === comparisons[0]?.baseSnapshotDigest &&
      pairedBaselineTrace?.shadowControlsDigest === comparisons[0]?.controlsDigest,
    'Paired comparison does not match the atomic baseline trace bindings.',
  );

  await setFlags(false);
  disabledAfter = await expectsFeatureDisabled(() =>
    runShadow(workspace.deck.id, ownerAccessKey, 'disabled-after'),
  );
  assert(disabledAfter, 'Shadow action did not fail closed after rollback.');

  const proof = {
    schemaVersion: 'nodeslide.local-switch-proof/v1',
    generatedAt: new Date().toISOString(),
    deployment: 'isolated-local',
    productionTouched: false,
    disposableDeckId: workspace.deck.id,
    switchExercise: {
      disabledBefore,
      enabledCompleted: result.terminalReason === 'completed',
      enabledProposalCount: result.proposalCount,
      candidateExposed: result.candidateExposed,
      candidateCommitted: result.candidateCommitted,
      enabledEgressMode: traces[0]?.egressMode,
      enabledAllowedHosts: traces[0]?.allowedHosts,
      tracePersisted: traces.length === 1,
      telemetrySampleSize: telemetry.sampleSize,
      pairedComparisonPersisted: comparisons.length === 1,
      pairedCandidateExposed: comparisons[0]?.candidateExposed,
      pairedCandidateCommitted: comparisons[0]?.candidateCommitted,
      pairedBaselineExpected: pairedBaselineTrace?.shadowComparisonExpected,
      disabledAfter,
      rollbackConfirmed: disabledAfter,
    },
    trace: {
      schemaVersion: traces[0]?.schemaVersion,
      kind: traces[0]?.kind,
      cohort: traces[0]?.cohort,
      controlsDigest: traces[0]?.controlsDigest,
      adapterId: traces[0]?.adapterId,
      terminalReason: traces[0]?.terminalReason,
      cleanupConfirmed: traces[0]?.cleanupConfirmed,
      traceDigest: traces[0]?.traceDigest,
    },
    telemetry: {
      schemaVersion: telemetry.schemaVersion,
      requests: telemetry.totals.requests,
      completed: telemetry.totals.completed,
      stopped: telemetry.totals.stopped,
      cleanupFailures: telemetry.totals.cleanupFailures,
      egressSessions: telemetry.totals.egressSessions,
      summaryDigest: telemetry.summaryDigest,
    },
    pairedComparison: {
      schemaVersion: comparisons[0]?.schemaVersion,
      baselinePatchId: comparisons[0]?.baselinePatchId,
      turnInputDigest: comparisons[0]?.turnInputDigest,
      baseSnapshotDigest: comparisons[0]?.baseSnapshotDigest,
      controlsDigest: comparisons[0]?.controlsDigest,
      baseline: comparisons[0]?.baseline,
      candidate: comparisons[0]?.candidate,
      candidateExposed: comparisons[0]?.candidateExposed,
      candidateCommitted: comparisons[0]?.candidateCommitted,
      comparisonDigest: comparisons[0]?.comparisonDigest,
    },
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `${JSON.stringify({ outputPath, switchExercise: proof.switchExercise }, null, 2)}\n`,
  );
} finally {
  await setFlags(false);
}

async function waitForShadowComparison(deckId, ownerAccessKey, baselinePatchId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const comparisons = await client.query(api.nodeslide.listShadowComparisons, {
      deckId,
      ownerAccessKey,
      limit: 10,
    });
    if (comparisons.some((comparison) => comparison.baselinePatchId === baselinePatchId)) {
      return comparisons;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return [];
}

async function runShadow(deckId, ownerAccessKey, sessionSuffix) {
  return await client.action(api.nodeslideAgent.runDeckReplShadow, {
    deckId,
    ownerAccessKey,
    sessionId: `local-switch-${sessionSuffix}`,
    commands: [{ id: 'inspect', type: 'inspect_deck' }],
  });
}

async function expectsFeatureDisabled(operation) {
  try {
    await operation();
    return false;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'data' in error ? error.data?.code : undefined;
    return code === 'feature_disabled' || String(error).includes('feature_disabled');
  }
}

async function setFlags(enabled) {
  for (const flag of FLAGS) {
    const args = enabled
      ? `pnpm exec convex env set ${flag} true`
      : `pnpm exec convex env remove ${flag}`;
    try {
      await execFileAsync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', args], {
        cwd: rootDirectory,
        env: { ...process.env, CONVEX_DEPLOYMENT: DEPLOYMENT },
        windowsHide: true,
      });
    } catch (error) {
      if (!enabled && String(error).includes('Environment variable not found')) continue;
      throw error;
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
