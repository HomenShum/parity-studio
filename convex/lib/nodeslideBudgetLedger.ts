import {
  NODESLIDE_MODEL_PRICING_VERSION,
  NODESLIDE_RUN_BUDGET_STATE_VERSION,
  type NodeSlideRunBudget,
  type NodeSlideRunBudgetState,
  type NodeSlideScoredModelMetadata,
  normalizeNodeSlideRunBudget,
} from '../../shared/nodeslideRunBudget';
import { nodeslideContentDigest } from './nodeslideIds';
import { nodeSlideRunBudgetStateDigest } from './nodeslideRunBudget';

export const NODESLIDE_BUDGET_LEDGER_VERSION = 'nodeslide.budget-ledger/v1' as const;
export const NODESLIDE_BILLABLE_CALL_VERSION = 'nodeslide.billable-call/v1' as const;
export const NODESLIDE_BUDGET_EVENT_VERSION = 'nodeslide.budget-event/v1' as const;

const SHA_256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const LEDGER_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const MAX_RECEIPT_LEDGER_ENTRIES = 1_024;

export type NodeSlideBudgetLedgerStatus = 'open' | 'finalized';
export type NodeSlideBillableCallStatus = 'reserved' | 'unreconciled' | 'settled' | 'released';
export type NodeSlideBudgetEventKind =
  | 'created'
  | 'reserved'
  | 'settled'
  | 'timeout_captured'
  | 'released'
  | 'finalized';

export type NodeSlideBudgetLedgerErrorCode =
  | 'invalid_budget_ledger'
  | 'stale_budget_state'
  | 'budget_finalized'
  | 'budget_not_found'
  | 'budget_idempotency_conflict'
  | 'call_not_found'
  | 'call_idempotency_conflict'
  | 'invalid_call_transition'
  | 'pricing_unknown'
  | 'pricing_changed'
  | 'quote_overflow'
  | 'budget_exceeded'
  | 'invalid_settlement'
  | 'receipt_rejected';

export class NodeSlideBudgetLedgerError extends Error {
  constructor(
    readonly code: NodeSlideBudgetLedgerErrorCode,
    message: string,
  ) {
    super(`NodeSlide budget ledger ${code}: ${message}`);
    this.name = 'NodeSlideBudgetLedgerError';
  }
}

export interface NodeSlideBudgetAccumulatedUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly elapsedMs: number;
  readonly iterations: number;
  readonly toolCalls: number;
}

export interface NodeSlideBudgetLedgerStateCore {
  readonly version: typeof NODESLIDE_BUDGET_LEDGER_VERSION;
  readonly id: string;
  readonly status: NodeSlideBudgetLedgerStatus;
  readonly budget: NodeSlideRunBudget;
  readonly actualMicroUsd: number;
  readonly reservedMicroUsd: number;
  readonly unreconciledMicroUsd: number;
  readonly accumulated: NodeSlideBudgetAccumulatedUsage;
  readonly receiptDigests: Readonly<Record<string, string>>;
  readonly accountingStateDigest: string;
  readonly revision: number;
  readonly eventSequence: number;
  readonly lastEventDigest: string;
  readonly finalizeDigest?: string;
}

export interface NodeSlideBudgetLedgerState extends NodeSlideBudgetLedgerStateCore {
  readonly stateDigest: string;
}

export interface NodeSlideBudgetCostLedger {
  readonly capMicroUsd: number;
  readonly actualMicroUsd: number;
  readonly reservedMicroUsd: number;
  readonly unreconciledMicroUsd: number;
}

export interface NodeSlideBudgetCostDelta {
  readonly actualMicroUsd: number;
  readonly reservedMicroUsd: number;
  readonly unreconciledMicroUsd: number;
}

export interface NodeSlideBudgetEventDigestInput {
  readonly version: typeof NODESLIDE_BUDGET_EVENT_VERSION;
  readonly budgetId: string;
  readonly callId?: string;
  readonly sequence: number;
  readonly revision: number;
  readonly kind: NodeSlideBudgetEventKind;
  readonly operationDigest: string;
  readonly status: NodeSlideBudgetLedgerStatus;
  readonly actualDeltaMicroUsd: number;
  readonly reservedDeltaMicroUsd: number;
  readonly unreconciledDeltaMicroUsd: number;
  readonly actualMicroUsd: number;
  readonly reservedMicroUsd: number;
  readonly unreconciledMicroUsd: number;
  readonly capMicroUsd: number;
  readonly accountingStateDigest: string;
  readonly budgetStateCoreDigest: string;
  readonly previousEventDigest?: string;
}

