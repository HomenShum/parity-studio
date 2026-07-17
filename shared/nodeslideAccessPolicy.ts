import type { NodeSlideAgentRole } from './nodeslide';

/** Pure, provider-neutral authority contract for delegated NodeSlide work. */
export const NODESLIDE_ACCESS_POLICY_VERSION = 'nodeslide.access-policy/v1' as const;
export const NODESLIDE_MEMORY_SCOPE_VERSION = 'nodeslide.memory-scope/v1' as const;

export const NODESLIDE_ACCESS_POLICY_ROLES = [
  'researcher',
  'analyst',
  'storyteller',
  'designer',
  'fact_checker',
  'reviewer',
  'planner',
  'executor',
  'validator',
] as const satisfies readonly NodeSlideAgentRole[];

export const NODESLIDE_ACCESS_CAPABILITIES = [
  'deck:read',
  'source:read',
  'source:refresh',
  'web:read',
  'model:invoke',
  'tool:invoke',
  'memory:read',
  'memory:write',
  'proposal:create',
  'validation:run',
  'deck:commit',
  'publication:write',
  'share:write',
  'export:write',
  'delete:write',
  'external_sync:write',
] as const;

export type NodeSlideAccessCapability = (typeof NODESLIDE_ACCESS_CAPABILITIES)[number];

/**
 * Role ceilings are deliberately incapable of committing or performing an
 * irreversible external action. Those authorities remain at an owner/runtime
 * boundary rather than being delegable to a cognitive role.
 */
export const NODESLIDE_ROLE_CAPABILITY_MATRIX = {
  researcher: [
    'deck:read',
    'source:read',
    'source:refresh',
    'web:read',
    'model:invoke',
    'tool:invoke',
    'memory:read',
    'memory:write',
  ],
  analyst: ['deck:read', 'source:read', 'model:invoke', 'tool:invoke', 'memory:read'],
  storyteller: ['deck:read', 'source:read', 'model:invoke', 'memory:read'],
  designer: ['deck:read', 'source:read', 'model:invoke', 'tool:invoke', 'memory:read'],
  fact_checker: [
    'deck:read',
    'source:read',
    'web:read',
    'model:invoke',
    'tool:invoke',
    'memory:read',
    'validation:run',
  ],
  reviewer: ['deck:read', 'source:read', 'memory:read', 'validation:run'],
  planner: [
    'deck:read',
    'source:read',
    'model:invoke',
    'tool:invoke',
    'memory:read',
    'proposal:create',
  ],
  executor: ['deck:read', 'source:read', 'tool:invoke', 'proposal:create'],
  validator: ['deck:read', 'source:read', 'tool:invoke', 'validation:run'],
} as const satisfies Record<NodeSlideAgentRole, readonly NodeSlideAccessCapability[]>;

export interface NodeSlideAccessBudget {
  readonly maxCostMicroUsd: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxDurationMs: number;
  readonly maxIterations: number;
  readonly maxToolCalls: number;
}

export interface NodeSlideAccessScopes {
  /** Every authority is bound to explicit decks. Empty never means wildcard. */
  readonly deckIds: readonly string[];
  /** Source authority additionally requires an explicit source id. */
  readonly sourceIds: readonly string[];
  readonly providerIds: readonly string[];
  readonly modelIds: readonly string[];
  readonly toolIds: readonly string[];
  /** Canonical keys created by nodeSlideMemoryScopeKey. */
  readonly memoryScopeKeys: readonly string[];
}

export interface NodeSlideAccessPolicy {
  readonly schemaVersion: typeof NODESLIDE_ACCESS_POLICY_VERSION;
  readonly role: NodeSlideAgentRole;
  readonly capabilities: readonly NodeSlideAccessCapability[];
  readonly scopes: NodeSlideAccessScopes;
  readonly budget: NodeSlideAccessBudget;
}

