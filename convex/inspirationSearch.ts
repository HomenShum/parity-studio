'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action } from './_generated/server';

type MediaPreference = 'auto' | 'images' | 'videos' | 'mixed';
type ExternalMediaType = 'image' | 'video' | 'website';

export interface ExternalReference {
  product: string;
  title: string;
  sourceUrl: string;
  mediaType: ExternalMediaType;
  provider: string;
  snippet?: string;
  imageUrl?: string;
  tags?: string[];
}

interface RawSearchSource {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  mediaType: ExternalMediaType;
  imageUrl?: string;
}

interface LinkupResponseSource {
  name?: string;
  title?: string;
  url?: string;
  content?: string;
  snippet?: string;
}

const MAX_SEARCH_RESPONSE_BYTES = 200_000;
const LINKUP_SEARCH_TIMEOUT_MS = 15_000;
const LINKUP_SEARCH_ATTEMPTS = 2;

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export function configuredSearchProviders(): string[] {
  const providers: string[] = [];
  if (env('LINKUP_API_KEY')) providers.push('linkup');
  if (env('BRAVE_SEARCH_API_KEY') || env('BRAVE_API_KEY')) providers.push('brave');
  if (env('SERPER_API_KEY')) providers.push('serper');
  if (env('TAVILY_API_KEY')) providers.push('tavily');
  return providers;
}

function productFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'live reference';
  }
}

function searchQueryFromContext(input: {
  query?: string;
  title?: string;
  prompt?: string;
  paritySummary?: string;
  filePaths: string[];
  mediaPreference: MediaPreference;
}): string {
  const explicit = input.query?.replace(/\s+/g, ' ').trim();
  if (explicit) return explicit.slice(0, 380);
  const parts = [
    input.title,
    input.prompt,
    input.paritySummary,
    input.filePaths.slice(0, 8).join(' '),
    input.mediaPreference === 'videos'
      ? 'product UI demo video design inspiration'
      : 'product UI design inspiration screenshots references',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    parts.replace(/\s+/g, ' ').trim().slice(0, 380) || 'product UI design inspiration references'
  );
}

async function withTimeout<T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedJson<T>(response: Response): Promise<T | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SEARCH_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    const decoder = new TextDecoder();
    const text = `${chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('')}${decoder.decode()}`;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function searchLinkup(query: string): Promise<RawSearchSource[]> {
  const key = env('LINKUP_API_KEY');
  if (!key) return [];
  for (let attempt = 0; attempt < LINKUP_SEARCH_ATTEMPTS; attempt += 1) {
    const result = await withTimeout<RawSearchSource[] | null>(
      LINKUP_SEARCH_TIMEOUT_MS,
      async (signal) => {
        const response = await fetch('https://api.linkup.so/v1/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            q: query,
            depth: 'standard',
            // NodeSlide reasons over and cites the sources itself. Asking Linkup for another
            // synthesized answer adds latency and a second generation step without adding lineage.
            outputType: 'searchResults',
            maxResults: 8,
          }),
          signal,
        });
        if (!response.ok) return response.status === 429 || response.status >= 500 ? null : [];
        const data = await readBoundedJson<{ results?: LinkupResponseSource[] }>(response);
        if (!data) return null;
        return (data.results ?? []).map((item) => ({
          title: item.name ?? item.title ?? item.url ?? 'Live web result',
          url: item.url ?? '',
          snippet: item.content ?? item.snippet ?? '',
          provider: 'linkup',
          mediaType: 'website' as const,
        }));
      },
    );
    if (result !== null) return result;
  }
  return [];
}

