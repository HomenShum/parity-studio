import type {
  NodeSlideAgentModelId,
  NodeSlideReasoningEffort,
  OperationMode,
} from '../../../../shared/nodeslide';

export const NODESLIDE_AGENT_SESSION_VERSION = 1 as const;

export type AgentSessionSurface = 'landing' | 'create' | 'editor';
export type AgentSessionModel = 'deterministic' | NodeSlideAgentModelId;
export type AgentSessionMemoryMode = 'off' | 'relevant';
export type AgentSessionScopeKind = 'deck' | 'slide' | 'selected_slides' | 'elements';
export type AgentSessionJobKind = 'create_deck' | 'edit_proposal';
export type AgentSessionJobStatus =
  | 'preparing'
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface AgentSessionAttachment {
  id: string;
  name: string;
  mediaType: string;
  content: string;
  lastModified: number;
}

export interface AgentSessionScope {
  kind: AgentSessionScopeKind;
  operationMode: OperationMode;
  deckId?: string;
  slideIds: readonly string[];
  elementIds: readonly string[];
}

export interface AgentSessionWebState {
  enabled: boolean;
  consentGranted: boolean;
}

export interface AgentSessionMemoryState {
  mode: AgentSessionMemoryMode;
  references: readonly string[];
}

export interface AgentSessionControls {
  model: AgentSessionModel;
  effort: NodeSlideReasoningEffort;
  scope: AgentSessionScope;
  attachments: readonly AgentSessionAttachment[];
  web: AgentSessionWebState;
  memory: AgentSessionMemoryState;
}

/**
 * The capability stays client-side and is persisted with the session handle so
 * a reload can re-subscribe to an owner-gated job. The durable job row stores
 * only its digest; the private workflow carries it until the same capability
 * becomes the created deck's owner key.
 */
export interface AgentSessionJobHandle {
  kind: AgentSessionJobKind;
  idempotencyKey: string;
  requestFingerprint: string;
  ownerAccessKey: string;
  status: AgentSessionJobStatus;
  phase: string;
  progress: number;
  attempt: number;
  maxAttempts: number;
  preparedAt: number;
  updatedAt: number;
  jobId?: string;
  streamId?: string;
  workflowId?: string;
  resultDeckId?: string;
  resultPatchId?: string;
  conversationRunId?: string;
  memoryIds: readonly string[];
  error?: string;
}

export interface AgentSessionJobSummary extends Omit<AgentSessionJobHandle, 'ownerAccessKey'> {}

export interface AgentSessionState {
  version: typeof NODESLIDE_AGENT_SESSION_VERSION;
  clientSessionId: string;
  surface: AgentSessionSurface;
  controls: AgentSessionControls;
  activeJob: AgentSessionJobHandle | null;
  lastJob: AgentSessionJobSummary | null;
  updatedAt: number;
}

export interface AgentSessionJobReceipt {
  jobId: string;
  kind: AgentSessionJobKind;
  idempotencyKey: string;
  status: Exclude<AgentSessionJobStatus, 'preparing'>;
  phase: string;
  progress: number;
  attempt: number;
  maxAttempts: number;
  streamId?: string;
  workflowId?: string;
  resultDeckId?: string;
  resultPatchId?: string;
  conversationRunId?: string;
  memoryIds?: readonly string[];
  error?: string;
  updatedAt: number;
}

export interface AgentSessionControlPatch {
  model?: AgentSessionModel;
  effort?: NodeSlideReasoningEffort;
  scope?: Partial<AgentSessionScope>;
  attachments?: readonly AgentSessionAttachment[];
  web?: Partial<AgentSessionWebState>;
  memory?: Partial<AgentSessionMemoryState>;
}
