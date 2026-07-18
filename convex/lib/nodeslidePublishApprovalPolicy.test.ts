import { describe, expect, it } from 'vitest';
import {
  activeApprovals,
  decideNodeSlidePublishApproval,
  selectAuthorizingApproval,
} from './nodeslidePublishApprovalPolicy';

const APPROVAL = {
  deckVersion: 4,
  validationId: 'validation_v4',
  approverId: 'approver_a',
  approvedAt: 1_700_000_000_000,
};

describe('decideNodeSlidePublishApproval', () => {
  it('allows freely when the gate is off', () => {
    const decision = decideNodeSlidePublishApproval({
      required: false,
      deckVersion: 4,
      validationId: 'validation_v4',
      approval: null,
    });
    expect(decision).toEqual({ allowed: true, basis: 'approval_not_required' });
  });

  it('fails closed when required and no sign-off exists', () => {
    const decision = decideNodeSlidePublishApproval({
      required: true,
      deckVersion: 4,
      validationId: 'validation_v4',
      approval: null,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe('approval_required');
  });

  it('accepts a sign-off bound to the exact version and validation receipt', () => {
    const decision = decideNodeSlidePublishApproval({
      required: true,
      deckVersion: 4,
      validationId: 'validation_v4',
      approval: APPROVAL,
    });
    expect(decision).toMatchObject({ allowed: true, basis: 'approved', approverId: 'approver_a' });
  });

  it('rejects a stale sign-off after the deck advances', () => {
    const versionStale = decideNodeSlidePublishApproval({
      required: true,
      deckVersion: 5,
      validationId: 'validation_v5',
      approval: APPROVAL,
    });
    expect(versionStale.allowed).toBe(false);
    if (versionStale.allowed) return;
    expect(versionStale.code).toBe('approval_stale');
    expect(versionStale.message).toContain('v4');
    expect(versionStale.message).toContain('v5');

    // Same version number but a different validation receipt is equally stale.
    const receiptStale = decideNodeSlidePublishApproval({
      required: true,
      deckVersion: 4,
      validationId: 'validation_v4_rev2',
      approval: APPROVAL,
    });
    expect(receiptStale.allowed).toBe(false);
  });
});

describe('revocation invalidates a prior sign-off', () => {
  const approvals = [
    { approverId: 'approver_a', approvedAt: 1_000, validationId: 'v4' },
    { approverId: 'approver_b', approvedAt: 3_000, validationId: 'v4' },
    { approverId: 'approver_c', approvedAt: 2_000, validationId: 'v4' },
  ];

  it('drops sign-offs from revoked approvers and keeps the rest', () => {
    const active = activeApprovals(approvals, new Set(['approver_b']));
    expect(active.map((row) => row.approverId)).toEqual(['approver_a', 'approver_c']);
  });

  it('selects the newest surviving sign-off, not the newest overall', () => {
    // approver_b is newest (3000) but revoked; the authorizing sign-off must fall back
    // to the newest NON-revoked one (approver_c at 2000), never the revoked capability.
    const authorizing = selectAuthorizingApproval(approvals, new Set(['approver_b']));
    expect(authorizing?.approverId).toBe('approver_c');
  });

  it('authorizes nobody once every approver is revoked (fail-closed)', () => {
    const authorizing = selectAuthorizingApproval(
      approvals,
      new Set(['approver_a', 'approver_b', 'approver_c']),
    );
    expect(authorizing).toBeNull();
  });

  it('feeds the gate a null approval when the only sign-off is revoked, blocking publish', () => {
    const onlyRevoked = [{ approverId: 'approver_a', approvedAt: 1_000 }];
    const authorizing = selectAuthorizingApproval(onlyRevoked, new Set(['approver_a']));
    const decision = decideNodeSlidePublishApproval({
      required: true,
      deckVersion: 4,
      validationId: 'validation_v4',
      approval: authorizing
        ? { ...authorizing, deckVersion: 4, validationId: 'validation_v4' }
        : null,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe('approval_required');
  });
});
