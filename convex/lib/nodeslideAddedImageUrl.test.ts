import { describe, expect, it } from 'vitest';
import { isAllowedNodeSlideAddedImageUrl } from './nodeslidePatches';

describe('isAllowedNodeSlideAddedImageUrl', () => {
  const dataUrl = (kind: string) => `data:image/${kind};base64,${'A'.repeat(64)}`;

  it('accepts embedded data:image URLs for the supported raster formats', () => {
    for (const kind of ['png', 'jpeg', 'jpg', 'webp', 'gif']) {
      expect(isAllowedNodeSlideAddedImageUrl(dataUrl(kind))).toBe(true);
    }
  });

  it('accepts a bounded https URL (the agent planner contract)', () => {
    expect(isAllowedNodeSlideAddedImageUrl('https://cdn.example.com/chart.png')).toBe(true);
  });

  it('rejects non-https remote schemes and script/exfil URLs', () => {
    // A tracking/exfil beacon or script URL must never be seedable onto a published deck.
    expect(isAllowedNodeSlideAddedImageUrl('http://attacker.example/beacon.gif?d=deck')).toBe(
      false,
    );
    expect(isAllowedNodeSlideAddedImageUrl('javascript:fetch("//evil")')).toBe(false);
    expect(isAllowedNodeSlideAddedImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isAllowedNodeSlideAddedImageUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isAllowedNodeSlideAddedImageUrl('//protocol-relative.example/x.png')).toBe(false);
  });

  it('rejects oversized URLs on both contracts (sync-serializer character cap)', () => {
    // Embedded over 700 KB, and an https URL over the planner's 2048-char bound.
    expect(isAllowedNodeSlideAddedImageUrl(`data:image/webp;base64,${'A'.repeat(700_001)}`)).toBe(
      false,
    );
    expect(isAllowedNodeSlideAddedImageUrl(`https://example.com/${'a'.repeat(2048)}`)).toBe(false);
  });

  it('rejects a data:image URL with a disallowed subtype', () => {
    expect(isAllowedNodeSlideAddedImageUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
  });
});
