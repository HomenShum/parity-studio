import { useCallback, useEffect, useRef, useState } from 'react';

export const NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY = 'nodeslide.external-consent:v1' as const;

const NODESLIDE_SESSION_EXTERNAL_CONSENT_EVENT = 'nodeslide:session-external-consent-change';
const NODESLIDE_SESSION_EXTERNAL_CONSENT_HISTORY_KEY = '__nodeslideExternalConsentRevoked' as const;
const NODESLIDE_SESSION_EXTERNAL_CONSENT_WINDOW_NAME_MARKER =
  '__nodeslide_external_consent_revoked_v1__' as const;
const NODESLIDE_WINDOW_NAME_SEPARATOR = '\u001f';
const blockedConsentStores = new WeakSet<object>();

interface SessionExternalConsentRecord {
  version: 1;
  grantedAt: number;
}

interface SessionExternalConsentEventDetail {
  granted: boolean;
}

export interface SessionExternalConsent {
  granted: boolean;
  setGranted: (granted: boolean) => void;
  revoke: () => void;
}

interface ConsentRequestVersion {
  key: string;
  revision: number;
}

interface ConsentRecord<T> extends ConsentRequestVersion {
  value: T;
}

export interface PerRequestConsent<T> {
  consent: T | null;
  setConsent: (consent: T | null) => void;
  consumeConsent: () => T | null;
  clearConsent: () => void;
}

export function createExternalProviderRequestKey(surface: string, request: unknown): string {
  return `${surface}:${JSON.stringify(request) ?? 'undefined'}`;
}

/**
 * Explicitly authorizes selected external models and optional web research for this browser tab.
 * The grant survives navigation and reloads through sessionStorage, is shared by every NodeSlide
 * surface in the tab, and remains revocable. Exact provider-specific consent tokens are still
 * derived at each egress boundary so the server contract and trace attribution stay unchanged.
 */
export function useSessionExternalConsent(): SessionExternalConsent {
  const [granted, setGrantedState] = useState(readSessionExternalConsent);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = (event: Event) => {
      if (
        event.type === NODESLIDE_SESSION_EXTERNAL_CONSENT_EVENT &&
        event instanceof CustomEvent &&
        typeof (event.detail as Partial<SessionExternalConsentEventDetail> | null)?.granted ===
          'boolean'
      ) {
        setGrantedState((event.detail as SessionExternalConsentEventDetail).granted);
        return;
      }
      setGrantedState(readSessionExternalConsent());
    };
    window.addEventListener(NODESLIDE_SESSION_EXTERNAL_CONSENT_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(NODESLIDE_SESSION_EXTERNAL_CONSENT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setGranted = useCallback((nextGranted: boolean) => {
    const stored = writeSessionExternalConsent(nextGranted);
    // Revocation always takes effect locally. A grant only becomes active after
    // session storage accepts it, so unavailable storage cannot fail open.
    setGrantedState(nextGranted ? stored : false);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<SessionExternalConsentEventDetail>(
          NODESLIDE_SESSION_EXTERNAL_CONSENT_EVENT,
          { detail: { granted: nextGranted ? stored : false } },
        ),
      );
    }
  }, []);

  const revoke = useCallback(() => setGranted(false), [setGranted]);
  return { granted, setGranted, revoke };
}

