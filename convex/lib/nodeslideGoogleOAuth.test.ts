import { describe, expect, it } from 'vitest';

import {
  allowedNodeSlideOrigins,
  decryptOAuthSecret,
  encryptOAuthSecret,
  randomBase64Url,
  resolveNodeSlideGoogleOAuthConfig,
  safeNodeSlideReturnTo,
  sha256Base64Url,
  withGoogleOAuthResult,
} from './nodeslideGoogleOAuth';

describe('NodeSlide Google OAuth helpers', () => {
  it('builds unguessable state and a stable PKCE digest', async () => {
    const state = randomBase64Url(32);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(await sha256Base64Url('verifier')).toBe(await sha256Base64Url('verifier'));
  });

  it('encrypts tokens with randomized AES-GCM ciphertext and decrypts them', async () => {
    const key = randomBase64Url(32);
    const first = await encryptOAuthSecret('refresh-secret', key);
    const second = await encryptOAuthSecret('refresh-secret', key);

    expect(first).not.toBe(second);
    expect(first).not.toContain('refresh-secret');
    expect(await decryptOAuthSecret(first, key)).toBe('refresh-secret');
  });

  it('allows only configured app origins and removes stale result markers', () => {
    const origins = allowedNodeSlideOrigins(
      'https://parity-studio.vercel.app,http://127.0.0.1:5201',
    );
    expect(
      safeNodeSlideReturnTo(
        'https://parity-studio.vercel.app/?deck=deck_1&nodeslideGoogle=failed#token',
        origins,
      ),
    ).toBe('https://parity-studio.vercel.app/?deck=deck_1');
    expect(() => safeNodeSlideReturnTo('https://attacker.example/steal', origins)).toThrow(
      'OAuth return URL is not allowed.',
    );
  });

  it('returns only a bounded status marker to the application', () => {
    expect(
      withGoogleOAuthResult('https://parity-studio.vercel.app/?deck=deck_1', 'connected'),
    ).toBe('https://parity-studio.vercel.app/?deck=deck_1&nodeslideGoogle=connected');
  });

  it('fails closed when deployment secrets or encryption material are missing', () => {
    expect(() => resolveNodeSlideGoogleOAuthConfig({})).toThrow(
      'Google Slides connection is not configured for this deployment.',
    );
    expect(() =>
      resolveNodeSlideGoogleOAuthConfig({
        clientId: 'client',
        clientSecret: 'secret',
        encryptionKey: 'not-a-32-byte-key',
        redirectUri: 'https://example.com/api/nodeslide/google/oauth/callback',
      }),
    ).toThrow('Google Slides connection is not configured for this deployment.');
  });

  it('accepts HTTPS and loopback callbacks but rejects an insecure remote callback', () => {
    const base = {
      clientId: 'client',
      clientSecret: 'secret',
      encryptionKey: randomBase64Url(32),
    };
    expect(
      resolveNodeSlideGoogleOAuthConfig({
        ...base,
        redirectUri: 'https://example.com/api/nodeslide/google/oauth/callback',
      }).redirectUri,
    ).toBe('https://example.com/api/nodeslide/google/oauth/callback');
    expect(
      resolveNodeSlideGoogleOAuthConfig({
        ...base,
        redirectUri: 'http://127.0.0.1:3210/api/nodeslide/google/oauth/callback',
      }).redirectUri,
    ).toBe('http://127.0.0.1:3210/api/nodeslide/google/oauth/callback');
    expect(() =>
      resolveNodeSlideGoogleOAuthConfig({
        ...base,
        redirectUri: 'http://example.com/api/nodeslide/google/oauth/callback',
      }),
    ).toThrow('Google Slides connection is not configured for this deployment.');
  });
});
