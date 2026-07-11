import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export interface NodeSlidePreviewQuotaBucket {
  key: string;
  limit: number;
  windowMs: number;
}

export class NodeSlidePreviewQuotaError extends Error {
  constructor() {
    super('NodeSlide free-preview quota reached. Try again after the current window.');
    this.name = 'NodeSlidePreviewQuotaError';
  }
}

export async function consumePreviewQuotaBuckets(
  ctx: MutationCtx,
  buckets: NodeSlidePreviewQuotaBucket[],
): Promise<void> {
  validatePreviewQuotaBuckets(buckets);
  const now = Date.now();
  const pending: Array<{
    bucket: NodeSlidePreviewQuotaBucket;
    windowStart: number;
    row: Doc<'nodeslide_rate_limits'> | null;
  }> = [];
  for (const bucket of buckets) {
    const windowStart = Math.floor(now / bucket.windowMs) * bucket.windowMs;
    const row = await ctx.db
      .query('nodeslide_rate_limits')
      .withIndex('by_key_window', (query) =>
        query.eq('key', bucket.key).eq('windowStart', windowStart),
      )
      .first();
    if ((row?.count ?? 0) >= bucket.limit) throw new NodeSlidePreviewQuotaError();
    pending.push({ bucket, windowStart, row });
  }

  // Do not write any bucket until every bucket has capacity. Callers can safely
  // compose quota consumption with their own writes in one Convex transaction.
  for (const { bucket, windowStart, row } of pending) {
    if (row) await ctx.db.patch(row._id, { count: row.count + 1, updatedAt: now });
    else
      await ctx.db.insert('nodeslide_rate_limits', {
        key: bucket.key,
        windowStart,
        count: 1,
        updatedAt: now,
      });
  }
}

export function validatePreviewQuotaBuckets(buckets: NodeSlidePreviewQuotaBucket[]): void {
  if (buckets.length === 0 || buckets.length > 4) throw new Error('Invalid preview quota request.');
  for (const bucket of buckets) {
    if (
      !bucket.key ||
      bucket.key.length > 128 ||
      !Number.isInteger(bucket.limit) ||
      bucket.limit < 1 ||
      bucket.limit > 10_000 ||
      !Number.isInteger(bucket.windowMs) ||
      bucket.windowMs < 60_000 ||
      bucket.windowMs > 86_400_000
    ) {
      throw new Error('Invalid preview quota bucket.');
    }
  }
}
