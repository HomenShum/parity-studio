import type { Deck } from '../../shared/nodeslide';
import type { SignatureProfile } from '../../shared/nodeslideSignature';
import { resolveSignatureTheme } from '../../shared/nodeslideSignatureApply';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { nodeslideStableId } from './nodeslideIds';

const MAX_PROFILE_BYTES = 1_000_000;
export const NODESLIDE_SIGNATURE_PROFILE_LIST_LIMIT = 8;
export const NODESLIDE_SIGNATURE_PROFILE_LIST_BYTES = 4_000_000;

type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;

export function validateSignatureProfileForStorage(value: unknown): SignatureProfile {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Signature profile is not JSON-serializable.');
  }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > MAX_PROFILE_BYTES) {
    throw new Error(`Signature profile exceeds the ${MAX_PROFILE_BYTES}-byte storage limit.`);
  }
  const profile = value as SignatureProfile;
  const resolution = resolveSignatureTheme(profile);
  if (!resolution.ok) throw new Error(resolution.error.message);
  if (
    !profile.id ||
    profile.id.length > 240 ||
    !profile.name?.trim() ||
    profile.name.length > 160 ||
    !/^sha256:[0-9a-f]{64}$/.test(profile.source?.digest ?? '')
  ) {
    throw new Error('Signature profile identity is invalid.');
  }
  return structuredClone(profile);
}

export function serializeSignatureProfileForStorage(value: unknown): string {
  return JSON.stringify(validateSignatureProfileForStorage(value));
}

export function parseSignatureProfileFromStorage(value: string): SignatureProfile {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > MAX_PROFILE_BYTES
  ) {
    throw new Error(`Signature profile exceeds the ${MAX_PROFILE_BYTES}-byte storage limit.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Signature profile JSON is invalid.');
  }
  return validateSignatureProfileForStorage(parsed);
}

export async function findSignatureProfile(
  ctx: ReadCtx,
  tenantId: string,
  profileId: string,
  sourceDigest?: string,
): Promise<Doc<'nodeslide_signature_profiles'> | null> {
  if (sourceDigest !== undefined) {
    const rowId = signatureProfileRowId(tenantId, profileId, sourceDigest);
    const addressed = await ctx.db
      .query('nodeslide_signature_profiles')
      .withIndex('by_stable_id', (index) => index.eq('id', rowId))
      .take(2);
    if (addressed.length > 1) {
      throw new Error('Conflicting signature profile content-address rows are stored.');
    }
    const addressedRevision = addressed[0];
    if (addressedRevision) {
      if (
        addressedRevision.tenantId !== tenantId ||
        addressedRevision.profileId !== profileId ||
        addressedRevision.sourceDigest !== sourceDigest
      ) {
        throw new Error('Signature profile content address conflicts with another revision.');
      }
      return addressedRevision;
    }
  }

  const revisions = await ctx.db
    .query('nodeslide_signature_profiles')
    .withIndex('by_tenant_profile', (index) =>
      index.eq('tenantId', tenantId).eq('profileId', profileId),
    )
    .take(2);
  if (sourceDigest === undefined) {
    if (revisions.length > 1) {
      throw new Error('Signature profile digest is required to select an immutable revision.');
    }
    return revisions[0] ?? null;
  }
  const matches = revisions.filter((revision) => revision.sourceDigest === sourceDigest);
  if (matches.length > 1) {
    throw new Error('Conflicting signature profile revisions are stored for this identity/digest.');
  }
  return matches[0] ?? null;
}

export async function requireSignatureProfile(
  ctx: ReadCtx,
  tenantId: string,
  profileId: string,
  sourceDigest?: string,
): Promise<SignatureProfile> {
  const row = await findSignatureProfile(ctx, tenantId, profileId, sourceDigest);
  if (!row) throw new Error('Signature profile unavailable.');
  return signatureProfileFromRow(row);
}

export async function requireDeckSignatureProfile(
  ctx: ReadCtx,
  tenantId: string,
  deck: Pick<Deck, 'activeSignatureProfileId' | 'activeSignatureProfileDigest'>,
): Promise<SignatureProfile | undefined> {
  const profileId = deck.activeSignatureProfileId;
  const sourceDigest = deck.activeSignatureProfileDigest;
  if (profileId === undefined && sourceDigest === undefined) return undefined;
  if (profileId === undefined || sourceDigest === undefined) {
    throw new Error('Deck signature profile identity/digest is incomplete.');
  }
  return await requireSignatureProfile(ctx, tenantId, profileId, sourceDigest);
}

export function signatureProfileRowId(
  tenantId: string,
  profileId: string,
  sourceDigest: string,
): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(sourceDigest)) {
    throw new Error('Signature profile digest is invalid.');
  }
  return `${nodeslideStableId('signature_profile', tenantId, profileId)}_${sourceDigest.slice(7)}`;
}

export function signatureProfileFromRow(
  row: Doc<'nodeslide_signature_profiles'>,
): SignatureProfile {
  const profile = parseSignatureProfileFromStorage(row.profileJson);
  if (row.profileId !== profile.id || row.sourceDigest !== profile.source.digest) {
    throw new Error(
      'Stored signature profile identity/digest conflicts with its immutable content.',
    );
  }
  return profile;
}