export function assertNodeSlideLedgerKey(field: string, value: string): void {
  if (typeof value !== 'string' || !LEDGER_KEY_PATTERN.test(value)) {
    throw new NodeSlideBudgetLedgerError(
      'invalid_budget_ledger',
      `${field} must be a canonical key of 1 through 200 characters`,
    );
  }
}

export function assertNodeSlideDigest(field: string, value: string): void {
  if (typeof value !== 'string' || !SHA_256_DIGEST_PATTERN.test(value)) {
    throw new NodeSlideBudgetLedgerError(
      'invalid_budget_ledger',
      `${field} must be a canonical SHA-256 digest`,
    );
  }
}

export function assertNodeSlideNonnegativeInteger(field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NodeSlideBudgetLedgerError(
      'invalid_budget_ledger',
      `${field} must be a non-negative safe integer`,
    );
  }
}

export function assertNodeSlideExpectedBudgetState(
  state: NodeSlideBudgetLedgerState,
  expectedRevision: number,
  expectedStateDigest: string,
): void {
  assertNodeSlideNonnegativeInteger('expectedRevision', expectedRevision);
  assertNodeSlideDigest('expectedStateDigest', expectedStateDigest);
  if (state.revision !== expectedRevision || state.stateDigest !== expectedStateDigest) {
    throw new NodeSlideBudgetLedgerError(
      'stale_budget_state',
      `expected revision ${expectedRevision} and its exact state digest`,
    );
  }
}

export function assertNodeSlideBudgetLedgerState(state: NodeSlideBudgetLedgerState): void {
  if (state.version !== NODESLIDE_BUDGET_LEDGER_VERSION) {
    invalidLedger('version is unsupported');
  }
  assertNodeSlideLedgerKey('id', state.id);
  if (state.status !== 'open' && state.status !== 'finalized') {
    invalidLedger('status is invalid');
  }

  let normalizedBudget: NodeSlideRunBudget;
  try {
    normalizedBudget = normalizeNodeSlideRunBudget(state.budget);
  } catch {
    invalidLedger('budget is invalid');
  }
  if (canonicalBudget(normalizedBudget) !== canonicalBudget(state.budget)) {
    invalidLedger('budget is not canonical');
  }

  assertNodeSlideCostLedgerInvariant(costLedgerFromState(state));
  for (const [field, value] of Object.entries(state.accumulated)) {
    assertNodeSlideNonnegativeInteger(`accumulated.${field}`, value);
  }
  if (
    state.accumulated.inputTokens > state.budget.maxInputTokens ||
    state.accumulated.outputTokens > state.budget.maxOutputTokens ||
    state.accumulated.elapsedMs > state.budget.maxDurationMs ||
    state.accumulated.iterations > state.budget.maxIterations ||
    state.accumulated.toolCalls > state.budget.maxToolCalls
  ) {
    invalidLedger('actual usage exceeds a hard run-budget limit');
  }

  assertNodeSlideNonnegativeInteger('revision', state.revision);
  assertNodeSlideNonnegativeInteger('eventSequence', state.eventSequence);
  if (state.revision !== state.eventSequence) {
    invalidLedger('revision and event sequence diverged');
  }
  assertNodeSlideDigest('lastEventDigest', state.lastEventDigest);
  assertNodeSlideDigest('accountingStateDigest', state.accountingStateDigest);
  assertNodeSlideDigest('stateDigest', state.stateDigest);
  if (state.status === 'finalized') {
    if (!state.finalizeDigest) invalidLedger('finalized state is missing its digest');
    assertNodeSlideDigest('finalizeDigest', state.finalizeDigest);
  } else if (state.finalizeDigest !== undefined) {
    invalidLedger('open state contains a finalization digest');
  }

  const receiptEntries = Object.entries(state.receiptDigests);
  if (receiptEntries.length > MAX_RECEIPT_LEDGER_ENTRIES) {
    invalidLedger('receipt ledger exceeds its bounded capacity');
  }
  for (const [key, digest] of receiptEntries) {
    assertNodeSlideLedgerKey('receipt idempotency key', key);
    assertNodeSlideDigest('receipt digest', digest);
  }

  const accountingState = nodeSlideAccountingStateFromLedger(state);
  if (nodeSlideRunBudgetStateDigest(accountingState) !== state.accountingStateDigest) {
    invalidLedger('accounting state digest mismatch');
  }
  if (nodeSlideBudgetStateDigest(state) !== state.stateDigest) {
    invalidLedger('durable state digest mismatch');
  }
}

