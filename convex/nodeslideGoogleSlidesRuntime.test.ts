import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const runtimeSource = readFileSync(
  fileURLToPath(new URL('./nodeslideGoogleSlidesRuntime.ts', import.meta.url)),
  'utf8',
);

function exportedBlock(name: string, nextName: string): string {
  const start = runtimeSource.indexOf(`export const ${name} =`);
  const end = runtimeSource.indexOf(`export const ${nextName} =`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return runtimeSource.slice(start, end);
}

describe('NodeSlide Google Slides server runtime contract', () => {
  it('keeps all public runtime entry points owner-authorized and token-free', () => {
    const publicActions = [
      ['getState', 'attachPresentation'],
      ['attachPresentation', 'createPresentation'],
      ['createPresentation', 'planPull'],
      ['planPull', 'finalizePull'],
      ['finalizePull', 'planPush'],
      ['planPush', 'executePush'],
      ['executePush', 'cancelPending'],
      ['cancelPending', 'resetAttachment'],
      ['resetAttachment', 'readContextInternal'],
    ] as const;

    for (const [name, nextName] of publicActions) {
      const block = exportedBlock(name, nextName);
      const argsEnd = block.indexOf('handler:');
      const args = block.slice(0, argsEnd);
      expect(args, `${name} must require owner access`).toContain('ownerAccessKey: v.string()');
      expect(args, `${name} must not accept an access token`).not.toMatch(/accessToken/iu);
      expect(args, `${name} must not accept a refresh token`).not.toMatch(/refreshToken/iu);
      expect(args, `${name} must not accept a client secret`).not.toMatch(/clientSecret/iu);
    }
  });

  it('creates inbound proposals without accepting or applying them automatically', () => {
    expect(runtimeSource).toContain('api.nodeslide.proposePatch');
    expect(runtimeSource).not.toContain('api.nodeslide.acceptPatch');
    expect(runtimeSource).not.toContain('api.nodeslide.applyPatch');
    expect(runtimeSource).not.toMatch(/status:\s*['"]accepted['"]/u);
  });

  it('allows a Google deck write only in executePush after a pending-plan claim', () => {
    const planPush = exportedBlock('planPush', 'executePush');
    const executePush = exportedBlock('executePush', 'readContextInternal');

    expect(planPush).not.toContain('adapter.batchUpdate');
    expect(runtimeSource.match(/adapter\.batchUpdate/gu)).toHaveLength(1);
    expect(executePush.indexOf('runtimeInternal.claimPending')).toBeGreaterThanOrEqual(0);
    expect(executePush.indexOf('adapter.batchUpdate')).toBeGreaterThan(
      executePush.indexOf('runtimeInternal.claimPending'),
    );
  });

  it('creates an app-authorized blank target and records its bootstrap before any push', () => {
    const createPresentation = exportedBlock('createPresentation', 'planPull');

    expect(runtimeSource).toContain(
      "fetchWithTimeout('https://slides.googleapis.com/v1/presentations'",
    );
    expect(createPresentation).toContain('createAppBlankGoogleSlidesBootstrapBaseline');
    expect(createPresentation).toContain('runtimeInternal.attachState');
    expect(createPresentation).not.toContain('adapter.batchUpdate');
    expect(runtimeSource).toContain('remote.slides.length !== 1');
    expect(runtimeSource).toContain('remoteSlide.elements.length !== 0');
  });

  it('supports bounded recovery from conflicts and abandoned pending reviews', () => {
    const claimPlanning = exportedBlock('claimPlanning', 'recordPlan');
    const cancelPending = exportedBlock('cancelPending', 'resetAttachment');
    const cancelPendingState = exportedBlock('cancelPendingState', 'resetState');
    const finalizePull = exportedBlock('finalizePull', 'planPush');

    expect(claimPlanning).toContain("['active', 'conflict', 'error']");
    expect(cancelPending).toContain("initial.pendingPatch?.status === 'ready'");
    expect(cancelPending).toContain('api.nodeslide.rejectPatch');
    expect(cancelPending).toContain("initial.pendingPatch?.status === 'accepted'");
    expect(cancelPendingState).toContain("['awaiting_pull_review', 'awaiting_push_review']");
    expect(cancelPendingState).toContain("'active'");
    expect(finalizePull.indexOf('failureStateVersion = state.stateVersion')).toBeLessThan(
      finalizePull.indexOf('assertAcceptedInboundGoogleProposal'),
    );
    expect(finalizePull).toContain('recordActionFailure(ctx, args, failureStateVersion, error)');
    expect(runtimeSource).toContain('pendingPatchStatus?: DeckPatch');
  });

  it('performs revision-bound preflight and read-after-write convergence verification', () => {
    const executePush = exportedBlock('executePush', 'readContextInternal');
    const firstRead = executePush.indexOf('adapter.getPresentation');
    const currentPlanCheck = executePush.indexOf('assertGoogleSlidesExternalPlanCurrent');
    const write = executePush.indexOf('adapter.batchUpdate');
    const verifying = executePush.indexOf('runtimeInternal.markVerifying');
    const secondRead = executePush.indexOf('adapter.getPresentation', firstRead + 1);
    const convergence = executePush.indexOf('assertVerifiedGoogleSlidesConvergence');

    expect(firstRead).toBeGreaterThanOrEqual(0);
    expect(currentPlanCheck).toBeGreaterThan(firstRead);
    expect(write).toBeGreaterThan(currentPlanCheck);
    expect(verifying).toBeGreaterThan(write);
    expect(secondRead).toBeGreaterThan(verifying);
    expect(convergence).toBeGreaterThan(secondRead);
  });
});
