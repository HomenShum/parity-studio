import {
  NODESLIDE_DEFAULT_AGENT_MODEL,
  type NodeSlideAgentModelId,
  nodeSlideAgentModel,
} from '../../shared/nodeslide';
import {
  type NodeSlideRunBudget,
  type NodeSlideRunBudgetInput,
  nodeSlideModelPricing,
  normalizeNodeSlideRunBudget,
  scoreNodeSlideWorstCaseCost,
} from '../../shared/nodeslideRunBudget';
import { nodeslideStableId } from './nodeslideIds';
import { type NodeSlideProviderResult, callNodeSlideFreeJson } from './nodeslideProvider';

const MAX_PROVIDER_ATTEMPTS = 2;
const PROVIDER_HARD_MAX_OUTPUT_TOKENS = 2_200;
const PROVIDER_HARD_TIMEOUT_MS = 30_000;
const MAX_REPAIR_CONTEXT_UTF8_BYTES = 24_000 * 4;
const PROVIDER_MESSAGE_OVERHEAD_TOKENS_PER_ATTEMPT = 4_096;
const MAX_STATE_RETRIES = 2;

export type NodeSlideBudgetedJsonRequest = Parameters<typeof callNodeSlideFreeJson>[0];

export interface NodeSlideBudgetLedgerView {
  budget: {
    id: string;
    status: 'open' | 'finalized';
    revision: number;
    stateDigest: string;
    actualMicroUsd: number;
    reservedMicroUsd: number;
    unreconciledMicroUsd: number;
  };
  call?: {
    callId: string;
    status: 'reserved' | 'unreconciled' | 'settled' | 'released';
    quoteMicroUsd: number;
    providerSafeOutputTokenCeiling: number;
    providerTimeoutMs: number;
  };
}

/**
 * Structural client for convex/nodeslideBudgets.ts. An action binds these
 * methods to ctx.runMutation/internal.nodeslideBudgets and ctx.runQuery.
 */
export interface NodeSlideBudgetLedgerClient {
  create(args: {
    budgetId: string;
    budget: NodeSlideRunBudgetInput;
  }): Promise<NodeSlideBudgetLedgerView>;
  reserve(args: {
    budgetId: string;
    callId: string;
    model: string;
    estimatedInputTokens: number;
    requestedMaxOutputTokens: number;
    expectedRevision: number;
    expectedStateDigest: string;
  }): Promise<NodeSlideBudgetLedgerView>;
  settle(args: {
    budgetId: string;
    callId: string;
    inputTokens: number;
    outputTokens: number;
    actualMicroUsd: number;
    elapsedMs: number;
    iterations: number;
    toolCalls: number;
    expectedRevision: number;
    expectedStateDigest: string;
  }): Promise<NodeSlideBudgetLedgerView>;
  captureTimeout(args: {
    budgetId: string;
    callId: string;
    expectedRevision: number;
    expectedStateDigest: string;
  }): Promise<NodeSlideBudgetLedgerView>;
  release(args: {
    budgetId: string;
    callId: string;
    expectedRevision: number;
    expectedStateDigest: string;
  }): Promise<NodeSlideBudgetLedgerView>;
  replay(args: {
    budgetId: string;
    callId?: string;
  }): Promise<NodeSlideBudgetLedgerView | null>;
}

export type NodeSlideBudgetedProviderCall = (
  request: NodeSlideBudgetedJsonRequest,
  dependencies: {
    dispatchPolicy: { maxOutputTokens: number; timeoutMs: number };
  },
) => Promise<NodeSlideProviderResult>;

export interface NodeSlideBudgetedProviderDependencies {
  ledger: NodeSlideBudgetLedgerClient;
  provider?: NodeSlideBudgetedProviderCall;
  now?: () => number;
}

export interface NodeSlideBudgetedProviderRequest {
  /**
   * Stable durable run/session key. Changing a budget for this key is rejected.
   * The caller must hold the run's exclusive durable dispatch lease.
   */
  runId: string;
  /** Stable semantic slot within the run, such as edit-planner or repair-2. */
  callKey: string;
  budget?: NodeSlideRunBudgetInput;
  providerRequest: NodeSlideBudgetedJsonRequest;
}

export type NodeSlideBudgetDisposition =
  | 'settled'
  | 'unreconciled'
  | 'released'
  | 'denied'
  | 'replayed'
  | 'accounting_error';

export interface NodeSlideBudgetAccounting {
  budgetId: string;
  callId: string;
  disposition: NodeSlideBudgetDisposition;
  ledger?: NodeSlideBudgetLedgerView;
}

