import {
  NODESLIDE_MICRO_USD_PER_USD,
  NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
  NODESLIDE_RUN_BUDGET_BOUNDS,
  NODESLIDE_RUN_BUDGET_RECEIPT_VERSION,
  NODESLIDE_RUN_BUDGET_STATE_VERSION,
  NODESLIDE_TOKENS_PER_PRICING_UNIT,
  type NodeSlideRunBudget,
  type NodeSlideRunBudgetAccumulated,
  type NodeSlideRunBudgetPostflightResult,
  type NodeSlideRunBudgetPreflightDenialReason,
  type NodeSlideRunBudgetPreflightResult,
  type NodeSlideRunBudgetReceipt,
  type NodeSlideRunBudgetRemaining,
  type NodeSlideRunBudgetState,
  type NodeSlideRunBudgetTerminalReason,
  type NodeSlideScoredModelMetadata,
  nodeSlideModelPricing,
  normalizeNodeSlideRunBudget,
  scoreNodeSlideWorstCaseCost,
} from '../../shared/nodeslideRunBudget';
import { nodeslideContentDigest } from './nodeslideIds';

export * from '../../shared/nodeslideRunBudget';

const MAX_RECEIPT_LEDGER_ENTRIES = 1_024;
const RECEIPT_KEYS = new Set([
  'version',
  'idempotencyKey',
  'model',
  'inputTokens',
  'outputTokens',
  'costMicroUsd',
  'elapsedMs',
  'iterations',
  'toolCalls',
]);
const RECEIPT_BOUNDS = {
  inputTokens: 100_000_000,
  outputTokens: 100_000_000,
  costMicroUsd: 1_000_000_000,
  elapsedMs: 86_400_000,
  iterations: 128,
  toolCalls: 4_096,
} as const;
const SHA_256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export function createNodeSlideRunBudgetState(input: unknown = {}): NodeSlideRunBudgetState {
  const state = {
    version: NODESLIDE_RUN_BUDGET_STATE_VERSION,
    budget: normalizeNodeSlideRunBudget(input),
    accumulated: {
      costMicroUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      elapsedMs: 0,
      iterations: 0,
      toolCalls: 0,
    },
    receiptDigests: {},
  } as const;
  return { ...state, digest: nodeSlideRunBudgetStateDigest(state) };
}

export function nodeSlideRunBudgetStateDigest(
  state: Omit<NodeSlideRunBudgetState, 'digest'> | NodeSlideRunBudgetState,
): string {
  const budget = normalizeNodeSlideRunBudget(state.budget);
  const receiptDigests = Object.entries(state.receiptDigests).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return nodeslideContentDigest(
    JSON.stringify([
      'nodeslide.run-budget-state-digest/v1',
      state.version,
      canonicalBudgetTuple(budget),
      canonicalAccumulatedTuple(state.accumulated),
      receiptDigests,
    ]),
  );
}

export function nodeSlideRunBudgetReceiptDigest(receipt: NodeSlideRunBudgetReceipt): string {
  return nodeslideContentDigest(
    JSON.stringify([
      'nodeslide.run-budget-receipt-digest/v1',
      receipt.version,
      receipt.idempotencyKey,
      receipt.model,
      receipt.inputTokens,
      receipt.outputTokens,
      receipt.costMicroUsd,
      receipt.elapsedMs,
      receipt.iterations,
      receipt.toolCalls,
    ]),
  );
}

export function nodeSlideRunBudgetRemaining(
  state: NodeSlideRunBudgetState,
): NodeSlideRunBudgetRemaining {
  const { accumulated, budget } = state;
  const costMicroUsd = remaining(budget.maxCostMicroUsd, accumulated.costMicroUsd);
  return {
    costMicroUsd,
    costUsd: costMicroUsd / NODESLIDE_MICRO_USD_PER_USD,
    inputTokens: remaining(budget.maxInputTokens, accumulated.inputTokens),
    outputTokens: remaining(budget.maxOutputTokens, accumulated.outputTokens),
    durationMs: remaining(budget.maxDurationMs, accumulated.elapsedMs),
    iterations: remaining(budget.maxIterations, accumulated.iterations),
    toolCalls: remaining(budget.maxToolCalls, accumulated.toolCalls),
  };
}

