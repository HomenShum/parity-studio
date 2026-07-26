import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import handler, { convexUrl, requestOrigin } from './share';

const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;
const savedBinding: Record<string, string | undefined> = {};

/**
 * A developer shell may already export a Convex URL. Clear the binding so the
 * route's fail-closed path is what is under test, not the local environment.
 */
function clearBackendBinding() {
  for (const name of ['VITE_CONVEX_URL', 'CONVEX_URL']) {
    savedBinding[name] = processEnv?.[name];
    if (processEnv) delete processEnv[name];
  }
}

function restoreBackendBinding() {
  for (const [name, value] of Object.entries(savedBinding)) {
    if (!processEnv) return;
    if (value === undefined) delete processEnv[name];
    else processEnv[name] = value;
  }
}

function recordingResponse() {
  const headers: Record<string, string> = {};
  const state = {
    statusCode: 0,
    headers,
    body: undefined as string | undefined,
    ended: false,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(body?: string) {
      state.body = body;
      state.ended = true;
    },
  };
  return state;
}

describe('the route reads the public origin from the request it was given', () => {
  it('prefers the forwarded host a reader actually used', () => {
    expect(requestOrigin({ 'x-forwarded-host': 'decks.example.com', host: 'internal' })).toBe(
      'https://decks.example.com',
    );
    expect(requestOrigin({ host: 'nodeslide.vercel.app' })).toBe('https://nodeslide.vercel.app');
    expect(requestOrigin({ host: 'localhost:5180', 'x-forwarded-proto': 'http' })).toBe(
      'http://localhost:5180',
    );
  });

  it('discards a host header that is not a plain host token', () => {
    const fallback = 'https://nodeslide.vercel.app';
    expect(requestOrigin({ host: 'evil.example.com/path' })).toBe(fallback);
    expect(requestOrigin({ host: 'evil.example.com"><script>' })).toBe(fallback);
    expect(requestOrigin(undefined)).toBe(fallback);
  });
});

describe('the route refuses to guess a backend', () => {
  it('accepts only an https Convex URL from the environment', () => {
    expect(convexUrl({ VITE_CONVEX_URL: 'https://example.convex.cloud/' })).toBe(
      'https://example.convex.cloud',
    );
    expect(convexUrl({ CONVEX_URL: 'https://example.convex.cloud' })).toBe(
      'https://example.convex.cloud',
    );
    expect(convexUrl({ VITE_CONVEX_URL: 'http://example.convex.cloud' })).toBeNull();
    expect(convexUrl({ VITE_CONVEX_URL: 'not a url' })).toBeNull();
    expect(convexUrl({})).toBeNull();
    // `convex dev` is plaintext on loopback, and only there.
    expect(convexUrl({ VITE_CONVEX_URL: 'http://127.0.0.1:3210' })).toBe('http://127.0.0.1:3210');
  });
});

describe('the route hands the projection back over the Node response contract', () => {
  beforeEach(clearBackendBinding);
  afterEach(restoreBackendBinding);

  it('writes the status, the headers, and the body', async () => {
    // With no backend binding the route refuses, so this exercises the response
    // contract end to end without a network call.
    const response = recordingResponse();
    await handler({ url: '/api/share?share=share-abc', method: 'GET' }, response);

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('This presentation cannot be read right now');
    expect(response.ended).toBe(true);
  });

  it('answers a HEAD probe with the status and headers but no body', async () => {
    const response = recordingResponse();
    await handler({ url: '/api/share?share=share-abc', method: 'HEAD' }, response);

    expect(response.statusCode).toBe(503);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.body).toBeUndefined();
    expect(response.ended).toBe(true);
  });
});
