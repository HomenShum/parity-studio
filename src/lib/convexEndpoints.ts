const DEFAULT_CONVEX_URL = 'https://blissful-pig-998.convex.cloud';
const DEFAULT_CONVEX_HTTP_URL = 'https://blissful-pig-998.convex.site';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

export function resolveConvexWsUrl(
  configuredUrl: string | undefined,
  options: { allowDevelopmentFallback: boolean },
): string {
  const configured = configuredUrl?.trim();
  if (configured) return trimTrailingSlash(configured);
  if (options.allowDevelopmentFallback) return DEFAULT_CONVEX_URL;
  throw new Error(
    'VITE_CONVEX_URL is required for hosted builds. This deployment is intentionally disconnected rather than falling back to production data.',
  );
}

export function convexWsUrl(): string {
  return resolveConvexWsUrl(import.meta.env['VITE_CONVEX_URL'] as string | undefined, {
    allowDevelopmentFallback: import.meta.env.DEV,
  });
}

export function convexHttpUrl(): string {
  const fromEnv =
    (import.meta.env['VITE_CONVEX_HTTP_URL'] as string | undefined) ||
    (import.meta.env['VITE_CONVEX_SITE_URL'] as string | undefined);
  if (fromEnv) return trimTrailingSlash(fromEnv);
  const wsUrl = convexWsUrl();
  const inferred = trimTrailingSlash(wsUrl.replace('.convex.cloud', '.convex.site'));
  if (inferred !== wsUrl) return inferred;
  if (import.meta.env.DEV) return DEFAULT_CONVEX_HTTP_URL;
  throw new Error(
    'VITE_CONVEX_SITE_URL is required when VITE_CONVEX_URL is not a convex.cloud endpoint.',
  );
}