export function nodeSlideRunBudgetTerminalReason(
  state: NodeSlideRunBudgetState,
): NodeSlideRunBudgetTerminalReason | null {
  const { accumulated, budget } = state;
  if (
    budget.maxCostMicroUsd === 0
      ? accumulated.costMicroUsd > 0
      : accumulated.costMicroUsd >= budget.maxCostMicroUsd
  ) {
    return {
      code: 'max_cost_reached',
      used: accumulated.costMicroUsd,
      limit: budget.maxCostMicroUsd,
    };
  }
  if (accumulated.inputTokens >= budget.maxInputTokens) {
    return {
      code: 'max_input_tokens_reached',
      used: accumulated.inputTokens,
      limit: budget.maxInputTokens,
    };
  }
  if (accumulated.outputTokens >= budget.maxOutputTokens) {
    return {
      code: 'max_output_tokens_reached',
      used: accumulated.outputTokens,
      limit: budget.maxOutputTokens,
    };
  }
  if (accumulated.elapsedMs >= budget.maxDurationMs) {
    return {
      code: 'max_duration_reached',
      used: accumulated.elapsedMs,
      limit: budget.maxDurationMs,
    };
  }
  if (accumulated.iterations >= budget.maxIterations) {
    return {
      code: 'max_iterations_reached',
      used: accumulated.iterations,
      limit: budget.maxIterations,
    };
  }
  if (accumulated.toolCalls >= budget.maxToolCalls) {
    return {
      code: 'max_tool_calls_reached',
      used: accumulated.toolCalls,
      limit: budget.maxToolCalls,
    };
  }
  return null;
}

/**
 * Pure server preflight. The caller must pass providerSafeOutputTokenCeiling as
 * the provider's output limit and providerTimeoutMs as its deadline.
 */
