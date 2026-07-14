#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { normalizeRuntimeSourceSha, parseRuntimeSourcePayload } from './runtime-source.mjs';

const manifestPath = process.argv[2];
const expectedValue = process.argv[3];
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
