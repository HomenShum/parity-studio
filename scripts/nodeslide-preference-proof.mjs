import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { createServer } from 'vite';
import { api } from '../convex/_generated/api.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(rootDirectory, 'docs', 'dogfood', 'nodeslide-pillars');
const outputPath = path.join(outputDirectory, 'w4-preference-proof.json');
const convexUrl = process.env.VITE_CONVEX_URL ?? (await readConvexUrl());
if (!convexUrl) throw new Error('VITE_CONVEX_URL is missing from the environment and .env.local.');

const client = new ConvexHttpClient(convexUrl);
const workspace = await step('ensure disposable workspace', () =>
  client.mutation(api.nodeslide.ensureWorkspace, {
    clientSessionId: `nodeslide-w4-proof-${Date.now().toString(36)}`,
  }),
);
const ownerAccessKey = workspace.ownerAccessKey;
assert(ownerAccessKey, 'Disposable W4 proof workspace did not return an owner capability.');
const slide = workspace.slides.find((candidate) =>
  workspace.elements.some((element) => element.slideId === candidate.id && !element.locked),
);
assert(slide, 'Disposable W4 proof workspace has no editable slide.');

const generation = await step('generate variations', () =>
  client.action(api.nodeslideVariations.generate, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    slideId: slide.id,
  }),
);
const selected = generation.variations[0];
assert(selected, 'W4 dogfood generation returned no variation.');
const acceptance = await step('accept variation', () =>
  client.action(api.nodeslideVariations.accept, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    variationId: selected.id,
  }),
);
assert(acceptance.patch?.status === 'accepted', 'W4 dogfood variation did not commit a patch.');

const firstSync = await step('sync variation decisions', () =>
  client.mutation(api.nodeslidePreferences.syncVariationDecisions, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    limit: 50,
  }),
);
const retrySync = await step('retry variation decision sync', () =>
  client.mutation(api.nodeslidePreferences.syncVariationDecisions, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    limit: 50,
  }),
);
const firstPatchRecord = await step('record accepted patch', () =>
  client.mutation(api.nodeslidePreferences.recordPatchDecision, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    patchId: acceptance.patch.id,
  }),
);
const retryPatchRecord = await step('retry accepted patch record', () =>
  client.mutation(api.nodeslidePreferences.recordPatchDecision, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    patchId: acceptance.patch.id,
  }),
);

const acceptedWorkspace = await step('reload accepted workspace', () =>
  client.query(api.nodeslide.getWorkspace, {
    deckId: workspace.deck.id,
    ownerAccessKey,
  }),
);
assert(acceptedWorkspace, 'W4 proof could not reload its accepted workspace.');
const vite = await createServer({
  appType: 'custom',
  root: rootDirectory,
  server: { hmr: false, middlewareMode: true },
});
let html;
let pure;
let retention;
try {
  const htmlModule = await vite.ssrLoadModule('/src/domains/nodeslide/slidelang/html.ts');
  pure = await vite.ssrLoadModule('/convex/lib/nodeslidePreferenceEtl.ts');
  retention = await vite.ssrLoadModule('/convex/lib/nodeslidePreferenceRetention.ts');
  html = htmlModule.renderDeckHtml({
    deck: acceptedWorkspace.deck,
    slides: acceptedWorkspace.slides,
    elements: acceptedWorkspace.elements,
    sources: acceptedWorkspace.sources,
  });
} finally {
  await vite.close();
}
assert(
  html.includes(acceptedWorkspace.deck.title),
  'Rendered HTML did not contain the deck title.',
);
const htmlDigestSha256 = createHash('sha256').update(html).digest('hex');
const exportRecord = await step('record completed export', () =>
  client.mutation(api.nodeslidePreferences.recordExportCompleted, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    kind: 'html',
    fileName: 'nodeslide-w4-proof.html',
  }),
);

const etlStart = performance.now();
const [firstEtl, concurrentEtl] = await step('run concurrent ETL', () =>
  Promise.all([
    client.mutation(api.nodeslidePreferences.runEtl, {
      deckId: workspace.deck.id,
      ownerAccessKey,
    }),
    client.mutation(api.nodeslidePreferences.runEtl, {
      deckId: workspace.deck.id,
      ownerAccessKey,
    }),
  ]),
);
const etlElapsedMs = performance.now() - etlStart;
const events = await step('list preference events', () =>
  client.query(api.nodeslidePreferences.listEvents, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    limit: 200,
  }),
);
const profile = await step('load taste profile', () =>
  client.query(api.nodeslidePreferences.getTasteProfile, {
    deckId: workspace.deck.id,
    ownerAccessKey,
  }),
);
assert(profile && profile.signals.length > 0, 'W4 dogfood produced no durable preference signal.');
assert(
  profile.signals.every(
    (signal) =>
      signal.evaluator.passed &&
      signal.evaluator.checks.schema.passed &&
      signal.evaluator.checks.provenance.passed &&
      signal.evaluator.checks.hallucination.passed,
  ),
  'A stored W4 signal lacks an all-pass evaluator receipt.',
);
const eventIds = new Set(events.map((event) => event.id));
assert(
  profile.signals.every((signal) => signal.evidenceEventIds.every((id) => eventIds.has(id))),
  'A stored W4 signal has unreachable event evidence.',
);

