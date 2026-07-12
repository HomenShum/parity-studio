import { describe, expect, it } from 'vitest';
import { runNodeSlideDeckRepl } from './nodeslideDeckRepl';
import {
  NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK,
  NODESLIDE_EXECUTION_TRACE_TTL_MS,
  assertExecutionTraceBounds,
  executionTraceFromDeckRepl,
  executionTraceRetentionPlan,
} from './nodeslideExecutionTrace';
import { nodeslideContentDigest } from './nodeslideIds';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_700_000_000_000;

function replResult() {
  const snapshot = buildGoldenNodeSlide('execution-trace-tests', NOW).snapshot;
  const secret = 'sk-supersecret123456789';
  snapshot.deck.title = `Trace ${secret}`;
  return {
    snapshot,
    result: runNodeSlideDeckRepl({
      sessionId: 'session-trace',
      traceId: 'trace-execution',
      snapshot,
      commands: [{ id: 'inspect', type: 'inspect_deck' }],
      now: () => NOW,
    }),
  };
}

describe('NodeSlide bounded execution traces', () => {
  it('creates a deterministic, redacted, digest-bound Deck REPL trace', () => {
    const { snapshot, result } = replResult();
    const makeTrace = () =>
      executionTraceFromDeckRepl({
        result,
        deckId: snapshot.deck.id,
        actorSubject: 'owner-secret-capability-value',
        createdAt: NOW,
      });
    const first = makeTrace();
    const second = makeTrace();

    expect(first).toEqual(second);
    expect(first.traceDigest).toMatch(/^trace_sha256:[0-9a-f]{64}$/);
    expect(first.baseSnapshotDigest).toBe(result.snapshotDigest);
    expect(first.actorDigest).toMatch(/^actor_sha256:[0-9a-f]{64}$/);
    expect(first.actorDigest).not.toContain('owner-secret-capability-value');
    expect(JSON.stringify(first)).not.toContain('supersecret123456789');
    expect(JSON.stringify(first)).not.toContain('Trace sk-');
    expect(first.egressMode).toBe('deny');
    expect(first.allowedHosts).toEqual([]);
    expect(first.expiresAt - first.createdAt).toBe(NODESLIDE_EXECUTION_TRACE_TTL_MS);
    expect(() => assertExecutionTraceBounds(first)).not.toThrow();
  });

  it('rejects cross-deck bindings and invalid lifecycle values', () => {
    const { result } = replResult();
    expect(() =>
      executionTraceFromDeckRepl({
        result,
        deckId: 'another-deck',
        actorSubject: 'actor',
        createdAt: NOW,
      }),
    ).toThrow('deck binding');
    expect(() =>
      executionTraceFromDeckRepl({
        result,
        deckId: result.deckId,
        actorSubject: 'actor',
        createdAt: Number.NaN,
      }),
    ).toThrow('time');
  });

  it('rejects oversized step lists instead of ambiguously truncating them', () => {
    const { snapshot, result } = replResult();
    const oversized = structuredClone(result);
    while (oversized.receipts.length <= 32) {
      oversized.receipts.push(structuredClone(oversized.receipts[0]));
    }
    expect(() =>
      executionTraceFromDeckRepl({
        result: oversized,
        deckId: snapshot.deck.id,
        actorSubject: 'actor',
        createdAt: NOW,
      }),
    ).toThrow('too many step receipts');
  });

  it('rejects a persisted trace whose digest-bound fields were changed', () => {
    const { snapshot, result } = replResult();
    const trace = executionTraceFromDeckRepl({
      result,
      deckId: snapshot.deck.id,
      actorSubject: 'actor',
      createdAt: NOW,
    });
    const tampered = { ...trace, terminalReason: 'tampered' };

    expect(() => assertExecutionTraceBounds(tampered)).toThrow('digest is invalid');
  });

  it('requires canonical consent binding and public DNS hosts for egress traces', () => {
    const { snapshot, result } = replResult();
    const { traceDigest: _traceDigest, ...base } = executionTraceFromDeckRepl({
      result,
      deckId: snapshot.deck.id,
      actorSubject: 'actor',
      createdAt: NOW,
    });
    const consentDigest = `consent_${nodeslideContentDigest('consent-event-1')}`;
    const allowed = {
      ...base,
      egressMode: 'allowlist' as const,
      allowedHosts: ['data.example.com'],
      consentDigest,
    };

    expect(() => assertExecutionTraceBounds(allowed)).not.toThrow();
    for (const host of ['localhost', 'service.internal', 'singlelabel', '127.0.0.1']) {
      expect(() => assertExecutionTraceBounds({ ...allowed, allowedHosts: [host] })).toThrow(
        'host policy',
      );
    }
    expect(() =>
      assertExecutionTraceBounds({ ...allowed, consentDigest: 'consent-not-a-digest' }),
    ).toThrow('consent binding');
  });

  it('evicts expired traces first and deterministically caps active history', () => {
    const active = Array.from(
      { length: NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK + 5 },
      (_, index) => ({
        id: `active-${String(index).padStart(3, '0')}`,
        createdAt: NOW - index,
        expiresAt: NOW + 1_000,
      }),
    );
    const rows = [
      ...active,
      { id: 'expired-later', createdAt: NOW - 10, expiresAt: NOW - 1 },
      { id: 'expired-first', createdAt: NOW - 20, expiresAt: NOW - 2 },
    ];
    const plan = executionTraceRetentionPlan(rows, NOW);

    expect(plan.slice(0, 2)).toEqual(['expired-first', 'expired-later']);
    expect(plan).toHaveLength(7);
    expect(plan).toEqual(
      expect.arrayContaining([
        'active-100',
        'active-101',
        'active-102',
        'active-103',
        'active-104',
      ]),
    );
    expect(executionTraceRetentionPlan([...rows].reverse(), NOW)).toEqual(plan);
  });
});
