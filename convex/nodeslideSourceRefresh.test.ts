import { describe, expect, it } from 'vitest';
import {
  nodeSlideSourceRefreshBackoffMinutes,
  nodeSlideSourceRefreshObservationKind,
  nodeSlideSourceRefreshSemanticDigest,
} from './nodeslideSourceRefresh';

describe('NodeSlide source refresh runtime contracts', () => {
  it('deduplicates semantically unchanged captures despite whitespace noise', () => {
    const previous = nodeSlideSourceRefreshSemanticDigest('Revenue grew 12%.\n\nSource: FY26');
    const observed = nodeSlideSourceRefreshSemanticDigest(
      '  Revenue   grew 12%.\r\n\r\n\r\nSource: FY26  ',
    );

    expect(observed).toBe(previous);
    expect(nodeSlideSourceRefreshObservationKind(previous, observed)).toBe('unchanged');
  });

  it('classifies a material text change for review instead of silently merging it', () => {
    const previous = nodeSlideSourceRefreshSemanticDigest('Revenue grew 12%.');
    const observed = nodeSlideSourceRefreshSemanticDigest('Revenue grew 9%.');

    expect(observed).not.toBe(previous);
    expect(nodeSlideSourceRefreshObservationKind(previous, observed)).toBe('changed');
  });

  it('backs off exponentially within the bounded polling envelope', () => {
    expect(nodeSlideSourceRefreshBackoffMinutes(15, 0)).toBe(15);
    expect(nodeSlideSourceRefreshBackoffMinutes(15, 3)).toBe(120);
    expect(nodeSlideSourceRefreshBackoffMinutes(7 * 24 * 60, 8)).toBe(7 * 24 * 60);
    expect(() => nodeSlideSourceRefreshBackoffMinutes(14, 1)).toThrow(
      'Source refresh interval must be 15-10080 minutes.',
    );
  });
});
