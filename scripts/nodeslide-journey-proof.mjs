import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const JOURNEY_PROOF_VERSION = 'nodeslide.journey-proof/v2';
export const REQUIRED_JOURNEY_STEPS = [
  'brief_submitted',
  'deck_created',
  'edit_submitted',
  'validation_received',
  'edit_applied',
  'undo_verified',
  'redo_verified',
  'version_advanced',
  'export_downloaded',
];

const REQUIRED_ARTIFACTS = {
  rawRecordingPath: ['.webm', '.mp4'],
  gifPath: ['.gif'],
  finalScreenshotPath: ['.png', '.jpg', '.jpeg'],
  exportedDeckPath: ['.pptx'],
  runManifestPath: ['.json'],
};

export async function finalizeNodeSlideJourneyProof(manifestPath, outputPath) {
  const absoluteManifest = path.resolve(manifestPath);
  const manifest = JSON.parse(await readFile(absoluteManifest, 'utf8'));
  const artifacts = { ...manifest.artifacts, runManifestPath: absoluteManifest };
  const partial = {
    schemaVersion: JOURNEY_PROOF_VERSION,
    deckId: manifest.deckId,
    expectedCreationProvenance: manifest.expectedCreationProvenance,
    actualCreationProvenance: manifest.actualCreationProvenance,
    baseVersion: manifest.baseVersion,
    appliedVersion: manifest.appliedVersion,
    finalVersion: manifest.finalVersion,
    steps: manifest.steps,
    artifacts,
  };
  const proof = { ...partial, digest: durableDigest(partial) };
  const result = await verifyNodeSlideJourneyProofFiles(proof);
  if (!result.ok) {
    throw new Error(
      `NodeSlide journey proof failed:\n${result.findings.map((item) => `- ${item}`).join('\n')}`,
    );
  }
  const target = path.resolve(
    outputPath ?? path.join(path.dirname(absoluteManifest), 'journey-proof.json'),
  );
  await writeFile(target, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  return { proof, outputPath: target, result };
}

export async function verifyNodeSlideJourneyProofFiles(proof) {
  const findings = [];
  const legacy = proof?.schemaVersion === 'nodeslide.journey-proof/v1';
  if (!proof || (!legacy && proof.schemaVersion !== JOURNEY_PROOF_VERSION))
    findings.push('Unsupported journey proof schema.');
  if (!proof?.deckId || typeof proof.deckId !== 'string') findings.push('A deckId is required.');
  const { digest, ...partial } = proof ?? {};
  if (digest !== durableDigest(partial)) findings.push('Journey proof digest mismatch.');
  if (proof?.expectedCreationProvenance !== proof?.actualCreationProvenance) {
    findings.push('The actual creation provenance does not match the requested journey.');
  }
  if (legacy) {
    verifyLegacyJourneyStructure(proof, findings);
    await verifyArtifacts(proof, findings);
    return { ok: findings.length === 0, findings };
  }
  if (
    !Number.isSafeInteger(proof?.baseVersion) ||
    !Number.isSafeInteger(proof?.appliedVersion) ||
    !Number.isSafeInteger(proof?.finalVersion) ||
    proof.appliedVersion !== proof.baseVersion + 1 ||
    proof.finalVersion !== proof.appliedVersion + 2
  ) {
    findings.push('The edit, Undo, and Redo must each advance exactly once.');
  }
  const steps = Array.isArray(proof?.steps) ? proof.steps : [];
  const positions = REQUIRED_JOURNEY_STEPS.map((kind) =>
    steps.findIndex((step) => step?.kind === kind),
  );
  for (const [index, position] of positions.entries()) {
    if (position < 0) findings.push(`Missing journey step: ${REQUIRED_JOURNEY_STEPS[index]}.`);
    if (index > 0 && position >= 0 && positions[index - 1] >= position) {
      findings.push(`Journey step is out of order: ${REQUIRED_JOURNEY_STEPS[index]}.`);
    }
  }
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index]?.occurredAt < steps[index - 1]?.occurredAt)
      findings.push('Journey timestamps are not monotonic.');
  }
  for (const kind of ['validation_received', 'edit_applied', 'undo_verified', 'redo_verified']) {
    if (!isSha256Digest(steps.find((step) => step?.kind === kind)?.receiptDigest))
      findings.push(`${kind} is not bound to a receipt digest.`);
  }
  const validation = steps.find((step) => step?.kind === 'validation_received');
  const applied = steps.find((step) => step?.kind === 'edit_applied');
  const undone = steps.find((step) => step?.kind === 'undo_verified');
  const redone = steps.find((step) => step?.kind === 'redo_verified');
  if (
    !validation?.runId ||
    !validation.patchId ||
    !validation.candidateDigest ||
    validation.runId !== applied?.runId ||
    validation.patchId !== applied?.patchId ||
    validation.candidateDigest !== applied?.candidateDigest ||
    validation.baseDeckVersion !== proof?.baseVersion ||
    applied?.baseDeckVersion !== proof?.baseVersion ||
    applied?.resultingDeckVersion !== proof?.appliedVersion ||
    applied?.deckVersion !== proof?.appliedVersion ||
    undone?.patchId !== applied?.patchId ||
    undone?.deckVersion !== proof?.appliedVersion + 1 ||
    !isSha256Digest(undone?.contentDigest) ||
    redone?.patchId !== applied?.patchId ||
    redone?.deckVersion !== proof?.finalVersion ||
    !isSha256Digest(redone?.contentDigest) ||
    redone?.contentDigest !== applied?.contentDigest
  ) {
    findings.push('Validation, apply, Undo, and Redo are not bound to one durable edit receipt.');
  }
  await verifyArtifacts(proof, findings);
  return { ok: findings.length === 0, findings };
}

