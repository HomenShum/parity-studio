import {
  NODESLIDE_OPENROUTER_EDIT_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
  type NodeSlideProviderMode,
} from '../../shared/nodeslide';

export type NodeSlideProviderOperation = 'propose_edit' | 'variations';

export type ValidatedNodeSlideProviderChoice =
  | { providerMode: 'deterministic' }
  | {
      providerMode: 'openrouter_free';
      providerConsent:
        | typeof NODESLIDE_OPENROUTER_EDIT_CONSENT
        | typeof NODESLIDE_OPENROUTER_VARIATIONS_CONSENT;
    };

export class NodeSlideProviderConsentError extends Error {
  constructor(
    readonly code: 'provider_consent_required' | 'provider_consent_mismatch' | 'invalid_request',
    message: string,
  ) {
    super(message);
    this.name = 'NodeSlideProviderConsentError';
  }
}

/** Missing mode is deliberately local-only. Consent is exact and operation scoped. */
export function validateNodeSlideProviderChoice(
  operation: NodeSlideProviderOperation,
  providerMode: unknown,
  providerConsent: unknown,
): ValidatedNodeSlideProviderChoice {
  const mode: NodeSlideProviderMode =
    providerMode === undefined ? 'deterministic' : asMode(providerMode);
  if (mode === 'deterministic') {
    if (providerConsent !== undefined) {
      throw new NodeSlideProviderConsentError(
        'provider_consent_mismatch',
        'Provider consent must only accompany an OpenRouter request.',
      );
    }
    return { providerMode: 'deterministic' };
  }

  const expected =
    operation === 'propose_edit'
      ? NODESLIDE_OPENROUTER_EDIT_CONSENT
      : NODESLIDE_OPENROUTER_VARIATIONS_CONSENT;
  if (providerConsent !== expected) {
    throw new NodeSlideProviderConsentError(
      'provider_consent_required',
      `Exact ${operation === 'propose_edit' ? 'edit-review' : 'variation'} consent is required before sending context to OpenRouter.`,
    );
  }
  return { providerMode: 'openrouter_free', providerConsent: expected };
}

export async function invokeConsentedNodeSlideProvider<Result>(
  choice: ValidatedNodeSlideProviderChoice,
  invoke: () => Promise<Result>,
): Promise<Result | null> {
  return choice.providerMode === 'deterministic' ? null : await invoke();
}

function asMode(value: unknown): NodeSlideProviderMode {
  if (value === 'deterministic' || value === 'openrouter_free') return value;
  throw new NodeSlideProviderConsentError(
    'invalid_request',
    'Choose a supported NodeSlide provider mode.',
  );
}
