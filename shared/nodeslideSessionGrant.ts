/**
 * Server-neutral authority contract for one NodeSlide Turbo session.
 *
 * The evaluator is deliberately pure: callers persist usage, leases,
 * revocation, and cancellation state, then pass one snapshot per decision.
 */

export const NODESLIDE_SESSION_GRANT_VERSION = 'nodeslide.session-grant/v1' as const;

export const NODESLIDE_SESSION_GRANT_SCOPES = ['deck:read', 'deck:write'] as const;
export type NodeSlideSessionGrantScope = (typeof NODESLIDE_SESSION_GRANT_SCOPES)[number];

export const NODESLIDE_SESSION_GRANT_ACTIONS = [
  'deck_read',
  'deck_write',
  'model_inference',
  'web_access',
  'tool_call',
  'memory_read',
  'memory_write',
  'auto_commit',
  'publication',
  'share',
  'export',
  'delete',
  'external_sync',
] as const;

export type NodeSlideSessionGrantAction = (typeof NODESLIDE_SESSION_GRANT_ACTIONS)[number];

export const NODESLIDE_SESSION_GRANT_DEFAULT_EXCLUSIONS = [
  'publication',
  'share',
  'export',
  'delete',
  'external_sync',
] as const satisfies readonly NodeSlideSessionGrantAction[];

export interface NodeSlideSessionGrantPermissions {
  readonly web: boolean;
  readonly tools: {
    readonly allowed: boolean;
    /** Empty means no tools, never an implicit wildcard. */
    readonly toolIds: readonly string[];
  };
  readonly memory: {
    readonly read: boolean;
    readonly write: boolean;
  };
}

export interface NodeSlideSessionGrantLimits {
  readonly enforcement: 'hard';
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxCostMicroUsd: number;
  readonly maxToolCalls: number;
  readonly maxDurationMs: number;
}

export interface NodeSlideSessionGrant {
  readonly version: typeof NODESLIDE_SESSION_GRANT_VERSION;
  readonly grantId: string;
  readonly sessionId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly scopes: readonly NodeSlideSessionGrantScope[];
  /** A grant is always bound to explicit deck ids. Empty means no decks. */
  readonly allowedDeckIds: readonly string[];
  /** Empty provider/model allowlists deny model inference. */
  readonly allowedProviders: readonly string[];
  readonly allowedModels: readonly string[];
  readonly permissions: NodeSlideSessionGrantPermissions;
  readonly limits: NodeSlideSessionGrantLimits;
  readonly maxUses: number;
  readonly maxConcurrency: number;
  readonly autoCommit: {
    readonly allowed: boolean;
    readonly requireCandidateValidation: true;
    readonly requireDeckCiPass: true;
  };
  /** Baseline irreversible actions remain excluded even if omitted here. */
  readonly excludedActions: readonly NodeSlideSessionGrantAction[];
}

export interface NodeSlideSessionGrantInput
  extends Omit<NodeSlideSessionGrant, 'version' | 'limits' | 'autoCommit' | 'excludedActions'> {
  readonly limits: Omit<NodeSlideSessionGrantLimits, 'enforcement'>;
  readonly allowAutoCommit?: boolean;
  readonly additionalExcludedActions?: readonly NodeSlideSessionGrantAction[];
}

export interface NodeSlideSessionGrantUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicroUsd: number;
  readonly toolCalls: number;
  readonly durationMs: number;
}

export interface NodeSlideSessionGrantState {
  /** Total distinct uses admitted over the lifetime of this grant. */
  readonly useCount: number;
  /** IDs currently holding a concurrency slot. */
  readonly activeUseIds: readonly string[];
  readonly usage: NodeSlideSessionGrantUsage;
  readonly revokedAt?: number;
  readonly cancelledAt?: number;
}

export interface NodeSlideSessionGrantRequest {
  readonly sessionId: string;
  readonly deckId: string;
  readonly useId: string;
  readonly action: NodeSlideSessionGrantAction;
  /** Caller-supplied server time keeps evaluation deterministic and testable. */
  readonly evaluatedAt: number;
  readonly provider?: string;
  readonly model?: string;
  readonly toolId?: string;
  readonly candidateValidationPassed?: boolean;
  readonly deckCiPassed?: boolean;
  /** A conservative reservation for the action being authorized. */
  readonly anticipatedUsage?: Partial<NodeSlideSessionGrantUsage>;
}

