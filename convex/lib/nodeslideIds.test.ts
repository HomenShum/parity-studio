import { describe, expect, it } from 'vitest';
import {
  nodeslideEventId,
  nodeslideHash,
  nodeslideIdDigest,
  nodeslideStableId,
} from './nodeslideIds';

describe('NodeSlide persistent identifiers', () => {
  it('uses a deterministic 128-bit SHA-256 prefix', () => {
    expect(nodeslideIdDigest('abc')).toBe('ba7816bf8f01cfea414140de5dae2223');
    expect(nodeslideStableId('slide', 'deck-a', '1')).toMatch(/^slide_[0-9a-f]{32}$/);
    expect(nodeslideEventId('patch', 1_700_000_000_000, 'deck-a')).toMatch(
      /^patch_[0-9a-z]+_[0-9a-f]{32}$/,
    );
  });

  it('separates known 32-bit FNV-1a collisions in persistent IDs', () => {
    expect(nodeslideHash('costarring')).toBe(nodeslideHash('liquid'));
    expect(nodeslideStableId('row', 'costarring')).not.toBe(nodeslideStableId('row', 'liquid'));
  });

  it('domains stable and event identities by prefix and timestamp', () => {
    expect(nodeslideStableId('slide', 'same')).not.toBe(nodeslideStableId('element', 'same'));
    expect(nodeslideEventId('patch', 1, 'same')).not.toBe(nodeslideEventId('patch', 2, 'same'));
  });
});
