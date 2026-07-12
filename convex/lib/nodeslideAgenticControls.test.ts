import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_AGENTIC_CONTROL_ENV,
  authorizeNodeSlideAgenticOperation,
  resolveNodeSlideAgenticControls,
} from './nodeslideAgenticControls';

describe('NodeSlide agentic kill switches', () => {
  it('defaults every material capability closed', () => {
    const controls = resolveNodeSlideAgenticControls({});

    expect(controls).toMatchObject({
      globalExecution: false,
      cohortAdmission: false,
      providerPlanning: false,
      providerAllowlist: [],
      kernelExecution: false,
      kernelAllowlist: [],
      networkEgress: false,
      renderRepair: false,
      automaticContinuation: false,
      fullTracePersistence: false,
      publication: false,
    });
    expect(controls.controlsDigest).toMatch(/^controls_sha256:[0-9a-f]{64}$/);
    expect(
      authorizeNodeSlideAgenticOperation(controls, { operation: 'deck_repl_shadow' }),
    ).toMatchObject({
      allowed: false,
      reasons: ['cohort_admission_disabled', 'global_execution_disabled'],
    });
  });

  it('accepts only exact true values and fail-closes malformed allowlists', () => {
    const controls = resolveNodeSlideAgenticControls({
      [NODESLIDE_AGENTIC_CONTROL_ENV.globalExecution]: 'TRUE',
      [NODESLIDE_AGENTIC_CONTROL_ENV.cohortAdmission]: '1',
      [NODESLIDE_AGENTIC_CONTROL_ENV.providerPlanning]: 'true',
      [NODESLIDE_AGENTIC_CONTROL_ENV.providerAllowlist]: 'openrouter,INVALID PROVIDER',
    });

    expect(controls.globalExecution).toBe(false);
    expect(controls.cohortAdmission).toBe(false);
    expect(controls.providerPlanning).toBe(true);
    expect(controls.providerAllowlist).toEqual([]);
  });

  it('requires both the feature switch and an exact provider or kernel allowlist match', () => {
    const controls = resolveNodeSlideAgenticControls({
      [NODESLIDE_AGENTIC_CONTROL_ENV.globalExecution]: 'true',
      [NODESLIDE_AGENTIC_CONTROL_ENV.cohortAdmission]: 'true',
      [NODESLIDE_AGENTIC_CONTROL_ENV.providerPlanning]: 'true',
      [NODESLIDE_AGENTIC_CONTROL_ENV.providerAllowlist]: 'openrouter/free',
      [NODESLIDE_AGENTIC_CONTROL_ENV.kernelExecution]: 'true',
      [NODESLIDE_AGENTIC_CONTROL_ENV.kernelAllowlist]: 'nodeslide/local-analysis',
    });

    expect(
      authorizeNodeSlideAgenticOperation(controls, {
        operation: 'provider_planning',
        providerId: 'openrouter/free',
      }).allowed,
    ).toBe(true);
    expect(
      authorizeNodeSlideAgenticOperation(controls, {
        operation: 'provider_planning',
        providerId: 'openrouter/paid',
      }),
    ).toMatchObject({ allowed: false, reasons: ['provider_not_allowlisted'] });
    expect(
      authorizeNodeSlideAgenticOperation(controls, {
        operation: 'analysis_kernel',
        kernelId: 'nodeslide/local-analysis',
      }).allowed,
    ).toBe(true);
  });

  it('keeps publication and network egress independently disabled', () => {
    const controls = resolveNodeSlideAgenticControls({
      [NODESLIDE_AGENTIC_CONTROL_ENV.globalExecution]: 'true',
      [NODESLIDE_AGENTIC_CONTROL_ENV.cohortAdmission]: 'true',
    });

    expect(
      authorizeNodeSlideAgenticOperation(controls, { operation: 'network_egress' }).reasons,
    ).toEqual(['network_egress_disabled']);
    expect(
      authorizeNodeSlideAgenticOperation(controls, { operation: 'publication' }).reasons,
    ).toEqual(['agentic_publication_disabled']);
  });
});
