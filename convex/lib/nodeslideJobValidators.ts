import { type Infer, v } from 'convex/values';
import {
  nodeslideAgentModelValidator,
  nodeslideAgentReadReferenceValidator,
  nodeslideBriefAttachmentValidator,
  nodeslideBriefValidator,
  nodeslideDesignBehaviorValidator,
  nodeslideEditorCommandIdValidator,
  nodeslidePatchOperationValidator,
  nodeslidePatchScopeValidator,
  nodeslideProviderModeValidator,
  nodeslideReasoningEffortValidator,
  nodeslideReferenceUseValidator,
  nodeslideVersionClockValidator,
} from './nodeslideValidators';

export const nodeslideCreateJobRequestFields = {
  accessCode: v.optional(v.string()),
  clientSessionId: v.string(),
  title: v.string(),
  brief: nodeslideBriefValidator,
  themeId: v.string(),
  route: v.union(v.literal('free'), v.literal('balanced'), v.literal('frontier')),
  providerMode: v.optional(v.string()),
  providerModel: v.optional(nodeslideAgentModelValidator),
  providerEffort: v.optional(nodeslideReasoningEffortValidator),
  providerConsent: v.optional(v.string()),
  attachments: v.optional(v.array(nodeslideBriefAttachmentValidator)),
};

export const nodeslideCreateJobRequestValidator = v.object(nodeslideCreateJobRequestFields);
export type NodeSlideCreateJobRequest = Infer<typeof nodeslideCreateJobRequestValidator>;

export const nodeslideEditProposalJobRequestFields = {
  clientSessionId: v.string(),
  deckId: v.string(),
  instruction: v.string(),
  baseDeckVersion: v.number(),
  baseSlideVersions: nodeslideVersionClockValidator,
  baseElementVersions: nodeslideVersionClockValidator,
  scope: nodeslidePatchScopeValidator,
  focusSlideId: v.optional(v.string()),
  readContext: v.optional(v.array(nodeslideAgentReadReferenceValidator)),
  designBehavior: v.optional(nodeslideDesignBehaviorValidator),
  referenceUse: v.optional(nodeslideReferenceUseValidator),
  commandId: v.optional(nodeslideEditorCommandIdValidator),
  providerMode: v.optional(nodeslideProviderModeValidator),
  providerModel: v.optional(nodeslideAgentModelValidator),
  providerEffort: v.optional(nodeslideReasoningEffortValidator),
  providerConsent: v.optional(v.string()),
  maxCostUsd: v.optional(v.number()),
  webResearch: v.optional(v.boolean()),
  webResearchConsent: v.optional(v.string()),
  memoryMode: v.optional(v.union(v.literal('off'), v.literal('relevant'))),
  sourceRefreshBinding: v.optional(
    v.object({ proposalId: v.string(), baseSnapshotDigest: v.string() }),
  ),
};

export const nodeslideEditProposalJobRequestValidator = v.object(
  nodeslideEditProposalJobRequestFields,
);
export type NodeSlideEditProposalJobRequest = Infer<
  typeof nodeslideEditProposalJobRequestValidator
>;

/** Removes the one-shot preview secret before request journaling or digesting. */
export function nodeSlideCreateJobRequestFromArgs(
  args: NodeSlideCreateJobRequest,
): NodeSlideCreateJobRequest {
  return {
    clientSessionId: args.clientSessionId,
    title: args.title,
    brief: args.brief,
    themeId: args.themeId,
    route: args.route,
    ...(typeof args.providerMode === 'string' ? { providerMode: args.providerMode } : {}),
    ...(args.providerModel ? { providerModel: args.providerModel } : {}),
    ...(args.providerEffort ? { providerEffort: args.providerEffort } : {}),
    ...(typeof args.providerConsent === 'string' ? { providerConsent: args.providerConsent } : {}),
    ...(args.attachments ? { attachments: args.attachments } : {}),
  };
}

