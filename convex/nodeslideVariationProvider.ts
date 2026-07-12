'use node';

import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { callNodeSlideFreeJson } from './lib/nodeslideProvider';

const FREE_ROUTE_TOTAL_DEADLINE_MS = 7_000;
const MAX_PROMPT_CHARS = 100_000;

export const generateStrictJson = internalAction({
  args: {
    systemPrompt: v.string(),
    userText: v.string(),
  },
  handler: async (_ctx, { systemPrompt, userText }) => {
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
        maxTokens: 6_000,
      },
      { timeoutMs: FREE_ROUTE_TOTAL_DEADLINE_MS },
    );
    if (!result.ok) {
      const timedOut = result.reason === 'The GLM 5.2 route timed out.';
      return {
        ok: false as const,
        reason: timedOut ? 'provider_timeout' : 'provider_unavailable',
      };
    }
    return { ok: true as const, value: result.value };
  },
});
