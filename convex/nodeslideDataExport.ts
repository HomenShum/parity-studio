import { v } from 'convex/values';
import { query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { collectNodeSlideOwnerDataExport } from './lib/nodeslideDataExport';

/**
 * Produces a complete redacted JSON bundle for exactly one owner-authorized
 * deck. This query is read-only and never advances deck/proposal versions.
 */
export const exportMyData = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    return await collectNodeSlideOwnerDataExport(ctx, {
      deck,
      ownerAccessKey: args.ownerAccessKey,
      generatedAt: Date.now(),
    });
  },
});
