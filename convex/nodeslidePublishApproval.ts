import { v } from 'convex/values';
import type { DeckSnapshot } from '../shared/nodeslide';
import { mutation, query } from './_generated/server';
import { createOwnerAccessKey, requireOwnerAccess } from './lib/nodeslideAccess';
import { findCurrentValidationRow, findDeckRow, loadNodeSlideSnapshot } from './lib/nodeslideData';
import {
  NODESLIDE_APPROVER_ROW_LIMIT,
  activeApprovals,
} from './lib/nodeslidePublishApprovalPolicy';

/**
 * Whether a validation receipt can actually authorize publication — the same bar the
 * publish gate applies (validationAllowsPublication in nodeslide.ts): the receipt must
 * match this exact deck version AND toolchain AND carry publishOk. The approver surface
 * and sign-off must use THIS definition of "validated"; a mere receipt-exists check lets
 * an approver attest a version the publish gate will reject, drifting the two surfaces.
 */
function nodeSlideValidationAuthorizesPublish(
  snapshot: DeckSnapshot,
  validation: {
    deckId: string;
    deckVersion: number;
    toolchainVersion: string;
    publishOk: boolean;
  } | null,
): boolean {
  return Boolean(
    validation &&
      validation.deckId === snapshot.deck.id &&
      validation.deckVersion === snapshot.deck.version &&
      validation.toolchainVersion === snapshot.deck.toolchainVersion &&
      validation.publishOk,
  );
}

async function requireSnapshot(
  ctx: { db: Parameters<typeof loadNodeSlideSnapshot>[0]['db'] },
  deckId: string,
): Promise<DeckSnapshot> {
  const snapshot = await loadNodeSlideSnapshot(ctx, deckId);
  if (!snapshot) throw new Error(`Deck ${deckId} not found.`);
  return snapshot;
}
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';

const APPROVER_LABEL_LIMIT = 80;
const APPROVER_LIMIT_PER_DECK = 8;

/** Owner turns the approval gate on or off for a deck. */
export const setPublishApprovalPolicy = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), required: v.boolean() },
  handler: async (ctx, args) => {
    const deckRow = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    await ctx.db.patch(deckRow._id, {
      publishApprovalRequired: args.required,
      updatedAt: Date.now(),
    });
    return { required: args.required };
  },
});

/**
 * Owner issues an approver capability. The token is returned exactly once and
 * only its digest persists — holding the token IS the approver role.
 */
export const issuePublishApprover = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), label: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const label = args.label.trim().slice(0, APPROVER_LABEL_LIMIT);
    if (!label) throw new Error('Name the approver so sign-offs stay attributable.');
    const existing = await ctx.db
      .query('nodeslide_publish_approvers')
      .withIndex('by_deck', (queryBuilder) => queryBuilder.eq('deckId', args.deckId))
      .collect();
    if (existing.filter((row) => !row.revokedAt).length >= APPROVER_LIMIT_PER_DECK) {
      throw new Error(`A deck supports at most ${APPROVER_LIMIT_PER_DECK} active approvers.`);
    }
    // Retained revoked rows are never evicted, so bound the whole table (active + revoked)
    // to keep every approver read bounded. Reaching this needs deliberate issue/revoke
    // churn; normal decks stay far below it.
    if (existing.length >= NODESLIDE_APPROVER_ROW_LIMIT) {
      throw new Error(
        'This deck has reached its approver-history limit. Revoked approvers are retained for audit; duplicate the deck to start a fresh approver history.',
      );
    }
    const token = createOwnerAccessKey();
    const now = Date.now();
    // Derive the approver id from the TOKEN digest, which is unique per issued capability
    // by construction. A timestamp-based id lets two same-millisecond issues with the same
    // label mint two rows sharing one id — two bearer tokens collapsing into one governance
    // identity, where revoking "the approver" leaves the twin token alive.
    const id = nodeslideStableId('publish_approver', args.deckId, nodeslideContentDigest(token));
    await ctx.db.insert('nodeslide_publish_approvers', {
      id,
      deckId: args.deckId,
      tokenDigest: nodeslideContentDigest(token),
      label,
      issuedAt: now,
    });
    return { approverId: id, label, token };
  },
});

