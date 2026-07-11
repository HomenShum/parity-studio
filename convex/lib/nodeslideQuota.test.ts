import { describe, expect, it } from 'vitest';
import type { MutationCtx } from '../_generated/server';
import {
  NodeSlidePreviewQuotaError,
  consumePreviewQuotaBuckets,
  validatePreviewQuotaBuckets,
} from './nodeslideQuota';

describe('NodeSlide preview quota transactions', () => {
  it('validates bounded bucket definitions before storage access', () => {
    expect(() =>
      validatePreviewQuotaBuckets([{ key: 'owner', limit: 60, windowMs: 86_400_000 }]),
    ).not.toThrow();
    expect(() => validatePreviewQuotaBuckets([])).toThrow('Invalid preview quota request');
    expect(() => validatePreviewQuotaBuckets([{ key: '', limit: 0, windowMs: 1 }])).toThrow(
      'Invalid preview quota bucket',
    );
  });

  it('writes nothing when any bucket is exhausted', async () => {
    const harness = quotaHarness([null, { _id: 'global-row', count: 500 }]);

    await expect(
      consumePreviewQuotaBuckets(harness.ctx, [
        { key: 'variation:owner', limit: 60, windowMs: 86_400_000 },
        { key: 'variation:global', limit: 500, windowMs: 3_600_000 },
      ]),
    ).rejects.toBeInstanceOf(NodeSlidePreviewQuotaError);
    expect(harness.writes).toEqual([]);
  });

  it('reads every bucket before applying the atomic increment plan', async () => {
    const harness = quotaHarness([null, { _id: 'global-row', count: 42 }]);

    await consumePreviewQuotaBuckets(harness.ctx, [
      { key: 'variation:owner', limit: 60, windowMs: 86_400_000 },
      { key: 'variation:global', limit: 500, windowMs: 3_600_000 },
    ]);

    expect(harness.events).toEqual(['read', 'read', 'insert', 'patch']);
    expect(harness.writes).toEqual([
      expect.objectContaining({ kind: 'insert', value: expect.objectContaining({ count: 1 }) }),
      expect.objectContaining({ kind: 'patch', value: expect.objectContaining({ count: 43 }) }),
    ]);
  });
});

function quotaHarness(rows: Array<null | { _id: string; count: number }>) {
  const events: string[] = [];
  const writes: Array<{ kind: 'insert' | 'patch'; value: unknown }> = [];
  let readIndex = 0;
  const db = {
    query: () => ({
      withIndex: (_name: string, build: (query: unknown) => unknown) => {
        const chain = { eq: () => chain };
        build(chain);
        return {
          first: async () => {
            events.push('read');
            const row = rows[readIndex] ?? null;
            readIndex += 1;
            return row;
          },
        };
      },
    }),
    insert: async (_table: string, value: unknown) => {
      events.push('insert');
      writes.push({ kind: 'insert', value });
      return 'inserted';
    },
    patch: async (_id: string, value: unknown) => {
      events.push('patch');
      writes.push({ kind: 'patch', value });
    },
  };
  return { ctx: { db } as unknown as MutationCtx, events, writes };
}
