import { describe, expect, it } from 'vitest';
import { normalizeNodeSlideAccessPolicy } from '../../shared/nodeslideAccessPolicy';
import {
  NODESLIDE_WORKSPACE_CAPABILITIES,
  NODESLIDE_WORKSPACE_ROLES,
  NODESLIDE_WORKSPACE_ROLE_CAPABILITY_MATRIX,
  NodeSlideWorkspaceAccessPolicyError,
  evaluateNodeSlideWorkspaceAccess,
  isNodeSlideWorkspaceAccessPolicy,
  narrowNodeSlideWorkspaceAccessPolicy,
  nodeSlideWorkspaceCapabilitiesForRole,
  normalizeNodeSlideWorkspaceAccessPolicy,
} from './nodeslideScopeAccess';

const agentPolicy = normalizeNodeSlideAccessPolicy({
  role: 'planner',
  capabilities: ['deck:read', 'source:read', 'proposal:create'],
  scopes: {
    deckIds: ['deck-a', 'deck-b'],
    sourceIds: ['source-a', 'source-b'],
    providerIds: [],
    modelIds: [],
    toolIds: [],
    memoryScopeKeys: [],
  },
  budget: {
    maxCostMicroUsd: 1_000,
    maxInputTokens: 1_000,
    maxOutputTokens: 500,
    maxDurationMs: 10_000,
    maxIterations: 3,
    maxToolCalls: 2,
  },
});

describe('NodeSlide workspace scope access', () => {
  it('keeps the workspace role matrix exhaustive and viewer read-only', () => {
    expect(Object.keys(NODESLIDE_WORKSPACE_ROLE_CAPABILITY_MATRIX).sort()).toEqual(
      [...NODESLIDE_WORKSPACE_ROLES].sort(),
    );
    const known = new Set<string>(NODESLIDE_WORKSPACE_CAPABILITIES);
    for (const role of NODESLIDE_WORKSPACE_ROLES) {
      const capabilities = nodeSlideWorkspaceCapabilitiesForRole(role);
      expect(capabilities.every((capability) => known.has(capability))).toBe(true);
      expect(new Set(capabilities).size).toBe(capabilities.length);
    }
    expect(nodeSlideWorkspaceCapabilitiesForRole('viewer')).toEqual([
      'deck:read',
      'project:read',
      'workspace:read',
    ]);
    expect(nodeSlideWorkspaceCapabilitiesForRole('editor')).not.toContain('grant:issue');
  });

  it('narrows role, project, capabilities, agent scopes, and every budget component', () => {
    const parent = policy({ role: 'owner', projectScope: { kind: 'workspace' } });
    const requested = policy({
      role: 'viewer',
      projectScope: { kind: 'project', projectId: 'project-a' },
      capabilities: ['workspace:read', 'project:read', 'deck:read'],
      agentPolicy: normalizeNodeSlideAccessPolicy({
        ...agentPolicy,
        capabilities: ['deck:read', 'source:read'],
        scopes: { ...agentPolicy.scopes, deckIds: ['deck-b', 'deck-c'], sourceIds: ['source-b'] },
        budget: {
          maxCostMicroUsd: 2_000,
          maxInputTokens: 500,
          maxOutputTokens: 1_000,
          maxDurationMs: 5_000,
          maxIterations: 5,
          maxToolCalls: 1,
        },
      }),
    });
    const narrowed = narrowNodeSlideWorkspaceAccessPolicy(parent, requested);

    expect(narrowed).toMatchObject({
      role: 'viewer',
      projectScope: { kind: 'project', projectId: 'project-a' },
      capabilities: ['deck:read', 'project:read', 'workspace:read'],
      agentPolicy: {
        capabilities: ['deck:read', 'source:read'],
        scopes: { deckIds: ['deck-b'], sourceIds: ['source-b'] },
        budget: {
          maxCostMicroUsd: 1_000,
          maxInputTokens: 500,
          maxOutputTokens: 500,
          maxDurationMs: 5_000,
          maxIterations: 3,
          maxToolCalls: 1,
        },
      },
    });
    expect(isNodeSlideWorkspaceAccessPolicy(narrowed)).toBe(true);
  });

  it('fails closed for project mismatch, absent project, malformed policy, and escalation', () => {
    const viewer = policy({
      role: 'viewer',
      projectScope: { kind: 'project', projectId: 'project-a' },
      capabilities: ['workspace:read', 'project:read', 'deck:read'],
    });
    expect(
      evaluateNodeSlideWorkspaceAccess(viewer, {
        workspaceId: 'workspace-a',
        capability: 'deck:read',
        projectId: 'project-a',
      }),
    ).toEqual({ allowed: true, reason: 'allowed' });
    expect(
      evaluateNodeSlideWorkspaceAccess(viewer, {
        workspaceId: 'workspace-a',
        capability: 'deck:read',
        projectId: 'project-b',
      }),
    ).toEqual({ allowed: false, reason: 'project_mismatch' });
    expect(
      evaluateNodeSlideWorkspaceAccess(viewer, {
        workspaceId: 'workspace-a',
        capability: 'deck:read',
      }),
    ).toEqual({ allowed: false, reason: 'project_required' });
    expect(
      evaluateNodeSlideWorkspaceAccess(
        { ...viewer, extra: true },
        {
          workspaceId: 'workspace-a',
          capability: 'workspace:read',
        },
      ),
    ).toEqual({ allowed: false, reason: 'invalid_policy' });
    expect(() =>
      narrowNodeSlideWorkspaceAccessPolicy(
        policy({ role: 'editor', projectScope: { kind: 'workspace' } }),
        policy({ role: 'owner', projectScope: { kind: 'workspace' } }),
      ),
    ).toThrow(NodeSlideWorkspaceAccessPolicyError);
  });

  it('rejects disjoint projects and cross-workspace delegation', () => {
    expect(() =>
      narrowNodeSlideWorkspaceAccessPolicy(
        policy({ role: 'owner', projectScope: { kind: 'project', projectId: 'project-a' } }),
        policy({ role: 'viewer', projectScope: { kind: 'project', projectId: 'project-b' } }),
      ),
    ).toThrow('project scopes do not intersect');
    expect(() =>
      narrowNodeSlideWorkspaceAccessPolicy(
        policy({ role: 'owner', projectScope: { kind: 'workspace' } }),
        policy({
          workspaceId: 'workspace-b',
          role: 'viewer',
          projectScope: { kind: 'workspace' },
        }),
      ),
    ).toThrow('cannot delegate across workspaces');
  });
});

function policy(
  overrides: Partial<{
    workspaceId: string;
    role: 'owner' | 'editor' | 'viewer';
    projectScope: { kind: 'workspace' } | { kind: 'project'; projectId: string };
    capabilities: readonly string[];
    agentPolicy: typeof agentPolicy;
  }> = {},
) {
  const role = overrides.role ?? 'owner';
  return normalizeNodeSlideWorkspaceAccessPolicy({
    workspaceId: overrides.workspaceId ?? 'workspace-a',
    role,
    projectScope: overrides.projectScope ?? { kind: 'workspace' },
    capabilities: overrides.capabilities ?? nodeSlideWorkspaceCapabilitiesForRole(role),
    agentPolicy: overrides.agentPolicy ?? agentPolicy,
  });
}
