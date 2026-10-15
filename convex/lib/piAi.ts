/**
 * pi-ai wrapper for Convex actions.
 *
 * Source: github.com/badlogic/pi-mono, packages/ai (published as
 * `@earendil-works/pi-ai`). Real API surface, NOT a stub:
 *
 *   import { getModel, complete } from '@earendil-works/pi-ai/compat';
 *   const model = getModel('anthropic', 'claude-sonnet-5-5');
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
 *
 * OpenRouter rate-limit hardening (added 2026-04-29 after eval):
 *   - HTTP-Referer + X-Title headers per OpenRouter's app-attribution docs
 *     (https://openrouter.ai/docs/api-reference/overview#headers). Apps that
 *     send these get higher per-key rate-limit allocations.
 *   - maxRetries=3 client-side so transient 429s on the upstream provider
 *     (Venice, Google AI Studio, etc.) don't fail the whole call.
 *   - Retry-with-jittered-backoff on stopReason==='error' since pi-ai treats
 *     upstream HTTP errors as soft failures (returns errorMessage, doesn't
 *     throw).
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

/** Anthropic effort for the managed-effort Claude 5.5 models; every other API ignores it. */
export type Effort = 'low' | 'medium' | 'high';

export interface CallOptions {
  provider: SupportedProvider;
  modelId: string;
  systemPrompt: string;
  userText: string;
  /** Optional vision input. Both fields required if present. */
  userImage?: { base64: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' };
  maxTokens?: number;
  /** Per-phase effort (PHASE_EFFORT in autoRouter.ts). Omitted = pi-ai's own default. */
  effort?: Effort;
  signal?: AbortSignal;
}

export interface CallResult {
  text: string;
  /** Cost of every attempt `call()` made (soft retries included), not just the one whose text it returns. */
  costMicroUsd: number;
  /**
   * Completions `call()` asked pi-ai for: 1 + soft retries (OpenRouter only; see `maxAttempts`). NOT the number of
   * HTTP requests: pi-ai retries 429/5xx itself inside one completion (`maxRetries: 3` for OpenRouter), so count
   * transport requests at the transport (the live receipt wraps `fetch`) when the real number matters.
   */
  completionAttempts: number;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  provider: SupportedProvider;
  stopReason: AssistantMessage['stopReason'];
  /**
   * The model string the provider itself returned, read off the raw provider stream (Anthropic `message_start.model`,
   * OpenAI-compatible chunk `model`, Google `modelVersion`), or pi-ai's `responseModel` when it saw a different one.
   * `null` when the provider returned none (call aborted or failed before any reply): it is never filled in from the
   * requested id, because pi-ai's Google adapter initialises `model` from the request and ignores `modelVersion`
   * (google-generative-ai.js:23), so `result.model` would hide a substitution. SPEC A.0.3.
   */
  echoedModel: string | null;
  errorMessage?: string;
}

/**
 * Per-call effort that actually governs the current turn. pi-ai 1.1.0 hard-codes the top-level `output_config.effort`
 * of a managed-effort (Claude 5.5) request to 'high' (anthropic-messages.js:944) and puts the per-call `effort` only
 * in a trailing `role: 'system'` message after the last user message (:1216). The API applies a per-message effort
 * change "from the next user turn" (migration guide), and no user turn follows, so the trailing value alone would
 * leave every phase at 'high'. This sets the top-level value to `effort` as well. Payloads with no
 * `output_config.effort` (every other API, and pre-5.5 Claude) are left untouched.
 */
export function effortOptions(effort: Effort | undefined): {
  effort?: Effort;
  onPayload?: (payload: unknown) => unknown;
} {
  if (effort === undefined) return {};
  return {
    effort,
    onPayload: (payload) => {
      const p = payload as { output_config?: { effort?: unknown } } | null;
      if (p?.output_config?.effort === undefined) return undefined;
      return { ...p, output_config: { ...p.output_config, effort } };
    },
  };
}

/** The model string a raw provider stream event carries, if any (see `CallResult.echoedModel`). */
function eventModel(data: unknown): string | undefined {
  const d = data as {
    message?: { model?: unknown };
    model?: unknown;
    modelVersion?: unknown;
  } | null;
  for (const v of [d?.message?.model, d?.model, d?.modelVersion]) {
    if (typeof v === 'string' && v !== '') return v;
  }
  return undefined;
}

/** Convert USD float to integer micro-cents (avoids float drift on summation). */
export function usdToMicroUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) return 0;
  return Math.floor(usd * 1_000_000);
}