export type NodeSlideMemoryScope =
  | { readonly kind: 'workspace'; readonly workspaceId: string }
  | { readonly kind: 'project'; readonly workspaceId: string; readonly projectId: string }
  | {
      readonly kind: 'deck';
      readonly workspaceId: string;
      readonly projectId: string;
      readonly deckId: string;
    }
  | { readonly kind: 'deck'; readonly deckId: string }
  | { readonly kind: 'session'; readonly deckId: string; readonly sessionId: string }
  | { readonly kind: 'run'; readonly deckId: string; readonly runId: string };

export class NodeSlideAccessPolicyValidationError extends Error {
  readonly code = 'invalid_nodeslide_access_policy' as const;

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`Invalid NodeSlide access policy ${field}: ${message}`);
    this.name = 'NodeSlideAccessPolicyValidationError';
  }
}

const POLICY_KEYS = new Set(['schemaVersion', 'role', 'capabilities', 'scopes', 'budget']);
const SCOPE_KEYS = new Set([
  'deckIds',
  'sourceIds',
  'providerIds',
  'modelIds',
  'toolIds',
  'memoryScopeKeys',
]);
const BUDGET_KEYS = new Set([
  'maxCostMicroUsd',
  'maxInputTokens',
  'maxOutputTokens',
  'maxDurationMs',
  'maxIterations',
  'maxToolCalls',
]);
const CAPABILITY_SET = new Set<string>(NODESLIDE_ACCESS_CAPABILITIES);
const ROLE_SET = new Set<string>(NODESLIDE_ACCESS_POLICY_ROLES);

/**
 * Strictly validates untrusted input and returns a detached canonical policy.
 * Omitted authority and budget components normalize to empty/zero, never to a
 * wildcard or ambient default.
 */
export function normalizeNodeSlideAccessPolicy(input: unknown): NodeSlideAccessPolicy {
  const policy = record('root', input);
  rejectUnknownFields('root', policy, POLICY_KEYS);
  if (
    policy['schemaVersion'] !== undefined &&
    policy['schemaVersion'] !== NODESLIDE_ACCESS_POLICY_VERSION
  ) {
    throw invalid('schemaVersion', 'unsupported contract version');
  }

  const role = knownRole(policy['role']);
  const capabilities = knownCapabilities(
    policy['capabilities'] === undefined ? [] : policy['capabilities'],
    role,
  );
  const scopes = normalizeScopes(policy['scopes'] === undefined ? {} : policy['scopes']);
  const budget = normalizeNodeSlideAccessBudget(
    policy['budget'] === undefined ? {} : policy['budget'],
  );
  return {
    schemaVersion: NODESLIDE_ACCESS_POLICY_VERSION,
    role,
    capabilities,
    scopes,
    budget,
  };
}

/** Returns true only for a complete canonical policy, and false for every malformed value. */
export function isNodeSlideAccessPolicy(input: unknown): input is NodeSlideAccessPolicy {
  try {
    return structurallyEqual(input, normalizeNodeSlideAccessPolicy(input));
  } catch {
    return false;
  }
}

/**
 * Produces a child policy that can only lose authority. Resource lists and
 * capabilities use exact set intersection; every budget component uses min.
 */
export function narrowNodeSlideAccessPolicy(
  parentInput: unknown,
  requestedInput: unknown,
): NodeSlideAccessPolicy {
  const parent = normalizeNodeSlideAccessPolicy(parentInput);
  const requested = normalizeNodeSlideAccessPolicy(requestedInput);
  return {
    schemaVersion: NODESLIDE_ACCESS_POLICY_VERSION,
    role: requested.role,
    capabilities: intersection(parent.capabilities, requested.capabilities),
    scopes: {
      deckIds: intersection(parent.scopes.deckIds, requested.scopes.deckIds),
      sourceIds: intersection(parent.scopes.sourceIds, requested.scopes.sourceIds),
      providerIds: intersection(parent.scopes.providerIds, requested.scopes.providerIds),
      modelIds: intersection(parent.scopes.modelIds, requested.scopes.modelIds),
      toolIds: intersection(parent.scopes.toolIds, requested.scopes.toolIds),
      memoryScopeKeys: intersection(
        parent.scopes.memoryScopeKeys,
        requested.scopes.memoryScopeKeys,
      ),
    },
    budget: minNodeSlideAccessBudget(parent.budget, requested.budget),
  };
}

