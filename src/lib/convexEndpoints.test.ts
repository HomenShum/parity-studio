import { describe, expect, it } from 'vitest';
import { resolveConvexWsUrl } from './convexEndpoints';

describe('resolveConvexWsUrl', () => {
  it('uses and normalizes an explicitly configured deployment', () => {
    expect(resolveConvexWsUrl('https://staging-example.convex.cloud/')).toBe(
      'https://staging-example.convex.cloud',
    );
  });

  it('fails closed in every environment with no deployment binding', () => {
    expect(() => resolveConvexWsUrl(undefined)).toThrow(
      /rather than falling back to production data/,
    );
  });
});
