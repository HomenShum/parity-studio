import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDeckOwnerAccessKey,
  getStoredOwnerAccessKey,
  listStoredDeckAccess,
  removeDeckOwnerAccessKey,
  storeDeckOwnerAccessKey,
} from './sessionIdentity';

afterEach(() => {
  vi.unstubAllGlobals();
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
