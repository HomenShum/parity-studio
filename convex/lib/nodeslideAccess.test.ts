import { describe, expect, it } from 'vitest';
import {
  createOwnerAccessKey,
  createShareSlug,
  isOwnerAccessKey,
  requireShareSlug,
} from './nodeslideAccess';

describe('NodeSlide preview capabilities', () => {
  it('generates distinct 256-bit owner capabilities', () => {
    const first = createOwnerAccessKey();
    const second = createOwnerAccessKey();
    expect(first).not.toBe(second);
    expect(isOwnerAccessKey(first)).toBe(true);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates strict unguessable read-only share slugs', () => {
    const slug = createShareSlug();
    expect(slug).toMatch(/^share-[a-f0-9]{36}$/);
    expect(requireShareSlug(slug)).toBe(slug);
    expect(() => requireShareSlug('../deck')).toThrow('Invalid NodeSlide share link');
  });
});
