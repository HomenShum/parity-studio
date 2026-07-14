const RUNTIME_SOURCE_SHA_PATTERN = /^[0-9a-f]{40,64}$/i;

export const RUNTIME_SOURCE_SCHEMA = 'parity.runtime-source/v1' as const;

export interface ConvexRuntimeSourcePayload {
  schema: typeof RUNTIME_SOURCE_SCHEMA;
  layer: 'convex';
  sourceSha: string;
}

export function convexRuntimeSourcePayload(
  configuredSha: string | undefined,
): ConvexRuntimeSourcePayload | null {
  const sourceSha = configuredSha?.trim();
  if (!sourceSha || !RUNTIME_SOURCE_SHA_PATTERN.test(sourceSha)) return null;
  return {
    schema: RUNTIME_SOURCE_SCHEMA,
    layer: 'convex',
    sourceSha: sourceSha.toLowerCase(),
  };
}
