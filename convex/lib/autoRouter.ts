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

import { getModels } from '@earendil-works/pi-ai/compat';
import { FREE_LOOKING, freeLookingRoute } from './modelBoundary';
import type { Effort, SupportedProvider } from './piAi';

// Wire ids this file writes (model-defaults SPEC 1.2, the only source). One constant per id so the tier tables
// and the tests read the same value; the request-shape test checks each against its own SPEC 1.2 literal.
export const CLAUDE_HAIKU = 'claude-haiku-5-5';
export const CLAUDE_SONNET = 'claude-sonnet-5-5';
export const CLAUDE_OPUS = 'claude-opus-5-5';
/**
 * FREE-tier primary and the route unknown free-looking ids resolve to (SPEC D2: the latest `:free` model with the
 * capabilities the roles need). Eligibility filter, applied to the public OpenRouter list fetched 2026-10-16T20:40Z
 * (467 rows): `:free`, no `expiration_date`, `tools` in supported_parameters (the agent loop's tool surface),
 * context >= 262,144, max completion >= OUTPUT_CAPS.agentLoop (64,000, so an `upsert_file` is not clamped), and in
 * the pi-ai 1.1.0 OpenRouter catalog (getModel throws otherwise). Parity code sends no `response_format` and no
 * `tool_choice`, so `structured_outputs` is not a requirement. Newest row that passes: nemotron-3.5-lightning
 * (2026-08-11); the result is the same for any context floor from 131,072 to 1,000,000.
 */
export const VERIFIED_FREE_MODEL = 'nvidia/nemotron-3.5-lightning:free';
/**
 * Free recovery model for the FREE tier: the newest row that passes the filter above and also takes image input
 * (the primary is text-only, and a FREE generate run can carry a source image): inkling-small, 2026-07-30. The
 * previous pick, gemma-4-26b, tops out at 32,768 output tokens, below the 64,000 agent-loop cap.
 */
export const FREE_FALLBACK_MODEL = 'thinkingmachines/inkling-small:free';
/**
 * Output-token caps per call site. Thinking counts toward `max_tokens` on Claude 5.5 (SPEC 1.3), and since the
 * maxOutputTokens -> maxTokens fix they are real caps on every model, kimi-k2.6 included (before, pi-ai ignored
 * the old option name and sent the model default). A truncation (stopReason 'length') pushes BALANCED onto its
 * free fallback (FREE_FALLBACK_MODEL), so these values are part of the needs-live-eval scope on PR #101 until measured.
 * `agentLoop` sits at what an `upsert_file` can carry (200 KB, about 50-67k tokens): a lower cap would make every
 * large file write truncate. A reply counts as completed on stopReason 'toolUse', or 'stop' (pi-ai reports an
 * OpenAI-compatible finish_reason 'stop' as 'stop' even when tool_calls came with it). runAgentLoop runs tool calls
 * only from a completed reply and writes an '(agent error: ...)' turn for any other, with or without tool calls, so
 * a write longer than this fails visibly instead of saving a cut-off file; `enhance` throws and `explainParity`
 * falls back to its rule-based text (keeping the billed cost). The MCP caps (llmClient assertCompleted) reject an
 * unfinished reply the same way before anything is parsed or stored.
 */
export const OUTPUT_CAPS = {
  enhance: 4_000,
  explain: 4_000,
  agentLoop: 64_000,
  generate: 16_000,
  decompose: 24_000,
  iterate: 24_000,
} as const;
/**
 * Explicit Anthropic effort per phase (SPEC 1.3, A.2.7: Opus 5.5's default moved from high to medium, so the value
 * is stated instead of inherited). pi-ai 1.1.0 hard-codes the top-level `output_config.effort` to 'high'
 * (anthropic-messages.js:944) and carries `options.effort` only in a trailing system message (:1216), which the API
 * applies from the NEXT user turn, i.e. not to this one. Every call site therefore spreads `effortOptions(effort)`
 * (piAi.ts), which also sets the top-level value, so the phase value is what governs the turn. On the Opus and Sonnet
 * cells every phase except `enhance` ran at 'high' before the refresh (Opus 4.7 and Sonnet 4.6 defaulted to high);
 * `enhance` is no exception on those two: with no run (MCP `parity_enhance_prompt`, ChatPanel without a run) it resolves to
 * `ENHANCE_MODEL` -> `ADVISOR_MODEL` -> `CHAT_MODEL`, which is Sonnet 5.5 (it was Sonnet 4.6, default 'high'), so it
 * keeps 'high' too. That 'high' describes Opus and Sonnet only: Haiku 4.5 never ran adaptive thinking, so a Haiku
 * cell is resolved by `effortFor` (`HAIKU_EFFORT`), not by this table. Lowering a phase below its old behaviour is a
 * measured follow-up. Other APIs ignore the option.
 */