export const revokePublishApprover = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), approverId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await ctx.db
      .query('nodeslide_publish_approvers')
      .withIndex('by_deck', (queryBuilder) => queryBuilder.eq('deckId', args.deckId))
      .collect()
      .then((rows) => rows.find((candidate) => candidate.id === args.approverId));
    if (!row) throw new Error('Unknown approver for this deck.');
    if (!row.revokedAt) await ctx.db.patch(row._id, { revokedAt: Date.now() });
    return { approverId: args.approverId, revoked: true };
  },
});

/**
 * The second role acts: an approver (authenticated by TOKEN, never the owner
 * key) signs off the deck's exact current version + validation receipt. The
 * sign-off is append-only and becomes stale the moment the deck changes.
 */
export const approvePublication = mutation({
  args: { deckId: v.string(), approverToken: v.string(), reviewedDeckVersion: v.number() },
  handler: async (ctx, args) => {
    const approver = await ctx.db
      .query('nodeslide_publish_approvers')
      .withIndex('by_token_digest', (queryBuilder) =>
        queryBuilder.eq('tokenDigest', nodeslideContentDigest(args.approverToken)),
      )
      .unique();
    if (!approver || approver.deckId !== args.deckId || approver.revokedAt) {
      throw new Error('This approver capability is not valid for the deck.');
    }
    const snapshot = await requireSnapshot(ctx, args.deckId);
    // Bind the attestation to the EXACT version the approver was shown. If the deck advanced
    // between that version being presented and this click landing on the server, reject — an
    // approver must never sign off on a version they did not review. Without this CAS a
    // concurrent owner edit could slide the sign-off onto unreviewed content, defeating the
    // separation-of-duties guarantee the approver gate exists to provide.
    if (snapshot.deck.version !== args.reviewedDeckVersion) {
      throw new Error(
        `The deck advanced to v${snapshot.deck.version} since v${args.reviewedDeckVersion} was presented for review. Reload and review the current version before signing off.`,
      );
    }
    const validation = await findCurrentValidationRow(ctx, args.deckId, snapshot.deck.version);
    if (!validation) {
      throw new Error('The current version has no validation receipt to approve.');
    }
    // A sign-off must bind a receipt that can actually authorize publication. The publish
    // gate additionally requires publishOk and a toolchain match (validationAllowsPublication);
    // accepting a sign-off on a weaker receipt would record an attestation that can never
    // publish — governance theater with an honest-looking success.
    if (!nodeSlideValidationAuthorizesPublish(snapshot, validation)) {
      throw new Error(
        'The current version has validation blockers, so it cannot be approved for publishing yet. Ask the owner to resolve them and re-validate first.',
      );
    }
    const now = Date.now();
    const id = nodeslideStableId(
      'publish_approval',
      args.deckId,
      String(snapshot.deck.version),
      approver.id,
    );
    const previous = await ctx.db
      .query('nodeslide_publish_approvals')
      .withIndex('by_deck_version', (queryBuilder) =>
        queryBuilder.eq('deckId', args.deckId).eq('deckVersion', snapshot.deck.version),
      )
      .collect();
    const existing = previous.find((row) => row.id === id);
    if (existing) {
      // Re-signing the same version must REFRESH the binding, not silently no-op. The
      // "current" validation receipt for a version can change (deck creation writes an
      // 'initial'-scheme receipt while a no-edit re-validate writes a versioned-scheme
      // one with a newer checkedAt); if we skipped here, the stored sign-off would keep
      // pointing at the dead receipt, publish would stay blocked with approval_stale, and
      // this mutation would still report success — a fabricated 2xx over a deadlock.
      await ctx.db.patch(existing._id, { validationId: validation.id, approvedAt: now });
    } else {
      await ctx.db.insert('nodeslide_publish_approvals', {
        id,
        deckId: args.deckId,
        deckVersion: snapshot.deck.version,
        validationId: validation.id,
        approverId: approver.id,
        approvedAt: now,
      });
    }
    return {
      deckId: args.deckId,
      deckVersion: snapshot.deck.version,
      approverLabel: approver.label,
      approvedAt: now,
    };
  },
});