async function searchBraveWeb(query: string): Promise<RawSearchSource[]> {
  const key = env('BRAVE_SEARCH_API_KEY') || env('BRAVE_API_KEY');
  if (!key) return [];
  const result = await withTimeout(9000, async (signal) => {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8&safesearch=moderate`,
      {
        headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
        signal,
      },
    );
    if (!response.ok) return [];
    const data = await readBoundedJson<{
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    }>(response);
    if (!data) return [];
    return (data.web?.results ?? []).map((item) => ({
      title: item.title ?? item.url ?? 'Brave web result',
      url: item.url ?? '',
      snippet: item.description ?? '',
      provider: 'brave',
      mediaType: 'website' as const,
    }));
  });
  return result ?? [];
}

async function searchBraveImages(query: string): Promise<RawSearchSource[]> {
  const key = env('BRAVE_SEARCH_API_KEY') || env('BRAVE_API_KEY');
  if (!key) return [];
  const result = await withTimeout(9000, async (signal) => {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=8&safesearch=strict`,
      {
        headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
        signal,
      },
    );
    if (!response.ok) return [];
    const data = await readBoundedJson<{
      results?: Array<{
        title?: string;
        url?: string;
        source?: string;
        page_url?: string;
        properties?: { url?: string; placeholder?: string };
        thumbnail?: { src?: string };
      }>;
    }>(response);
    if (!data) return [];
    return (data.results ?? []).map((item) => {
      const sourceUrl =
        item.page_url ??
        item.url ??
        item.source ??
        item.properties?.url ??
        item.thumbnail?.src ??
        '';
      const imageUrl = item.thumbnail?.src ?? item.properties?.placeholder ?? item.properties?.url;
      return {
        title: item.title ?? sourceUrl ?? 'Brave image result',
        url: sourceUrl,
        snippet: 'Image result from Brave image search.',
        provider: 'brave-image',
        mediaType: 'image' as const,
        ...(imageUrl ? { imageUrl } : {}),
      };
    });
  });
  return result ?? [];
}

