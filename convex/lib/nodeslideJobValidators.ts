import { type Infer, v } from 'convex/values';
import {
  nodeslideAgentModelValidator,
  nodeslideBriefAttachmentValidator,
  nodeslideBriefValidator,
  nodeslideReasoningEffortValidator,
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
