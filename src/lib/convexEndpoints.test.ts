import { describe, expect, it } from 'vitest';
import { resolveConvexWsUrl } from './convexEndpoints';

describe('resolveConvexWsUrl', () => {
  it('uses and normalizes an explicitly configured deployment', () => {
    expect(
      resolveConvexWsUrl('https://staging-example.convex.cloud/', {
        allowDevelopmentFallback: false,
      }),
    ).toBe('https://staging-example.convex.cloud');
  });

  it('fails closed for a hosted build with no deployment binding', () => {
    expect(() => resolveConvexWsUrl(undefined, { allowDevelopmentFallback: false })).toThrow(
      /intentionally disconnected/,
    );
  });

  it('retains the documented development fallback only for local work', () => {
    expect(resolveConvexWsUrl(undefined, { allowDevelopmentFallback: true })).toBe(
      'https://blissful-pig-998.convex.cloud',
    );
  });
});
