import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_MULTI_AGENT_VERSION,
  nodeSlideRoleHandoffText,
  nodeSlideRoleProviderRequest,
  parseNodeSlideRoleCompletion,
} from './nodeslideMultiAgent';

describe('NodeSlide cognitive agent handoffs', () => {
  it('creates a bounded role request that cannot emit patch operations', () => {
    const request = nodeSlideRoleProviderRequest({
      role: 'analyst',
      instruction: 'Make the evidence slide decision-ready.',
      boundedContext: '{"deck":"bounded"}',
      model: 'nebius/zai-org/GLM-5.2',
      reasoningEffort: 'medium',
    });

    expect(request.maxTokens).toBeLessThanOrEqual(700);
    expect(request.jsonSchema?.schema).not.toHaveProperty('properties.operations');
    expect(request.userText).toContain(NODESLIDE_MULTI_AGENT_VERSION);
    expect(request.systemPrompt).toContain('Do not draft slide operations');
  });

  it('labels provider failure as fallback instead of fabricating a handoff', () => {
    const completion = parseNodeSlideRoleCompletion('storyteller', {
      ok: false,
      reason: 'provider unavailable',
    });
    expect(completion.status).toBe('fallback');
    expect(nodeSlideRoleHandoffText(completion)).toContain('Fallback storyteller handoff');
    expect(nodeSlideRoleHandoffText(completion)).toContain('provider unavailable');
  });

  it('normalizes a valid fact-checker handoff', () => {
    const completion = parseNodeSlideRoleCompletion('fact_checker', {
      ok: true,
      value: { summary: '  Bind every metric. ', details: [' Check source A. '] },
      telemetry: {
        provider: 'nebius',
        model: 'zai-org/GLM-5.2',
        costMicroUsd: 1,
        inputTokens: 2,
        outputTokens: 3,
      },
    });
    expect(completion).toMatchObject({
      status: 'completed',
      summary: 'Bind every metric.',
      details: ['Check source A.'],
    });
  });

  it.each([
    'researcher',
    'analyst',
    'storyteller',
    'designer',
    'fact_checker',
    'reviewer',
  ] as const)('keeps the %s role advisory and operation-free', (role) => {
    const request = nodeSlideRoleProviderRequest({
      role,
      instruction: 'Refresh the decision deck.',
      boundedContext: '{"sources":["source_a"]}',
      model: 'nebius/zai-org/GLM-5.2',
      reasoningEffort: 'medium',
    });
    expect(request.jsonSchema?.schema).not.toHaveProperty('properties.operations');
    expect(request.systemPrompt).toContain(`NodeSlide's ${role.replace('_', ' ')} agent`);
    if (role === 'reviewer') {
      expect(request.systemPrompt).toContain('only approval authority');
    }
  });
});