/** Canonicalizes a hard budget. Missing components are zero and therefore deny consumption. */
export function normalizeNodeSlideAccessBudget(input: unknown = {}): NodeSlideAccessBudget {
  const budget = record('budget', input);
  rejectUnknownFields('budget', budget, BUDGET_KEYS);
  return {
    maxCostMicroUsd: budgetInteger('budget.maxCostMicroUsd', budget['maxCostMicroUsd']),
    maxInputTokens: budgetInteger('budget.maxInputTokens', budget['maxInputTokens']),
    maxOutputTokens: budgetInteger('budget.maxOutputTokens', budget['maxOutputTokens']),
    maxDurationMs: budgetInteger('budget.maxDurationMs', budget['maxDurationMs']),
    maxIterations: budgetInteger('budget.maxIterations', budget['maxIterations']),
    maxToolCalls: budgetInteger('budget.maxToolCalls', budget['maxToolCalls']),
  };
}

/** Takes the component-wise minimum of two validated hard budgets. */
export function minNodeSlideAccessBudget(left: unknown, right: unknown): NodeSlideAccessBudget {
  const a = normalizeNodeSlideAccessBudget(left);
  const b = normalizeNodeSlideAccessBudget(right);
  return {
    maxCostMicroUsd: Math.min(a.maxCostMicroUsd, b.maxCostMicroUsd),
    maxInputTokens: Math.min(a.maxInputTokens, b.maxInputTokens),
    maxOutputTokens: Math.min(a.maxOutputTokens, b.maxOutputTokens),
    maxDurationMs: Math.min(a.maxDurationMs, b.maxDurationMs),
    maxIterations: Math.min(a.maxIterations, b.maxIterations),
    maxToolCalls: Math.min(a.maxToolCalls, b.maxToolCalls),
  };
}

/** Returns a detached, canonical copy of the maximum capabilities for one role. */
export function nodeSlideCapabilitiesForRole(roleInput: unknown): NodeSlideAccessCapability[] {
  const role = knownRole(roleInput);
  return [...NODESLIDE_ROLE_CAPABILITY_MATRIX[role]].sort();
}

/** Creates an unambiguous canonical memory partition key without embedding a bearer secret. */
export function nodeSlideMemoryScopeKey(input: unknown): string {
  const scope = record('memoryScope', input);
  const kind = scope['kind'];
  if (kind === 'workspace') {
    rejectUnknownFields('memoryScope', scope, new Set(['kind', 'workspaceId']));
    return `${NODESLIDE_MEMORY_SCOPE_VERSION}/workspace/${segment('memoryScope.workspaceId', scope['workspaceId'])}`;
  }
  if (kind === 'project') {
    rejectUnknownFields('memoryScope', scope, new Set(['kind', 'workspaceId', 'projectId']));
    return `${NODESLIDE_MEMORY_SCOPE_VERSION}/project/${segment('memoryScope.workspaceId', scope['workspaceId'])}/${segment('memoryScope.projectId', scope['projectId'])}`;
  }
  if (kind === 'deck') {
    rejectUnknownFields(
      'memoryScope',
      scope,
      new Set(['kind', 'workspaceId', 'projectId', 'deckId']),
    );
    const hasWorkspaceId = Object.prototype.hasOwnProperty.call(scope, 'workspaceId');
    const hasProjectId = Object.prototype.hasOwnProperty.call(scope, 'projectId');
    if (hasWorkspaceId || hasProjectId) {
      return `${NODESLIDE_MEMORY_SCOPE_VERSION}/deck/${segment('memoryScope.workspaceId', scope['workspaceId'])}/${segment('memoryScope.projectId', scope['projectId'])}/${segment('memoryScope.deckId', scope['deckId'])}`;
    }
    return `${NODESLIDE_MEMORY_SCOPE_VERSION}/deck/${segment('memoryScope.deckId', scope['deckId'])}`;
  }
  if (kind === 'session') {
    rejectUnknownFields('memoryScope', scope, new Set(['kind', 'deckId', 'sessionId']));
    return `${NODESLIDE_MEMORY_SCOPE_VERSION}/session/${segment('memoryScope.deckId', scope['deckId'])}/${segment('memoryScope.sessionId', scope['sessionId'])}`;
  }
  if (kind === 'run') {
    rejectUnknownFields('memoryScope', scope, new Set(['kind', 'deckId', 'runId']));
    return `${NODESLIDE_MEMORY_SCOPE_VERSION}/run/${segment('memoryScope.deckId', scope['deckId'])}/${segment('memoryScope.runId', scope['runId'])}`;
  }
  throw invalid('memoryScope.kind', 'expected workspace, project, deck, session, or run');
}

