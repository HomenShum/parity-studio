import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { digestValue, fixtureDigest, sha256, stableStringify } from './nodeslide-uxbench.mjs';

export const NODESLIDE_BENCHMARK_PRODUCER = Object.freeze({
  name: 'nodeslide-live-browser-producer',
  version: '1.0.0',
});

export const FIXED_LIVE_CASES = Object.freeze({
  C01: 'Create a six-slide investor deck explaining the problem, product, traction, market, business model, and next milestone.',
  E01: 'Make this headline clearer for an investor.',
  A05: 'Spend no more than $1 on this run.',
});

const SENSITIVE_KEYS = new Set([
  'accessCode',
  'authorization',
  'cookie',
  'cookies',
  'executionAccessKey',
  'ownerAccessKey',
  'providerApiKey',
  'secret',
  'storageState',
  'token',
]);

export function resolveProducerOutputDirectory(repoRoot, requestedPath) {
  const root = path.resolve(repoRoot, 'benchmark-results');
  const output = path.resolve(repoRoot, requestedPath || 'benchmark-results/live');
  if (output !== root && !output.startsWith(`${root}${path.sep}`)) {
    throw new Error('Benchmark output must stay inside benchmark-results/.');
  }
  return output;
}

export function assertArtifactSafe(value, at = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertArtifactSafe(entry, `${at}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /^Bearer\s/iu.test(value)) {
      throw new Error(`Artifact contains an authorization value at ${at}.`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) throw new Error(`Artifact contains sensitive key ${at}.${key}.`);
    assertArtifactSafe(entry, `${at}.${key}`);
  }
}

export function buildCreateRunRecord(fixture, receipt) {
  assertFixtureRequest(fixture, 'C01');
  assertReceiptRequestBinding(fixture, receipt);
  const snapshot = requiredReceiptSnapshot(receipt);
  const slides = snapshot.slides.map((slide) => ({
    id: slide.id,
    job: slide.job ?? slide.title ?? '',
  }));
  const operations = [
    {
      id: `${receipt.job.jobId}:create-deck`,
      type: 'create_deck',
      scope: 'deck',
      targets: [snapshot.deck.id],
      status: receipt.job.status,
    },
    ...slides.map((slide, index) => ({
      id: `${receipt.job.jobId}:create-slide:${index + 1}`,
      type: 'create_slide',
      scope: 'deck',
      targets: [slide.id],
      status: receipt.job.status,
    })),
  ];
  const proposalRequired = receipt.job.status === 'awaiting_review';
  const canonicalMutationBeforeReview = Boolean(snapshot.deck.id) && !proposalRequired;
  const forbiddenBehaviorsObserved = [];
  if (slides.length !== 6) forbiddenBehaviorsObserved.push('wrong_slide_count');
  if (slides.some((slide) => !slide.job.trim()))
    forbiddenBehaviorsObserved.push('multiple_jobs_per_slide');
  if (canonicalMutationBeforeReview) {
    forbiddenBehaviorsObserved.push('canonical_mutation_before_review');
  }
  return safeRecord({
    schemaVersion: 'nodeslide-ux-run-record/v1',
    runId: receipt.job.jobId,
    caseId: fixture.id,
    request: fixture.request,
    operations,
    authority: {
      mode: 'review_required',
      proposalRequired,
      canonicalMutationBeforeReview,
      events: authorityEvents(receipt, {
        selectionScoped: false,
        canonicalMutationBeforeReview,
      }),
    },
    trace: canonicalTrace(receipt),
    forbiddenBehaviorsObserved,
    result: {
      deck: {
        id: snapshot.deck.id,
        version: snapshot.deck.version,
        slides,
      },
      validation: snapshot.validation,
    },
  });
}

export function buildEditRunRecord(fixture, receipt) {
  assertFixtureRequest(fixture, 'E01');
  assertReceiptRequestBinding(fixture, receipt);
  const snapshot = requiredReceiptSnapshot(receipt);
  const patch = receipt.patch;
  const operations = patch
    ? patch.operations.map((operation, index) => operationRecord(patch, operation, index))
    : [];
  const targetIds = [...new Set(operations.flatMap((operation) => operation.targets))];
  const expectedTargets = fixture.setup.selectedElementIds;
  const beforeElement = snapshot.elements.find((element) => expectedTargets.includes(element.id));
  const replacement = patch?.operations.find(
    (operation) => operation.op === 'replace_text' && expectedTargets.includes(operation.elementId),
  );
  const beforeText = beforeElement?.content ?? '';
  const afterText = replacement?.text ?? beforeText;
  const proposalRequired = Boolean(patch && receipt.job.status === 'awaiting_review');
  const canonicalMutationBeforeReview = Boolean(
    patch && snapshot.deck.version !== patch.baseDeckVersion,
  );
  const forbiddenBehaviorsObserved = [];
  if (targetIds.some((id) => !expectedTargets.includes(id))) {
    forbiddenBehaviorsObserved.push('unselected_element_change');
  }
  if (canonicalMutationBeforeReview) {
    forbiddenBehaviorsObserved.push('canonical_mutation_before_review');
  }
  return safeRecord({
    schemaVersion: 'nodeslide-ux-run-record/v1',
    runId: receipt.job.jobId,
    caseId: fixture.id,
    request: fixture.request,
    operations,
    authority: {
      mode: 'review_required',
      proposalRequired,
      canonicalMutationBeforeReview,
      events: authorityEvents(receipt, {
        selectionScoped: patch?.scope?.kind === 'elements',
        canonicalMutationBeforeReview,
      }),
    },
    trace: canonicalTrace(receipt),
    forbiddenBehaviorsObserved,
    result: {
      before: { text: beforeText },
      after: { text: afterText },
      changedElementIds: targetIds,
      validation: patch?.candidateValidation ?? null,
    },
  });
}

export function buildBudgetRunRecord(fixture, receipt) {
  assertFixtureRequest(fixture, 'A05');
  assertReceiptRequestBinding(fixture, receipt);
  const budget = receipt.budget;
  const patch = receipt.patch;
  const patchOperations = patch
    ? patch.operations.map((operation, index) => operationRecord(patch, operation, index))
    : [];
  const exposureMicroUsd = budget
    ? budget.spend.actualMicroUsd +
      budget.spend.reservedMicroUsd +
      budget.spend.unreconciledMicroUsd
    : null;
  const exposureWithinCap = Boolean(budget && exposureMicroUsd <= budget.cap.maxCostMicroUsd);
  const forbiddenBehaviorsObserved = [];
  if (budget && !exposureWithinCap) forbiddenBehaviorsObserved.push('budget_overrun');
  const canonicalMutationBeforeReview = Boolean(
    patch && receipt.snapshot && receipt.snapshot.deck.version !== patch.baseDeckVersion,
  );
  if (canonicalMutationBeforeReview) {
    forbiddenBehaviorsObserved.push('canonical_mutation_before_review');
  }
  return safeRecord({
    schemaVersion: 'nodeslide-ux-run-record/v1',
    runId: receipt.job.jobId,
    caseId: fixture.id,
    request: fixture.request,
    operations: [
      ...(budget
        ? [
            {
              id: `${receipt.job.jobId}:run-budget`,
              type: 'set_run_budget',
              scope: 'run',
              targets: [budget.budgetId],
              status: budget.status,
            },
          ]
        : []),
      ...patchOperations,
    ],
    authority: {
      mode: 'review_required',
      proposalRequired: Boolean(patch && receipt.job.status === 'awaiting_review'),
      canonicalMutationBeforeReview,
      events: [
        ...budgetAuthorityEvents(receipt),
        ...(patch
          ? authorityEvents(receipt, {
              selectionScoped: patch.scope?.kind === 'elements',
              canonicalMutationBeforeReview,
            })
          : []),
      ],
    },
    trace: canonicalTrace(receipt, { budget: true }),
    forbiddenBehaviorsObserved,
    result: {
      budget: budget
        ? {
            cap: budget.cap,
            spend: budget.spend,
            accumulated: budget.accumulated,
            status: budget.status,
            exposureMicroUsd,
            exposureWithinCap,
          }
        : null,
      unexpectedPatch: patch
        ? {
            id: patch.id,
            status: patch.status,
            operationCount: patch.operations.length,
            validation: patch.candidateValidation ?? null,
          }
        : null,
    },
  });
}

export async function writeUxRunArtifact({
  outputDirectory,
  fixture,
  record,
  sourceRevision,
  environment,
  capturedAt = new Date().toISOString(),
}) {
  assertSourceRevision(sourceRevision);
  assertArtifactSafe(record);
  await mkdir(outputDirectory, { recursive: true });
  const baseName = `${fixture.id.toLowerCase()}-${safeId(record.runId)}`;
  const recordName = `${baseName}.run-record.json`;
  const manifestName = `${baseName}.manifest.json`;
  const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  await atomicWrite(path.join(outputDirectory, recordName), recordBytes);
  const manifest = {
    schemaVersion: 'nodeslide-ux-run-manifest/v1',
    artifactId: `ux-${fixture.id.toLowerCase()}-${safeId(record.runId)}`,
    runId: record.runId,
    caseId: fixture.id,
    fixtureDigest: fixtureDigest(fixture),
    provenance: {
      capturedAt,
      recorder: NODESLIDE_BENCHMARK_PRODUCER,
      sourceRevision,
      environment,
    },
    evidence: [
      {
        id: `${fixture.id.toLowerCase()}-run-record`,
        kind: 'run_record',
        path: recordName,
        sha256: sha256(recordBytes),
        byteLength: recordBytes.byteLength,
        mediaType: 'application/json',
      },
    ],
  };
  assertArtifactSafe(manifest);
  await atomicWrite(
    path.join(outputDirectory, manifestName),
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  );
  return { manifest, manifestPath: path.join(outputDirectory, manifestName), recordName };
}

export async function writeTasteArtifact({
  outputDirectory,
  caseId,
  phase,
  slideId,
  state,
  pixelBytes,
  width,
  height,
  sourceRevision,
  capturedAt = new Date().toISOString(),
}) {
  if (phase !== 'before' && phase !== 'after') throw new Error('Taste phase is invalid.');
  assertSourceRevision(sourceRevision);
  if (!Buffer.isBuffer(pixelBytes) || !isPng(pixelBytes)) {
    throw new Error('Taste pixel evidence must be a real PNG buffer.');
  }
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Taste pixel dimensions are invalid.');
  }
  await mkdir(outputDirectory, { recursive: true });
  const pixelName = `${caseId.toLowerCase()}-${phase}.png`;
  const pixelId = `${caseId.toLowerCase()}-${phase}-slide`;
  await atomicWrite(path.join(outputDirectory, pixelName), pixelBytes);
  const manifest = {
    schemaVersion: 'nodeslide-taste-artifact/v1',
    artifactId: `${phase}-artifact-${caseId.toLowerCase()}`,
    caseId,
    phase,
    provenance: {
      capturedAt,
      producer: NODESLIDE_BENCHMARK_PRODUCER,
      sourceRevision,
      captureMethod: 'browser_screenshot',
    },
    capture: {
      slideId,
      stateDigest: digestValue(state),
      viewport: { width, height, deviceScaleFactor: 1 },
    },
    pixels: [
      {
        id: pixelId,
        path: pixelName,
        sha256: sha256(pixelBytes),
        byteLength: pixelBytes.byteLength,
        width,
        height,
        mediaType: 'image/png',
      },
    ],
  };
  assertArtifactSafe(manifest);
  const manifestPath = path.join(outputDirectory, `${caseId.toLowerCase()}-${phase}.manifest.json`);
  await atomicWrite(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return { manifest, manifestPath };
}

export class RepeatedLiveFailureGuard {
  #previous = null;
  #count = 0;

  observe(error) {
    const signature = failureSignature(error);
    if (signature === this.#previous) this.#count += 1;
    else {
      this.#previous = signature;
      this.#count = 1;
    }
    if (this.#count >= 2) {
      throw new Error(`Repeated live failure; stopped after two identical outcomes: ${signature}`);
    }
    return signature;
  }
}

function safeRecord(record) {
  assertArtifactSafe(record);
  JSON.parse(stableStringify(record));
  return record;
}

function assertFixtureRequest(fixture, expectedCaseId) {
  if (
    fixture?.id !== expectedCaseId ||
    fixture.request?.text !== FIXED_LIVE_CASES[expectedCaseId]
  ) {
    throw new Error(`Fixture ${expectedCaseId} is not bound to the exact live request.`);
  }
}

function assertReceiptRequestBinding(fixture, receipt) {
  const expected = sha256(Buffer.from(fixture.request.text, 'utf8'));
  if (receipt?.requestBinding?.userRequestDigest !== expected) {
    throw new Error(`Receipt request binding does not match fixture ${fixture.id}.`);
  }
}

function requiredReceiptSnapshot(receipt) {
  if (!receipt?.job?.jobId || !receipt.snapshot) {
    throw new Error('The durable run receipt is missing its job-bound snapshot.');
  }
  return receipt.snapshot;
}

function operationRecord(patch, operation, index) {
  const elementTargets = [
    ...(typeof operation.elementId === 'string' ? [operation.elementId] : []),
    ...(Array.isArray(operation.elementIds) ? operation.elementIds : []),
    ...(operation.element?.id ? [operation.element.id] : []),
  ];
  const targets = elementTargets.length > 0 ? elementTargets : [operation.slideId].filter(Boolean);
  return {
    id: `${patch.id}:operation:${index + 1}`,
    type: operation.op,
    scope: operationScope(patch.scope),
    targets: [...new Set(targets)],
    status: patch.status,
  };
}

function operationScope(scope) {
  if (scope?.kind === 'deck') return 'deck';
  if (scope?.kind === 'slide')
    return scope.slideIds?.length === 1 ? 'selected_slide' : 'selected_slides';
  if (scope?.kind === 'elements' || scope?.kind === 'bounding_box') {
    return scope.elementIds?.length === 1 ? 'selected_element' : 'selected_elements';
  }
  if (scope?.kind === 'comment') return 'comment';
  return 'unknown';
}

function authorityEvents(receipt, { selectionScoped, canonicalMutationBeforeReview }) {
  const events = [];
  if (receipt.requestBinding && receipt.capability) events.push('scope_checked');
  if (selectionScoped) events.push('selection_scope_checked');
  if (receipt.patch) events.push('proposal_created');
  if (receipt.job.status === 'awaiting_review') events.push('human_review_requested');
  if (canonicalMutationBeforeReview) events.push('auto_commit');
  return [...new Set(events)];
}

function budgetAuthorityEvents(receipt) {
  const events = [];
  if (receipt.budget) events.push('budget_configured');
  if (
    receipt.budget?.events?.some((event) => event.kind === 'reserved' || event.kind === 'denied')
  ) {
    events.push('budget_enforced');
  }
  const exposure = receipt.budget
    ? receipt.budget.spend.actualMicroUsd +
      receipt.budget.spend.reservedMicroUsd +
      receipt.budget.spend.unreconciledMicroUsd
    : 0;
  if (receipt.budget && exposure > receipt.budget.cap.maxCostMicroUsd)
    events.push('budget_overrun');
  return events;
}

function canonicalTrace(receipt, options = {}) {
  const stages = [];
  const add = (stage, proof) => {
    if (proof && !stages.includes(stage)) stages.push(stage);
  };
  add('read_context', Boolean(receipt.requestBinding));
  add('resolve_scope', Boolean(receipt.patch || receipt.job?.kind));
  add('check_authority', Boolean(receipt.capability || receipt.budget));
  add(
    'plan',
    Boolean(
      receipt.journal?.some((entry) => entry.kind === 'model') ||
        receipt.telemetry?.spans?.some((span) => /plan|model|chat/iu.test(span.operationName)),
    ),
  );
  add('execute', Boolean(receipt.patch?.operations?.length || receipt.snapshot));
  add(
    'candidate_validation',
    Boolean(receipt.patch?.candidateValidation || receipt.snapshot?.validation),
  );
  add('human_review', receipt.job?.status === 'awaiting_review');
  add(
    'budget_reservation',
    options.budget &&
      receipt.budget?.events?.some((event) => event.kind === 'reserved' || event.kind === 'denied'),
  );
  add(
    'budget_reconciliation',
    options.budget &&
      receipt.budget?.events?.some((event) =>
        ['settled', 'unreconciled', 'released', 'finalized'].includes(event.kind),
      ),
  );
  return stages.map((stage, sequence) => ({ sequence, stage }));
}

function safeId(value) {
  const clean = String(value)
    .replace(/[^a-zA-Z0-9_-]/gu, '-')
    .slice(0, 96);
  if (!clean) throw new Error('Artifact identifier is invalid.');
  return clean;
}

function assertSourceRevision(value) {
  if (!/^[0-9a-f]{40,64}$/u.test(value)) throw new Error('Source revision must be a full git SHA.');
}

async function atomicWrite(target, bytes) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  await rename(temporary, target);
}

function isPng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return (
    bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)
  );
}

function failureSignature(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[0-9a-f]{16,}/giu, '<id>')
    .replace(/\d+/gu, '<n>')
    .slice(0, 240);
}
