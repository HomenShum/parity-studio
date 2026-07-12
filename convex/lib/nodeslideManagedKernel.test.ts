import { describe, expect, it, vi } from 'vitest';
import { resolveNodeSlideAgenticControls } from './nodeslideAgenticControls';
import {
  type NodeSlideManagedKernelTransport,
  createOpenAiCodeInterpreterKernelAdapter,
  createProviderManagedNodeSlideKernelAdapter,
  runNodeSlideManagedKernel,
} from './nodeslideManagedKernel';

const NOW = 1_700_000_000_000;

function controls(extra: Record<string, string> = {}) {
  return resolveNodeSlideAgenticControls({
    NODESLIDE_AGENTIC_GLOBAL_ENABLED: 'true',
    NODESLIDE_AGENTIC_SHADOW_ENABLED: 'true',
    NODESLIDE_AGENTIC_KERNEL_ENABLED: 'true',
    NODESLIDE_AGENTIC_KERNEL_ALLOWLIST: 'openai/code-interpreter',
    ...extra,
  });
}

function transport(overrides: Partial<NodeSlideManagedKernelTransport> = {}) {
  return {
    open: vi.fn(async () => ({ opaqueSessionId: 'provider-session' })),
    execute: vi.fn(async () => ({
      output: { values: [0, 2, 5] },
      steps: 2,
      artifacts: [{ name: 'series.json', mimeType: 'application/json', content: '[0,2,5]' }],
      telemetry: {
        provider: 'openai',
        resolvedModel: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
        costMicroUsd: 25,
        latencyMs: 500,
        retries: 0,
        fallbackUsed: false,
      },
    })),
    cancel: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
    ...overrides,
  } satisfies NodeSlideManagedKernelTransport;
}

function request() {
  return {
    sessionId: 'managed-session',
    traceId: 'managed-trace',
    job: { type: 'derive_series' as const, operation: 'delta' as const, values: [1, 3, 8] },
  };
}

