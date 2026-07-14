import { describe, expect, it } from 'vitest';
import { RUNTIME_SOURCE_SCHEMA, convexRuntimeSourcePayload } from './runtimeSource';

describe('Convex runtime source provenance', () => {
  it('exposes only a normalized full source SHA', () => {
    const sourceSha = 'A'.repeat(40);
    expect(convexRuntimeSourcePayload(sourceSha)).toEqual({
      schema: RUNTIME_SOURCE_SCHEMA,
      layer: 'convex',
      sourceSha: sourceSha.toLowerCase(),
    });
  });

  it('fails closed when deployment provenance is absent or malformed', () => {
    expect(convexRuntimeSourcePayload(undefined)).toBeNull();
    expect(convexRuntimeSourcePayload('main')).toBeNull();
    expect(convexRuntimeSourcePayload('a'.repeat(39))).toBeNull();
  });
});