/** Omits runtime-only workflow fields while binding every edit input and consent receipt. */
export function nodeSlideEditProposalJobRequestFromArgs(
  args: NodeSlideEditProposalJobRequest,
): NodeSlideEditProposalJobRequest {
  return {
    clientSessionId: args.clientSessionId,
    deckId: args.deckId,
    instruction: args.instruction,
    baseDeckVersion: args.baseDeckVersion,
    baseSlideVersions: args.baseSlideVersions,
    baseElementVersions: args.baseElementVersions,
    scope: args.scope,
    ...(args.focusSlideId ? { focusSlideId: args.focusSlideId } : {}),
    ...(args.readContext ? { readContext: args.readContext } : {}),
    ...(args.designBehavior ? { designBehavior: args.designBehavior } : {}),
    ...(args.referenceUse ? { referenceUse: args.referenceUse } : {}),
    ...(args.commandId ? { commandId: args.commandId } : {}),
    ...(args.providerMode ? { providerMode: args.providerMode } : {}),
    ...(args.providerModel ? { providerModel: args.providerModel } : {}),
    ...(args.providerEffort ? { providerEffort: args.providerEffort } : {}),
    ...(typeof args.providerConsent === 'string' ? { providerConsent: args.providerConsent } : {}),
    ...(args.maxCostUsd !== undefined ? { maxCostUsd: args.maxCostUsd } : {}),
    ...(args.webResearch !== undefined ? { webResearch: args.webResearch } : {}),
    ...(typeof args.webResearchConsent === 'string'
      ? { webResearchConsent: args.webResearchConsent }
      : {}),
    ...(args.memoryMode ? { memoryMode: args.memoryMode } : {}),
    ...(args.sourceRefreshBinding ? { sourceRefreshBinding: args.sourceRefreshBinding } : {}),
  };
}

/** Bounded live render-repair evidence persisted on a durable job row. */
export const nodeslideJobRenderRepairSummaryValidator = v.object({
  schemaVersion: v.literal('nodeslide.live-render-repair/v1'),
  status: v.union(v.literal('completed'), v.literal('stopped')),
  terminalReason: v.string(),
  attempts: v.number(),
  proposalOperationCount: v.number(),
  baseSnapshotDigest: v.string(),
  candidateSnapshotDigest: v.string(),
  receipts: v.array(v.object({ attempt: v.number(), status: v.string(), summary: v.string() })),
  proposal: v.optional(
    v.object({
      deckId: v.string(),
      baseDeckVersion: v.number(),
      baseSlideVersions: nodeslideVersionClockValidator,
      baseElementVersions: nodeslideVersionClockValidator,
      scope: nodeslidePatchScopeValidator,
      operations: v.array(nodeslidePatchOperationValidator),
    }),
  ),
});

/** Immutable admission-time routing decision persisted on a durable job row. */
export const nodeslideJobRoutingReceiptValidator = v.object({
  policyVersion: v.literal('nodeslide.auto-routing/v1'),
  enforcement: v.union(v.literal('advisory_v1'), v.literal('enforced_v1')),
  decidedAt: v.number(),
  task: v.literal('create_deck_from_brief'),
  requested: v.union(
    v.object({ mode: v.literal('deterministic') }),
    v.object({
      mode: v.union(v.literal('openrouter_free'), v.literal('nebius')),
      model: v.string(),
    }),
  ),
  decision: v.union(
    v.object({
      kind: v.literal('selected'),
      provider: v.string(),
      modelId: v.string(),
      estimatedMicroUsd: v.union(v.number(), v.null()),
      pricingSource: v.union(v.string(), v.null()),
    }),
    v.object({
      kind: v.literal('refused'),
      code: v.string(),
      message: v.string(),
    }),
  ),
  availabilityBasis: v.object({ windowMs: v.number(), signalCount: v.number() }),
  // Optional because receipts persisted before this field exist; absence reads
  // as 'none' (advisory), never as negative evidence.
  requestedRouteSignal: v.optional(
    v.union(v.literal('confirmed'), v.literal('failed'), v.literal('none')),
  ),
  reasons: v.array(v.string()),
});
