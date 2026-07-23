import { describe, expect, it } from 'vitest';
import { roleOf, transitionsOf, verifyMotionScene } from '../lib/motion-gate.mjs';

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

describe('motion gate: runtime playback (H)', () => {
  it('passes only when a canary supplies one distinct capture per state', () => {
    const captures = ROLES.map((_, i) => ({ signature: `s${i}` }));
    const result = verifyMotionScene({ xml: slideXml(), expectation, runtimeCaptures: captures });
    expect(result.runtimePlayback).toBe('pass');
    expect(result.overall).toBe('pass');
  });

  it('fails when the canary captured identical frames — nothing actually advanced', () => {
    const captures = ROLES.map(() => ({ signature: 'same' }));
    const result = verifyMotionScene({ xml: slideXml(), expectation, runtimeCaptures: captures });
    expect(result.runtimePlayback).toBe('fail');
  });

  it('fails when the canary captured too few states', () => {
    const result = verifyMotionScene({
      xml: slideXml(),
      expectation,
      runtimeCaptures: [{ signature: 'a' }, { signature: 'b' }],
    });
    expect(result.runtimePlayback).toBe('fail');
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