export interface NodeSlideSessionGrantRemainingBudget {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicroUsd: number;
  readonly toolCalls: number;
  readonly durationMs: number;
  readonly uses: number;
  readonly concurrency: number;
  readonly expiresInMs: number;
}

export type NodeSlideSessionGrantReasonCode =
  | 'allowed'
  | 'invalid_contract'
  | 'invalid_accounting'
  | 'session_mismatch'
  | 'deck_not_allowed'
  | 'scope_denied'
  | 'provider_not_allowed'
  | 'model_not_allowed'
  | 'web_denied'
  | 'tool_denied'
  | 'memory_read_denied'
  | 'memory_write_denied'
  | 'action_excluded'
  | 'grant_expired'
  | 'grant_revoked'
  | 'session_cancelled'
  | 'max_uses_reached'
  | 'max_concurrency_reached'
  | 'input_token_budget_exceeded'
  | 'output_token_budget_exceeded'
  | 'cost_budget_exceeded'
  | 'tool_budget_exceeded'
  | 'time_budget_exceeded'
  | 'auto_commit_denied'
  | 'candidate_validation_required'
  | 'deck_ci_pass_required';

export type NodeSlideSessionGrantDecision =
  | {
      readonly allowed: true;
      readonly reasonCode: 'allowed';
      readonly continuation: boolean;
      readonly remainingBudget: NodeSlideSessionGrantRemainingBudget;
    }
  | {
      readonly allowed: false;
      readonly reasonCode: Exclude<NodeSlideSessionGrantReasonCode, 'allowed'>;
      readonly continuation: boolean;
      readonly remainingBudget: NodeSlideSessionGrantRemainingBudget;
    };

export class NodeSlideSessionGrantValidationError extends Error {
  readonly code = 'invalid_session_grant' as const;

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`Invalid NodeSlide session grant ${field}: ${message}`);
    this.name = 'NodeSlideSessionGrantValidationError';
  }
}

/** Creates a canonical grant with hard limits and fail-closed exclusions. */
export function createNodeSlideSessionGrant(
  input: NodeSlideSessionGrantInput,
): NodeSlideSessionGrant {
  const issuedAt = finiteTimestamp('issuedAt', input.issuedAt);
  const expiresAt = finiteTimestamp('expiresAt', input.expiresAt);
  if (expiresAt <= issuedAt) {
    throw new NodeSlideSessionGrantValidationError('expiresAt', 'must be after issuedAt');
  }

  return {
    version: NODESLIDE_SESSION_GRANT_VERSION,
    grantId: descriptor('grantId', input.grantId),
    sessionId: descriptor('sessionId', input.sessionId),
    issuedAt,
    expiresAt,
    scopes: uniqueKnown(input.scopes, NODESLIDE_SESSION_GRANT_SCOPES, 'scopes'),
    allowedDeckIds: uniqueDescriptors('allowedDeckIds', input.allowedDeckIds),
    allowedProviders: uniqueDescriptors('allowedProviders', input.allowedProviders),
    allowedModels: uniqueDescriptors('allowedModels', input.allowedModels),
    permissions: {
      web: input.permissions.web,
      tools: {
        allowed: input.permissions.tools.allowed,
        toolIds: uniqueDescriptors('permissions.tools.toolIds', input.permissions.tools.toolIds),
      },
      memory: {
        read: input.permissions.memory.read,
        write: input.permissions.memory.write,
      },
    },
    limits: {
      enforcement: 'hard',
      maxInputTokens: nonNegativeInteger('limits.maxInputTokens', input.limits.maxInputTokens),
      maxOutputTokens: nonNegativeInteger('limits.maxOutputTokens', input.limits.maxOutputTokens),
      maxCostMicroUsd: nonNegativeInteger('limits.maxCostMicroUsd', input.limits.maxCostMicroUsd),
      maxToolCalls: nonNegativeInteger('limits.maxToolCalls', input.limits.maxToolCalls),
      maxDurationMs: nonNegativeInteger('limits.maxDurationMs', input.limits.maxDurationMs),
    },
    maxUses: positiveInteger('maxUses', input.maxUses),
    maxConcurrency: positiveInteger('maxConcurrency', input.maxConcurrency),
    autoCommit: {
      allowed: input.allowAutoCommit ?? false,
      requireCandidateValidation: true,
      requireDeckCiPass: true,
    },
    excludedActions: uniqueKnown(
      [...NODESLIDE_SESSION_GRANT_DEFAULT_EXCLUSIONS, ...(input.additionalExcludedActions ?? [])],
      NODESLIDE_SESSION_GRANT_ACTIONS,
      'excludedActions',
    ),
  };
}

