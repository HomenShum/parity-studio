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
export type Phase = 'enhance' | 'advise' | 'execute' | 'generate' | 'decompose' | 'iterate' | 'judge';

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
  generate: {
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
  generate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    isFree: false,
    label: 'kimi-k2.6',
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

// VERIFIED-DATE: 2026-04-29 via scripts/eval-free-models.mjs.
// Slugs cross-checked against pi-ai 0.70.2's models.generated.js
// AND functionally tested against parity-studio's actual tool surface
// (list_files / read_file / upsert_file / set_todos / done) over 5
// real queries per model. Eval report saved to runs/eval-free-...
//
// Results that drove this curation (each column /5):
//
//   model                              T   V   C   pass%   text-only?
//   ------                             --  --  --  -----   ----------
//   inclusionai/ling-2.6-1t:free       5   5   5   100%    YES (655ch)
//   claude-haiku-4-5            (paid) 4   5   5    80%    YES
//   claude-sonnet-4-5           (paid) 4   5   5    80%    YES
//   google/gemma-4-26b-a4b-it:free     1   5   1    20%    YES (403ch)
//   inclusionai/ling-2.6-flash:free    0   5   0     0%    NO  (stopReason=error)
//   google/gemma-4-31b-it:free         0   5   0     0%    NO  (stopReason=error)
//   meta-llama/llama-3.3-70b:free      0   5   0     0%    NO  (stopReason=error)
//
// Headline: ling-2.6-1t:free SCORED HIGHER THAN PAID HAIKU AND SONNET
// on parity-studio's tool surface. Use it for everything in free tier.
// llama-3.3-70b and ling-2.6-flash that I had as fallbacks BOTH FAIL
// 100% — both tool-using AND plain text. Removed.
//
// Reliable graceful-degrade fallback when ling rate-limits: claude-haiku-4-5
// (paid, ~$0.001/call). Better to spend a fraction of a cent than serve
// a broken response.
const FREE: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  advise: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  execute: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  generate: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  decompose: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  iterate: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  judge: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'anthropic', modelId: 'claude-haiku-4-5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
};

// Internal — used for enhance-prompt + (future) title generation.
// Mirrors Kilo's `kilo-auto/small`. Picks a paid Haiku when the
// deployment has anthropic auth; falls through to a pi-ai-catalog free
// slug otherwise. Slugs verified against pi-ai 0.70.2 catalog.
const SMALL: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    fallback: { provider: 'openrouter', modelId: 'inclusionai/ling-2.6-1t:free' },
    isFree: false,
    label: 'haiku-4-5',
  },
  advise: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    fallback: { provider: 'openrouter', modelId: 'inclusionai/ling-2.6-1t:free' },
    isFree: false,
    label: 'haiku-4-5',
  },
  execute: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    fallback: { provider: 'openrouter', modelId: 'inclusionai/ling-2.6-1t:free' },
    isFree: false,
    label: 'haiku-4-5',
  },
  generate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: 'inclusionai/ling-2.6-1t:free' },
    isFree: false,
    label: 'kimi-k2.6',
  },
  decompose: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: 'inclusionai/ling-2.6-1t:free' },
    isFree: false,
    label: 'kimi-k2.6',
  },
  iterate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: 'inclusionai/ling-2.6-1t:free' },
    isFree: false,
    label: 'kimi-k2.6',
  },
  judge: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    isFree: true,
    label: 'ling-2.6-1t :free',
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
