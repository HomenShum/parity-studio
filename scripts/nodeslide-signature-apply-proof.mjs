import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { createServer } from 'vite';
import { api } from '../convex/_generated/api.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(rootDirectory, 'docs', 'dogfood', 'nodeslide-pillars');
const outputPath = path.join(outputDirectory, 'w2-signature-apply-proof.json');
const convexUrl = process.env.VITE_CONVEX_URL ?? (await readConvexUrl());
if (!convexUrl) throw new Error('VITE_CONVEX_URL is missing from the environment and .env.local.');
const client = new ConvexHttpClient(convexUrl);
const vite = await createServer({
  appType: 'custom',
  root: rootDirectory,
  server: { hmr: false, middlewareMode: true },
});

try {
  const [
    { buildGoldenNodeSlide },
    patchModule,
    applyModule,
    validationModule,
    serverValidation,
    packs,
  ] = await Promise.all([
    vite.ssrLoadModule('/convex/lib/nodeslideSeed.ts'),
    vite.ssrLoadModule('/shared/nodeslidePatch.ts'),
    vite.ssrLoadModule('/shared/nodeslideSignatureApply.ts'),
    vite.ssrLoadModule('/src/domains/nodeslide/slidelang/validation.ts'),
    vite.ssrLoadModule('/convex/lib/nodeslideValidation.ts'),
    vite.ssrLoadModule('/src/domains/nodeslide/signature/packs/index.ts'),
  ]);
  const source = buildGoldenNodeSlide('w2-signature-proof', 1_000).snapshot;
  const sourceBefore = JSON.stringify(source);
  const profiles = [packs.financeIbcsTastePack, packs.startupNarrativeTastePack];
  const results = [];
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('W2 planning must not fetch.');
  };

  try {
    for (const [index, profile] of profiles.entries()) {
      const planStart = performance.now();
      const planned = applyModule.planSignatureApplication(source, profile);
      const planElapsedMs = performance.now() - planStart;
      assert(planned.ok, `${profile.name} did not produce an application plan.`);
      const replayPlan = applyModule.planSignatureApplication(source, profile);
      assert(replayPlan.ok, `${profile.name} did not replay deterministically.`);
      assert(replayPlan.plan.id === planned.plan.id, `${profile.name} plan ID changed on replay.`);

      const beforeValidation = validationModule.validateSnapshot(source, {
        signatureProfile: profile,
      });
      const applied = patchModule.applyDeckPatch(
        source,
        {
          baseDeckVersion: planned.plan.baseDeckVersion,
          operations: planned.plan.operations,
          scope: planned.plan.scope,
        },
        2_000 + index,
      ).snapshot;
      const clientValidation = validationModule.validateSnapshot(applied, {
        signatureProfile: profile,
      });
      const serverReceipt = serverValidation.validateNodeSlideSnapshot(
        applied,
        3_000 + index,
        undefined,
        { signatureProfile: profile },
      );
      const serverReplayReceipt = serverValidation.validateNodeSlideSnapshot(
        applied,
        9_000 + index,
        undefined,
        { signatureProfile: profile },
      );
      const alreadyApplied = applyModule.planSignatureApplication(applied, profile);
      let staleReplayRejected = false;
      try {
        patchModule.applyDeckPatch(applied, {
          baseDeckVersion: planned.plan.baseDeckVersion,
          operations: planned.plan.operations,
          scope: planned.plan.scope,
        });
      } catch (error) {
        staleReplayRejected = /Stale patch/i.test(String(error));
      }

      const blockingOnBrandIssues = clientValidation.issues.filter(
        (issue) => issue.code.startsWith('on_brand_') && issue.severity !== 'info',
      );
      assert(
        clientValidation.ok,
        `${profile.name} failed client structural validation: ${JSON.stringify(summarizeValidation(clientValidation))}`,
      );
      assert(
        serverReceipt.ok,
        `${profile.name} failed server structural validation: ${JSON.stringify(summarizeValidation(serverReceipt))}`,
      );
      assert(blockingOnBrandIssues.length === 0, `${profile.name} retained on-brand blockers.`);
      assert(
        !alreadyApplied.ok && alreadyApplied.error.code === 'already_applied',
        `${profile.name} replay status was dishonest.`,
      );
      assert(staleReplayRejected, `${profile.name} stale patch replay was not rejected.`);
      const deterministicValidation =
        serverReceipt.id === serverReplayReceipt.id &&
        JSON.stringify(serverReceipt.issues.map((issue) => issue.id)) ===
          JSON.stringify(serverReplayReceipt.issues.map((issue) => issue.id));
      assert(deterministicValidation, `${profile.name} validation IDs changed with receipt time.`);

      results.push({
        profileId: profile.id,
        profileName: profile.name,
        planId: planned.plan.id,
        planElapsedMs: round(planElapsedMs),
        operationCount: planned.plan.operations.length,
        operationKinds: [
          ...new Set(planned.plan.operations.map((operation) => operation.op)),
        ].sort(),
        lockedElementIds: planned.plan.skippedLockedElementIds,
        warningCodes: [...new Set(planned.plan.warnings.map((warning) => warning.code))].sort(),
        resolvedRoles: planned.plan.resolvedTheme,
        preValidation: summarizeValidation(beforeValidation),
        postValidation: summarizeValidation(clientValidation),
        serverReceiptKeys: Object.keys(serverReceipt).sort(),
        deterministicValidation,
        visualFingerprint: digest(
          JSON.stringify({
            backgrounds: applied.slides.map((slide) => [slide.id, slide.background]),
            styles: applied.elements.map((element) => [element.id, element.style]),
          }),
        ),
        history: {
          baseDeckVersion: source.deck.version,
          resultingDeckVersion: applied.deck.version,
          normalVersionIncrement: applied.deck.version === source.deck.version + 1,
          sourceSnapshotUnchanged: JSON.stringify(source) === sourceBefore,
          staleReplayRejected,
          alreadyAppliedStatus: alreadyApplied.ok ? null : alreadyApplied.error.code,
        },
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const productionDogfood = await runProductionDogfood({
    client,
    applyModule,
    profile: profiles[0],
  });
  const malformed = structuredClone(profiles[0]);
  malformed.tokens.colors.canvas.$value.hex = '#NOTHEX';
  const malformedResult = applyModule.planSignatureApplication(source, malformed);
  const distinct = results[0].visualFingerprint !== results[1].visualFingerprint;
  const reliability = {
    BOUND:
      results.every(
        (result) => result.operationCount <= applyModule.NODESLIDE_SIGNATURE_OPERATION_LIMIT,
      ) && productionDogfood.operationBoundary.accepted512,
    HONEST_STATUS:
      results.every((result) => result.history.alreadyAppliedStatus === 'already_applied') &&
      results.every((result) => result.history.staleReplayRejected) &&
      productionDogfood.history.stalePatchRecorded,
    HONEST_SCORES: results.every((result) =>
      result.warningCodes.every((code) => typeof code === 'string' && code.length > 0),
    ),
    TIMEOUT: results.every((result) => result.planElapsedMs < 1_000),
    SSRF: fetchCalls === 0,
    BOUND_READ:
      JSON.stringify(source) === sourceBefore &&
      productionDogfood.persistence.listedProfileCount <= 50,
    ERROR_BOUNDARY:
      !malformedResult.ok &&
      malformedResult.error.code === 'schema' &&
      productionDogfood.operationBoundary.rejected513 &&
      productionDogfood.tenantIsolation.wrongOwnerDenied,
    DETERMINISTIC:
      results.every(
        (result) => typeof result.planId === 'string' && result.deterministicValidation,
      ) &&
      distinct &&
      productionDogfood.persistence.freshClientReloaded &&
      productionDogfood.history.activationWasVersioned,
  };
  assert(distinct, 'The two profile applications were not visibly distinct.');
  assert(Object.values(reliability).every(Boolean), 'A W2 reliability check failed.');

  const proof = {
    generatedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDirectory,
      encoding: 'utf8',
    }).trim(),
    sourceDirty:
      execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: rootDirectory,
        encoding: 'utf8',
      }).trim().length > 0,
    contractVersion: applyModule.NODESLIDE_SIGNATURE_APPLY_VERSION,
    sourceDeck: {
      id: source.deck.id,
      version: source.deck.version,
      slideCount: source.slides.length,
      elementCount: source.elements.length,
      digestSha256: digest(sourceBefore),
    },
    profiles: results,
    visualDistinction: {
      distinct,
      fingerprints: results.map((result) => result.visualFingerprint),
    },
    productionDogfood,
    validationReceiptShapeUnchanged: results.every(
      (result) =>
        JSON.stringify(result.serverReceiptKeys) ===
        JSON.stringify([
          'checkedAt',
          'cleanOk',
          'deckId',
          'deckVersion',
          'id',
          'issues',
          'ok',
          'publishOk',
          'toolchainVersion',
        ]),
    ),
    reliability,
  };
  assert(proof.validationReceiptShapeUnchanged, 'Validation receipt keys changed.');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ outputPath, proof }, null, 2)}\n`);
} finally {
  await vite.close();
}

async function runProductionDogfood({ client, applyModule, profile }) {
  const nonce = Date.now().toString(36);
  const workspace = await step('create disposable signature workspace', () =>
    client.mutation(api.nodeslide.ensureWorkspace, {
      clientSessionId: `nodeslide-w2-proof-${nonce}`,
    }),
  );
  const ownerAccessKey = workspace.ownerAccessKey;
  assert(ownerAccessKey, 'Disposable W2 workspace did not return an owner capability.');

  const savedProfileJson = await step('save tenant-scoped signature profile', () =>
    client.mutation(api.nodeslideSignatures.saveProfile, {
      deckId: workspace.deck.id,
      ownerAccessKey,
      profileJson: JSON.stringify(profile),
    }),
  );
  const listedProfileRows = await step('list tenant-scoped signature profiles', () =>
    client.query(api.nodeslideSignatures.listProfiles, {
      deckId: workspace.deck.id,
      ownerAccessKey,
      limit: 8,
    }),
  );
  const savedProfile = JSON.parse(savedProfileJson);
  const listedProfiles = listedProfileRows.map((row) => JSON.parse(row));
  assert(
    listedProfiles.some(
      (candidate) =>
        candidate.id === profile.id && candidate.source.digest === profile.source.digest,
    ),
    'Saved W2 profile was not durable in the tenant profile list.',
  );

  const comment = await step('create linked review comment', () =>
    client.mutation(api.nodeslide.addComment, {
      id: `comment_w2_signature_${nonce}`,
      deckId: workspace.deck.id,
      ownerAccessKey,
      anchor: { type: 'deck', deckId: workspace.deck.id },
      authorId: 'nodeslide-w2-proof',
      authorName: 'NodeSlide W2 proof',
      text: `Review and apply ${profile.name} through the normal versioned patch path.`,
    }),
  );
  const planStart = performance.now();
  const application = applyModule.planSignatureApplication(workspace, profile);
  const planElapsedMs = performance.now() - planStart;
  assert(application.ok, 'The production W2 workspace did not produce a signature plan.');
  assert(
    application.plan.operations.length > 32 &&
      application.plan.operations.length <= applyModule.NODESLIDE_SIGNATURE_OPERATION_LIMIT,
    'The production W2 plan did not exercise the expanded bounded operation path.',
  );
  const signaturePatchId = `patch_w2_signature_${nonce}`;
  const signatureClocks = clocksForOperations(
    workspace,
    application.plan.operations,
    application.plan.scope,
  );
  const applyStart = performance.now();
  const signatureReceipt = await step('apply signature through production patch mutation', () =>
    client.mutation(api.nodeslide.applyPatch, {
      id: signaturePatchId,
      deckId: workspace.deck.id,
      ownerAccessKey,
      baseDeckVersion: workspace.deck.version,
      ...signatureClocks,
      scope: application.plan.scope,
      operations: application.plan.operations,
      summary: `Applied ${profile.name} signature`,
      linkedCommentId: comment.id,
      profileId: profile.id,
      profileDigest: profile.source.digest,
    }),
  );
  const applyElapsedMs = performance.now() - applyStart;
  assert(
    signatureReceipt.patch.status === 'accepted',
    'Production signature patch was not accepted.',
  );
  assert(
    signatureReceipt.patch.profileId === profile.id,
    'Production signature patch omitted its durable profile reference.',
  );
  assert(
    signatureReceipt.patch.profileDigest === profile.source.digest,
    'Production signature patch omitted its immutable profile digest.',
  );
  assert(
    signatureReceipt.workspace.deck.activeSignatureProfileId === profile.id &&
      signatureReceipt.workspace.deck.activeSignatureProfileDigest === profile.source.digest,
    'Production signature patch did not atomically activate the profile.',
  );
  assert(
    signatureReceipt.validation.publishOk &&
      !signatureReceipt.validation.issues.some(
        (issue) => issue.code.startsWith('on_brand_') && issue.severity !== 'info',
      ),
    'Production signature patch did not produce a publishable on-brand receipt.',
  );

  const appliedWorkspace = await step('reload applied signature workspace', () =>
    client.query(api.nodeslide.getWorkspace, {
      deckId: workspace.deck.id,
      ownerAccessKey,
    }),
  );
  assert(appliedWorkspace, 'Applied W2 workspace could not be reloaded.');
  const appliedVersion = appliedWorkspace.versions.find(
    (version) => version.patchId === signaturePatchId,
  );
  const resolvedComment = appliedWorkspace.comments.find(
    (candidate) => candidate.id === comment.id,
  );
  assert(
    appliedVersion?.version === signatureReceipt.workspace.deck.version,
    'Signature patch did not produce a normal version receipt.',
  );
  assert(
    resolvedComment?.status === 'resolved' && resolvedComment.linkedPatchId === signaturePatchId,
    'Signature patch did not resolve and link its review comment.',
  );

  const target = appliedWorkspace.elements.find(
    (element) => !element.locked && element.kind === 'text',
  );
  assert(target, 'Applied W2 workspace has no editable text element for validation dogfood.');
  const offBrandOperations = [
    {
      op: 'update_style',
      slideId: target.slideId,
      elementId: target.id,
      properties: { color: '#FF00FF' },
    },
  ];
  const offBrandScope = {
    kind: 'elements',
    deckId: appliedWorkspace.deck.id,
    slideIds: [target.slideId],
    elementIds: [target.id],
    operationMode: 'style',
  };
  const offBrandReceipt = await step('verify active-profile off-brand detection', () =>
    client.mutation(api.nodeslide.applyPatch, {
      id: `patch_w2_off_brand_${nonce}`,
      deckId: appliedWorkspace.deck.id,
      ownerAccessKey,
      baseDeckVersion: appliedWorkspace.deck.version,
      ...clocksForOperations(appliedWorkspace, offBrandOperations, offBrandScope),
      scope: offBrandScope,
      operations: offBrandOperations,
      summary: 'W2 disposable off-brand validation probe',
    }),
  );
  const offBrandIssueCodes = [
    ...new Set(
      offBrandReceipt.validation.issues
        .filter((issue) => issue.code.startsWith('on_brand_'))
        .map((issue) => issue.code),
    ),
  ].sort();
  assert(
    !offBrandReceipt.validation.publishOk && offBrandIssueCodes.includes('on_brand_color'),
    'The durable active profile did not flag an off-brand follow-up edit.',
  );

  const restoreReceipt = await step('restore clean on-brand version', () =>
    client.mutation(api.nodeslide.restoreVersion, {
      deckId: workspace.deck.id,
      ownerAccessKey,
      versionId: appliedVersion.id,
      baseDeckVersion: offBrandReceipt.workspace.deck.version,
    }),
  );
  assert(
    restoreReceipt.patch.status === 'accepted' && restoreReceipt.validation.publishOk,
    'Restoring the clean signature version did not produce a publishable receipt.',
  );
  assert(
    restoreReceipt.workspace.deck.activeSignatureProfileId === profile.id,
    'Version restore did not preserve the durable active signature profile.',
  );

  const activatedWorkspace = await step('re-activate already-applied durable profile', () =>
    client.mutation(api.nodeslideSignatures.activateProfile, {
      deckId: workspace.deck.id,
      ownerAccessKey,
      profileId: profile.id,
      profileDigest: profile.source.digest,
      baseDeckVersion: restoreReceipt.workspace.deck.version,
    }),
  );
  assert(activatedWorkspace, 'Already-applied durable profile activation returned no workspace.');
  assert(
    activatedWorkspace.deck.version === restoreReceipt.workspace.deck.version + 1,
    'Profile activation did not create an auditable policy version.',
  );

  const freshClient = new ConvexHttpClient(convexUrl);
  const freshReload = await step('reload profile from a fresh client', () =>
    freshClient.query(api.nodeslide.getWorkspace, {
      deckId: workspace.deck.id,
      ownerAccessKey,
    }),
  );
  const freshProfileRows = await freshClient.query(api.nodeslideSignatures.listProfiles, {
    deckId: workspace.deck.id,
    ownerAccessKey,
    limit: 8,
  });
  const freshProfiles = freshProfileRows.map((row) => JSON.parse(row));
  const freshClientReloaded = Boolean(
    freshReload?.deck.activeSignatureProfileId === profile.id &&
      freshProfiles.some(
        (candidate) =>
          candidate.id === profile.id && candidate.source.digest === profile.source.digest,
      ),
  );
  assert(freshClientReloaded, 'A fresh client could not reload the durable active profile.');

  const staleTarget = workspace.elements.find(
    (element) => element.kind === 'text' && !element.locked && element.content,
  );
  assert(staleTarget, 'The disposable W2 workspace has no text element for the stale CAS probe.');
  const staleOperations = [
    {
      op: 'replace_text',
      slideId: staleTarget.slideId,
      elementId: staleTarget.id,
      text: `${staleTarget.content} Stale CAS probe.`,
    },
  ];
  const staleScope = {
    kind: 'elements',
    deckId: workspace.deck.id,
    slideIds: [staleTarget.slideId],
    elementIds: [staleTarget.id],
    operationMode: 'copy',
  };
  const staleReceipt = await step('exercise stale signature CAS path', () =>
    client.mutation(api.nodeslide.applyPatch, {
      id: `patch_w2_stale_${nonce}`,
      deckId: workspace.deck.id,
      ownerAccessKey,
      baseDeckVersion: workspace.deck.version,
      ...clocksForOperations(workspace, staleOperations, staleScope),
      scope: staleScope,
      operations: staleOperations,
      summary: 'W2 stale active-signature CAS probe',
    }),
  );
  assert(staleReceipt.patch.status === 'stale', 'Stale production signature replay was accepted.');
  const afterStale = await client.query(api.nodeslide.getWorkspace, {
    deckId: workspace.deck.id,
    ownerAccessKey,
  });
  assert(
    afterStale?.deck.version === activatedWorkspace.deck.version,
    'Stale signature replay changed the durable deck version.',
  );

  const wrongOwnerDenied = await captureFailure(() =>
    freshClient.query(api.nodeslideSignatures.listProfiles, {
      deckId: workspace.deck.id,
      ownerAccessKey: 'A'.repeat(43),
      limit: 1,
    }),
  );
  assert(wrongOwnerDenied, 'Wrong-owner profile listing unexpectedly succeeded.');

  const boundaryWorkspace = await step('create disposable operation-boundary workspace', () =>
    client.mutation(api.nodeslide.ensureWorkspace, {
      clientSessionId: `nodeslide-w2-boundary-${nonce}`,
    }),
  );
  const boundaryOwnerAccessKey = boundaryWorkspace.ownerAccessKey;
  assert(boundaryOwnerAccessKey, 'W2 boundary workspace did not return an owner capability.');
  const crossTenantProfileRows = await client.query(api.nodeslideSignatures.listProfiles, {
    deckId: boundaryWorkspace.deck.id,
    ownerAccessKey: boundaryOwnerAccessKey,
    limit: 8,
  });
  const crossTenantProfiles = crossTenantProfileRows.map((row) => JSON.parse(row));
  assert(
    !crossTenantProfiles.some((candidate) => candidate.id === profile.id),
    'A signature profile leaked into another tenant.',
  );
  const boundaryTarget = boundaryWorkspace.elements.find((element) => !element.locked);
  assert(boundaryTarget, 'W2 boundary workspace has no editable element.');
  const boundaryScope = {
    kind: 'elements',
    deckId: boundaryWorkspace.deck.id,
    slideIds: [boundaryTarget.slideId],
    elementIds: [boundaryTarget.id],
    operationMode: 'style',
  };
  const operations513 = Array.from({ length: 513 }, (_, index) => ({
    op: 'update_style',
    slideId: boundaryTarget.slideId,
    elementId: boundaryTarget.id,
    properties: { opacity: 0.1 + ((index + 1) / 514) * 0.8 },
  }));
  const rejected513 = await captureFailure(() =>
    client.mutation(api.nodeslide.applyPatch, {
      id: `patch_w2_513_${nonce}`,
      deckId: boundaryWorkspace.deck.id,
      ownerAccessKey: boundaryOwnerAccessKey,
      baseDeckVersion: boundaryWorkspace.deck.version,
      ...clocksForOperations(boundaryWorkspace, operations513, boundaryScope),
      scope: boundaryScope,
      operations: operations513,
      summary: 'W2 513-operation rejection probe',
    }),
  );
  const afterRejectedBoundary = await client.query(api.nodeslide.getWorkspace, {
    deckId: boundaryWorkspace.deck.id,
    ownerAccessKey: boundaryOwnerAccessKey,
  });
  assert(
    rejected513 && afterRejectedBoundary?.deck.version === boundaryWorkspace.deck.version,
    'The 513-operation rejection was not atomic.',
  );
  const operations512 = operations513.slice(0, 512);
  const boundaryStart = performance.now();
  const accepted512Receipt = await step('accept exact 512-operation boundary patch', () =>
    client.mutation(api.nodeslide.applyPatch, {
      id: `patch_w2_512_${nonce}`,
      deckId: boundaryWorkspace.deck.id,
      ownerAccessKey: boundaryOwnerAccessKey,
      baseDeckVersion: boundaryWorkspace.deck.version,
      ...clocksForOperations(boundaryWorkspace, operations512, boundaryScope),
      scope: boundaryScope,
      operations: operations512,
      summary: 'W2 exact 512-operation acceptance probe',
    }),
  );
  const boundaryElapsedMs = performance.now() - boundaryStart;
  assert(
    accepted512Receipt.patch.status === 'accepted' &&
      accepted512Receipt.workspace.deck.version === boundaryWorkspace.deck.version + 1,
    'The exact 512-operation production boundary was not accepted.',
  );

  return {
    deploymentUrl: convexUrl,
    disposableDeckId: workspace.deck.id,
    plan: {
      id: application.plan.id,
      elapsedMs: round(planElapsedMs),
      operationCount: application.plan.operations.length,
    },
    application: {
      elapsedMs: round(applyElapsedMs),
      patchId: signaturePatchId,
      baseDeckVersion: workspace.deck.version,
      resultingDeckVersion: signatureReceipt.workspace.deck.version,
      profileId: signatureReceipt.patch.profileId,
      activeProfileDigest: signatureReceipt.workspace.deck.activeSignatureProfileDigest,
      validation: summarizeValidation(signatureReceipt.validation),
    },
    persistence: {
      savedProfileId: savedProfile.id,
      listedProfileCount: listedProfiles.length,
      freshClientReloaded,
    },
    history: {
      versionReceiptId: appliedVersion.id,
      linkedCommentId: resolvedComment.id,
      linkedCommentResolved: resolvedComment.status === 'resolved',
      offBrandIssueCodes,
      offBrandPublishBlocked: !offBrandReceipt.validation.publishOk,
      restoredDeckVersion: restoreReceipt.workspace.deck.version,
      restorePublishOk: restoreReceipt.validation.publishOk,
      activationWasVersioned:
        activatedWorkspace.deck.version === restoreReceipt.workspace.deck.version + 1,
      stalePatchRecorded: staleReceipt.patch.status === 'stale',
      staleReplayWasVersionNeutral: afterStale.deck.version === activatedWorkspace.deck.version,
    },
    operationBoundary: {
      rejected513,
      rejectionWasAtomic: afterRejectedBoundary.deck.version === boundaryWorkspace.deck.version,
      accepted512: accepted512Receipt.patch.status === 'accepted',
      acceptedOperationCount: operations512.length,
      elapsedMs: round(boundaryElapsedMs),
    },
    tenantIsolation: {
      wrongOwnerDenied,
      crossTenantProfileCount: crossTenantProfiles.length,
      profileLeakageDenied: !crossTenantProfiles.some((candidate) => candidate.id === profile.id),
    },
  };
}

function clocksForOperations(workspace, operations, scope) {
  const slideIds = new Set();
  const elementIds = new Set();
  for (const operation of operations) {
    if (typeof operation.slideId === 'string') slideIds.add(operation.slideId);
    if (typeof operation.elementId === 'string' && operation.op !== 'add_element') {
      elementIds.add(operation.elementId);
    }
    if (operation.op === 'remove_slide') {
      for (const element of workspace.elements) {
        if (element.slideId === operation.slideId) elementIds.add(element.id);
      }
    }
  }
  if (operations.length === 0 && scope.kind === 'deck') {
    for (const slide of workspace.slides) slideIds.add(slide.id);
    for (const element of workspace.elements) elementIds.add(element.id);
  }
  return {
    baseSlideVersions: Object.fromEntries(
      workspace.slides
        .filter((slide) => slideIds.has(slide.id))
        .map((slide) => [slide.id, slide.version]),
    ),
    baseElementVersions: Object.fromEntries(
      workspace.elements
        .filter((element) => elementIds.has(element.id))
        .map((element) => [element.id, element.version]),
    ),
  };
}

async function captureFailure(operation) {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

async function step(label, operation) {
  const startedAt = performance.now();
  process.stdout.write(`[w2-proof] ${label}...\n`);
  try {
    const result = await operation();
    process.stdout.write(
      `[w2-proof] ${label} ok (${Math.round(performance.now() - startedAt)}ms)\n`,
    );
    return result;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`[w2-proof] ${label} failed: ${details}`, { cause: error });
  }
}

async function readConvexUrl() {
  try {
    const contents = await readFile(path.join(rootDirectory, '.env.local'), 'utf8');
    return contents.match(/^VITE_CONVEX_URL=(.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function summarizeValidation(validation) {
  return {
    ok: validation.ok,
    publishOk: validation.publishOk,
    cleanOk: validation.cleanOk,
    issueCount: validation.issues.length,
    onBrandBlockingCount: validation.issues.filter(
      (issue) => issue.code.startsWith('on_brand_') && issue.severity !== 'info',
    ).length,
    issueCodes: [...new Set(validation.issues.map((issue) => issue.code))].sort(),
  };
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