/**
 * The approver's own review surface: authenticated by TOKEN, never the owner key.
 * Holding a live approver capability IS the right to review the deck before publish,
 * so this returns the real slides — an approver who cannot see the content would be
 * signing off on faith, which is governance theater, not review. Returns null (not
 * a throw) for an unknown/revoked/mismatched token so the client renders an honest
 * "capability not valid" state instead of a retry loop.
 */
export const getApproverReviewState = query({
  args: { deckId: v.string(), approverToken: v.string() },
  handler: async (ctx, args) => {
    const token = args.approverToken.trim();
    if (!token) return null;
    const approver = await ctx.db
      .query('nodeslide_publish_approvers')
      .withIndex('by_token_digest', (queryBuilder) =>
        queryBuilder.eq('tokenDigest', nodeslideContentDigest(token)),
      )
      .unique();
    if (!approver || approver.deckId !== args.deckId || approver.revokedAt) return null;
    const deckRow = await findDeckRow(ctx, args.deckId);
    const snapshot = await loadNodeSlideSnapshot(ctx, args.deckId);
    if (!deckRow || !snapshot) return null;
    const validation = await findCurrentValidationRow(ctx, args.deckId, snapshot.deck.version);
    const approvals = await ctx.db
      .query('nodeslide_publish_approvals')
      .withIndex('by_deck_version', (queryBuilder) =>
        queryBuilder.eq('deckId', args.deckId).eq('deckVersion', snapshot.deck.version),
      )
      .collect();
    return {
      approverLabel: approver.label,
      required: deckRow.publishApprovalRequired === true,
      deckVersion: snapshot.deck.version,
      validated: nodeSlideValidationAuthorizesPublish(snapshot, validation),
      alreadySignedOff: approvals.some((row) => row.approverId === approver.id),
      workspace: {
        deck: {
          title: snapshot.deck.title,
          theme: snapshot.deck.theme,
          slideOrder: snapshot.deck.slideOrder,
        },
        slides: snapshot.slides,
        elements: snapshot.elements,
      },
    };
  },
});

/** Owner-visible approval state for the current version (drives the Share UI). */
export const getPublishApprovalState = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const deckRow = await findDeckRow(ctx, args.deckId);
    const snapshot = await requireSnapshot(ctx, args.deckId);
    // Bounded read: the table is capped at NODESLIDE_APPROVER_ROW_LIMIT rows on issue, so
    // this take() never truncates — it just makes the read bound explicit and query-limit safe.
    const approvers = await ctx.db
      .query('nodeslide_publish_approvers')
      .withIndex('by_deck', (queryBuilder) => queryBuilder.eq('deckId', args.deckId))
      .take(NODESLIDE_APPROVER_ROW_LIMIT);
    const approvals = await ctx.db
      .query('nodeslide_publish_approvals')
      .withIndex('by_deck_version', (queryBuilder) =>
        queryBuilder.eq('deckId', args.deckId).eq('deckVersion', snapshot.deck.version),
      )
      .collect();
    // A revoked approver's prior sign-off no longer counts. Filter those out so the
    // owner never sees a self-contradicting "signed off by X" while X reads "revoked".
    const revokedApproverIds = new Set(
      approvers.filter((row) => row.revokedAt).map((row) => row.id),
    );
    return {
      required: deckRow?.publishApprovalRequired === true,
      deckVersion: snapshot.deck.version,
      approvers: approvers.map((row) => ({
        approverId: row.id,
        label: row.label,
        issuedAt: row.issuedAt,
        revoked: Boolean(row.revokedAt),
      })),
      currentVersionApprovals: activeApprovals(approvals, revokedApproverIds).map((row) => ({
        approverId: row.approverId,
        approvedAt: row.approvedAt,
      })),
    };
  },
});
