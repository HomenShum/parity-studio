const SESSION_ID_KEY = 'parity.studio.sessionId';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'server-session';
  const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
  if (existing) return existing;
  const next = randomId();
  window.sessionStorage.setItem(SESSION_ID_KEY, next);
  return next;
}

export function resetSessionId(): string {
  if (typeof window === 'undefined') return 'server-session';
  const next = randomId();
  window.sessionStorage.setItem(SESSION_ID_KEY, next);
  return next;
}
