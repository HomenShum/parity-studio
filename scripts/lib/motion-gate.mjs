/**
 * Motion scene verifier — checks A..H.
 *
 * A byte inspection can prove that native animation TOPOLOGY exists. It cannot prove PowerPoint
 * plays it. This module keeps those two claims apart on purpose: `topology` is decided from the
 * OOXML, `runtimePlayback` is only ever decided by an actual playback canary. Valid-looking XML
 * never substitutes for runtime proof.
 *
 * The checks (from the 2026-07-22 design council):
 *   A  timing topology        — p:timing / p:tnLst / mainSeq, exactly N-1 user-advance boundaries
 *   B  real behaviours        — each transition carries p:set|p:anim|animEffect|animMotion|...
 *   C  resolved targets       — every spTgt@spid resolves to a cNvPr on the same slide
 *   D  semantic state mapping — declared roles cross-checked against real named objects
 *   E  distinct signatures    — simulating the transitions yields N distinct semantic digests
 *   F  semantic progression   — every transition changes a REQUIRED role, not a title or accent
 *   G  pinned visual          — a declared pinned object survives every state
 *   H  runtime playback       — not run unless a canary supplies real screenshots
 */

const BEHAVIOR = /<p:(set|anim|animEffect|animMotion|animScale|animRot|animClr)\b/;

/** Shapes on the slide, by cNvPr id -> name. */
export function slideObjects(xml) {
  const byId = new Map();
  for (const match of xml.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)) {
    byId.set(match[1], match[2]);
  }
  return byId;
}

/** One entry per top-level user-advance boundary, with the targets it animates. */
export function transitionsOf(xml) {
  const transitions = [];
  for (const match of xml.matchAll(
    /<p:par><p:cTn\b[^>]*nodeType="clickEffect"[\s\S]*?<\/p:cTn><\/p:par>/g,
  )) {
    const block = match[0];
    transitions.push({
      targets: [...block.matchAll(/<p:spTgt spid="(\d+)"/g)].map((m) => m[1]),
      hasBehavior: BEHAVIOR.test(block),
    });
  }
  return transitions;
}

/** Semantic role encoded in a stable object name: ns:motion:<scene>:<state|pinned>:<role>. */
export function roleOf(name) {
  const match = /^ns:motion:[^:]+:([^:]+):(.+)$/.exec(name ?? '');
  return match ? { slot: match[1], role: match[2] } : null;
}

/**
 * Verify one motion scene. `expectation` is the compiler's declared intent — treated as a claim to
 * falsify, never as evidence. `runtimeCaptures` is only supplied by a real playback canary.
 */