const replayProfileIds = [...firstEtl.profile.signals.map((signal) => signal.id)].sort();
const concurrentProfileIds = [...concurrentEtl.profile.signals.map((signal) => signal.id)].sort();
const durableProfileIds = [...profile.signals.map((signal) => signal.id)].sort();
assert(
  JSON.stringify(replayProfileIds) === JSON.stringify(concurrentProfileIds) &&
    JSON.stringify(concurrentProfileIds) === JSON.stringify(durableProfileIds),
  'Concurrent/replayed W4 ETL did not converge.',
);

let tenantIsolationPassed = false;
try {
  await client.query(api.nodeslidePreferences.listEvents, {
    deckId: workspace.deck.id,
    ownerAccessKey: 'A'.repeat(43),
    limit: 1,
  });
} catch {
  tenantIsolationPassed = true;
}
assert(tenantIsolationPassed, 'Wrong-owner W4 list unexpectedly succeeded.');

const floodRows = Array.from({ length: 1_500 }, (_, index) => ({
  id: `event:${index.toString().padStart(4, '0')}`,
  recordedAt: index,
  ...(index < 1_200 ? { processedAt: index + 2_000 } : {}),
}));
const retainedEvidenceId = 'event:0000';
const floodPlan = retention.planPreferenceEventRetention(floodRows, new Set([retainedEvidenceId]));
assert(
  floodPlan.retainedCount === 1_000 && !floodPlan.eventIdsToDelete.includes(retainedEvidenceId),
  'W4 flood retention did not preserve evidence at the 1,000-event cap.',
);

const forgedEvent = structuredClone(events.find((event) => event.type === 'variation_selected'));
assert(forgedEvent, 'W4 proof could not find its selected event.');
forgedEvent.id = `${forgedEvent.id}:forged`;
forgedEvent.provenance.variationId = 'variation:cross-tenant';
const forged = pure.extractPreferenceSignals([forgedEvent]);
assert(
  forged.signals.length === 0 && forged.inputRejections.length === 1,
  'Forged W4 provenance produced a signal.',
);

const backendSource = await readFile(
  path.join(rootDirectory, 'convex', 'nodeslidePreferences.ts'),
  'utf8',
);
const reliability = {
  BOUND:
    events.length <= 200 &&
    firstEtl.diagnostics.inputEvents <= 100 &&
    floodPlan.retainedCount === 1_000,
  HONEST_STATUS:
    profile.signals.every((signal) => signal.evaluator.passed) && forged.signals.length === 0,
  HONEST_SCORES: profile.signals.every(
    (signal) =>
      Number.isFinite(signal.confidence) && signal.confidence >= 0 && signal.confidence <= 1,
  ),
  TIMEOUT: etlElapsedMs < 10_000,
  SSRF: !/\bfetch\s*\(/u.test(backendSource),
  BOUND_READ:
    backendSource.includes('.take(NODESLIDE_PREFERENCE_BOUNDS.maxEventsPerExtraction)') &&
    backendSource.includes('.take(PRUNE_READ_LIMIT)'),
  ERROR_BOUNDARY: tenantIsolationPassed && forged.inputRejections.length === 1,
  DETERMINISTIC:
    JSON.stringify(replayProfileIds) === JSON.stringify(durableProfileIds) &&
    retrySync.inserted === 0 &&
    retryPatchRecord.inserted === false,
};
assert(Object.values(reliability).every(Boolean), 'One or more W4 reliability checks failed.');

const proof = {
  generatedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: rootDirectory,
    encoding: 'utf8',
  }).trim(),
  disposableDogfood: {
    deckId: workspace.deck.id,
    baseDeckVersion: workspace.deck.version,
    resultingDeckVersion: acceptedWorkspace.deck.version,
    selectedVariationId: selected.id,
    acceptedPatchId: acceptance.patch.id,
    exportId: exportRecord.exportId,
    htmlDigestSha256,
  },
  recording: {
    firstSync,
    retrySync,
    patchInsertedFirst: firstPatchRecord.inserted,
    patchInsertedOnRetry: retryPatchRecord.inserted,
    eventCount: events.length,
    eventTypes: [...new Set(events.map((event) => event.type))].sort(),
    sanitizedEventIds: events.map((event) => event.id).sort(),
  },
  provenanceGraph: profile.signals.map((signal) => ({
    signalId: signal.id,
    polarity: signal.polarity,
    dimension: signal.dimension,
    value: signal.value,
    evidenceEventIds: signal.evidenceEventIds,
    evaluator: signal.evaluator,
  })),
  etl: {
    elapsedMs: Math.round(etlElapsedMs * 1_000) / 1_000,
    diagnostics: firstEtl.diagnostics,
    storedSignalCount: profile.signals.length,
    concurrentReplayConverged: true,
    rejectedForgedSignalCount: forged.inputRejections.length,
  },
  retention: {
    inputEvents: floodRows.length,
    deletedEvents: floodPlan.eventIdsToDelete.length,
    retainedEvents: floodPlan.retainedCount,
    retainedEvidencePreserved: floodPlan.retainedEventIds.includes(retainedEvidenceId),
  },
  tenantIsolationPassed,
  reliability,
  deviations: [],
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputPath, proof }, null, 2)}\n`);

async function readConvexUrl() {
  try {
    const contents = await readFile(path.join(rootDirectory, '.env.local'), 'utf8');
    return contents.match(/^VITE_CONVEX_URL=(.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

async function step(label, operation) {
  const startedAt = performance.now();
  process.stdout.write(`[w4-proof] ${label}...\n`);
  try {
    const result = await operation();
    process.stdout.write(
      `[w4-proof] ${label} ok (${Math.round(performance.now() - startedAt)}ms)\n`,
    );
    return result;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`[w4-proof] ${label} failed: ${details}`, { cause: error });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
