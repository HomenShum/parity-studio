import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchExternalReferences } from '../inspirationSearch';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('NodeSlide live search adapter', () => {
  it('parses Linkup searchResults sources with bounded excerpts', async () => {
    vi.stubEnv('LINKUP_API_KEY', 'test-linkup-key');
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    vi.stubEnv('BRAVE_API_KEY', '');
    vi.stubEnv('SERPER_API_KEY', '');
    vi.stubEnv('TAVILY_API_KEY', '');
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                name: 'Official tournament format',
                url: 'https://example.com/world-cup-format',
                content: 'A bounded source excerpt.',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchExternalReferences('2026 World Cup format', 'auto');

    expect(result.providers).toEqual(['linkup']);
    expect(result.references).toEqual([
      expect.objectContaining({
        title: 'Official tournament format',
        sourceUrl: 'https://example.com/world-cup-format',
        snippet: 'A bounded source excerpt.',
        provider: 'linkup',
      }),
    ]);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.body))).toMatchObject({
      outputType: 'searchResults',
      depth: 'standard',
      maxResults: 8,
    });
    expect(JSON.parse(String(request?.body))).not.toHaveProperty('includeSources');
  });

  it('retries one transient provider failure without duplicating a successful request', async () => {
    vi.stubEnv('LINKUP_API_KEY', 'test-linkup-key');
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    vi.stubEnv('BRAVE_API_KEY', '');
    vi.stubEnv('SERPER_API_KEY', '');
    vi.stubEnv('TAVILY_API_KEY', '');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              name: 'Recovered source',
              url: 'https://example.com/recovered',
              content: 'Grounded after one bounded retry.',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchExternalReferences('bounded retry', 'auto');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.references).toEqual([
      expect.objectContaining({
        title: 'Recovered source',
        sourceUrl: 'https://example.com/recovered',
      }),
    ]);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
