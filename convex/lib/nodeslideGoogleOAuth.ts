export const NODESLIDE_GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const NODESLIDE_GOOGLE_OAUTH_SESSION_MS = 10 * 60 * 1000;

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function encryptOAuthSecret(secret: string, encodedKey: string): Promise<string> {
  const key = await importEncryptionKey(encodedKey, ['encrypt']);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secret),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptOAuthSecret(value: string, encodedKey: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext, ...rest] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext || rest.length) {
    throw new Error('Stored OAuth credential is unavailable.');
  }
  const key = await importEncryptionKey(encodedKey, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64UrlToBytes(encodedIv)) },
    key,
    toArrayBuffer(base64UrlToBytes(encodedCiphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

export function allowedNodeSlideOrigins(value: string | undefined): string[] {
  const configured = (value ?? 'https://parity-studio.vercel.app')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => new URL(entry).origin);
  return [...new Set(configured)];
}

export function safeNodeSlideReturnTo(value: string, allowedOrigins: readonly string[]): string {
  const url = new URL(value);
  if (!allowedOrigins.includes(url.origin)) throw new Error('OAuth return URL is not allowed.');
  if (url.protocol !== 'https:' && !isLoopbackHostname(url.hostname)) {
    throw new Error('OAuth return URL must use HTTPS.');
  }
  url.hash = '';
  url.searchParams.delete('nodeslideGoogle');
  return url.toString();
}

export function withGoogleOAuthResult(
  returnTo: string,
  result: 'connected' | 'denied' | 'expired' | 'failed',
): string {
  const url = new URL(returnTo);
  url.searchParams.set('nodeslideGoogle', result);
  return url.toString();
}

async function importEncryptionKey(
  encodedKey: string,
  usages: readonly KeyUsage[],
): Promise<CryptoKey> {
  const bytes = base64UrlToBytes(encodedKey);
  if (bytes.byteLength !== 32) throw new Error('OAuth credential encryption is unavailable.');
  return await crypto.subtle.importKey('raw', toArrayBuffer(bytes), 'AES-GCM', false, [...usages]);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
