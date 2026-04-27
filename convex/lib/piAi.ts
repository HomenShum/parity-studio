/**
 * pi-ai wrapper for Convex actions.
 *
 * Source: github.com/badlogic/pi-mono, packages/ai (published as
 * `@mariozechner/pi-ai`). Real API surface, NOT a stub:
 *
 *   import { getModel, complete } from '@mariozechner/pi-ai';
 *   const model = getModel('anthropic', 'claude-sonnet-4-20250514');
 *   const result = await complete(model, {
 *     systemPrompt: '...',
 *     messages: [{ role: 'user', content: [
 *       { type: 'text', text: '...' },
 *       { type: 'image', data: base64, mimeType: 'image/png' },
 *     ]}],
 *   });
 *   // result.content: (TextContent | ThinkingContent | ToolCall)[]
 *   // result.usage.cost.total: USD float
 *
 * API key resolution: pi-ai reads ANTHROPIC_API_KEY / OPENAI_API_KEY /
 * GEMINI_API_KEY / OPENROUTER_API_KEY etc. from process.env. In Convex,
 * set via `npx convex env set ANTHROPIC_API_KEY sk-ant-...`.
 */

import {
  type AssistantMessage,
  type Context,
  type ImageContent,
  type TextContent,
  complete as piComplete,
  getModel,
} from '@mariozechner/pi-ai';

/**
 * pi-ai's Provider type is `KnownProvider | string` (open by design — users
 * can register custom providers). We narrow to a known set of vision-capable
 * providers we route to today. Same approach as mcp/src/lib/llmClient.ts.
 */
export type SupportedProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'groq'
  | 'cerebras'
  | 'xai'
  | 'mistral';

export interface CallOptions {
  provider: SupportedProvider;
  modelId: string;
  systemPrompt: string;
  userText: string;
  /** Optional vision input. Both fields required if present. */
  userImage?: { base64: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' };
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CallResult {
  text: string;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  provider: SupportedProvider;
  stopReason: AssistantMessage['stopReason'];
  errorMessage?: string;
}

/** Convert USD float to integer micro-cents (avoids float drift on summation). */
export function usdToMicroUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) return 0;
  return Math.floor(usd * 1_000_000);
}

export function microUsdToUsd(micro: number): number {
  return micro / 1_000_000;
}

/**
 * Single completion call. Supports text-only and vision. Returns structured
 * result with cost in micro-USD for clean DB storage.
 *
 * Error handling per agentic_reliability HONEST_STATUS rule:
 * - Network/auth errors throw (Workflow component will retry per its policy)
 * - Model returns stopReason='error' → return CallResult with errorMessage set
 * - Model returns stopReason='length' → return CallResult; caller must decide
 *   whether to continue (`length` means truncated mid-response)
 */
export async function call(opts: CallOptions): Promise<CallResult> {
  // pi-ai's getModel is typed against its compile-time MODEL registry; we
  // accept arbitrary strings at this boundary (env-driven model overrides).
  // Runtime validation inside getModel throws for unknown ids — surfaced
  // back to the workflow as a clear error.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const model = (getModel as any)(opts.provider, opts.modelId);

  const userContent: (TextContent | ImageContent)[] = [{ type: 'text', text: opts.userText }];
  if (opts.userImage !== undefined) {
    if (!model.input.includes('image')) {
      throw new Error(
        `pi-ai model ${opts.provider}/${opts.modelId} does not support image input`,
      );
    }
    userContent.push({
      type: 'image',
      data: opts.userImage.base64,
      mimeType: opts.userImage.mimeType,
    });
  }

  const context: Context = {
    systemPrompt: opts.systemPrompt,
    messages: [
      {
        role: 'user',
        content: userContent,
        timestamp: Date.now(),
      },
    ],
  };

  const result = await piComplete(model, context, {
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.maxTokens !== undefined ? { maxOutputTokens: opts.maxTokens } : {}),
  });

  const textBlocks = result.content.filter((b): b is TextContent => b.type === 'text');
  const text = textBlocks.map((b) => b.text).join('');
  const out: CallResult = {
    text,
    costMicroUsd: usdToMicroUsd(result.usage.cost.total),
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
    provider: opts.provider,
    modelUsed: result.model,
    stopReason: result.stopReason,
  };
  if (result.errorMessage !== undefined) out.errorMessage = result.errorMessage;
  return out;
}