export const PHASE_EFFORT: Record<Phase, Effort> = {
  enhance: 'high',
  advise: 'high',
  execute: 'high',
  generate: 'high',
  decompose: 'high',
  iterate: 'high',
  judge: 'high',
};
/**
 * Both SPEC 1.2 spellings of Haiku 5.5 that reach an Anthropic Messages request: the direct wire id and the OpenRouter
 * slug (pi-ai 1.1.0 serves it with `anthropic-messages` and managed effort too). No route here is built from the
 * slug; it is compared so a run or env override that picks it gets the same effort as the direct id.
 */
const HAIKU_5_5_WIRE_IDS: readonly string[] = [CLAUDE_HAIKU, 'anthropic/claude-haiku-5.5'];
/**
 * Haiku 5.5's effort. Haiku 4.5 ran with no thinking and no effort parameter, so there is no baseline to keep:
 * `enhance` (the one-shot prompt rewrite, the one phase that ran on Haiku 4.5) takes 'low', the closest to no
 * thinking, and every other phase takes Haiku 5.5's own default, 'medium' (SPEC 1.3), stated instead of inherited.
 */
export const HAIKU_EFFORT: { enhance: Effort; other: Effort } = { enhance: 'low', other: 'medium' };
/**
 * The effort a call sends: `PHASE_EFFORT[phase]`, except on Haiku 5.5, which takes `HAIKU_EFFORT` (the table's 'high'
 * has no baseline there and would be an unmeasured rise in cost and latency on the cheap tier). Every call site
 * resolves its effort here, `enhance` included, so the effort follows the model that was actually routed.
 */
export function effortFor(phase: Phase, modelId: string): Effort {
  if (!HAIKU_5_5_WIRE_IDS.includes(modelId)) return PHASE_EFFORT[phase];
  return phase === 'enhance' ? HAIKU_EFFORT.enhance : HAIKU_EFFORT.other;
}
/**
 * convex/chatLoop.ts default when CHAT_MODEL is unset and CHAT_PROVIDER is anthropic. The OpenRouter default
 * (moonshotai/kimi-k2.6, frozen) stays a literal in chatLoop.ts: it is not migrated, so its site does not move.
 */
export const CHAT_DEFAULT_MODEL = {
  anthropic: CLAUDE_SONNET,
} as const;

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

// Anthropic paid-family IDs follow the vendor migration guide (4.x -> 5.5), verified against official docs
// and the installed pi-ai registry. 2026-10 refresh (model-defaults SPEC A.2.7): Opus 5.5, Sonnet 5.5, Haiku 5.5 (pi-ai 1.1.0).
const FRONTIER: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'anthropic',
    modelId: CLAUDE_HAIKU,
    isFree: false,
    label: 'haiku-5-5',
  },
  advise: {
    provider: 'anthropic',
    modelId: CLAUDE_OPUS,
    isFree: false,
    label: 'opus-5.5',
  },
  execute: {
    provider: 'anthropic',
    modelId: CLAUDE_SONNET,
    isFree: false,
    label: 'sonnet-5.5',
  },
  generate: {
    provider: 'anthropic',
    modelId: CLAUDE_SONNET,
    isFree: false,
    label: 'sonnet-5.5',
  },
  decompose: {
    provider: 'anthropic',
    modelId: CLAUDE_OPUS,
    isFree: false,
    label: 'opus-5.5',
  },
  iterate: {
    provider: 'anthropic',
    modelId: CLAUDE_SONNET,
    isFree: false,
    label: 'sonnet-5.5',
  },
  judge: {
    provider: 'openrouter',
    modelId: 'google/gemini-3.1-pro-preview',
    isFree: false,
    label: 'gemini-3.1-pro',
  },
};

