import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const studioSource = readFileSync('src/domains/nodeslide/NodeSlideStudio.tsx', 'utf8');

describe('NodeSlide delegated-mode fail-closed UI contract', () => {
  it('removes local authority synchronously before attempting server revocation', () => {
    expect(studioSource).toMatch(
      /blockedDelegationGrantIdsRef\.current\.add\(approval\.grantId\);\s+clearApprovalGrant\(\);\s+setRevokingDelegationGrantId/,
    );
    expect(studioSource).toContain('attempts >= 3');
  });

  it('never auto-applies with a locally blocked grant and blocks mode changes during a run', () => {
    expect(studioSource).toContain(
      'blockedDelegationGrantIdsRef.current.has(delegatedApproval.grantId)',
    );
    expect(studioSource).toMatch(/!activeDeckId \|\|\s+!ownerAccessKey \|\|\s+authorityChangeBusy/);
    expect(studioSource).toContain('approvalBusy={authorityChangeBusy}');
    expect(studioSource).toContain('isAgentSessionEditAuthorityLocked(activeSessionJob)');
  });

  it('bounds grant issuance, revocation, and failed-install cleanup', () => {
    expect(studioSource.match(/withNodeSlideDelegationDeadline\(/g)).toHaveLength(3);
    expect(studioSource).toContain("'Delegation grant issuance'");
    expect(studioSource).toContain("'Delegation revocation'");
    expect(studioSource).toContain("'Delegation cleanup'");
  });

  it('uses the owner capability to reload workspace after every delegated receipt', () => {
    expect(studioSource).toMatch(
      /let acceptedWorkspace = delegatedReceipt\.workspace;\s+if \(!acceptedWorkspace\) \{\s+acceptedWorkspace = await convex\.query/,
    );
  });
});
