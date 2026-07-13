import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchExternalReferences } from '../inspirationSearch';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('NodeSlide live search adapter', () => {
  it('parses Linkup sourcedAnswer sources with bounded excerpts', async () => {
    vi.stubEnv('LINKUP_API_KEY', 'test-linkup-key');
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    vi.stubEnv('BRAVE_API_KEY', '');
    vi.stubEnv('SERPER_API_KEY', '');
    vi.stubEnv('TAVILY_API_KEY', '');
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            answer: 'The tournament expands to 48 teams across 12 groups.',
            sources: [
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
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      outputType: 'sourcedAnswer',
      includeSources: true,
      maxResults: 8,
    });
  });
});
