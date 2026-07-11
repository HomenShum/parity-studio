import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

const SUSTAINED_ROUNDS = 50;
const OWNER_GENERATION_QUOTA = 60;
const MAX_GENERATION_MS = 10_000;
const MAX_CANDIDATE_BYTES = 64_000;
const MAX_LIST_BYTES = 2_000_000;
const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(rootDirectory, 'docs', 'dogfood', 'nodeslide-pillars');
const outputPath = path.join(outputDirectory, 'w3-variation-proof.json');
const convexUrl = process.env.VITE_CONVEX_URL ?? (await readConvexUrl());

assert(
  hasFlag('--disposable'),
  'W3 proof is destructive by design. Re-run with --disposable to create isolated proof decks.',
);
assert(
  !hasFlag('--deck') && !hasFlag('--owner-key') && !process.env.NODESLIDE_OWNER_ACCESS_KEY,
  'W3 proof refuses existing deck IDs and owner capabilities; it always creates disposable decks.',
);
assert(convexUrl, 'VITE_CONVEX_URL is missing from the environment and .env.local.');

const client = new ConvexHttpClient(convexUrl);
const runId = `nodeslide-w3-proof-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const workspace = await client.mutation(api.nodeslide.ensureWorkspace, {
  clientSessionId: `${runId}-primary`,
});
const tenantProbeWorkspace = await client.mutation(api.nodeslide.ensureWorkspace, {
  clientSessionId: `${runId}-tenant-probe`,
});
const ownerAccessKey = workspace.ownerAccessKey;
const tenantProbeOwnerAccessKey = tenantProbeWorkspace.ownerAccessKey;
assert(ownerAccessKey, 'Disposable W3 proof deck did not return an owner capability.');
assert(
  tenantProbeOwnerAccessKey,
  'Disposable tenant-probe deck did not return an owner capability.',
);
const slide = workspace.slides.find((candidate) =>
  workspace.elements.some((element) => element.slideId === candidate.id && !element.locked),
);
assert(slide, 'W3 proof deck has no slide with unlocked elements.');

let successfulGenerationCount = 0;
const generatedRuns = [];
const generateTracked = async () => {
  const generated = await timedGenerate(client, workspace.deck.id, ownerAccessKey, slide.id);
  successfulGenerationCount += 1;
  generatedRuns.push(generated);
  return generated;
};

const selectedPreVersion = workspace.deck.version;
const selectedGeneration = await generateTracked();
const selectedVariation = selectedGeneration.receipt.variations[0];
assert(selectedVariation, 'Selected proof batch returned no variation.');
const selectedReceipt = await client.action(api.nodeslideVariations.accept, {
  deckId: workspace.deck.id,
  ownerAccessKey,
  variationId: selectedVariation.id,
});
assert(selectedReceipt.variation.status === 'accepted', 'Selected variation was not accepted.');
assert(selectedReceipt.patch?.status === 'accepted', 'Selected variation patch was not accepted.');
const selectedPatchId = selectedReceipt.patch.id;
const afterSelected = await requireWorkspace(client, workspace.deck.id, ownerAccessKey);
assert(
  afterSelected.deck.version === selectedPreVersion + 1,
  'Accepting one variation did not create exactly one deck version.',
);
const selectedRows = await reloadBatch(
  client,
  workspace.deck.id,
  ownerAccessKey,
  slide.id,
  selectedGeneration,
);
assertAcceptedSiblingDecision(selectedRows, selectedVariation.id, selectedPatchId);
const replayedSelection = await client.action(api.nodeslideVariations.accept, {
  deckId: workspace.deck.id,
  ownerAccessKey,
  variationId: selectedVariation.id,
});
const afterSelectionReplay = await requireWorkspace(client, workspace.deck.id, ownerAccessKey);
assert(
  replayedSelection.variation.status === 'accepted' && replayedSelection.patch === null,
  'Repeated acceptance did not return the existing decision.',
);
assert(
  afterSelectionReplay.deck.version === afterSelected.deck.version &&
    afterSelectionReplay.patches.length === afterSelected.patches.length,
  'Repeated acceptance duplicated a patch or deck version.',
);
const selectedEventState = await client.query(api.nodeslideVariationProof.getState, {
  deckId: workspace.deck.id,
  ownerAccessKey,
});
assert(
  selectedEventState.eventCounts.variationGenerated >= 3 &&
    selectedEventState.eventCounts.variationSelected >= 1 &&
    selectedEventState.eventCounts.variationRejected >= 2 &&
    selectedEventState.activeAcceptanceReservations === 0 &&
    selectedEventState.acceptedBatchConsistency,
  'Atomic selection and sibling provenance were not retained consistently.',
);

const allRejectedPatchCountBefore = afterSelected.patches.length;
const allRejectedPreVersion = afterSelected.deck.version;
const allRejectedGeneration = await generateTracked();
await rejectGeneratedBatch(
  client,
  workspace.deck.id,
  ownerAccessKey,
  allRejectedGeneration,
  'w3_all_rejected_proof',
);
const rejectedDecisions = await reloadBatch(
  client,
  workspace.deck.id,
  ownerAccessKey,
  slide.id,
  allRejectedGeneration,
);
const firstRejectedDecision = rejectedDecisions[0];
assert(firstRejectedDecision, 'All-rejected proof could not reload its first decision.');
const replayedRejection = await client.mutation(api.nodeslideVariations.reject, {
  deckId: workspace.deck.id,
  ownerAccessKey,
  variationId: firstRejectedDecision.id,
  reason: 'different_replay_reason_must_not_replace_decision',
});
const afterAllRejected = await requireWorkspace(client, workspace.deck.id, ownerAccessKey);
assert(
  rejectedDecisions.length === 3 &&
    rejectedDecisions.every((variation) => variation.status === 'rejected'),
  'All-rejected proof did not retain three rejected decisions.',
);
assert(
  afterAllRejected.deck.version === allRejectedPreVersion &&
    afterAllRejected.patches.length === allRejectedPatchCountBefore,
  'Rejecting variations changed the deck or created a patch.',
);
assert(
  replayedRejection.status === 'rejected' &&
    replayedRejection.decidedAt === firstRejectedDecision.decidedAt,
  'Repeated rejection did not return the original decision.',
);

// Reproduce the old wedge: persist then reject the deterministic patch ID before W3 accept.
const recoveryPreVersion = afterAllRejected.deck.version;
const recoveryGeneration = await generateTracked();
const blockedVariation = recoveryGeneration.receipt.variations[0];
const recoveryWinner = recoveryGeneration.receipt.variations[1];
assert(blockedVariation && recoveryWinner, 'Recovery proof batch is incomplete.');
const rejectedLinkedPatchId = nodeslideStableId('patch_variation', blockedVariation.id);
await client.mutation(api.nodeslide.proposePatch, {
  id: rejectedLinkedPatchId,
  deckId: workspace.deck.id,
  ownerAccessKey,
  baseDeckVersion: blockedVariation.baseDeckVersion,
  baseSlideVersions: { [blockedVariation.slideId]: blockedVariation.baseSlideVersion },
  baseElementVersions: blockedVariation.baseElementVersions,
  scope: {
    kind: 'slide',
    deckId: workspace.deck.id,
    slideIds: [blockedVariation.slideId],
    operationMode: 'unrestricted',
  },
  operations: blockedVariation.operations,
  source: 'agent',
  summary: 'W3 rejected-linked-patch recovery probe',
  traceId: blockedVariation.id,
});
await client.mutation(api.nodeslide.rejectPatch, {
  deckId: workspace.deck.id,
  ownerAccessKey,
  patchId: rejectedLinkedPatchId,
});
const recoveredRejected = await client.action(api.nodeslideVariations.accept, {
  deckId: workspace.deck.id,
  ownerAccessKey,
  variationId: blockedVariation.id,
});
assert(
  recoveredRejected.variation.status === 'rejected' && recoveredRejected.patch === null,
  'A rejected linked patch did not reconcile to a terminal variation decision.',
);
const recoveryAccepted = await client.action(api.nodeslideVariations.accept, {
  deckId: workspace.deck.id,
  ownerAccessKey,
  variationId: recoveryWinner.id,
});
assert(
  recoveryAccepted.variation.status === 'accepted' && recoveryAccepted.patch?.status === 'accepted',
  'A sibling could not be accepted after rejected-patch recovery.',
);
const afterRecovery = await requireWorkspace(client, workspace.deck.id, ownerAccessKey);
assert(
  afterRecovery.deck.version === recoveryPreVersion + 1,
  'Rejected-patch recovery did not create exactly one accepted deck version.',
);
const recoveryRows = await reloadBatch(
  client,
  workspace.deck.id,
  ownerAccessKey,
  slide.id,
  recoveryGeneration,
);
assertAcceptedSiblingDecision(recoveryRows, recoveryWinner.id, recoveryAccepted.patch.id);

const wrongOwnerKey = 'x'.repeat(43);
const wrongOwnerExisting = await captureFailure(() =>
  client.query(api.nodeslideVariations.list, {
    deckId: workspace.deck.id,
    ownerAccessKey: wrongOwnerKey,
    slideId: slide.id,
    limit: 30,
  }),
);
const wrongOwnerMissing = await captureFailure(() =>
  client.query(api.nodeslideVariations.list, {
    deckId: 'nodeslide-missing-deck',
    ownerAccessKey: wrongOwnerKey,
    slideId: slide.id,
    limit: 30,
  }),
);
const wrongOwnerAccept = await captureFailure(() =>
  client.action(api.nodeslideVariations.accept, {
    deckId: workspace.deck.id,
    ownerAccessKey: wrongOwnerKey,
    variationId: selectedVariation.id,
  }),
);
assert(
  [wrongOwnerExisting, wrongOwnerMissing, wrongOwnerAccept].every(isOpaqueDenial),
  `Wrong-owner calls did not share the owner-denied boundary: ${JSON.stringify(
    [wrongOwnerExisting, wrongOwnerMissing, wrongOwnerAccept].map((failure) => failure.message),
  )}`,
);
const invalidListLimit = await captureFailure(() =>
  client.query(api.nodeslideVariations.list, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    slideId: slide.id,
    limit: 0,
  }),
);
assert(
  invalidListLimit.code === 'invalid_request',
  'Invalid list bounds did not return the typed W3 boundary.',
);

const tenantProbeSlide = tenantProbeWorkspace.slides.find((candidate) =>
  tenantProbeWorkspace.elements.some(
    (element) => element.slideId === candidate.id && !element.locked,
  ),
);
const tenantProbeElement = tenantProbeWorkspace.elements.find(
  (element) => element.slideId === tenantProbeSlide?.id && !element.locked,
);
assert(tenantProbeSlide && tenantProbeElement, 'Tenant probe deck lacks an unlocked target.');
const crossDeckPatchLookup = await captureFailure(() =>
  client.mutation(api.nodeslide.proposePatch, {
    id: selectedPatchId,
    deckId: tenantProbeWorkspace.deck.id,
    ownerAccessKey: tenantProbeOwnerAccessKey,
    baseDeckVersion: tenantProbeWorkspace.deck.version,
    baseSlideVersions: { [tenantProbeSlide.id]: tenantProbeSlide.version },
    baseElementVersions: { [tenantProbeElement.id]: tenantProbeElement.version },
    scope: {
      kind: 'slide',
      deckId: tenantProbeWorkspace.deck.id,
      slideIds: [tenantProbeSlide.id],
      operationMode: 'unrestricted',
    },
    operations: [
      {
        op: 'update_style',
        slideId: tenantProbeSlide.id,
        elementId: tenantProbeElement.id,
        properties: {
          opacity: tenantProbeElement.style.opacity === 0.73 ? 0.74 : 0.73,
        },
      },
    ],
    source: 'agent',
    summary: 'Cross-deck patch lookup denial probe',
  }),
);
assert(
  isOpaqueDenial(crossDeckPatchLookup),
  'A cross-deck idempotent patch lookup was not denied.',
);
const tenantProbeAfter = await requireWorkspace(
  client,
  tenantProbeWorkspace.deck.id,
  tenantProbeOwnerAccessKey,
);
assert(
  tenantProbeAfter.deck.version === tenantProbeWorkspace.deck.version,
  'The cross-deck lookup probe mutated the tenant-probe deck.',
);

const sustainedElapsedMs = [];
for (let round = 0; round < SUSTAINED_ROUNDS; round += 1) {
  const generated = await generateTracked();
  sustainedElapsedMs.push(generated.wallClockMs);
  await rejectGeneratedBatch(
    client,
    workspace.deck.id,
    ownerAccessKey,
    generated,
    `w3_sustained_round_${round + 1}`,
  );
}

const remainingOwnerCapacity = Math.max(0, OWNER_GENERATION_QUOTA - successfulGenerationCount);
const quotaBurstAttempts = remainingOwnerCapacity + 4;
const quotaBurstResults = await Promise.allSettled(
  Array.from({ length: quotaBurstAttempts }, () =>
    timedGenerate(client, workspace.deck.id, ownerAccessKey, slide.id),
  ),
);
const quotaBurstSuccesses = quotaBurstResults.flatMap((result) =>
  result.status === 'fulfilled' ? [result.value] : [],
);
const quotaBurstFailures = quotaBurstResults.flatMap((result) =>
  result.status === 'rejected' ? [failureReceipt(result.reason)] : [],
);
successfulGenerationCount += quotaBurstSuccesses.length;
generatedRuns.push(...quotaBurstSuccesses);
assert(
  quotaBurstSuccesses.length <= remainingOwnerCapacity &&
    successfulGenerationCount <= OWNER_GENERATION_QUOTA &&
    quotaBurstFailures.length >= 4 &&
    quotaBurstFailures.every((failure) => failure.code === 'quota_exceeded'),
  `Parallel generation did not enforce the typed owner/global quota boundary atomically: ${JSON.stringify(
    {
      remainingOwnerCapacity,
      successfulGenerationCount,
      successes: quotaBurstSuccesses.length,
      failures: quotaBurstFailures,
    },
  )}`,
);
await Promise.all(
  quotaBurstSuccesses.map((generated) =>
    rejectGeneratedBatch(
      client,
      workspace.deck.id,
      ownerAccessKey,
      generated,
      'w3_quota_burst_cleanup',
    ),
  ),
);

const state = await client.query(api.nodeslideVariationProof.getState, {
  deckId: workspace.deck.id,
  ownerAccessKey,
});
const listedVariations = await client.query(api.nodeslideVariations.list, {
  deckId: workspace.deck.id,
  ownerAccessKey,
  slideId: slide.id,
  limit: 100,
});
const listResponseBytes = serializedByteLength(listedVariations);
const deterministicAudit = await client.query(api.nodeslideVariationProof.getDeterministicAudit, {
  deckId: workspace.deck.id,
  ownerAccessKey,
  slideId: slide.id,
});
const latestGenerated = quotaBurstSuccesses.at(-1) ?? generatedRuns.at(-1);
assert(latestGenerated, 'No generated batch was available for persistence replay proof.');
const reloadedLatest = listedVariations.filter(
  (variation) => variation.batchId === latestGenerated.receipt.batch.id,
);
const persistedReplayMatches =
  reloadedLatest.length === 3 &&
  stableStringify(batchFingerprintReceipt(reloadedLatest)) ===
    stableStringify(batchFingerprintReceipt(latestGenerated.receipt.variations));

const allVariations = generatedRuns.flatMap((generated) => generated.receipt.variations);
const allGenerationTimes = generatedRuns.map((generated) => generated.wallClockMs);
const reliabilityEvidence = {
  BOUND: {
    passed:
      state.withinBounds &&
      state.completeBatchDiversity &&
      allVariations.every(isBoundedVariation) &&
      listResponseBytes <= state.bounds.listByteLimit,
    counts: state.counts,
    bounds: state.bounds,
    listResponseBytes,
  },
  HONEST_STATUS: {
    passed: generatedRuns.every(hasHonestOrigin),
    fallbackVariants: allVariations.filter(
      (variation) => variation.origin === 'deterministic_fallback',
    ).length,
    freeRouteVariants: allVariations.filter((variation) => variation.origin === 'free_route')
      .length,
  },
  HONEST_SCORES: {
    passed:
      !state.rawProviderFieldsPresent &&
      allVariations.every(
        (variation) =>
          variation.validation.ok &&
          !variation.validation.issues.some((issue) => issue.severity === 'error'),
      ),
    rawProviderFieldsPresent: state.rawProviderFieldsPresent,
  },
  TIMEOUT: {
    passed: allGenerationTimes.every((elapsedMs) => elapsedMs < MAX_GENERATION_MS),
    maxWallClockMs: Math.max(...allGenerationTimes),
  },
  SSRF: {
    passed: allVariations.every(hasNoFetchableVisualOperation),
    inspectedOperationCount: allVariations.reduce(
      (count, variation) => count + variation.operations.length,
      0,
    ),
  },
  BOUND_READ: {
    passed:
      listResponseBytes <= MAX_LIST_BYTES &&
      listedVariations.length <= 100 &&
      state.bounds.maxCandidateBytes <= MAX_CANDIDATE_BYTES,
    returnedVariants: listedVariations.length,
    listResponseBytes,
  },
  ERROR_BOUNDARY: {
    passed:
      quotaBurstFailures.length >= 4 &&
      quotaBurstFailures.every((failure) => failure.code === 'quota_exceeded') &&
      isOpaqueDenial(wrongOwnerExisting) &&
      isOpaqueDenial(wrongOwnerMissing) &&
      isOpaqueDenial(wrongOwnerAccept) &&
      invalidListLimit.code === 'invalid_request' &&
      isOpaqueDenial(crossDeckPatchLookup),
    quotaFailureCodes: quotaBurstFailures.map((failure) => failure.code),
  },
  DETERMINISTIC: {
    passed: deterministicAudit.deterministic && persistedReplayMatches,
    fallbackAudit: deterministicAudit,
    persistedReplayMatches,
  },
};
const reliability = Object.fromEntries(
  Object.entries(reliabilityEvidence).map(([key, evidence]) => [key, evidence.passed]),
);
assert(
  Object.values(reliability).every(Boolean),
  `The measured W3 reliability checklist failed: ${JSON.stringify(reliabilityEvidence)}`,
);
assert(state.withinBounds, 'Sustained W3 state exceeded a persistence cap.');
assert(
  state.activeAcceptanceReservations === 0,
  'A variation acceptance reservation was stranded.',
);
assert(state.acceptedBatchConsistency, 'Accepted variation sibling state is inconsistent.');
assert(state.duplicateDecisionKeys === 0, 'Duplicate variation decision events were retained.');

const selectedBatchProof = batchProof(selectedGeneration);
const allRejectedBatchProof = batchProof(allRejectedGeneration);
const recoveryBatchProof = batchProof(recoveryGeneration);
const sourceCommit = await readSourceCommit();
const sourceDirty = await isSourceDirty();
const receipt = {
  schemaVersion: 'nodeslide.w3-variation-proof/v2',
  generatedAt: new Date().toISOString(),
  sourceCommit,
  sourceDirty,
  command: 'pnpm proof:nodeslide:w3 -- --disposable',
  runtime: { node: process.version, convexDeploymentHash: fnv1a(convexUrl) },
  disposable: true,
  disposableRunId: runId,
  deckId: workspace.deck.id,
  slideId: slide.id,
  binaryMetricPassed:
    selectedGeneration.wallClockMs < MAX_GENERATION_MS &&
    selectedGeneration.receipt.variations.length === 3,
  selected: {
    ...selectedBatchProof,
    preDeckVersion: selectedPreVersion,
    postDeckVersion: afterSelected.deck.version,
    selectedVariationId: selectedVariation.id,
    selectedPatchId,
    patchStatus: selectedReceipt.patch.status,
    siblingStatuses: selectedRows.map(decisionReceipt),
    idempotentReplay: {
      status: replayedSelection.variation.status,
      returnedPatch: replayedSelection.patch,
      deckVersion: afterSelectionReplay.deck.version,
      patchCount: afterSelectionReplay.patches.length,
    },
    eventCountsAfterSelection: selectedEventState.eventCounts,
  },
  allRejected: {
    ...allRejectedBatchProof,
    preDeckVersion: allRejectedPreVersion,
    postDeckVersion: afterAllRejected.deck.version,
    patchCountBefore: allRejectedPatchCountBefore,
    patchCountAfter: afterAllRejected.patches.length,
    statuses: rejectedDecisions.map(decisionReceipt),
    idempotentReplay: {
      variationId: replayedRejection.id,
      status: replayedRejection.status,
      decidedAt: replayedRejection.decidedAt,
    },
  },
  reconciliation: {
    ...recoveryBatchProof,
    rejectedLinkedPatchId,
    recoveredVariationStatus: recoveredRejected.variation.status,
    acceptedSiblingVariationId: recoveryWinner.id,
    acceptedSiblingPatchId: recoveryAccepted.patch.id,
    preDeckVersion: recoveryPreVersion,
    postDeckVersion: afterRecovery.deck.version,
    statuses: recoveryRows.map(decisionReceipt),
    activeReservationsAfterRun: state.activeAcceptanceReservations,
  },
  authorization: {
    wrongOwnerExistingDenied: isOpaqueDenial(wrongOwnerExisting),
    wrongOwnerMissingDenied: isOpaqueDenial(wrongOwnerMissing),
    wrongOwnerAcceptDenied: isOpaqueDenial(wrongOwnerAccept),
    crossDeckPatchLookupDenied: isOpaqueDenial(crossDeckPatchLookup),
    tenantProbeDeckUnchanged: tenantProbeAfter.deck.version === tenantProbeWorkspace.deck.version,
  },
  sustained: {
    rounds: SUSTAINED_ROUNDS,
    maxWallClockMs: Math.max(...sustainedElapsedMs),
    counts: state.counts,
    activeGeneratingBatches: state.activeGeneratingBatches,
    activeAcceptanceReservations: state.activeAcceptanceReservations,
    withinBounds: state.withinBounds,
  },
  quotaBurst: {
    ownerSuccessesBeforeBurst: successfulGenerationCount - quotaBurstSuccesses.length,
    ownerCapacityBeforeBurst: remainingOwnerCapacity,
    attempted: quotaBurstResults.length,
    succeeded: quotaBurstSuccesses.length,
    rejected: quotaBurstFailures.length,
    failureCodes: quotaBurstFailures.map((failure) => failure.code),
    ownerSuccessesAfterBurst: successfulGenerationCount,
  },
  reliability,
  reliabilityEvidence,
  deviations: sourceDirty
    ? ['Proof was generated from a working tree with uncommitted changes.']
    : [],
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputPath, receipt }, null, 2)}\n`);

