import {
  type NodeSlideAccessPolicy,
  narrowNodeSlideAccessPolicy,
  normalizeNodeSlideAccessPolicy,
} from '../../shared/nodeslideAccessPolicy';

export const NODESLIDE_WORKSPACE_ACCESS_POLICY_VERSION =
  'nodeslide.workspace-access-policy/v1' as const;

export const NODESLIDE_WORKSPACE_ROLES = ['owner', 'editor', 'viewer'] as const;
export type NodeSlideWorkspaceRole = (typeof NODESLIDE_WORKSPACE_ROLES)[number];

export const NODESLIDE_WORKSPACE_CAPABILITIES = [
  'workspace:read',
  'project:read',
  'project:create',
  'deck:read',
  'deck:attach',
  'job:create',
  'grant:issue',
  'grant:revoke',
] as const;
export type NodeSlideWorkspaceCapability = (typeof NODESLIDE_WORKSPACE_CAPABILITIES)[number];

export const NODESLIDE_WORKSPACE_ROLE_CAPABILITY_MATRIX = {
  owner: [
    'workspace:read',
    'project:read',
    'project:create',
    'deck:read',
    'deck:attach',
    'job:create',
    'grant:issue',
    'grant:revoke',
  ],
  editor: ['workspace:read', 'project:read', 'deck:read', 'deck:attach', 'job:create'],
  viewer: ['workspace:read', 'project:read', 'deck:read'],
} as const satisfies Record<NodeSlideWorkspaceRole, readonly NodeSlideWorkspaceCapability[]>;

export type NodeSlideWorkspaceProjectScope =
  | { readonly kind: 'workspace' }
  | { readonly kind: 'project'; readonly projectId: string };

export interface NodeSlideWorkspaceAccessPolicy {
  readonly schemaVersion: typeof NODESLIDE_WORKSPACE_ACCESS_POLICY_VERSION;
  readonly workspaceId: string;
  readonly role: NodeSlideWorkspaceRole;
  readonly projectScope: NodeSlideWorkspaceProjectScope;
  readonly capabilities: readonly NodeSlideWorkspaceCapability[];
  /** Provider/tool/memory authority is independent and can only narrow on delegation. */
  readonly agentPolicy: NodeSlideAccessPolicy;
}

export interface NodeSlideWorkspaceAccessRequest {
  readonly workspaceId: string;
  readonly capability: NodeSlideWorkspaceCapability;
  readonly projectId?: string;
}

export type NodeSlideWorkspaceAccessDecision =
  | { readonly allowed: true; readonly reason: 'allowed' }
  | {
      readonly allowed: false;
      readonly reason:
        | 'invalid_policy'
        | 'workspace_mismatch'
        | 'capability_denied'
        | 'project_required'
        | 'project_mismatch';
    };

export class NodeSlideWorkspaceAccessPolicyError extends Error {
  readonly code = 'invalid_nodeslide_workspace_access_policy' as const;

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`Invalid NodeSlide workspace access policy ${field}: ${message}`);
    this.name = 'NodeSlideWorkspaceAccessPolicyError';
  }
}

const POLICY_KEYS = new Set([
  'schemaVersion',
  'workspaceId',
  'role',
  'projectScope',
  'capabilities',
  'agentPolicy',
]);
const ROLE_SET = new Set<string>(NODESLIDE_WORKSPACE_ROLES);
const CAPABILITY_SET = new Set<string>(NODESLIDE_WORKSPACE_CAPABILITIES);
const PROJECT_CAPABILITIES = new Set<NodeSlideWorkspaceCapability>([
  'project:read',
  'deck:read',
  'deck:attach',
  'job:create',
]);

export function normalizeNodeSlideWorkspaceAccessPolicy(
  input: unknown,
): NodeSlideWorkspaceAccessPolicy {
  const policy = record('root', input);
  rejectUnknown('root', policy, POLICY_KEYS);
  if (
    policy['schemaVersion'] !== undefined &&
    policy['schemaVersion'] !== NODESLIDE_WORKSPACE_ACCESS_POLICY_VERSION
  ) {
    throw invalid('schemaVersion', 'unsupported contract version');
  }
  const workspaceId = descriptor('workspaceId', policy['workspaceId']);
  const role = workspaceRole(policy['role']);
  const projectScope = normalizeProjectScope(policy['projectScope']);
  const capabilities = normalizeCapabilities(policy['capabilities'], role);
  const agentPolicy = normalizeNodeSlideAccessPolicy(policy['agentPolicy']);
  return {
    schemaVersion: NODESLIDE_WORKSPACE_ACCESS_POLICY_VERSION,
    workspaceId,
    role,
    projectScope,
    capabilities,
    agentPolicy,
  };
}

export function isNodeSlideWorkspaceAccessPolicy(
  input: unknown,
): input is NodeSlideWorkspaceAccessPolicy {
  try {
    return structurallyEqual(input, normalizeNodeSlideWorkspaceAccessPolicy(input));
  } catch {
    return false;
  }
}

/** Intersects role, project, capability, and nested agent authority. */
export function narrowNodeSlideWorkspaceAccessPolicy(
  parentInput: unknown,
  requestedInput: unknown,
): NodeSlideWorkspaceAccessPolicy {
  const parent = normalizeNodeSlideWorkspaceAccessPolicy(parentInput);
  const requested = normalizeNodeSlideWorkspaceAccessPolicy(requestedInput);
  if (parent.workspaceId !== requested.workspaceId) {
    throw invalid('workspaceId', 'cannot delegate across workspaces');
  }
  if (roleRank(requested.role) > roleRank(parent.role)) {
    throw invalid('role', 'cannot elevate a delegated role');
  }
  return {
    schemaVersion: NODESLIDE_WORKSPACE_ACCESS_POLICY_VERSION,
    workspaceId: parent.workspaceId,
    role: requested.role,
    projectScope: intersectProjectScope(parent.projectScope, requested.projectScope),
    capabilities: intersection(parent.capabilities, requested.capabilities),
    agentPolicy: narrowNodeSlideAccessPolicy(parent.agentPolicy, requested.agentPolicy),
  };
}