/** Fail-closed recognition of canonical memory keys. */
export function isNodeSlideMemoryScopeKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return canonicalMemoryScopeKey(value) === value;
  } catch {
    return false;
  }
}

function normalizeScopes(input: unknown): NodeSlideAccessScopes {
  const scopes = record('scopes', input);
  rejectUnknownFields('scopes', scopes, SCOPE_KEYS);
  return {
    deckIds: descriptors(
      'scopes.deckIds',
      scopes['deckIds'] === undefined ? [] : scopes['deckIds'],
    ),
    sourceIds: descriptors(
      'scopes.sourceIds',
      scopes['sourceIds'] === undefined ? [] : scopes['sourceIds'],
    ),
    providerIds: descriptors(
      'scopes.providerIds',
      scopes['providerIds'] === undefined ? [] : scopes['providerIds'],
    ),
    modelIds: descriptors(
      'scopes.modelIds',
      scopes['modelIds'] === undefined ? [] : scopes['modelIds'],
    ),
    toolIds: descriptors(
      'scopes.toolIds',
      scopes['toolIds'] === undefined ? [] : scopes['toolIds'],
    ),
    memoryScopeKeys: memoryScopeKeys(
      scopes['memoryScopeKeys'] === undefined ? [] : scopes['memoryScopeKeys'],
    ),
  };
}

function knownRole(value: unknown): NodeSlideAgentRole {
  if (typeof value !== 'string' || !ROLE_SET.has(value)) {
    throw invalid('role', 'unknown or missing role');
  }
  return value as NodeSlideAgentRole;
}

function knownCapabilities(value: unknown, role: NodeSlideAgentRole): NodeSlideAccessCapability[] {
  const values = strictArray('capabilities', value);
  const allowed = new Set<string>(NODESLIDE_ROLE_CAPABILITY_MATRIX[role]);
  const result = new Set<NodeSlideAccessCapability>();
  for (const candidate of values) {
    if (typeof candidate !== 'string' || !CAPABILITY_SET.has(candidate)) {
      throw invalid('capabilities', `unknown capability ${JSON.stringify(candidate)}`);
    }
    if (!allowed.has(candidate)) {
      throw invalid('capabilities', `${candidate} is outside the ${role} role ceiling`);
    }
    result.add(candidate as NodeSlideAccessCapability);
  }
  return [...result].sort();
}

function descriptors(field: string, value: unknown): string[] {
  const values = strictArray(field, value);
  return [...new Set(values.map((candidate) => descriptor(field, candidate)))].sort();
}

function memoryScopeKeys(value: unknown): string[] {
  const values = strictArray('scopes.memoryScopeKeys', value);
  const keys = values.map((candidate) => {
    if (typeof candidate !== 'string' || !isNodeSlideMemoryScopeKey(candidate)) {
      throw invalid('scopes.memoryScopeKeys', 'expected canonical memory scope keys');
    }
    return candidate;
  });
  return [...new Set(keys)].sort();
}