export function preflightNodeSlideRunBudget(args: {
  state: NodeSlideRunBudgetState;
  model: string;
  estimatedInputTokens: number;
  requestedMaxOutputTokens: number;
}): NodeSlideRunBudgetPreflightResult {
  const stateIssue = validateState(args.state);
  const remainingBudget = nodeSlideRunBudgetRemaining(args.state);
  if (stateIssue) {
    return denyPreflight(
      stateIssue.code === 'state_digest_mismatch'
        ? stateIssue
        : {
            code: 'invalid_preflight',
            field: stateIssue.field,
            message: stateIssue.message,
          },
      remainingBudget,
      args.state.digest,
    );
  }

  const inputIssue = validatePreflightInput(args);
  if (inputIssue) {
    return denyPreflight(inputIssue, remainingBudget, args.state.digest);
  }

  const terminalReason = nodeSlideRunBudgetTerminalReason(args.state);
  if (terminalReason) {
    return denyPreflight(terminalReason, remainingBudget, args.state.digest);
  }
  if (args.estimatedInputTokens > remainingBudget.inputTokens) {
    return denyPreflight(
      {
        code: 'estimated_input_exceeds_remaining',
        estimatedInputTokens: args.estimatedInputTokens,
        remainingInputTokens: remainingBudget.inputTokens,
      },
      remainingBudget,
      args.state.digest,
    );
  }

  const pricing = nodeSlideModelPricing(args.model);
  if (pricing.kind === 'unknown') {
    return denyPreflight(
      { code: 'pricing_unknown', model: args.model, pricing },
      remainingBudget,
      args.state.digest,
    );
  }
  if (
    pricing.kind === 'priced' &&
    args.estimatedInputTokens >= pricing.providerContextWindowTokens
  ) {
    return denyPreflight(
      {
        code: 'model_context_exceeded',
        estimatedInputTokens: args.estimatedInputTokens,
        providerContextWindowTokens: pricing.providerContextWindowTokens,
      },
      remainingBudget,
      args.state.digest,
    );
  }

  const inputCost = scoreNodeSlideWorstCaseCost({
    model: args.model,
    inputTokens: args.estimatedInputTokens,
    outputTokens: 0,
  });
  if (inputCost.kind !== 'scored') {
    return denyPreflight(
      { code: 'pricing_unknown', model: args.model, pricing: inputCost.pricing },
      remainingBudget,
      args.state.digest,
    );
  }

  const minimumOutputCost = scoreNodeSlideWorstCaseCost({
    model: args.model,
    inputTokens: 0,
    outputTokens: 1,
  });
  if (minimumOutputCost.kind !== 'scored') {
    return denyPreflight(
      { code: 'pricing_unknown', model: args.model, pricing: minimumOutputCost.pricing },
      remainingBudget,
      args.state.digest,
    );
  }
  if (
    inputCost.totalCostMicroUsd + minimumOutputCost.totalCostMicroUsd >
    remainingBudget.costMicroUsd
  ) {
    return denyPreflight(
      {
        code: 'cost_budget_exceeded',
        remainingCostMicroUsd: remainingBudget.costMicroUsd,
        inputCostMicroUsd: inputCost.totalCostMicroUsd,
        minimumOutputCostMicroUsd: minimumOutputCost.totalCostMicroUsd,
      },
      remainingBudget,
      args.state.digest,
    );
  }

  const requestedAndProviderBounded = Math.min(
    args.requestedMaxOutputTokens,
    remainingBudget.outputTokens,
    pricing.providerMaxOutputTokens,
    pricing.kind === 'priced'
      ? pricing.providerContextWindowTokens - args.estimatedInputTokens
      : Number.MAX_SAFE_INTEGER,
  );
  const affordableOutputTokens = maximumAffordableOutputTokens(
    remainingBudget.costMicroUsd - inputCost.totalCostMicroUsd,
    pricing,
  );
  const providerSafeOutputTokenCeiling = Math.min(
    requestedAndProviderBounded,
    affordableOutputTokens,
  );
  if (providerSafeOutputTokenCeiling < 1) {
    return denyPreflight(
      {
        code: 'cost_budget_exceeded',
        remainingCostMicroUsd: remainingBudget.costMicroUsd,
        inputCostMicroUsd: inputCost.totalCostMicroUsd,
        minimumOutputCostMicroUsd: minimumOutputCost.totalCostMicroUsd,
      },
      remainingBudget,
      args.state.digest,
    );
  }

  const worstCaseCost = scoreNodeSlideWorstCaseCost({
    model: args.model,
    inputTokens: args.estimatedInputTokens,
    outputTokens: providerSafeOutputTokenCeiling,
  });
  if (
    worstCaseCost.kind !== 'scored' ||
    worstCaseCost.totalCostMicroUsd > remainingBudget.costMicroUsd
  ) {
    return denyPreflight(
      {
        code: 'cost_budget_exceeded',
        remainingCostMicroUsd: remainingBudget.costMicroUsd,
        inputCostMicroUsd: inputCost.totalCostMicroUsd,
        minimumOutputCostMicroUsd: minimumOutputCost.totalCostMicroUsd,
      },
      remainingBudget,
      args.state.digest,
    );
  }

  const providerTimeoutMs = remainingBudget.durationMs;
  const decisionDigest = nodeslideContentDigest(
    JSON.stringify([
      'nodeslide.run-budget-preflight-digest/v1',
      args.state.digest,
      args.model,
      args.estimatedInputTokens,
      args.requestedMaxOutputTokens,
      canonicalPricingTuple(pricing),
      providerSafeOutputTokenCeiling,
      providerTimeoutMs,
      worstCaseCost.totalCostMicroUsd,
    ]),
  );
  return {
    ok: true,
    model: args.model,
    pricing,
    providerSafeOutputTokenCeiling,
    providerTimeoutMs,
    worstCaseCostMicroUsd: worstCaseCost.totalCostMicroUsd,
    remainingBeforeCall: remainingBudget,
    stateDigest: args.state.digest,
    decisionDigest,
  };
}