async function timedGenerate(convex, deckId, key, slideId) {
  const startedAt = Date.now();
  const receipt = await convex.action(api.nodeslideVariations.generate, {
    deckId,
    ownerAccessKey: key,
    slideId,
  });
  const wallClockMs = Date.now() - startedAt;
  assert(receipt.variations.length === 3, 'Generation did not return exactly three variants.');
  assert(receipt.batch.elapsedMs < MAX_GENERATION_MS, 'Stored generation elapsed exceeded 10s.');
  assert(wallClockMs < MAX_GENERATION_MS, 'Generation wall-clock time exceeded 10s.');
  assert(receipt.variations.every(isBoundedVariation), 'Generation returned an invalid candidate.');
  assert(
    new Set(receipt.variations.map((variation) => operationFingerprint(variation.operations)))
      .size === 3,
    'Generation returned duplicate operation fingerprints.',
  );
  assert(
    new Set(receipt.variations.map((variation) => candidateFingerprint(variation.candidate)))
      .size === 3,
    'Generation returned duplicate materialized candidates.',
  );
  return { receipt, wallClockMs };
}

async function rejectGeneratedBatch(convex, deckId, key, generated, reason) {
  await Promise.all(
    generated.receipt.variations.map((variation) =>
      convex.mutation(api.nodeslideVariations.reject, {
        deckId,
        ownerAccessKey: key,
        variationId: variation.id,
        reason,
      }),
    ),
  );
}

