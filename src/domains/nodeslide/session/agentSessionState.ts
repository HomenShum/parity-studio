import {
  NODESLIDE_DEFAULT_AGENT_MODEL,
  NODESLIDE_REASONING_EFFORTS,
  isNodeSlideAgentModelId,
  nodeSlideModelSupportsReasoningEffort,
} from '../../../../shared/nodeslide';
import {
  NODESLIDE_CREATE_ATTACHMENT_MAX_FILES,
  NODESLIDE_CREATE_ATTACHMENT_MAX_TOTAL_BYTES,
  NODESLIDE_DATA_ATTACHMENT_MAX_BYTES,
} from '../../../../shared/nodeslideAttachments';
import type {
  AgentSessionAttachment,
  AgentSessionControlPatch,
  AgentSessionControls,
  AgentSessionJobFreshness,
  AgentSessionJobHandle,
  AgentSessionJobKind,
  AgentSessionJobReceipt,
  AgentSessionJobStatus,
  AgentSessionModel,
  AgentSessionScope,
  AgentSessionState,
  AgentSessionSurface,
} from './types';
import { NODESLIDE_AGENT_SESSION_VERSION } from './types';

const STORAGE_PREFIX = 'nodeslide.agent-session:v1:';
const ACTIVE_JOB_STATUSES = new Set<AgentSessionJobStatus>([
  'preparing',
  'queued',
  'running',
  'retrying',
  'paused',
]);
const AUTHORITY_LOCK_JOB_STATUSES = new Set<AgentSessionJobStatus>([
  ...ACTIVE_JOB_STATUSES,
  'awaiting_review',
]);
const TERMINAL_JOB_STATUSES = new Set<AgentSessionJobStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'rejected',
  'stale',
]);
const JOB_MAX_ATTEMPTS = 3;
export const AGENT_SESSION_JOB_STALL_AFTER_MS = 120_000;

export function createInitialAgentSessionState(
  clientSessionId: string,
  now = Date.now(),
): AgentSessionState {
  return Object.freeze({
    version: NODESLIDE_AGENT_SESSION_VERSION,
    clientSessionId,
    surface: 'landing' as const,
    controls: defaultControls(),
    activeJob: null,
    lastJob: null,
    updatedAt: now,
  });
}

export function updateAgentSessionSurface(
  state: AgentSessionState,
  surface: AgentSessionSurface,
  now = Date.now(),
): AgentSessionState {
  if (state.surface === surface) return state;
  return freezeState({ ...state, surface, updatedAt: now });
}

export function updateAgentSessionControls(
  state: AgentSessionState,
  patch: AgentSessionControlPatch,
  now = Date.now(),
): AgentSessionState {
  const requestedModel = normalizeModel(patch.model ?? state.controls.model);
  const requestedEffort = normalizeEffort(patch.effort ?? state.controls.effort);
  const effort =
    requestedModel === 'deterministic' ||
    nodeSlideModelSupportsReasoningEffort(requestedModel, requestedEffort)
      ? requestedEffort
      : 'high';
  const controls: AgentSessionControls = {
    model: requestedModel,
    effort,
    scope: normalizeScope({ ...state.controls.scope, ...patch.scope }),
    attachments:
      patch.attachments === undefined
        ? state.controls.attachments
        : normalizeAttachments(patch.attachments),
    web: Object.freeze({
      enabled: patch.web?.enabled ?? state.controls.web.enabled,
      consentGranted: patch.web?.consentGranted ?? state.controls.web.consentGranted,
    }),
    memory: Object.freeze({
      mode: patch.memory?.mode ?? state.controls.memory.mode,
      references: Object.freeze(
        uniqueBounded(patch.memory?.references ?? state.controls.memory.references, 24),
      ),
    }),
    approval: normalizeApproval(patch.approval ?? state.controls.approval, now),
  };
  const frozenControls = freezeControls(controls);
  if (controlsEqual(state.controls, frozenControls)) return state;
  return freezeState({ ...state, controls: frozenControls, updatedAt: now });
}

