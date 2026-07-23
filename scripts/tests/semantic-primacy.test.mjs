import { describe, expect, it } from 'vitest';
import {
  EMU_PER_INCH,
  decidePrimacy,
  evaluateSlidePrimacy,
  fullyCovers,
  intersectionArea,
  isPrimary,
  parseFrame,
} from '../lib/semantic-primacy.mjs';

/**
 * These are written against a confirmed exploit, not a hypothetical.
 *
 * Before this module existed, a deck containing a genuine 1x1 inch chart parked at x=14in on a
 * 10in slide — with the visible "chart" drawn as 49 autoshapes — scored `1 passed, 0 violated,
 * 100% decided` from the topology gate. The chart part was real. The c:ser were real. The audience
 * saw a flattened drawing and would have edited a flattened drawing.
 *
 * Presence was never the claim. Primacy is.
 */

const inch = (n) => Math.round(n * EMU_PER_INCH);
const SLIDE = { cx: inch(10), cy: inch(5.63) };
const box = (x, y, w, h) => ({ x: inch(x), y: inch(y), cx: inch(w), cy: inch(h) });

describe('the hidden semantic decoy: the attack this exists to stop', () => {
  it('rejects the exact fixture that beat the topology gate — 1x1 chart at x=14in', () => {
    const decision = decidePrimacy({ frame: box(14, 9, 1, 1), slide: SLIDE });
    expect(decision.verdict).toBe('off-slide');
    expect(isPrimary(decision.verdict)).toBe(false);
    expect(decision.reason).toMatch(/invisible to the audience/);
  });

  it('accepts the same chart once it is actually on the slide', () => {
    const decision = decidePrimacy({ frame: box(0.5, 1.6, 9, 3.6), slide: SLIDE });
    expect(decision.verdict).toBe('visible');
    expect(isPrimary(decision.verdict)).toBe(true);
  });

  it('rejects a token-sized object that is technically on-slide', () => {
    // The "one pixel inside the edge" variant of the same trick.
    const decision = decidePrimacy({ frame: box(9.9, 5.5, 0.08, 0.08), slide: SLIDE });
    expect(decision.verdict).toBe('negligible');
    expect(decision.reason).toMatch(/token of one/);
  });

  it('rejects an object hanging mostly off the edge with a sliver showing', () => {
    const decision = decidePrimacy({ frame: box(9.95, 2, 4, 3), slide: SLIDE });
    expect(decision.verdict).toBe('negligible');
  });
});

describe('native object behind the visual fallback', () => {
  it('rejects a full-size chart covered by a later opaque group', () => {
    const decision = decidePrimacy({
      frame: box(0.5, 1.6, 9, 3.6),
      slide: SLIDE,
      covers: [{ frame: box(0, 1, 10, 4.5), opaque: true, name: 'fake-bars' }],
    });
    expect(decision.verdict).toBe('occluded');
    expect(decision.reason).toMatch(/fake-bars/);
  });

  it('rejects a chart 90% covered by a later opaque shape — the case full-occlusion missed', () => {
    // The exact design-review case: not fully covered, so the old fullyCovers rule passed it. The
    // remaining 10% is still a large share of the slide, so a slide-relative area check passes it
    // too. Only measuring occlusion against the OBJECT catches it.
    const chart = box(0.5, 1.6, 9, 3.6);
    const decision = decidePrimacy({
      frame: chart,
      slide: SLIDE,
      covers: [{ frame: box(0.5, 1.6, 9, 3.24), opaque: true, name: 'fake-bars' }], // 90% of the chart height
    });
    expect(decision.verdict).toBe('occluded');
    expect(decision.reason).toMatch(/fake-bars/);
    expect(decision.reason).toMatch(/unoccluded/);
  });

  it('does NOT double-count two overlapping occluders into more-than-full coverage', () => {
    // Two overlapping shades each covering ~60% must union to <100%, leaving the chart visible.
    const chart = box(0.5, 1.6, 9, 3.6);
    const decision = decidePrimacy({
      frame: chart,
      slide: SLIDE,
      covers: [
        { frame: box(0.5, 1.6, 3, 3.6), opaque: true, name: 'left' },
        { frame: box(2.5, 1.6, 3, 3.6), opaque: true, name: 'mid' },
      ],
    });
    // ~6 of 9 inches wide covered by the union -> ~33% visible -> below MIN_SELF_VISIBLE, occluded.
    expect(decision.verdict).toBe('occluded');
    // but the union must be ~6in, not 6in counted as >9in; sanity: some area remains accounted.
    expect(decision.visibleFraction).toBeGreaterThan(0);
  });

  it('does NOT reject when the covering shape is transparent', () => {
    const decision = decidePrimacy({
      frame: box(0.5, 1.6, 9, 3.6),
      slide: SLIDE,
      covers: [{ frame: box(0, 1, 10, 4.5), opaque: false, name: 'annotation-layer' }],
    });
    expect(decision.verdict).toBe('visible');
  });

  it('does NOT reject partial overlap — a caption over a corner is normal design', () => {
    const decision = decidePrimacy({
      frame: box(0.5, 1.6, 9, 3.6),
      slide: SLIDE,
      covers: [{ frame: box(6, 4, 3, 1), opaque: true, name: 'caption' }],
    });
    expect(decision.verdict).toBe('visible');
  });

  it('ignores an opaque shape painted BEFORE the object — it cannot hide what comes after it', () => {
    const result = evaluateSlidePrimacy({
      slide: SLIDE,
      objects: [{ id: '9', artifactKind: 'chart', frame: box(0.5, 1.6, 9, 3.6) }],
      paintOrder: [
        { id: '2', frame: box(0, 0, 10, 5.63), opaque: true, name: 'background' },
        { id: '9', frame: box(0.5, 1.6, 9, 3.6), opaque: false },
      ],
    });
    expect(result.verdict).toBe('pass');
  });
});

