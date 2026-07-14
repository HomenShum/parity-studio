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
});
