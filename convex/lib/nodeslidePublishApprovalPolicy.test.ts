import { describe, expect, it } from 'vitest';
import { decideNodeSlidePublishApproval } from './nodeslidePublishApprovalPolicy';

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
