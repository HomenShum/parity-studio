/**
 * Motion scene verifier — checks A..K.
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
 *   G  pinned visual          — a declared pinned object survives every state AND is visible
 *   H  runtime playback       — not run unless a canary supplies real screenshots
 *
 * Added after a second review found the scene could satisfy A-H and still not stage its narrative:
 *   I  one state per advance  — a click that reveals three roles lands the scene in two clicks
 *   J  declared order         — five distinct signatures in the wrong sequence is another scene
 *   K  no animated ancestor   — a group animation hides children whatever their own state says
 */

import { decidePrimacy, parseFrame } from './semantic-primacy.mjs';

const BEHAVIOR = /<p:(set|anim|animEffect|animMotion|animScale|animRot|animClr)\b/;

/**
 * A revealed state is detected by a JUMP in its own region's ink, not by an absolute level.
 *
 * An absolute threshold is wrong here and measurably so: a hidden region still carries residual
 * ink from whatever the pinned visual puts behind it, and that residual differs per region. The
 * invariant that actually holds is a staircase — each region sits flat at its own baseline, rises
 * sharply on the frame that reveals it, and stays up. Self-calibrating per region, so it works
 * whatever the slide is composed of.
 */
const REVEAL_RATIO = 1.4; // revealed ink must exceed its own baseline by this factor
const REVEAL_MARGIN = 0.008; // ...and by this absolute amount, so noise cannot trip it
const FLAT_TOLERANCE = 1.25; // an unrevealed region may drift by this much and still count as flat

