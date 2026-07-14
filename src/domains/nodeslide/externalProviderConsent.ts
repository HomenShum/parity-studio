import { useCallback, useRef, useState } from 'react';

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
