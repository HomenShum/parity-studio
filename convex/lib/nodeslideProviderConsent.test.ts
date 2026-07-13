import { describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_NEBIUS_REVIEW_CONSENT,
  NODESLIDE_OPENROUTER_EDIT_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
} from '../../shared/nodeslide';
import {
  invokeConsentedNodeSlideProvider,
  validateNodeSlideProviderChoice,
} from './nodeslideProviderConsent';

describe('NodeSlide provider consent authority', () => {
  it('defaults both provider-backed operations to deterministic no-egress', async () => {
    const invoke = vi.fn(async () => 'provider');
    const edit = validateNodeSlideProviderChoice('propose_edit', undefined, undefined);
    const variations = validateNodeSlideProviderChoice('variations', undefined, undefined);

    expect(edit).toEqual({ providerMode: 'deterministic' });
    expect(variations).toEqual({ providerMode: 'deterministic' });
    expect(await invokeConsentedNodeSlideProvider(edit, invoke)).toBeNull();
    expect(await invokeConsentedNodeSlideProvider(variations, invoke)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('requires exact, non-interchangeable operation consent tokens', () => {
    expect(
      validateNodeSlideProviderChoice(
        'propose_edit',
        'nebius',
        NODESLIDE_NEBIUS_REVIEW_CONSENT,
        'nebius/zai-org/GLM-5.2',
        'high',
      ),
    ).toMatchObject({
      providerMode: 'nebius',
      providerModel: 'nebius/zai-org/GLM-5.2',
      providerEffort: 'high',
    });
    expect(
      validateNodeSlideProviderChoice(
        'propose_edit',
        'openrouter_free',
        NODESLIDE_OPENROUTER_EDIT_CONSENT,
        'anthropic/claude-sonnet-5',
      ),
    ).toMatchObject({
      providerMode: 'openrouter_free',
      providerModel: 'anthropic/claude-sonnet-5',
    });
    expect(
      validateNodeSlideProviderChoice(
        'variations',
        'openrouter_free',
        NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
      ),
    ).toMatchObject({ providerMode: 'openrouter_free' });
    expect(() =>
      validateNodeSlideProviderChoice(
        'variations',
        'openrouter_free',
        NODESLIDE_OPENROUTER_EDIT_CONSENT,
      ),
    ).toThrow(/Exact variation consent/);
    expect(() =>
      validateNodeSlideProviderChoice(
        'propose_edit',
        'openrouter_free',
        NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
      ),
    ).toThrow(/Exact edit-review consent/);
    expect(() =>
      validateNodeSlideProviderChoice(
        'propose_edit',
        'openrouter_free',
        NODESLIDE_OPENROUTER_EDIT_CONSENT,
        'unbounded/provider-model',
      ),
    ).toThrow(/supported NodeSlide agent model/);
    expect(() =>
      validateNodeSlideProviderChoice('propose_edit', 'deterministic', undefined, 'z-ai/glm-5.2'),
    ).toThrow(/model, and effort must only accompany/);
    expect(
      validateNodeSlideProviderChoice(
        'propose_edit',
        'openrouter_free',
        NODESLIDE_OPENROUTER_EDIT_CONSENT,
        'z-ai/glm-5.2',
        'xhigh',
      ),
    ).toMatchObject({ providerEffort: 'xhigh' });
    expect(() =>
      validateNodeSlideProviderChoice(
        'propose_edit',
        'openrouter_free',
        NODESLIDE_OPENROUTER_EDIT_CONSENT,
        'z-ai/glm-5.2',
        'unbounded',
      ),
    ).toThrow(/supported NodeSlide reasoning effort/);
    expect(() =>
      validateNodeSlideProviderChoice(
        'propose_edit',
        'nebius',
        NODESLIDE_NEBIUS_REVIEW_CONSENT,
        'nebius/zai-org/GLM-5.2',
        'xhigh',
      ),
    ).toThrow(/does not support the selected reasoning effort/);
  });
});
