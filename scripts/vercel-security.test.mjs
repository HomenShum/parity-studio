import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Vercel security policy', () => {
  it('allows local attachment blobs without broadening network egress', async () => {
    const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
    const policy = config.headers
      .flatMap((entry) => entry.headers ?? [])
      .find((header) => header.key === 'Content-Security-Policy')?.value;

    const connectSource = policy
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('connect-src '));

    expect(connectSource).toContain("connect-src 'self' blob:");
    expect(connectSource?.split(/\s+/u)).not.toContain('*');
    expect(policy).toContain("object-src 'none'");
  });
});
