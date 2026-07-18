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
