const DEFAULT_CONVEX_URL = 'https://blissful-pig-998.convex.cloud';
const DEFAULT_CONVEX_HTTP_URL = 'https://blissful-pig-998.convex.site';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

export function convexWsUrl(): string {
  const fromEnv = import.meta.env['VITE_CONVEX_URL'] as string | undefined;
  return trimTrailingSlash(fromEnv || DEFAULT_CONVEX_URL);
}

export function convexHttpUrl(): string {
  const fromEnv = import.meta.env['VITE_CONVEX_HTTP_URL'] as string | undefined;
  if (fromEnv) return trimTrailingSlash(fromEnv);
  const wsUrl = convexWsUrl();
  return (
    trimTrailingSlash(wsUrl.replace('.convex.cloud', '.convex.site')) || DEFAULT_CONVEX_HTTP_URL
  );
}