/** Applies a provider receipt once; matching replays are successful no-ops. */
export function accountNodeSlideRunBudgetReceipt(args: {
  state: NodeSlideRunBudgetState;
  receipt: NodeSlideRunBudgetReceipt;
}): NodeSlideRunBudgetPostflightResult {
  const stateIssue = validateState(args.state);
  if (stateIssue) {
    return postflightRejection(
      args.state,
      stateIssue.code === 'state_digest_mismatch'
        ? stateIssue
        : {
            code: 'invalid_receipt',
            field: `state.${stateIssue.field}`,
            message: stateIssue.message,
          },
    );
  }
  const receiptIssue = validateReceipt(args.receipt);
  if (receiptIssue) {
    return postflightRejection(args.state, {
      code: 'invalid_receipt',
      field: receiptIssue.field,
      message: receiptIssue.message,
    });
  }

  const receivedDigest = nodeSlideRunBudgetReceiptDigest(args.receipt);
  const hasExistingReceipt = Object.prototype.hasOwnProperty.call(
    args.state.receiptDigests,
    args.receipt.idempotencyKey,
  );
  const existingDigest = hasExistingReceipt
    ? args.state.receiptDigests[args.receipt.idempotencyKey]
    : undefined;
  if (existingDigest !== undefined) {
    if (existingDigest !== receivedDigest) {
      return postflightRejection(args.state, {
        code: 'receipt_replay_mismatch',
        idempotencyKey: args.receipt.idempotencyKey,
        existingDigest,
        receivedDigest,
      });
    }
    return postflightSuccess(args.state, receivedDigest, false);
  }
  if (Object.keys(args.state.receiptDigests).length >= MAX_RECEIPT_LEDGER_ENTRIES) {
    return postflightRejection(args.state, {
      code: 'receipt_ledger_full',
      limit: MAX_RECEIPT_LEDGER_ENTRIES,
    });
  }

  const accumulated = addReceipt(args.state.accumulated, args.receipt);
  if (!accumulated) {
    return postflightRejection(args.state, {
      code: 'invalid_receipt',
      field: 'accumulated',
      message: 'receipt would exceed safe integer accounting',
    });
  }
  const nextWithoutDigest = {
    version: NODESLIDE_RUN_BUDGET_STATE_VERSION,
    budget: args.state.budget,
    accumulated,
    receiptDigests: {
      ...args.state.receiptDigests,
      [args.receipt.idempotencyKey]: receivedDigest,
    },
  } as const;
  const nextState: NodeSlideRunBudgetState = {
    ...nextWithoutDigest,
    digest: nodeSlideRunBudgetStateDigest(nextWithoutDigest),
  };
  return postflightSuccess(nextState, receivedDigest, true);
}

function maximumAffordableOutputTokens(
  remainingCostMicroUsd: number,
  pricing: NodeSlideScoredModelMetadata,
): number {
  if (pricing.outputMicroUsdPerMillionTokens === 0) return Number.MAX_SAFE_INTEGER;
  const tokens =
    (BigInt(remainingCostMicroUsd) * BigInt(NODESLIDE_TOKENS_PER_PRICING_UNIT)) /
    BigInt(pricing.outputMicroUsdPerMillionTokens);
  const result = Number(tokens);
  return Number.isSafeInteger(result) ? result : Number.MAX_SAFE_INTEGER;
}