export function nodeSlideAccountingStateFromLedger(
  state: Pick<
    NodeSlideBudgetLedgerStateCore,
    'budget' | 'actualMicroUsd' | 'accumulated' | 'receiptDigests' | 'accountingStateDigest'
  >,
): NodeSlideRunBudgetState {
  return {
    version: NODESLIDE_RUN_BUDGET_STATE_VERSION,
    budget: state.budget,
    accumulated: {
      costMicroUsd: state.actualMicroUsd,
      inputTokens: state.accumulated.inputTokens,
      outputTokens: state.accumulated.outputTokens,
      elapsedMs: state.accumulated.elapsedMs,
      iterations: state.accumulated.iterations,
      toolCalls: state.accumulated.toolCalls,
    },
    receiptDigests: state.receiptDigests,
    digest: state.accountingStateDigest,
  };
}

export function nodeSlidePreflightStateFromLedger(
  state: NodeSlideBudgetLedgerState,
): NodeSlideRunBudgetState {
  assertNodeSlideBudgetLedgerState(state);
  const accountingState = nodeSlideAccountingStateFromLedger(state);
  const exposedCost = safeTotal([
    state.actualMicroUsd,
    state.reservedMicroUsd,
    state.unreconciledMicroUsd,
  ]);
  const withoutDigest = {
    ...accountingState,
    accumulated: { ...accountingState.accumulated, costMicroUsd: exposedCost },
  };
  return { ...withoutDigest, digest: nodeSlideRunBudgetStateDigest(withoutDigest) };
}

export function assertNodeSlideCostLedgerInvariant(ledger: NodeSlideBudgetCostLedger): void {
  assertNodeSlideNonnegativeInteger('capMicroUsd', ledger.capMicroUsd);
  assertNodeSlideNonnegativeInteger('actualMicroUsd', ledger.actualMicroUsd);
  assertNodeSlideNonnegativeInteger('reservedMicroUsd', ledger.reservedMicroUsd);
  assertNodeSlideNonnegativeInteger('unreconciledMicroUsd', ledger.unreconciledMicroUsd);
  const exposure =
    BigInt(ledger.actualMicroUsd) +
    BigInt(ledger.reservedMicroUsd) +
    BigInt(ledger.unreconciledMicroUsd);
  if (exposure > BigInt(ledger.capMicroUsd)) {
    throw new NodeSlideBudgetLedgerError(
      'budget_exceeded',
      'actual + reserved + unreconciled micro-USD exceeds the hard cap',
    );
  }
}

export function reserveNodeSlideBudgetCost(
  ledger: NodeSlideBudgetCostLedger,
  quoteMicroUsd: number,
): NodeSlideBudgetCostLedger {
  if (!Number.isSafeInteger(quoteMicroUsd) || quoteMicroUsd < 0) {
    throw new NodeSlideBudgetLedgerError(
      'quote_overflow',
      'server quote is not a non-negative safe integer micro-USD amount',
    );
  }
  return applyNodeSlideBudgetCostDelta(ledger, {
    actualMicroUsd: 0,
    reservedMicroUsd: quoteMicroUsd,
    unreconciledMicroUsd: 0,
  });
}

export function settleNodeSlideBudgetCost(
  ledger: NodeSlideBudgetCostLedger,
  args: {
    source: 'reserved' | 'unreconciled';
    quoteMicroUsd: number;
    actualMicroUsd: number;
  },
): NodeSlideBudgetCostLedger {
  assertNodeSlideNonnegativeInteger('quoteMicroUsd', args.quoteMicroUsd);
  assertNodeSlideNonnegativeInteger('settled actualMicroUsd', args.actualMicroUsd);
  if (args.actualMicroUsd > args.quoteMicroUsd) {
    throw new NodeSlideBudgetLedgerError(
      'invalid_settlement',
      'actual cost exceeds the server-authorized reservation',
    );
  }
  return applyNodeSlideBudgetCostDelta(ledger, {
    actualMicroUsd: args.actualMicroUsd,
    reservedMicroUsd: args.source === 'reserved' ? -args.quoteMicroUsd : 0,
    unreconciledMicroUsd: args.source === 'unreconciled' ? -args.quoteMicroUsd : 0,
  });
}

