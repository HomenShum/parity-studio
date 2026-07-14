#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { normalizeRuntimeSourceSha, parseRuntimeSourcePayload } from './runtime-source.mjs';

export async function checkRuntimeSourceOnce({
  frontendUrl,
  expectedSha,
  fetchImpl = fetch,
  vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
}) {
  const frontendEndpoint = new URL('/runtime-source.json', requiredUrl(frontendUrl)).toString();
  const frontendPayload = parseRuntimeSourcePayload(
    await fetchJson(fetchImpl, frontendEndpoint, vercelBypassHeaders(vercelBypassSecret)),
    'frontend',
  );
  const convexPayload = parseRuntimeSourcePayload(
    await fetchJson(fetchImpl, frontendPayload.backendRuntimeSourceUrl),
    'convex',
  );

  if (frontendPayload.sourceSha !== convexPayload.sourceSha) {
    throw new Error(
      `Runtime source mismatch: frontend ${shortSha(frontendPayload.sourceSha)}; Convex ${shortSha(convexPayload.sourceSha)}.`,
    );
  }
  if (expectedSha && frontendPayload.sourceSha !== expectedSha) {
    throw new Error(
      `Runtime source mismatch: deployed ${shortSha(frontendPayload.sourceSha)}; expected ${shortSha(expectedSha)}.`,
    );
  }

  return {
    sourceSha: frontendPayload.sourceSha,
    frontendEndpoint,
    convexEndpoint: frontendPayload.backendRuntimeSourceUrl,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let lastError = null;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const result = await checkRuntimeSourceOnce(options);
      console.log(`OK runtime source aligned at ${shortSha(result.sourceSha)}.`);
      console.log(`frontend: ${result.frontendEndpoint}`);
      console.log(`convex: ${result.convexEndpoint}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts) break;
      console.log(`Runtime source alignment pending (${attempt}/${options.attempts}).`);
      await delay(options.delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Runtime source alignment failed.');
}

function parseArgs(args) {
  const frontendUrl = flag(args, '--frontend');
  if (!frontendUrl)
    throw new Error('Usage: check-runtime-source --frontend <url> [--expected-sha <sha>]');
  const expectedValue = flag(args, '--expected-sha');
  const expectedSha = expectedValue ? normalizeRuntimeSourceSha(expectedValue) : null;
  if (expectedValue && !expectedSha)
    throw new Error('--expected-sha must be a full hexadecimal SHA.');
  const attempts = boundedInteger(flag(args, '--attempts') ?? '12', '--attempts', 1, 30);
  const delayMs = boundedInteger(flag(args, '--delay-ms') ?? '5000', '--delay-ms', 0, 30_000);
  return { frontendUrl, expectedSha, attempts, delayMs };
}

async function fetchJson(fetchImpl, url, extraHeaders = {}) {
  const protectedFrontendRequest = Object.keys(extraHeaders).length > 0;
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', ...extraHeaders },
    // Never carry a Vercel bypass header across a redirect. The configured
    // deployment URL must answer directly when the bypass is valid.
    redirect: protectedFrontendRequest ? 'manual' : 'follow',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Runtime source endpoint returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('Runtime source endpoint did not return JSON.');
  }
  return await response.json();
}

function vercelBypassHeaders(value) {
  const secret = typeof value === 'string' ? value.trim() : '';
  return secret
    ? {
        'x-vercel-protection-bypass': secret,
        'x-vercel-set-bypass-cookie': 'true',
      }
    : {};
}

function requiredUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    url.username = '';
    url.password = '';
    return url;
  } catch {
    throw new Error('--frontend must be an HTTP(S) URL.');
  }
}

function flag(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function boundedInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function shortSha(sha) {
  return sha.slice(0, 12);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Runtime source alignment failed.');
    process.exitCode = 1;
  });
}
