'use node';

import { type Context, type TextContent, complete, getModel } from '@mariozechner/pi-ai';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';

const FREE_ROUTE_TIMEOUT_MS = 6_500;
const FREE_ROUTE_TOTAL_DEADLINE_MS = 7_000;
const MAX_PROMPT_CHARS = 100_000;
const MAX_RESPONSE_CHARS = 32_000;
const OPENROUTER_ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://parity.studio',
  'X-Title': 'Parity Studio',
};

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

    const abortSignal = AbortSignal.timeout(FREE_ROUTE_TIMEOUT_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('variation_provider_deadline')),
          FREE_ROUTE_TOTAL_DEADLINE_MS,
        );
      });
      // One pi-ai completion only: no wrapper retries and no second provider call.
      // biome-ignore lint/suspicious/noExplicitAny: pi-ai's registry type does not include dynamic routes
      const model = (getModel as any)('openrouter', 'openrouter/free');
      const context: Context = {
        systemPrompt,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }],
            timestamp: Date.now(),
          },
        ],
      };
      const result = await Promise.race([
        complete(model, context, {
          signal: abortSignal,
          maxOutputTokens: 6_000,
          headers: OPENROUTER_ATTRIBUTION_HEADERS,
          maxRetries: 0,
        }),
        timeout,
      ]);
      if (result.stopReason === 'error') {
        return { ok: false as const, reason: 'free_route_error' };
      }
      if (result.stopReason === 'length') {
        return { ok: false as const, reason: 'free_route_incomplete' };
      }
      const text = result.content
        .filter((block): block is TextContent => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (text.length > MAX_RESPONSE_CHARS) {
        return { ok: false as const, reason: 'provider_response_too_large' };
      }
      const value = parseStrictJson(text);
      if (value === undefined) {
        return { ok: false as const, reason: 'malformed_provider_json' };
      }
      return { ok: true as const, value };
    } catch (error) {
      const timedOut =
        abortSignal.aborted ||
        (error instanceof Error && error.message === 'variation_provider_deadline');
      return {
        ok: false as const,
        reason: timedOut ? 'provider_timeout' : 'provider_unavailable',
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  },
});

function parseStrictJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}