async function verifyArtifacts(proof, findings) {
  for (const [key, extensions] of Object.entries(REQUIRED_ARTIFACTS)) {
    const artifact = proof?.artifacts?.[key];
    if (!artifact || typeof artifact !== 'string') {
      findings.push(`Missing artifact path: ${key}.`);
      continue;
    }
    const absolute = path.resolve(artifact);
    const extension = path.extname(absolute).toLowerCase();
    if (!extensions.includes(extension)) findings.push(`${key} has an unsupported extension.`);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile() || info.size === 0) findings.push(`${key} does not exist or is empty.`);
    else if (!(await hasExpectedMagic(key, absolute)))
      findings.push(`${key} does not match its expected file format.`);
  }
  if (proof?.artifacts?.rawRecordingPath === proof?.artifacts?.gifPath) {
    findings.push('Raw recording and GIF must be separate artifacts.');
  }
}

function verifyLegacyJourneyStructure(proof, findings) {
  if (
    !Number.isSafeInteger(proof?.baseVersion) ||
    !Number.isSafeInteger(proof?.acceptedVersion) ||
    proof.acceptedVersion !== proof.baseVersion + 1
  ) {
    findings.push('The legacy Accept receipt must advance exactly once.');
  }
  const required = [
    'brief_submitted',
    'deck_created',
    'proposal_ready',
    'compare_opened',
    'validation_received',
    'proposal_accepted',
    'version_advanced',
    'export_downloaded',
  ];
  const steps = Array.isArray(proof?.steps) ? proof.steps : [];
  const positions = required.map((kind) => steps.findIndex((step) => step?.kind === kind));
  positions.forEach((position, index) => {
    if (position < 0) findings.push(`Missing legacy journey step: ${required[index]}.`);
    if (index > 0 && position >= 0 && positions[index - 1] >= position) {
      findings.push(`Legacy journey step is out of order: ${required[index]}.`);
    }
  });
  for (const kind of ['validation_received', 'proposal_accepted']) {
    if (!steps.find((step) => step?.kind === kind)?.receiptDigest) {
      findings.push(`${kind} is not bound to a legacy receipt digest.`);
    }
  }
}

function isSha256Digest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

async function hasExpectedMagic(key, filePath) {
  const bytes = await readFile(filePath);
  if (key === 'gifPath') return bytes.subarray(0, 4).toString('ascii') === 'GIF8';
  if (key === 'finalScreenshotPath') {
    return (
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))
    );
  }
  if (key === 'exportedDeckPath') return bytes.subarray(0, 2).toString('ascii') === 'PK';
  if (key === 'runManifestPath') {
    try {
      JSON.parse(bytes.toString('utf8'));
      return true;
    } catch {
      return false;
    }
  }
  if (key === 'rawRecordingPath') {
    return (
      bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ||
      bytes.subarray(4, 8).toString('ascii') === 'ftyp'
    );
  }
  return true;
}

export function durableDigest(value) {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}

function stableSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Digest input must be finite.');
    return JSON.stringify(value);
  }
  if (typeof value === 'undefined') return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value !== 'object') throw new Error('Unsupported digest input.');
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(',')}}`;
}

async function main() {
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf('--manifest');
  const outputIndex = args.indexOf('--output');
  const manifest = manifestIndex >= 0 ? args[manifestIndex + 1] : args[0];
  if (!manifest)
    throw new Error(
      'Usage: node scripts/nodeslide-journey-proof.mjs --manifest <run-manifest.json> [--output <journey-proof.json>]',
    );
  const result = await finalizeNodeSlideJourneyProof(
    manifest,
    outputIndex >= 0 ? args[outputIndex + 1] : undefined,
  );
  process.stdout.write(
    `${JSON.stringify({ ok: true, proof: result.outputPath, digest: result.proof.digest }, null, 2)}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
