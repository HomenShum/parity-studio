import { describe, expect, it } from 'vitest';
import { resolveConvexHttpUrl, resolveConvexWsUrl } from './convexEndpoints';

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

describe('resolveConvexHttpUrl', () => {
  it('derives HTTP from the websocket deployment before stale site overrides', () => {
    expect(
      resolveConvexHttpUrl(
        'https://current-preview.convex.cloud/',
        'https://stale-production.convex.site',
        'https://also-stale.convex.site',
      ),
    ).toBe('https://current-preview.convex.site');
  });

  it('uses the explicit HTTP endpoint for a custom websocket deployment', () => {
    expect(
      resolveConvexHttpUrl(
        'https://ws.example.test',
        'https://http.example.test/',
        'https://stale.example.test',
      ),
    ).toBe('https://http.example.test');
  });

  it('fails closed when a custom websocket deployment has no HTTP binding', () => {
    expect(() => resolveConvexHttpUrl('https://ws.example.test')).toThrow(
      /VITE_CONVEX_HTTP_URL or VITE_CONVEX_SITE_URL/,
    );
  });
});
