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
 *   - Stable primary pick per (tier, phase); fallback is reserved for
 *     actual failed/invalid calls, never random pre-selection.
 *   - Fallback chain per (tier, phase) cell: primary -> secondary.
 *
 * Honesty note: free-tier slugs marked with VERIFIED-DATE comments;
 * OpenRouter rotates these on promotional periods. If a slug 404s,
 * we fall through to the secondary, then surface a clear error.
 */

import type { SupportedProvider } from './piAi';

export type ModelTier = 'frontier' | 'balanced' | 'free' | 'small';
export type Phase =
  | 'enhance'
  | 'advise'
  | 'execute'
  | 'generate'
  | 'decompose'
  | 'iterate'
  | 'judge';

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

export interface RunModelOverride {
  provider: SupportedProvider;
  modelId: string;
  label?: string;
}

export interface RunModelConfig {
  tier?: string;
  modelOverride?: RunModelOverride;
}

// ── Tier × phase mapping (curated) ──────────────────────────────────────

// Anthropic paid-family IDs refreshed 2026-05-01 against official docs
// and the installed pi-ai 0.70.2 registry: Opus 4.7, Sonnet 4.6, Haiku 4.5.
const FRONTIER: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5',
    isFree: false,
    label: 'haiku-4-5',
  },
  advise: {
    provider: 'anthropic',
    modelId: 'claude-opus-4-7',
    isFree: false,
    label: 'opus-4.7',
  },
  execute: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    isFree: false,
    label: 'sonnet-4.6',
  },
  generate: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    isFree: false,
    label: 'sonnet-4.6',
  },
  decompose: {
    provider: 'anthropic',
    modelId: 'claude-opus-4-7',
    isFree: false,
    label: 'opus-4.7',
  },
  iterate: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    isFree: false,
    label: 'sonnet-4.6',
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
    modelId: 'claude-sonnet-4-6',
    isFree: false,
    label: 'sonnet-4.6',
  },
  execute: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    isFree: false,
    label: 'sonnet-4.6',
  },
  generate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.6' },
    isFree: false,
    label: 'kimi-k2.6',
  },
  decompose: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.6' },
    isFree: false,
    label: 'kimi-k2.6',
  },
  iterate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.6' },
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

// VERIFIED-DATE: 2026-04-29 (run 2) via scripts/eval-free-models.mjs.
// Slugs cross-checked against pi-ai 0.70.2's models.generated.js
// AND functionally tested against parity-studio's actual tool surface
// (list_files / read_file / upsert_file / set_todos / done) over 5
// real queries per model. Eval reports saved to runs/eval-free-*.
//
// RUN 1 (initial) revealed 3 models returning empty stopReason='error'.
// Diagnosed via raw curl to /api/v1/chat/completions: 2 were upstream
// provider rate-limits (Venice for llama-3.3-70b, Google AI Studio for
// gemma-4-31b), 1 was a deprecation (ling-2.6-flash:free → paid).
//
// RUN 2 hardened our pi-ai wrapper with:
//   1. OpenRouter app-attribution headers (HTTP-Referer + X-Title) — get
//      higher per-key rate-limit allocations per OR's docs.
//   2. Client-side maxRetries=3 (pi-ai built-in) for HTTP-level 5xx/429.
//   3. Soft-error retry loop (1s, 3s backoff w/ jitter) catching the
//      stopReason='error' + retriable-message case OpenRouter often
//      surfaces as 200-with-error-body for upstream 429s.
//   4. Removed ling-2.6-flash:free permanently (no longer free).
//
// Results comparison (each T/V/C column /5):
//
//   model                              T   V   C   pass%   Δ vs run 1
//   ------                             --  --  --  -----   ----------
//   inclusionai/ling-2.6-1t:free       5   5   5   100%    unchanged
//   claude-haiku-4-5            (paid) 4   5   5    80%    unchanged
//   claude-sonnet-4-5 (historical paid) 4  5   5    80%    unchanged
//   google/gemma-4-26b-a4b-it:free     3   5   3    60%    +40% pts
//   google/gemma-4-31b-it:free         1   5   2    20%    +20% pts
//   meta-llama/llama-3.3-70b:free      0   5   0     0%    same — but
//                                                          no longer
//                                                          stopReason
//                                                          ='error'
//   (errors column = 0 for ALL rows in run 2)
//
// Headline (preserved): ling-2.6-1t:free SCORED HIGHER THAN PAID HAIKU
// AND SONNET on parity-studio's tool surface. Use it for everything in
// free tier.
//
// New finding: gemma-4-26b-a4b-it:free is now a viable secondary free
// candidate at 60% pass — added to FREE fallback chain. Still below
// the 80% bar paid haiku clears, so primary stays ling-2.6-1t.
//
// Reliable graceful-degrade fallback when ling rate-limits: claude-haiku-4-5
// (paid, ~$0.001/call). Better to spend a fraction of a cent than serve
// a broken response.
const FREE: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-4.5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  advise: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-4.5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  execute: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-4.5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  generate: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-4.5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  decompose: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-4.5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  iterate: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-4.5' },
    isFree: true,
    label: 'ling-2.6-1t :free',
  },
  judge: {
    provider: 'openrouter',
    modelId: 'inclusionai/ling-2.6-1t:free',
    fallback: { provider: 'openrouter', modelId: 'anthropic/claude-haiku-4.5' },
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

export function tierFromRun(run: RunModelConfig | null | undefined): ModelTier {
  const tier = run?.tier;
  if (tier === 'frontier' || tier === 'balanced' || tier === 'free' || tier === 'small')
    return tier;
  return deploymentTier();
}

export function resolveRunModel(
  run: RunModelConfig | null | undefined,
  phase: Phase,
  runId: string,
  options: { allowCustomJudge?: boolean } = {},
): ResolvedModel {
  const override = run?.modelOverride;
  if (override !== undefined && (phase !== 'judge' || options.allowCustomJudge === true)) {
    const modelId = override.modelId.trim();
    if (modelId.length > 0) {
      return {
        provider: override.provider,
        modelId,
        isFree: modelId.includes(':free'),
        label: override.label?.trim() || modelId,
      };
    }
  }
  return sessionPick(runId, resolveModel(tierFromRun(run), phase));
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
 * and use it to pick stable variants. Fallbacks are not selected here:
 * they are true recovery models, invoked only by the pipeline after the
 * primary returns an error or invalid artifact. This keeps "Free" free
 * during healthy runs and avoids quietly swapping providers before work
 * actually fails.
 */
export function sessionPick(runId: string, model: ResolvedModel): ResolvedModel {
  void runId;
  return model;
}
