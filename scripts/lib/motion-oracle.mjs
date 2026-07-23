/**
 * Motion oracle — an expectation the compiler did not write.
 *
 * Check D of the motion gate cross-checks the emitted OOXML against a declared role-state map. The
 * map lives in `motion-expectations.json`, and that file is written by the compiler, from the same
 * in-memory objects it used to name the shapes. So the detector and the compiler agree by
 * construction: if the compiler decided a five-state scene had three states, it would emit three
 * named shapes and a manifest declaring three, and D would pass. The check was grading the
 * compiler against its own homework.
 *
 * The fix is a second, independent derivation. `benchmarks/artifact-atlas/v2/atlas.json` is the
 * canonical fixture set — authored before any PowerPoint compilation, and the thing the deck is
 * supposed to be a rendering OF. It states, per motion fixture, how many states exist, which
 * transition is declared, and which state is the static fallback. None of that comes from the
 * compiler.
 *
 *   canonical fixture  ->  oracle
 *   compiler           ->  OOXML + manifest
 *   gate               ->  reconcile the two, then judge the OOXML
 *
 * Role NAMES are deliberately not oracled. The canonical payload carries `state-1..state-N` with
 * no semantic roles; the compiler chooses `source`, `capture`, `fact` and so on. Inventing an
 * oracle for those would mean asserting a mapping nobody wrote down, which is how a check starts
 * enforcing its author's assumptions instead of the specification. Count, order and transition are
 * genuinely canonical, and they are what a miscompiled scene gets wrong.
 */

/** Spec kinds whose payload describes a staged scene. */
const MOTION_SPEC_KIND = 'motion';

/**
 * Derive the oracle from canonical fixtures. Returns one entry per motion fixture, keyed by the
 * scene id the compiler will use (its artifactType).
 */
export function deriveMotionOracle(fixtures) {
  const oracle = new Map();
  for (const fixture of fixtures ?? []) {
    const spec = fixture.artifactSpec;
    if (!spec || spec.kind !== MOTION_SPEC_KIND) continue;
    const payload = spec.payload ?? {};
    const states = Array.isArray(payload.states) ? payload.states : [];
    oracle.set(fixture.artifactType, {
      sceneId: fixture.artifactType,
      stateCount: states.length,
      stateIds: states.map((state) => String(state.id)),
      declaredTransition: payload.transition ?? null,
      staticFallbackStateId: payload.staticFallbackStateId ?? null,
      sourceFixture: fixture.number ?? null,
    });
  }
  return oracle;
}

/**
 * Reconcile the compiler's manifest against the oracle.
 *
 * Every disagreement is a finding, and a scene the oracle does not know about is a finding too:
 * a manifest can only be trusted for scenes the canonical fixtures actually declare, otherwise a
 * compiler could mint an easy scene and grade itself on that instead.
 */
export function reconcileMotionManifest(oracle, manifest) {
  const problems = [];
  const scenes = manifest?.scenes ?? [];

  for (const scene of scenes) {
    const expected = oracle.get(scene.sceneId);
    if (!expected) {
      problems.push(
        `scene ${scene.sceneId} is not declared by any canonical fixture — the compiler invented it, so nothing independent describes what it should contain.`,
      );
      continue;
    }
    const declaredStates = (scene.states ?? []).length;
    if (declaredStates !== expected.stateCount) {
      problems.push(
        `scene ${scene.sceneId}: the manifest declares ${declaredStates} states, the canonical fixture ${expected.stateCount}.`,
      );
    }
    if (
      expected.declaredTransition &&
      scene.declaredTransition &&
      scene.declaredTransition !== expected.declaredTransition
    ) {
      problems.push(
        `scene ${scene.sceneId}: the manifest declares transition "${scene.declaredTransition}", the canonical fixture "${expected.declaredTransition}".`,
      );
    }
  }

  // A canonical motion fixture with no manifest scene is a scene the gate never judged — UNLESS
  // the compiler declared in advance that it did not compile one.
  //
  // That distinction is the whole point. `interaction-clip` is canonically a three-state scene and
  // this repo deliberately ships it as a poster frame, because a still is not a clip and
  // `still-image-labelled-demo` is that archetype's named forbidden substitute. Refusing to accept
  // a declared fallback would pressure the compiler into faking a motion scene to satisfy the
  // oracle, which inverts what the gate exists for. Silence is still a finding; a declaration is
  // an answer.
  const declaredIds = new Set(scenes.map((scene) => scene.sceneId));
  const fallbacks = new Map(
    (manifest?.declaredFallbacks ?? []).map((entry) =>
      typeof entry === 'string' ? [entry, ''] : [entry.sceneId, entry.behavior ?? ''],
    ),
  );
  for (const [sceneId, expected] of oracle) {
    if (declaredIds.has(sceneId)) continue;
    if (fallbacks.has(sceneId)) {
      const behavior = fallbacks.get(sceneId);
      if (!behavior) {
        problems.push(
          `scene ${sceneId} is declared as a fallback but says nothing about what shipped instead — a fallback with no stated behavior is indistinguishable from an omission.`,
        );
      }
      continue;
    }
    problems.push(
      `canonical fixture ${expected.sourceFixture ?? '?'} declares motion scene ${sceneId}, but the manifest neither carries a scene for it nor declares a fallback — unjudged, not passing.`,
    );
  }

  return {
    verdict: problems.length === 0 ? 'agree' : 'disagree',
    problems,
    scenesChecked: scenes.length,
    oracleSize: oracle.size,
    summary:
      problems.length === 0
        ? `${scenes.length} scene(s) agree with ${oracle.size} canonical motion fixture(s)`
        : `${problems.length} disagreement(s) between the compiler's manifest and the canonical fixtures`,
  };
}
