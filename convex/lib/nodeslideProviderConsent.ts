import {
  NODESLIDE_DEFAULT_REASONING_EFFORT,
  NODESLIDE_NEBIUS_REVIEW_CONSENT,
  NODESLIDE_NEBIUS_VARIATIONS_CONSENT,
  NODESLIDE_OPENROUTER_EDIT_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
  type NodeSlideAgentModelId,
  type NodeSlideProviderMode,
  type NodeSlideReasoningEffort,
  isNodeSlideAgentModelId,
  isNodeSlideReasoningEffort,
  nodeSlideAgentModel,
  nodeSlideDefaultModelForProviderMode,
  nodeSlideModelSupportsReasoningEffort,
} from '../../shared/nodeslide';

export type NodeSlideProviderOperation = 'propose_edit' | 'variations';

export type ValidatedNodeSlideProviderChoice =
  | { providerMode: 'deterministic' }
  | {
      providerMode: 'openrouter_free' | 'nebius';
      providerModel: NodeSlideAgentModelId;
      providerEffort: NodeSlideReasoningEffort;
      providerConsent:
        | typeof NODESLIDE_OPENROUTER_EDIT_CONSENT
        | typeof NODESLIDE_OPENROUTER_VARIATIONS_CONSENT
        | typeof NODESLIDE_NEBIUS_REVIEW_CONSENT
        | typeof NODESLIDE_NEBIUS_VARIATIONS_CONSENT;
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
  providerModel?: unknown,
  providerEffort?: unknown,
): ValidatedNodeSlideProviderChoice {
  const mode: NodeSlideProviderMode =
    providerMode === undefined ? 'deterministic' : asMode(providerMode);
  if (mode === 'deterministic') {
    if (
      providerConsent !== undefined ||
      providerModel !== undefined ||
      providerEffort !== undefined
    ) {
      throw new NodeSlideProviderConsentError(
        'provider_consent_mismatch',
        'Provider consent, model, and effort must only accompany an external model request.',
      );
    }
    return { providerMode: 'deterministic' };
  }

  const providerName = mode === 'nebius' ? 'Nebius' : 'OpenRouter';
  const expected =
    mode === 'nebius'
      ? operation === 'propose_edit'
        ? NODESLIDE_NEBIUS_REVIEW_CONSENT
        : NODESLIDE_NEBIUS_VARIATIONS_CONSENT
      : operation === 'propose_edit'
        ? NODESLIDE_OPENROUTER_EDIT_CONSENT
        : NODESLIDE_OPENROUTER_VARIATIONS_CONSENT;
  if (providerConsent !== expected) {
    throw new NodeSlideProviderConsentError(
      'provider_consent_required',
      `Exact ${operation === 'propose_edit' ? 'edit-review' : 'variation'} consent is required before sending context to ${providerName}.`,
    );
  }
  const selectedModel = providerModel ?? nodeSlideDefaultModelForProviderMode(mode);
  if (!isNodeSlideAgentModelId(selectedModel)) {
    throw new NodeSlideProviderConsentError(
      'invalid_request',
      'Choose a supported NodeSlide agent model.',
    );
  }
  if (
    nodeSlideAgentModel(selectedModel).provider !== (mode === 'nebius' ? 'nebius' : 'openrouter')
  ) {
    throw new NodeSlideProviderConsentError(
      'invalid_request',
      `The selected model is not available through ${providerName}.`,
    );
  }
  const selectedEffort = providerEffort ?? NODESLIDE_DEFAULT_REASONING_EFFORT;
  if (!isNodeSlideReasoningEffort(selectedEffort)) {
    throw new NodeSlideProviderConsentError(
      'invalid_request',
      'Choose a supported NodeSlide reasoning effort.',
    );
  }
  if (!nodeSlideModelSupportsReasoningEffort(selectedModel, selectedEffort)) {
    throw new NodeSlideProviderConsentError(
      'invalid_request',
      `${nodeSlideAgentModel(selectedModel).label} does not support the selected reasoning effort through ${providerName}.`,
    );
  }
  return {
    providerMode: mode,
    providerModel: selectedModel,
    providerEffort: selectedEffort,
    providerConsent: expected,
  };
}

export async function invokeConsentedNodeSlideProvider<Result>(
  choice: ValidatedNodeSlideProviderChoice,
  invoke: () => Promise<Result>,
): Promise<Result | null> {
  return choice.providerMode === 'deterministic' ? null : await invoke();
}

function asMode(value: unknown): NodeSlideProviderMode {
  if (value === 'deterministic' || value === 'openrouter_free' || value === 'nebius') return value;
  throw new NodeSlideProviderConsentError(
    'invalid_request',
    'Choose a supported NodeSlide provider mode.',
  );
}
