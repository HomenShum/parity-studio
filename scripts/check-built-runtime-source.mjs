#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { normalizeRuntimeSourceSha, parseRuntimeSourcePayload } from './runtime-source.mjs';

// pnpm preserves a conventional `--` separator when forwarding script
// arguments. Accept both `pnpm <script> -- a b` and `node script a b` so the
// release gate behaves identically locally and in GitHub Actions.
const [manifestPath, expectedValue] = process.argv.slice(2).filter((value) => value !== '--');
const expectedSha = normalizeRuntimeSourceSha(expectedValue);

if (!manifestPath || !expectedSha) {
  console.error('Usage: check-built-runtime-source <manifest.json> <expected-sha>');
  process.exit(1);
}

try {
  const payload = parseRuntimeSourcePayload(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
    'frontend',
  );
  if (payload.sourceSha !== expectedSha) {
    throw new Error(
      `Built runtime source ${payload.sourceSha.slice(0, 12)} does not match ${expectedSha.slice(0, 12)}.`,
    );
  }
  console.log(`OK built runtime source ${payload.sourceSha.slice(0, 12)}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Built runtime source check failed.');
  process.exit(1);
}
