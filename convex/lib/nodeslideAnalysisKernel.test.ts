import { describe, expect, it, vi } from 'vitest';
import {
  type NodeSlideAnalysisJob,
  type NodeSlideAnalysisKernelAdapter,
  type NodeSlideKernelExecution,
  createDeterministicNodeSlideKernel,
  runNodeSlideAnalysisKernel,
  runNodeSlideKernelConformance,
} from './nodeslideAnalysisKernel';

const FIXED_NOW = 1_700_000_000_000;

function request(job: NodeSlideAnalysisJob) {
  return { sessionId: 'kernel-session', traceId: 'kernel-trace', job };
}

function fakeAdapter(
  execute: () => NodeSlideKernelExecution,
  overrides: Partial<NodeSlideAnalysisKernelAdapter> = {},
): NodeSlideAnalysisKernelAdapter {
  return {
    id: 'test/adapter',
    version: '1.0.0',
    capabilities: {
      jobTypes: ['summarize_table', 'derive_series', 'validate_chart'],
      deterministic: true,
      hostedBy: 'nodeslide',
      network: false,
      maxMemoryMb: 4_096,
    },
    open: () => ({ opaqueSessionId: 'opaque-test-session' }),
    execute,
    cancel: () => undefined,
    cleanup: () => undefined,
    ...overrides,
  };
}

