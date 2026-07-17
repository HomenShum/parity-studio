import { describe, expect, it } from 'vitest';
import { getRovingFocusIndex } from './overlayPrimitives';

describe('NodeSlide keyboard helpers', () => {
  it('supports wrapped roving focus for menus and inspector tabs', () => {
    expect(getRovingFocusIndex(4, 3, 'ArrowRight')).toBe(0);
    expect(getRovingFocusIndex(4, 0, 'ArrowLeft')).toBe(3);
    expect(getRovingFocusIndex(4, 2, 'Home')).toBe(0);
    expect(getRovingFocusIndex(4, 1, 'End')).toBe(3);
    expect(getRovingFocusIndex(4, 1, 'Enter')).toBeNull();
  });
});
