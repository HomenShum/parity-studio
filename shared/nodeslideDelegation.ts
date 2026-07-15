import {
  type DeckPatch,
  NODESLIDE_MIN_READABLE_FONT_SIZE,
  type NodeSlideWorkspace,
  type PatchOperation,
  type ValidationResult,
} from './nodeslide';
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
  if (proposal.operations.some(nodeSlideDelegationOperationRequiresReview)) {
    violations.push('Destructive operations require explicit review.');
  }
  violations.push(...validatePatchScope(proposal.scope, proposal.operations));
  return [...new Set(violations)];
}

/**
 * Delegated mode is intentionally narrower than the general patch contract.
 * Operations that erase, hide, or make content unreadable remain review-only,
 * even when they use a nominally non-destructive opcode.
 */
export function nodeSlideDelegationOperationRequiresReview(operation: PatchOperation): boolean {
  switch (operation.op) {
    case 'remove_element':
    case 'remove_slide':
      return true;
    case 'set_visibility_v1':
      return !operation.visible;
    case 'replace_text':
      return !hasVisibleText(operation.text);
    case 'resize':
      return operation.width < 0.01 || operation.height < 0.01;
    case 'update_style':
      return styleRequiresReview(operation.properties);
    case 'add_element':
      return addedElementRequiresReview(operation.element, true);
    case 'add_slide':
      return (
        !hasVisibleText(operation.slide.title) ||
        operation.elements.some((element) => addedElementRequiresReview(element, false))
      );
    case 'update_image':
      return !hasVisibleText(operation.imageUrl) || !hasVisibleText(operation.altText);
    case 'update_slide':
      return (
        operation.properties.background !== undefined ||
        (operation.properties.title !== undefined && !hasVisibleText(operation.properties.title)) ||
        (operation.properties.notes !== undefined && !hasVisibleText(operation.properties.notes))
      );
    case 'update_deck':
      return (
        operation.properties.title !== undefined && !hasVisibleText(operation.properties.title)
      );
    case 'move':
    case 'update_chart':
    case 'group_elements_v1':
    case 'ungroup_elements_v1':
    case 'reorder_element_v1':
    case 'reorder_slide':
      return false;
    default: {
      const exhaustiveOperation: never = operation;
      return exhaustiveOperation;
    }
  }
}

function styleRequiresReview(
  properties: Extract<PatchOperation, { op: 'update_style' }>['properties'],
) {
  const { color, fill, fontSize, opacity, stroke } = properties;
  if (opacity !== undefined && opacity < 0.05) return true;
  if (fontSize !== undefined && fontSize < NODESLIDE_MIN_READABLE_FONT_SIZE) return true;
  if ([color, fill, stroke].some(isTransparentPaint)) return true;
  return (
    color !== undefined && fill !== undefined && canonicalPaint(color) === canonicalPaint(fill)
  );
}

function addedElementRequiresReview(
  element: Extract<PatchOperation, { op: 'add_element' }>['element'],
  canOccludeExistingContent: boolean,
): boolean {
  if (element.locked || element.visible === false) return true;
  if (element.bbox.width < 0.01 || element.bbox.height < 0.01) return true;
  if (element.style.opacity !== undefined && element.style.opacity < 0.05) return true;
  if (canOccludeExistingContent && element.bbox.width * element.bbox.height >= 0.45) {
    return (element.style.opacity ?? 1) >= 0.5;
  }
  return false;
}

function hasVisibleText(value: string): boolean {
  return value.normalize('NFKD').replace(/[\s\p{Cf}\p{M}]/gu, '').length > 0;
}

function isTransparentPaint(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === 'transparent') return true;
  const paint = canonicalPaint(normalized);
  if (/^#[0-9a-f]{8}$/u.test(paint)) return Number.parseInt(paint.slice(-2), 16) < 13;
  const alpha =
    normalized.match(/\/\s*(\d*\.?\d+%?)\s*\)$/u)?.[1] ??
    normalized.match(/^(?:rgba|hsla)\([^)]*,\s*(\d*\.?\d+%?)\s*\)$/u)?.[1];
  if (alpha === undefined) return false;
  const numericAlpha = alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
  return Number.isFinite(numericAlpha) && numericAlpha < 0.05;
}

function canonicalPaint(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  const shortHex = normalized.match(/^#([0-9a-f]{3,4})$/u)?.[1];
  if (shortHex) return `#${[...shortHex].map((digit) => `${digit}${digit}`).join('')}`;
  return normalized.replace(/[\s,]+/gu, '');
}
