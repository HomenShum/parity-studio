import { describe, expect, it } from 'vitest';
import {
  DETECTABLE_ARTIFACT_KINDS,
  artifactTypeFromTitle,
  directObservation,
  groupRecordsBySlide,
  producedArtifactKindsFromRecords,
} from '../nodeslide-atlas-topology-gate.mjs';

const textbox = () => ({ kind: 'textbox' });
const shape = () => ({ kind: 'shape' });
const image = () => ({ kind: 'image' });

describe('Observed artifact kinds come from shapes, never from a declared plan', () => {
  it('reports text only for an all-prose slide', () => {
    const observed = producedArtifactKindsFromRecords([textbox(), textbox(), textbox()]);
    expect(observed.kinds).toEqual(['text']);
    expect(observed.geometryHeuristic).toBe(false);
  });

  it('does not call one or two decorative shapes a diagram', () => {
    expect(producedArtifactKindsFromRecords([textbox(), shape()]).kinds).toEqual(['text']);
    expect(producedArtifactKindsFromRecords([textbox(), shape(), shape()]).kinds).toEqual(['text']);
  });

  it('treats three or more drawn shapes as geometry, and flags it as a heuristic', () => {
    const observed = producedArtifactKindsFromRecords([textbox(), shape(), shape(), shape()]);
    expect(observed.kinds).toContain('diagram');
    expect(observed.geometryHeuristic).toBe(true);
    expect(observed.drawnShapes).toBe(3);
  });

  it('records images as media and never infers screenshot from a picture', () => {
    const observed = producedArtifactKindsFromRecords([image()]);
    expect(observed.kinds).toEqual(['media']);
    expect(observed.kinds).not.toContain('screenshot');
  });

  it('returns nothing for an empty slide rather than defaulting to text', () => {
    expect(producedArtifactKindsFromRecords([]).kinds).toEqual([]);
  });

  it('never claims a kind this inspection cannot observe', () => {
    const everything = producedArtifactKindsFromRecords([
      textbox(),
      image(),
      shape(),
      shape(),
      shape(),
    ]);
    for (const kind of everything.kinds) {
      expect(DETECTABLE_ARTIFACT_KINDS).toContain(kind);
    }
    for (const undetectable of ['equation', 'code', 'screenshot', 'evidence', 'scrollytelling']) {
      expect(everything.kinds).not.toContain(undetectable);
    }
  });
});

describe('Slide grouping from the inspection stream', () => {
  const lines = [
    JSON.stringify({ kind: 'slide', slide: 1, title: 'SYSTEMS · SYSTEM ARCHITECTURE' }),
    JSON.stringify({ kind: 'textbox' }),
    JSON.stringify({ kind: 'shape' }),
    JSON.stringify({ kind: 'slide', slide: 2, title: 'DATA · WATERFALL' }),
    JSON.stringify({ kind: 'textbox' }),
  ];

  it('attaches each record to the slide that precedes it', () => {
    const slides = groupRecordsBySlide(lines);
    expect(slides).toHaveLength(2);
    expect(slides[0].records).toHaveLength(2);
    expect(slides[1].records).toHaveLength(1);
  });

  it('drops records that appear before any slide header', () => {
    const slides = groupRecordsBySlide([JSON.stringify({ kind: 'shape' }), ...lines]);
    expect(slides).toHaveLength(2);
    expect(slides[0].records).toHaveLength(2);
  });

  it('survives blank and malformed lines without throwing', () => {
    const slides = groupRecordsBySlide(['', '   ', 'not json', ...lines, '{oops']);
    expect(slides).toHaveLength(2);
  });

  it('returns an empty list for an empty stream', () => {
    expect(groupRecordsBySlide([])).toEqual([]);
  });

  it('orders slides numerically, not by appearance', () => {
    const shuffled = [
      JSON.stringify({ kind: 'slide', slide: 10, title: 'ten' }),
      JSON.stringify({ kind: 'slide', slide: 2, title: 'two' }),
    ];
    expect(groupRecordsBySlide(shuffled).map((entry) => entry.slide)).toEqual([2, 10]);
  });
});

