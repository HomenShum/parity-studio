/**
 * pi-ai wrapper for the MCP server. Mirrors convex/lib/piAi.ts so the MCP
 * package and the Convex backend share the same provider abstraction.
 *
 * Source: github.com/badlogic/pi-mono, packages/ai (maintained as @earendil-works/pi-ai).
 *
 * API surface:
 *   import { getModel, complete } from '@earendil-works/pi-ai/compat';
 *   const model = getModel('anthropic', 'claude-sonnet-4-6');
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
 * Provider keys (read by pi-ai from process.env):
 *   ANTHROPIC_API_KEY    for claude-* models
 *   OPENAI_API_KEY       for gpt-* models
 *   GEMINI_API_KEY       for gemini-* models (via google provider)
 *   OPENROUTER_API_KEY   for vendor/model OpenRouter routing
 *   GROQ_API_KEY, CEREBRAS_API_KEY, XAI_API_KEY, MISTRAL_API_KEY ... per pi-ai
 *
 * Design rationale (override on prior commit's @anthropic-ai/sdk + openai approach):
 * pi-ai is the canonical stack across parity-studio (Convex backend uses it
 * via convex/lib/piAi.ts; the original spec calls for it; the offline PoC
 * pipeline at scripts/career/poc-headless-pipeline/ uses the same models).
 * Stack consistency > install-size optimization.
 */

import {
  type AssistantMessage,
  type Context,
  type ImageContent,
  type TextContent,
  getModel,
  complete as piComplete,
} from '@earendil-works/pi-ai/compat';

/**
 * pi-ai's Provider type is `KnownProvider | string` (open by design — users
 * can register custom providers). We narrow to a known set of vision-capable
 * providers we route to today. Add more as we validate them.
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

export interface VisionInput {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface CallOptions {
  /** Provider id (anthropic, openai, google, openrouter, groq, cerebras, xai, mistral). */
  provider: SupportedProvider;
  /** Provider-specific model id (e.g. claude-sonnet-4-6, gpt-5, gemini-2.5-pro, openai/gpt-4o). */
  modelId: string;
  systemPrompt: string;
  userText: string;
  /** Optional vision input. Both fields required if present. Errors if model lacks vision. */
  userImage?: VisionInput;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Optional local/OpenAI-compatible endpoint override. Kept in the MCP process. */
  baseUrl?: string;
}

export interface CallResult {
  text: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  provider: SupportedProvider;
  stopReason: AssistantMessage['stopReason'];
  errorMessage?: string;
}

/**
 * Infer provider from a model id. Conservative: prefers explicit prefixes
 * (anthropic/, openai/, google/) over substring sniffs (claude-*, gpt-*).
 * Used by the high-level call() so MCP tool handlers can pass a single
 * `model` string and we route correctly.
 */
export function inferProvider(modelId: string): SupportedProvider {
  if (modelId.startsWith('anthropic/') || modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('openai/') || modelId.startsWith('gpt-')) return 'openai';
  if (modelId.startsWith('google/') || modelId.startsWith('gemini-')) return 'google';
  if (modelId.startsWith('mistral/') || modelId.startsWith('mistral-')) return 'mistral';
  if (modelId.startsWith('groq/')) return 'groq';
  if (modelId.startsWith('cerebras/')) return 'cerebras';
  if (modelId.startsWith('xai/') || modelId.startsWith('grok-')) return 'xai';
  // Anything with a `/` and not matched above is OpenRouter convention
  if (modelId.includes('/')) return 'openrouter';
  return 'openai';
}

/**
 * Strip provider prefix if present so getModel(provider, id) gets the canonical
 * id. e.g. "anthropic/claude-sonnet-4-6" + provider="anthropic" -> "claude-sonnet-4-6".
 */
function canonicalizeModelId(provider: SupportedProvider, modelId: string): string {
  const prefix = `${provider}/`;
  if (modelId.startsWith(prefix)) return modelId.slice(prefix.length);
  return modelId;
}

/**
 * Single completion call. Supports text-only and vision.
 *
 * Error handling per agentic_reliability HONEST_STATUS:
 * - Network/auth errors throw (callers wrap with try/catch and surface
 *   structured error in MCP tool response)
 * - Model returns stopReason='error' -> CallResult with errorMessage set
 * - Model returns stopReason='length' -> CallResult; caller decides whether
 *   to retry with larger maxTokens
 */
export async function call(opts: CallOptions): Promise<CallResult> {
  const canonicalId = canonicalizeModelId(opts.provider, opts.modelId);
  // pi-ai's getModel is typed against its compile-time MODEL registry, but
  // we accept arbitrary strings at this boundary (env-driven model overrides,
  // per-call user input). Runtime validation inside getModel throws for
  // unknown ids — we surface that as a clear error message to the agent.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const registryModel = (getModel as any)(opts.provider, canonicalId);
  const model = opts.baseUrl ? { ...registryModel, baseUrl: opts.baseUrl } : registryModel;

  const userContent: (TextContent | ImageContent)[] = [{ type: 'text', text: opts.userText }];
  if (opts.userImage !== undefined) {
    if (!model.input.includes('image')) {
      throw new Error(`pi-ai model ${opts.provider}/${canonicalId} does not support image input`);
    }
    userContent.push({
      type: 'image',
      data: opts.userImage.base64,
      mimeType: opts.userImage.mediaType,
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
    costUsd: Number.isFinite(result.usage.cost.total) ? result.usage.cost.total : 0,
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
    provider: opts.provider,
    modelUsed: result.model,
    stopReason: result.stopReason,
  };
  if (result.errorMessage !== undefined) out.errorMessage = result.errorMessage;
  return out;
}

/**
 * Convenience wrapper that infers the provider from the model id. Same
 * object-arg shape as call() so renames are a one-liner. Prefer call()
 * directly when you know both provider + modelId — fewer miscategorizations
 * at the boundary.
 */
export async function callByModel(
  opts: { model: string } & Omit<CallOptions, 'provider' | 'modelId'>,
): Promise<CallResult> {
  const { model, ...rest } = opts;
  const provider = inferProvider(model);
  return await call({ provider, modelId: model, ...rest });
}
