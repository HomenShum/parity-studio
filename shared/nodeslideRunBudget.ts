import type { NodeSlideAgentModelId } from './nodeslide';

export const NODESLIDE_RUN_BUDGET_VERSION = 'nodeslide.run-budget/v1' as const;
export const NODESLIDE_RUN_BUDGET_STATE_VERSION = 'nodeslide.run-budget-state/v1' as const;
export const NODESLIDE_RUN_BUDGET_RECEIPT_VERSION = 'nodeslide.run-budget-receipt/v1' as const;
export const NODESLIDE_MODEL_PRICING_VERSION = 'nodeslide.model-pricing/v1' as const;
export const NODESLIDE_PRIVATE_DETERMINISTIC_MODEL = 'nodeslide/private-deterministic' as const;
export const NODESLIDE_MICRO_USD_PER_USD = 1_000_000 as const;
export const NODESLIDE_TOKENS_PER_PRICING_UNIT = 1_000_000 as const;

/**
 * Every run budget is finite after normalization. Defaults are deliberately
 * useful for a short agent run while the maxima bound untrusted server input.
 */
export const NODESLIDE_RUN_BUDGET_BOUNDS = {
  maxCostUsd: { default: 1, min: 0, max: 100 },
  maxInputTokens: { default: 1_048_576, min: 1, max: 16_777_216 },
  maxOutputTokens: { default: 262_144, min: 1, max: 4_194_304 },
  maxDurationMs: { default: 300_000, min: 1_000, max: 3_600_000 },
  maxIterations: { default: 12, min: 1, max: 128 },
  maxToolCalls: { default: 64, min: 1, max: 1_024 },
} as const;

export interface NodeSlideRunBudgetInput {
  maxCostUsd?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxDurationMs?: number;
  maxIterations?: number;
  maxToolCalls?: number;
}

export interface NodeSlideSpendConstraint {
  readonly source: 'instruction';
  readonly matchedText: string;
  readonly maxCostMicroUsd: number;
}

const NODESLIDE_SPEND_CONSTRAINT_PATTERN =
  /\bspend\s+(?:no|not)\s+more\s+than\s+(?:(?:usd)\s*)?\$\s*(\d+(?:\.\d+)?)\s+(?:on|for)\s+(?:this|the)\s+run\b/giu;

/**
 * Extracts explicit run-level dollar ceilings without floating-point parsing.
 * When an instruction repeats the constraint, the most restrictive value wins.
 */
export function parseNodeSlideSpendConstraint(
  instruction: string,
): NodeSlideSpendConstraint | null {
  if (typeof instruction !== 'string' || instruction.length > 20_000) return null;
  let selected: NodeSlideSpendConstraint | null = null;
  for (const match of instruction.matchAll(NODESLIDE_SPEND_CONSTRAINT_PATTERN)) {
    const amount = match[1];
    if (!amount) continue;
    const maxCostMicroUsd = parseUsdDecimalToMicroUsd(amount);
    if (
      maxCostMicroUsd >
      NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.max * NODESLIDE_MICRO_USD_PER_USD
    ) {
      throw new NodeSlideRunBudgetValidationError(
        'maxCostUsd',
        `instruction ceiling exceeds ${NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.max} USD`,
      );
    }
    const candidate: NodeSlideSpendConstraint = {
      source: 'instruction',
      matchedText: match[0],
      maxCostMicroUsd,
    };
    if (!selected || candidate.maxCostMicroUsd < selected.maxCostMicroUsd) {
      selected = candidate;
    }
  }
  return selected;
}

