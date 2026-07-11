import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { findDeckRow } from './nodeslideData';

const OWNER_ACCESS_KEY_BYTES = 32;
const OWNER_ACCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;

/** Generates an opaque, URL-safe 256-bit bearer capability. */
export function createOwnerAccessKey(): string {
  const bytes = new Uint8Array(OWNER_ACCESS_KEY_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** Generates an unguessable, URL-safe read-only presentation capability. */
export function createShareSlug(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `share-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The single owner gate for NodeSlide resources. Deck IDs locate a resource only;
 * they never authorize access to it.
 */
export async function requireOwnerAccess(
  ctx: ReadCtx,
  deckId: string,
  ownerAccessKey: string,
): Promise<Doc<'nodeslide_decks'>> {
  if (!isBoundedText(deckId, 256) || !isOwnerAccessKey(ownerAccessKey)) {
    throw new Error('NodeSlide owner access denied.');
  }
  const deck = await findDeckRow(ctx, deckId);
  if (!deck?.ownerAccessKey || !constantTimeEqual(deck.ownerAccessKey, ownerAccessKey)) {
    throw new Error('NodeSlide owner access denied.');
  }
  return deck;
}

export function isOwnerAccessKey(value: string): boolean {
  return OWNER_ACCESS_KEY_PATTERN.test(value);
}

export function requireShareSlug(value: string): string {
  const slug = value.trim();
  if (!slug || slug.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Invalid NodeSlide share link.');
  }
  return slug;
}

function isBoundedText(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}
