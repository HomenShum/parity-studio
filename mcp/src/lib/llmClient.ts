/**
 * Provider-agnostic LLM client for the MCP server. Mirrors the PoC pipeline's
 * provider.ts. Routes by model id:
 *   claude-*           -> Anthropic (needs ANTHROPIC_API_KEY)
 *   gpt-*              -> OpenAI (needs OPENAI_API_KEY)
 *   <vendor>/<model>   -> OpenRouter (needs OPENROUTER_API_KEY)
 *
 * Why we don't pull in @mariozechner/pi-ai here: pi-ai's full SDK has a
 * substantial dependency tree (multiple provider SDKs bundled). The MCP
 * server should be tiny + npx-installable. We use the underlying provider
 * SDKs directly.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type ProviderId = 'anthropic' | 'openai' | 'openrouter';

export interface VisionInput {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface CallOptions {
  model: string;
  systemPrompt: string;
  userText: string;
  userImage?: VisionInput;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CallResult {
  text: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  provider: ProviderId;
  stopReason: string;
}

export function inferProvider(model: string): ProviderId {
  if (model.startsWith('claude-') || model.startsWith('anthropic/')) return 'anthropic';
  if (model.includes('/')) return 'openrouter';
  return 'openai';
}

/**
 * Anthropic per-model pricing (USD per million tokens). Conservative defaults.
 * Update when models rotate.
 */
const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

function priceAnthropic(modelId: string, input: number, output: number): number {
  // Default to Sonnet pricing if unknown — Anthropic generally bills below this
  const p = ANTHROPIC_PRICING[modelId] ?? { input: 3, output: 15 };
  return (input * p.input + output * p.output) / 1_000_000;
}

async function callAnthropic(opts: CallOptions): Promise<CallResult> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for claude-* models');
  const client = new Anthropic({ apiKey });

  const userContent: Anthropic.MessageParam['content'] = [{ type: 'text', text: opts.userText }];
  if (opts.userImage) {
    userContent.unshift({
      type: 'image',
      source: {
        type: 'base64',
        media_type: opts.userImage.mediaType,
        data: opts.userImage.base64,
      },
    });
  }

  const requestOptions: Anthropic.RequestOptions = {};
  if (opts.signal !== undefined) requestOptions.signal = opts.signal;

  const result = await client.messages.create(
    {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    },
    requestOptions,
  );

  const textBlocks = result.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
  const text = textBlocks.map((b) => b.text).join('');

  return {
    text,
    costUsd: priceAnthropic(opts.model, result.usage.input_tokens, result.usage.output_tokens),
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    modelUsed: result.model,
    provider: 'anthropic',
    stopReason: result.stop_reason ?? 'end_turn',
  };
}

async function callOpenAI(opts: CallOptions): Promise<CallResult> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) throw new Error('OPENAI_API_KEY required for gpt-* models');
  const client = new OpenAI({ apiKey });

  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: opts.userText },
  ];
  if (opts.userImage) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${opts.userImage.mediaType};base64,${opts.userImage.base64}` },
    });
  }

  const result = await client.chat.completions.create(
    {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: userContent },
      ],
    },
    opts.signal !== undefined ? { signal: opts.signal } : undefined,
  );

  const choice = result.choices[0];
  const text = choice?.message.content ?? '';
  const usage = result.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  // OpenAI doesn't return cost — we estimate at sane defaults; users can override.
  const costUsd = (usage.prompt_tokens * 5 + usage.completion_tokens * 15) / 1_000_000;

  return {
    text,
    costUsd,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    modelUsed: result.model,
    provider: 'openai',
    stopReason: choice?.finish_reason ?? 'stop',
  };
}

async function callOpenRouter(opts: CallOptions): Promise<CallResult> {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required for vendor/model ids');
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/HomenShum/parity-studio',
      'X-Title': 'Parity Studio MCP',
    },
  });

  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: opts.userText },
  ];
  if (opts.userImage) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${opts.userImage.mediaType};base64,${opts.userImage.base64}` },
    });
  }

  const result = await client.chat.completions.create(
    {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: userContent },
      ],
    },
    opts.signal !== undefined ? { signal: opts.signal } : undefined,
  );

  const choice = result.choices[0];
  const text = choice?.message.content ?? '';
  const usage = result.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  // OpenRouter returns cost in `usage.cost` for some models; safer to recompute conservative
  const costUsd =
    (usage as unknown as { cost?: number }).cost ??
    (usage.prompt_tokens * 3 + usage.completion_tokens * 12) / 1_000_000;

  return {
    text,
    costUsd,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    modelUsed: result.model,
    provider: 'openrouter',
    stopReason: choice?.finish_reason ?? 'stop',
  };
}

/**
 * Single completion call with vision support. Routes to the right provider
 * by model id. HONEST_STATUS: throws on auth/network errors so the caller
 * (MCP tool handler) can return a clear error response to the agent.
 */
export async function call(opts: CallOptions): Promise<CallResult> {
  const provider = inferProvider(opts.model);
  switch (provider) {
    case 'anthropic':
      return await callAnthropic(opts);
    case 'openai':
      return await callOpenAI(opts);
    case 'openrouter':
      return await callOpenRouter(opts);
  }
}