export function prepareAgentSessionJob(
  state: AgentSessionState,
  input: {
    kind: AgentSessionJobKind;
    requestFingerprint: string;
    ownerAccessKey: string;
    idempotencyKey: string;
    targetDeckId?: string;
  },
  now = Date.now(),
): { state: AgentSessionState; handle: AgentSessionJobHandle } {
  const current = state.activeJob;
  if (
    current &&
    ACTIVE_JOB_STATUSES.has(current.status) &&
    current.kind === input.kind &&
    current.requestFingerprint === input.requestFingerprint
  ) {
    return { state, handle: current };
  }
  if (current && ACTIVE_JOB_STATUSES.has(current.status)) {
    throw new Error('Another NodeSlide job is already active in this agent session.');
  }
  const handle: AgentSessionJobHandle = Object.freeze({
    kind: input.kind,
    idempotencyKey: boundedText(input.idempotencyKey, 160),
    requestFingerprint: boundedText(input.requestFingerprint, 160),
    ownerAccessKey: boundedText(input.ownerAccessKey, 256),
    status: 'preparing' as const,
    phase: 'preparing',
    progress: 0,
    attempt: 0,
    maxAttempts: JOB_MAX_ATTEMPTS,
    preparedAt: now,
    updatedAt: now,
    ...(input.targetDeckId ? { targetDeckId: boundedText(input.targetDeckId, 256) } : {}),
    memoryIds: Object.freeze([...state.controls.memory.references]),
  });
  return {
    state: freezeState({ ...state, activeJob: handle, updatedAt: now }),
    handle,
  };
}

export function attachAgentSessionJob(
  state: AgentSessionState,
  receipt: AgentSessionJobReceipt,
): AgentSessionState {
  const current = state.activeJob;
  if (!current) throw new Error('No prepared NodeSlide job is available for this receipt.');
  if (current.kind !== receipt.kind) throw new Error('NodeSlide job receipt kind mismatch.');
  if (current.idempotencyKey !== receipt.idempotencyKey) {
    throw new Error('NodeSlide job receipt idempotency binding mismatch.');
  }
  return reconcileAgentSessionJob(state, receipt);
}

export function failPreparedAgentSessionJob(
  state: AgentSessionState,
  error: string,
  now = Date.now(),
): AgentSessionState {
  const current = state.activeJob;
  if (!current || current.status !== 'preparing') return state;
  return failAgentSessionJob(state, error, now);
}

export function failAgentSessionJob(
  state: AgentSessionState,
  error: string,
  now = Date.now(),
): AgentSessionState {
  const current = state.activeJob;
  if (!current || TERMINAL_JOB_STATUSES.has(current.status) || current.status === 'paused') {
    return state;
  }
  return freezeState({
    ...state,
    activeJob: Object.freeze({
      ...current,
      status: 'failed' as const,
      phase: 'failed',
      error: boundedError(error),
      updatedAt: now,
    }),
    updatedAt: now,
  });
}

