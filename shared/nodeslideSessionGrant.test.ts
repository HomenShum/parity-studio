import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_SESSION_GRANT_DEFAULT_EXCLUSIONS,
  type NodeSlideSessionGrant,
  type NodeSlideSessionGrantRequest,
  type NodeSlideSessionGrantState,
  createNodeSlideSessionGrant,
  evaluateNodeSlideSessionGrant,
} from './nodeslideSessionGrant';

const NOW = 10_000;

describe('NodeSlide session-scoped Turbo authority', () => {
  it('binds a once-per-session grant to one session and one use', () => {
    const grant = makeGrant({ maxUses: 1 });
    const firstUse = evaluateNodeSlideSessionGrant(grant, emptyState(), request());
    expect(firstUse).toMatchObject({
      allowed: true,
      reasonCode: 'allowed',
      continuation: false,
      remainingBudget: { uses: 1, concurrency: 1 },
    });

    const activeState = state({ useCount: 1, activeUseIds: ['use-a'] });
    expect(evaluateNodeSlideSessionGrant(grant, activeState, request())).toMatchObject({
      allowed: true,
      continuation: true,
    });
    expect(
      evaluateNodeSlideSessionGrant(grant, activeState, request({ useId: 'use-b' })),
    ).toMatchObject({ allowed: false, reasonCode: 'max_uses_reached' });
    expect(
      evaluateNodeSlideSessionGrant(grant, emptyState(), request({ sessionId: 'session-b' })),
    ).toMatchObject({ allowed: false, reasonCode: 'session_mismatch' });
  });

  it('denies a grant at its expiry boundary and reports no remaining lifetime', () => {
    const grant = makeGrant({ expiresAt: NOW + 500 });
    const decision = evaluateNodeSlideSessionGrant(
      grant,
      emptyState(),
      request({ evaluatedAt: NOW + 500 }),
    );
    expect(decision).toMatchObject({
      allowed: false,
      reasonCode: 'grant_expired',
      remainingBudget: { expiresInMs: 0 },
    });
  });

  it('denies a revoked grant', () => {
    const decision = evaluateNodeSlideSessionGrant(
      makeGrant(),
      state({ revokedAt: NOW - 1 }),
      request(),
    );
    expect(decision).toMatchObject({ allowed: false, reasonCode: 'grant_revoked' });
  });

  it('enforces every hard budget and returns the remaining budget', () => {
    const grant = makeGrant();
    const nearlySpent = state({
      usage: {
        inputTokens: 90,
        outputTokens: 40,
        costMicroUsd: 900,
        toolCalls: 2,
        durationMs: 100,
      },
    });

    const cases = [
      ['inputTokens', 11, 'input_token_budget_exceeded'],
      ['outputTokens', 11, 'output_token_budget_exceeded'],
      ['costMicroUsd', 101, 'cost_budget_exceeded'],
      ['toolCalls', 2, 'tool_budget_exceeded'],
      ['durationMs', 901, 'time_budget_exceeded'],
    ] as const;
    for (const [field, amount, reasonCode] of cases) {
      const decision = evaluateNodeSlideSessionGrant(
        grant,
        nearlySpent,
        request({ anticipatedUsage: { [field]: amount } }),
      );
      expect(decision).toMatchObject({
        allowed: false,
        reasonCode,
        remainingBudget: {
          inputTokens: 10,
          outputTokens: 10,
          costMicroUsd: 100,
          toolCalls: 1,
        },
      });
    }
  });

  it('lets cancellation defeat a late auto-commit after successful validation and Deck CI', () => {
    const grant = makeGrant({ allowAutoCommit: true });
    const commit = request({
      action: 'auto_commit',
      candidateValidationPassed: true,
      deckCiPassed: true,
    });

    expect(evaluateNodeSlideSessionGrant(grant, emptyState(), commit)).toMatchObject({
      allowed: true,
      reasonCode: 'allowed',
    });
    expect(
      evaluateNodeSlideSessionGrant(grant, state({ cancelledAt: NOW - 1 }), commit),
    ).toMatchObject({ allowed: false, reasonCode: 'session_cancelled' });
  });

  it('requires both candidate validation and Deck CI before auto-commit', () => {
    const grant = makeGrant({ allowAutoCommit: true });
    expect(
      evaluateNodeSlideSessionGrant(grant, emptyState(), request({ action: 'auto_commit' })),
    ).toMatchObject({ allowed: false, reasonCode: 'candidate_validation_required' });
    expect(
      evaluateNodeSlideSessionGrant(
        grant,
        emptyState(),
        request({ action: 'auto_commit', candidateValidationPassed: true }),
      ),
    ).toMatchObject({ allowed: false, reasonCode: 'deck_ci_pass_required' });
  });

  it.each(NODESLIDE_SESSION_GRANT_DEFAULT_EXCLUSIONS)(
    'excludes irreversible action %s by default',
    (action) => {
      expect(
        evaluateNodeSlideSessionGrant(makeGrant(), emptyState(), request({ action })),
      ).toMatchObject({ allowed: false, reasonCode: 'action_excluded' });
    },
  );

  it('enforces deck scopes, provider/model allowlists, and web/tool/memory permissions', () => {
    const grant = makeGrant();
    expect(
      evaluateNodeSlideSessionGrant(
        grant,
        emptyState(),
        request({ action: 'model_inference', provider: 'other', model: 'model-a' }),
      ),
    ).toMatchObject({ allowed: false, reasonCode: 'provider_not_allowed' });
    expect(
      evaluateNodeSlideSessionGrant(grant, emptyState(), request({ action: 'web_access' })),
    ).toMatchObject({ allowed: false, reasonCode: 'web_denied' });
    expect(
      evaluateNodeSlideSessionGrant(
        grant,
        emptyState(),
        request({ action: 'tool_call', toolId: 'dangerous-tool' }),
      ),
    ).toMatchObject({ allowed: false, reasonCode: 'tool_denied' });
    expect(
      evaluateNodeSlideSessionGrant(grant, emptyState(), request({ action: 'memory_write' })),
    ).toMatchObject({ allowed: false, reasonCode: 'memory_write_denied' });
    expect(
      evaluateNodeSlideSessionGrant(
        makeGrant({ scopes: ['deck:read'] }),
        emptyState(),
        request({ action: 'deck_write' }),
      ),
    ).toMatchObject({ allowed: false, reasonCode: 'scope_denied' });
  });
});