describe('measurement honesty', () => {
  it('reports indeterminate when geometry cannot be read, never visible', () => {
    const decision = decidePrimacy({ frame: null, slide: SLIDE });
    expect(decision.verdict).toBe('indeterminate');
    expect(isPrimary(decision.verdict)).toBe(false);
  });

  it('reports indeterminate when the slide size is unknown', () => {
    expect(decidePrimacy({ frame: box(1, 1, 4, 3), slide: {} }).verdict).toBe('indeterminate');
  });

  it('parses a real OOXML transform and rejects malformed ones', () => {
    expect(
      parseFrame(
        '<a:xfrm><a:off x="457200" y="1463040"/><a:ext cx="8229600" cy="3291840"/></a:xfrm>',
      ),
    ).toEqual({ x: 457_200, y: 1_463_040, cx: 8_229_600, cy: 3_291_840 });
    expect(parseFrame('<a:xfrm><a:ext cx="100" cy="100"/></a:xfrm>')).toBeNull();
    expect(parseFrame('')).toBeNull();
  });

  it('reads negative offsets, which is how off-canvas to the left is expressed', () => {
    const frame = parseFrame('<a:off x="-9144000" y="0"/><a:ext cx="914400" cy="914400"/>');
    expect(frame.x).toBe(-9_144_000);
    expect(decidePrimacy({ frame, slide: SLIDE }).verdict).toBe('off-slide');
  });
});

describe('geometry primitives', () => {
  it('computes intersection area and returns zero for disjoint boxes', () => {
    expect(intersectionArea(box(0, 0, 2, 2), box(1, 1, 2, 2))).toBe(inch(1) * inch(1));
    expect(intersectionArea(box(0, 0, 1, 1), box(5, 5, 1, 1))).toBe(0);
  });

  it('distinguishes full containment from mere overlap', () => {
    expect(fullyCovers(box(0, 0, 10, 6), box(1, 1, 2, 2))).toBe(true);
    expect(fullyCovers(box(0, 0, 2, 2), box(1, 1, 4, 4))).toBe(false);
  });
});

describe('a whole slide', () => {
  it('fails the slide and names every hidden object', () => {
    const result = evaluateSlidePrimacy({
      slide: SLIDE,
      objects: [
        { id: '4', artifactKind: 'chart', frame: box(14, 9, 1, 1) },
        { id: '5', artifactKind: 'table', frame: box(1, 1, 6, 3) },
      ],
      paintOrder: [],
    });
    expect(result.verdict).toBe('fail');
    expect(result.hiddenCount).toBe(1);
    expect(result.findings.find((f) => f.id === '4').verdict).toBe('off-slide');
    expect(result.findings.find((f) => f.id === '5').verdict).toBe('visible');
  });

  it('passes a slide whose semantic objects are all genuinely on show', () => {
    const result = evaluateSlidePrimacy({
      slide: SLIDE,
      objects: [{ id: '4', artifactKind: 'chart', frame: box(0.5, 1.6, 9, 3.6) }],
      paintOrder: [],
    });
    expect(result.verdict).toBe('pass');
    expect(result.hiddenCount).toBe(0);
  });
});