/**
 * Evaluates one authorization request without mutating the supplied grant or
 * state. The persisted state update must be atomic with acting on an allow.
 */
export function evaluateNodeSlideSessionGrant(
  grant: NodeSlideSessionGrant,
  state: NodeSlideSessionGrantState,
  request: NodeSlideSessionGrantRequest,
): NodeSlideSessionGrantDecision {
  const continuation = state.activeUseIds.includes(request.useId);
  const remainingBudget = remainingNodeSlideSessionGrantBudget(grant, state, request.evaluatedAt);
  const deny = (
    reasonCode: Exclude<NodeSlideSessionGrantReasonCode, 'allowed'>,
  ): NodeSlideSessionGrantDecision => ({
    allowed: false,
    reasonCode,
    continuation,
    remainingBudget,
  });

  if (
    grant.version !== NODESLIDE_SESSION_GRANT_VERSION ||
    grant.limits.enforcement !== 'hard' ||
    !Number.isFinite(request.evaluatedAt) ||
    request.evaluatedAt < grant.issuedAt
  ) {
    return deny('invalid_contract');
  }
  if (!validState(state) || !validAnticipatedUsage(request.anticipatedUsage)) {
    return deny('invalid_accounting');
  }
  if (request.sessionId !== grant.sessionId) return deny('session_mismatch');
  if (state.revokedAt !== undefined && state.revokedAt <= request.evaluatedAt) {
    return deny('grant_revoked');
  }
  if (state.cancelledAt !== undefined && state.cancelledAt <= request.evaluatedAt) {
    return deny('session_cancelled');
  }
  if (request.evaluatedAt >= grant.expiresAt) return deny('grant_expired');
  if (!grant.allowedDeckIds.includes(request.deckId)) return deny('deck_not_allowed');

  if (!continuation && state.useCount >= grant.maxUses) return deny('max_uses_reached');
  if (!continuation && state.activeUseIds.length >= grant.maxConcurrency) {
    return deny('max_concurrency_reached');
  }

  const exclusions = new Set<NodeSlideSessionGrantAction>([
    ...NODESLIDE_SESSION_GRANT_DEFAULT_EXCLUSIONS,
    ...grant.excludedActions,
  ]);
  if (exclusions.has(request.action)) return deny('action_excluded');

  const requiredScope = scopeForAction(request.action);
  if (requiredScope && !grant.scopes.includes(requiredScope)) return deny('scope_denied');

  if (request.action === 'model_inference') {
    if (!request.provider || !grant.allowedProviders.includes(request.provider)) {
      return deny('provider_not_allowed');
    }
    if (!request.model || !grant.allowedModels.includes(request.model)) {
      return deny('model_not_allowed');
    }
  }
  if (request.action === 'web_access' && !grant.permissions.web) return deny('web_denied');
  if (
    request.action === 'tool_call' &&
    (!grant.permissions.tools.allowed ||
      !request.toolId ||
      !grant.permissions.tools.toolIds.includes(request.toolId))
  ) {
    return deny('tool_denied');
  }
  if (request.action === 'memory_read' && !grant.permissions.memory.read) {
    return deny('memory_read_denied');
  }
  if (request.action === 'memory_write' && !grant.permissions.memory.write) {
    return deny('memory_write_denied');
  }
  if (request.action === 'auto_commit') {
    if (!grant.autoCommit.allowed) return deny('auto_commit_denied');
    if (request.candidateValidationPassed !== true) {
      return deny('candidate_validation_required');
    }
    if (request.deckCiPassed !== true) return deny('deck_ci_pass_required');
  }

  const anticipated = normalizedUsage(request.anticipatedUsage);
  if (anticipated.inputTokens > remainingBudget.inputTokens) {
    return deny('input_token_budget_exceeded');
  }
  if (anticipated.outputTokens > remainingBudget.outputTokens) {
    return deny('output_token_budget_exceeded');
  }
  if (anticipated.costMicroUsd > remainingBudget.costMicroUsd) {
    return deny('cost_budget_exceeded');
  }
  if (anticipated.toolCalls > remainingBudget.toolCalls) {
    return deny('tool_budget_exceeded');
  }
  if (anticipated.durationMs > remainingBudget.durationMs) {
    return deny('time_budget_exceeded');
  }

  return { allowed: true, reasonCode: 'allowed', continuation, remainingBudget };
}