export type NodeSlideBudgetedProviderResult =
  | ({ accounting: NodeSlideBudgetAccounting } & NodeSlideProviderResult)
  | {
      ok: false;
      reason: string;
      code:
        | 'pricing_unknown'
        | 'budget_denied'
        | 'ambiguous_provider_call'
        | 'idempotent_replay'
        | 'accounting_failed';
      accounting: NodeSlideBudgetAccounting;
    };

/** Deterministic and opaque: durable IDs never expose the caller's run key. */
export function nodeSlideProviderBudgetId(runId: string): string {
  assertStableKey('runId', runId);
  return nodeslideStableId('nsbudget', runId);
}

/**
 * The request digest is part of the call ID so a changed prompt cannot replay a
 * reservation that happened to have the same token estimate.
 */
export function nodeSlideProviderCallId(args: {
  runId: string;
  callKey: string;
  providerRequest: NodeSlideBudgetedJsonRequest;
}): string {
  assertStableKey('runId', args.runId);
  assertStableKey('callKey', args.callKey);
  return nodeslideStableId(
    'nscall',
    args.runId,
    args.callKey,
    canonicalJson(providerRequestIdentity(args.providerRequest)),
  );
}

/**
 * Conservative tokenizer-independent bound. A byte cannot require more than
 * one byte-level token; role/message overhead and the maximum repair excerpt
 * are then added explicitly for both possible provider attempts.
 */
export function estimateNodeSlideProviderInputTokens(
  request: NodeSlideBudgetedJsonRequest,
): number {
  const encoder = new TextEncoder();
  const requestBytes =
    encoder.encode(request.systemPrompt).byteLength +
    encoder.encode(request.userText).byteLength +
    encoder.encode(canonicalJson(request.jsonSchema ?? null)).byteLength;
  return (
    requestBytes * MAX_PROVIDER_ATTEMPTS +
    MAX_REPAIR_CONTEXT_UTF8_BYTES +
    PROVIDER_MESSAGE_OVERHEAD_TOKENS_PER_ATTEMPT * MAX_PROVIDER_ATTEMPTS
  );
}

/**
 * Trusted reserve-before-dispatch adapter. It deliberately returns an honest
 * failure for a prior terminal call because the budget ledger stores accounting
 * receipts, not the provider's JSON value; the durable job journal owns result
 * replay. No replay path dispatches the provider twice.
 */
