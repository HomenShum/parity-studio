import { describe, expect, it } from 'vitest';
import { inferNodeSlideRequestedSlideCount } from './nodeslideSlideCount';

describe('NodeSlide requested slide count', () => {
  it.each([
    ['Create a six-slide founder roadshow', 6],
    ['Build exactly 7 slides', 7],
    ['An eight — slide narrative', 8],
  ])('recognizes an explicit supported count in %s', (prompt, expected) => {
    expect(inferNodeSlideRequestedSlideCount(prompt)).toBe(expected);
  });

  it('does not confuse slide references or unsupported counts with a deck-length request', () => {
    expect(inferNodeSlideRequestedSlideCount('Put the decision on slide 6')).toBeNull();
    expect(inferNodeSlideRequestedSlideCount('Create five slides')).toBeNull();
  });
});