describe('NodeSlide analysis kernel', () => {
  it('runs deterministic typed analysis with immutable, caller-owned input', () => {
    const adapter = createDeterministicNodeSlideKernel();
    const job: NodeSlideAnalysisJob = {
      type: 'summarize_table',
      columns: ['revenue'],
      rows: [{ revenue: 10 }, { revenue: 20 }, { revenue: null }],
    };
    const before = structuredClone(job);
    const first = runNodeSlideAnalysisKernel({
      adapter,
      request: request(job),
      now: () => FIXED_NOW,
    });
    const second = runNodeSlideAnalysisKernel({
      adapter,
      request: request(job),
      now: () => FIXED_NOW,
    });

    expect(first).toEqual(second);
    expect(first.terminalReason).toBe('completed');
    expect(first.cleanupConfirmed).toBe(true);
    expect(first.network).toEqual({ mode: 'deny', allowedHosts: [], consentRecorded: false });
    expect(first.output).toEqual({
      columns: { revenue: { max: 20, mean: 15, min: 10, missingCount: 1, numericCount: 2 } },
      rowCount: 3,
    });
    expect(job).toEqual(before);
  });

  it('supports deterministic series derivation and chart validation', () => {
    const adapter = createDeterministicNodeSlideKernel();
    const derived = runNodeSlideAnalysisKernel({
      adapter,
      request: request({ type: 'derive_series', operation: 'delta', values: [2, 5, 11] }),
      now: () => FIXED_NOW,
    });
    expect(derived.output).toEqual({ operation: 'delta', values: [0, 3, 6] });

    const chart = runNodeSlideAnalysisKernel({
      adapter,
      request: request({
        type: 'validate_chart',
        labels: ['A', 'B'],
        series: [{ name: 'Value', values: [1] }],
      }),
      now: () => FIXED_NOW,
    });
    expect(chart.output).toEqual({
      issues: ['series_length_mismatch:Value'],
      labelCount: 2,
      seriesCount: 1,
      valid: false,
    });
  });

  it('denies network by default and requires consent plus a narrow valid allowlist', () => {
    const job: NodeSlideAnalysisJob = {
      type: 'derive_series',
      operation: 'cumulative',
      values: [1],
    };
    const open = vi.fn(() => ({ opaqueSessionId: 'network-session' }));
    const adapter = fakeAdapter(() => ({ output: { ok: true }, steps: 1 }), {
      open,
      capabilities: {
        jobTypes: ['derive_series'],
        deterministic: false,
        hostedBy: 'provider',
        network: true,
        maxMemoryMb: 4_096,
      },
    });

    const missingConsent = runNodeSlideAnalysisKernel({
      adapter,
      request: {
        ...request(job),
        network: { mode: 'allowlist', consentId: '', allowedHosts: ['api.example.com'] },
      },
      now: () => FIXED_NOW,
    });
    expect(missingConsent.terminalReason).toBe('invalid_request');
    expect(open).not.toHaveBeenCalled();

    const localHost = runNodeSlideAnalysisKernel({
      adapter,
      request: {
        ...request(job),
        network: { mode: 'allowlist', consentId: 'consent-1', allowedHosts: ['localhost'] },
      },
      now: () => FIXED_NOW,
    });
    expect(localHost.terminalReason).toBe('invalid_request');

    const allowed = runNodeSlideAnalysisKernel({
      adapter,
      request: {
        ...request(job),
        network: {
          mode: 'allowlist',
          consentId: 'consent-1',
          allowedHosts: ['api.example.com'],
        },
      },
      now: () => FIXED_NOW,
    });
    expect(allowed.terminalReason).toBe('completed');
    expect(allowed.network).toEqual({
      mode: 'allowlist',
      allowedHosts: ['api.example.com'],
      consentRecorded: true,
    });

    const deterministic = runNodeSlideAnalysisKernel({
      adapter: createDeterministicNodeSlideKernel(),
      request: {
        ...request(job),
        network: {
          mode: 'allowlist',
          consentId: 'consent-1',
          allowedHosts: ['api.example.com'],
        },
      },
      now: () => FIXED_NOW,
    });
    expect(deterministic.terminalReason).toBe('invalid_request');
  });

  it('enforces input, output, artifact, step, memory, and wall-time ceilings', () => {
    const adapter = createDeterministicNodeSlideKernel();
    const job: NodeSlideAnalysisJob = {
      type: 'derive_series',
      operation: 'delta',
      values: [1, 2, 3],
    };
    expect(
      runNodeSlideAnalysisKernel({
        adapter,
        request: { ...request(job), budget: { maxInputBytes: 1 } },
        now: () => FIXED_NOW,
      }).terminalReason,
    ).toBe('input_budget_exhausted');
    expect(
      runNodeSlideAnalysisKernel({
        adapter,
        request: { ...request(job), budget: { maxSteps: 1 } },
        now: () => FIXED_NOW,
      }).terminalReason,
    ).toBe('step_budget_exhausted');
    expect(
      runNodeSlideAnalysisKernel({
        adapter,
        request: { ...request(job), budget: { maxOutputBytes: 1 } },
        now: () => FIXED_NOW,
      }).terminalReason,
    ).toBe('output_budget_exhausted');
    expect(
      runNodeSlideAnalysisKernel({
        adapter,
        request: { ...request(job), budget: { memoryMb: 2_048 } },
        now: () => FIXED_NOW,
      }).terminalReason,
    ).toBe('invalid_request');

    const artifactAdapter = fakeAdapter(() => ({
      output: { ok: true },
      steps: 1,
      artifacts: [{ name: 'result.csv', mimeType: 'text/csv', content: 'x'.repeat(100) }],
    }));
    expect(
      runNodeSlideAnalysisKernel({
        adapter: artifactAdapter,
        request: { ...request(job), budget: { maxArtifactBytes: 10 } },
        now: () => FIXED_NOW,
      }).terminalReason,
    ).toBe('artifact_budget_exhausted');

    let tick = FIXED_NOW;
    const slowAdapter = fakeAdapter(() => ({ output: { ok: true }, steps: 1 }), {
      open: () => {
        tick += 11;
        return { opaqueSessionId: 'slow-session' };
      },
    });
    const wall = runNodeSlideAnalysisKernel({
      adapter: slowAdapter,
      request: { ...request(job), budget: { maxWallTimeMs: 10 } },
      now: () => tick,
    });
    expect(wall.terminalReason).toBe('wall_time_exhausted');
    expect(wall.cleanupConfirmed).toBe(true);
  });

  it('cancels cooperatively and still cleans the ephemeral session', () => {
    const cancel = vi.fn();
    const cleanup = vi.fn();
    const adapter = fakeAdapter(() => ({ output: { ok: true }, steps: 1 }), { cancel, cleanup });
    const checks = [false, false, true];
    const result = runNodeSlideAnalysisKernel({
      adapter,
      request: request({ type: 'derive_series', operation: 'delta', values: [1, 2] }),
      isCancelled: () => checks.shift() ?? true,
      now: () => FIXED_NOW,
    });

    expect(result.terminalReason).toBe('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(result.cleanupConfirmed).toBe(true);
  });

  it('cleans on adapter failure, redacts telemetry, and surfaces cleanup failure', () => {
    const cleanup = vi.fn();
    const failed = runNodeSlideAnalysisKernel({
      adapter: fakeAdapter(
        () => {
          throw new Error('Bearer secret-token sk-supersecret123456789');
        },
        { cleanup },
      ),
      request: request({ type: 'derive_series', operation: 'delta', values: [1] }),
      now: () => FIXED_NOW,
    });
    expect(failed.terminalReason).toBe('adapter_failed');
    expect(failed.cleanupConfirmed).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(JSON.stringify(failed.telemetry)).not.toContain('supersecret123456789');
    expect(JSON.stringify(failed.telemetry)).not.toContain('secret-token');

    const cleanupFailed = runNodeSlideAnalysisKernel({
      adapter: fakeAdapter(() => ({ output: { ok: true }, steps: 1 }), {
        cleanup: () => {
          throw new Error('cleanup failed');
        },
      }),
      request: request({ type: 'derive_series', operation: 'delta', values: [1] }),
      now: () => FIXED_NOW,
    });
    expect(cleanupFailed.terminalReason).toBe('cleanup_failed');
    expect(cleanupFailed.cleanupConfirmed).toBe(false);
  });

  it('produces deterministic artifact digests without returning raw artifact content', () => {
    const adapter = fakeAdapter(() => ({
      output: { rows: 2 },
      steps: 1,
      artifacts: [{ name: 'chart.csv', mimeType: 'text/csv', content: 'label,value\nA,1' }],
    }));
    const run = () =>
      runNodeSlideAnalysisKernel({
        adapter,
        request: request({ type: 'derive_series', operation: 'delta', values: [1] }),
        now: () => FIXED_NOW,
      });
    const first = run();
    const second = run();

    expect(first.artifacts).toEqual(second.artifacts);
    expect(first.artifacts[0]?.digest).toMatch(/^artifact_sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(first.artifacts)).not.toContain('label,value');
  });

  it('rejects unsupported or digest-mismatched jobs before execution', () => {
    const execute = vi.fn(() => ({ output: {}, steps: 1 }));
    const adapter = fakeAdapter(execute, {
      capabilities: {
        jobTypes: ['derive_series'],
        deterministic: true,
        hostedBy: 'nodeslide',
        network: false,
        maxMemoryMb: 1_024,
      },
    });
    const unsupported = runNodeSlideAnalysisKernel({
      adapter,
      request: request({ type: 'validate_chart', labels: ['A'], series: [] }),
      now: () => FIXED_NOW,
    });
    expect(unsupported.terminalReason).toBe('unsupported_job');
    expect(execute).not.toHaveBeenCalled();

    const mismatch = runNodeSlideAnalysisKernel({
      adapter,
      request: {
        ...request({ type: 'derive_series', operation: 'delta', values: [1] }),
        inputDigest: 'input_wrong',
      },
      now: () => FIXED_NOW,
    });
    expect(mismatch.terminalReason).toBe('input_digest_mismatch');
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the reusable adapter conformance suite', () => {
    const result = runNodeSlideKernelConformance(createDeterministicNodeSlideKernel());
    expect(result.passed).toBe(true);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });
});
