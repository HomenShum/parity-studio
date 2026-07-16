import { v } from 'convex/values';
import type { NodeSlidePresentationQualityReceipt } from '../shared/nodeslideAuthoringQuality';
import {
  evaluateNodeSlidePresentationQuality,
  verifyNodeSlidePresentationQualityReceipt,
} from '../shared/nodeslideAuthoringQuality';
import type { NodeSlideJourneyProof } from '../shared/nodeslideJourneyProof';
import { query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { loadNodeSlideSnapshot } from './lib/nodeslideData';

const RECEIPT_JSON_LIMIT = 200_000;

/**
 * Owner-gated, read-only release preflight. Artifact proof is optional input but
 * remains a blocker under the default policy, so callers cannot silently claim
 * release readiness from content checks alone.
 */
export const evaluateLatest = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    journeyProofJson: v.optional(v.string()),
    referenceReceiptJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const snapshot = await loadNodeSlideSnapshot(ctx, args.deckId);
    if (!snapshot || snapshot.deck.id !== args.deckId) throw new Error('NodeSlide deck not found.');
    const journeyProof = parseBoundedJson<NodeSlideJourneyProof>(
      args.journeyProofJson,
      'journey proof',
    );
    const referenceReceipt = parseBoundedJson<NodeSlidePresentationQualityReceipt>(
      args.referenceReceiptJson,
      'reference receipt',
    );
    if (referenceReceipt && !verifyNodeSlidePresentationQualityReceipt(referenceReceipt)) {
      throw new Error('NodeSlide reference quality receipt is invalid.');
    }
    const receipt = evaluateNodeSlidePresentationQuality(snapshot, {
      ...(journeyProof ? { journeyProof } : {}),
      ...(referenceReceipt ? { referenceReceipt } : {}),
    });
    return {
      receipt,
      releaseReady: receipt.status !== 'fail',
      contract: {
        acceptsWithoutReview: false,
        requiresJourneyProof: true,
        requiresEditableExport: true,
        requiresExactSingleVersionAdvance: true,
      },
    };
  },
});

function parseBoundedJson<T>(value: string | undefined, label: string): T | undefined {
  if (value === undefined) return undefined;
  if (value.length < 2 || value.length > RECEIPT_JSON_LIMIT) {
    throw new Error(`NodeSlide ${label} JSON is outside the allowed size.`);
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed as T;
  } catch {
    throw new Error(`NodeSlide ${label} JSON is invalid.`);
  }
}
