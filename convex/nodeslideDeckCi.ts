import { v } from 'convex/values';
import { NODESLIDE_ELEMENT_SOURCE_LIMIT } from '../shared/nodeslide';
import type { QueryCtx } from './_generated/server';
import { internalQuery, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { nodeSlideCandidateDigest } from './lib/nodeslideCandidate';
import { loadNodeSlideSnapshot } from './lib/nodeslideData';
import { type NodeSlideDeckCiResult, evaluateNodeSlideDeckCi } from './lib/nodeslideDeckCi';

export const NODESLIDE_DECK_CI_CHANGED_SOURCE_LIMIT = NODESLIDE_ELEMENT_SOURCE_LIMIT;

const NODESLIDE_DECK_CI_ID_LIMIT = 256;
const NODESLIDE_DECK_CI_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SNAPSHOT_BINDING_DENIED = 'NodeSlide Deck CI snapshot binding denied.';

const args = {
  deckId: v.string(),
  ownerAccessKey: v.string(),
  deckVersion: v.number(),
  snapshotDigest: v.string(),
  changedSourceIds: v.optional(v.array(v.string())),
};

const latestArgs = {
  deckId: v.string(),
  ownerAccessKey: v.string(),
  changedSourceIds: v.optional(v.array(v.string())),
};

interface NodeSlideDeckCiQueryArgs {
  deckId: string;
  ownerAccessKey: string;
  deckVersion: number;
  snapshotDigest: string;
  changedSourceIds?: string[];
}

interface NodeSlideDeckCiLatestQueryArgs {
  deckId: string;
  ownerAccessKey: string;
  changedSourceIds?: string[];
}

/** Evaluates Deck CI only for the owner's exact authoritative current snapshot. */
export const evaluateCurrent = query({
  args,
  handler: evaluateOwnerBoundCurrentSnapshot,
});

/** Read-only display form. The server binds the result to the authoritative latest snapshot. */
export const evaluateLatest = query({
  args: latestArgs,
  handler: evaluateOwnerLatestSnapshot,
});

/**
 * Internal form for durable jobs. It intentionally retains the owner capability gate and exact
 * snapshot binding so a stale or cross-deck job cannot evaluate a different current snapshot.
 */
export const evaluateCurrentInternal = internalQuery({
  args,
  handler: evaluateOwnerBoundCurrentSnapshot,
});

async function evaluateOwnerLatestSnapshot(
  ctx: QueryCtx,
  input: NodeSlideDeckCiLatestQueryArgs,
): Promise<NodeSlideDeckCiResult> {
  await requireOwnerAccess(ctx, input.deckId, input.ownerAccessKey);
  const changedSourceIds = requireBoundedChangedSourceIds(input.changedSourceIds);
  const snapshot = await loadNodeSlideSnapshot(ctx, input.deckId);
  if (!snapshot || snapshot.deck.id !== input.deckId) {
    throw new Error('NodeSlide deck not found.');
  }
  return evaluateNodeSlideDeckCi(snapshot, { changedSourceIds });
}

async function evaluateOwnerBoundCurrentSnapshot(
  ctx: QueryCtx,
  input: NodeSlideDeckCiQueryArgs,
): Promise<NodeSlideDeckCiResult> {
  await requireOwnerAccess(ctx, input.deckId, input.ownerAccessKey);
  const changedSourceIds = requireBoundedChangedSourceIds(input.changedSourceIds);
  if (
    !Number.isSafeInteger(input.deckVersion) ||
    input.deckVersion < 1 ||
    !NODESLIDE_DECK_CI_DIGEST_PATTERN.test(input.snapshotDigest)
  ) {
    throw new Error(SNAPSHOT_BINDING_DENIED);
  }

  const snapshot = await loadNodeSlideSnapshot(ctx, input.deckId);
  if (
    !snapshot ||
    snapshot.deck.id !== input.deckId ||
    snapshot.deck.version !== input.deckVersion ||
    nodeSlideCandidateDigest(snapshot) !== input.snapshotDigest
  ) {
    throw new Error(SNAPSHOT_BINDING_DENIED);
  }

  const result = evaluateNodeSlideDeckCi(snapshot, { changedSourceIds });
  if (
    result.deckId !== input.deckId ||
    result.deckVersion !== input.deckVersion ||
    result.snapshotDigest !== input.snapshotDigest
  ) {
    throw new Error(SNAPSHOT_BINDING_DENIED);
  }
  return result;
}

function requireBoundedChangedSourceIds(value: string[] | undefined): string[] {
  if (!value) return [];
  if (
    value.length > NODESLIDE_DECK_CI_CHANGED_SOURCE_LIMIT ||
    value.some(
      (sourceId) =>
        sourceId.length < 1 ||
        sourceId.length > NODESLIDE_DECK_CI_ID_LIMIT ||
        sourceId.trim() !== sourceId,
    )
  ) {
    throw new Error(
      `NodeSlide Deck CI changedSourceIds must contain at most ${NODESLIDE_DECK_CI_CHANGED_SOURCE_LIMIT} bounded source IDs.`,
    );
  }
  return [...value];
}
