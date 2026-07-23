import { describe, expect, it } from 'vitest';
import { decideCausalPrimacy, decideKnockout } from '../lib/knockout-primacy.mjs';

/**
 * The design review's exact case: a real native chart on top, an identical flattened shape-drawn
 * duplicate underneath. The native object passes every geometric test — on-slide, unoccluded, full
 * size — and the reader is looking at the duplicate. Only the three-render knockout catches it, and
 * the must-fail fixture below is that whole gate's reason to exist.
 *
 * Masks are given as areas within the declared region; a verifier-side runner measures them from
 * real renders. This is the pure decision over those numbers.
 */

const REGION = 1_000_000; // arbitrary region pixel area

describe('knockout: the flattened-duplicate case this gate exists for', () => {
  it('FAILS when removing the native object changes nothing — a duplicate draws the picture', () => {
    // Isolated shows the native chart draws the whole region (nativeMask full). But baseline and
    // knockout are identical because the flattened copy underneath still draws it, so causal mask
    // (A - B) is ~empty and the overlap is ~empty.
    const decision = decideKnockout({
      nativeMaskArea: 800_000,
      causalMaskArea: 20_000,
      overlapArea: 15_000, // removing native erased almost nothing it drew
      regionArea: REGION,
    });
    expect(decision.verdict).toBe('flattened-duplicate');
    expect(decision.pass).toBe(false);
    expect(decision.reason).toMatch(/survived its removal/);
  });

  it('PASSES a clean native artifact — removing it erases exactly what it drew', () => {
    // No duplicate: knockout removes the chart entirely, so causal mask == native mask.
    const decision = decideKnockout({
      nativeMaskArea: 800_000,
      causalMaskArea: 790_000,
      overlapArea: 780_000, // nearly all of what native draws vanished when removed
      regionArea: REGION,
    });
    expect(decision.verdict).toBe('causally-primary');
    expect(decision.pass).toBe(true);
  });

  it('FAILS when the native object barely draws in the region (off-region / occluded decoy)', () => {
    const decision = decideKnockout({
      nativeMaskArea: 40_000, // 4% of the region
      causalMaskArea: 40_000,
      overlapArea: 40_000,
      regionArea: REGION,
    });
    expect(decision.verdict).toBe('not-drawn');
    expect(decision.pass).toBe(false);
    expect(decision.reason).toMatch(/barely on screen/);
  });

  it('a partial duplicate — native draws, removing it erases only half — still fails', () => {
    // Half the picture is the native chart, half is a flattened copy. Causal responsibility ~0.5,
    // below the 0.6 floor: the audience is seeing a mixture, which is not clean native primacy.
    const decision = decideKnockout({
      nativeMaskArea: 800_000,
      causalMaskArea: 420_000,
      overlapArea: 400_000,
      regionArea: REGION,
    });
    expect(decision.verdict).toBe('flattened-duplicate');
  });
});

describe('knockout: absence is reported, never scored', () => {
  it('is not-run when no runner produced masks', () => {
    expect(decideKnockout({ measured: false }).verdict).toBe('not-run');
    expect(decideKnockout({ measured: false }).pass).toBe(false);
  });

  it('is not-run when the region has no area', () => {
    expect(decideKnockout({ nativeMaskArea: 5, regionArea: 0 }).verdict).toBe('not-run');
  });

  it('does not divide by zero when the native mask is empty', () => {
    const decision = decideKnockout({
      nativeMaskArea: 0,
      causalMaskArea: 0,
      overlapArea: 0,
      regionArea: REGION,
    });
    expect(decision.verdict).toBe('not-drawn');
    expect(decision.causalResponsibility).toBe(0);
  });
});

describe('causal primacy: region admission gates the knockout', () => {
  it('short-circuits to region-fail without a render when Stage 0 did not admit', () => {
    const decision = decideCausalPrimacy({
      region: { verdict: 'occluded', reason: 'only 8% of the object is unoccluded' },
      knockout: {
        nativeMaskArea: 800_000,
        causalMaskArea: 790_000,
        overlapArea: 780_000,
        regionArea: REGION,
      },
    });
    expect(decision.verdict).toBe('region-fail');
    expect(decision.pass).toBe(false);
    expect(decision.stage).toBe('region');
  });

  it('runs the knockout only when region admission passed', () => {
    const decision = decideCausalPrimacy({
      region: { verdict: 'visible', reason: '92% unoccluded' },
      knockout: {
        nativeMaskArea: 800_000,
        causalMaskArea: 790_000,
        overlapArea: 780_000,
        regionArea: REGION,
      },
    });
    expect(decision.stage).toBe('knockout');
    expect(decision.verdict).toBe('causally-primary');
    expect(decision.pass).toBe(true);
  });

  it('an admitted region with a flattened duplicate still fails at the knockout', () => {
    const decision = decideCausalPrimacy({
      region: { verdict: 'visible', reason: 'fully visible' },
      knockout: {
        nativeMaskArea: 800_000,
        causalMaskArea: 20_000,
        overlapArea: 15_000,
        regionArea: REGION,
      },
    });
    expect(decision.verdict).toBe('flattened-duplicate');
    expect(decision.pass).toBe(false);
  });

  it('a region that passed but where no knockout ran is not-run, not a pass', () => {
    const decision = decideCausalPrimacy({
      region: { verdict: 'visible', reason: 'visible' },
      knockout: { measured: false },
    });
    expect(decision.verdict).toBe('not-run');
    expect(decision.pass).toBe(false);
  });
});
