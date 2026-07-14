function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveConvexWsUrl(configuredUrl: string | undefined): string {
  const configured = configuredUrl?.trim();
  if (configured) return trimTrailingSlash(configured);
  throw new Error(
    'VITE_CONVEX_URL is required in every environment. NodeSlide is intentionally disconnected rather than falling back to production data.',
  );
}

export function convexWsUrl(): string {
  return resolveConvexWsUrl(import.meta.env['VITE_CONVEX_URL'] as string | undefined);
}

export function resolveConvexHttpUrl(
  configuredWsUrl: string | undefined,
  configuredHttpUrl?: string,
  configuredSiteUrl?: string,
): string {
  const wsUrl = resolveConvexWsUrl(configuredWsUrl);
  const inferred = trimTrailingSlash(wsUrl.replace(/\.convex\.cloud$/i, '.convex.site'));
  if (inferred !== wsUrl) return inferred;

  const fromEnv = configuredHttpUrl?.trim() || configuredSiteUrl?.trim();
  if (fromEnv) return trimTrailingSlash(fromEnv);
  throw new Error(
    'VITE_CONVEX_HTTP_URL or VITE_CONVEX_SITE_URL is required when VITE_CONVEX_URL is not a convex.cloud endpoint.',
  );
}

export function convexHttpUrl(): string {
  return resolveConvexHttpUrl(
    import.meta.env['VITE_CONVEX_URL'] as string | undefined,
    import.meta.env['VITE_CONVEX_HTTP_URL'] as string | undefined,
    import.meta.env['VITE_CONVEX_SITE_URL'] as string | undefined,
  );
}