export function reconcileAgentSessionJob(
  state: AgentSessionState,
  receipt: AgentSessionJobReceipt,
): AgentSessionState {
  const current = state.activeJob;
  if (!current) return state;
  if (current.jobId && current.jobId !== receipt.jobId) return state;
  if (current.kind !== receipt.kind) return state;
  if (current.idempotencyKey !== receipt.idempotencyKey) return state;
  if (current.jobId && receipt.updatedAt < current.updatedAt) return state;
  const { error: _currentError, ...currentWithoutError } = current;
  const next: AgentSessionJobHandle = Object.freeze({
    ...currentWithoutError,
    jobId: receipt.jobId,
    status: receipt.status,
    phase: boundedText(receipt.phase, 80),
    progress: Math.max(current.progress, clampProgress(receipt.progress)),
    attempt: boundedAttempt(receipt.attempt, receipt.maxAttempts),
    maxAttempts: boundedMaxAttempts(receipt.maxAttempts),
    updatedAt: receipt.updatedAt,
    ...(receipt.streamId ? { streamId: receipt.streamId } : {}),
    ...(receipt.workflowId ? { workflowId: receipt.workflowId } : {}),
    ...(receipt.resultDeckId ? { resultDeckId: receipt.resultDeckId } : {}),
    ...(receipt.resultPatchId ? { resultPatchId: receipt.resultPatchId } : {}),
    ...(receipt.resultCandidateDigest
      ? { resultCandidateDigest: boundedText(receipt.resultCandidateDigest, 256) }
      : {}),
    ...(receipt.conversationRunId ? { conversationRunId: receipt.conversationRunId } : {}),
    ...(receipt.budgetId ? { budgetId: boundedText(receipt.budgetId, 256) } : {}),
    memoryIds: Object.freeze(uniqueBounded(receipt.memoryIds ?? current.memoryIds, 24)),
    ...(receipt.error ? { error: boundedText(receipt.error, 600) } : {}),
  });
  return freezeState({
    ...state,
    activeJob: next,
    controls: freezeControls({
      ...state.controls,
      memory: Object.freeze({
        ...state.controls.memory,
        references: next.memoryIds,
      }),
    }),
    updatedAt: Math.max(state.updatedAt, receipt.updatedAt),
  });
}

export function archiveAgentSessionJob(
  state: AgentSessionState,
  now = Date.now(),
): AgentSessionState {
  const activeJob = state.activeJob;
  if (!activeJob || ACTIVE_JOB_STATUSES.has(activeJob.status)) return state;
  const { ownerAccessKey: _ownerAccessKey, ...summary } = activeJob;
  return freezeState({
    ...state,
    activeJob: null,
    lastJob: Object.freeze(summary),
    updatedAt: now,
  });
}

export function readAgentSessionState(
  storage: Pick<Storage, 'getItem'> | null,
  clientSessionId: string,
  now = Date.now(),
): AgentSessionState {
  if (!storage) return createInitialAgentSessionState(clientSessionId, now);
  try {
    const raw = storage.getItem(agentSessionStorageKey(clientSessionId));
    if (!raw) return createInitialAgentSessionState(clientSessionId, now);
    return normalizeState(JSON.parse(raw), clientSessionId, now);
  } catch {
    return createInitialAgentSessionState(clientSessionId, now);
  }
}

