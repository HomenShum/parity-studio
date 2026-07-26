import { ConvexHttpClient } from 'convex/browser';
import type { DefaultFunctionArgs, FunctionReference } from 'convex/server';
import { api } from '../convex/_generated/api';
import type { PublishedNodeSlide } from '../shared/nodeslide';
import { buildShareProjection } from '../src/domains/nodeslide/publicSurface/shareProjection';

type ConvexArgs<Args> = Args & DefaultFunctionArgs;
type PublicQuery<Args, Result> = FunctionReference<'query', 'public', ConvexArgs<Args>, Result>;

/**
 * The one published query this route is allowed to call. Naming it here keeps
 * the public surface honest: a share link resolves through
 * `nodeslide.getPresenterSnapshot` and nothing else.
 */
interface PresenterApi {
  nodeslide: {
    getPresenterSnapshot: PublicQuery<{ shareSlug: string }, PublishedNodeSlide | null>;
  };
}

/** The request and response members this route uses, and no more. */
interface ShareRouteRequest {
  url?: string | undefined;
  method?: string | undefined;
  headers?: Record<string, string | string[] | undefined> | undefined;
}

interface ShareRouteResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

const DEFAULT_ORIGIN = 'https://nodeslide.vercel.app';

function environment(): Record<string, string | undefined> {
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  );
}

function firstHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name];
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The canonical link must point back at the host the reader actually used, so
 * it is read from the forwarded request headers. A header that is not a plain
 * host token is discarded rather than reflected into the page.
 */
export function requestOrigin(
  headers: Record<string, string | string[] | undefined> | undefined,
  fallback = DEFAULT_ORIGIN,
): string {
  const host = firstHeader(headers, 'x-forwarded-host') ?? firstHeader(headers, 'host');
  if (!host || !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return fallback;
  const protocol = firstHeader(headers, 'x-forwarded-proto') === 'http' ? 'http' : 'https';
  return `${protocol}://${host}`;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The deployment binding the build already requires. Plaintext is accepted only
 * for a loopback address, which is where `convex dev` runs; anything else must
 * be https before this route will send a share slug to it.
 */
export function convexUrl(env: Record<string, string | undefined>): string | null {
  const configured = (env['VITE_CONVEX_URL'] ?? env['CONVEX_URL'] ?? '').trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const allowed =
      url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
    return allowed ? url.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

/**
 * A link preview gives up long before a serverless function does. Bound the
 * backend read so a stalled deployment becomes a refusal, not a hung request.
 */
const BACKEND_TIMEOUT_MS = 5_000;

const boundedFetch: typeof globalThis.fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS) });

export default async function handler(
  request: ShareRouteRequest,
  response: ShareRouteResponse,
): Promise<void> {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('allow', 'GET, HEAD');
    response.end();
    return;
  }

  const backendUrl = convexUrl(environment());
  const presenterApi = api as unknown as PresenterApi;
  const projection = await buildShareProjection({
    url: request.url ?? '/',
    origin: requestOrigin(request.headers),
    loadPublishedDeck: backendUrl
      ? (shareSlug) =>
          new ConvexHttpClient(backendUrl, { fetch: boundedFetch }).query(
            presenterApi.nodeslide.getPresenterSnapshot,
            { shareSlug },
          )
      : null,
  });

  response.statusCode = projection.status;
  for (const [name, value] of Object.entries(projection.headers)) {
    response.setHeader(name, value);
  }
  // A HEAD request gets the status and headers a GET would, without the body.
  response.end(method === 'HEAD' ? undefined : projection.body);
}
