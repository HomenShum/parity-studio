import { v } from 'convex/values';
import { planSignatureApplication } from '../shared/nodeslideSignatureApply';
import { mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { loadNodeSlideSnapshot, loadNodeSlideWorkspace } from './lib/nodeslideData';
import {
  NODESLIDE_SIGNATURE_PROFILE_LIST_BYTES,
  NODESLIDE_SIGNATURE_PROFILE_LIST_LIMIT,
  findSignatureProfile,
  parseSignatureProfileFromStorage,
  serializeSignatureProfileForStorage,
  signatureProfileFromRow,
  signatureProfileRowId,
} from './lib/nodeslideSignatureProfiles';
import { validateNodeSlideSnapshot } from './lib/nodeslideValidation';

export const saveProfile = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), profileJson: v.string() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const profile = parseSignatureProfileFromStorage(args.profileJson);
    const profileJson = serializeSignatureProfileForStorage(profile);
    const existing = await findSignatureProfile(ctx, deck.projectId, profile.id);
    const now = Date.now();
    const fields = {
      sourceDigest: profile.source.digest,
      sourceKind: profile.source.kind,
      name: profile.name,
      confidence: profile.confidence,
      warningCount: profile.warnings.length,
      profileJson,
      updatedAt: now,
    };
    if (existing) {
      if (existing.sourceDigest !== profile.source.digest) {
        throw new Error('Conflicting signature profile identity.');
      }
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert('nodeslide_signature_profiles', {
        id: signatureProfileRowId(deck.projectId, profile.id),
        tenantId: deck.projectId,
        profileId: profile.id,
        ...fields,
        createdAt: now,
      });
    }
    return profileJson;
  },
});

export const listProfiles = query({
  args: { deckId: v.string(), ownerAccessKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const limit = args.limit ?? NODESLIDE_SIGNATURE_PROFILE_LIST_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > NODESLIDE_SIGNATURE_PROFILE_LIST_LIMIT) {
      throw new Error(
        `Signature profile limit must be between 1 and ${NODESLIDE_SIGNATURE_PROFILE_LIST_LIMIT}.`,
      );
    }
    const rows = await ctx.db
      .query('nodeslide_signature_profiles')
      .withIndex('by_tenant_updated', (index) => index.eq('tenantId', deck.projectId))
      .order('desc')
      .take(limit);
    const profileJsonRows: string[] = [];
    let responseBytes = 0;
    for (const row of rows) {
      const profileJson = serializeSignatureProfileForStorage(signatureProfileFromRow(row));
      const profileBytes = new TextEncoder().encode(profileJson).byteLength;
      if (responseBytes + profileBytes > NODESLIDE_SIGNATURE_PROFILE_LIST_BYTES) break;
      profileJsonRows.push(profileJson);
      responseBytes += profileBytes;
    }
    return profileJsonRows;
  },
});

export const clearActiveProfile = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const snapshot = await loadNodeSlideSnapshot(ctx, deck.id);
    if (!snapshot) throw new Error('Deck unavailable.');
    const {
      activeSignatureProfileId: _activeProfileId,
      activeSignatureProfileDigest: _activeProfileDigest,
      ...clearedDeck
    } = snapshot.deck;
    const now = Date.now();
    await ctx.db.patch(deck._id, {
      activeSignatureProfileId: undefined,
      activeSignatureProfileDigest: undefined,
      updatedAt: now,
    });
    const validation = validateNodeSlideSnapshot({ ...snapshot, deck: clearedDeck }, now);
    await ctx.db.insert('nodeslide_validations', validation);
    return await loadNodeSlideWorkspace(ctx, deck.id, now);
  },
});

export const activateProfile = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await findSignatureProfile(ctx, deck.projectId, args.profileId);
    if (!row) throw new Error('Signature profile unavailable.');
    const profile = signatureProfileFromRow(row);
    const snapshot = await loadNodeSlideSnapshot(ctx, deck.id);
    if (!snapshot) throw new Error('Deck unavailable.');
    const application = planSignatureApplication(snapshot, profile);
    if (application.ok || application.error.code !== 'already_applied') {
      throw new Error('Apply this signature through a reviewable patch before activation.');
    }
    const now = Date.now();
    const activeSnapshot = {
      ...snapshot,
      deck: {
        ...snapshot.deck,
        activeSignatureProfileId: profile.id,
        activeSignatureProfileDigest: profile.source.digest,
        updatedAt: now,
      },
    };
    const validation = validateNodeSlideSnapshot(activeSnapshot, now, undefined, {
      signatureProfile: profile,
    });
    await ctx.db.patch(deck._id, {
      activeSignatureProfileId: profile.id,
      activeSignatureProfileDigest: profile.source.digest,
      updatedAt: now,
    });
    await ctx.db.insert('nodeslide_validations', validation);
    return await loadNodeSlideWorkspace(ctx, deck.id, now);
  },
});
