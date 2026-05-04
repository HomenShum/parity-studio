import { describe, expect, it } from 'vitest';
import { buildAgentRuntimeMetadata, filterSafeAgentEnv } from './agentRuntime';

describe('agentRuntime', () => {
  it('returns runtime profiles and model-specific provider env allowlist', () => {
    const metadata = buildAgentRuntimeMetadata(['claude-sonnet-4-6', 'moonshotai/kimi-k2.6']);
    expect(metadata.profiles.some((profile) => profile.id === 'claude-code')).toBe(true);
    expect(metadata.launchCommands).toContainEqual(
      expect.objectContaining({ platform: 'windows', command: 'npx.cmd' }),
    );
    expect(metadata.providerEnvAllowlist).toContain('ANTHROPIC_API_KEY');
    expect(metadata.providerEnvAllowlist).toContain('OPENROUTER_API_KEY');
  });

  it('filters unrelated provider keys from child agent env', () => {
    const env = filterSafeAgentEnv(
      {
        PATH: 'bin',
        ANTHROPIC_API_KEY: 'anthropic',
        OPENAI_API_KEY: 'openai',
        GEMINI_API_KEY: 'gemini',
        RANDOM_SECRET: 'do-not-copy',
      },
      ['gpt-5.1'],
    );
    expect(env.OPENAI_API_KEY).toBe('openai');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.RANDOM_SECRET).toBeUndefined();
  });
});
