import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'qa', 'nodeslide-wave-quality.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const requiredJourneys = new Set([
  'fresh-landing',
  'model-and-input',
  'attachment-lifecycle',
  'proposal-review-boundary',
  'exactly-once-and-recovery',
  'privacy-and-attribution',
  'visual-and-accessibility',
]);

if (manifest.schemaVersion !== 'parity.qa-journeys/v1') fail('Unexpected schemaVersion.');
for (const journey of manifest.journeys ?? []) {
  requiredJourneys.delete(journey.id);
  if (!Array.isArray(journey.coverage) || journey.coverage.length === 0) {
    fail(`Journey ${journey.id} has no coverage claims.`);
  }
  for (const testPath of journey.tests ?? []) await requireFile(testPath);
}
if (requiredJourneys.size > 0) fail(`Missing journeys: ${[...requiredJourneys].join(', ')}.`);
if (JSON.stringify(manifest.traceFixtures?.counts) !== JSON.stringify([4, 10, 100])) {
  fail('Trace fixtures must cover 4, 10, and 100 records.');
}
await requireFile(manifest.traceFixtures.test);
if (manifest.artifactPolicy?.commitScreenshots !== false) {
  fail('Playwright screenshots must remain CI artifacts, not committed fixtures.');
}

console.log(`QA manifest valid: ${path.relative(root, manifestPath)}.`);

async function requireFile(relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    fail(`Invalid repo-relative test path: ${String(relativePath)}.`);
  }
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) fail('Test path escapes the repository.');
  try {
    await access(resolved);
  } catch {
    fail(`Manifest test file does not exist: ${relativePath}.`);
  }
}

function fail(message) {
  console.error(`QA manifest invalid: ${message}`);
  process.exit(1);
}
