// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY,
  readSessionExternalConsent,
  writeSessionExternalConsent,
} from './externalProviderConsent';

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '');
  window.name = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NodeSlide session external consent', () => {
  it('persists a revocable grant for the browser session without changing request tokens', () => {
    const storage = new MemoryStorage();

    expect(readSessionExternalConsent(storage)).toBe(false);
    expect(writeSessionExternalConsent(true, storage, 42)).toBe(true);
    expect(readSessionExternalConsent(storage)).toBe(true);
    expect(storage.getItem(NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY)).toBe(
      JSON.stringify({ version: 1, grantedAt: 42 }),
    );

    expect(writeSessionExternalConsent(false, storage)).toBe(true);
    expect(readSessionExternalConsent(storage)).toBe(false);
  });

  it('fails closed for malformed or unavailable session storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY, '{bad-json');

    expect(readSessionExternalConsent(storage)).toBe(false);
    expect(readSessionExternalConsent(null)).toBe(false);
    expect(writeSessionExternalConsent(true, null)).toBe(false);
  });

  it('writes a fail-closed tombstone when a privacy shim rejects removal', () => {
    const storage = new RemoveFailingStorage();
    expect(writeSessionExternalConsent(true, storage, 42)).toBe(true);
    expect(readSessionExternalConsent(storage)).toBe(true);

    expect(writeSessionExternalConsent(false, storage, 84)).toBe(true);
    expect(readSessionExternalConsent(storage)).toBe(false);
    expect(storage.getItem(NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY)).toBe(
      JSON.stringify({ version: 0, revokedAt: 84 }),
    );
  });

  it('keeps a revoked store blocked when both removal and tombstone writes fail', () => {
    const storage = new DualWriteFailingStorage();
    expect(writeSessionExternalConsent(true, storage, 42)).toBe(true);
    expect(readSessionExternalConsent(storage)).toBe(true);

    storage.rejectMutations = true;
    expect(writeSessionExternalConsent(false, storage, 84)).toBe(false);
    expect(storage.getItem(NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY)).toBe(
      JSON.stringify({ version: 1, grantedAt: 42 }),
    );
    expect(readSessionExternalConsent(storage)).toBe(false);

    storage.rejectMutations = false;
    expect(writeSessionExternalConsent(true, storage, 126)).toBe(true);
    expect(readSessionExternalConsent(storage)).toBe(true);
  });

  it('keeps revocation fail-closed across reload when storage and history writes all fail', async () => {
    window.name = 'existing-tab-name';
    expect(writeSessionExternalConsent(true, undefined, 42)).toBe(true);
    expect(readSessionExternalConsent()).toBe(true);
    const staleGrant = window.sessionStorage.getItem(NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY);

    const storagePrototype = Object.getPrototypeOf(window.sessionStorage) as Storage;
    vi.spyOn(storagePrototype, 'removeItem').mockImplementation(() => {
      throw new Error('removeItem unavailable');
    });
    vi.spyOn(storagePrototype, 'setItem').mockImplementation(() => {
      throw new Error('setItem unavailable');
    });
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new Error('history unavailable');
    });

    expect(writeSessionExternalConsent(false, undefined, 84)).toBe(true);
    expect(window.sessionStorage.getItem(NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY)).toBe(staleGrant);
    expect(window.name).toContain('nodeslide_external_consent_revoked');

    // Resetting the module simulates a reload: the in-memory WeakSet is gone,
    // while the same tab retains window.name and the stale storage record.
    vi.resetModules();
    const reloadedConsent = await import('./externalProviderConsent');
    expect(reloadedConsent.readSessionExternalConsent()).toBe(false);

    vi.restoreAllMocks();
    expect(reloadedConsent.writeSessionExternalConsent(true, undefined, 126)).toBe(true);
    expect(reloadedConsent.readSessionExternalConsent()).toBe(true);
    expect(window.name).toBe('existing-tab-name');
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

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

class RemoveFailingStorage extends MemoryStorage {
  override removeItem(): void {
    throw new Error('removeItem unavailable');
  }
}

class DualWriteFailingStorage extends MemoryStorage {
  rejectMutations = false;

  override removeItem(key: string): void {
    if (this.rejectMutations) throw new Error('removeItem unavailable');
    super.removeItem(key);
  }

  override setItem(key: string, value: string): void {
    if (this.rejectMutations) throw new Error('setItem unavailable');
    super.setItem(key, value);
  }
}