export function captureNodeSlideBudgetTimeoutCost(
  ledger: NodeSlideBudgetCostLedger,
  quoteMicroUsd: number,
): NodeSlideBudgetCostLedger {
  assertNodeSlideNonnegativeInteger('quoteMicroUsd', quoteMicroUsd);
  return applyNodeSlideBudgetCostDelta(ledger, {
    actualMicroUsd: 0,
    reservedMicroUsd: -quoteMicroUsd,
    unreconciledMicroUsd: quoteMicroUsd,
  });
}

export function releaseNodeSlideBudgetCost(
  ledger: NodeSlideBudgetCostLedger,
  source: 'reserved' | 'unreconciled',
  quoteMicroUsd: number,
): NodeSlideBudgetCostLedger {
  assertNodeSlideNonnegativeInteger('quoteMicroUsd', quoteMicroUsd);
  return applyNodeSlideBudgetCostDelta(ledger, {
    actualMicroUsd: 0,
    reservedMicroUsd: source === 'reserved' ? -quoteMicroUsd : 0,
    unreconciledMicroUsd: source === 'unreconciled' ? -quoteMicroUsd : 0,
  });
}

export function applyNodeSlideBudgetCostDelta(
  ledger: NodeSlideBudgetCostLedger,
  delta: NodeSlideBudgetCostDelta,
): NodeSlideBudgetCostLedger {
  assertNodeSlideCostLedgerInvariant(ledger);
  for (const [field, value] of Object.entries(delta)) {
    if (!Number.isSafeInteger(value)) {
      throw new NodeSlideBudgetLedgerError(
        'quote_overflow',
        `${field} delta is outside safe integer micro-USD accounting`,
      );
    }
  }
  const next = {
    capMicroUsd: ledger.capMicroUsd,
    actualMicroUsd: addSignedMicroUsd(ledger.actualMicroUsd, delta.actualMicroUsd),
    reservedMicroUsd: addSignedMicroUsd(ledger.reservedMicroUsd, delta.reservedMicroUsd),
    unreconciledMicroUsd: addSignedMicroUsd(
      ledger.unreconciledMicroUsd,
      delta.unreconciledMicroUsd,
    ),
  };
  assertNodeSlideCostLedgerInvariant(next);
  return next;
}

export function nodeSlideBudgetStateCoreDigest(state: NodeSlideBudgetLedgerStateCore): string {
  return nodeslideContentDigest(
    JSON.stringify([
      'nodeslide.budget-ledger-core-digest/v1',
      state.version,
      state.id,
      state.status,
      budgetTuple(state.budget),
      state.actualMicroUsd,
      state.reservedMicroUsd,
      state.unreconciledMicroUsd,
      accumulatedTuple(state.accumulated),
      state.accountingStateDigest,
      state.revision,
      state.eventSequence,
      state.finalizeDigest ?? null,
    ]),
  );
}

export function nodeSlideBudgetStateDigest(state: NodeSlideBudgetLedgerStateCore): string {
  return nodeslideContentDigest(
    JSON.stringify([
      'nodeslide.budget-ledger-state-digest/v1',
      nodeSlideBudgetStateCoreDigest(state),
      state.lastEventDigest,
    ]),
  );
}

export function nodeSlideBudgetEventDigest(event: NodeSlideBudgetEventDigestInput): string {
  return nodeslideContentDigest(
    JSON.stringify([
      'nodeslide.budget-event-digest/v1',
      event.version,
      event.budgetId,
      event.callId ?? null,
      event.sequence,
      event.revision,
      event.kind,
      event.operationDigest,
      event.status,
      event.actualDeltaMicroUsd,
      event.reservedDeltaMicroUsd,
      event.unreconciledDeltaMicroUsd,
      event.actualMicroUsd,
      event.reservedMicroUsd,
      event.unreconciledMicroUsd,
      event.capMicroUsd,
      event.accountingStateDigest,
      event.budgetStateCoreDigest,
      event.previousEventDigest ?? null,
    ]),
  );
}

export function nodeSlideBudgetConfigDigest(budgetId: string, budget: NodeSlideRunBudget): string {
  return operationDigest('nodeslide.budget-create-operation/v1', [budgetId, budgetTuple(budget)]);
}