/** The <p:sp> block for a named shape, so its geometry can be read. */
export function shapeBlockFor(xml, name) {
  for (const match of xml.matchAll(/<p:(sp|pic|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
    if (match[0].includes(`name="${name}"`)) return match[0];
  }
  return null;
}

/**
 * For each shape id, the ids of the <p:grpSp> groups it sits inside, outermost first.
 *
 * Gaming route 7: a required role's shape is revealed on cue and never touched again, while an
 * ancestor group is animated away — the child's own state is irrelevant once its parent is hidden,
 * so the role "appears" and nothing shows. Every per-shape check passes because every per-shape
 * check is looking at the wrong shape.
 *
 * Scanned by walking the tag stream rather than by regex-matching whole blocks, because groups
 * nest and a non-greedy block match closes at the first </p:grpSp> rather than the matching one.
 */
export function ancestorGroupsOf(xml) {
  const ancestors = new Map();
  const stack = [];
  const token = /<p:grpSp>|<\/p:grpSp>|<p:cNvPr id="(\d+)"[^>]*\/?>/g;
  let match = token.exec(xml);
  let pendingGroup = false;
  while (match !== null) {
    if (match[0] === '<p:grpSp>') {
      // The group's own cNvPr is the next id seen; mark that we are waiting for it.
      pendingGroup = true;
      stack.push(null);
    } else if (match[0] === '</p:grpSp>') {
      stack.pop();
    } else if (match[1]) {
      if (pendingGroup) {
        stack[stack.length - 1] = match[1];
        pendingGroup = false;
      } else {
        ancestors.set(match[1], stack.filter(Boolean));
      }
    }
    match = token.exec(xml);
  }
  return ancestors;
}

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
export function verifyMotionScene({ xml, expectation, runtimeCaptures = null, slideSize = null }) {
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

  // G — the pinned object must exist, never be animated away, and actually be VISIBLE.
  //
  // Survival is not visibility. A pinned shape can survive every transition while sitting
  // off-slide, at zero size, or behind an opaque rectangle, and the audience sees no pinned visual
  // at all. When slide geometry is available this measures it; without geometry it falls back to
  // the survival test and says so, rather than implying it checked something it did not.
  const pinnedPresent = presentNames.has(expectation.pinnedObject);
  const pinnedId = [...objects.keys()].find((id) => objects.get(id) === expectation.pinnedObject);
  const pinnedAnimated = pinnedId ? allTargets.includes(pinnedId) : false;
  const pinnedPrimacy =
    pinnedPresent && slideSize
      ? decidePrimacy({
          frame: parseFrame(shapeBlockFor(xml, expectation.pinnedObject) ?? ''),
          slide: slideSize,
          covers: [],
        })
      : null;
  const pinnedHidden = pinnedPrimacy ? pinnedPrimacy.verdict !== 'visible' : false;
  checks.G_pinnedVisual = {
    pass: pinnedPresent && !pinnedAnimated && !pinnedHidden,
    detail: !pinnedPresent
      ? `pinned object ${expectation.pinnedObject} is absent`
      : pinnedAnimated
        ? 'pinned object is animated, so it does not persist across states'
        : pinnedHidden
          ? `pinned object survives every state but is not visible: ${pinnedPrimacy.reason}`
          : pinnedPrimacy
            ? `pinned object present and visible through all states (${pinnedPrimacy.reason})`
            : 'pinned object present through all states (no slide geometry supplied, so visibility is unchecked)',
  };

  // I — each advance must reveal exactly the roles ITS canonical state boundary adds.
  //
  // An earlier version of this check required exactly one role per advance. That was wrong, and the
  // design review caught it: one legitimate canonical state may reveal several roles together — a
  // fact card plus the connector that binds it plus the source node it points at can be a single
  // state. A cardinality-of-one rule rejects that and would force the compiler to split a coherent
  // reveal into meaningless half-steps purely to satisfy the inspector, which is the gate distorting
  // the artifact instead of judging it.
  //
  // The rule that actually holds: the required roles an advance reveals must EQUAL the set the next
  // canonical state adds over the current one — no more (gaming route 6: one click doing two states'
  // work), no fewer, and no different roles. Cardinality is whatever the canonical fixture declares.
  // The per-state visible-role sets are what make the boundary computable. Without them the check
  // cannot form a delta, and saying so is honest; failing every transition would be a false accusation.
  const hasVisibleRoleSets = expectation.states.some((state) => Array.isArray(state.visibleRoles));
  const requiredRolesVisibleAt = (index) =>
    new Set((expectation.states[index]?.visibleRoles ?? []).filter((role) => required.has(role)));
  const boundaryMismatches = [];
  transitions.forEach((transition, step) => {
    // Transition `step` advances from canonical state `step` into state `step + 1`.
    const before = requiredRolesVisibleAt(step);
    const after = requiredRolesVisibleAt(step + 1);
    const expectedDelta = new Set([...after].filter((role) => !before.has(role)));
    const actualDelta = new Set(
      transition.targets.map((id) => namedRoles.get(id)?.role).filter((role) => required.has(role)),
    );
    const sameSet =
      expectedDelta.size === actualDelta.size &&
      [...actualDelta].every((role) => expectedDelta.has(role));
    if (!sameSet) {
      boundaryMismatches.push(
        `advance ${step + 1}: revealed {${[...actualDelta].sort().join(', ') || '∅'}} but its canonical state boundary adds {${[...expectedDelta].sort().join(', ') || '∅'}}`,
      );
    }
  });
  checks.I_stateBoundary = {
    pass: transitions.length > 0 && hasVisibleRoleSets && boundaryMismatches.length === 0,
    detail:
      transitions.length === 0
        ? 'no transitions to evaluate'
        : !hasVisibleRoleSets
          ? 'the expectation carries no per-state visibleRoles, so canonical state boundaries cannot be computed'
          : boundaryMismatches.length === 0
            ? 'every advance reveals exactly the roles its canonical state boundary adds'
            : boundaryMismatches.slice(0, 3).join('; '),
  };

  // J — the roles must appear in the ORDER the scene declares.
  //
  // Gaming route 4: all five required roles appear and every signature is distinct, but the
  // sequence runs source -> slide -> fact -> capture -> claim. Distinctness cannot see this;
  // a causal scene played out of order is a different scene.
  const declaredOrder = expectation.states
    .map((state) => roleOf(state.object)?.role)
    .filter((role) => role && required.has(role));
  const revealedOrder = [];
  for (const transition of transitions) {
    for (const id of transition.targets) {
      const role = namedRoles.get(id)?.role;
      if (role && required.has(role) && !revealedOrder.includes(role)) revealedOrder.push(role);
    }
  }
  // The first declared state is visible at slide entry, so the transitions carry the rest.
  const expectedReveals = declaredOrder.slice(1);
  const orderMatches =
    revealedOrder.length === expectedReveals.length &&
    revealedOrder.every((role, index) => role === expectedReveals[index]);
  checks.J_declaredOrder = {
    pass: expectedReveals.length === 0 || orderMatches,
    detail: orderMatches
      ? `roles reveal in the declared order: ${expectedReveals.join(' -> ')}`
      : `declared ${expectedReveals.join(' -> ') || '(none)'} but revealed ${revealedOrder.join(' -> ') || '(none)'}`,
  };

  // K — no required role may sit inside an animated ancestor group.
  //
  // Gaming route 7. A group animation overrides whatever its children are doing, so a role that is
  // revealed on cue and never touched again still shows nothing if its parent group is hidden. The
  // per-shape checks all pass because they are all looking at the wrong shape. Animating a group
  // that contains a required role is not automatically an attack — but it makes every other check
  // in this file unable to speak, so the gate refuses to certify it rather than guess.
  const ancestors = ancestorGroupsOf(xml);
  const animatedTargets = new Set(allTargets);
  const captured = [];
  for (const [id, parsed] of namedRoles) {
    if (!required.has(parsed.role)) continue;
    const animatedAncestor = (ancestors.get(id) ?? []).find((groupId) =>
      animatedTargets.has(groupId),
    );
    if (animatedAncestor)
      captured.push(`${parsed.role} (inside animated group ${animatedAncestor})`);
  }
  checks.K_noAnimatedAncestor = {
    pass: captured.length === 0,
    detail:
      captured.length === 0
        ? 'no required role sits inside an animated group'
        : `${captured.length} required role(s) can be hidden by an ancestor regardless of their own state: ${captured.join(', ')}`,
  };

  // H — topology is not playback. Without a canary this stays honestly unproven.
  //
  // Distinct frames are NECESSARY but NOT SUFFICIENT: one dot changing colour four times produces
  // five distinct frames while showing none of the intended states. So each frame is also checked
  // for STATE CORRESPONDENCE — frame N must show states 0..N-1 and must NOT yet show the rest,
  // measured as ink density inside each state's own rectangle.
  const topologyPass = Object.values(checks).every((c) => c.pass);
  let runtimePlayback = 'not-run';
  let correspondence = null;
  if (Array.isArray(runtimeCaptures)) {
    const signatures = new Set(runtimeCaptures.map((c) => c.signature));
    const countOk = runtimeCaptures.length === stateCount;
    const distinctOk = signatures.size === stateCount;

    const problems = [];
    const measured = runtimeCaptures.some((f) => Array.isArray(f.regions) && f.regions.length > 0);
    if (measured) {
      const inkAt = (frameIndex, stateIndex) =>
        Number(
          (runtimeCaptures[frameIndex]?.regions ?? []).find((r) => r.stateIndex === stateIndex)
            ?.ink,
        );

      for (let state = 0; state < stateCount; state += 1) {
        // Baseline: this region before it could possibly have been revealed. State 0 is visible at
        // slide entry, so it has no hidden phase to measure and is checked only for presence.
        const baseline = inkAt(0, state);
        if (!Number.isFinite(baseline)) continue;
        if (state === 0) continue;

        for (let frame = 1; frame < state; frame += 1) {
          const ink = inkAt(frame, state);
          if (Number.isFinite(ink) && ink > baseline * FLAT_TOLERANCE + REVEAL_MARGIN) {
            problems.push(
              `frame ${frame + 1}: state ${state + 1} brightened before its turn (${baseline.toFixed(3)} -> ${ink.toFixed(3)})`,
            );
          }
        }

        const revealed = inkAt(state, state);
        if (!Number.isFinite(revealed)) {
          problems.push(`state ${state + 1} was never measured on the frame that reveals it`);
        } else if (revealed < baseline * REVEAL_RATIO || revealed - baseline < REVEAL_MARGIN) {
          problems.push(
            `frame ${state + 1}: state ${state + 1} did not appear — its region barely changed (${baseline.toFixed(3)} -> ${revealed.toFixed(3)})`,
          );
        }

        // Once revealed it must stay revealed; a state that vanishes again is not a build.
        for (let frame = state + 1; frame < stateCount; frame += 1) {
          const ink = inkAt(frame, state);
          if (Number.isFinite(ink) && Number.isFinite(revealed) && ink < baseline * REVEAL_RATIO) {
            problems.push(
              `frame ${frame + 1}: state ${state + 1} disappeared after being revealed`,
            );
          }
        }
      }

      correspondence = {
        measured: true,
        pass: problems.length === 0,
        problems,
      };
    } else {
      correspondence = {
        measured: false,
        pass: false,
        problems: [
          'frames carry no per-state region measurements, so only distinctness could be checked',
        ],
      };
    }
    runtimePlayback = countOk && distinctOk && correspondence.pass ? 'pass' : 'fail';
  }
  checks.H_runtimePlayback = {
    pass: runtimePlayback === 'pass',
    detail:
      runtimePlayback === 'not-run'
        ? 'no PowerPoint runtime available; playback not proven by this inspection'
        : correspondence?.pass
          ? `${runtimeCaptures.length} frames, each showing exactly the states revealed so far`
          : `${runtimeCaptures?.length ?? 0} frames captured — ${(correspondence?.problems ?? ['distinctness failed']).slice(0, 3).join('; ')}`,
  };

  return {
    sceneId: expectation.sceneId,
    declaredTransition: expectation.declaredTransition,
    topology: topologyPass ? 'pass' : 'fail',
    runtimePlayback,
    stateCorrespondence: correspondence,
    // Native PLAYBACK is never claimed from bytes alone. A canary that RAN and disagreed is a
    // FAILURE, not an unknown — only `not-run` leaves the claim indeterminate. Collapsing those
    // two would let a proven-broken animation report the same verdict as an unmeasured one.
    overall: !topologyPass
      ? 'fail'
      : runtimePlayback === 'pass'
        ? 'pass'
        : runtimePlayback === 'fail'
          ? 'fail'
          : 'indeterminate-for-native-playback',
    checks,
  };
}
