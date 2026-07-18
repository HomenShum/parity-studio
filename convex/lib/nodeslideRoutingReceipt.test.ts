import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_ROUTE_AVAILABILITY_WINDOW_MS,
  buildNodeSlideCreateRoutingReceipt,
  deriveNodeSlideRouteAvailability,
} from './nodeslideRoutingReceipt';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('deriveNodeSlideRouteAvailability', () => {
  it('authorizes a route only from a fresh successful outcome and fails closed otherwise', () => {
    const availability = deriveNodeSlideRouteAvailability(
      [
        { provider: 'openrouter', model: 'z-ai/glm-5.2', ok: true, at: NOW - HOUR },
        { provider: 'nebius', model: 'nebius/zai-org/GLM-5.2', ok: true, at: NOW - 2 * HOUR },
      ],
      NOW,
    );
    expect(availability).toContainEqual({
      provider: 'openrouter',
      catalogModelId: 'z-ai/glm-5.2',
      available: true,
    });
    expect(availability).toContainEqual({
      provider: 'nebius',
      catalogModelId: 'nebius/zai-org/GLM-5.2',
      available: true,
    });
    // Routes with no signal get NO record at all — never a fabricated probe.
    expect(availability).toHaveLength(2);
  });

  it('treats a deterministic-fallback outcome as unavailability for the requested route', () => {
    const availability = deriveNodeSlideRouteAvailability(
      [
        {
          provider: 'deterministic',
          model: 'z-ai/glm-5.2 (deterministic fallback)',
          ok: true,
          at: NOW - HOUR,
        },
      ],
      NOW,
    );
    expect(availability).toEqual([
      { provider: 'openrouter', catalogModelId: 'z-ai/glm-5.2', available: false },
    ]);
  });

  it('lets the newest signal win and expires signals outside the window', () => {
    const availability = deriveNodeSlideRouteAvailability(
      [
        { provider: 'openrouter', model: 'z-ai/glm-5.2', ok: false, at: NOW - 3 * HOUR },
        { provider: 'openrouter', model: 'z-ai/glm-5.2', ok: true, at: NOW - HOUR },
        {
          provider: 'nebius',
          model: 'nebius/zai-org/GLM-5.2',
          ok: true,
          at: NOW - NODESLIDE_ROUTE_AVAILABILITY_WINDOW_MS - HOUR,
        },
      ],
      NOW,
    );
    expect(availability).toEqual([
      { provider: 'openrouter', catalogModelId: 'z-ai/glm-5.2', available: true },
    ]);
  });

  it('ignores unknown models and future-dated signals', () => {
    const availability = deriveNodeSlideRouteAvailability(
      [
        { provider: 'openrouter', model: 'made-up/model', ok: true, at: NOW - HOUR },
        { provider: 'openrouter', model: 'z-ai/glm-5.2', ok: true, at: NOW + HOUR },
      ],
      NOW,
    );
    expect(availability).toEqual([]);
  });
});

