import { describe, expect, it } from 'vitest';
import { deriveMotionOracle, reconcileMotionManifest } from '../lib/motion-oracle.mjs';

/**
 * Check D cross-checked the emitted OOXML against a role-state map that the COMPILER wrote, from
 * the same objects it used to name the shapes. Detector and compiler agreed by construction: a
 * compiler that decided a five-state scene had three would emit three named shapes and a manifest
 * declaring three, and D would pass. It was grading the compiler against its own homework.
 *
 * The canonical fixtures are the second, independent derivation — authored before any PowerPoint
 * compilation exists. These tests are mostly about the disagreements the oracle must surface.
 */

const CANONICAL = [
  {
    number: 21,
    artifactType: 'evidence-scrollytelling',
    artifactSpec: {
      kind: 'motion',
      payload: {
        states: [1, 2, 3, 4, 5].map((n) => ({ id: `state-${n}` })),
        transition: 'scrub',
        staticFallbackStateId: 'state-5',
      },
    },
  },
  {
    number: 25,
    artifactType: 'interaction-clip',
    artifactSpec: {
      kind: 'motion',
      payload: {
        states: [1, 2, 3].map((n) => ({ id: `state-${n}` })),
        transition: 'step',
        staticFallbackStateId: 'state-3',
      },
    },
  },
  // A non-motion fixture must not enter the oracle.
  { number: 6, artifactType: 'kpi-strip', artifactSpec: { kind: 'chart', payload: {} } },
];

const scene = (sceneId, stateCount, declaredTransition) => ({
  sceneId,
  declaredTransition,
  states: Array.from({ length: stateCount }, (_, i) => ({ stateId: `state-${i + 1}` })),
});

describe('deriving an oracle the compiler did not write', () => {
  it('reads state count, transition and fallback from the canonical fixtures only', () => {
    const oracle = deriveMotionOracle(CANONICAL);
    expect(oracle.size).toBe(2);
    expect(oracle.get('evidence-scrollytelling')).toMatchObject({
      stateCount: 5,
      declaredTransition: 'scrub',
      staticFallbackStateId: 'state-5',
      sourceFixture: 21,
    });
    expect(oracle.get('interaction-clip').stateCount).toBe(3);
  });

  it('ignores fixtures that are not motion scenes', () => {
    expect(deriveMotionOracle(CANONICAL).has('kpi-strip')).toBe(false);
  });

  it('does not invent role names — the canonical payload has none', () => {
    // Oracling roles would assert a mapping nobody wrote down, which is the check enforcing its
    // author's assumptions rather than the specification.
    expect(deriveMotionOracle(CANONICAL).get('evidence-scrollytelling')).not.toHaveProperty(
      'requiredRoles',
    );
  });

  it('survives an empty or missing fixture list', () => {
    expect(deriveMotionOracle([]).size).toBe(0);
    expect(deriveMotionOracle(undefined).size).toBe(0);
  });
});

describe('reconciliation: the disagreements that used to be invisible', () => {
  const oracle = deriveMotionOracle(CANONICAL);

  it('agrees when the compiler compiled what the fixture asked for', () => {
    const result = reconcileMotionManifest(oracle, {
      scenes: [scene('evidence-scrollytelling', 5, 'scrub'), scene('interaction-clip', 3, 'step')],
    });
    expect(result.verdict).toBe('agree');
    expect(result.problems).toEqual([]);
  });

  it('CATCHES a compiler that shrank a five-state scene to three and declared three', () => {
    // The exact self-referential failure: manifest and shapes agree with each other and both are
    // wrong. Only the canonical fixture knows better.
    const result = reconcileMotionManifest(oracle, {
      scenes: [scene('evidence-scrollytelling', 3, 'scrub'), scene('interaction-clip', 3, 'step')],
    });
    expect(result.verdict).toBe('disagree');
    expect(result.problems[0]).toMatch(/declares 3 states, the canonical fixture 5/);
  });

  it('CATCHES a transition quietly downgraded in the manifest', () => {
    const result = reconcileMotionManifest(oracle, {
      scenes: [scene('evidence-scrollytelling', 5, 'step'), scene('interaction-clip', 3, 'step')],
    });
    expect(result.problems.join(' ')).toMatch(
      /declares transition "step".*canonical fixture "scrub"/,
    );
  });

  it('CATCHES a scene the compiler invented for itself', () => {
    const result = reconcileMotionManifest(oracle, {
      scenes: [
        scene('evidence-scrollytelling', 5, 'scrub'),
        scene('interaction-clip', 3, 'step'),
        scene('easy-scene-i-made-up', 2, 'step'),
      ],
    });
    expect(result.problems.join(' ')).toMatch(/the compiler invented it/);
  });

  it('CATCHES a canonical scene the manifest silently omitted', () => {
    // Dropping a hard scene from the manifest used to remove it from the gate entirely, which
    // reads in the summary exactly like a scene that passed.
    const result = reconcileMotionManifest(oracle, {
      scenes: [scene('evidence-scrollytelling', 5, 'scrub')],
    });
    expect(result.verdict).toBe('disagree');
    expect(result.problems.join(' ')).toMatch(/unjudged, not passing/);
  });

  it('reports every disagreement, not just the first', () => {
    const result = reconcileMotionManifest(oracle, {
      scenes: [scene('evidence-scrollytelling', 2, 'step')],
    });
    expect(result.problems.length).toBeGreaterThanOrEqual(3);
    expect(result.summary).toMatch(/disagreement/);
  });

  it('treats an empty manifest as every scene unjudged', () => {
    const result = reconcileMotionManifest(oracle, { scenes: [] });
    expect(result.verdict).toBe('disagree');
    expect(result.problems).toHaveLength(2);
  });
});

/**
 * The oracle's first run against the real deck produced a false positive, and fixing it is the
 * more interesting half.
 *
 * `interaction-clip` is canonically a three-state scene, and this repo deliberately ships it as a
 * poster frame — a still is not a clip, and `still-image-labelled-demo` is that archetype's named
 * forbidden substitute. The compiler was right; it just omitted the scene silently. Refusing to
 * accept a declared fallback would have pressured the compiler into faking a motion scene to
 * satisfy the oracle, inverting what the gate exists for.
 */
describe('declared fallbacks: an answer, as opposed to silence', () => {
  const oracle = deriveMotionOracle(CANONICAL);

  it('accepts a canonical scene the compiler declared it did not compile', () => {
    const result = reconcileMotionManifest(oracle, {
      scenes: [scene('evidence-scrollytelling', 5, 'scrub')],
      declaredFallbacks: [
        {
          sceneId: 'interaction-clip',
          behavior: 'A still is not a clip; ships as an explicitly declared poster frame.',
        },
      ],
    });
    expect(result.verdict).toBe('agree');
  });

  it('still rejects silent omission — the case that reads like a pass', () => {
    const result = reconcileMotionManifest(oracle, {
      scenes: [scene('evidence-scrollytelling', 5, 'scrub')],
    });
    expect(result.verdict).toBe('disagree');
    expect(result.problems.join(' ')).toMatch(/nor declares a fallback/);
  });

  it('rejects a fallback that states no behavior — that is an omission with a label on it', () => {
    const result = reconcileMotionManifest(oracle, {
      scenes: [scene('evidence-scrollytelling', 5, 'scrub')],
      declaredFallbacks: ['interaction-clip'],
    });
    expect(result.verdict).toBe('disagree');
    expect(result.problems.join(' ')).toMatch(/says nothing about what shipped instead/);
  });
});
