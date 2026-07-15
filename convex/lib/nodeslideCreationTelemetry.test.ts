import { describe, expect, it } from 'vitest';
import {
  nodeSlideCreationAuthorizationLine,
  nodeSlideCreationRunStartedAt,
  nodeSlideCreationTraceId,
} from './nodeslideCreationTelemetry';

describe('NodeSlide creation telemetry contract', () => {
  it('uses one stable trace identity across creation persistence and durable runs', () => {
    expect(nodeSlideCreationTraceId('deck-1')).toBe(nodeSlideCreationTraceId('deck-1'));
    expect(nodeSlideCreationTraceId('deck-1')).not.toBe(nodeSlideCreationTraceId('deck-2'));
  });

  it('records an explicit external authorization receipt without persisting a consent token', () => {
    const line = nodeSlideCreationAuthorizationLine({
      externalEgressAuthorized: true,
      provider: 'nebius',
      model: 'zai-org/GLM-5.2',
    });

    expect(line).toBe(
      'Explicit one-shot consent authorized the external nebius · zai-org/GLM-5.2 creation request.',
    );
    expect(line).not.toMatch(/brief-nebius-v\d/i);
  });

  it('labels private deterministic creation without implying external egress', () => {
    expect(nodeSlideCreationAuthorizationLine({ externalEgressAuthorized: false })).toBe(
      "Consent not required; the brief stayed inside NodeSlide's deterministic route.",
    );
  });

  it('keeps the observed durable start time and rejects invalid future timestamps', () => {
    expect(nodeSlideCreationRunStartedAt(1_000, 2_000)).toBe(1_000);
    expect(nodeSlideCreationRunStartedAt(undefined, 2_000.9)).toBe(2_000);
    expect(() => nodeSlideCreationRunStartedAt(3_001, 2_000)).toThrow(/future/i);
    expect(() => nodeSlideCreationRunStartedAt(Number.NaN, 2_000)).toThrow(/invalid/i);
  });
});
