import type {
  NodeSlideAgentModelId,
  NodeSlideReasoningEffort,
  OperationMode,
} from '../../../../shared/nodeslide';

export const NODESLIDE_AGENT_SESSION_VERSION = 1 as const;

export type AgentSessionSurface = 'landing' | 'create' | 'editor';
export type AgentSessionModel = 'deterministic' | NodeSlideAgentModelId;
export type AgentSessionMemoryMode = 'off' | 'relevant';
export type AgentSessionApprovalMode = 'review' | 'auto_apply';
export type AgentSessionScopeKind = 'deck' | 'slide' | 'selected_slides' | 'elements';
export type AgentSessionJobKind = 'create_deck' | 'edit_proposal';
export type AgentSessionJobStatus =
  | 'preparing'
  | 'queued'
  | 'running'
  | 'retrying'
  | 'paused'
  | 'awaiting_review'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'rejected'
  | 'stale';
export type AgentSessionJobFreshness = 'fresh' | 'stalled' | 'paused' | 'settled';

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

/**
 * Browser-held delegation for the existing validated proposal lane.
 *
 * This is deliberately separate from provider/web consent. It authorizes the
 * owner-capability client to call the normal Accept mutation after the exact
 * candidate passes scope, CAS, digest, and validation checks. It never grants
 * publish, share, export, deletion, or external egress authority.
 */
export type AgentSessionApprovalState =
  | { mode: 'review' }
  | {
      mode: 'auto_apply';
      deckId: string;
      grantId: string;
      /** Raw, browser-held capability. The backend stores only its digest. */
      token: string;
      policyDigest: string;
      issuedAt: number;
      expiresAt: number;
      maxUses: number;
      maxOperations: number;
    };

export type AgentSessionDelegationGrant = Extract<
  AgentSessionApprovalState,
  { mode: 'auto_apply' }
>;

export interface AgentSessionControls {
  model: AgentSessionModel;
  effort: NodeSlideReasoningEffort;
  scope: AgentSessionScope;
  attachments: readonly AgentSessionAttachment[];
  web: AgentSessionWebState;
  memory: AgentSessionMemoryState;
  approval: AgentSessionApprovalState;
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
  targetDeckId?: string;
  resultDeckId?: string;
  resultPatchId?: string;
  resultCandidateDigest?: string;
  conversationRunId?: string;
  budgetId?: string;
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
  resultCandidateDigest?: string;
  conversationRunId?: string;
  budgetId?: string;
  /** Admission-time routing decision published by the server (advisory_v1). */
  routingReceipt?: {
    decision:
      | {
          kind: 'selected';
          provider: string;
          modelId: string;
          estimatedMicroUsd: number | null;
          pricingSource: string | null;
        }
      | { kind: 'refused'; code: string; message: string };
    availabilityBasis: { windowMs: number; signalCount: number };
    enforcement: 'advisory_v1';
  };
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
  approval?:
    | AgentSessionApprovalState
    | Partial<Extract<AgentSessionApprovalState, { mode: 'auto_apply' }>>;
}