export function verifyMotionScene({ xml, expectation, runtimeCaptures = null }) {
  const checks = {};
  const objects = slideObjects(xml);
  const transitions = transitionsOf(xml);
  const stateCount = expectation.states.length;

  // A — topology. N states means N-1 advances: the first state is visible at slide entry.
  const hasTiming =
    /<p:timing>/.test(xml) && /<p:tnLst>/.test(xml) && /nodeType="mainSeq"/.test(xml);
  checks.A_timingTopology = {
    pass: hasTiming && transitions.length === stateCount - 1,
    detail: `p:timing=${hasTiming}, transitions=${transitions.length}, expected=${stateCount - 1}`,
  };

  // B — a bare <p:cTn> is not animation.
  const withoutBehavior = transitions.filter((t) => !t.hasBehavior).length;
  checks.B_realBehaviors = {
    pass: transitions.length > 0 && withoutBehavior === 0,
    detail: `${transitions.length - withoutBehavior}/${transitions.length} transitions carry a real animation behavior`,
  };

  // C — no orphan target ids.
  const allTargets = transitions.flatMap((t) => t.targets);
  const orphans = allTargets.filter((id) => !objects.has(id));
  checks.C_resolvedTargets = {
    pass: allTargets.length > 0 && orphans.length === 0,
    detail:
      orphans.length === 0
        ? `${allTargets.length} targets all resolve`
        : `orphan spids: ${orphans.join(', ')}`,
  };

  // D — declared roles must correspond to real named objects on the slide.
  const namedRoles = new Map();
  for (const [id, name] of objects) {
    const parsed = roleOf(name);
    if (parsed) namedRoles.set(id, parsed);
  }
  const declaredObjects = expectation.states.map((s) => s.object);
  const presentNames = new Set(objects.values());
  const missingDeclared = declaredObjects.filter((name) => !presentNames.has(name));
  checks.D_semanticStateMapping = {
    pass: missingDeclared.length === 0 && namedRoles.size >= stateCount,
    detail:
      missingDeclared.length === 0
        ? `${namedRoles.size} semantically named objects present`
        : `declared objects absent from slide: ${missingDeclared.join(', ')}`,
  };

  // E — simulate the transitions and require N distinct semantic digests. Only required roles
  // count: decorative accents and page numbers must not manufacture a difference.
  const required = new Set(expectation.requiredRoles);
  const visible = new Set();
  const firstRole = namedRoles.get(
    [...objects.keys()].find((id) => objects.get(id) === expectation.states[0]?.object),
  );
  if (firstRole && required.has(firstRole.role)) visible.add(firstRole.role);
  const digests = [[...visible].sort().join('|')];
  for (const transition of transitions) {
    for (const id of transition.targets) {
      const parsed = namedRoles.get(id);
      if (parsed && required.has(parsed.role)) visible.add(parsed.role);
    }
    digests.push([...visible].sort().join('|'));
  }
  const distinct = new Set(digests);
  checks.E_distinctStateSignatures = {
    pass: distinct.size === stateCount,
    detail: `${distinct.size} distinct semantic-state digests, expected ${stateCount}`,
  };

  // F — every transition must change a required role. Animating only a title fails here.
  const inertTransitions = transitions.filter(
    (t) => !t.targets.some((id) => required.has(namedRoles.get(id)?.role)),
  ).length;
  checks.F_semanticProgression = {
    pass: transitions.length > 0 && inertTransitions === 0,
    detail:
      transitions.length === 0
        ? 'no transitions to evaluate'
        : inertTransitions === 0
          ? 'every transition advances a required artifact role'
          : `${inertTransitions} transition(s) touch only titles or decoration`,
  };

  // G — the pinned object must exist and never be animated away.
  const pinnedPresent = presentNames.has(expectation.pinnedObject);
  const pinnedId = [...objects.keys()].find((id) => objects.get(id) === expectation.pinnedObject);
  const pinnedAnimated = pinnedId ? allTargets.includes(pinnedId) : false;
  checks.G_pinnedVisual = {
    pass: pinnedPresent && !pinnedAnimated,
    detail: pinnedPresent
      ? pinnedAnimated
        ? 'pinned object is animated, so it does not persist across states'
        : 'pinned object present through all states'
      : `pinned object ${expectation.pinnedObject} is absent`,
  };

  // H — topology is not playback. Without a canary this stays honestly unproven.
  const topologyPass = Object.values(checks).every((c) => c.pass);
  let runtimePlayback = 'not-run';
  if (Array.isArray(runtimeCaptures)) {
    const signatures = new Set(runtimeCaptures.map((c) => c.signature));
    runtimePlayback =
      runtimeCaptures.length === stateCount && signatures.size === stateCount ? 'pass' : 'fail';
  }
  checks.H_runtimePlayback = {
    pass: runtimePlayback === 'pass',
    detail:
      runtimePlayback === 'not-run'
        ? 'no PowerPoint runtime available; playback not proven by this inspection'
        : `${runtimeCaptures?.length ?? 0} captured states, ${runtimePlayback}`,
  };

  return {
    sceneId: expectation.sceneId,
    declaredTransition: expectation.declaredTransition,
    topology: topologyPass ? 'pass' : 'fail',
    runtimePlayback,
    // Native PLAYBACK is never claimed from bytes alone. Even a perfect topology leaves the
    // native-playback claim indeterminate until a canary runs.
    overall: !topologyPass
      ? 'fail'
      : runtimePlayback === 'pass'
        ? 'pass'
        : 'indeterminate-for-native-playback',
    checks,
  };
}
