const SESSION_ID_KEY = 'parity.studio.sessionId';
const OWNER_ACCESS_KEY = 'nodeslide.ownerAccessKey';
const DECK_ACCESS_KEY = 'nodeslide.deckAccess.v1';

export interface OwnerAccessPersistenceReceipt {
  durable: boolean;
  deckAccessDurable: boolean;
  primaryAccessDurable: boolean;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'server-session';
  const existing =
    readStorage(window.localStorage, SESSION_ID_KEY) ??
    readStorage(window.sessionStorage, SESSION_ID_KEY);
  if (existing) return existing;
  const next = randomId();
  writeStorage(window.localStorage, SESSION_ID_KEY, next);
  return next;
}

export function resetSessionId(): string {
  if (typeof window === 'undefined') return 'server-session';
  const next = randomId();
  writeStorage(window.localStorage, SESSION_ID_KEY, next);
  return next;
}

/** Returns the server-issued capability for the deterministic sample deck. */
export function getStoredOwnerAccessKey(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return readStorage(window.localStorage, OWNER_ACCESS_KEY) ?? undefined;
}

/**
 * Persists a server-issued anonymous owner capability. It is durable across
 * tabs for private-preview continuity, but is not account authentication.
 */
export function storeDeckOwnerAccessKey(
  deckId: string,
  ownerAccessKey: string,
  primary = false,
): OwnerAccessPersistenceReceipt {
  const unavailable: OwnerAccessPersistenceReceipt = {
    durable: false,
    deckAccessDurable: false,
    primaryAccessDurable: false,
  };
  if (typeof window === 'undefined' || !deckId || !ownerAccessKey) return unavailable;
  const access = readDeckAccess();
  access[deckId] = ownerAccessKey;
  const deckAccessDurable = writeStorage(
    window.localStorage,
    DECK_ACCESS_KEY,
    JSON.stringify(access),
  );
  const primaryAccessDurable =
    !primary || writeStorage(window.localStorage, OWNER_ACCESS_KEY, ownerAccessKey);
  return {
    durable: deckAccessDurable && primaryAccessDurable,
    deckAccessDurable,
    primaryAccessDurable,
  };
}

export function getDeckOwnerAccessKey(deckId: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return readDeckAccess()[deckId];
}

export function listStoredDeckAccess(): Array<{ deckId: string; ownerAccessKey: string }> {
  return Object.entries(readDeckAccess()).map(([deckId, ownerAccessKey]) => ({
    deckId,
    ownerAccessKey,
  }));
}

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The
    // caller still receives a usable in-memory value for the current mount.
    return false;
  }
}

function readDeckAccess(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const raw = readStorage(window.localStorage, DECK_ACCESS_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          Boolean(entry[0]) && typeof entry[1] === 'string' && entry[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}
