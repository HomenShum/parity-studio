import type {
  AgentReadReference,
  AgentReadReferenceKind,
  CandidateValidationReceipt,
  CommentAnchor,
  DeckPatch,
  NODESLIDE_NEBIUS_REVIEW_CONSENT,
  NODESLIDE_NEBIUS_VARIATIONS_CONSENT,
  NODESLIDE_OPENROUTER_REVIEW_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
  NODESLIDE_WEB_RESEARCH_CONSENT,
  NodeSlideAgentModelId,
  NodeSlideDesignBehavior,
  NodeSlideEditorCommandId,
  NodeSlideProviderMode,
  NodeSlideReasoningEffort,
  NodeSlideReferenceUsePolicy,
} from '../../../../shared/nodeslide';

export {
  NODESLIDE_NEBIUS_REVIEW_CONSENT,
  NODESLIDE_NEBIUS_VARIATIONS_CONSENT,
  NODESLIDE_OPENROUTER_REVIEW_CONSENT,
  NODESLIDE_OPENROUTER_VARIATIONS_CONSENT,
  NODESLIDE_WEB_RESEARCH_CONSENT,
} from '../../../../shared/nodeslide';

export const AI_DRAFTING_PHASE_MS = 900 as const;

export type AiProviderMode = NodeSlideProviderMode;
export type AiReadReferenceKind = AgentReadReferenceKind;
export type AiReadReference = AgentReadReference;
export type AiDesignBehaviorPolicy = NodeSlideDesignBehavior;
export type AiReferenceUsePolicy = NodeSlideReferenceUsePolicy;
export type AiCandidateValidationReceipt = CandidateValidationReceipt;
export type AiReviewablePatch = DeckPatch;

export type AiProviderRequest =
  | { providerMode: 'deterministic' }
  | {
      providerMode: 'openrouter_free' | 'nebius';
      providerModel: NodeSlideAgentModelId;
      providerEffort: NodeSlideReasoningEffort;
      providerConsent:
        | typeof NODESLIDE_OPENROUTER_REVIEW_CONSENT
        | typeof NODESLIDE_NEBIUS_REVIEW_CONSENT;
    };

export type AiVariationProviderRequest =
  | { providerMode: 'deterministic' }
  | {
      providerMode: 'openrouter_free' | 'nebius';
      providerModel: NodeSlideAgentModelId;
      providerEffort: NodeSlideReasoningEffort;
      providerConsent:
        | typeof NODESLIDE_OPENROUTER_VARIATIONS_CONSENT
        | typeof NODESLIDE_NEBIUS_VARIATIONS_CONSENT;
    };

export interface AiComposerCommand<CommandId extends string = NodeSlideEditorCommandId> {
  id: CommandId;
  label: string;
  description?: string;
}

export interface AiProposalPolicy {
  designBehavior: AiDesignBehaviorPolicy;
  referenceUse: AiReferenceUsePolicy;
}

export interface AiCommentContext extends AiReadReference {
  kind: 'comment';
  text: string;
  anchor: CommentAnchor;
}

export type AiAgentActivity =
  | {
      status: 'running';
      elapsedMs: number;
      ask: string;
    }
  | {
      status: 'delayed' | 'timed_out' | 'failed' | 'cancelled';
      elapsedMs: number;
      ask: string;
      message?: string;
    };

export interface AiSuggestedAction {
  id: string;
  label: string;
  instruction: string;
}

interface AiProposalContext {
  readContext: readonly AiReadReference[];
  designBehavior: AiDesignBehaviorPolicy;
  referenceUse: AiReferenceUsePolicy;
  commentContext?: AiCommentContext;
  idempotencyKey?: string;
  webResearch?: boolean;
  webResearchConsent?: typeof NODESLIDE_WEB_RESEARCH_CONSENT;
  memoryMode?: 'off' | 'relevant';
}

export type AiProposalOptions<CommandId extends string = NodeSlideEditorCommandId> =
  AiProposalContext &
    AiProviderRequest & {
      commandId?: Exclude<CommandId, '/variations' | 'variations'>;
    };

interface AiVariationContext {
  readContext: readonly AiReadReference[];
  designBehavior: AiDesignBehaviorPolicy;
  referenceUse: AiReferenceUsePolicy;
  source: 'button' | 'command';
  commentContext?: AiCommentContext;
}

export type AiVariationRequest = AiVariationContext & AiVariationProviderRequest;