export function readSessionExternalConsent(storage?: Pick<Storage, 'getItem'> | null): boolean {
  const usesBrowserStorage = storage === undefined;
  const target = storage === undefined ? browserSessionStorage() : storage;
  if (!target) return false;
  if (blockedConsentStores.has(target as object)) return false;
  if (
    usesBrowserStorage &&
    (readHistoryRevocationTombstone() || readWindowNameRevocationTombstone())
  ) {
    return false;
  }
  try {
    const raw = target.getItem(NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<SessionExternalConsentRecord>;
    return parsed.version === 1 && typeof parsed.grantedAt === 'number';
  } catch {
    return false;
  }
}

export function writeSessionExternalConsent(
  granted: boolean,
  storage?: Pick<Storage, 'setItem' | 'removeItem'> | null,
  now = Date.now(),
): boolean {
  const usesBrowserStorage = storage === undefined;
  const target = storage === undefined ? browserSessionStorage() : storage;
  if (!target) return false;
  if (!granted) {
    // Deny immediately in memory before touching fallible browser storage. The
    // Independent history and window.name tombstones survive a same-tab reload
    // when sessionStorage shims permit reads but reject both revocation writes.
    // window.name carries no prompt or identity data; it is only a deny marker.
    blockedConsentStores.add(target as object);
    const historyProtected = usesBrowserStorage ? writeHistoryRevocationTombstone(true) : false;
    const windowNameProtected = usesBrowserStorage
      ? writeWindowNameRevocationTombstone(true)
      : false;
    try {
      target.removeItem(NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY);
      return true;
    } catch {
      try {
        // Some privacy shims reject removeItem while still allowing writes.
        // Persist an intentionally invalid version so a reload also fails closed.
        target.setItem(
          NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY,
          JSON.stringify({ version: 0, revokedAt: now }),
        );
        return true;
      } catch {
        return historyProtected || windowNameProtected;
      }
    }
  }
  try {
    const record: SessionExternalConsentRecord = { version: 1, grantedAt: now };
    target.setItem(NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY, JSON.stringify(record));
  } catch {
    return false;
  }
  if (usesBrowserStorage) {
    writeHistoryRevocationTombstone(false);
    writeWindowNameRevocationTombstone(false);
  }
  if (
    usesBrowserStorage &&
    (readHistoryRevocationTombstone() || readWindowNameRevocationTombstone())
  ) {
    // A stale revocation marker must win over a newly written grant. Best-effort
    // cleanup prevents a later reload from observing ambiguous authority.
    try {
      target.removeItem(NODESLIDE_SESSION_EXTERNAL_CONSENT_KEY);
    } catch {
      // The in-memory block below still keeps this document fail closed.
    }
    blockedConsentStores.add(target as object);
    return false;
  }
  blockedConsentStores.delete(target as object);
  return true;
}

/**
 * Binds an affirmative consent value to the exact request visible when it was granted.
 * Any intervening request change invalidates the grant permanently, even if the request later
 * returns to the same serialized values. Grants are consumed once at the egress boundary.
 */
export function usePerRequestConsent<T>(requestKey: string): PerRequestConsent<T> {
  const requestRef = useRef<ConsentRequestVersion>({ key: requestKey, revision: 0 });
  if (requestRef.current.key !== requestKey) {
    requestRef.current = {
      key: requestKey,
      revision: requestRef.current.revision + 1,
    };
  }

  const [record, setRecord] = useState<ConsentRecord<T> | null>(null);
  const recordRef = useRef<ConsentRecord<T> | null>(null);
  const currentRequest = requestRef.current;
  const consent = consentMatches(record, currentRequest) ? record.value : null;

  const setConsent = useCallback((value: T | null) => {
    const next = value === null ? null : { ...requestRef.current, value };
    recordRef.current = next;
    setRecord(next);
  }, []);

  const clearConsent = useCallback(() => {
    recordRef.current = null;
    setRecord(null);
  }, []);

  const consumeConsent = useCallback(() => {
    const active = recordRef.current;
    const value = consentMatches(active, requestRef.current) ? active.value : null;
    recordRef.current = null;
    setRecord(null);
    return value;
  }, []);

  return { consent, setConsent, consumeConsent, clearConsent };
}

function consentMatches<T>(
  record: ConsentRecord<T> | null,
  request: ConsentRequestVersion,
): record is ConsentRecord<T> {
  return record !== null && record.key === request.key && record.revision === request.revision;
}

function browserSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readHistoryRevocationTombstone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const state = window.history.state as Record<string, unknown> | null;
    return state?.[NODESLIDE_SESSION_EXTERNAL_CONSENT_HISTORY_KEY] === true;
  } catch {
    return true;
  }
}

function writeHistoryRevocationTombstone(revoked: boolean): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const current = window.history.state;
    const next =
      current && typeof current === 'object'
        ? { ...(current as Record<string, unknown>) }
        : ({} as Record<string, unknown>);
    if (revoked) next[NODESLIDE_SESSION_EXTERNAL_CONSENT_HISTORY_KEY] = true;
    else delete next[NODESLIDE_SESSION_EXTERNAL_CONSENT_HISTORY_KEY];
    window.history.replaceState(next, '');
  } catch {
    // Verification below treats an unreadable history state as denied.
  }
  return readHistoryRevocationTombstone() === revoked;
}

function readWindowNameRevocationTombstone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.name
      .split(NODESLIDE_WINDOW_NAME_SEPARATOR)
      .includes(NODESLIDE_SESSION_EXTERNAL_CONSENT_WINDOW_NAME_MARKER);
  } catch {
    return true;
  }
}

function writeWindowNameRevocationTombstone(revoked: boolean): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const segments = window.name
      .split(NODESLIDE_WINDOW_NAME_SEPARATOR)
      .filter(
        (segment) =>
          segment.length > 0 && segment !== NODESLIDE_SESSION_EXTERNAL_CONSENT_WINDOW_NAME_MARKER,
      );
    if (revoked) segments.push(NODESLIDE_SESSION_EXTERNAL_CONSENT_WINDOW_NAME_MARKER);
    window.name = segments.join(NODESLIDE_WINDOW_NAME_SEPARATOR);
  } catch {
    // Verification below treats an unreadable tab marker as denied.
  }
  return readWindowNameRevocationTombstone() === revoked;
}
