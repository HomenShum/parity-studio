import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUTHORING_ARCHIVE_VERSION = 'nodeslide.authoring-archive/v1';

export async function appendAuthoringArchiveRecord(filePath, entry, now = Date.now()) {
  validateEntry(entry);
  const records = await loadAuthoringArchive(filePath);
  if (records.some((record) => record.entry.policy.id === entry.policy.id)) {
    throw new Error(`Policy ${entry.policy.id} is already archived.`);
  }
  const previousDigest = records.at(-1)?.recordDigest ?? null;
  const partial = {
    schemaVersion: AUTHORING_ARCHIVE_VERSION,
    sequence: records.length + 1,
    previousDigest,
    recordedAt: now,
    entry,
  };
  const record = { ...partial, recordDigest: durableDigest(partial) };
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await appendFile(path.resolve(filePath), `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function loadAuthoringArchive(filePath) {
  const source = await readFile(path.resolve(filePath), 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  const records = source
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  let previousDigest = null;
  for (const [index, record] of records.entries()) {
    const { recordDigest, ...partial } = record;
    if (
      record.schemaVersion !== AUTHORING_ARCHIVE_VERSION ||
      record.sequence !== index + 1 ||
      record.previousDigest !== previousDigest ||
      recordDigest !== durableDigest(partial)
    ) {
      throw new Error(`Authoring archive hash chain is invalid at sequence ${index + 1}.`);
    }
    validateEntry(record.entry);
    previousDigest = recordDigest;
  }
  return records;
}

export function authoringParetoFront(entries) {
  const eligible = entries.filter(
    ({ policy, evaluation }) =>
      policy.id === evaluation.policyId &&
      evaluation.heldOut === true &&
      evaluation.journeyProofPassed === true &&
      evaluation.safety >= 0 &&
      evaluation.exportFidelity >= 0 &&
      mandatoryRolesEnabled(policy),
  );
  return eligible
    .filter(
      (candidate) =>
        !eligible.some(
          (other) => other !== candidate && dominates(other.evaluation, candidate.evaluation),
        ),
    )
    .sort(
      (left, right) =>
        right.evaluation.quality - left.evaluation.quality ||
        right.evaluation.safety - left.evaluation.safety ||
        right.evaluation.exportFidelity - left.evaluation.exportFidelity ||
        left.evaluation.costMicroUsd - right.evaluation.costMicroUsd ||
        left.evaluation.latencyMs - right.evaluation.latencyMs ||
        left.policy.id.localeCompare(right.policy.id),
    );
}

export function authoringCandidatePromotable(baseline, candidate) {
  return (
    candidate.policy.parentId === baseline.policy.id &&
    candidate.evaluation.heldOut === true &&
    candidate.evaluation.journeyProofPassed === true &&
    candidate.evaluation.quality > baseline.evaluation.quality &&
    candidate.evaluation.safety >= baseline.evaluation.safety &&
    candidate.evaluation.exportFidelity >= baseline.evaluation.exportFidelity &&
    mandatoryRolesEnabled(candidate.policy)
  );
}

function validateEntry(entry) {
  if (!entry?.policy?.id || entry?.evaluation?.policyId !== entry.policy.id)
    throw new Error('Policy and evaluation bindings are invalid.');
  if (!mandatoryRolesEnabled(entry.policy))
    throw new Error('Mandatory safety and proof roles must remain enabled.');
  for (const field of ['quality', 'safety', 'exportFidelity']) {
    const value = entry.evaluation[field];
    if (!Number.isFinite(value) || value < 0 || value > 100)
      throw new Error(`${field} must be between 0 and 100.`);
  }
  for (const field of ['costMicroUsd', 'latencyMs']) {
    if (!Number.isSafeInteger(entry.evaluation[field]) || entry.evaluation[field] < 0)
      throw new Error(`${field} is invalid.`);
  }
}

function mandatoryRolesEnabled(policy) {
  return (
    policy?.roles?.claim_verifier?.enabled === true &&
    policy?.roles?.export_parity_critic?.enabled === true &&
    policy?.roles?.journey_capture_agent?.enabled === true
  );
}

function dominates(left, right) {
  const noWorse =
    left.quality >= right.quality &&
    left.safety >= right.safety &&
    left.exportFidelity >= right.exportFidelity &&
    left.costMicroUsd <= right.costMicroUsd &&
    left.latencyMs <= right.latencyMs;
  return (
    noWorse &&
    (left.quality > right.quality ||
      left.safety > right.safety ||
      left.exportFidelity > right.exportFidelity ||
      left.costMicroUsd < right.costMicroUsd ||
      left.latencyMs < right.latencyMs)
  );
}

function durableDigest(value) {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}
function stableSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'undefined') return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(',')}}`;
}

async function main() {
  const [command, archive = 'artifacts/nodeslide-authoring-meta/archive.jsonl', recordPath] =
    process.argv.slice(2);
  if (command === 'append') {
    if (!recordPath)
      throw new Error('Usage: nodeslide:authoring:meta append <archive.jsonl> <entry.json>');
    const entry = JSON.parse(await readFile(path.resolve(recordPath), 'utf8'));
    process.stdout.write(
      `${JSON.stringify(await appendAuthoringArchiveRecord(archive, entry), null, 2)}\n`,
    );
    return;
  }
  const records = await loadAuthoringArchive(archive);
  const front = authoringParetoFront(records.map((record) => record.entry));
  process.stdout.write(
    `${JSON.stringify({ records: records.length, paretoFront: front, selectedParent: front[0] ?? null }, null, 2)}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