export function nodeSlideBillableCallReservationDigest(args: {
  budgetId: string;
  callId: string;
  model: string;
  estimatedInputTokens: number;
  requestedMaxOutputTokens: number;
}): string {
  return operationDigest('nodeslide.billable-call-reservation/v1', [
    args.budgetId,
    args.callId,
    args.model,
    args.estimatedInputTokens,
    args.requestedMaxOutputTokens,
  ]);
}

export function nodeSlideBillableCallSettlementDigest(args: {
  budgetId: string;
  callId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  actualMicroUsd: number;
  elapsedMs: number;
  iterations: number;
  toolCalls: number;
}): string {
  return operationDigest('nodeslide.billable-call-settlement/v1', [
    args.budgetId,
    args.callId,
    args.model,
    args.inputTokens,
    args.outputTokens,
    args.actualMicroUsd,
    args.elapsedMs,
    args.iterations,
    args.toolCalls,
  ]);
}

export function nodeSlideBillableCallTimeoutDigest(budgetId: string, callId: string): string {
  return operationDigest('nodeslide.billable-call-timeout-capture/v1', [budgetId, callId]);
}

export function nodeSlideBillableCallReleaseDigest(budgetId: string, callId: string): string {
  return operationDigest('nodeslide.billable-call-release/v1', [budgetId, callId]);
}

export function nodeSlideBudgetFinalizeDigest(budgetId: string): string {
  return operationDigest('nodeslide.budget-finalize-operation/v1', [budgetId]);
}

export function nodeSlideBudgetPricingDigest(pricing: NodeSlideScoredModelMetadata): string {
  if (pricing.version !== NODESLIDE_MODEL_PRICING_VERSION) {
    throw new NodeSlideBudgetLedgerError('pricing_changed', 'pricing version is unsupported');
  }
  return operationDigest(
    'nodeslide.billable-call-pricing/v1',
    pricing.kind === 'priced'
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
      : [
          pricing.version,
          pricing.kind,
          pricing.modelId,
          pricing.inputMicroUsdPerMillionTokens,
          pricing.outputMicroUsdPerMillionTokens,
          pricing.providerMaxOutputTokens,
          pricing.source,
        ],
  );
}

export function costLedgerFromState(
  state: Pick<
    NodeSlideBudgetLedgerStateCore,
    'budget' | 'actualMicroUsd' | 'reservedMicroUsd' | 'unreconciledMicroUsd'
  >,
): NodeSlideBudgetCostLedger {
  return {
    capMicroUsd: state.budget.maxCostMicroUsd,
    actualMicroUsd: state.actualMicroUsd,
    reservedMicroUsd: state.reservedMicroUsd,
    unreconciledMicroUsd: state.unreconciledMicroUsd,
  };
}

function operationDigest(namespace: string, values: readonly unknown[]): string {
  return nodeslideContentDigest(JSON.stringify([namespace, ...values]));
}

function canonicalBudget(budget: NodeSlideRunBudget): string {
  return JSON.stringify(budgetTuple(budget));
}

function budgetTuple(budget: NodeSlideRunBudget): readonly unknown[] {
  return [
    budget.version,
    budget.enforcement,
    budget.maxCostUsd,
    budget.maxCostMicroUsd,
    budget.maxInputTokens,
    budget.maxOutputTokens,
    budget.maxDurationMs,
    budget.maxIterations,
    budget.maxToolCalls,
  ];
}

function accumulatedTuple(accumulated: NodeSlideBudgetAccumulatedUsage): readonly number[] {
  return [
    accumulated.inputTokens,
    accumulated.outputTokens,
    accumulated.elapsedMs,
    accumulated.iterations,
    accumulated.toolCalls,
  ];
}

function addSignedMicroUsd(current: number, delta: number): number {
  const result = BigInt(current) + BigInt(delta);
  if (result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new NodeSlideBudgetLedgerError(
      'quote_overflow',
      'cost transition is outside safe integer micro-USD accounting',
    );
  }
  return Number(result);
}

function safeTotal(values: readonly number[]): number {
  const result = values.reduce((total, value) => total + BigInt(value), 0n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new NodeSlideBudgetLedgerError(
      'quote_overflow',
      'cost exposure is outside safe integer micro-USD accounting',
    );
  }
  return Number(result);
}

function invalidLedger(message: string): never {
  throw new NodeSlideBudgetLedgerError('invalid_budget_ledger', message);
}