async function reloadBatch(convex, deckId, key, slideId, generated) {
  const rows = await convex.query(api.nodeslideVariations.list, {
    deckId,
    ownerAccessKey: key,
    slideId,
    limit: 100,
  });
  const ids = new Set(generated.receipt.variations.map((variation) => variation.id));
  return rows.filter((variation) => ids.has(variation.id));
}

function assertAcceptedSiblingDecision(rows, selectedVariationId, selectedPatchId) {
  assert(rows.length === 3, 'Accepted batch did not reload exactly three decisions.');
  const selected = rows.find((variation) => variation.id === selectedVariationId);
  assert(
    selected?.status === 'accepted' && selected.selectedPatchId === selectedPatchId,
    'Selected variation did not retain its accepted patch link.',
  );
  assert(
    rows
      .filter((variation) => variation.id !== selectedVariationId)
      .every((variation) => variation.status === 'rejected'),
    'Ready siblings were not rejected atomically.',
  );
}

function batchProof(generated) {
  return {
    batchId: generated.receipt.batch.id,
    elapsedMs: generated.receipt.batch.elapsedMs,
    wallClockMs: generated.wallClockMs,
    batchOrigin: generated.receipt.batch.origin,
    fallbackReason: generated.receipt.batch.fallbackReason ?? null,
    distinctOperationFingerprints: new Set(
      generated.receipt.variations.map((variation) => operationFingerprint(variation.operations)),
    ).size,
    distinctCandidateFingerprints: new Set(
      generated.receipt.variations.map((variation) => candidateFingerprint(variation.candidate)),
    ).size,
    variants: generated.receipt.variations.map((variation) => ({
      variationId: variation.id,
      origin: variation.origin,
      fallbackReason: variation.fallbackReason ?? null,
      axes: variation.axes,
      operationCount: variation.operations.length,
      operationFingerprint: operationFingerprint(variation.operations),
      candidateFingerprint: candidateFingerprint(variation.candidate),
      candidateBytes: serializedByteLength(variation.candidate),
      validationOk: variation.validation.ok,
      errorIssueCount: variation.validation.issues.filter((issue) => issue.severity === 'error')
        .length,
    })),
  };
}

