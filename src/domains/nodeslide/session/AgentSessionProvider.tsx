import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  agentSessionStorageKey,
  archiveAgentSessionJob,
  attachAgentSessionJob,
  classifyAgentSessionJobFreshness,
  failAgentSessionJob,
  failPreparedAgentSessionJob,
  prepareAgentSessionJob,
  readAgentSessionState,
  reconcileAgentSessionJob,
  updateAgentSessionControls,
  updateAgentSessionSurface,
  writeAgentSessionState,
} from './agentSessionState';
import type {
  AgentSessionControlPatch,
  AgentSessionDelegationGrant,
  AgentSessionJobFreshness,
  AgentSessionJobHandle,
  AgentSessionJobKind,
  AgentSessionJobReceipt,
  AgentSessionState,
  AgentSessionSurface,
} from './types';

export interface AgentSessionContextValue {
  state: AgentSessionState;
  setSurface: (surface: AgentSessionSurface) => void;
  updateControls: (patch: AgentSessionControlPatch) => void;
  prepareJob: (input: {
    kind: AgentSessionJobKind;
    requestFingerprint: string;
    targetDeckId?: string;
    ownerAccessKey?: string;
  }) => AgentSessionJobHandle;
  attachJob: (receipt: AgentSessionJobReceipt) => void;
  reconcileJob: (receipt: AgentSessionJobReceipt) => void;
  failPreparedJob: (error: string) => void;
  failJob: (error: string) => void;
  archiveJob: () => void;
  resetTransientConsent: () => void;
  installApprovalGrant: (grant: AgentSessionDelegationGrant) => void;
  clearApprovalGrant: () => void;
  getJobFreshness: (at?: number) => AgentSessionJobFreshness;
}

interface AgentSessionProviderProps {
  clientSessionId: string;
  children: ReactNode;
  storage?: Storage | null;
  now?: () => number;
  createSecret?: () => string;
}

const AgentSessionContext = createContext<AgentSessionContextValue | null>(null);

export function AgentSessionProvider({
  clientSessionId,
  children,
  storage,
  now = Date.now,
  createSecret = createAgentSessionSecret,
}: AgentSessionProviderProps) {
  const durableStorage = storage === undefined ? browserStorage() : storage;
  const [state, setState] = useState(() =>
    readAgentSessionState(durableStorage, clientSessionId, now()),
  );
  const stateRef = useRef(state);

  const commit = useCallback(
    (next: AgentSessionState) => {
      if (next === stateRef.current) return;
      stateRef.current = next;
      setState(next);
      writeAgentSessionState(durableStorage, next);
    },
    [durableStorage],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (typeof window === 'undefined' || !durableStorage) return;
    const storageKey = agentSessionStorageKey(clientSessionId);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const next = readAgentSessionState(durableStorage, clientSessionId, now());
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [clientSessionId, durableStorage, now]);

  const setSurface = useCallback(
    (surface: AgentSessionSurface) => {
      commit(updateAgentSessionSurface(stateRef.current, surface, now()));
    },
    [commit, now],
  );
  const updateControls = useCallback(
    (patch: AgentSessionControlPatch) => {
      commit(updateAgentSessionControls(stateRef.current, patch, now()));
    },
    [commit, now],
  );
  const prepareJob = useCallback(
    (input: {
      kind: AgentSessionJobKind;
      requestFingerprint: string;
      targetDeckId?: string;
      ownerAccessKey?: string;
    }) => {
      const current = stateRef.current.activeJob;
      const reusing =
        current?.kind === input.kind && current.requestFingerprint === input.requestFingerprint;
      const prepared = prepareAgentSessionJob(
        stateRef.current,
        {
          ...input,
          ownerAccessKey: reusing
            ? current.ownerAccessKey
            : (input.ownerAccessKey ?? createSecret()),
          idempotencyKey: reusing ? current.idempotencyKey : `job-${createSecret()}`,
        },
        now(),
      );
      commit(prepared.state);
      return prepared.handle;
    },
    [commit, createSecret, now],
  );
  const attachJob = useCallback(
    (receipt: AgentSessionJobReceipt) => {
      commit(attachAgentSessionJob(stateRef.current, receipt));
    },
    [commit],
  );
  const reconcileJob = useCallback(
    (receipt: AgentSessionJobReceipt) => {
      const next = reconcileAgentSessionJob(stateRef.current, receipt);
      if (next !== stateRef.current) commit(next);
    },
    [commit],
  );
  const failPreparedJob = useCallback(
    (error: string) => {
      const next = failPreparedAgentSessionJob(stateRef.current, error, now());
      if (next !== stateRef.current) commit(next);
    },
    [commit, now],
  );
  const failJob = useCallback(
    (error: string) => {
      const next = failAgentSessionJob(stateRef.current, error, now());
      if (next !== stateRef.current) commit(next);
    },
    [commit, now],
  );
  const archiveJob = useCallback(() => {
    const next = archiveAgentSessionJob(stateRef.current, now());
    if (next !== stateRef.current) commit(next);
  }, [commit, now]);
  const resetTransientConsent = useCallback(() => {
    commit(updateAgentSessionControls(stateRef.current, { web: { consentGranted: false } }, now()));
  }, [commit, now]);
  const installApprovalGrant = useCallback(
    (grant: AgentSessionDelegationGrant) => {
      const next = updateAgentSessionControls(stateRef.current, { approval: grant }, now());
      if (next.controls.approval.mode !== 'auto_apply') {
        throw new Error('The delegation grant is incomplete or expired.');
      }
      commit(next);
    },
    [commit, now],
  );
  const clearApprovalGrant = useCallback(() => {
    commit(updateAgentSessionControls(stateRef.current, { approval: { mode: 'review' } }, now()));
  }, [commit, now]);
  const getJobFreshness = useCallback(
    (at = now()) => classifyAgentSessionJobFreshness(stateRef.current.activeJob, at),
    [now],
  );

  const value = useMemo<AgentSessionContextValue>(
    () => ({
      state,
      setSurface,
      updateControls,
      prepareJob,
      attachJob,
      reconcileJob,
      failPreparedJob,
      failJob,
      archiveJob,
      resetTransientConsent,
      installApprovalGrant,
      clearApprovalGrant,
      getJobFreshness,
    }),
    [
      archiveJob,
      attachJob,
      clearApprovalGrant,
      failPreparedJob,
      failJob,
      prepareJob,
      reconcileJob,
      resetTransientConsent,
      installApprovalGrant,
      getJobFreshness,
      setSurface,
      state,
      updateControls,
    ],
  );

  return <AgentSessionContext.Provider value={value}>{children}</AgentSessionContext.Provider>;
}

export function useAgentSession(): AgentSessionContextValue {
  const session = useContext(AgentSessionContext);
  if (!session) throw new Error('useAgentSession must be used inside AgentSessionProvider.');
  return session;
}

export function useOptionalAgentSession(): AgentSessionContextValue | null {
  return useContext(AgentSessionContext);
}

export function createAgentSessionSecret(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure browser randomness is required to create a durable NodeSlide job.');
  }
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    // Agent capabilities (owner keys and Turbo delegation tokens) are intentionally
    // scoped to the current browser session. Keeping them out of localStorage makes
    // "allow this session" literal: reloads recover durable jobs, while closing the
    // tab/session drops the bearer capabilities instead of leaving them on disk.
    return window.sessionStorage;
  } catch {
    return null;
  }
}
