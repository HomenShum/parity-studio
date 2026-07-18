/**
 * D9 governance, pure core: whether publication may proceed. Deterministic and
 * fail-closed — when approval is required, only a recorded sign-off bound to the
 * EXACT deck version and validation receipt authorizes publish. A role the
 * server does not check is theater; this is the check.
 */
export type NodeSlidePublishApprovalDecision =
  | { allowed: true; basis: 'approval_not_required' }
  | { allowed: true; basis: 'approved'; approverId: string; approvedAt: number }
  | {
      allowed: false;
      code: 'approval_required' | 'approval_stale';
      message: string;
    };

/**
 * Hard ceiling on total approver rows per deck (active + revoked). Revoked rows are
 * retained for audit but never evicted, so without a ceiling an owner who cycles
 * issue -> revoke -> issue would grow the table (and every unbounded read of it) without
 * limit. Capping total rows keeps every approver read bounded by construction, so a
 * `.take(NODESLIDE_APPROVER_ROW_LIMIT)` is guaranteed to read the whole table.
 */
export const NODESLIDE_APPROVER_ROW_LIMIT = 64;

/**
 * Drop sign-offs from approvers the owner has since revoked. A revoked capability's
 * prior sign-off is void — this is the single source of truth for "which approvals
 * still count", shared by the publish gate and the owner-facing state so they can
 * never disagree.
 */
export function activeApprovals<T extends { approverId: string }>(
  approvals: readonly T[],
  revokedApproverIds: ReadonlySet<string>,
): T[] {
  return approvals.filter((approval) => !revokedApproverIds.has(approval.approverId));
}

/** The newest still-valid sign-off (revoked approvers excluded), or null. */
export function selectAuthorizingApproval<T extends { approverId: string; approvedAt: number }>(
  approvals: readonly T[],
  revokedApproverIds: ReadonlySet<string>,
): T | null {
  return (
    activeApprovals(approvals, revokedApproverIds).sort(
      (first, second) => second.approvedAt - first.approvedAt,
    )[0] ?? null
  );
}

export function decideNodeSlidePublishApproval(args: {
  required: boolean;
  deckVersion: number;
  validationId: string;
  approval: {
    deckVersion: number;
    validationId: string;
    approverId: string;
    approvedAt: number;
  } | null;
}): NodeSlidePublishApprovalDecision {
  if (!args.required) return { allowed: true, basis: 'approval_not_required' };
  if (!args.approval) {
    return {
      allowed: false,
      code: 'approval_required',
      message: `Publishing v${args.deckVersion} needs an approver sign-off before it can go live.`,
    };
  }
  if (
    args.approval.deckVersion !== args.deckVersion ||
    args.approval.validationId !== args.validationId
  ) {
    return {
      allowed: false,
      code: 'approval_stale',
      message: `The recorded sign-off covers v${args.approval.deckVersion}, not the current v${args.deckVersion}. Ask the approver to review the latest version.`,
    };
  }
  return {
    allowed: true,
    basis: 'approved',
    approverId: args.approval.approverId,
    approvedAt: args.approval.approvedAt,
  };
}