async function searchBraveVideos(query: string): Promise<RawSearchSource[]> {
  const key = env('BRAVE_SEARCH_API_KEY') || env('BRAVE_API_KEY');
  if (!key) return [];
  const result = await withTimeout(9000, async (signal) => {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/videos/search?q=${encodeURIComponent(query)}&count=8&safesearch=moderate`,
      {
        headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
        signal,
      },
    );
    if (!response.ok) return [];
    const data = await readBoundedJson<{
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        thumbnail?: { src?: string };
        video?: { thumbnail?: string };
      }>;
    }>(response);
    if (!data) return [];
    return (data.results ?? []).map((item) => {
      const imageUrl = item.thumbnail?.src ?? item.video?.thumbnail;
      return {
        title: item.title ?? item.url ?? 'Brave video result',
        url: item.url ?? '',
        snippet: item.description ?? 'Video result from Brave video search.',
        provider: 'brave-video',
        mediaType: 'video' as const,
        ...(imageUrl ? { imageUrl } : {}),
      };
    });
  });
  return result ?? [];
}

async function searchSerper(query: string): Promise<RawSearchSource[]> {
  const key = env('SERPER_API_KEY');
  if (!key) return [];
  const result = await withTimeout(9000, async (signal) => {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num: 8 }),
      signal,
    });
    if (!response.ok) return [];
    const data = await readBoundedJson<{
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    }>(response);
    if (!data) return [];
    return (data.organic ?? []).map((item) => ({
      title: item.title ?? item.link ?? 'Serper result',
      url: item.link ?? '',
      snippet: item.snippet ?? '',
      provider: 'serper',
      mediaType: 'website' as const,
    }));
  });
  return result ?? [];
}

async function searchTavily(
  query: string,
  mediaPreference: MediaPreference,
): Promise<RawSearchSource[]> {
  const key = env('TAVILY_API_KEY');
  if (!key) return [];
  const result = await withTimeout(9000, async (signal) => {
    const includeImages =
      mediaPreference === 'images' || mediaPreference === 'mixed' || mediaPreference === 'auto';
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: 8,
        include_images: includeImages,
        include_image_descriptions: includeImages,
      }),
      signal,
    });
    if (!response.ok) return [];
    const data = await readBoundedJson<{
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
        images?: string[];
      }>;
      images?: Array<string | { url?: string; description?: string }>;
    }>(response);
    if (!data) return [];
    const web = (data.results ?? []).map((item) => {
      const imageUrl = item.images?.[0];
      return {
        title: item.title ?? item.url ?? 'Tavily result',
        url: item.url ?? '',
        snippet: item.content ?? '',
        provider: 'tavily',
        mediaType: 'website' as const,
        ...(imageUrl ? { imageUrl } : {}),
      };
    });
    const images = (data.images ?? []).slice(0, 6).map((image, index) => {
      const imageUrl = typeof image === 'string' ? image : (image.url ?? '');
      const description =
        typeof image === 'string'
          ? 'Tavily image search result.'
          : (image.description ?? 'Tavily image search result.');
      return {
        title: `Tavily image reference ${index + 1}`,
        url: imageUrl,
        snippet: description,
        provider: 'tavily-image',
        mediaType: 'image' as const,
        imageUrl,
      };
    });
    return [...web, ...images];
  });
  return result ?? [];
}

function dedupeSources(sources: RawSearchSource[]): RawSearchSource[] {
  const byUrl = new Map<string, RawSearchSource>();
  for (const source of sources) {
    if (!source.url || source.url.length > 900) continue;
    const key = source.url.toLowerCase().replace(/#.*$/, '');
    const existing = byUrl.get(key);
    if (
      !existing ||
      source.snippet.length > existing.snippet.length ||
      source.mediaType !== 'website'
    ) {
      byUrl.set(key, source);
    }
  }
  return Array.from(byUrl.values()).slice(0, 12);
}

function toExternalReference(source: RawSearchSource): ExternalReference {
  return {
    product: productFromUrl(source.url),
    title: source.title.slice(0, 140),
    sourceUrl: source.url,
    mediaType: source.mediaType,
    provider: source.provider,
    snippet: source.snippet.slice(0, 360),
    ...(source.imageUrl ? { imageUrl: source.imageUrl } : {}),
    tags: ['live-search', source.provider, source.mediaType],
  };
}

export async function searchExternalReferences(
  query: string,
  mediaPreference: MediaPreference,
): Promise<{
  references: ExternalReference[];
  providers: string[];
}> {
  const tasks: Array<Promise<RawSearchSource[]>> = [
    searchLinkup(query),
    searchBraveWeb(query),
    searchSerper(query),
    searchTavily(query, mediaPreference),
  ];
  if (mediaPreference === 'images' || mediaPreference === 'mixed' || mediaPreference === 'auto') {
    tasks.push(searchBraveImages(query));
  }
  if (mediaPreference === 'videos' || mediaPreference === 'mixed') {
    tasks.push(searchBraveVideos(query));
  }
  const settled = await Promise.allSettled(tasks);
  const sources = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  const deduped = dedupeSources(sources);
  return {
    references: deduped.map(toExternalReference),
    providers: Array.from(new Set(deduped.map((source) => source.provider.replace(/-.+$/, '')))),
  };
}

export const runLiveSearch = action({
  args: {
    runId: v.id('runs'),
    query: v.optional(v.string()),
    referenceUrls: v.optional(v.array(v.string())),
    mediaPreference: v.optional(
      v.union(v.literal('auto'), v.literal('images'), v.literal('videos'), v.literal('mixed')),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    reportId: string;
    query: string;
    providersConfigured: string[];
    providersUsed: string[];
    liveReferenceCount: number;
  }> => {
    const mediaPreference = args.mediaPreference ?? 'mixed';
    const context = await ctx.runQuery(internal.inspiration.getSearchContextInternal, {
      runId: args.runId,
    });
    const query = searchQueryFromContext({
      ...(args.query !== undefined ? { query: args.query } : {}),
      ...(context.title !== undefined ? { title: context.title } : {}),
      ...(context.prompt !== undefined ? { prompt: context.prompt } : {}),
      ...(context.paritySummary !== undefined ? { paritySummary: context.paritySummary } : {}),
      filePaths: context.filePaths,
      mediaPreference,
    });
    const configured = configuredSearchProviders();
    const live =
      configured.length > 0
        ? await searchExternalReferences(query, mediaPreference)
        : { references: [], providers: [] };
    const reportId = (await ctx.runMutation(internal.inspiration.saveLiveReportInternal, {
      runId: args.runId,
      query,
      ...(args.referenceUrls !== undefined ? { referenceUrls: args.referenceUrls } : {}),
      mediaPreference,
      externalReferences: live.references,
    })) as string;
    return {
      reportId,
      query,
      providersConfigured: configured,
      providersUsed: live.providers,
      liveReferenceCount: live.references.length,
    };
  },
});
