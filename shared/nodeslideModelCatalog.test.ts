import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_AGENT_MODELS,
  NODESLIDE_DEFAULT_REASONING_EFFORT,
  NODESLIDE_REASONING_EFFORTS,
  nodeSlideModelSupportsReasoningEffort,
} from './nodeslide';

describe('NodeSlide provider-native model metadata', () => {
  it('exposes exact provider effort values and labels with Medium as the normal default', () => {
    expect(NODESLIDE_REASONING_EFFORTS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'XHigh' },
      { id: 'max', label: 'Max' },
    ]);
    expect(NODESLIDE_DEFAULT_REASONING_EFFORT).toBe('medium');
  });

  it('filters extended efforts to the exact capabilities of each pinned model', () => {
    expect(
      Object.fromEntries(
        NODESLIDE_AGENT_MODELS.map((model) => [model.id, [...model.supportedEfforts]]),
      ),
    ).toEqual({
      'nebius/zai-org/GLM-5.2': ['low', 'medium', 'high'],
      'z-ai/glm-5.2': ['low', 'medium', 'high', 'xhigh'],
      'anthropic/claude-sonnet-5': ['low', 'medium', 'high', 'xhigh', 'max'],
      'anthropic/claude-fable-5': ['low', 'medium', 'high'],
      'google/gemini-3.5-flash': ['low', 'medium', 'high'],
      'google/gemini-3.1-pro-preview': ['low', 'medium', 'high'],
      'openai/gpt-5.6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
      'openai/gpt-5.6-sol': ['low', 'medium', 'high', 'xhigh', 'max'],
      'openai/gpt-5.6-terra': ['low', 'medium', 'high', 'xhigh', 'max'],
    });

    expect(nodeSlideModelSupportsReasoningEffort('z-ai/glm-5.2', 'max')).toBe(false);
    expect(nodeSlideModelSupportsReasoningEffort('anthropic/claude-fable-5', 'xhigh')).toBe(false);
    expect(nodeSlideModelSupportsReasoningEffort('anthropic/claude-sonnet-5', 'max')).toBe(true);
    expect(nodeSlideModelSupportsReasoningEffort('openai/gpt-5.6-luna', 'xhigh')).toBe(true);
  });
});
