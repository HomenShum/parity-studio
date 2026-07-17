import { type Infer, v } from 'convex/values';
import {
  nodeslideAgentModelValidator,
  nodeslideAgentReadReferenceValidator,
  nodeslideBriefAttachmentValidator,
  nodeslideBriefValidator,
  nodeslideDesignBehaviorValidator,
  nodeslideEditorCommandIdValidator,
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