/** Converts an unsigned USD decimal to integer micro-USD by rounding down. */
export function parseUsdDecimalToMicroUsd(value: string): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    throw new NodeSlideRunBudgetValidationError('maxCostUsd', 'expected an unsigned USD decimal');
  }
  const [whole = '0', fraction = ''] = value.split('.');
  const microFraction = `${fraction}000000`.slice(0, 6);
  const microUsd = BigInt(whole) * BigInt(NODESLIDE_MICRO_USD_PER_USD) + BigInt(microFraction);
  if (microUsd > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new NodeSlideRunBudgetValidationError('maxCostUsd', 'amount exceeds the safe range');
  }
  return Number(microUsd);
}

export interface NodeSlideRunBudget {
  readonly version: typeof NODESLIDE_RUN_BUDGET_VERSION;
  readonly enforcement: 'hard';
  readonly maxCostUsd: number;
  readonly maxCostMicroUsd: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxDurationMs: number;
  readonly maxIterations: number;
  readonly maxToolCalls: number;
}

export class NodeSlideRunBudgetValidationError extends Error {
  readonly code = 'invalid_run_budget' as const;

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`Invalid NodeSlide run budget ${field}: ${message}`);
    this.name = 'NodeSlideRunBudgetValidationError';
  }
}

const RUN_BUDGET_KEYS = new Set([
  'version',
  'enforcement',
  'maxCostUsd',
  'maxCostMicroUsd',
  'maxInputTokens',
  'maxOutputTokens',
  'maxDurationMs',
  'maxIterations',
  'maxToolCalls',
]);

/**
 * Strictly validates untrusted input and returns one canonical representation.
 * Passing an already-normalized budget is idempotent.
 */
export function normalizeNodeSlideRunBudget(input: unknown = {}): NodeSlideRunBudget {
  if (!isRecord(input)) {
    throw new NodeSlideRunBudgetValidationError('root', 'expected a plain object');
  }
  for (const key of Object.keys(input)) {
    if (!RUN_BUDGET_KEYS.has(key)) {
      throw new NodeSlideRunBudgetValidationError(key, 'unknown field');
    }
  }
  if (input['version'] !== undefined && input['version'] !== NODESLIDE_RUN_BUDGET_VERSION) {
    throw new NodeSlideRunBudgetValidationError('version', 'unsupported contract version');
  }
  if (input['enforcement'] !== undefined && input['enforcement'] !== 'hard') {
    throw new NodeSlideRunBudgetValidationError('enforcement', 'must be hard');
  }

  const maxCostUsd = readCostUsd(input['maxCostUsd']);
  const maxCostMicroUsd = Math.floor(maxCostUsd * NODESLIDE_MICRO_USD_PER_USD);
  if (input['maxCostMicroUsd'] !== undefined && input['maxCostMicroUsd'] !== maxCostMicroUsd) {
    throw new NodeSlideRunBudgetValidationError(
      'maxCostMicroUsd',
      'does not match canonical maxCostUsd',
    );
  }

  return {
    version: NODESLIDE_RUN_BUDGET_VERSION,
    enforcement: 'hard',
    maxCostUsd: maxCostMicroUsd / NODESLIDE_MICRO_USD_PER_USD,
    maxCostMicroUsd,
    maxInputTokens: readBoundedInteger(
      'maxInputTokens',
      input['maxInputTokens'],
      NODESLIDE_RUN_BUDGET_BOUNDS.maxInputTokens,
    ),
    maxOutputTokens: readBoundedInteger(
      'maxOutputTokens',
      input['maxOutputTokens'],
      NODESLIDE_RUN_BUDGET_BOUNDS.maxOutputTokens,
    ),
    maxDurationMs: readBoundedInteger(
      'maxDurationMs',
      input['maxDurationMs'],
      NODESLIDE_RUN_BUDGET_BOUNDS.maxDurationMs,
    ),
    maxIterations: readBoundedInteger(
      'maxIterations',
      input['maxIterations'],
      NODESLIDE_RUN_BUDGET_BOUNDS.maxIterations,
    ),
    maxToolCalls: readBoundedInteger(
      'maxToolCalls',
      input['maxToolCalls'],
      NODESLIDE_RUN_BUDGET_BOUNDS.maxToolCalls,
    ),
  };
}

