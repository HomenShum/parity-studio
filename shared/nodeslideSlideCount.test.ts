import { describe, expect, it } from 'vitest';
import {
  explicitNodeSlideRequestedSlideCount,
  inferNodeSlideRequestedSlideCount,
  nodeSlideRequestedSlideCountIssue,
} from './nodeslideSlideCount';

describe('NodeSlide requested slide count', () => {
  it.each([
    ['Create a concise 3-slide launch update', 3],
    ['Prepare exactly four slides', 4],
    ['Create five slides', 5],
    ['Create a six-slide founder roadshow', 6],
    ['Create exactly six concise slides', 6],
    ['Build six highly visual editable slides', 6],
    ['Create exactly seven concise, claim-led slides', 7],
    ['Build exactly 7 slides', 7],
    ['An eight — slide narrative', 8],
  ])('recognizes an explicit supported count in %s', (prompt, expected) => {
    expect(inferNodeSlideRequestedSlideCount(prompt)).toBe(expected);
  });

  it('does not confuse slide references or unsupported counts with a deck-length request', () => {
    expect(inferNodeSlideRequestedSlideCount('Put the decision on slide 6')).toBeNull();
    expect(inferNodeSlideRequestedSlideCount('Use evidence from slides 3 and 4')).toBeNull();
    expect(inferNodeSlideRequestedSlideCount('Create two slides')).toBeNull();
    expect(inferNodeSlideRequestedSlideCount('Create nine slides')).toBeNull();
  });

  it('distinguishes unsupported explicit deck lengths from ordinary slide references', () => {
    expect(explicitNodeSlideRequestedSlideCount('Create two slides')).toBe(2);
    expect(explicitNodeSlideRequestedSlideCount('Build a 12-slide board update')).toBe(12);
    expect(explicitNodeSlideRequestedSlideCount('Put the decision on slide 6')).toBeNull();
    expect(nodeSlideRequestedSlideCountIssue('Create two slides')).toBe(
      'NodeSlide currently creates 3–8 slides. Change the requested 2-slide deck to 3–8 slides.',
    );
    expect(nodeSlideRequestedSlideCountIssue('Create 6 slides')).toBeNull();
  });
});
