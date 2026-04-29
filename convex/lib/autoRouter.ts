/**
 * Auto Router — 4-tier model selection inspired by Kilo Code's
 * `kilo-auto/{frontier,balanced,free,small}` system
 * (see packages/kilo-docs/pages/contributing/architecture/auto-model-tiers.md
 * in Kilo-Org/kilocode).
 *
 * Differences from Kilo:
 *   - Mappings live in this file (not a remote gateway). Update via PR;
 *     redeploy. Trade-off: simpler ops; downside: free-tier churn requires
 *     code changes vs Kilo's server-side update.
 *   - Three user-facing tiers (frontier/balanced/free) + small for
 *     internal background tasks (enhance-prompt, future titles).
 *   - Phase-aware (advise / execute / decompose / iterate / judge / enhance)
 *     in addition to tier so the same tier picks different models for
 *     different jobs (matches Kilo's mode-aware Frontier).
 *   - Session-deterministic free picks via runId hash (so a single
 *     conversation doesn't whiplash across free models).
 *   - Fallback chain per (tier, phase) cell: primary → secondary.
 *
 * Honesty note: free-tier slugs marked with VERIFIED-DATE comments;
 * OpenRouter rotates these on promotional periods. If a slug 404s,
 * we fall through to the secondary, then surface a clear error.
 */

import type { SupportedProvider } from './piAi';

export type ModelTier = 'frontier' | 'balanced' | 'free' | 'small';
export type Phase = 'enhance' | 'advise' | 'execute' | 'decompose' | 'iterate' | 'judge';

export interface ResolvedModel {
  provider: SupportedProvider;
  modelId: string;
  /** Optional fallback when primary fails. */
  fallback?: { provider: SupportedProvider; modelId: string };
  /** True for routes that ought to be zero-cost (advisory; provider may bill). */
  isFree: boolean;
  /** Display label for the UI. */
  label: string;
}

// ── Tier × phase mapping (curated) ──────────────────────────────────────

const FRONTIER: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    isFree: false,
    label: 'haiku-4-5',
  },
  advise: {
    provider: 'anthropic',
    modelId: 'claude-opus-4-1',
    isFree: false,
    label: 'opus-4-1',
  },
  execute: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    isFree: false,
    label: 'sonnet-4-5',
  },
  decompose: {
    provider: 'anthropic',
    modelId: 'claude-opus-4-1',
    isFree: false,
    label: 'opus-4-1',
  },
  iterate: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    isFree: false,
    label: 'sonnet-4-5',
  },
  judge: {
    provider: 'openrouter',
    modelId: 'google/gemini-3.1-pro-preview',
    isFree: false,
    label: 'gemini-3.1-pro',
  },
};

const BALANCED: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    isFree: false,
    label: 'haiku-4-5',
  },
  advise: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    isFree: false,
    label: 'sonnet-4-5',
  },
  execute: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    isFree: false,
    label: 'sonnet-4-5',
  },
  decompose: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    isFree: false,
    label: 'kimi-k2.6',
  },
  iterate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    isFree: false,
    label: 'kimi-k2.6',
  },
  judge: {
    provider: 'openrouter',
    modelId: 'google/gemini-3.1-pro-preview',
    isFree: false,
    label: 'gemini-3.1-pro',
  },
};

