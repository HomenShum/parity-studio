import { v } from 'convex/values';
import type { DeckSnapshot } from '../shared/nodeslide';
import { planSignatureApplication } from '../shared/nodeslideSignatureApply';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { loadNodeSlideSnapshot, loadNodeSlideWorkspace } from './lib/nodeslideData';
import { nodeslideStableId } from './lib/nodeslideIds';
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
    const existing = await findSignatureProfile(
      ctx,
      deck.projectId,
      profile.id,
      profile.source.digest,
    );
    if (existing) {
      signatureProfileFromRow(existing);
      if (existing.profileJson !== profileJson) {
        throw new Error('Signature profile identity/digest is already bound to different content.');
      }
      return profileJson;
    }

    const rowId = signatureProfileRowId(deck.projectId, profile.id, profile.source.digest);
    const now = Date.now();
    await ctx.db.insert('nodeslide_signature_profiles', {
      id: rowId,
      tenantId: deck.projectId,
      profileId: profile.id,
      sourceDigest: profile.source.digest,
      sourceKind: profile.source.kind,
      name: profile.name,
      confidence: profile.confidence,
      warningCount: profile.warnings.length,
      profileJson,
      createdAt: now,
      updatedAt: now,
    });
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
  args: { deckId: v.string(), ownerAccessKey: v.string(), baseDeckVersion: v.number() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const snapshot = await loadNodeSlideSnapshot(ctx, deck.id);
    if (!snapshot) throw new Error('Deck unavailable.');
    requireSignaturePolicyCas(snapshot, args.baseDeckVersion);
    const {
      activeSignatureProfileId: _activeProfileId,
      activeSignatureProfileDigest: _activeProfileDigest,
      ...clearedDeck
    } = snapshot.deck;
    const now = Date.now();
    const clearedSnapshot: DeckSnapshot = {
      ...snapshot,
      deck: {
        ...clearedDeck,
        version: snapshot.deck.version + 1,
        updatedAt: now,
      },
    };
    const validation = validateNodeSlideSnapshot(clearedSnapshot, now);
    await persistSignaturePolicyVersion(
      ctx,
      deck._id,
      clearedSnapshot,
      'Cleared signature enforcement policy',
      validation,
      now,
    );
    return await loadNodeSlideWorkspace(ctx, deck.id, now);
  },
});

export const activateProfile = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    profileId: v.string(),
    profileDigest: v.string(),
    baseDeckVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const snapshot = await loadNodeSlideSnapshot(ctx, deck.id);
    if (!snapshot) throw new Error('Deck unavailable.');
    requireSignaturePolicyCas(snapshot, args.baseDeckVersion);
    const row = await findSignatureProfile(ctx, deck.projectId, args.profileId, args.profileDigest);
    if (!row) throw new Error('Signature profile unavailable.');
    const profile = signatureProfileFromRow(row);
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
        version: snapshot.deck.version + 1,
        updatedAt: now,
      },
    };
    const validation = validateNodeSlideSnapshot(activeSnapshot, now, undefined, {
      signatureProfile: profile,
    });
    await persistSignaturePolicyVersion(
      ctx,
      deck._id,
      activeSnapshot,
      `Activated signature enforcement: ${profile.name}`,
      validation,
      now,
    );
    return await loadNodeSlideWorkspace(ctx, deck.id, now);
  },
});

function requireSignaturePolicyCas(snapshot: DeckSnapshot, baseDeckVersion: number): void {
  if (!Number.isInteger(baseDeckVersion) || baseDeckVersion < 1) {
    throw new Error('Base deck version must be a positive integer.');
  }
  if (baseDeckVersion !== snapshot.deck.version) {
    throw new Error(
      `Stale signature policy change: based on deck version ${baseDeckVersion}, current version is ${snapshot.deck.version}.`,
    );
  }
}

async function persistSignaturePolicyVersion(
  ctx: MutationCtx,
  deckRowId: Id<'nodeslide_decks'>,
  snapshot: DeckSnapshot,
  label: string,
  validation: ReturnType<typeof validateNodeSlideSnapshot>,
  now: number,
): Promise<void> {
  const existingVersion = await ctx.db
    .query('nodeslide_versions')
    .withIndex('by_deck_version', (index) =>
      index.eq('deckId', snapshot.deck.id).eq('version', snapshot.deck.version),
    )
    .first();
  if (existingVersion) {
    throw new Error(`Deck version ${snapshot.deck.version} already has a snapshot receipt.`);
  }
  await ctx.db.patch(deckRowId, {
    version: snapshot.deck.version,
    activeSignatureProfileId: snapshot.deck.activeSignatureProfileId,
    activeSignatureProfileDigest: snapshot.deck.activeSignatureProfileDigest,
    updatedAt: now,
  });
  await ctx.db.insert('nodeslide_versions', {
    id: nodeslideStableId('version', snapshot.deck.id, String(snapshot.deck.version)),
    deckId: snapshot.deck.id,
    version: snapshot.deck.version,
    label,
    source: 'human',
    snapshot,
    createdAt: now,
  });
  await ctx.db.insert('nodeslide_validations', validation);
}