function validatePreflightInput(args: {
  model: string;
  estimatedInputTokens: number;
  requestedMaxOutputTokens: number;
}): Extract<NodeSlideRunBudgetPreflightDenialReason, { code: 'invalid_preflight' }> | null {
  if (
    typeof args.model !== 'string' ||
    args.model.length < 1 ||
    args.model.length > 256 ||
    args.model.trim() !== args.model
  ) {
    return {
      code: 'invalid_preflight',
      field: 'model',
      message: 'expected a trimmed model identifier of 1 through 256 characters',
    };
  }
  if (
    !Number.isSafeInteger(args.estimatedInputTokens) ||
    args.estimatedInputTokens < 0 ||
    args.estimatedInputTokens > NODESLIDE_RUN_BUDGET_BOUNDS.maxInputTokens.max
  ) {
    return {
      code: 'invalid_preflight',
      field: 'estimatedInputTokens',
      message: `expected an integer from 0 through ${NODESLIDE_RUN_BUDGET_BOUNDS.maxInputTokens.max}`,
    };
  }
  if (
    !Number.isSafeInteger(args.requestedMaxOutputTokens) ||
    args.requestedMaxOutputTokens < 1 ||
    args.requestedMaxOutputTokens > NODESLIDE_RUN_BUDGET_BOUNDS.maxOutputTokens.max
  ) {
    return {
      code: 'invalid_preflight',
      field: 'requestedMaxOutputTokens',
      message: `expected an integer from 1 through ${NODESLIDE_RUN_BUDGET_BOUNDS.maxOutputTokens.max}`,
    };
  }
  return null;
}

type StateIssue =
  | { readonly code: 'state_digest_mismatch' }
  | { readonly code: 'invalid_state'; readonly field: string; readonly message: string };

function validateState(state: NodeSlideRunBudgetState): StateIssue | null {
  if (state.version !== NODESLIDE_RUN_BUDGET_STATE_VERSION) {
    return { code: 'invalid_state', field: 'version', message: 'unsupported state version' };
  }
  try {
    const canonical = normalizeNodeSlideRunBudget(state.budget);
    if (
      JSON.stringify(canonicalBudgetTuple(canonical)) !==
      JSON.stringify(canonicalBudgetTuple(state.budget))
    ) {
      return { code: 'invalid_state', field: 'budget', message: 'budget is not canonical' };
    }
  } catch {
    return { code: 'invalid_state', field: 'budget', message: 'budget is invalid' };
  }
  for (const [field, value] of Object.entries(state.accumulated)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      return {
        code: 'invalid_state',
        field: `accumulated.${field}`,
        message: 'expected a non-negative safe integer',
      };
    }
  }
  const receiptEntries = Object.entries(state.receiptDigests);
  if (receiptEntries.length > MAX_RECEIPT_LEDGER_ENTRIES) {
    return { code: 'invalid_state', field: 'receiptDigests', message: 'ledger exceeds limit' };
  }
  for (const [key, digest] of receiptEntries) {
    if (!IDEMPOTENCY_KEY_PATTERN.test(key) || !SHA_256_DIGEST_PATTERN.test(digest)) {
      return {
        code: 'invalid_state',
        field: 'receiptDigests',
        message: 'ledger contains a non-canonical entry',
      };
    }
  }
  if (!SHA_256_DIGEST_PATTERN.test(state.digest)) {
    return { code: 'state_digest_mismatch' };
  }
  return nodeSlideRunBudgetStateDigest(state) === state.digest
    ? null
    : { code: 'state_digest_mismatch' };
}

function validateReceipt(
  receipt: NodeSlideRunBudgetReceipt,
): { readonly field: string; readonly message: string } | null {
  for (const key of Object.keys(receipt)) {
    if (!RECEIPT_KEYS.has(key)) return { field: key, message: 'unknown field' };
  }
  if (receipt.version !== NODESLIDE_RUN_BUDGET_RECEIPT_VERSION) {
    return { field: 'version', message: 'unsupported receipt version' };
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(receipt.idempotencyKey)) {
    return { field: 'idempotencyKey', message: 'expected a bounded canonical key' };
  }
  if (
    typeof receipt.model !== 'string' ||
    receipt.model.length < 1 ||
    receipt.model.length > 256 ||
    receipt.model.trim() !== receipt.model
  ) {
    return { field: 'model', message: 'expected a bounded trimmed model identifier' };
  }
  const integerFields = [
    ['inputTokens', receipt.inputTokens, RECEIPT_BOUNDS.inputTokens, 0],
    ['outputTokens', receipt.outputTokens, RECEIPT_BOUNDS.outputTokens, 0],
    ['costMicroUsd', receipt.costMicroUsd, RECEIPT_BOUNDS.costMicroUsd, 0],
    ['elapsedMs', receipt.elapsedMs, RECEIPT_BOUNDS.elapsedMs, 0],
    ['iterations', receipt.iterations, RECEIPT_BOUNDS.iterations, 1],
    ['toolCalls', receipt.toolCalls, RECEIPT_BOUNDS.toolCalls, 0],
  ] as const;
  for (const [field, value, maximum, minimum] of integerFields) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      return { field, message: `expected an integer from ${minimum} through ${maximum}` };
    }
  }
  if (receipt.model === NODESLIDE_PRIVATE_DETERMINISTIC_MODEL && receipt.costMicroUsd !== 0) {
    return { field: 'costMicroUsd', message: 'private deterministic receipts must cost zero' };
  }
  return null;
}