/** Evaluates only complete canonical policies and otherwise denies without throwing. */
export function evaluateNodeSlideWorkspaceAccess(
  policyInput: unknown,
  request: NodeSlideWorkspaceAccessRequest,
): NodeSlideWorkspaceAccessDecision {
  if (!isNodeSlideWorkspaceAccessPolicy(policyInput)) {
    return { allowed: false, reason: 'invalid_policy' };
  }
  const policy = policyInput;
  if (request.workspaceId !== policy.workspaceId) {
    return { allowed: false, reason: 'workspace_mismatch' };
  }
  if (
    !CAPABILITY_SET.has(request.capability) ||
    !policy.capabilities.includes(request.capability)
  ) {
    return { allowed: false, reason: 'capability_denied' };
  }
  if (PROJECT_CAPABILITIES.has(request.capability)) {
    if (!request.projectId) return { allowed: false, reason: 'project_required' };
    if (
      policy.projectScope.kind === 'project' &&
      policy.projectScope.projectId !== request.projectId
    ) {
      return { allowed: false, reason: 'project_mismatch' };
    }
  }
  return { allowed: true, reason: 'allowed' };
}

export function nodeSlideWorkspaceCapabilitiesForRole(
  input: unknown,
): NodeSlideWorkspaceCapability[] {
  const role = workspaceRole(input);
  return [...NODESLIDE_WORKSPACE_ROLE_CAPABILITY_MATRIX[role]].sort();
}

function normalizeProjectScope(input: unknown): NodeSlideWorkspaceProjectScope {
  const scope = record('projectScope', input);
  if (scope['kind'] === 'workspace') {
    rejectUnknown('projectScope', scope, new Set(['kind']));
    return { kind: 'workspace' };
  }
  if (scope['kind'] === 'project') {
    rejectUnknown('projectScope', scope, new Set(['kind', 'projectId']));
    return { kind: 'project', projectId: descriptor('projectScope.projectId', scope['projectId']) };
  }
  throw invalid('projectScope.kind', 'expected workspace or project');
}

function normalizeCapabilities(
  input: unknown,
  role: NodeSlideWorkspaceRole,
): NodeSlideWorkspaceCapability[] {
  const values = strictArray('capabilities', input);
  const roleCapabilities = new Set<string>(NODESLIDE_WORKSPACE_ROLE_CAPABILITY_MATRIX[role]);
  const result = new Set<NodeSlideWorkspaceCapability>();
  for (const value of values) {
    if (typeof value !== 'string' || !CAPABILITY_SET.has(value)) {
      throw invalid('capabilities', `unknown capability ${JSON.stringify(value)}`);
    }
    if (!roleCapabilities.has(value)) {
      throw invalid('capabilities', `${value} is outside the ${role} role ceiling`);
    }
    result.add(value as NodeSlideWorkspaceCapability);
  }
  return [...result].sort();
}

function intersectProjectScope(
  parent: NodeSlideWorkspaceProjectScope,
  requested: NodeSlideWorkspaceProjectScope,
): NodeSlideWorkspaceProjectScope {
  if (parent.kind === 'workspace') return structuredClone(requested);
  if (requested.kind === 'workspace' || requested.projectId === parent.projectId) {
    return structuredClone(parent);
  }
  throw invalid('projectScope', 'project scopes do not intersect');
}

function roleRank(role: NodeSlideWorkspaceRole): number {
  if (role === 'owner') return 3;
  if (role === 'editor') return 2;
  return 1;
}

function workspaceRole(value: unknown): NodeSlideWorkspaceRole {
  if (typeof value !== 'string' || !ROLE_SET.has(value)) {
    throw invalid('role', 'unknown or missing role');
  }
  return value as NodeSlideWorkspaceRole;
}

function descriptor(field: string, value: unknown): string {
  if (typeof value !== 'string') throw invalid(field, 'expected a string');
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > 256) throw invalid(field, 'expected 1 through 256 characters');
  return clean;
}

function strictArray(field: string, input: unknown): readonly unknown[] {
  if (!Array.isArray(input) || Object.getOwnPropertySymbols(input).length > 0) {
    throw invalid(field, 'expected an array');
  }
  if (Object.getOwnPropertyNames(input).length !== input.length + 1) {
    throw invalid(field, 'expected a dense array without custom fields');
  }
  for (let index = 0; index < input.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(input, index)) {
      throw invalid(field, 'expected a dense array without custom fields');
    }
  }
  return input;
}

function record(field: string, input: unknown): Record<string, unknown> {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.getOwnPropertySymbols(input).length > 0
  ) {
    throw invalid(field, 'expected a plain object');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid(field, 'expected a plain object');
  }
  return input as Record<string, unknown>;
}

function rejectUnknown(
  field: string,
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.getOwnPropertyNames(input)) {
    if (!allowed.has(key)) throw invalid(`${field}.${key}`, 'unknown field');
  }
}

function intersection<T extends string>(left: readonly T[], right: readonly T[]): T[] {
  const allowed = new Set(left);
  return right.filter((value) => allowed.has(value));
}

function invalid(field: string, message: string): NodeSlideWorkspaceAccessPolicyError {
  return new NodeSlideWorkspaceAccessPolicyError(field, message);
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
