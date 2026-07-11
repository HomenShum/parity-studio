import { describe, expect, it } from 'vitest';
import { planPreferenceEventRetention } from './nodeslidePreferenceRetention';

describe('NodeSlide preference retention', () => {
  it('prunes a 1,500-event flood to 1,000 without removing retained signal evidence', () => {
    const rows = Array.from({ length: 1_500 }, (_, index) => ({
      id: `event:${index.toString().padStart(4, '0')}`,
      recordedAt: index + 1,
      ...(index < 1_200 ? { processedAt: index + 2_000 } : {}),
    }));
    const referenced = new Set(['event:0000', 'event:1499']);
    const plan = planPreferenceEventRetention(rows, referenced);
    expect(plan.eventIdsToDelete).toHaveLength(500);
    expect(plan.retainedCount).toBe(1_000);
    expect(plan.referencedCount).toBe(2);
    expect(plan.eventIdsToDelete).not.toContain('event:0000');
    expect(plan.eventIdsToDelete).not.toContain('event:1499');
    expect(plan.eventIdsToDelete[0]).toBe('event:0001');
  });

  it('is deterministic across input order and rejects oversized reads', () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      id: `event:${index}`,
      recordedAt: index,
      processedAt: index,
    }));
    const first = planPreferenceEventRetention(rows, new Set());
    const second = planPreferenceEventRetention([...rows].reverse(), new Set());
    expect(second).toEqual(first);
    expect(first.eventIdsToDelete).toEqual(['event:0']);
    expect(() =>
      planPreferenceEventRetention(
        Array.from({ length: 1_502 }, (_, index) => ({
          id: `event:${index}`,
          recordedAt: index,
        })),
        new Set(),
      ),
    ).toThrow(/at most 1501/i);
  });
});
