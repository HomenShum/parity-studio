import type { DeckPatch, NodeSlideWorkspace, ValidationResult } from './nodeslide';
import { validatePatchScope } from './nodeslidePatch';

export const NODESLIDE_DELEGATION_GRANT_VERSION = 'nodeslide.delegation-grant/v1' as const;
export const NODESLIDE_DELEGATION_POLICY_VERSION = 'nodeslide.delegation-policy/v1' as const;
export const NODESLIDE_DELEGATION_CAPABILITY = 'accept_validated' as const;
export const NODESLIDE_DELEGATION_PROPOSAL_SOURCE = 'agent' as const;
export const NODESLIDE_DELEGATION_PROPOSAL_KIND = 'edit' as const;
export const NODESLIDE_DELEGATION_MAX_OPERATIONS = 8 as const;
export const NODESLIDE_DELEGATION_MAX_USES = 64 as const;
export const NODESLIDE_DELEGATION_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const NODESLIDE_BROWSER_DELEGATION_TTL_MS = 12 * 60 * 60 * 1_000;

export type NodeSlideDelegationClientKind = 'browser' | 'codex' | 'claude';
export type NodeSlideDelegationGrantStatus = 'active' | 'expired' | 'revoked' | 'exhausted';

/** Immutable fields covered by a grant's SHA-256 policy digest. */
export interface NodeSlideDelegationPolicy {
  policyVersion: typeof NODESLIDE_DELEGATION_POLICY_VERSION;
  deckId: string;
  clientKind: NodeSlideDelegationClientKind;
  capability: typeof NODESLIDE_DELEGATION_CAPABILITY;
  proposalSource: typeof NODESLIDE_DELEGATION_PROPOSAL_SOURCE;
  proposalKind: typeof NODESLIDE_DELEGATION_PROPOSAL_KIND;
  maxOperations: number;
  maxUses: number;
  createdAt: number;
  expiresAt: number;
}

/** Safe public projection. Raw tokens and token digests are intentionally absent. */
export interface NodeSlideDelegationGrant extends NodeSlideDelegationPolicy {
  schemaVersion: typeof NODESLIDE_DELEGATION_GRANT_VERSION;
  id: string;
  useCount: number;
  policyDigest: string;
  status: NodeSlideDelegationGrantStatus;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface NodeSlideDelegationIssueReceipt {
  grant: NodeSlideDelegationGrant;
  /** Opaque bearer capability returned only by issueGrant. */
  token: string;
}

export interface NodeSlideDelegationUseReceipt {
  grantId: string;
  useCount: number;
  maxUses: number;
  replayed: boolean;
}

export interface NodeSlideDelegationAcceptanceReceipt {
  patch: DeckPatch;
  workspace: NodeSlideWorkspace | null;
  validation?: ValidationResult;
  rebased: boolean;
  staleReasons?: string[];
  delegation: NodeSlideDelegationUseReceipt;
}

export type NodeSlideDecisionProvenance =
  | {
      authority: 'owner_capability';
      decidedAt: number;
    }
  | {
      authority: 'delegated';
      capability: typeof NODESLIDE_DELEGATION_CAPABILITY;
      grantId: string;
      clientKind: NodeSlideDelegationClientKind;
      policyDigest: string;
      decidedAt: number;
    };

/** Canonical fixed-order serialization used as the input to the policy SHA-256 digest. */
export function nodeSlideDelegationPolicyDigestInput(policy: NodeSlideDelegationPolicy): string {
  return JSON.stringify({
    policyVersion: policy.policyVersion,
    deckId: policy.deckId,
    clientKind: policy.clientKind,
    capability: policy.capability,
    proposalSource: policy.proposalSource,
    proposalKind: policy.proposalKind,
    maxOperations: policy.maxOperations,
    maxUses: policy.maxUses,
    createdAt: policy.createdAt,
    expiresAt: policy.expiresAt,
  });
}

export function nodeSlideDelegationGrantStatus(
  grant: Pick<NodeSlideDelegationGrant, 'expiresAt' | 'revokedAt' | 'useCount' | 'maxUses'>,
  now: number,
): NodeSlideDelegationGrantStatus {
  if (grant.revokedAt !== undefined) return 'revoked';
  if (now >= grant.expiresAt) return 'expired';
  if (grant.useCount >= grant.maxUses) return 'exhausted';
  return 'active';
}

/**
 * Fast policy checks performed before the normal commit path. The commit path
 * remains authoritative for full snapshot, scope, CAS, and validation checks.
 */
export function nodeSlideDelegationProposalViolations(args: {
  grant: Pick<NodeSlideDelegationGrant, 'deckId' | 'maxOperations'>;
  proposal: Pick<
    DeckPatch,
    'deckId' | 'scope' | 'operations' | 'source' | 'proposalKind' | 'traceId'
  >;
}): string[] {
  const { grant, proposal } = args;
  const violations: string[] = [];
  if (proposal.deckId !== grant.deckId || proposal.scope.deckId !== grant.deckId) {
    violations.push('The proposal is outside the delegated deck scope.');
  }
  if (proposal.source !== NODESLIDE_DELEGATION_PROPOSAL_SOURCE) {
    violations.push('Delegated acceptance requires an agent proposal.');
  }
  if ((proposal.proposalKind ?? 'edit') !== NODESLIDE_DELEGATION_PROPOSAL_KIND) {
    violations.push('Delegated acceptance permits edit proposals only.');
  }
  if (!proposal.traceId) {
    violations.push('Delegated acceptance requires trace-bound proposal provenance.');
  }
  if (
    proposal.operations.length === 0 ||
    proposal.operations.length > grant.maxOperations ||
    proposal.operations.length > NODESLIDE_DELEGATION_MAX_OPERATIONS
  ) {
    violations.push('The proposal exceeds the delegated operation policy.');
  }
  if (
    proposal.operations.some(
      (operation) =>
        operation.op === 'remove_element' ||
        operation.op === 'remove_slide' ||
        (operation.op === 'set_visibility_v1' && !operation.visible),
    )
  ) {
    violations.push('Destructive operations require explicit review.');
  }
  violations.push(...validatePatchScope(proposal.scope, proposal.operations));
  return [...new Set(violations)];
}
