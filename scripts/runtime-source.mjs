import { execFileSync } from 'node:child_process';

export const RUNTIME_SOURCE_SCHEMA = 'parity.runtime-source/v1';

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40,64}$/i;

export function normalizeRuntimeSourceSha(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return SOURCE_SHA_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

export function resolveRuntimeSourceSha(env = process.env, cwd = process.cwd()) {
  for (const name of ['PARITY_SOURCE_SHA', 'VERCEL_GIT_COMMIT_SHA', 'GITHUB_SHA']) {
    const configured = env[name];
    if (!configured?.trim()) continue;
    const normalized = normalizeRuntimeSourceSha(configured);
    if (!normalized) throw new Error(`${name} must be a full 40-64 character hexadecimal SHA.`);
    return normalized;
  }

  try {
    const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const normalized = normalizeRuntimeSourceSha(gitSha);
    if (normalized) return normalized;
  } catch {
    // The fail-closed error below is intentionally free of command output.
  }

  throw new Error(
    'A runtime source SHA is required. Set PARITY_SOURCE_SHA or build from a Git checkout.',
  );
}

export function resolveConvexRuntimeSourceUrl(env = process.env) {
  const cloudUrl = cleanUrl(env.VITE_CONVEX_URL);
  if (cloudUrl) {
    const siteUrl = cloudUrl.replace(/\.convex\.cloud$/i, '.convex.site');
    if (siteUrl !== cloudUrl) return new URL('/api/runtime-source', siteUrl).toString();
  }

  const configuredSiteUrl =
    cleanUrl(env.VITE_CONVEX_HTTP_URL) ?? cleanUrl(env.VITE_CONVEX_SITE_URL);
  return configuredSiteUrl ? new URL('/api/runtime-source', configuredSiteUrl).toString() : null;
}

export function frontendRuntimeSourceManifest({ sourceSha, env = process.env }) {
  const normalized = normalizeRuntimeSourceSha(sourceSha);
  if (!normalized) throw new Error('Frontend runtime source SHA is invalid.');
  return {
    schema: RUNTIME_SOURCE_SCHEMA,
    layer: 'frontend',
    sourceSha: normalized,
    backendRuntimeSourceUrl: resolveConvexRuntimeSourceUrl(env),
  };
}

export function parseRuntimeSourcePayload(value, expectedLayer) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${expectedLayer} runtime source response is not an object.`);
  }
  const payload = value;
  if (payload.schema !== RUNTIME_SOURCE_SCHEMA || payload.layer !== expectedLayer) {
    throw new Error(`${expectedLayer} runtime source response has the wrong schema or layer.`);
  }
  const sourceSha = normalizeRuntimeSourceSha(payload.sourceSha);
  if (!sourceSha) throw new Error(`${expectedLayer} runtime source response has no valid SHA.`);

  if (expectedLayer === 'frontend') {
    const backendRuntimeSourceUrl = cleanUrl(payload.backendRuntimeSourceUrl);
    if (!backendRuntimeSourceUrl) {
      throw new Error('frontend runtime source response has no backend endpoint binding.');
    }
    return { sourceSha, backendRuntimeSourceUrl };
  }

  return { sourceSha };
}

function cleanUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