function makeGrant(
  overrides: Partial<{
    expiresAt: number;
    maxUses: number;
    allowAutoCommit: boolean;
    scopes: readonly ('deck:read' | 'deck:write')[];
  }> = {},
): NodeSlideSessionGrant {
  return createNodeSlideSessionGrant({
    grantId: 'grant-a',
    sessionId: 'session-a',
    issuedAt: NOW - 100,
    expiresAt: overrides.expiresAt ?? NOW + 10_000,
    scopes: overrides.scopes ?? ['deck:read', 'deck:write'],
    allowedDeckIds: ['deck-a'],
    allowedProviders: ['provider-a'],
    allowedModels: ['model-a'],
    permissions: {
      web: false,
      tools: { allowed: true, toolIds: ['safe-tool'] },
      memory: { read: true, write: false },
    },
    limits: {
      maxInputTokens: 100,
      maxOutputTokens: 50,
      maxCostMicroUsd: 1_000,
      maxToolCalls: 3,
      maxDurationMs: 1_000,
    },
    maxUses: overrides.maxUses ?? 2,
    maxConcurrency: 1,
    allowAutoCommit: overrides.allowAutoCommit ?? false,
  });
}

function emptyState(): NodeSlideSessionGrantState {
  return state();
}

function state(overrides: Partial<NodeSlideSessionGrantState> = {}): NodeSlideSessionGrantState {
  return {
    useCount: overrides.useCount ?? 0,
    activeUseIds: overrides.activeUseIds ?? [],
    usage: overrides.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
      toolCalls: 0,
      durationMs: 0,
    },
    ...(overrides.revokedAt === undefined ? {} : { revokedAt: overrides.revokedAt }),
    ...(overrides.cancelledAt === undefined ? {} : { cancelledAt: overrides.cancelledAt }),
  };
}

function request(
  overrides: Partial<NodeSlideSessionGrantRequest> = {},
): NodeSlideSessionGrantRequest {
  return {
    sessionId: overrides.sessionId ?? 'session-a',
    deckId: overrides.deckId ?? 'deck-a',
    useId: overrides.useId ?? 'use-a',
    action: overrides.action ?? 'deck_read',
    evaluatedAt: overrides.evaluatedAt ?? NOW,
    ...(overrides.provider === undefined ? {} : { provider: overrides.provider }),
    ...(overrides.model === undefined ? {} : { model: overrides.model }),
    ...(overrides.toolId === undefined ? {} : { toolId: overrides.toolId }),
    ...(overrides.candidateValidationPassed === undefined
      ? {}
      : { candidateValidationPassed: overrides.candidateValidationPassed }),
    ...(overrides.deckCiPassed === undefined ? {} : { deckCiPassed: overrides.deckCiPassed }),
    ...(overrides.anticipatedUsage === undefined
      ? {}
      : { anticipatedUsage: overrides.anticipatedUsage }),
  };
}