function addReceipt(
  accumulated: NodeSlideRunBudgetAccumulated,
  receipt: NodeSlideRunBudgetReceipt,
): NodeSlideRunBudgetAccumulated | null {
  const next = {
    costMicroUsd: safeAdd(accumulated.costMicroUsd, receipt.costMicroUsd),
    inputTokens: safeAdd(accumulated.inputTokens, receipt.inputTokens),
    outputTokens: safeAdd(accumulated.outputTokens, receipt.outputTokens),
    elapsedMs: safeAdd(accumulated.elapsedMs, receipt.elapsedMs),
    iterations: safeAdd(accumulated.iterations, receipt.iterations),
    toolCalls: safeAdd(accumulated.toolCalls, receipt.toolCalls),
  };
  return Object.values(next).every((value) => value !== null)
    ? (next as NodeSlideRunBudgetAccumulated)
    : null;
}

function safeAdd(left: number, right: number): number | null {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
}

function postflightSuccess(
  state: NodeSlideRunBudgetState,
  receiptDigest: string,
  applied: boolean,
): NodeSlideRunBudgetPostflightResult {
  return {
    ok: true,
    applied,
    receiptDigest,
    state,
    remaining: nodeSlideRunBudgetRemaining(state),
    terminalReason: nodeSlideRunBudgetTerminalReason(state),
  };
}

function postflightRejection(
  state: NodeSlideRunBudgetState,
  reason: Extract<NodeSlideRunBudgetPostflightResult, { ok: false }>['reason'],
): NodeSlideRunBudgetPostflightResult {
  return {
    ok: false,
    reason,
    state,
    remaining: nodeSlideRunBudgetRemaining(state),
    terminalReason: nodeSlideRunBudgetTerminalReason(state),
  };
}

function denyPreflight(
  reason: NodeSlideRunBudgetPreflightDenialReason,
  remainingBudget: NodeSlideRunBudgetRemaining,
  stateDigest: string,
): NodeSlideRunBudgetPreflightResult {
  return { ok: false, reason, remaining: remainingBudget, stateDigest };
}

function canonicalBudgetTuple(budget: NodeSlideRunBudget): readonly unknown[] {
  return [
    budget.version,
    budget.enforcement,
    budget.maxCostMicroUsd,
    budget.maxInputTokens,
    budget.maxOutputTokens,
    budget.maxDurationMs,
    budget.maxIterations,
    budget.maxToolCalls,
  ];
}

function canonicalAccumulatedTuple(accumulated: NodeSlideRunBudgetAccumulated): readonly number[] {
  return [
    accumulated.costMicroUsd,
    accumulated.inputTokens,
    accumulated.outputTokens,
    accumulated.elapsedMs,
    accumulated.iterations,
    accumulated.toolCalls,
  ];
}

function canonicalPricingTuple(pricing: NodeSlideScoredModelMetadata): readonly unknown[] {
  return pricing.kind === 'priced'
    ? [
        pricing.version,
        pricing.kind,
        pricing.modelId,
        pricing.inputMicroUsdPerMillionTokens,
        pricing.outputMicroUsdPerMillionTokens,
        pricing.providerContextWindowTokens,
        pricing.providerMaxOutputTokens,
        pricing.source,
      ]
    : [pricing.version, pricing.kind, pricing.modelId, pricing.source];
}

function remaining(limit: number, used: number): number {
  return Math.max(0, limit - used);
}