export function remainingNodeSlideSessionGrantBudget(
  grant: NodeSlideSessionGrant,
  state: NodeSlideSessionGrantState,
  evaluatedAt: number,
): NodeSlideSessionGrantRemainingBudget {
  const observedDuration = Math.max(
    safeCounter(state.usage.durationMs),
    Number.isFinite(evaluatedAt) ? Math.max(0, evaluatedAt - grant.issuedAt) : 0,
  );
  return {
    inputTokens: remaining(grant.limits.maxInputTokens, state.usage.inputTokens),
    outputTokens: remaining(grant.limits.maxOutputTokens, state.usage.outputTokens),
    costMicroUsd: remaining(grant.limits.maxCostMicroUsd, state.usage.costMicroUsd),
    toolCalls: remaining(grant.limits.maxToolCalls, state.usage.toolCalls),
    durationMs: remaining(grant.limits.maxDurationMs, observedDuration),
    uses: remaining(grant.maxUses, state.useCount),
    concurrency: remaining(grant.maxConcurrency, state.activeUseIds.length),
    expiresInMs: Number.isFinite(evaluatedAt) ? Math.max(0, grant.expiresAt - evaluatedAt) : 0,
  };
}

function scopeForAction(
  action: NodeSlideSessionGrantAction,
): NodeSlideSessionGrantScope | undefined {
  if (action === 'deck_read') return 'deck:read';
  if (action === 'deck_write' || action === 'auto_commit') return 'deck:write';
  return undefined;
}

function validState(state: NodeSlideSessionGrantState): boolean {
  return (
    isNonNegativeInteger(state.useCount) &&
    state.activeUseIds.every((id) => typeof id === 'string' && id.length > 0) &&
    new Set(state.activeUseIds).size === state.activeUseIds.length &&
    isValidUsage(state.usage) &&
    validOptionalTimestamp(state.revokedAt) &&
    validOptionalTimestamp(state.cancelledAt)
  );
}

function validAnticipatedUsage(usage: Partial<NodeSlideSessionGrantUsage> | undefined): boolean {
  if (usage === undefined) return true;
  return Object.values(usage).every(isNonNegativeInteger);
}

function isValidUsage(usage: NodeSlideSessionGrantUsage): boolean {
  return Object.values(usage).every(isNonNegativeInteger);
}

function validOptionalTimestamp(value: number | undefined): boolean {
  return value === undefined || Number.isFinite(value);
}

function normalizedUsage(
  usage: Partial<NodeSlideSessionGrantUsage> | undefined,
): NodeSlideSessionGrantUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costMicroUsd: usage?.costMicroUsd ?? 0,
    toolCalls: usage?.toolCalls ?? 0,
    durationMs: usage?.durationMs ?? 0,
  };
}

function remaining(limit: number, used: number): number {
  return Math.max(0, safeCounter(limit) - safeCounter(used));
}

function safeCounter(value: number): number {
  return isNonNegativeInteger(value) ? value : 0;
}

function uniqueDescriptors(field: string, values: readonly string[]): string[] {
  return [...new Set(values.map((value) => descriptor(field, value)))].sort();
}

function uniqueKnown<T extends string>(
  values: readonly string[],
  knownValues: readonly T[],
  field: string,
): T[] {
  const known = new Set<string>(knownValues);
  const unique = [...new Set(values)];
  for (const value of unique) {
    if (!known.has(value)) {
      throw new NodeSlideSessionGrantValidationError(
        field,
        `unknown value ${JSON.stringify(value)}`,
      );
    }
  }
  return unique.sort() as T[];
}

function descriptor(field: string, value: string): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > 256) {
    throw new NodeSlideSessionGrantValidationError(field, 'expected 1 through 256 characters');
  }
  return clean;
}

function finiteTimestamp(field: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new NodeSlideSessionGrantValidationError(field, 'expected a finite timestamp');
  }
  return value;
}

function nonNegativeInteger(field: string, value: number): number {
  if (!isNonNegativeInteger(value)) {
    throw new NodeSlideSessionGrantValidationError(field, 'expected a non-negative safe integer');
  }
  return value;
}

function positiveInteger(field: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new NodeSlideSessionGrantValidationError(field, 'expected a positive safe integer');
  }
  return value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