function canonicalMemoryScopeKey(value: string): string {
  const prefix = `${NODESLIDE_MEMORY_SCOPE_VERSION}/`;
  if (!value.startsWith(prefix)) throw invalid('memoryScopeKey', 'unsupported version');
  const parts = value.slice(prefix.length).split('/');
  const kind = parts[0];
  if (kind === 'workspace' && parts.length === 2) {
    return nodeSlideMemoryScopeKey({ kind, workspaceId: decodedSegment(parts[1]) });
  }
  if (kind === 'project' && parts.length === 3) {
    return nodeSlideMemoryScopeKey({
      kind,
      workspaceId: decodedSegment(parts[1]),
      projectId: decodedSegment(parts[2]),
    });
  }
  if (kind === 'deck' && parts.length === 2) {
    return nodeSlideMemoryScopeKey({ kind, deckId: decodedSegment(parts[1]) });
  }
  if (kind === 'deck' && parts.length === 4) {
    return nodeSlideMemoryScopeKey({
      kind,
      workspaceId: decodedSegment(parts[1]),
      projectId: decodedSegment(parts[2]),
      deckId: decodedSegment(parts[3]),
    });
  }
  if (kind === 'session' && parts.length === 3) {
    return nodeSlideMemoryScopeKey({
      kind,
      deckId: decodedSegment(parts[1]),
      sessionId: decodedSegment(parts[2]),
    });
  }
  if (kind === 'run' && parts.length === 3) {
    return nodeSlideMemoryScopeKey({
      kind,
      deckId: decodedSegment(parts[1]),
      runId: decodedSegment(parts[2]),
    });
  }
  throw invalid('memoryScopeKey', 'invalid scope shape');
}

function segment(field: string, value: unknown): string {
  return encodeURIComponent(descriptor(field, value));
}

function decodedSegment(value: string | undefined): string {
  if (!value) throw invalid('memoryScopeKey', 'empty segment');
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalid('memoryScopeKey', 'invalid encoded segment');
  }
}

function descriptor(field: string, value: unknown): string {
  if (typeof value !== 'string') throw invalid(field, 'expected a string');
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (hasControlCharacter) {
    throw invalid(field, 'expected 1 through 256 printable characters');
  }
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > 256) {
    throw invalid(field, 'expected 1 through 256 printable characters');
  }
  return clean;
}

function budgetInteger(field: string, value: unknown): number {
  const candidate = value === undefined ? 0 : value;
  if (!Number.isSafeInteger(candidate) || (candidate as number) < 0) {
    throw invalid(field, 'expected a non-negative safe integer');
  }
  return candidate as number;
}

function intersection<T extends string>(left: readonly T[], right: readonly T[]): T[] {
  const allowed = new Set(left);
  return right.filter((value) => allowed.has(value));
}

function record(field: string, value: unknown): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw invalid(field, 'expected a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid(field, 'expected a plain object');
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !Object.prototype.hasOwnProperty.call(property, 'value')) {
      throw invalid(`${field}.${key}`, 'accessor properties are not allowed');
    }
  }
  return value as Record<string, unknown>;
}

function strictArray(field: string, value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw invalid(field, 'expected an array');
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || !names.includes('length')) {
    throw invalid(field, 'expected a dense array without custom fields');
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw invalid(field, 'expected a dense array without custom fields');
    }
  }
  return value;
}

function rejectUnknownFields(
  field: string,
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) throw invalid(`${field}.${key}`, 'unknown field');
  }
}

function invalid(field: string, message: string): NodeSlideAccessPolicyValidationError {
  return new NodeSlideAccessPolicyValidationError(field, message);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]))
    );
  }
  if (
    typeof left === 'object' &&
    left !== null &&
    !Array.isArray(left) &&
    typeof right === 'object' &&
    right !== null &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      structurallyEqual(leftKeys, rightKeys) &&
      leftKeys.every((key) => structurallyEqual(leftRecord[key], rightRecord[key]))
    );
  }
  return false;
}
