import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDeckOwnerAccessKey,
  getOrCreateSessionId,
  getStoredOwnerAccessKey,
  listStoredDeckAccess,
  removeDeckOwnerAccessKey,
  resetSessionId,
  storeDeckOwnerAccessKey,
} from './sessionIdentity';

const systemCrypto = globalThis.crypto;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('anonymous visitor session identity', () => {
  it('preserves a returning visitor session without requiring random-number APIs', () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem('parity.studio.sessionId', 'existing-session');
    installWindow(localStorage);
    vi.stubGlobal('crypto', {});

    expect(getOrCreateSessionId()).toBe('existing-session');
  });

  it('mints distinct sessions through randomUUID when the browser exposes it', () => {
    installWindow(new MemoryStorage());
    vi.stubGlobal('crypto', systemCrypto);

    const minted = new Set(Array.from({ length: 300 }, () => resetSessionId()));

    expect(minted).toHaveLength(300);
  });

  it('calls getRandomValues when randomUUID is unavailable', () => {
    installWindow(new MemoryStorage());
    const getRandomValues = vi.fn(systemCrypto.getRandomValues.bind(systemCrypto));
    vi.stubGlobal('crypto', { getRandomValues });

    resetSessionId();

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(16);
  });

  it('varies all 128 fallback entropy bits across a browser-session burst', () => {
    installWindow(new MemoryStorage());
    installGetRandomValuesOnly();

    const minted = Array.from({ length: 300 }, () => resetSessionId());
    const payloads = minted.map(sessionIdToBytes);

    for (let bit = 0; bit < 128; bit += 1) {
      const byteIndex = Math.floor(bit / 8);
      const mask = 1 << (bit % 8);
      const observed = new Set(payloads.map((bytes) => bytes[byteIndex] & mask));
      expect(observed, `entropy bit ${bit}`).toEqual(new Set([0, mask]));
    }
  });

  it('keeps fallback sessions distinct while the clock is frozen', () => {
    installWindow(new MemoryStorage());
    installGetRandomValuesOnly();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const minted = new Set(Array.from({ length: 100 }, () => resetSessionId()));

    expect(minted).toHaveLength(100);
  });

  it('keeps fallback sessions distinct when Math.random is pinned', () => {
    installWindow(new MemoryStorage());
    installGetRandomValuesOnly();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const minted = new Set(Array.from({ length: 100 }, () => resetSessionId()));

    expect(minted).toHaveLength(100);
  });

  it('refuses to mint a readable session when secure randomness is unavailable', () => {
    installWindow(new MemoryStorage());
    vi.stubGlobal('crypto', {});

    expect(() => getOrCreateSessionId()).toThrow('Secure random number generation is unavailable.');
  });
});

describe('NodeSlide owner capability persistence', () => {
  it('confirms both the deck map and primary capability by readback', () => {
    const localStorage = new MemoryStorage();
    installWindow(localStorage);

    const receipt = storeDeckOwnerAccessKey('deck:one', 'owner:one', true);

    expect(receipt).toEqual({
      durable: true,
      deckAccessDurable: true,
      primaryAccessDurable: true,
    });
    expect(getDeckOwnerAccessKey('deck:one')).toBe('owner:one');
    expect(getStoredOwnerAccessKey()).toBe('owner:one');
    expect(listStoredDeckAccess()).toEqual([{ deckId: 'deck:one', ownerAccessKey: 'owner:one' }]);
  });

  it('preserves existing deck capabilities when storing another deck', () => {
    const localStorage = new MemoryStorage();
    installWindow(localStorage);
    storeDeckOwnerAccessKey('deck:one', 'owner:one');

    const receipt = storeDeckOwnerAccessKey('deck:two', 'owner:two');

    expect(receipt.durable).toBe(true);
    expect(listStoredDeckAccess()).toEqual([
      { deckId: 'deck:one', ownerAccessKey: 'owner:one' },
      { deckId: 'deck:two', ownerAccessKey: 'owner:two' },
    ]);
  });

  it('removes only the selected deck capability and clears its matching primary key', () => {
    const localStorage = new MemoryStorage();
    installWindow(localStorage);
    storeDeckOwnerAccessKey('deck:one', 'owner:one', true);
    storeDeckOwnerAccessKey('deck:two', 'owner:two');

    expect(removeDeckOwnerAccessKey('deck:one')).toBe(true);

    expect(getDeckOwnerAccessKey('deck:one')).toBeUndefined();
    expect(getStoredOwnerAccessKey()).toBeUndefined();
    expect(listStoredDeckAccess()).toEqual([{ deckId: 'deck:two', ownerAccessKey: 'owner:two' }]);
  });

  it('preserves a primary capability that is still used by another stored deck', () => {
    const localStorage = new MemoryStorage();
    installWindow(localStorage);
    storeDeckOwnerAccessKey('deck:one', 'owner:shared', true);
    storeDeckOwnerAccessKey('deck:two', 'owner:shared');

    expect(removeDeckOwnerAccessKey('deck:one')).toBe(true);

    expect(getStoredOwnerAccessKey()).toBe('owner:shared');
    expect(listStoredDeckAccess()).toEqual([
      { deckId: 'deck:two', ownerAccessKey: 'owner:shared' },
    ]);
  });

  it('reports storage exceptions without exposing or losing the in-memory capability', () => {
    installWindow(new ThrowingStorage());

    expect(() => storeDeckOwnerAccessKey('deck:one', 'owner:one', true)).not.toThrow();
    expect(storeDeckOwnerAccessKey('deck:one', 'owner:one', true)).toEqual({
      durable: false,
      deckAccessDurable: false,
      primaryAccessDurable: false,
    });
  });

  it('rejects storage implementations that accept writes but fail readback', () => {
    installWindow(new DiscardingStorage());

    expect(storeDeckOwnerAccessKey('deck:one', 'owner:one', true)).toEqual({
      durable: false,
      deckAccessDurable: false,
      primaryAccessDurable: false,
    });
  });
});

function installWindow(localStorage: Storage): void {
  vi.stubGlobal('window', {
    localStorage,
    sessionStorage: new MemoryStorage(),
  });
}

function installGetRandomValuesOnly(): void {
  vi.stubGlobal('crypto', {
    getRandomValues: systemCrypto.getRandomValues.bind(systemCrypto),
  });
}

function sessionIdToBytes(sessionId: string): Uint8Array {
  const payload = sessionId.replace(/^session-/u, '');
  expect(payload).toMatch(/^[0-9a-f]{32}$/u);
  return Uint8Array.from(payload.match(/.{2}/gu) ?? [], (hex) => Number.parseInt(hex, 16));
}

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error('storage unavailable');
  }

  override setItem(): void {
    throw new Error('storage unavailable');
  }
}

class DiscardingStorage extends MemoryStorage {
  override setItem(): void {
    // Some privacy shims expose the Storage API but discard every write.
  }
}