// The kimi-k2.6 primaries are frozen (SPEC A.0.1: active, no vendor-named successor). Their recovery hop was
// openrouter anthropic/claude-sonnet-4.6, which the refresh moves (A.0.1, vendor-named successor), and SPEC D2/D2a
// sets the target of a moved OpenRouter role to the latest eligible `:free` model: FREE_FALLBACK_MODEL (filter and
// fetch time above). That also keeps the cost class: a recovery hop never costs more than the request it recovers.
// UNMEASURED on this repo's tool surface and live-unverified (no OpenRouter key, D2): needs-live-eval.
const BALANCED: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'anthropic',
    modelId: CLAUDE_HAIKU,
    isFree: false,
    label: 'haiku-5-5',
  },
  advise: {
    provider: 'anthropic',
    modelId: CLAUDE_SONNET,
    isFree: false,
    label: 'sonnet-5.5',
  },
  execute: {
    provider: 'anthropic',
    modelId: CLAUDE_SONNET,
    isFree: false,
    label: 'sonnet-5.5',
  },
  generate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: FREE_FALLBACK_MODEL },
    isFree: false,
    label: 'kimi-k2.6',
  },
  decompose: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: FREE_FALLBACK_MODEL },
    isFree: false,
    label: 'kimi-k2.6',
  },
  iterate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: FREE_FALLBACK_MODEL },
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
// Graceful-degrade fallback when the free primary fails: FREE_FALLBACK_MODEL (free -> free). SPEC A.0.10 forbids
// turning a free request into a paid one without allowPaidFallback plus a financial reservation, and neither exists
// here, so the former paid Haiku hop is gone. Unlike the text-only primary, the fallback accepts images (pi-ai 1.1.0
// catalog), so a FREE generate run with a source image is rejected locally by the primary and served by the
// fallback instead of going paid. The (a) free fallback versus (b) allowPaidFallback-with-reservation choice stays
// Homen's; this is (a).
// 2026-10-14: inclusionai/ling-2.6-1t:free is absent from OpenRouter (live :free list 2026-10-10), so the FREE tier
// moved to the picks above (SPEC D2, filter and fetch time at VERIFIED_FREE_MODEL). Both are UNMEASURED on this
// repo's tool surface (needs-live-eval): the eval above measured ling and gemma, not these;
// scripts/eval-free-models.mjs is the evidence path once its import is fixed.
const FREE: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'openrouter',
    modelId: VERIFIED_FREE_MODEL,
    fallback: { provider: 'openrouter', modelId: FREE_FALLBACK_MODEL },
    isFree: true,
    label: 'nemotron-3.5-lightning :free',
  },
  advise: {
    provider: 'openrouter',
    modelId: VERIFIED_FREE_MODEL,
    fallback: { provider: 'openrouter', modelId: FREE_FALLBACK_MODEL },
    isFree: true,
    label: 'nemotron-3.5-lightning :free',
  },
  execute: {
    provider: 'openrouter',
    modelId: VERIFIED_FREE_MODEL,
    fallback: { provider: 'openrouter', modelId: FREE_FALLBACK_MODEL },
    isFree: true,
    label: 'nemotron-3.5-lightning :free',
  },
  generate: {
    provider: 'openrouter',
    modelId: VERIFIED_FREE_MODEL,
    fallback: { provider: 'openrouter', modelId: FREE_FALLBACK_MODEL },
    isFree: true,
    label: 'nemotron-3.5-lightning :free',
  },
  decompose: {
    provider: 'openrouter',
    modelId: VERIFIED_FREE_MODEL,
    fallback: { provider: 'openrouter', modelId: FREE_FALLBACK_MODEL },
    isFree: true,
    label: 'nemotron-3.5-lightning :free',
  },
  iterate: {
    provider: 'openrouter',
    modelId: VERIFIED_FREE_MODEL,
    fallback: { provider: 'openrouter', modelId: FREE_FALLBACK_MODEL },
    isFree: true,
    label: 'nemotron-3.5-lightning :free',
  },
  judge: {
    provider: 'openrouter',
    modelId: VERIFIED_FREE_MODEL,
    fallback: { provider: 'openrouter', modelId: FREE_FALLBACK_MODEL },
    isFree: true,
    label: 'nemotron-3.5-lightning :free',
  },
};

