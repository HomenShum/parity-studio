import { describe, expect, it } from 'vitest';
import { checkRuntimeSourceOnce } from './check-runtime-source.mjs';
import {
  RUNTIME_SOURCE_SCHEMA,
  frontendRuntimeSourceManifest,
  normalizeRuntimeSourceSha,
  parseRuntimeSourcePayload,
  resolveConvexRuntimeSourceUrl,
} from './runtime-source.mjs';

const sourceSha = 'a'.repeat(40);

describe('runtime source manifest', () => {
  it('binds the frontend manifest to the public Convex source endpoint', () => {
    expect(
      frontendRuntimeSourceManifest({
        sourceSha,
        env: { VITE_CONVEX_URL: 'https://preview-name.convex.cloud' },
      }),
    ).toEqual({
      schema: RUNTIME_SOURCE_SCHEMA,
      layer: 'frontend',
      sourceSha,
      backendRuntimeSourceUrl: 'https://preview-name.convex.site/api/runtime-source',
    });
  });

  it('ignores stale explicit site URLs when the websocket URL identifies a deployment', () => {
    const env = {
      VITE_CONVEX_URL: 'https://current-preview.convex.cloud',
      VITE_CONVEX_HTTP_URL: 'https://stale-http.convex.site',
      VITE_CONVEX_SITE_URL: 'https://stale-site.convex.site',
    };

    expect(resolveConvexRuntimeSourceUrl(env)).toBe(
      'https://current-preview.convex.site/api/runtime-source',
    );
    expect(frontendRuntimeSourceManifest({ sourceSha, env }).backendRuntimeSourceUrl).toBe(
      'https://current-preview.convex.site/api/runtime-source',
    );
  });

  it('uses the same explicit HTTP-before-site precedence for custom websocket URLs', () => {
    expect(
      resolveConvexRuntimeSourceUrl({
        VITE_CONVEX_URL: 'https://ws.example.test',
        VITE_CONVEX_HTTP_URL: 'https://http.example.test',
        VITE_CONVEX_SITE_URL: 'https://stale.example.test',
      }),
    ).toBe('https://http.example.test/api/runtime-source');
  });

  it('marks an unbound non-release manifest instead of inventing a backend', () => {
    expect(
      frontendRuntimeSourceManifest({ sourceSha, env: {} }).backendRuntimeSourceUrl,
    ).toBeNull();
  });

  it('rejects malformed SHAs and credential-bearing backend URLs', () => {
    expect(normalizeRuntimeSourceSha('main')).toBeNull();
    expect(
      resolveConvexRuntimeSourceUrl({
        VITE_CONVEX_SITE_URL: 'https://user:password@example.com?token=secret#fragment',
      }),
    ).toBe('https://example.com/api/runtime-source');
    expect(
      parseRuntimeSourcePayload(
        {
          schema: RUNTIME_SOURCE_SCHEMA,
          layer: 'frontend',
          sourceSha,
          backendRuntimeSourceUrl:
            'https://user:password@preview.convex.site/api/runtime-source?token=secret#fragment',
        },
        'frontend',
      ),
    ).toEqual({
      sourceSha,
      backendRuntimeSourceUrl: 'https://preview.convex.site/api/runtime-source',
    });
    expect(() =>
      parseRuntimeSourcePayload(
        { schema: RUNTIME_SOURCE_SCHEMA, layer: 'frontend', sourceSha: 'main' },
        'frontend',
      ),
    ).toThrow(/valid SHA/);
  });
});

describe('postdeploy runtime source checker', () => {
  it('accepts only matching frontend, Convex, and expected SHAs', async () => {
    const responses = new Map([
      [
        'https://preview.example/runtime-source.json',
        {
          schema: RUNTIME_SOURCE_SCHEMA,
          layer: 'frontend',
          sourceSha,
          backendRuntimeSourceUrl: 'https://preview.convex.site/api/runtime-source',
        },
      ],
      [
        'https://preview.convex.site/api/runtime-source',
        { schema: RUNTIME_SOURCE_SCHEMA, layer: 'convex', sourceSha },
      ],
    ]);
    const fetchImpl = async (url) =>
      new Response(JSON.stringify(responses.get(String(url))), {
        status: responses.has(String(url)) ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      });

    await expect(
      checkRuntimeSourceOnce({
        frontendUrl: 'https://preview.example',
        expectedSha: sourceSha,
        fetchImpl,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        sourceSha,
        convexEndpoint: 'https://preview.convex.site/api/runtime-source',
      }),
    );
  });

  it('fails closed on a frontend/backend skew', async () => {
    const fetchImpl = async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes('runtime-source.json')
            ? {
                schema: RUNTIME_SOURCE_SCHEMA,
                layer: 'frontend',
                sourceSha,
                backendRuntimeSourceUrl: 'https://preview.convex.site/api/runtime-source',
              }
            : {
                schema: RUNTIME_SOURCE_SCHEMA,
                layer: 'convex',
                sourceSha: 'b'.repeat(40),
              },
        ),
        { headers: { 'content-type': 'application/json' } },
      );

    await expect(
      checkRuntimeSourceOnce({
        frontendUrl: 'https://preview.example',
        expectedSha: sourceSha,
        fetchImpl,
      }),
    ).rejects.toThrow(/Runtime source mismatch/);
  });

  it('uses the Vercel bypass only for the protected frontend request', async () => {
    const bypassSecret = 'rotated-secret-that-must-not-reach-convex';
    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        redirect: init?.redirect,
      });
      const frontend = String(url).includes('runtime-source.json');
      return new Response(
        JSON.stringify(
          frontend
            ? {
                schema: RUNTIME_SOURCE_SCHEMA,
                layer: 'frontend',
                sourceSha,
                backendRuntimeSourceUrl: 'https://preview.convex.site/api/runtime-source',
              }
            : { schema: RUNTIME_SOURCE_SCHEMA, layer: 'convex', sourceSha },
        ),
        { headers: { 'content-type': 'application/json' } },
      );
    };

    await checkRuntimeSourceOnce({
      frontendUrl: 'https://protected-preview.example',
      expectedSha: sourceSha,
      fetchImpl,
      vercelBypassSecret: bypassSecret,
    });

    expect(requests[0]?.headers.get('x-vercel-protection-bypass')).toBe(bypassSecret);
    expect(requests[0]?.headers.get('x-vercel-set-bypass-cookie')).toBeNull();
    expect(requests[0]?.redirect).toBe('manual');
    expect(requests[1]?.headers.get('x-vercel-protection-bypass')).toBeNull();
    expect(requests[1]?.headers.get('x-vercel-set-bypass-cookie')).toBeNull();
    expect(requests[1]?.redirect).toBe('follow');
  });

  it('fails closed instead of forwarding a bypass header across a redirect', async () => {
    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({
        url: String(url),
        bypass: new Headers(init?.headers).get('x-vercel-protection-bypass'),
        redirect: init?.redirect,
      });
      return new Response(null, {
        status: 307,
        headers: { location: 'https://attacker.example/runtime-source.json' },
      });
    };

    await expect(
      checkRuntimeSourceOnce({
        frontendUrl: 'https://protected-preview.example',
        expectedSha: sourceSha,
        fetchImpl,
        vercelBypassSecret: 'never-forward-me',
      }),
    ).rejects.toThrow(/HTTP 307/);

    expect(requests).toEqual([
      {
        url: 'https://protected-preview.example/runtime-source.json',
        bypass: 'never-forward-me',
        redirect: 'manual',
      },
    ]);
  });
});
