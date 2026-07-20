'use node';

import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { callNodeSlideFreeJson } from './lib/nodeslideProvider';
import {
  nodeslideAgentModelValidator,
  nodeslideReasoningEffortValidator,
} from './lib/nodeslideValidators';

const FREE_ROUTE_TOTAL_DEADLINE_MS = 30_000;
const MAX_PROMPT_CHARS = 100_000;
const BRANCH_MAX_TOKENS = 2_400;

export const generateStrictJson = internalAction({
  args: {
    systemPrompt: v.string(),
    userText: v.string(),
    model: nodeslideAgentModelValidator,
    reasoningEffort: nodeslideReasoningEffortValidator,
  },
  handler: async (_ctx, { systemPrompt, userText, model, reasoningEffort }) => {
    if (
      !systemPrompt ||
      systemPrompt.length > 4_000 ||
      !userText ||
      userText.length > MAX_PROMPT_CHARS
    ) {
      return { ok: false as const, reason: 'bounded_prompt_rejected' };
    }

    const result = await callNodeSlideFreeJson(
      {
        systemPrompt,
        userText,
        maxTokens: BRANCH_MAX_TOKENS,
        model,
        reasoningEffort,
      },
      { timeoutMs: FREE_ROUTE_TOTAL_DEADLINE_MS },
    );
    if (!result.ok) {
      const timedOut = result.reason.endsWith(' route timed out.');
      return {
        ok: false as const,
        reason: timedOut ? 'provider_timeout' : 'provider_unavailable',
      };
    }
    return { ok: true as const, value: result.value };
  },
});