describe('Artifact type recovered from a chapter-prefixed slide title', () => {
  it.each([
    ['SYSTEMS · SYSTEM ARCHITECTURE', 'system-architecture'],
    ['EVIDENCE TECHNICAL PROOF · OTEL TRACE', 'otel-trace'],
    ['DECISION EVALUATION / MODEL COMPARE', 'model-compare'],
    ['FULL-BLEED EDITORIAL IMAGE', 'full-bleed-editorial-image'],
  ])('maps %s to %s', (title, expected) => {
    expect(artifactTypeFromTitle(title)).toBe(expected);
  });

  it('returns null for titles that carry no type', () => {
    expect(artifactTypeFromTitle('')).toBeNull();
    expect(artifactTypeFromTitle('   ')).toBeNull();
    expect(artifactTypeFromTitle(undefined)).toBeNull();
    expect(artifactTypeFromTitle('···')).toBeNull();
  });
});

/**
 * The hidden semantic decoy, guarded at the WIRING level.
 *
 * scripts/tests/semantic-primacy.test.mjs proves the geometry decision is right. This proves the
 * gate acts on it — which is the half that would silently regress, because the inspector could go
 * on emitting perfect primacy verdicts that nothing reads.
 *
 * Verified end-to-end before this test existed: a deck with a genuine 1x1in chart at x=14in on a
 * 10in slide, plus 49 autoshapes drawing the visible chart, scored `1 passed, 0 violated,
 * 100% decided`. It now scores 1 violated.
 */
describe('primacy: a present-but-invisible object must not satisfy an archetype', () => {
  const artifact = (artifactKind, primacy) => ({
    kind: 'artifact',
    artifactKind,
    signal: `primacy: ${primacy}`,
    ...(primacy ? { primacy } : {}),
  });

  it('withdraws a chart the inspection measured as off-slide', () => {
    const observation = directObservation([
      artifact('chart'),
      artifact('chart', 'off-slide'),
      artifact('text'),
    ]);
    expect(observation.kinds).not.toContain('chart');
    expect(observation.withdrawnForPrimacy).toEqual(['chart']);
    // The evidence still records what was seen — withdrawal is a verdict, not an erasure.
    expect(observation.evidence.join(' ')).toMatch(/off-slide/);
  });

  it('withdraws an occluded or negligible object too', () => {
    expect(directObservation([artifact('table', 'occluded')]).kinds).not.toContain('table');
    expect(directObservation([artifact('chart', 'negligible')]).kinds).not.toContain('chart');
  });

  it('keeps a kind when at least one instance is genuinely visible', () => {
    // A real chart plus a stray off-slide one is still an honest slide.
    const observation = directObservation([
      artifact('chart', 'off-slide'),
      artifact('chart', 'visible'),
    ]);
    expect(observation.kinds).toContain('chart');
    expect(observation.withdrawnForPrimacy).toEqual([]);
  });

  it('leaves unmeasured kinds alone rather than quietly deciding them', () => {
    // No primacy field means the instrument did not look; that must not become a withdrawal.
    const observation = directObservation([artifact('equation'), artifact('diagram')]);
    expect(observation.kinds).toEqual(['diagram', 'equation']);
    expect(observation.withdrawnForPrimacy).toEqual([]);
  });

  it('withdraws on indeterminate too, because unreadable geometry cannot show primacy', () => {
    // Deliberately fail-closed, and the narrower call of the two. Elsewhere this gate refuses to
    // accuse a slide its instrument cannot see — but that rule is about kinds it never looks for.
    // Here the object IS being examined and its position will not parse, which is both rare in a
    // well-formed package and exactly what a decoy hiding behind malformed geometry would look
    // like. The evidence line still states the reason, so the withdrawal is auditable.
    const observation = directObservation([artifact('chart', 'indeterminate')]);
    expect(observation.withdrawnForPrimacy).toEqual(['chart']);
    expect(observation.kinds).not.toContain('chart');
  });
});