describe('resolveNodeSlideEnforcedCreateRequest', () => {
  const externalRequest = {
    providerMode: 'nebius',
    providerModel: 'nebius/zai-org/GLM-5.2',
    providerEffort: 'medium',
    providerConsent: 'nebius_full_brief_v1',
    brief: { prompt: 'x' },
  };

  it('downgrades a refused external route to deterministic and strips consent', async () => {
    const { resolveNodeSlideEnforcedCreateRequest } = await import('./nodeslideRoutingReceipt');
    const outcome = resolveNodeSlideEnforcedCreateRequest(
      {
        requested: { mode: 'nebius', model: 'nebius/zai-org/GLM-5.2' },
        decision: { kind: 'refused', code: 'route_unavailable', message: 'No fresh signal.' },
      },
      externalRequest,
    );
    expect(outcome.enforced).toBe(true);
    expect(outcome.reason).toContain('route_unavailable');
    expect(outcome.request.providerMode).toBe('deterministic');
    expect(outcome.request.providerModel).toBeUndefined();
    expect(outcome.request.providerConsent).toBeUndefined();
    expect((outcome.request as { brief: { prompt: string } }).brief.prompt).toBe('x');
  });

  it('passes selected routes and deterministic requests through untouched', async () => {
    const { resolveNodeSlideEnforcedCreateRequest } = await import('./nodeslideRoutingReceipt');
    const selected = resolveNodeSlideEnforcedCreateRequest(
      {
        requested: { mode: 'nebius', model: 'nebius/zai-org/GLM-5.2' },
        decision: {
          kind: 'selected',
          provider: 'nebius',
          modelId: 'zai-org/GLM-5.2',
          estimatedMicroUsd: 3810,
          pricingSource: 'nodeslide-nebius-native-catalog',
        },
      },
      externalRequest,
    );
    expect(selected).toEqual({ request: externalRequest, enforced: false });

    const deterministic = resolveNodeSlideEnforcedCreateRequest(
      {
        requested: { mode: 'deterministic' },
        decision: { kind: 'refused', code: 'invalid_input', message: 'n/a' },
      },
      { providerMode: 'deterministic' },
    );
    expect(deterministic.enforced).toBe(false);

    const missingReceipt = resolveNodeSlideEnforcedCreateRequest(undefined, externalRequest);
    expect(missingReceipt.enforced).toBe(false);
  });
});

describe('buildNodeSlideCreateRoutingReceipt', () => {
  it('selects the requested external route with a cost estimate when recently proven available', () => {
    const receipt = buildNodeSlideCreateRoutingReceipt({
      providerMode: 'openrouter_free',
      providerModel: 'z-ai/glm-5.2',
      providerEffort: 'medium',
      briefCharacters: 1_200,
      attachmentCharacters: 0,
      signals: [{ provider: 'openrouter', model: 'z-ai/glm-5.2', ok: true, at: NOW - HOUR }],
      now: NOW,
    });
    expect(receipt.enforcement).toBe('advisory_v1');
    expect(receipt.requested).toEqual({ mode: 'openrouter_free', model: 'z-ai/glm-5.2' });
    expect(receipt.decision.kind).toBe('selected');
    if (receipt.decision.kind !== 'selected') return;
    expect(receipt.decision.provider).toBe('openrouter');
    expect(receipt.decision.estimatedMicroUsd).toBeGreaterThan(0);
    expect(receipt.decision.pricingSource).toBeTruthy();
    expect(receipt.availabilityBasis.signalCount).toBe(1);
  });

  it('refuses honestly when the requested route has no in-window availability signal', () => {
    const receipt = buildNodeSlideCreateRoutingReceipt({
      providerMode: 'openrouter_free',
      providerModel: 'z-ai/glm-5.2',
      providerEffort: 'medium',
      briefCharacters: 800,
      attachmentCharacters: 0,
      signals: [],
      now: NOW,
    });
    expect(receipt.decision.kind).toBe('refused');
    if (receipt.decision.kind !== 'refused') return;
    expect(receipt.decision.code).toBeTruthy();
    expect(receipt.availabilityBasis.signalCount).toBe(0);
  });

  it('selects the deterministic route for a private request without touching availability', () => {
    const receipt = buildNodeSlideCreateRoutingReceipt({
      providerMode: 'deterministic',
      providerModel: undefined,
      providerEffort: undefined,
      briefCharacters: 500,
      attachmentCharacters: 0,
      signals: [],
      now: NOW,
    });
    expect(receipt.requested).toEqual({ mode: 'deterministic' });
    expect(receipt.decision.kind).toBe('selected');
    if (receipt.decision.kind !== 'selected') return;
    expect(receipt.decision.provider).toBe('nodeslide');
    expect(receipt.decision.estimatedMicroUsd).toBe(0);
  });
});