// Internal — used for enhance-prompt + (future) title generation.
// Mirrors Kilo's `kilo-auto/small`. Picks a paid Haiku when the
// deployment has anthropic auth; falls through to a pi-ai-catalog free
// slug otherwise. Slugs verified against pi-ai 0.70.2 catalog.
const SMALL: Record<Phase, ResolvedModel> = {
  enhance: {
    provider: 'anthropic',
    modelId: CLAUDE_HAIKU,
    fallback: { provider: 'openrouter', modelId: VERIFIED_FREE_MODEL },
    isFree: false,
    label: 'haiku-5-5',
  },
  advise: {
    provider: 'anthropic',
    modelId: CLAUDE_HAIKU,
    fallback: { provider: 'openrouter', modelId: VERIFIED_FREE_MODEL },
    isFree: false,
    label: 'haiku-5-5',
  },
  execute: {
    provider: 'anthropic',
    modelId: CLAUDE_HAIKU,
    fallback: { provider: 'openrouter', modelId: VERIFIED_FREE_MODEL },
    isFree: false,
    label: 'haiku-5-5',
  },
  generate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: VERIFIED_FREE_MODEL },
    isFree: false,
    label: 'kimi-k2.6',
  },
  decompose: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: VERIFIED_FREE_MODEL },
    isFree: false,
    label: 'kimi-k2.6',
  },
  iterate: {
    provider: 'openrouter',
    modelId: 'moonshotai/kimi-k2.6',
    fallback: { provider: 'openrouter', modelId: VERIFIED_FREE_MODEL },
    isFree: false,
    label: 'kimi-k2.6',
  },
  judge: {
    provider: 'openrouter',
    modelId: VERIFIED_FREE_MODEL,
    isFree: true,
    label: 'nemotron-3.5-lightning :free',
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

/**
 * SPEC A.0.10, applied to the (provider, model) pair that is about to be sent, wherever it came from (the run's
 * override, an env override, or a mix). A pair pi-ai's catalog knows passes through untouched (persisted 4.x rows
 * included). A free-looking id the OpenRouter catalog lists runs as itself on OpenRouter; one SPEC 1.2 lists but
 * the catalog cannot call throws (D1: a known id is never rerouted to another model); an id known nowhere
 * resolves to the verified free constant, so a free request never becomes a paid one. Any other unknown id
 * throws here, before a request exists, instead of becoming a TypeError in getModel.
 */
export function failClosedRoute(
  provider: SupportedProvider,
  modelId: string,
): { provider: SupportedProvider; modelId: string } {
  // Own-property membership, not `getModel(...) !== undefined`: pi-ai looks ids up as MODELS[provider]?.[id], so
  // 'toString' / 'constructor' / '__proto__' come back as an inherited function or object and would pass.
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModels is typed against its compile-time registry
  if ((getModels as any)(provider).some((m: { id: string }) => m.id === modelId))
    return { provider, modelId };
  if (FREE_LOOKING.test(modelId)) {
    // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModels is typed against its compile-time registry
    const openrouterIds = (getModels as any)('openrouter').map((m: { id: string }) => m.id);
    return {
      provider: 'openrouter',
      modelId:
        freeLookingRoute(modelId, openrouterIds) === 'openrouter' ? modelId : VERIFIED_FREE_MODEL,
    };
  }
  throw new Error(
    `Unknown model "${modelId}" for provider "${provider}": not in the pi-ai catalog, refusing to guess a paid default.`,
  );
}

/** The run's explicit override for this phase, exactly as stored (not validated), or undefined. */
function runOverride(
  run: RunModelConfig | null | undefined,
  phase: Phase,
  options: { allowCustomJudge?: boolean },
): { provider: SupportedProvider; modelId: string; label: string | undefined } | undefined {
  const override = run?.modelOverride;
  if (override === undefined || (phase === 'judge' && options.allowCustomJudge !== true)) {
    return undefined;
  }
  const modelId = override.modelId.trim();
  if (modelId.length === 0) return undefined;
  return { provider: override.provider, modelId, label: override.label?.trim() || undefined };
}

/**
 * The run's own pick (explicit override, else the tier cell), NOT validated. A caller that may replace part of it
 * from env (A.0.4) validates the pair it will actually send with `failClosedRoute`, so a stale stored override
 * that env replaces cannot block the send; everyone else uses `resolveRunModel`.
 */
export function pickRunModel(
  run: RunModelConfig | null | undefined,
  phase: Phase,
  runId: string,
  options: { allowCustomJudge?: boolean } = {},
): { provider: SupportedProvider; modelId: string } {
  return (
    runOverride(run, phase, options) ?? sessionPick(runId, resolveModel(tierFromRun(run), phase))
  );
}

export function resolveRunModel(
  run: RunModelConfig | null | undefined,
  phase: Phase,
  runId: string,
  options: { allowCustomJudge?: boolean } = {},
): ResolvedModel {
  const override = runOverride(run, phase, options);
  if (override === undefined) return sessionPick(runId, resolveModel(tierFromRun(run), phase));
  const route = failClosedRoute(override.provider, override.modelId);
  return {
    provider: route.provider,
    modelId: route.modelId,
    isFree: route.modelId.includes(':free'),
    label: override.label || route.modelId,
  };
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