function batchFingerprintReceipt(variations) {
  return variations
    .map((variation) => ({
      id: variation.id,
      axes: variation.axes,
      operationFingerprint: operationFingerprint(variation.operations),
      candidateFingerprint: candidateFingerprint(variation.candidate),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function decisionReceipt(variation) {
  return {
    variationId: variation.id,
    status: variation.status,
    selectedPatchId: variation.selectedPatchId ?? null,
    decidedAt: variation.decidedAt ?? null,
  };
}

function isBoundedVariation(variation) {
  return (
    variation.operations.length >= 1 &&
    variation.operations.length <= 8 &&
    variation.validation.ok &&
    !variation.validation.issues.some((issue) => issue.severity === 'error') &&
    serializedByteLength(variation.candidate) <= MAX_CANDIDATE_BYTES
  );
}

function hasHonestOrigin(generated) {
  const variations = generated.receipt.variations;
  const expectedBatchOrigin = variations.every((variation) => variation.origin === 'free_route')
    ? 'free_route'
    : 'deterministic_fallback';
  return (
    generated.receipt.batch.origin === expectedBatchOrigin &&
    variations.every(
      (variation) =>
        variation.origin === 'free_route' ||
        (variation.origin === 'deterministic_fallback' && Boolean(variation.fallbackReason)),
    )
  );
}

function hasNoFetchableVisualOperation(variation) {
  return variation.operations.every((operation) => {
    if (operation.op === 'update_style') {
      return Object.values(operation.properties).every(
        (value) =>
          typeof value !== 'string' || !/(?:url\s*\(|https?:|data:|javascript:)/i.test(value),
      );
    }
    if (operation.op === 'update_slide' && operation.properties.background !== undefined) {
      return !/(?:url\s*\(|https?:|data:|javascript:)/i.test(operation.properties.background);
    }
    return true;
  });
}

function operationFingerprint(operations) {
  return `ops-${fnv1a(stableStringify(operations))}`;
}

function candidateFingerprint(candidate) {
  return `candidate-${fnv1a(
    stableStringify({
      slide: {
        title: candidate.slide.title,
        notes: candidate.slide.notes,
        background: candidate.slide.background,
      },
      elements: candidate.elements.map((element) => ({
        id: element.id,
        bbox: element.bbox,
        content: element.content,
        style: element.style,
      })),
    }),
  )}`;
}

function nodeslideStableId(prefix, ...parts) {
  return `${prefix}_${fnv1a(parts.join('\u001f'))}`;
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

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function serializedByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function failureReceipt(error) {
  const data =
    error &&
    typeof error === 'object' &&
    'data' in error &&
    error.data &&
    typeof error.data === 'object'
      ? error.data
      : undefined;
  const publicCode =
    data && 'code' in data && typeof data.code === 'string' ? data.code : undefined;
  const publicMessage =
    data && 'message' in data && typeof data.message === 'string' ? data.message : undefined;
  const message = publicMessage ?? (error instanceof Error ? error.message : String(error));
  return {
    code:
      publicCode ??
      (/NODESLIDE_VARIATION_QUOTA_EXCEEDED/i.test(message) ? 'quota_exceeded' : 'unexpected'),
    message: message.replace(/\s+/g, ' ').slice(0, 240),
  };
}

function isOpaqueDenial(failure) {
  return (
    failure.code === 'unexpected' &&
    (/Server Error/i.test(failure.message) ||
      /owner access denied|Patch is unavailable/i.test(failure.message))
  );
}

async function captureFailure(run) {
  try {
    await run();
  } catch (error) {
    return failureReceipt(error);
  }
  throw new Error('Expected operation to fail, but it succeeded.');
}

async function requireWorkspace(convex, deckId, ownerAccessKey) {
  const result = await convex.query(api.nodeslide.getWorkspace, { deckId, ownerAccessKey });
  assert(result, 'Disposable NodeSlide deck was not found or access was denied.');
  return result;
}

async function readConvexUrl() {
  const envPath = path.join(rootDirectory, '.env.local');
  const content = await readFile(envPath, 'utf8').catch(() => '');
  const line = content
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith('VITE_CONVEX_URL='));
  return line
    ?.slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

async function readSourceCommit() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: rootDirectory });
  return stdout.trim();
}

async function isSourceDirty() {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: rootDirectory });
  return Boolean(stdout.trim());
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