export async function callNodeSlideBudgetedJson(
  args: NodeSlideBudgetedProviderRequest,
  dependencies: NodeSlideBudgetedProviderDependencies,
): Promise<NodeSlideBudgetedProviderResult> {
  const provider = dependencies.provider ?? defaultProviderCall;
  const now = dependencies.now ?? Date.now;
  const selectedModel = args.providerRequest.model ?? NODESLIDE_DEFAULT_AGENT_MODEL;
  const budgetId = nodeSlideProviderBudgetId(args.runId);
  const callId = nodeSlideProviderCallId(args);
  const baseAccounting = { budgetId, callId };
  const pricing = nodeSlideModelPricing(selectedModel);
  if (pricing.kind === 'unknown') {
    return {
      ok: false,
      reason:
        'The selected model has no pinned server pricing, so hard-budget dispatch was denied.',
      code: 'pricing_unknown',
      accounting: { ...baseAccounting, disposition: 'denied' },
    };
  }

  let canonicalBudget: NodeSlideRunBudget;
  try {
    canonicalBudget = normalizeNodeSlideRunBudget(args.budget ?? {});
  } catch {
    return budgetDenied(
      baseAccounting,
      'The run budget is invalid, so provider dispatch was denied.',
    );
  }

  let created: NodeSlideBudgetLedgerView;
  try {
    created = await dependencies.ledger.create({
      budgetId,
      budget: budgetInput(canonicalBudget),
    });
  } catch {
    return budgetDenied(
      baseAccounting,
      'The durable run budget could not be created or replayed, so provider dispatch was denied.',
    );
  }

  let prior: NodeSlideBudgetLedgerView | null;
  try {
    prior = await dependencies.ledger.replay({ budgetId, callId });
  } catch {
    return accountingFailure(
      baseAccounting,
      'The durable budget ledger could not be read, so provider dispatch was denied.',
    );
  }
  if (prior?.call) {
    return recoverPriorCall(prior, dependencies.ledger, baseAccounting);
  }

  const estimatedInputTokens = estimateNodeSlideProviderInputTokens(args.providerRequest);
  const perAttemptRequestedOutput = providerRequestedOutputTokens(args.providerRequest.maxTokens);
  const requestedMaxOutputTokens = perAttemptRequestedOutput * MAX_PROVIDER_ATTEMPTS;
  let reservation: NodeSlideBudgetLedgerView;
  try {
    reservation = await reserveWithStateRetry(dependencies.ledger, {
      budgetId,
      callId,
      model: selectedModel,
      estimatedInputTokens,
      requestedMaxOutputTokens,
      state: created,
    });
  } catch {
    return budgetDenied(
      baseAccounting,
      'The hard run budget could not authorize this provider call.',
    );
  }
  const reservedCall = reservation.call;
  if (!reservedCall || reservedCall.status !== 'reserved') {
    return replayedFailure(
      baseAccounting,
      reservation,
      'The provider call was already accounted for; replay its durable job result.',
    );
  }

  const perAttemptOutputCeiling = Math.floor(
    reservedCall.providerSafeOutputTokenCeiling / MAX_PROVIDER_ATTEMPTS,
  );
  if (perAttemptOutputCeiling < 1) {
    return releaseWithoutDispatch(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The remaining budget cannot authorize both the initial completion and its repair attempt.',
    );
  }

  const startedAt = now();
  let providerResult: NodeSlideProviderResult;
  try {
    providerResult = await provider(
      { ...args.providerRequest, maxTokens: perAttemptOutputCeiling },
      {
        dispatchPolicy: {
          maxOutputTokens: perAttemptOutputCeiling,
          timeoutMs: Math.min(reservedCall.providerTimeoutMs, PROVIDER_HARD_TIMEOUT_MS),
        },
      },
    );
  } catch {
    return captureAmbiguous(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The provider call ended ambiguously; its full reservation remains unreconciled.',
    );
  }

  if (!providerResult.telemetry) {
    return releaseWithoutDispatch(
      dependencies.ledger,
      baseAccounting,
      reservation,
      providerResult.reason,
      providerResult,
    );
  }
  if (!hasProvenSettledAttempts(providerResult)) {
    return captureAmbiguous(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The provider call ended ambiguously; its full reservation remains unreconciled.',
      providerResult,
    );
  }

  const telemetry = providerResult.telemetry;
  const selectedRoute = nodeSlideAgentModel(selectedModel);
  if (
    telemetry.provider !== selectedRoute.provider ||
    telemetry.model !== selectedRoute.upstreamId
  ) {
    return captureAmbiguous(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The provider receipt did not match its authorized route; the full reservation remains unreconciled.',
      providerResult,
    );
  }
  const receipt = conservativeReceipt({
    model: selectedModel,
    telemetry,
    elapsedMs: Math.max(0, Math.ceil(now() - startedAt)),
  });
  if (
    !receipt ||
    receipt.inputTokens > estimatedInputTokens ||
    receipt.outputTokens > reservedCall.providerSafeOutputTokenCeiling ||
    receipt.actualMicroUsd > reservedCall.quoteMicroUsd
  ) {
    return captureAmbiguous(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The provider receipt exceeded its authorization; the full reservation remains unreconciled.',
      providerResult,
    );
  }

  try {
    const settled = await terminalWithStateRetry(
      dependencies.ledger,
      'settle',
      {
        budgetId,
        callId,
        inputTokens: receipt.inputTokens,
        outputTokens: receipt.outputTokens,
        actualMicroUsd: receipt.actualMicroUsd,
        elapsedMs: receipt.elapsedMs,
        iterations: receipt.iterations,
        toolCalls: 0,
      },
      reservation,
    );
    return {
      ...providerResult,
      accounting: { ...baseAccounting, disposition: 'settled', ledger: settled },
    };
  } catch {
    return captureAmbiguous(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The provider receipt could not be settled; the full reservation remains unreconciled.',
      providerResult,
    );
  }
}

function defaultProviderCall(
  request: NodeSlideBudgetedJsonRequest,
  dependencies: { dispatchPolicy: { maxOutputTokens: number; timeoutMs: number } },
): Promise<NodeSlideProviderResult> {
  return callNodeSlideFreeJson(request, { dispatchPolicy: dependencies.dispatchPolicy });
}

function providerRequestIdentity(request: NodeSlideBudgetedJsonRequest) {
  return {
    systemPrompt: request.systemPrompt,
    userText: request.userText,
    maxTokens: request.maxTokens,
    model: request.model ?? NODESLIDE_DEFAULT_AGENT_MODEL,
    reasoningEffort: request.reasoningEffort ?? null,
    jsonSchema: request.jsonSchema ?? null,
  };
}