export function microUsdToUsd(micro: number): number {
  return micro / 1_000_000;
}

/** OpenRouter app-attribution headers (https://openrouter.ai/docs/api-reference/overview#headers). */
export const OPENROUTER_ATTRIBUTION_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://parity.studio',
  'X-Title': 'Parity Studio',
};

/** Treat 429 / rate-limit errors as retriable. pi-ai surfaces them via errorMessage. */
function isRetriableError(msg: string | undefined): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('rate-limit') ||
    lower.includes('temporarily rate-limited') ||
    lower.includes('upstream')
  );
}

/**
 * Completion requests `call()` may dispatch for one provider: OpenRouter soft-retries upstream errors twice
 * (SOFT_RETRIES), everything else is one request. The live receipt harness budgets against this. It counts the
 * completion requests this function dispatches, not pi-ai's own HTTP-level retries (`maxRetries: 3`) inside one.
 */
const OPENROUTER_SOFT_RETRIES = 2;
export const maxAttempts = (provider: SupportedProvider): number =>
  provider === 'openrouter' ? 1 + OPENROUTER_SOFT_RETRIES : 1;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
      throw new Error(`pi-ai model ${opts.provider}/${opts.modelId} does not support image input`);
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

  // Provider-specific options. OpenRouter wants attribution headers and
  // benefits from client-side retry on upstream rate-limits.
  const isOpenRouter = opts.provider === 'openrouter';
  const baseOptions = {
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    ...effortOptions(opts.effort),
    ...(isOpenRouter ? { headers: OPENROUTER_ATTRIBUTION_HEADERS, maxRetries: 3 } : {}),
  };

  // Retry loop for soft errors (stopReason='error' with retriable message).
  // pi-ai's maxRetries handles HTTP-level retries inside the SDK, but
  // OpenRouter often returns a 200-with-error-body for upstream 429s, which
  // pi-ai surfaces as stopReason='error'. We catch that here.
  const MAX_SOFT_RETRIES = maxAttempts(opts.provider) - 1;
  let lastResult: Awaited<ReturnType<typeof piComplete>> | undefined;
  let completionAttempts = 0;
  let spentUsd = 0;
  let providerModel: string | undefined;
  const onProviderStreamEvent = (data: unknown) => {
    providerModel = eventModel(data) ?? providerModel;
  };
  for (let attempt = 0; attempt <= MAX_SOFT_RETRIES; attempt += 1) {
    providerModel = undefined;
    lastResult = await piComplete(model, context, { ...baseOptions, onProviderStreamEvent });
    completionAttempts += 1;
    spentUsd += Number.isFinite(lastResult.usage.cost.total) ? lastResult.usage.cost.total : 0;
    const isSoftError =
      lastResult.stopReason === 'error' && isRetriableError(lastResult.errorMessage);
    if (!isSoftError || attempt === MAX_SOFT_RETRIES) break;
    // Exponential backoff with jitter: 1s, 3s
    const waitMs = 1000 * 3 ** attempt + Math.floor(Math.random() * 500);
    await sleep(waitMs);
  }
  if (lastResult === undefined) {
    throw new Error('piComplete returned no result');
  }
  const result = lastResult;

  const textBlocks = result.content.filter((b): b is TextContent => b.type === 'text');
  const text = textBlocks.map((b) => b.text).join('');
  const out: CallResult = {
    text,
    costMicroUsd: usdToMicroUsd(spentUsd),
    completionAttempts,
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
    provider: opts.provider,
    modelUsed: result.model,
    stopReason: result.stopReason,
    echoedModel: providerModel ?? result.responseModel ?? null,
  };
  if (result.errorMessage !== undefined) out.errorMessage = result.errorMessage;
  return out;
}