function readCostUsd(value: unknown): number {
  const bounds = NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd;
  const candidate = value === undefined ? bounds.default : value;
  if (
    typeof candidate !== 'number' ||
    !Number.isFinite(candidate) ||
    candidate < bounds.min ||
    candidate > bounds.max
  ) {
    throw new NodeSlideRunBudgetValidationError(
      'maxCostUsd',
      `expected a finite number from ${bounds.min} through ${bounds.max}`,
    );
  }
  return candidate;
}

function readBoundedInteger(
  field: string,
  value: unknown,
  bounds: Readonly<{ default: number; min: number; max: number }>,
): number {
  const candidate = value === undefined ? bounds.default : value;
  if (
    typeof candidate !== 'number' ||
    !Number.isSafeInteger(candidate) ||
    candidate < bounds.min ||
    candidate > bounds.max
  ) {
    throw new NodeSlideRunBudgetValidationError(
      field,
      `expected an integer from ${bounds.min} through ${bounds.max}`,
    );
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type NodeSlidePricingUnknownReason = 'provider_pricing_not_pinned' | 'model_not_cataloged';

export interface NodeSlidePricedModelMetadata {
  readonly version: typeof NODESLIDE_MODEL_PRICING_VERSION;
  readonly kind: 'priced';
  readonly modelId: string;
  readonly currency: 'USD';
  readonly billingUnit: 'million_tokens';
  readonly inputMicroUsdPerMillionTokens: number;
  readonly outputMicroUsdPerMillionTokens: number;
  readonly providerContextWindowTokens: number;
  readonly providerMaxOutputTokens: number;
  readonly source:
    | 'nebius_token_factory_model_catalog'
    | 'openrouter_request_price_ceiling'
    | 'openrouter_model_catalog';
  readonly sourceUrl:
    | 'https://tokenfactory.nebius.com/proxy/inference/private/v1/models_info'
    | 'https://openrouter.ai/docs/guides/routing/provider-selection'
    | 'https://openrouter.ai/google/gemini-3.5-flash/pricing';
  readonly verifiedAt: '2026-07-16T01:22:40Z' | '2026-07-16T20:30:00Z' | '2026-07-16T23:55:00Z';
}

export interface NodeSlideZeroCostModelMetadata {
  readonly version: typeof NODESLIDE_MODEL_PRICING_VERSION;
  readonly kind: 'zero_cost';
  readonly modelId: typeof NODESLIDE_PRIVATE_DETERMINISTIC_MODEL;
  readonly currency: 'USD';
  readonly billingUnit: 'none';
  readonly inputMicroUsdPerMillionTokens: 0;
  readonly outputMicroUsdPerMillionTokens: 0;
  readonly providerMaxOutputTokens: number;
  readonly source: 'private_deterministic_route';
}

export interface NodeSlideUnknownModelPricing {
  readonly version: typeof NODESLIDE_MODEL_PRICING_VERSION;
  readonly kind: 'unknown';
  readonly modelId: string;
  readonly reason: NodeSlidePricingUnknownReason;
  readonly source: 'openrouter_dynamic_catalog' | 'unrecognized_model';
}

export type NodeSlideScoredModelMetadata =
  | NodeSlidePricedModelMetadata
  | NodeSlideZeroCostModelMetadata;
export type NodeSlideModelPricingMetadata =
  | NodeSlideScoredModelMetadata
  | NodeSlideUnknownModelPricing;

type NodeSlideCatalogPricingMetadata = NodeSlidePricedModelMetadata | NodeSlideUnknownModelPricing;

/**
 * This record is intentionally exhaustive over NodeSlideAgentModelId. Adding a
 * named model to shared/nodeslide.ts requires an explicit priced or unknown row.
 */
export const NODESLIDE_MODEL_PRICING = {
  'nebius/zai-org/GLM-5.2': {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'priced',
    modelId: 'nebius/zai-org/GLM-5.2',
    currency: 'USD',
    billingUnit: 'million_tokens',
    inputMicroUsdPerMillionTokens: 1_400_000,
    outputMicroUsdPerMillionTokens: 4_400_000,
    providerContextWindowTokens: 1_048_576,
    providerMaxOutputTokens: 131_072,
    source: 'nebius_token_factory_model_catalog',
    sourceUrl: 'https://tokenfactory.nebius.com/proxy/inference/private/v1/models_info',
    verifiedAt: '2026-07-16T01:22:40Z',
  },
  'z-ai/glm-5.2': {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'priced',
    modelId: 'z-ai/glm-5.2',
    currency: 'USD',
    billingUnit: 'million_tokens',
    inputMicroUsdPerMillionTokens: 1_400_000,
    outputMicroUsdPerMillionTokens: 4_400_000,
    providerContextWindowTokens: 1_048_576,
    providerMaxOutputTokens: 131_072,
    source: 'openrouter_request_price_ceiling',
    sourceUrl: 'https://openrouter.ai/docs/guides/routing/provider-selection',
    verifiedAt: '2026-07-16T20:30:00Z',
  },
  'anthropic/claude-sonnet-5': {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'unknown',
    modelId: 'anthropic/claude-sonnet-5',
    reason: 'provider_pricing_not_pinned',
    source: 'openrouter_dynamic_catalog',
  },
  'anthropic/claude-fable-5': {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'unknown',
    modelId: 'anthropic/claude-fable-5',
    reason: 'provider_pricing_not_pinned',
    source: 'openrouter_dynamic_catalog',
  },
  'google/gemini-3.5-flash': {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'priced',
    modelId: 'google/gemini-3.5-flash',
    currency: 'USD',
    billingUnit: 'million_tokens',
    inputMicroUsdPerMillionTokens: 1_500_000,
    outputMicroUsdPerMillionTokens: 9_000_000,
    providerContextWindowTokens: 1_048_576,
    providerMaxOutputTokens: 65_536,
    source: 'openrouter_model_catalog',
    sourceUrl: 'https://openrouter.ai/google/gemini-3.5-flash/pricing',
    verifiedAt: '2026-07-16T23:55:00Z',
  },
  'google/gemini-3.1-pro-preview': {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'unknown',
    modelId: 'google/gemini-3.1-pro-preview',
    reason: 'provider_pricing_not_pinned',
    source: 'openrouter_dynamic_catalog',
  },
  'openai/gpt-5.6-luna': {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'unknown',
    modelId: 'openai/gpt-5.6-luna',
    reason: 'provider_pricing_not_pinned',
    source: 'openrouter_dynamic_catalog',
  },
  'openai/gpt-5.6-sol': {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'unknown',
    modelId: 'openai/gpt-5.6-sol',
    reason: 'provider_pricing_not_pinned',
    source: 'openrouter_dynamic_catalog',
  },
  'openai/gpt-5.6-terra': {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'unknown',
    modelId: 'openai/gpt-5.6-terra',
    reason: 'provider_pricing_not_pinned',
    source: 'openrouter_dynamic_catalog',
  },
} as const satisfies Record<NodeSlideAgentModelId, NodeSlideCatalogPricingMetadata>;

const PRIVATE_DETERMINISTIC_PRICING: NodeSlideZeroCostModelMetadata = {
  version: NODESLIDE_MODEL_PRICING_VERSION,
  kind: 'zero_cost',
  modelId: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
  currency: 'USD',
  billingUnit: 'none',
  inputMicroUsdPerMillionTokens: 0,
  outputMicroUsdPerMillionTokens: 0,
  providerMaxOutputTokens: NODESLIDE_RUN_BUDGET_BOUNDS.maxOutputTokens.max,
  source: 'private_deterministic_route',
};

export function nodeSlideModelPricing(model: string): NodeSlideModelPricingMetadata {
  if (model === NODESLIDE_PRIVATE_DETERMINISTIC_MODEL) {
    return PRIVATE_DETERMINISTIC_PRICING;
  }
  if (Object.prototype.hasOwnProperty.call(NODESLIDE_MODEL_PRICING, model)) {
    return NODESLIDE_MODEL_PRICING[
      model as NodeSlideAgentModelId
    ] as NodeSlideCatalogPricingMetadata;
  }
  return {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'unknown',
    modelId: model,
    reason: 'model_not_cataloged',
    source: 'unrecognized_model',
  };
}

export type NodeSlideWorstCaseCostScore =
  | {
      readonly kind: 'scored';
      readonly model: string;
      readonly pricing: NodeSlideScoredModelMetadata;
      readonly inputCostMicroUsd: number;
      readonly outputCostMicroUsd: number;
      readonly totalCostMicroUsd: number;
    }
  | {
      readonly kind: 'unscored';
      readonly model: string;
      readonly reason: 'pricing_unknown';
      readonly pricing: NodeSlideUnknownModelPricing;
      readonly inputCostMicroUsd: null;
      readonly outputCostMicroUsd: null;
      readonly totalCostMicroUsd: null;
    };

export function scoreNodeSlideWorstCaseCost(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): NodeSlideWorstCaseCostScore {
  assertModel(args.model);
  assertAccountingInteger('inputTokens', args.inputTokens);
  assertAccountingInteger('outputTokens', args.outputTokens);
  const pricing = nodeSlideModelPricing(args.model);
  if (pricing.kind === 'unknown') {
    return {
      kind: 'unscored',
      model: args.model,
      reason: 'pricing_unknown',
      pricing,
      inputCostMicroUsd: null,
      outputCostMicroUsd: null,
      totalCostMicroUsd: null,
    };
  }
  const inputCostMicroUsd = conservativeTokenCost(
    args.inputTokens,
    pricing.inputMicroUsdPerMillionTokens,
  );
  const outputCostMicroUsd = conservativeTokenCost(
    args.outputTokens,
    pricing.outputMicroUsdPerMillionTokens,
  );
  return {
    kind: 'scored',
    model: args.model,
    pricing,
    inputCostMicroUsd,
    outputCostMicroUsd,
    totalCostMicroUsd: inputCostMicroUsd + outputCostMicroUsd,
  };
}

function conservativeTokenCost(tokens: number, microUsdPerMillionTokens: number): number {
  if (tokens === 0 || microUsdPerMillionTokens === 0) return 0;
  const numerator = BigInt(tokens) * BigInt(microUsdPerMillionTokens);
  const denominator = BigInt(NODESLIDE_TOKENS_PER_PRICING_UNIT);
  const cost = (numerator + denominator - 1n) / denominator;
  const result = Number(cost);
  if (!Number.isSafeInteger(result)) {
    throw new NodeSlideRunBudgetValidationError('cost', 'calculation exceeds safe range');
  }
  return result;
}

function assertModel(model: string): void {
  if (typeof model !== 'string' || model.length < 1 || model.length > 256) {
    throw new NodeSlideRunBudgetValidationError('model', 'expected 1 through 256 characters');
  }
}

function assertAccountingInteger(field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NodeSlideRunBudgetValidationError(field, 'expected a non-negative safe integer');
  }
}

export interface NodeSlideRunBudgetAccumulated {
  readonly costMicroUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly elapsedMs: number;
  readonly iterations: number;
  readonly toolCalls: number;
}

export interface NodeSlideRunBudgetRemaining {
  readonly costMicroUsd: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly iterations: number;
  readonly toolCalls: number;
}

export interface NodeSlideRunBudgetState {
  readonly version: typeof NODESLIDE_RUN_BUDGET_STATE_VERSION;
  readonly budget: NodeSlideRunBudget;
  readonly accumulated: NodeSlideRunBudgetAccumulated;
  readonly receiptDigests: Readonly<Record<string, string>>;
  readonly digest: string;
}

export interface NodeSlideRunBudgetReceipt {
  readonly version: typeof NODESLIDE_RUN_BUDGET_RECEIPT_VERSION;
  readonly idempotencyKey: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicroUsd: number;
  readonly elapsedMs: number;
  readonly iterations: number;
  readonly toolCalls: number;
}

export type NodeSlideRunBudgetTerminalReason =
  | { readonly code: 'max_cost_reached'; readonly used: number; readonly limit: number }
  | { readonly code: 'max_input_tokens_reached'; readonly used: number; readonly limit: number }
  | { readonly code: 'max_output_tokens_reached'; readonly used: number; readonly limit: number }
  | { readonly code: 'max_duration_reached'; readonly used: number; readonly limit: number }
  | { readonly code: 'max_iterations_reached'; readonly used: number; readonly limit: number }
  | { readonly code: 'max_tool_calls_reached'; readonly used: number; readonly limit: number };

export type NodeSlideRunBudgetPreflightDenialReason =
  | NodeSlideRunBudgetTerminalReason
  | {
      readonly code: 'invalid_preflight';
      readonly field: string;
      readonly message: string;
    }
  | { readonly code: 'state_digest_mismatch' }
  | {
      readonly code: 'pricing_unknown';
      readonly model: string;
      readonly pricing: NodeSlideUnknownModelPricing;
    }
  | {
      readonly code: 'estimated_input_exceeds_remaining';
      readonly estimatedInputTokens: number;
      readonly remainingInputTokens: number;
    }
  | {
      readonly code: 'model_context_exceeded';
      readonly estimatedInputTokens: number;
      readonly providerContextWindowTokens: number;
    }
  | {
      readonly code: 'cost_budget_exceeded';
      readonly remainingCostMicroUsd: number;
      readonly inputCostMicroUsd: number;
      readonly minimumOutputCostMicroUsd: number;
    };

export type NodeSlideRunBudgetPreflightResult =
  | {
      readonly ok: true;
      readonly model: string;
      readonly pricing: NodeSlideScoredModelMetadata;
      readonly providerSafeOutputTokenCeiling: number;
      readonly providerTimeoutMs: number;
      readonly worstCaseCostMicroUsd: number;
      readonly remainingBeforeCall: NodeSlideRunBudgetRemaining;
      readonly stateDigest: string;
      readonly decisionDigest: string;
    }
  | {
      readonly ok: false;
      readonly reason: NodeSlideRunBudgetPreflightDenialReason;
      readonly remaining: NodeSlideRunBudgetRemaining;
      readonly stateDigest: string;
    };

export type NodeSlideRunBudgetPostflightRejection =
  | { readonly code: 'state_digest_mismatch' }
  | {
      readonly code: 'invalid_receipt';
      readonly field: string;
      readonly message: string;
    }
  | {
      readonly code: 'receipt_replay_mismatch';
      readonly idempotencyKey: string;
      readonly existingDigest: string;
      readonly receivedDigest: string;
    }
  | { readonly code: 'receipt_ledger_full'; readonly limit: number };

export type NodeSlideRunBudgetPostflightResult =
  | {
      readonly ok: true;
      readonly applied: boolean;
      readonly receiptDigest: string;
      readonly state: NodeSlideRunBudgetState;
      readonly remaining: NodeSlideRunBudgetRemaining;
      readonly terminalReason: NodeSlideRunBudgetTerminalReason | null;
    }
  | {
      readonly ok: false;
      readonly reason: NodeSlideRunBudgetPostflightRejection;
      readonly state: NodeSlideRunBudgetState;
      readonly remaining: NodeSlideRunBudgetRemaining;
      readonly terminalReason: NodeSlideRunBudgetTerminalReason | null;
    };