// VERIFIED-DATE: 2026-04-29. Free slugs on OpenRouter rotate during
// promo periods. If a primary 404s, the agent loop falls through to the
// fallback. Update this list when slugs go stale (search openrouter for
// ":free" model ids).
const FREE: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'openrouter',
    modelId: 'google/gemini-2.0-flash-exp:free',
    fallback: { provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free' },
    isFree: true,
    label: 'gemini-2.0-flash :free',
  },
  advise: {
    provider: 'openrouter',
    modelId: 'deepseek/deepseek-chat-v3.1:free',
    fallback: { provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free' },
    isFree: true,
    label: 'deepseek-v3.1 :free',
  },
  execute: {
    provider: 'openrouter',
    modelId: 'deepseek/deepseek-chat-v3.1:free',
    fallback: { provider: 'openrouter', modelId: 'qwen/qwen-2.5-72b-instruct:free' },
    isFree: true,
    label: 'deepseek-v3.1 :free',
  },
  decompose: {
    provider: 'openrouter',
    modelId: 'qwen/qwen-2.5-coder-32b-instruct:free',
    fallback: { provider: 'openrouter', modelId: 'deepseek/deepseek-chat-v3.1:free' },
    isFree: true,
    label: 'qwen-coder-32b :free',
  },
  iterate: {
    provider: 'openrouter',
    modelId: 'qwen/qwen-2.5-coder-32b-instruct:free',
    fallback: { provider: 'openrouter', modelId: 'deepseek/deepseek-chat-v3.1:free' },
    isFree: true,
    label: 'qwen-coder-32b :free',
  },
  judge: {
    provider: 'openrouter',
    modelId: 'google/gemini-2.0-flash-exp:free',
    fallback: { provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free' },
    isFree: true,
    label: 'gemini-2.0-flash :free',
  },
};

// Internal — used for enhance-prompt + (future) title generation.
// Mirrors Kilo's `kilo-auto/small`. Picks a paid Haiku when the
// deployment has anthropic auth; falls through to a free pool otherwise.
const SMALL: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    fallback: { provider: 'openrouter', modelId: 'google/gemini-2.0-flash-exp:free' },
    isFree: false,
    label: 'haiku-4-5',
  },
  advise: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    fallback: { provider: 'openrouter', modelId: 'google/gemini-2.0-flash-exp:free' },
    isFree: false,
    label: 'haiku-4-5',
  },
  execute: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    fallback: { provider: 'openrouter', modelId: 'deepseek/deepseek-chat-v3.1:free' },
    isFree: false,
    label: 'haiku-4-5',
  },
  decompose: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: 'qwen/qwen-2.5-coder-32b-instruct:free' },
    isFree: false,
    label: 'kimi-k2.6',
  },
  iterate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: 'qwen/qwen-2.5-coder-32b-instruct:free' },
    isFree: false,
    label: 'kimi-k2.6',
  },
  judge: {
    provider: 'openrouter',
    modelId: 'google/gemini-2.0-flash-exp:free',
    isFree: true,
    label: 'gemini-2.0-flash :free',
  },
};

const TIER_MAP: Record<ModelTier, Record<Phase, ResolvedModel>> = {
  frontier: FRONTIER,
  balanced: BALANCED,
  free: FREE,
  small: SMALL,
};

export function resolveModel(tier: ModelTier, phase: Phase): ResolvedModel {
  return TIER_MAP[tier][phase];
}

/**
 * Determine the active tier for a deployment.
 *
 * Priority:
 *   1. PARITY_TIER env (set on Convex deployment)
 *   2. Default `balanced`
 *
 * Frontend can pass an override per-call via the chat:send `tier?` arg
 * (added in chat.ts) which the agent loop merges in. Letting the user
 * pick `free` for a demo without redeploying is the win.
 */
export function deploymentTier(): ModelTier {
  const env = process.env['PARITY_TIER'];
  if (env === 'frontier' || env === 'balanced' || env === 'free' || env === 'small') return env;
  return 'balanced';
}

/**
 * Session-deterministic helper — given a runId, pick the same primary OR
 * fallback consistently across turns. We hash the runId to a [0,1) float
 * and use it to pick within the (primary, fallback) pair, BIASED toward
 * primary so the fallback only kicks in for ~12% of sessions
 * (mitigating the "primary unavailable" failure mode).
 *
 * For small + balanced + frontier this is a no-op (no fallback in normal
 * flow). For free, it spreads load across the curated pool so a single
 * promotional model doesn't get hammered.
 */
export function sessionPick(runId: string, model: ResolvedModel): ResolvedModel {
  if (!model.fallback) return model;
  let h = 0;
  for (let i = 0; i < runId.length; i += 1) h = (h * 31 + runId.charCodeAt(i)) >>> 0;
  const r = (h % 1000) / 1000;
  return r < 0.88 ? model : { ...model, provider: model.fallback.provider, modelId: model.fallback.modelId };
}