describe('NodeSlide managed analysis-kernel adapter seam', () => {
  it('fails closed before opening a provider session', async () => {
    const bridge = transport();
    const adapter = createOpenAiCodeInterpreterKernelAdapter({ transport: bridge, model: 'gpt-5' });
    const result = await runNodeSlideManagedKernel({
      adapter,
      request: request(),
      controls: resolveNodeSlideAgenticControls({}),
      now: () => NOW,
    });

    expect(result.terminalReason).toBe('invalid_request');
    expect(bridge.open).not.toHaveBeenCalled();
  });

  it('runs an allowlisted no-egress provider adapter and confirms cleanup', async () => {
    const bridge = transport();
    const adapter = createOpenAiCodeInterpreterKernelAdapter({ transport: bridge, model: 'gpt-5' });
    const result = await runNodeSlideManagedKernel({
      adapter,
      request: request(),
      controls: controls(),
      now: () => NOW,
    });

    expect(result.terminalReason).toBe('completed');
    expect(result.inputDigest).toMatch(/^input_sha256:[0-9a-f]{64}$/);
    expect(result.outputDigest).toMatch(/^output_sha256:[0-9a-f]{64}$/);
    expect(result.network).toEqual({ mode: 'deny', allowedHosts: [], consentRecorded: false });
    expect(result.cleanupConfirmed).toBe(true);
    expect(result.artifacts[0]).toMatchObject({
      name: 'series.json',
      mimeType: 'application/json',
      sizeBytes: 7,
    });
    expect(result.artifacts[0]?.digest).toMatch(/^artifact_sha256:[0-9a-f]{64}$/);
    expect(result.telemetry).toMatchObject({ provider: 'openai', resolvedModel: 'gpt-5' });
    expect(JSON.stringify(result)).not.toContain('provider-session');
  });

  it('keeps Code Interpreter egress denied even when the global egress switch is enabled', async () => {
    const bridge = transport();
    const adapter = createOpenAiCodeInterpreterKernelAdapter({ transport: bridge, model: 'gpt-5' });
    const result = await runNodeSlideManagedKernel({
      adapter,
      request: {
        ...request(),
        network: {
          mode: 'allowlist',
          consentId: 'consent-1',
          allowedHosts: ['data.example.com'],
        },
      },
      controls: controls({ NODESLIDE_AGENTIC_NETWORK_EGRESS_ENABLED: 'true' }),
      now: () => NOW,
    });

    expect(result.terminalReason).toBe('invalid_request');
    expect(bridge.open).not.toHaveBeenCalled();
  });

  it('requires separate egress authorization, explicit consent, and public hosts', async () => {
    const bridge = transport();
    const adapter = createProviderManagedNodeSlideKernelAdapter({
      id: 'provider/network-kernel',
      version: '1.0.0',
      providerId: 'provider',
      model: 'model-v1',
      jobTypes: ['derive_series'],
      network: true,
      maxMemoryMb: 1_024,
      transport: bridge,
    });
    const networkControls = resolveNodeSlideAgenticControls({
      NODESLIDE_AGENTIC_GLOBAL_ENABLED: 'true',
      NODESLIDE_AGENTIC_SHADOW_ENABLED: 'true',
      NODESLIDE_AGENTIC_KERNEL_ENABLED: 'true',
      NODESLIDE_AGENTIC_KERNEL_ALLOWLIST: 'provider/network-kernel',
      NODESLIDE_AGENTIC_NETWORK_EGRESS_ENABLED: 'true',
    });
    const allowed = await runNodeSlideManagedKernel({
      adapter,
      request: {
        ...request(),
        network: {
          mode: 'allowlist',
          consentId: 'consent-1',
          allowedHosts: ['data.example.com'],
        },
      },
      controls: networkControls,
      now: () => NOW,
    });
    const privateHost = await runNodeSlideManagedKernel({
      adapter,
      request: {
        ...request(),
        network: { mode: 'allowlist', consentId: 'consent-1', allowedHosts: ['localhost'] },
      },
      controls: networkControls,
      now: () => NOW,
    });

    expect(allowed.terminalReason).toBe('completed');
    expect(allowed.network).toEqual({
      mode: 'allowlist',
      allowedHosts: ['data.example.com'],
      consentRecorded: true,
    });
    expect(privateHost.terminalReason).toBe('invalid_request');
  });

  it('cancels before execution and still cleans the provider session', async () => {
    const bridge = transport();
    const adapter = createOpenAiCodeInterpreterKernelAdapter({ transport: bridge, model: 'gpt-5' });
    const result = await runNodeSlideManagedKernel({
      adapter,
      request: request(),
      controls: controls(),
      isCancelled: () => true,
      now: () => NOW,
    });

    expect(result.terminalReason).toBe('cancelled');
    expect(bridge.cancel).toHaveBeenCalledOnce();
    expect(bridge.execute).not.toHaveBeenCalled();
    expect(result.cleanupConfirmed).toBe(true);
  });

  it('turns cleanup failure into a hard terminal failure', async () => {
    const bridge = transport({ cleanup: vi.fn(async () => Promise.reject(new Error('secret'))) });
    const adapter = createOpenAiCodeInterpreterKernelAdapter({ transport: bridge, model: 'gpt-5' });
    const result = await runNodeSlideManagedKernel({
      adapter,
      request: request(),
      controls: controls(),
      now: () => NOW,
    });

    expect(result.terminalReason).toBe('cleanup_failed');
    expect(result.cleanupConfirmed).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('collapses synchronous lifecycle failures without leaking adapter errors', async () => {
    const bridge = transport({
      cleanup: vi.fn(() => {
        throw new Error('synchronous-secret');
      }),
    });
    const adapter = createOpenAiCodeInterpreterKernelAdapter({ transport: bridge, model: 'gpt-5' });
    const result = await runNodeSlideManagedKernel({
      adapter,
      request: request(),
      controls: controls(),
      now: () => NOW,
    });

    expect(result.terminalReason).toBe('cleanup_failed');
    expect(result.cleanupConfirmed).toBe(false);
    expect(JSON.stringify(result)).not.toContain('synchronous-secret');
  });

  it('enforces output and step budgets after provider execution', async () => {
    const bridge = transport({
      execute: vi.fn(async () => ({ output: 'x'.repeat(1_000), steps: 5 })),
    });
    const adapter = createOpenAiCodeInterpreterKernelAdapter({ transport: bridge, model: 'gpt-5' });
    const result = await runNodeSlideManagedKernel({
      adapter,
      request: { ...request(), budget: { maxOutputBytes: 100, maxSteps: 2 } },
      controls: controls(),
      now: () => NOW,
    });

    expect(result.terminalReason).toBe('step_budget_exhausted');
    expect(result.output).toBeUndefined();
    expect(result.cleanupConfirmed).toBe(true);
  });

  it('accounts for raw provider output before sanitizing the authorized result', async () => {
    const bridge = transport({
      execute: vi.fn(async () => ({ output: 'x'.repeat(100_000), steps: 1 })),
    });
    const adapter = createOpenAiCodeInterpreterKernelAdapter({ transport: bridge, model: 'gpt-5' });
    const result = await runNodeSlideManagedKernel({
      adapter,
      request: { ...request(), budget: { maxOutputBytes: 20_000 } },
      controls: controls(),
      now: () => NOW,
    });

    expect(result.terminalReason).toBe('output_budget_exhausted');
    expect(result.usage.outputBytes).toBe(100_000);
    expect(result.output).toBeUndefined();
  });

  it('aborts, cancels, and cleans an unresponsive provider at the wall-time limit', async () => {
    const execute = vi.fn(
      async (
        _session: Parameters<NodeSlideManagedKernelTransport['execute']>[0],
        _job: Parameters<NodeSlideManagedKernelTransport['execute']>[1],
        _options: Parameters<NodeSlideManagedKernelTransport['execute']>[2],
      ) => new Promise<never>(() => undefined),
    );
    const bridge = transport({
      execute,
    });
    const adapter = createOpenAiCodeInterpreterKernelAdapter({ transport: bridge, model: 'gpt-5' });
    const result = await runNodeSlideManagedKernel({
      adapter,
      request: { ...request(), budget: { maxWallTimeMs: 25 } },
      controls: controls(),
      now: Date.now,
    });

    expect(result.terminalReason).toBe('wall_time_exhausted');
    expect(bridge.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ opaqueSessionId: 'provider-session' }),
      'wall_time_exhausted',
    );
    expect(bridge.cleanup).toHaveBeenCalledOnce();
    expect(result.cleanupConfirmed).toBe(true);
    expect(execute.mock.calls[0]?.[2]?.signal.aborted).toBe(true);
  });
});
