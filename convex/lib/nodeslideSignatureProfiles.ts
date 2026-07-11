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
): Promise<Doc<'nodeslide_signature_profiles'> | null> {
  return await ctx.db
    .query('nodeslide_signature_profiles')
    .withIndex('by_tenant_profile', (index) =>
      index.eq('tenantId', tenantId).eq('profileId', profileId),
    )
    .unique();
}

export async function requireSignatureProfile(
  ctx: ReadCtx,
  tenantId: string,
  profileId: string,
): Promise<SignatureProfile> {
  const row = await findSignatureProfile(ctx, tenantId, profileId);
  if (!row) throw new Error('Signature profile unavailable.');
  return parseSignatureProfileFromStorage(row.profileJson);
}

export function signatureProfileRowId(tenantId: string, profileId: string): string {
  return nodeslideStableId('signature_profile', tenantId, profileId);
}

export function signatureProfileFromRow(
  row: Doc<'nodeslide_signature_profiles'>,
): SignatureProfile {
  return parseSignatureProfileFromStorage(row.profileJson);
}
