import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

const STORAGE_PREFIX = 'nodeslide.composer-session:v1:';

export interface NodeSlideComposerAttachmentDraft {
  id: string;
  name: string;
  mediaType: string;
  content: string;
  lastModified: number;
}

export interface NodeSlideComposerSessionState {
  text: string;
  attachments: readonly NodeSlideComposerAttachmentDraft[];
}

export interface NodeSlideComposerSessionController extends NodeSlideComposerSessionState {
  key: string;
  setText: (text: string) => void;
  setAttachments: (attachments: readonly NodeSlideComposerAttachmentDraft[]) => void;
  reset: (state?: Partial<NodeSlideComposerSessionState>) => void;
  clear: () => void;
}

const EMPTY_SESSION: NodeSlideComposerSessionState = Object.freeze({
  text: '',
  attachments: Object.freeze([]),
});
const snapshots = new Map<string, NodeSlideComposerSessionState>();
const listeners = new Map<string, Set<() => void>>();
let fallbackId = 0;

export function nodeSlideComposerSessionKey(
  surface: 'editor' | 'landing' | 'project',
  identity: string,
): string {
  return `${surface}:${identity}`;
}

export function createNodeSlideComposerAttachmentDraft(
  attachment: Omit<NodeSlideComposerAttachmentDraft, 'id' | 'lastModified'> &
    Partial<Pick<NodeSlideComposerAttachmentDraft, 'id' | 'lastModified'>>,
): NodeSlideComposerAttachmentDraft {
  return {
    id: attachment.id ?? createAttachmentId(),
    name: attachment.name,
    mediaType: attachment.mediaType,
    content: attachment.content,
    lastModified: attachment.lastModified ?? Date.now(),
  };
}

export function clearNodeSlideComposerSession(key: string): void {
  updateSession(key, EMPTY_SESSION);
}

export function useNodeSlideComposerSession(
  key: string,
  initial: Partial<NodeSlideComposerSessionState> = EMPTY_SESSION,
): NodeSlideComposerSessionController {
  const subscribe = useCallback((listener: () => void) => subscribeToSession(key, listener), [key]);
  const getSnapshot = useCallback(() => ensureSession(key, initial), [initial, key]);
  const serverSnapshot = useMemo(() => normalizeSession(initial), [initial]);
  const getServerSnapshot = useCallback(() => serverSnapshot, [serverSnapshot]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storageKey = storageKeyFor(key);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const next = parseStoredSession(event.newValue) ?? EMPTY_SESSION;
      snapshots.set(key, next);
      emit(key);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  const setText = useCallback(
    (text: string) => updateSession(key, { ...ensureSession(key), text }),
    [key],
  );
  const setAttachments = useCallback(
    (attachments: readonly NodeSlideComposerAttachmentDraft[]) =>
      updateSession(key, { ...ensureSession(key), attachments: normalizeAttachments(attachments) }),
    [key],
  );
  const reset = useCallback(
    (next: Partial<NodeSlideComposerSessionState> = EMPTY_SESSION) =>
      updateSession(key, normalizeSession(next)),
    [key],
  );
  const clear = useCallback(() => clearNodeSlideComposerSession(key), [key]);

  return useMemo(
    () => ({ ...state, key, setText, setAttachments, reset, clear }),
    [clear, key, reset, setAttachments, setText, state],
  );
}

function ensureSession(
  key: string,
  initial: Partial<NodeSlideComposerSessionState> = EMPTY_SESSION,
): NodeSlideComposerSessionState {
  const existing = snapshots.get(key);
  if (existing) return existing;
  const stored = readStoredSession(key);
  const state = stored ?? normalizeSession(initial);
  snapshots.set(key, state);
  return state;
}

function updateSession(key: string, next: NodeSlideComposerSessionState): void {
  const normalized = normalizeSession(next);
  const current = ensureSession(key);
  if (sessionsEqual(current, normalized)) return;
  snapshots.set(key, normalized);
  persistSession(key, normalized);
  emit(key);
}

function normalizeSession(
  state: Partial<NodeSlideComposerSessionState>,
): NodeSlideComposerSessionState {
  return Object.freeze({
    text: typeof state.text === 'string' ? state.text : '',
    attachments: Object.freeze(normalizeAttachments(state.attachments ?? [])),
  });
}

function normalizeAttachments(
  attachments: readonly NodeSlideComposerAttachmentDraft[],
): NodeSlideComposerAttachmentDraft[] {
  return attachments
    .filter(
      (attachment) =>
        typeof attachment.id === 'string' &&
        typeof attachment.name === 'string' &&
        typeof attachment.mediaType === 'string' &&
        typeof attachment.content === 'string' &&
        Number.isFinite(attachment.lastModified),
    )
    .map((attachment) => ({ ...attachment }));
}

function sessionsEqual(
  left: NodeSlideComposerSessionState,
  right: NodeSlideComposerSessionState,
): boolean {
  if (left.text !== right.text || left.attachments.length !== right.attachments.length)
    return false;
  return left.attachments.every((attachment, index) => {
    const candidate = right.attachments[index];
    return (
      candidate !== undefined &&
      attachment.id === candidate.id &&
      attachment.name === candidate.name &&
      attachment.mediaType === candidate.mediaType &&
      attachment.content === candidate.content &&
      attachment.lastModified === candidate.lastModified
    );
  });
}

function subscribeToSession(key: string, listener: () => void): () => void {
  const bucket = listeners.get(key) ?? new Set<() => void>();
  bucket.add(listener);
  listeners.set(key, bucket);
  return () => {
    bucket.delete(listener);
    if (bucket.size === 0) listeners.delete(key);
  };
}

function emit(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

function storageKeyFor(key: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(key)}`;
}

function readStoredSession(key: string): NodeSlideComposerSessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseStoredSession(window.localStorage.getItem(storageKeyFor(key)));
  } catch {
    return null;
  }
}

function parseStoredSession(value: string | null): NodeSlideComposerSessionState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<NodeSlideComposerSessionState>;
    return normalizeSession(parsed);
  } catch {
    return null;
  }
}

function persistSession(key: string, state: NodeSlideComposerSessionState): void {
  if (typeof window === 'undefined') return;
  try {
    if (!state.text && state.attachments.length === 0) {
      window.localStorage.removeItem(storageKeyFor(key));
    } else {
      window.localStorage.setItem(storageKeyFor(key), JSON.stringify(state));
    }
  } catch {
    // Storage can be unavailable or full; the module-level keyed store still
    // preserves the draft across inspector tab unmount/remount in this client.
  }
}

function createAttachmentId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  fallbackId += 1;
  return `nodeslide-attachment-${Date.now()}-${fallbackId}`;
}
