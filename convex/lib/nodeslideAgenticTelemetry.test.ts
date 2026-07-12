import { describe, expect, it } from 'vitest';
import { summarizeNodeSlideExecutionTraces } from './nodeslideAgenticTelemetry';
import { runNodeSlideDeckRepl } from './nodeslideDeckRepl';
import { executionTraceDigest, executionTraceFromDeckRepl } from './nodeslideExecutionTrace';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_700_000_000_000;

function trace(args: { id: string; stale?: boolean; cohort?: string; cleanup?: boolean }) {
  const snapshot = buildGoldenNodeSlide(`telemetry-${args.id}`, NOW).snapshot;
  const result = runNodeSlideDeckRepl({
    sessionId: `session-${args.id}`,
    traceId: `trace-${args.id}`,
    snapshot,
    ...(args.stale ? { expectedSnapshotDigest: 'snapshot_stale' } : {}),
    commands: [{ id: 'inspect', type: 'inspect_deck' }],
    now: () => NOW,
  });
  const created = executionTraceFromDeckRepl({
    result,
    deckId: snapshot.deck.id,
    actorSubject: 'owner-secret-capability',
    createdAt: NOW + (args.stale ? 1 : 0),
    cohort: args.cohort ?? 'founder-shadow',
  });
  if (args.cleanup !== false) return created;
  const changed = { ...created, cleanupConfirmed: false };
  return { ...changed, traceDigest: executionTraceDigest(changed) };
}

describe('NodeSlide agentic telemetry aggregation', () => {
  it('deterministically groups bounded traces by cohort and adapter', () => {
    const traces = [trace({ id: 'ok' }), trace({ id: 'stale', stale: true, cleanup: false })];
    const first = summarizeNodeSlideExecutionTraces(traces);
    const second = summarizeNodeSlideExecutionTraces([...traces].reverse());

    expect(first).toEqual(second);
    expect(first.sampleSize).toBe(2);
    expect(first.totals).toMatchObject({
      requests: 2,
      completed: 1,
      stopped: 1,
      cleanupFailures: 1,
      egressSessions: 0,
    });
    expect(first.groups).toHaveLength(1);
    expect(first.groups[0]?.terminalReasons).toEqual({ completed: 1, stale_snapshot: 1 });
    expect(first.summaryDigest).toMatch(/^telemetry_sha256:[0-9a-f]{64}$/);
  });

  it('does not expose actor capabilities or raw deck content', () => {
    const summary = summarizeNodeSlideExecutionTraces([trace({ id: 'redaction' })]);
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain('owner-secret-capability');
    expect(serialized).not.toContain('NodeSlide product brief');
  });

  it('rejects unbounded input collections', () => {
    const sample = trace({ id: 'bounded' });
    expect(() =>
      summarizeNodeSlideExecutionTraces(Array.from({ length: 1_001 }, () => sample)),
    ).toThrow('at most 1000 traces');
  });
});
