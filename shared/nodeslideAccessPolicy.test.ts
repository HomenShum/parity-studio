import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_ACCESS_CAPABILITIES,
  NODESLIDE_ACCESS_POLICY_ROLES,
  NODESLIDE_ACCESS_POLICY_VERSION,
  NODESLIDE_ROLE_CAPABILITY_MATRIX,
  NodeSlideAccessPolicyValidationError,
  isNodeSlideAccessPolicy,
  isNodeSlideMemoryScopeKey,
  minNodeSlideAccessBudget,
  narrowNodeSlideAccessPolicy,
  nodeSlideCapabilitiesForRole,
  nodeSlideMemoryScopeKey,
  normalizeNodeSlideAccessBudget,
  normalizeNodeSlideAccessPolicy,
} from './nodeslideAccessPolicy';

const budget = {
  maxCostMicroUsd: 1_000_000,
  maxInputTokens: 10_000,
  maxOutputTokens: 2_000,
  maxDurationMs: 30_000,
  maxIterations: 4,
  maxToolCalls: 8,
};

describe('NodeSlide capability-scoped access policy', () => {
  it('normalizes every set deterministically without granting omitted authority', () => {
    const memoryKey = nodeSlideMemoryScopeKey({ kind: 'deck', deckId: ' deck-a ' });
    const normalized = normalizeNodeSlideAccessPolicy({
      role: 'planner',
      capabilities: ['proposal:create', 'deck:read', 'proposal:create'],
      scopes: {
        deckIds: [' deck-b ', 'deck-a', 'deck-a'],
        sourceIds: ['source-b', ' source-a '],
        providerIds: ['openrouter', 'nebius', 'openrouter'],
        modelIds: ['model-b', 'model-a'],
        toolIds: ['tool-b', 'tool-a'],
        memoryScopeKeys: [memoryKey, memoryKey],
      },
      budget,
    });

    expect(normalized).toEqual({
      schemaVersion: NODESLIDE_ACCESS_POLICY_VERSION,
      role: 'planner',
      capabilities: ['deck:read', 'proposal:create'],
      scopes: {
        deckIds: ['deck-a', 'deck-b'],
        sourceIds: ['source-a', 'source-b'],
        providerIds: ['nebius', 'openrouter'],
        modelIds: ['model-a', 'model-b'],
        toolIds: ['tool-a', 'tool-b'],
        memoryScopeKeys: [memoryKey],
      },
      budget,
    });

    expect(normalizeNodeSlideAccessPolicy({ role: 'reviewer' })).toMatchObject({
      capabilities: [],
      scopes: {
        deckIds: [],
        sourceIds: [],
        providerIds: [],
        modelIds: [],
        toolIds: [],
        memoryScopeKeys: [],
      },
      budget: {
        maxCostMicroUsd: 0,
        maxInputTokens: 0,
        maxOutputTokens: 0,
        maxDurationMs: 0,
        maxIterations: 0,
        maxToolCalls: 0,
      },
    });
  });

  it('narrows by exact intersection and cannot expand across delegated roles', () => {
    const deckMemory = nodeSlideMemoryScopeKey({ kind: 'deck', deckId: 'deck-a' });
    const runMemory = nodeSlideMemoryScopeKey({
      kind: 'run',
      deckId: 'deck-a',
      runId: 'run-a',
    });
    const parent = normalizeNodeSlideAccessPolicy({
      role: 'researcher',
      capabilities: ['deck:read', 'source:read', 'tool:invoke', 'memory:read'],
      scopes: {
        deckIds: ['deck-a', 'deck-b'],
        sourceIds: ['source-a', 'source-b'],
        providerIds: ['provider-a'],
        modelIds: ['model-a', 'model-b'],
        toolIds: ['search', 'capture'],
        memoryScopeKeys: [deckMemory, runMemory],
      },
      budget,
    });
    const requested = normalizeNodeSlideAccessPolicy({
      role: 'planner',
      capabilities: ['deck:read', 'source:read', 'tool:invoke', 'proposal:create'],
      scopes: {
        deckIds: ['deck-a', 'deck-c'],
        sourceIds: ['source-b', 'source-c'],
        providerIds: ['provider-b'],
        modelIds: ['model-b'],
        toolIds: ['capture', 'write'],
        memoryScopeKeys: [runMemory],
      },
      budget: {
        maxCostMicroUsd: 2_000_000,
        maxInputTokens: 5_000,
        maxOutputTokens: 4_000,
        maxDurationMs: 20_000,
        maxIterations: 6,
        maxToolCalls: 3,
      },
    });
    const narrowed = narrowNodeSlideAccessPolicy(parent, requested);

    expect(narrowed).toEqual({
      schemaVersion: NODESLIDE_ACCESS_POLICY_VERSION,
      role: 'planner',
      capabilities: ['deck:read', 'source:read', 'tool:invoke'],
      scopes: {
        deckIds: ['deck-a'],
        sourceIds: ['source-b'],
        providerIds: [],
        modelIds: ['model-b'],
        toolIds: ['capture'],
        memoryScopeKeys: [runMemory],
      },
      budget: {
        maxCostMicroUsd: 1_000_000,
        maxInputTokens: 5_000,
        maxOutputTokens: 2_000,
        maxDurationMs: 20_000,
        maxIterations: 4,
        maxToolCalls: 3,
      },
    });
    expect(narrowed.capabilities).not.toContain('proposal:create');
    expect(parent.scopes.deckIds).toEqual(['deck-a', 'deck-b']);
    expect(requested.scopes.deckIds).toEqual(['deck-a', 'deck-c']);
  });

  it('takes the component-wise minimum for all hard-budget dimensions', () => {
    expect(
      minNodeSlideAccessBudget(budget, {
        maxCostMicroUsd: 500_000,
        maxInputTokens: 20_000,
        maxOutputTokens: 1_000,
        maxDurationMs: 60_000,
        maxIterations: 2,
        maxToolCalls: 12,
      }),
    ).toEqual({
      maxCostMicroUsd: 500_000,
      maxInputTokens: 10_000,
      maxOutputTokens: 1_000,
      maxDurationMs: 30_000,
      maxIterations: 2,
      maxToolCalls: 8,
    });
    expect(normalizeNodeSlideAccessBudget({})).toEqual({
      maxCostMicroUsd: 0,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxDurationMs: 0,
      maxIterations: 0,
      maxToolCalls: 0,
    });
  });

  it('keeps the role matrix exhaustive and excludes commit and irreversible capabilities', () => {
    expect(Object.keys(NODESLIDE_ROLE_CAPABILITY_MATRIX).sort()).toEqual(
      [...NODESLIDE_ACCESS_POLICY_ROLES].sort(),
    );
    const known = new Set<string>(NODESLIDE_ACCESS_CAPABILITIES);
    const nonDelegable = [
      'deck:commit',
      'publication:write',
      'share:write',
      'export:write',
      'delete:write',
      'external_sync:write',
    ];
    for (const role of NODESLIDE_ACCESS_POLICY_ROLES) {
      const capabilities = nodeSlideCapabilitiesForRole(role);
      expect(capabilities.length).toBeGreaterThan(0);
      expect(new Set(capabilities).size).toBe(capabilities.length);
      expect(capabilities.every((capability) => known.has(capability))).toBe(true);
      expect(capabilities).not.toEqual(expect.arrayContaining(nonDelegable));
    }
    expect(nodeSlideCapabilitiesForRole('planner')).toContain('proposal:create');
    expect(nodeSlideCapabilitiesForRole('executor')).toContain('proposal:create');
    expect(nodeSlideCapabilitiesForRole('validator')).toContain('validation:run');
    expect(nodeSlideCapabilitiesForRole('researcher')).toContain('source:refresh');
    expect(nodeSlideCapabilitiesForRole('reviewer')).not.toContain('proposal:create');
  });

  it('creates collision-resistant canonical hierarchy, session, and run memory keys', () => {
    const workspace = nodeSlideMemoryScopeKey({ kind: 'workspace', workspaceId: 'workspace/a' });
    const project = nodeSlideMemoryScopeKey({
      kind: 'project',
      workspaceId: 'workspace/a',
      projectId: 'project one',
    });
    const exactDeck = nodeSlideMemoryScopeKey({
      kind: 'deck',
      workspaceId: 'workspace/a',
      projectId: 'project one',
      deckId: 'deck/a',
    });
    const deck = nodeSlideMemoryScopeKey({ kind: 'deck', deckId: 'deck/a' });
    const session = nodeSlideMemoryScopeKey({
      kind: 'session',
      deckId: 'deck/a',
      sessionId: 'session one',
    });
    const run = nodeSlideMemoryScopeKey({ kind: 'run', deckId: 'deck/a', runId: 'run/one' });

    expect(workspace).toBe('nodeslide.memory-scope/v1/workspace/workspace%2Fa');
    expect(project).toBe('nodeslide.memory-scope/v1/project/workspace%2Fa/project%20one');
    expect(exactDeck).toBe('nodeslide.memory-scope/v1/deck/workspace%2Fa/project%20one/deck%2Fa');
    expect(deck).toBe('nodeslide.memory-scope/v1/deck/deck%2Fa');
    expect(session).toBe('nodeslide.memory-scope/v1/session/deck%2Fa/session%20one');
    expect(run).toBe('nodeslide.memory-scope/v1/run/deck%2Fa/run%2Fone');
    expect(new Set([workspace, project, exactDeck, deck, session, run]).size).toBe(6);
    expect(
      [workspace, project, exactDeck, deck, session, run].every(isNodeSlideMemoryScopeKey),
    ).toBe(true);
    expect(isNodeSlideMemoryScopeKey('nodeslide.memory-scope/v1/run/deck/a/run')).toBe(false);
    expect(isNodeSlideMemoryScopeKey('nodeslide.memory-scope/v2/deck/deck-a')).toBe(false);
    expect(isNodeSlideMemoryScopeKey('nodeslide.memory-scope/v1/deck/%ZZ')).toBe(false);
    expect(isNodeSlideMemoryScopeKey('nodeslide.memory-scope/v1/deck/deck%2fa')).toBe(false);
    expect(isNodeSlideMemoryScopeKey('nodeslide.memory-scope/v1/project/workspace-a')).toBe(false);
    expect(isNodeSlideMemoryScopeKey('nodeslide.memory-scope/v1/deck/workspace-a//deck-a')).toBe(
      false,
    );
  });

  it('fails closed on unknown fields, versions, roles, capabilities, and malformed scopes', () => {
    const cases: Array<[string, unknown]> = [
      ['root.extra', { role: 'reviewer', extra: true }],
      ['schemaVersion', { schemaVersion: 'nodeslide.access-policy/v2', role: 'reviewer' }],
      ['role', { role: 'owner' }],
      ['capabilities', { role: 'reviewer', capabilities: ['unknown:capability'] }],
      ['role ceiling', { role: 'reviewer', capabilities: ['deck:commit'] }],
      ['scopes.extra', { role: 'reviewer', scopes: { extra: [] } }],
      ['scopes.deckIds', { role: 'reviewer', scopes: { deckIds: '*' } }],
      ['null capabilities', { role: 'reviewer', capabilities: null }],
      ['null scopes', { role: 'reviewer', scopes: null }],
      ['null budget', { role: 'reviewer', budget: null }],
      ['memory key', { role: 'reviewer', scopes: { memoryScopeKeys: ['deck-a'] } }],
      ['budget.extra', { role: 'reviewer', budget: { extra: 1 } }],
      ['negative budget', { role: 'reviewer', budget: { maxToolCalls: -1 } }],
      ['fractional budget', { role: 'reviewer', budget: { maxIterations: 1.5 } }],
      ['non-finite budget', { role: 'reviewer', budget: { maxCostMicroUsd: Number.NaN } }],
    ];

    for (const [, input] of cases) {
      expect(() => normalizeNodeSlideAccessPolicy(input)).toThrow(
        NodeSlideAccessPolicyValidationError,
      );
      expect(isNodeSlideAccessPolicy(input)).toBe(false);
    }
    expect(() => nodeSlideCapabilitiesForRole('owner')).toThrow(
      NodeSlideAccessPolicyValidationError,
    );
    const sparseCapabilities = new Array(1);
    expect(() =>
      normalizeNodeSlideAccessPolicy({ role: 'reviewer', capabilities: sparseCapabilities }),
    ).toThrow(NodeSlideAccessPolicyValidationError);
    const exoticScopes = { deckIds: ['deck-a'] } as Record<string, unknown>;
    Object.defineProperty(exoticScopes, 'deckIds', {
      get: () => ['deck-b'],
      enumerable: true,
    });
    expect(() =>
      normalizeNodeSlideAccessPolicy({ role: 'reviewer', scopes: exoticScopes }),
    ).toThrow(NodeSlideAccessPolicyValidationError);
    expect(() =>
      nodeSlideMemoryScopeKey({ kind: 'run', deckId: 'deck-a', runId: 'run-a', extra: true }),
    ).toThrow(NodeSlideAccessPolicyValidationError);
    expect(() =>
      nodeSlideMemoryScopeKey({ kind: 'deck', workspaceId: 'workspace-a', deckId: 'deck-a' }),
    ).toThrow(NodeSlideAccessPolicyValidationError);
  });

  it('recognizes only complete canonical policies and leaves input objects immutable', () => {
    const input = {
      role: 'validator',
      capabilities: ['validation:run', 'deck:read'],
      scopes: { deckIds: ['deck-b', 'deck-a'] },
      budget: { maxToolCalls: 2 },
    } as const;
    const before = structuredClone(input);
    const normalized = normalizeNodeSlideAccessPolicy(input);

    expect(input).toEqual(before);
    expect(isNodeSlideAccessPolicy(input)).toBe(false);
    expect(isNodeSlideAccessPolicy(normalized)).toBe(true);
    expect(
      isNodeSlideAccessPolicy({
        ...normalized,
        capabilities: [...normalized.capabilities].reverse(),
      }),
    ).toBe(false);
    expect(
      isNodeSlideAccessPolicy({
        ...normalized,
        scopes: { ...normalized.scopes, deckIds: ['deck-a', 'deck-a'] },
      }),
    ).toBe(false);
  });
});