function providerRequestedOutputTokens(value: number): number {
  if (!Number.isFinite(value)) return PROVIDER_HARD_MAX_OUTPUT_TOKENS;
  return Math.min(PROVIDER_HARD_MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(value)));
}

function budgetInput(budget: NodeSlideRunBudget): NodeSlideRunBudgetInput {
  return {
    maxCostUsd: budget.maxCostUsd,
    maxInputTokens: budget.maxInputTokens,
    maxOutputTokens: budget.maxOutputTokens,
    maxDurationMs: budget.maxDurationMs,
    maxIterations: budget.maxIterations,
    maxToolCalls: budget.maxToolCalls,
  };
}

function conservativeReceipt(args: {
  model: NodeSlideAgentModelId;
  telemetry: NonNullable<NodeSlideProviderResult['telemetry']>;
  elapsedMs: number;
}) {
  const inputTokens = accountingInteger(args.telemetry.inputTokens);
  const outputTokens = accountingInteger(args.telemetry.outputTokens);
  const providerCostMicroUsd = accountingInteger(args.telemetry.costMicroUsd);
  if (inputTokens === null || outputTokens === null || providerCostMicroUsd === null) return null;
  const recomputed = scoreNodeSlideWorstCaseCost({
    model: args.model,
    inputTokens,
    outputTokens,
  });
  if (recomputed.kind !== 'scored') return null;
  const attempts = args.telemetry.attempts ?? [];
  const attemptElapsedMs = attempts.reduce(
    (total, attempt) => total + Math.max(0, Math.ceil(attempt.elapsedMs)),
    0,
  );
  return {
    inputTokens,
    outputTokens,
    actualMicroUsd: Math.max(providerCostMicroUsd, recomputed.totalCostMicroUsd),
    elapsedMs: Math.max(args.elapsedMs, attemptElapsedMs),
    iterations: attempts.length,
  };
}

function hasProvenSettledAttempts(result: NodeSlideProviderResult): boolean {
  const attempts = result.telemetry?.attempts;
  return Boolean(
    attempts?.length &&
      attempts.every(
        (attempt) =>
          attempt.attempted && attempt.settled && !attempt.ambiguous && !attempt.unreconciled,
      ),
  );
}

