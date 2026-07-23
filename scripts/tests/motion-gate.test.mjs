import { describe, expect, it } from 'vitest';
import { ancestorGroupsOf, roleOf, transitionsOf, verifyMotionScene } from '../lib/motion-gate.mjs';

/**
 * These are adversarial by design. A gate that only proves the happy path is a gate that can be
 * gamed, and the whole point of the motion checks is that "there is animation on the slide" must
 * not be enough to claim a scene.
 */

const SCENE = 'evidence-story';
const ROLES = ['source', 'capture', 'fact', 'claim', 'slide-element'];

const expectation = {
  sceneId: SCENE,
  declaredTransition: 'scrub',
  pinnedObject: `ns:motion:${SCENE}:pinned:scene`,
  requiredRoles: ROLES,
  states: ROLES.map((role, i) => ({
    stateId: `state-${i + 1}`,
    object: `ns:motion:${SCENE}:state-${i + 1}:${role}`,
    visibleRoles: ROLES.slice(0, i + 1),
    hiddenRoles: ROLES.slice(i + 1),
  })),
};

/** Build a slide whose shapes and timing tree can each be perturbed independently. */
// Shape ids: 1 = pinned, 2..6 = state-1..state-5, 90 = title.
// State 1 (id 2) is visible at slide entry, so the four transitions reveal states 2..5 = ids 3..6.
function slideXml({
  transitionTargets = [3, 4, 5, 6],
  behavior = true,
  extraShapes = [],
  omitTiming = false,
} = {}) {
  const shapes = [
    `<p:cNvPr id="1" name="${expectation.pinnedObject}"/>`,
    ...ROLES.map(
      (role, i) => `<p:cNvPr id="${i + 2}" name="ns:motion:${SCENE}:state-${i + 1}:${role}"/>`,
    ),
    `<p:cNvPr id="90" name="Title 1"/>`,
    ...extraShapes,
  ].join('');

  const steps = transitionTargets
    .map((spid, i) => {
      const inner = behavior
        ? `<p:set><p:cBhvr><p:cTn id="${50 + i}" dur="1"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:set>`
        : `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;
      return `<p:par><p:cTn id="${10 + i}" fill="hold" nodeType="clickEffect">${inner}</p:cTn></p:par>`;
    })
    .join('');

  const timing = omitTiming
    ? ''
    : `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>${steps}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;

  return `<p:sld><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld>${timing}</p:sld>`;
}

const run = (opts) => verifyMotionScene({ xml: slideXml(opts), expectation });

describe('motion gate: a well-formed scene', () => {
  it('passes A-G and leaves playback honestly unproven', () => {
    const result = run();
    for (const key of [
      'A_timingTopology',
      'B_realBehaviors',
      'C_resolvedTargets',
      'D_semanticStateMapping',
      'E_distinctStateSignatures',
      'F_semanticProgression',
      'G_pinnedVisual',
    ]) {
      expect(result.checks[key].pass, key).toBe(true);
    }
    expect(result.topology).toBe('pass');
    // Bytes prove the animation exists; they do not prove PowerPoint plays it.
    expect(result.runtimePlayback).toBe('not-run');
    expect(result.overall).toBe('indeterminate-for-native-playback');
  });
});

describe('motion gate: adversarial cases it must catch', () => {
  it('A — rejects N transitions for N states (the first state is visible at entry)', () => {
    const result = run({ transitionTargets: [2, 3, 4, 5, 6] }); // 5 transitions for 5 states
    expect(result.checks.A_timingTopology.pass).toBe(false);
    expect(result.topology).toBe('fail');
  });

  it('A — rejects a slide with no timing tree at all', () => {
    expect(run({ omitTiming: true }).checks.A_timingTopology.pass).toBe(false);
  });

  it('B — rejects a bare p:cTn with no animation behavior', () => {
    const result = run({ behavior: false });
    expect(result.checks.B_realBehaviors.pass).toBe(false);
  });

  it('C — rejects orphan target ids that resolve to no shape', () => {
    const result = run({ transitionTargets: [3, 4, 5, 999] });
    expect(result.checks.C_resolvedTargets.pass).toBe(false);
    expect(result.checks.C_resolvedTargets.detail).toMatch(/999/);
  });

  it('E/F — rejects a build that only animates the title', () => {
    const result = run({ transitionTargets: [90, 90, 90, 90] });
    // Four clicks, real behaviours, resolved targets — and still not a scene.
    expect(result.checks.C_resolvedTargets.pass).toBe(true);
    expect(result.checks.F_semanticProgression.pass).toBe(false);
    expect(result.checks.E_distinctStateSignatures.pass).toBe(false);
  });

  it('E — rejects re-revealing the same role to fake distinct states', () => {
    const result = run({ transitionTargets: [3, 3, 3, 3] });
    expect(result.checks.E_distinctStateSignatures.pass).toBe(false);
  });

  it('G — rejects a pinned object that gets animated away', () => {
    const result = run({ transitionTargets: [1, 4, 5, 6] });
    expect(result.checks.G_pinnedVisual.pass).toBe(false);
    expect(result.checks.G_pinnedVisual.detail).toMatch(/does not persist/);
  });

  it('G — rejects a scene with no pinned object', () => {
    const xml = slideXml().replace(`name="${expectation.pinnedObject}"`, 'name="Rectangle 9"');
    const result = verifyMotionScene({ xml, expectation });
    expect(result.checks.G_pinnedVisual.pass).toBe(false);
  });
});

/**
 * A staircase: region s sits at its baseline until frame s, then rises and stays up. This is what
 * a real build sequence measures like, taken from an actual PowerPoint capture.
 */
function staircaseCaptures({
  baselines = [0.03, 0.027, 0.005, 0.007, 0.014],
  revealFactor = 3,
} = {}) {
  return baselines.map((_, frame) => ({
    signature: `frame-${frame}`,
    regions: baselines.map((base, state) => ({
      stateIndex: state,
      ink: state <= frame ? Number((base * revealFactor + 0.02).toFixed(4)) : base,
    })),
  }));
}

describe('motion gate: runtime playback (H) — state correspondence', () => {
  it('passes when each state appears on exactly its own frame and stays', () => {
    const result = verifyMotionScene({
      xml: slideXml(),
      expectation,
      runtimeCaptures: staircaseCaptures(),
    });
    expect(result.runtimePlayback).toBe('pass');
    expect(result.overall).toBe('pass');
  });

  // The exact gaming example from the design review: one small element changing four times
  // produces five distinct frames while showing none of the intended states.
  it('FAILS five distinct frames where only one dot keeps changing', () => {
    const captures = [0, 1, 2, 3, 4].map((frame) => ({
      signature: `distinct-${frame}`,
      regions: [0.03, 0.027, 0.005, 0.007, 0.014].map((base, state) => ({
        stateIndex: state,
        // Only region 0 varies; states 2..5 never appear.
        ink: state === 0 ? base + frame * 0.05 : base,
      })),
    }));
    const result = verifyMotionScene({ xml: slideXml(), expectation, runtimeCaptures: captures });
    expect(result.runtimePlayback).toBe('fail');
    expect(result.stateCorrespondence.problems.join(' ')).toMatch(/did not appear/);
  });

  it('FAILS when a state is on screen before its turn', () => {
    const captures = staircaseCaptures();
    // State 4 reveals at frame 4; make it visible at frame 2. Frame 0 is the baseline, so the
    // perturbation has to land on a later pre-reveal frame to be a genuine early appearance.
    captures[1].regions[3].ink = 0.4;
    const result = verifyMotionScene({ xml: slideXml(), expectation, runtimeCaptures: captures });
    expect(result.runtimePlayback).toBe('fail');
    expect(result.stateCorrespondence.problems.join(' ')).toMatch(/before its turn/);
  });

  it('FAILS when a revealed state disappears again', () => {
    const captures = staircaseCaptures();
    captures[4].regions[1].ink = 0.001; // state 2 vanishes by the last frame
    const result = verifyMotionScene({ xml: slideXml(), expectation, runtimeCaptures: captures });
    expect(result.runtimePlayback).toBe('fail');
    expect(result.stateCorrespondence.problems.join(' ')).toMatch(/disappeared/);
  });

  it('FAILS when frames carry no region measurements — distinctness alone is not proof', () => {
    const captures = ROLES.map((_, i) => ({ signature: `s${i}` }));
    const result = verifyMotionScene({ xml: slideXml(), expectation, runtimeCaptures: captures });
    expect(result.runtimePlayback).toBe('fail');
    expect(result.stateCorrespondence.measured).toBe(false);
  });

  it('FAILS identical frames — nothing actually advanced', () => {
    const captures = staircaseCaptures().map((c) => ({ ...c, signature: 'same' }));
    expect(
      verifyMotionScene({ xml: slideXml(), expectation, runtimeCaptures: captures })
        .runtimePlayback,
    ).toBe('fail');
  });

  it('a canary that RAN and disagreed is a failure, not an unknown', () => {
    const captures = staircaseCaptures();
    captures[0].regions[3].ink = 0.4;
    const result = verifyMotionScene({ xml: slideXml(), expectation, runtimeCaptures: captures });
    expect(result.overall).toBe('fail');
    expect(result.overall).not.toBe('indeterminate-for-native-playback');
  });
});

describe('motion gate: helpers', () => {
  it('parses the stable object naming scheme', () => {
    expect(roleOf('ns:motion:evidence-story:state-2:claim')).toEqual({
      slot: 'state-2',
      role: 'claim',
    });
    expect(roleOf('ns:motion:evidence-story:pinned:scene')).toEqual({
      slot: 'pinned',
      role: 'scene',
    });
    expect(roleOf('Rectangle 4')).toBeNull();
  });

  it('counts one transition per user-advance boundary', () => {
    expect(transitionsOf(slideXml())).toHaveLength(4);
  });
});

/**
 * Gaming routes 4 and 6 from the design review, plus G's missing visibility half.
 *
 * All three share a shape: the scene satisfies every existing check and still does not stage the
 * narrative it claims. Distinct signatures and a clean progression cannot see any of them.
 */
describe('motion gate: staging the scene, not just touching the roles', () => {
  it('I — FAILS one click doing two states’ work (gaming route 6)', () => {
    // Four advances over five states whose canonical boundaries each add ONE role; the first click
    // reveals three roles at once, so it crosses more boundary than its state declares.
    const xml = slideXml({ transitionTargets: [3, 4, 5, 6] }).replace(
      '<p:spTgt spid="4"/>',
      '<p:spTgt spid="4"/><p:spTgt spid="5"/><p:spTgt spid="6"/>',
    );
    const result = verifyMotionScene({ xml, expectation });
    expect(result.checks.I_stateBoundary.pass).toBe(false);
    expect(result.checks.I_stateBoundary.detail).toMatch(/canonical state boundary adds/);
  });

  it('I — passes the staircase where each boundary adds exactly one role', () => {
    expect(run().checks.I_stateBoundary.pass).toBe(true);
  });

  /**
   * The correction the design review forced: the rule is one canonical state BOUNDARY per advance,
   * not one role. A legitimate compound state — a fact card and the connector that binds it revealed
   * together — must pass. The earlier one-role-per-advance rule rejected exactly this, which would
   * have pressured the compiler to split a coherent reveal into half-steps to satisfy the inspector.
   * This is the honest-work positive fixture the gate was missing.
   */
  it('I — passes a legitimate compound reveal where one state adds two roles', () => {
    // A three-state scene: state 2 reveals BOTH `capture` and `fact` as one boundary.
    const compoundRoles = ['source', 'capture', 'fact'];
    const compound = {
      sceneId: SCENE,
      declaredTransition: 'scrub',
      pinnedObject: expectation.pinnedObject,
      requiredRoles: compoundRoles,
      states: [
        {
          stateId: 'state-1',
          object: `ns:motion:${SCENE}:state-1:source`,
          visibleRoles: ['source'],
        },
        {
          stateId: 'state-2',
          object: `ns:motion:${SCENE}:state-2:capture`,
          // One boundary, two roles.
          visibleRoles: ['source', 'capture', 'fact'],
        },
      ],
    };
    // Shapes: 1 pinned, 2 source, 3 capture, 4 fact. One advance reveals 3 and 4 together.
    const xml = `<p:sld><p:cSld><p:spTree>${[
      `<p:cNvPr id="1" name="${expectation.pinnedObject}"/>`,
      `<p:cNvPr id="2" name="ns:motion:${SCENE}:state-1:source"/>`,
      `<p:cNvPr id="3" name="ns:motion:${SCENE}:state-2:capture"/>`,
      `<p:cNvPr id="4" name="ns:motion:${SCENE}:state-2:fact"/>`,
      '<p:cNvPr id="90" name="Title 1"/>',
    ].join(
      '',
    )}</p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="10" fill="hold" nodeType="clickEffect"><p:set><p:cBhvr><p:cTn id="50" dur="1"/><p:tgtEl><p:spTgt spid="3"/></p:tgtEl></p:cBhvr></p:set><p:set><p:cBhvr><p:cTn id="51" dur="1"/><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cBhvr></p:set></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`;
    const result = verifyMotionScene({ xml, expectation: compound });
    expect(result.checks.I_stateBoundary.pass, result.checks.I_stateBoundary.detail).toBe(true);
  });

  it('I — reports honestly when the expectation carries no visibleRoles', () => {
    const noSets = {
      ...expectation,
      states: expectation.states.map(({ visibleRoles, ...rest }) => rest),
    };
    const result = verifyMotionScene({ xml: slideXml(), expectation: noSets });
    expect(result.checks.I_stateBoundary.pass).toBe(false);
    expect(result.checks.I_stateBoundary.detail).toMatch(/no per-state visibleRoles/);
  });

  it('J — FAILS the canonical roles played out of order (gaming route 4)', () => {
    // source -> slide-element -> fact -> capture -> claim. Five distinct signatures, wrong scene.
    const result = run({ transitionTargets: [6, 4, 3, 5] });
    expect(result.checks.J_declaredOrder.pass).toBe(false);
    expect(result.checks.J_declaredOrder.detail).toMatch(/declared .* but revealed /);
  });

  it('J — passes the declared causal order', () => {
    const result = run();
    expect(result.checks.J_declaredOrder.pass).toBe(true);
    expect(result.checks.J_declaredOrder.detail).toMatch(/capture -> fact -> claim/);
  });

  it('G — FAILS a pinned object that survives every state off-slide', () => {
    // Survival was the whole of G. A pinned visual parked outside the canvas satisfied it while
    // the audience saw no pinned visual at all.
    const xml = slideXml().replace(
      `<p:cNvPr id="1" name="${expectation.pinnedObject}"/>`,
      `<p:sp><p:cNvPr id="1" name="${expectation.pinnedObject}"/><a:off x="12801600" y="8229600"/><a:ext cx="914400" cy="914400"/></p:sp>`,
    );
    const result = verifyMotionScene({
      xml,
      expectation,
      slideSize: { cx: 9_144_000, cy: 5_143_500 },
    });
    expect(result.checks.G_pinnedVisual.pass).toBe(false);
    expect(result.checks.G_pinnedVisual.detail).toMatch(/survives every state but is not visible/);
  });

  it('G — passes a pinned object that is genuinely on show', () => {
    const xml = slideXml().replace(
      `<p:cNvPr id="1" name="${expectation.pinnedObject}"/>`,
      `<p:sp><p:cNvPr id="1" name="${expectation.pinnedObject}"/><a:off x="457200" y="1371600"/><a:ext cx="4572000" cy="2743200"/></p:sp>`,
    );
    const result = verifyMotionScene({
      xml,
      expectation,
      slideSize: { cx: 9_144_000, cy: 5_143_500 },
    });
    expect(result.checks.G_pinnedVisual.pass).toBe(true);
  });

  it('G — says plainly when no geometry was supplied, rather than implying it checked', () => {
    expect(run().checks.G_pinnedVisual.detail).toMatch(/visibility is unchecked/);
  });
});

/**
 * Gaming route 7. The shipped deck uses no shape groups at all, so this is not exploitable today —
 * it is one compiler change away, and a check that only exists after the exploit is worth less.
 */
describe('motion gate: K — an ancestor group can hide a role that behaved perfectly', () => {
  /** Wrap the state shapes in a group, and optionally animate the group itself. */
  function groupedSlide({ animateGroup }) {
    const inner = ROLES.map(
      (role, i) =>
        `<p:sp><p:cNvPr id="${i + 2}" name="ns:motion:${SCENE}:state-${i + 1}:${role}"/></p:sp>`,
    ).join('');
    const shapes = `<p:sp><p:cNvPr id="1" name="${expectation.pinnedObject}"/></p:sp><p:grpSp><p:cNvPr id="70" name="stage-group"/>${inner}</p:grpSp><p:sp><p:cNvPr id="90" name="Title 1"/></p:sp>`;
    const targets = animateGroup ? [3, 4, 5, 70] : [3, 4, 5, 6];
    const steps = targets
      .map(
        (spid, i) =>
          `<p:par><p:cTn id="${10 + i}" fill="hold" nodeType="clickEffect"><p:set><p:cBhvr><p:cTn id="${50 + i}" dur="1"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:set></p:cTn></p:par>`,
      )
      .join('');
    return `<p:sld><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>${steps}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`;
  }

  it('resolves ancestor groups, outermost first, without tripping on nesting', () => {
    const nested =
      '<p:grpSp><p:cNvPr id="10"/><p:grpSp><p:cNvPr id="20"/><p:sp><p:cNvPr id="30"/></p:sp></p:grpSp></p:grpSp>';
    expect(ancestorGroupsOf(nested).get('30')).toEqual(['10', '20']);
  });

  it('reports no ancestors for a shape at the top level', () => {
    expect(ancestorGroupsOf('<p:sp><p:cNvPr id="5"/></p:sp>').get('5')).toEqual([]);
  });

  it('FAILS when a required role sits inside an animated group', () => {
    const result = verifyMotionScene({ xml: groupedSlide({ animateGroup: true }), expectation });
    expect(result.checks.K_noAnimatedAncestor.pass).toBe(false);
    expect(result.checks.K_noAnimatedAncestor.detail).toMatch(/regardless of their own state/);
  });

  it('passes when the group exists but is never animated', () => {
    const result = verifyMotionScene({ xml: groupedSlide({ animateGroup: false }), expectation });
    expect(result.checks.K_noAnimatedAncestor.pass).toBe(true);
  });

  it('passes the ungrouped deck this repo actually ships', () => {
    expect(run().checks.K_noAnimatedAncestor.pass).toBe(true);
  });
});
