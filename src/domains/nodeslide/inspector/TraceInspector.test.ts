import { describe, expect, it } from 'vitest';
import type { AgentTrace, ValidationResult } from '../../../../shared/nodeslide';
import { buildSealModel, isFallbackTrace, nodeSummary } from './TraceInspector';

const LIVE_TRACE: AgentTrace = {
  id: 'trace-live',
  deckId: 'deck-1',
  patchId: 'patch-1',
  status: 'awaiting_review',
  summary: 'Proposed a bounded edit',
  plan: ['Read context', 'Draft patch', 'Validate candidate'],
  context: ['Slide 01'],
  toolCalls: ['Called GLM 5.2 after consent'],
  guardrails: ['Slide unchanged until Accept'],
  candidateDigest: 'candidate_1234567890abcdef',
  provider: 'openrouter',
  model: 'z-ai/glm-5.2',
  costMicroUsd: 42,
  inputTokens: 120,
  outputTokens: 30,
  createdAt: 1_700_000_000_000,
  completedAt: 1_700_000_000_400,
};

const VALIDATION: ValidationResult = {
  id: 'validation-1',
  deckId: 'deck-1',
  deckVersion: 3,
  ok: true,
  publishOk: true,
  cleanOk: true,
  issues: [],
  checkedAt: 1_700_000_000_300,
  toolchainVersion: 'nodeslide/1',
};

describe('NodeSlide trace truth model', () => {
  it('reveals a real candidate digest only above human density', () => {
    expect(isFallbackTrace(LIVE_TRACE)).toBe(false);
    expect(
      buildSealModel(LIVE_TRACE, undefined, VALIDATION, 'human').agent.digestFull,
    ).toBeUndefined();
    expect(buildSealModel(LIVE_TRACE, undefined, VALIDATION, 'pro').agent.digestFull).toBe(
      LIVE_TRACE.candidateDigest,
    );
  });

  it('labels deterministic degradation without inventing a candidate receipt', () => {
    const { candidateDigest: _candidateDigest, ...traceWithoutCandidate } = LIVE_TRACE;
    const fallback: AgentTrace = {
      ...traceWithoutCandidate,
      id: 'trace-fallback',
      model: 'z-ai/glm-5.2 (deterministic fallback)',
      costMicroUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    };

    expect(isFallbackTrace(fallback)).toBe(true);
    expect(buildSealModel(fallback, undefined, VALIDATION, 'tech')).toMatchObject({
      variant: 'fallback',
      stamp: 'provisional',
      agent: {
        value: 'deterministic fallback',
        annotation: 'no candidate receipt — hash not invented',
      },
    });
    expect(nodeSummary('receipt', fallback, undefined, VALIDATION, true)).toContain('not signable');
  });

  it('blocks a failed validation instead of presenting a signed receipt', () => {
    const failedValidation: ValidationResult = {
      ...VALIDATION,
      ok: false,
      publishOk: false,
      issues: [
        {
          id: 'issue-1',
          severity: 'error',
          code: 'overflow',
          message: 'Element is out of bounds.',
          slideId: 'slide-1',
        },
      ],
    };

    expect(buildSealModel(LIVE_TRACE, undefined, failedValidation, 'tech')).toMatchObject({
      variant: 'failed',
      stamp: 'blocked',
      validator: { kind: 'failed', issueCount: 1 },
      human: { value: 'Blocked — not signable' },
    });
  });
});