function accountingInteger(value: number): number | null {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

async function reserveWithStateRetry(
  ledger: NodeSlideBudgetLedgerClient,
  args: {
    budgetId: string;
    callId: string;
    model: string;
    estimatedInputTokens: number;
    requestedMaxOutputTokens: number;
    state: NodeSlideBudgetLedgerView;
  },
): Promise<NodeSlideBudgetLedgerView> {
  let state = args.state;
  for (let attempt = 0; attempt < MAX_STATE_RETRIES; attempt += 1) {
    try {
      return await ledger.reserve({
        budgetId: args.budgetId,
        callId: args.callId,
        model: args.model,
        estimatedInputTokens: args.estimatedInputTokens,
        requestedMaxOutputTokens: args.requestedMaxOutputTokens,
        expectedRevision: state.budget.revision,
        expectedStateDigest: state.budget.stateDigest,
      });
    } catch (error) {
      if (!isStaleStateError(error) || attempt + 1 >= MAX_STATE_RETRIES) throw error;
      const replay = await ledger.replay({ budgetId: args.budgetId, callId: args.callId });
      if (!replay) throw error;
      if (replay.call) return replay;
      state = replay;
    }
  }
  throw new Error('nodeslide_budget_reservation_unreachable');
}

async function terminalWithStateRetry(
  ledger: NodeSlideBudgetLedgerClient,
  operation: 'settle' | 'captureTimeout' | 'release',
  args: Record<string, unknown> & { budgetId: string; callId: string },
  initial: NodeSlideBudgetLedgerView,
): Promise<NodeSlideBudgetLedgerView> {
  let state = initial;
  for (let attempt = 0; attempt < MAX_STATE_RETRIES; attempt += 1) {
    try {
      const expected = {
        ...args,
        expectedRevision: state.budget.revision,
        expectedStateDigest: state.budget.stateDigest,
      };
      if (operation === 'settle') {
        return await ledger.settle(
          expected as Parameters<NodeSlideBudgetLedgerClient['settle']>[0],
        );
      }
      if (operation === 'captureTimeout') {
        return await ledger.captureTimeout(
          expected as Parameters<NodeSlideBudgetLedgerClient['captureTimeout']>[0],
        );
      }
      return await ledger.release(
        expected as Parameters<NodeSlideBudgetLedgerClient['release']>[0],
      );
    } catch (error) {
      if (!isStaleStateError(error) || attempt + 1 >= MAX_STATE_RETRIES) throw error;
      const replay = await ledger.replay({ budgetId: args.budgetId, callId: args.callId });
      if (!replay) throw error;
      state = replay;
    }
  }
  throw new Error('nodeslide_budget_transition_unreachable');
}

async function recoverPriorCall(
  prior: NodeSlideBudgetLedgerView,
  ledger: NodeSlideBudgetLedgerClient,
  accounting: { budgetId: string; callId: string },
): Promise<NodeSlideBudgetedProviderResult> {
  if (prior.call?.status === 'reserved') {
    return captureAmbiguous(
      ledger,
      accounting,
      prior,
      'A prior dispatch may have started; its full reservation remains unreconciled.',
    );
  }
  if (prior.call?.status === 'unreconciled') {
    return {
      ok: false,
      reason: 'The prior provider call remains unreconciled and will not be dispatched again.',
      code: 'ambiguous_provider_call',
      accounting: { ...accounting, disposition: 'unreconciled', ledger: prior },
    };
  }
  return replayedFailure(
    accounting,
    prior,
    'The provider call was already accounted for; replay its durable job result.',
  );
}

async function captureAmbiguous(
  ledger: NodeSlideBudgetLedgerClient,
  accounting: { budgetId: string; callId: string },
  state: NodeSlideBudgetLedgerView,
  reason: string,
  providerResult?: NodeSlideProviderResult,
): Promise<NodeSlideBudgetedProviderResult> {
  try {
    const captured = await terminalWithStateRetry(
      ledger,
      'captureTimeout',
      { budgetId: accounting.budgetId, callId: accounting.callId },
      state,
    );
    return {
      ok: false,
      reason,
      code: 'ambiguous_provider_call',
      accounting: { ...accounting, disposition: 'unreconciled', ledger: captured },
      ...(providerResult?.telemetry ? { telemetry: providerResult.telemetry } : {}),
    };
  } catch {
    return accountingFailure(
      accounting,
      'The provider call may be billable and its durable accounting could not be reconciled.',
      state,
    );
  }
}

async function releaseWithoutDispatch(
  ledger: NodeSlideBudgetLedgerClient,
  accounting: { budgetId: string; callId: string },
  state: NodeSlideBudgetLedgerView,
  reason: string,
  providerResult?: NodeSlideProviderResult,
): Promise<NodeSlideBudgetedProviderResult> {
  try {
    const released = await terminalWithStateRetry(
      ledger,
      'release',
      { budgetId: accounting.budgetId, callId: accounting.callId },
      state,
    );
    return providerResult
      ? {
          ...providerResult,
          accounting: { ...accounting, disposition: 'released', ledger: released },
        }
      : {
          ok: false,
          reason,
          code: 'budget_denied',
          accounting: { ...accounting, disposition: 'released', ledger: released },
        };
  } catch {
    return accountingFailure(
      accounting,
      'The undispatched provider reservation could not be released.',
      state,
    );
  }
}

function replayedFailure(
  accounting: { budgetId: string; callId: string },
  ledger: NodeSlideBudgetLedgerView,
  reason: string,
): NodeSlideBudgetedProviderResult {
  return {
    ok: false,
    reason,
    code: 'idempotent_replay',
    accounting: { ...accounting, disposition: 'replayed', ledger },
  };
}

function budgetDenied(
  accounting: { budgetId: string; callId: string },
  reason: string,
): NodeSlideBudgetedProviderResult {
  return {
    ok: false,
    reason,
    code: 'budget_denied',
    accounting: { ...accounting, disposition: 'denied' },
  };
}

function accountingFailure(
  accounting: { budgetId: string; callId: string },
  reason: string,
  ledger?: NodeSlideBudgetLedgerView,
): NodeSlideBudgetedProviderResult {
  return {
    ok: false,
    reason,
    code: 'accounting_failed',
    accounting: { ...accounting, disposition: 'accounting_error', ...(ledger ? { ledger } : {}) },
  };
}

function isStaleStateError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 'stale_budget_state' ||
    (typeof candidate.message === 'string' && candidate.message.includes('stale_budget_state'))
  );
}

function assertStableKey(field: string, value: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
    throw new Error(`Invalid NodeSlide budgeted provider ${field}.`);
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}
