import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_PREFERENCE_RETENTION_SCAN_LIMIT,
  type PreferenceRetentionSignalCandidate,
  planPreferenceEventRetention,
} from './nodeslidePreferenceRetention';

const TENANT_ID = 'tenant:local';
const ACTOR_ID = 'actor:local';

describe('NodeSlide preference retention', () => {
  it('prunes a 1,500-event flood to 1,000 without removing retained signal evidence', () => {
    const rows = makeRows(1_500);
    const referenced = new Set(['event:0000', 'event:1499']);
    const plan = planPreferenceEventRetention(rows, referenced);
    expect(plan.eventIdsToDelete).toHaveLength(500);
    expect(plan.retainedCount).toBe(1_000);
    expect(plan.referencedCount).toBe(2);
    expect(plan.eventIdsToDelete).not.toContain('event:0000');
    expect(plan.eventIdsToDelete).not.toContain('event:1499');
    expect(plan.eventIdsToDelete[0]).toBe('event:0001');
    expect(plan.receipt).toMatchObject({
      limit: 1_000,
      beforeCount: 1_500,
      deletedEventCount: 500,
      postCount: 1_000,
      postCountAtOrBelowLimit: true,
      noDanglingReferences: true,
    });
  });

  it('evicts the oldest complete signals when 1,600 distinct events are referenced', () => {
    const rows = makeRows(NODESLIDE_PREFERENCE_RETENTION_SCAN_LIMIT, true);
    const signals = Array.from({ length: 100 }, (_, signalIndex) => {
      const evidenceEventIds = Array.from({ length: 16 }, (_, evidenceIndex) =>
        eventId(signalIndex * 16 + evidenceIndex),
      );
      return makeSignal(signalIndex, evidenceEventIds);
    });

    const first = planPreferenceEventRetention(rows, signals, {
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
    });
    const reordered = planPreferenceEventRetention([...rows].reverse(), [...signals].reverse(), {
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
    });

    expect(reordered).toEqual(first);
    expect(first.signalIdsToEvict).toEqual(
      Array.from({ length: 38 }, (_, index) => signalId(index)),
    );
    expect(first.eventIdsToDelete).toEqual([
      ...Array.from({ length: 608 }, (_, index) => eventId(index)),
      ...Array.from({ length: 192 }, (_, index) => eventId(index + 1_600)),
    ]);
    expect(first.receipt).toEqual({
      limit: 1_000,
      beforeCount: 1_800,
      deletedEventCount: 800,
      postCount: 1_000,
      inputSignalCount: 100,
      evictedSignalCount: 38,
      retainedSignalCount: 62,
      retainedEvidenceEventCount: 992,
      evictedSignalIds: Array.from({ length: 38 }, (_, index) => signalId(index)),
      postCountAtOrBelowLimit: true,
      noDanglingReferences: true,
    });

    const deleted = new Set(first.eventIdsToDelete);
    const evicted = new Set(first.signalIdsToEvict);
    const retainedSignals = signals.filter((signal) => !evicted.has(signal.id));
    expect(
      retainedSignals.every(
        (signal) =>
          signal.evidenceEventIds.every((eventId) => !deleted.has(eventId)) &&
          signal.evaluatorInputEventIds.every((eventId) => !deleted.has(eventId)),
      ),
    ).toBe(true);

    const rerun = planPreferenceEventRetention(
      rows.filter((row) => !deleted.has(row.id)).reverse(),
      [...retainedSignals].reverse(),
      { tenantId: TENANT_ID, actorId: ACTOR_ID },
    );
    expect(rerun.eventIdsToDelete).toEqual([]);
    expect(rerun.signalIdsToEvict).toEqual([]);
    expect(rerun.receipt).toMatchObject({
      beforeCount: 1_000,
      postCount: 1_000,
      deletedEventCount: 0,
      evictedSignalCount: 0,
      postCountAtOrBelowLimit: true,
      noDanglingReferences: true,
    });
  });

  it('protects source-event ancestry for retained evidence', () => {
    const rows = makeRows(1_001, true).map((row) =>
      row.id === eventId(1_000) ? { ...row, sourceEventId: eventId(0) } : row,
    );
    const signal = makeSignal(0, [eventId(1_000)]);
    const plan = planPreferenceEventRetention(rows, [signal], {
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
    });

    expect(plan.eventIdsToDelete).toEqual([eventId(1)]);
    expect(plan.retainedEventIds).toContain(eventId(0));
    expect(plan.retainedEventIds).toContain(eventId(1_000));
    expect(plan.signalIdsToEvict).toEqual([]);
    expect(plan.receipt.noDanglingReferences).toBe(true);
  });

  it('cascades deletion through unreferenced source-event descendants', () => {
    const rows = makeRows(1_001, true).map((row) =>
      row.id === eventId(1_000) ? { ...row, sourceEventId: eventId(0) } : row,
    );
    const plan = planPreferenceEventRetention(rows, [], {
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
    });

    expect(plan.eventIdsToDelete).toEqual([eventId(0), eventId(1_000)]);
    expect(plan.retainedCount).toBe(999);
    expect(plan.receipt).toMatchObject({
      postCount: 999,
      postCountAtOrBelowLimit: true,
      noDanglingReferences: true,
    });
  });

  it('does not let foreign or inconsistent signal evidence pin local actor events', () => {
    const rows = makeRows(1_001, true);
    const foreign = {
      ...makeSignal(0, [eventId(0)]),
      tenantId: 'tenant:foreign',
      actorId: 'actor:foreign',
    };
    const inconsistent = {
      ...makeSignal(1, [eventId(1)]),
      evaluatorInputEventIds: [eventId(2)],
    };
    const plan = planPreferenceEventRetention(rows, [foreign, inconsistent], {
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
    });

    expect(plan.signalIdsToEvict).toEqual([signalId(0), signalId(1)]);
    expect(plan.eventIdsToDelete).toEqual([eventId(0)]);
    expect(plan.receipt.noDanglingReferences).toBe(true);
  });

  it('is deterministic across input order and rejects reads beyond the bounded repair window', () => {
    const rows = makeRows(1_001);
    const first = planPreferenceEventRetention(rows, new Set());
    const second = planPreferenceEventRetention([...rows].reverse(), new Set());
    expect(second).toEqual(first);
    expect(first.eventIdsToDelete).toEqual([eventId(0)]);
    expect(() =>
      planPreferenceEventRetention(
        makeRows(NODESLIDE_PREFERENCE_RETENTION_SCAN_LIMIT + 1),
        new Set(),
      ),
    ).toThrow(/at most 1800/i);
  });
});

function makeRows(count: number, scoped = false) {
  return Array.from({ length: count }, (_, index) => ({
    id: eventId(index),
    ...(scoped ? { tenantId: TENANT_ID, actorId: ACTOR_ID } : {}),
    recordedAt: index + 1,
    ...(index < Math.min(count, 1_200) ? { processedAt: index + 2_000 } : {}),
  }));
}

function makeSignal(index: number, evidenceEventIds: string[]): PreferenceRetentionSignalCandidate {
  return {
    id: signalId(index),
    tenantId: TENANT_ID,
    actorId: ACTOR_ID,
    createdAt: index + 1,
    evidenceEventIds,
    evaluatorInputEventIds: [...evidenceEventIds],
  };
}

function eventId(index: number): string {
  return `event:${index.toString().padStart(4, '0')}`;
}

function signalId(index: number): string {
  return `signal:${index.toString().padStart(3, '0')}`;
}