export function writeAgentSessionState(
  storage: Pick<Storage, 'setItem'> | null,
  state: AgentSessionState,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(agentSessionStorageKey(state.clientSessionId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function agentSessionStorageKey(clientSessionId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(clientSessionId)}`;
}

/** Stable, non-security fingerprint used only to reuse a pending intent key. */
export function agentSessionRequestFingerprint(value: unknown): string {
  const serialized = stableSerialize(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ (code + index), 0x85ebca6b);
  }
  return `intent-v1:${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export function isAgentSessionJobActive(status: AgentSessionJobStatus): boolean {
  return ACTIVE_JOB_STATUSES.has(status);
}

export function classifyAgentSessionJobFreshness(
  job: Pick<AgentSessionJobHandle, 'status' | 'updatedAt'> | null,
  now = Date.now(),
  stallAfterMs = AGENT_SESSION_JOB_STALL_AFTER_MS,
): AgentSessionJobFreshness {
  if (!job || TERMINAL_JOB_STATUSES.has(job.status) || job.status === 'awaiting_review') {
    return 'settled';
  }
  if (job.status === 'paused') return 'paused';
  return now >= job.updatedAt + Math.max(1, Math.floor(stallAfterMs)) ? 'stalled' : 'fresh';
}

export function isAgentSessionEditAuthorityLocked(job: AgentSessionJobHandle | null): boolean {
  return Boolean(
    job && job.kind === 'edit_proposal' && AUTHORITY_LOCK_JOB_STATUSES.has(job.status),
  );
}

export function agentSessionApprovalForDeck(
  state: AgentSessionState,
  deckId: string,
  now = Date.now(),
): AgentSessionControls['approval'] {
  const approval = state.controls.approval;
  return approval.mode === 'auto_apply' && approval.deckId === deckId && approval.expiresAt > now
    ? approval
    : Object.freeze({ mode: 'review' as const });
}

function defaultControls(): AgentSessionControls {
  return freezeControls({
    model: NODESLIDE_DEFAULT_AGENT_MODEL,
    effort: 'medium',
    scope: normalizeScope({
      kind: 'slide',
      operationMode: 'unrestricted',
      slideIds: [],
      elementIds: [],
    }),
    attachments: Object.freeze([]),
    web: Object.freeze({ enabled: false, consentGranted: false }),
    memory: Object.freeze({ mode: 'off', references: Object.freeze([]) }),
    approval: Object.freeze({ mode: 'review' as const }),
  });
}

function normalizeState(value: unknown, clientSessionId: string, now: number): AgentSessionState {
  if (!isRecord(value) || value.version !== NODESLIDE_AGENT_SESSION_VERSION) {
    return createInitialAgentSessionState(clientSessionId, now);
  }
  const controlsValue = isRecord(value.controls) ? value.controls : {};
  const initial = createInitialAgentSessionState(clientSessionId, now);
  const controlsPatch: AgentSessionControlPatch = {
    model: normalizeModel(controlsValue.model),
    effort: normalizeEffort(controlsValue.effort),
    attachments: Array.isArray(controlsValue.attachments)
      ? normalizeAttachments(controlsValue.attachments)
      : [],
    ...(isRecord(controlsValue.scope)
      ? {
          scope: {
            kind: normalizeScopeKind(controlsValue.scope.kind),
            operationMode: normalizeOperationMode(controlsValue.scope.operationMode),
            ...(typeof controlsValue.scope.deckId === 'string'
              ? { deckId: controlsValue.scope.deckId }
              : {}),
            slideIds: stringArray(controlsValue.scope.slideIds),
            elementIds: stringArray(controlsValue.scope.elementIds),
          },
        }
      : {}),
    ...(isRecord(controlsValue.web)
      ? {
          web: {
            enabled: controlsValue.web.enabled === true,
            // Consent is intentionally never restored after a reload.
            consentGranted: false,
          },
        }
      : {}),
    ...(isRecord(controlsValue.memory)
      ? {
          memory: {
            mode:
              controlsValue.memory.mode === 'relevant' ? ('relevant' as const) : ('off' as const),
            references: stringArray(controlsValue.memory.references),
          },
        }
      : {}),
    approval: normalizeApproval(controlsValue.approval, now),
  };
  const controls = updateAgentSessionControls(initial, controlsPatch, now).controls;
  const activeJob = normalizeJob(value.activeJob);
  const lastJob = normalizeJob(value.lastJob);
  return freezeState({
    version: NODESLIDE_AGENT_SESSION_VERSION,
    clientSessionId,
    surface: normalizeSurface(value.surface),
    controls,
    activeJob,
    lastJob: lastJob
      ? Object.freeze((({ ownerAccessKey: _ownerAccessKey, ...summary }) => summary)(lastJob))
      : null,
    updatedAt: finiteNumber(value.updatedAt, now),
  });
}

function normalizeJob(value: unknown): AgentSessionJobHandle | null {
  if (!isRecord(value)) return null;
  if (value.kind !== 'create_deck' && value.kind !== 'edit_proposal') return null;
  if (!isJobStatus(value.status)) return null;
  if (typeof value.idempotencyKey !== 'string' || typeof value.requestFingerprint !== 'string') {
    return null;
  }
  const ownerAccessKey = typeof value.ownerAccessKey === 'string' ? value.ownerAccessKey : '';
  return Object.freeze({
    kind: value.kind,
    idempotencyKey: value.idempotencyKey.slice(0, 160),
    requestFingerprint: value.requestFingerprint.slice(0, 160),
    ownerAccessKey: ownerAccessKey.slice(0, 256),
    status: value.status,
    phase: typeof value.phase === 'string' ? value.phase.slice(0, 80) : value.status,
    progress: clampProgress(finiteNumber(value.progress, 0)),
    attempt: boundedAttempt(
      finiteNumber(value.attempt, 0),
      finiteNumber(value.maxAttempts, JOB_MAX_ATTEMPTS),
    ),
    maxAttempts: boundedMaxAttempts(finiteNumber(value.maxAttempts, JOB_MAX_ATTEMPTS)),
    preparedAt: finiteNumber(value.preparedAt, Date.now()),
    updatedAt: finiteNumber(value.updatedAt, Date.now()),
    ...(typeof value.jobId === 'string' ? { jobId: value.jobId.slice(0, 256) } : {}),
    ...(typeof value.streamId === 'string' ? { streamId: value.streamId.slice(0, 256) } : {}),
    ...(typeof value.workflowId === 'string' ? { workflowId: value.workflowId.slice(0, 256) } : {}),
    ...(typeof value['targetDeckId'] === 'string'
      ? { targetDeckId: value['targetDeckId'].slice(0, 256) }
      : {}),
    ...(typeof value.resultDeckId === 'string'
      ? { resultDeckId: value.resultDeckId.slice(0, 256) }
      : {}),
    ...(typeof value.resultPatchId === 'string'
      ? { resultPatchId: value.resultPatchId.slice(0, 256) }
      : {}),
    ...(typeof value['resultCandidateDigest'] === 'string'
      ? { resultCandidateDigest: value['resultCandidateDigest'].slice(0, 256) }
      : {}),
    ...(typeof value.conversationRunId === 'string'
      ? { conversationRunId: value.conversationRunId.slice(0, 256) }
      : {}),
    ...(typeof value['budgetId'] === 'string' ? { budgetId: value['budgetId'].slice(0, 256) } : {}),
    memoryIds: Object.freeze(uniqueBounded(stringArray(value.memoryIds), 24)),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0, 600) } : {}),
  });
}

function normalizeAttachments(values: readonly unknown[]): readonly AgentSessionAttachment[] {
  const attachments: AgentSessionAttachment[] = [];
  let totalBytes = 0;
  for (const value of values.slice(0, NODESLIDE_CREATE_ATTACHMENT_MAX_FILES)) {
    if (!isRecord(value)) continue;
    if (
      typeof value.id !== 'string' ||
      typeof value.name !== 'string' ||
      typeof value.mediaType !== 'string' ||
      typeof value.content !== 'string'
    ) {
      continue;
    }
    const contentBytes = new TextEncoder().encode(value.content).byteLength;
    if (
      contentBytes > NODESLIDE_DATA_ATTACHMENT_MAX_BYTES ||
      totalBytes + contentBytes > NODESLIDE_CREATE_ATTACHMENT_MAX_TOTAL_BYTES
    ) {
      continue;
    }
    totalBytes += contentBytes;
    attachments.push(
      Object.freeze({
        id: value.id.slice(0, 160),
        name: value.name.slice(0, 220),
        mediaType: value.mediaType.slice(0, 120),
        content: value.content,
        lastModified: finiteNumber(value.lastModified, 0),
      }),
    );
  }
  return Object.freeze(attachments);
}

function normalizeScope(value: Partial<AgentSessionScope>): AgentSessionScope {
  return Object.freeze({
    kind: normalizeScopeKind(value.kind),
    operationMode: normalizeOperationMode(value.operationMode),
    ...(typeof value.deckId === 'string' && value.deckId.trim()
      ? { deckId: value.deckId.trim().slice(0, 256) }
      : {}),
    slideIds: Object.freeze(uniqueBounded(value.slideIds ?? [], 24)),
    elementIds: Object.freeze(uniqueBounded(value.elementIds ?? [], 64)),
  });
}

function freezeControls(controls: AgentSessionControls): AgentSessionControls {
  return Object.freeze({
    ...controls,
    scope: Object.freeze(controls.scope),
    attachments: Object.freeze([...controls.attachments]),
    web: Object.freeze(controls.web),
    memory: Object.freeze({
      ...controls.memory,
      references: Object.freeze([...controls.memory.references]),
    }),
    approval: Object.freeze(controls.approval),
  });
}

function freezeState(state: AgentSessionState): AgentSessionState {
  return Object.freeze(state);
}

function controlsEqual(left: AgentSessionControls, right: AgentSessionControls): boolean {
  return (
    left.model === right.model &&
    left.effort === right.effort &&
    left.web.enabled === right.web.enabled &&
    left.web.consentGranted === right.web.consentGranted &&
    left.memory.mode === right.memory.mode &&
    sameStrings(left.memory.references, right.memory.references) &&
    left.approval.mode === right.approval.mode &&
    approvalEqual(left.approval, right.approval) &&
    left.scope.kind === right.scope.kind &&
    left.scope.operationMode === right.scope.operationMode &&
    left.scope.deckId === right.scope.deckId &&
    sameStrings(left.scope.slideIds, right.scope.slideIds) &&
    sameStrings(left.scope.elementIds, right.scope.elementIds) &&
    left.attachments.length === right.attachments.length &&
    left.attachments.every((attachment, index) => {
      const candidate = right.attachments[index];
      return (
        candidate !== undefined &&
        attachment.id === candidate.id &&
        attachment.name === candidate.name &&
        attachment.mediaType === candidate.mediaType &&
        attachment.content === candidate.content &&
        attachment.lastModified === candidate.lastModified
      );
    })
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeModel(value: unknown): AgentSessionModel {
  return value === 'deterministic' || isNodeSlideAgentModelId(value)
    ? value
    : NODESLIDE_DEFAULT_AGENT_MODEL;
}

function normalizeEffort(value: unknown) {
  return NODESLIDE_REASONING_EFFORTS.some((effort) => effort.id === value)
    ? (value as AgentSessionControls['effort'])
    : 'medium';
}

function normalizeSurface(value: unknown): AgentSessionSurface {
  return value === 'create' || value === 'editor' ? value : 'landing';
}

function normalizeScopeKind(value: unknown): AgentSessionScope['kind'] {
  return value === 'deck' || value === 'selected_slides' || value === 'elements' ? value : 'slide';
}

function normalizeOperationMode(value: unknown): AgentSessionScope['operationMode'] {
  return value === 'copy' || value === 'style' || value === 'layout' ? value : 'unrestricted';
}

function normalizeApproval(value: unknown, now: number): AgentSessionControls['approval'] {
  if (!isRecord(value) || value.mode !== 'auto_apply') {
    return Object.freeze({ mode: 'review' as const });
  }
  const deckId = typeof value.deckId === 'string' ? value.deckId.trim().slice(0, 256) : '';
  const grantId = typeof value.grantId === 'string' ? value.grantId.trim().slice(0, 160) : '';
  const token = typeof value.token === 'string' ? value.token.trim().slice(0, 512) : '';
  const policyDigest =
    typeof value.policyDigest === 'string' ? value.policyDigest.trim().slice(0, 256) : '';
  const issuedAt = finiteNumber(value.issuedAt, 0);
  const expiresAt = finiteNumber(value.expiresAt, 0);
  const maxUses = boundedPositiveInteger(value.maxUses, 100);
  const maxOperations = boundedPositiveInteger(value.maxOperations, 8);
  if (
    !deckId ||
    !grantId ||
    !token ||
    !policyDigest ||
    issuedAt <= 0 ||
    expiresAt <= now ||
    maxUses <= 0 ||
    maxOperations <= 0
  ) {
    return Object.freeze({ mode: 'review' as const });
  }
  return Object.freeze({
    mode: 'auto_apply' as const,
    deckId,
    grantId,
    token,
    policyDigest,
    issuedAt,
    expiresAt,
    maxUses,
    maxOperations,
  });
}

function approvalEqual(
  left: AgentSessionControls['approval'],
  right: AgentSessionControls['approval'],
): boolean {
  if (left.mode !== right.mode) return false;
  if (left.mode === 'review' || right.mode === 'review') return true;
  return (
    left.deckId === right.deckId &&
    left.grantId === right.grantId &&
    left.token === right.token &&
    left.policyDigest === right.policyDigest &&
    left.issuedAt === right.issuedAt &&
    left.expiresAt === right.expiresAt &&
    left.maxUses === right.maxUses &&
    left.maxOperations === right.maxOperations
  );
}

function boundedPositiveInteger(value: unknown, maximum: number): number {
  const numeric = finiteNumber(value, 0);
  return Math.max(0, Math.min(maximum, Math.floor(numeric)));
}

function isJobStatus(value: unknown): value is AgentSessionJobStatus {
  return (
    value === 'preparing' ||
    value === 'queued' ||
    value === 'running' ||
    value === 'retrying' ||
    value === 'paused' ||
    value === 'awaiting_review' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'rejected' ||
    value === 'stale'
  );
}

function uniqueBounded(values: readonly string[], limit: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function boundedText(value: string, max: number): string {
  const clean = value.trim();
  if (!clean) throw new Error('NodeSlide agent session value is required.');
  if (clean.length > max) throw new Error('NodeSlide agent session value exceeds its bound.');
  return clean;
}

function boundedError(value: string): string {
  const clean = value.trim();
  return (clean || 'The durable NodeSlide job failed safely.').slice(0, 600);
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.floor(value)));
}

function boundedMaxAttempts(value: number): number {
  return Math.max(1, Math.min(JOB_MAX_ATTEMPTS, Math.floor(value)));
}

function boundedAttempt(value: number, maxAttempts: number): number {
  return Math.max(0, Math.min(boundedMaxAttempts(maxAttempts), Math.floor(value)));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

interface UnknownRecord extends Record<string, unknown> {
  version?: unknown;
  controls?: unknown;
  model?: unknown;
  effort?: unknown;
  attachments?: unknown;
  scope?: unknown;
  kind?: unknown;
  operationMode?: unknown;
  deckId?: unknown;
  slideIds?: unknown;
  elementIds?: unknown;
  web?: unknown;
  enabled?: unknown;
  memory?: unknown;
  mode?: unknown;
  references?: unknown;
  approval?: unknown;
  grantId?: unknown;
  token?: unknown;
  policyDigest?: unknown;
  issuedAt?: unknown;
  expiresAt?: unknown;
  maxUses?: unknown;
  maxOperations?: unknown;
  activeJob?: unknown;
  lastJob?: unknown;
  surface?: unknown;
  updatedAt?: unknown;
  status?: unknown;
  idempotencyKey?: unknown;
  requestFingerprint?: unknown;
  ownerAccessKey?: unknown;
  phase?: unknown;
  progress?: unknown;
  attempt?: unknown;
  maxAttempts?: unknown;
  preparedAt?: unknown;
  jobId?: unknown;
  streamId?: unknown;
  workflowId?: unknown;
  resultDeckId?: unknown;
  resultPatchId?: unknown;
  conversationRunId?: unknown;
  memoryIds?: unknown;
  error?: unknown;
  id?: unknown;
  name?: unknown;
  mediaType?: unknown;
  content?: unknown;
  lastModified?: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}
