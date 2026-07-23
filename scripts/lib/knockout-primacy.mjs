/**
 * Causal primacy by knockout — the load-bearing half of "is the native object what the audience
 * sees", specified by the 2026-07-23 design review.
 *
 * Stage 0 (decidePrimacy in semantic-primacy.mjs) proves the native object is plausibly ON SHOW:
 * on-slide, substantial, not mostly occluded. It cannot prove the object is what is DOING the
 * communicating. A file can carry a real native chart on top AND an identical flattened shape-drawn
 * duplicate underneath; the native object passes every geometric test while the picture the reader
 * sees is drawn by the duplicate. Editing the "chart" then edits nothing they can see.
 *
 * Only a render can settle it, and it takes THREE, not two, because a plain baseline/knockout diff
 * cannot tell you which pixels belonged to the native object in the first place:
 *
 *   A  Baseline   the complete slide
 *   B  Knockout   the native semantic ownership set removed
 *   C  Isolated   ONLY the native semantic ownership set retained
 *
 *   native mask = C - blank         (the pixels the native object actually draws)
 *   causal mask = A - B             (the pixels that DISAPPEAR when it is removed)
 *
 * If removing the native object removed the very pixels it draws, it was responsible. If the
 * picture is unchanged (causal mask empty) while the native object clearly draws (native mask
 * full), a duplicate underneath is doing the work — that is the failure this exists to catch.
 *
 * THE NON-NEGOTIABLE RULE (from the trace-forgery lesson, applied here in advance): the producer /
 * compiler must NOT author B, C, the masks, or a "primacy passed" receipt. A verifier-side runner
 * receives the baseline PPTX + canonical ArtifactSpec, discovers the ownership set by PARSING, and
 * creates the renders itself. This module is the pure decision over masks that runner measured; it
 * never reads a producer-supplied verdict.
 */

/** The native object must draw at least this share of the declared region, or it is not on show. */
export const MIN_NATIVE_COVERAGE = 0.15;

/**
 * Removing the native object must erase at least this share of what it draws. Below it, the picture
 * survived the object's removal — something else (a flattened duplicate) is responsible.
 */
export const MIN_CAUSAL_RESPONSIBILITY = 0.6;

/**
 * Decide causal primacy from measured mask areas (pixels, within the declared artifact region).
 *
 * `nativeMaskArea` — C minus blank: what the native object draws
 * `causalMaskArea` — A minus B: what disappears when it is removed
 * `overlapArea`    — intersection of the two masks: what the native object draws AND that vanishes
 * `regionArea`     — the declared artifactRegion's pixel area
 * `measured`       — false when no runner produced masks; then the verdict is `not-run`, never a pass
 */
export function decideKnockout({
  nativeMaskArea = 0,
  causalMaskArea = 0,
  overlapArea = 0,
  regionArea = 0,
  measured = true,
} = {}) {
  if (!measured || regionArea <= 0) {
    return {
      verdict: 'not-run',
      pass: false,
      reason:
        'no verifier render produced masks, so causal primacy is unproven — reported, never scored as a pass.',
    };
  }

  const nativeCoverage = nativeMaskArea / regionArea;
  // Guard the ratio: if the native object draws nothing, it cannot be responsible for anything.
  const causalResponsibility = nativeMaskArea > 0 ? overlapArea / nativeMaskArea : 0;

  if (nativeCoverage < MIN_NATIVE_COVERAGE) {
    return {
      verdict: 'not-drawn',
      pass: false,
      nativeCoverage,
      causalResponsibility,
      reason: `the native object draws only ${(nativeCoverage * 100).toFixed(1)}% of the declared region — it is present in the file but barely on screen, so nothing rests on it.`,
    };
  }

  if (causalResponsibility < MIN_CAUSAL_RESPONSIBILITY) {
    return {
      verdict: 'flattened-duplicate',
      pass: false,
      nativeCoverage,
      causalResponsibility,
      reason: `removing the native object erased only ${(causalResponsibility * 100).toFixed(1)}% of what it draws — the picture survived its removal, so a flattened duplicate underneath is what the audience actually sees.`,
    };
  }

  return {
    verdict: 'causally-primary',
    pass: true,
    nativeCoverage,
    causalResponsibility,
    reason: `the native object draws ${(nativeCoverage * 100).toFixed(0)}% of the region and removing it erased ${(causalResponsibility * 100).toFixed(0)}% of that — it is what the audience sees, with no competing flattened copy.`,
  };
}

/**
 * Combine Stage 0 (region admission) and Stage 1 (knockout) into one causal-primacy verdict.
 *
 * The order is not cosmetic: knockout renders are expensive and meaningless for an object that is
 * off-slide or occluded, so region admission gates whether knockout even runs. A `region` verdict
 * that is not `visible` short-circuits to a fail without a render.
 */
export function decideCausalPrimacy({ region, knockout }) {
  if (!region || region.verdict !== 'visible') {
    return {
      verdict: 'region-fail',
      pass: false,
      stage: 'region',
      reason: `region admission failed (${region?.verdict ?? 'unknown'}): ${region?.reason ?? 'no region decision supplied'}`,
    };
  }
  const k = decideKnockout(knockout ?? { measured: false });
  return { ...k, stage: 'knockout' };
}
