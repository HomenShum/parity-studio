/**
 * Visible semantic primacy — is the native object the one the audience is actually looking at?
 *
 * Every gate in this repo so far answers "does the file contain the required artifact". A reviewer
 * asks a harder question: "how do I know the native chart your gate found is the chart I can see?"
 * Until now the honest answer was "because the file contains a chart", and that is not enough.
 *
 * The attack, confirmed against the real gate before this module existed: put a genuine 1x1 inch
 * chart part at x=14in on a 10in slide, draw the visible chart with 49 autoshapes, and the topology
 * gate reports `1 passed, 0 violated, 100% decided`. The chart is real, the c:ser are real, and the
 * user still edits a flattened drawing. The same attack works for a hidden a:tbl, a hidden OMML
 * equation, invisible connectors and an evidence hyperlink on an invisible run.
 *
 * So presence and primacy are separate claims, checked separately:
 *
 *   ON-SLIDE     the object's box intersects the slide at all
 *   SUBSTANTIAL  it occupies enough of the slide to be the artifact rather than a token
 *   UNOCCLUDED   no later opaque shape covers it — later in spTree paints on top
 *
 * Anything this cannot measure is reported `indeterminate`, never `visible`. A decoy that hides in
 * a gap in the instrument must not be scored as passing by that instrument.
 */

/** EMU per inch. OOXML positions are integers in these units. */
export const EMU_PER_INCH = 914_400;

/**
 * Minimum share of the slide a semantic object must cover to be treated as the primary artifact.
 *
 * 1.5% is deliberately permissive — a legitimate sparkline or inline equation is small, and this
 * check exists to catch a 1x1 decoy parked off-canvas, not to impose a layout opinion. The
 * off-slide test does most of the work; this only closes the "technically on-slide, one pixel"
 * variant.
 */
export const MIN_AREA_FRACTION = 0.015;

/** Parse `<a:off x= y=/><a:ext cx= cy=/>` out of one shape's XML. Returns null when absent. */
export function parseFrame(xml) {
  const off = /<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>/.exec(xml ?? '');
  const ext = /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/.exec(xml ?? '');
  if (!off || !ext) return null;
  return {
    x: Number(off[1]),
    y: Number(off[2]),
    cx: Number(ext[1]),
    cy: Number(ext[2]),
  };
}

const right = (f) => f.x + f.cx;
const bottom = (f) => f.y + f.cy;

/** Area of the intersection of two boxes, in EMU². Zero when they do not overlap. */
export function intersectionArea(a, b) {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Does `cover` completely contain `target`? Full occlusion, not partial overlap. */
export function fullyCovers(cover, target) {
  return (
    cover.x <= target.x &&
    cover.y <= target.y &&
    right(cover) >= right(target) &&
    bottom(cover) >= bottom(target)
  );
}

/**
 * Decide primacy for one semantic object.
 *
 * `frame`   — the object's box, or null if geometry could not be read
 * `slide`   — { cx, cy } slide dimensions in EMU
 * `covers`  — boxes of shapes painted AFTER this object, each { frame, opaque }
 */
export function decidePrimacy({ frame, slide, covers = [] }) {
  if (!frame || !slide?.cx || !slide?.cy) {
    return {
      verdict: 'indeterminate',
      reason:
        'geometry could not be read, so visibility is unknown — reported rather than assumed.',
    };
  }

  const slideBox = { x: 0, y: 0, cx: slide.cx, cy: slide.cy };
  const onSlide = intersectionArea(frame, slideBox);
  if (onSlide === 0) {
    const inches = (v) => (v / EMU_PER_INCH).toFixed(2);
    return {
      verdict: 'off-slide',
      reason: `the object sits entirely outside the slide at (${inches(frame.x)}in, ${inches(frame.y)}in) — present in the file, invisible to the audience.`,
      visibleFraction: 0,
    };
  }

  const fraction = onSlide / (slide.cx * slide.cy);
  if (fraction < MIN_AREA_FRACTION) {
    return {
      verdict: 'negligible',
      reason: `only ${(fraction * 100).toFixed(3)}% of the slide is covered by this object, below the ${(MIN_AREA_FRACTION * 100).toFixed(1)}% needed to be the artifact rather than a token of one.`,
      visibleFraction: fraction,
    };
  }

  // Later in the shape tree paints on top. A single opaque shape that fully contains this one
  // hides it completely, which is the "native object behind the visual fallback" route.
  const blocker = covers.find((cover) => cover.opaque && fullyCovers(cover.frame, frame));
  if (blocker) {
    return {
      verdict: 'occluded',
      reason: `fully covered by a later opaque shape${blocker.name ? ` (${blocker.name})` : ''} — on-slide but not visible.`,
      visibleFraction: fraction,
    };
  }

  return {
    verdict: 'visible',
    reason: `occupies ${(fraction * 100).toFixed(1)}% of the slide and nothing opaque covers it.`,
    visibleFraction: fraction,
  };
}

/** Verdicts that let a presence claim stand as a primacy claim. */
export function isPrimary(verdict) {
  return verdict === 'visible';
}

/**
 * Judge every declared semantic object on a slide.
 * `objects`: [{ id, artifactKind, frame }]; `paintOrder`: shapes in spTree order.
 */
export function evaluateSlidePrimacy({ objects, slide, paintOrder = [] }) {
  const findings = objects.map((object) => {
    // Only shapes painted after this object can hide it.
    const index = paintOrder.findIndex((entry) => entry.id === object.id);
    const covers = index === -1 ? [] : paintOrder.slice(index + 1);
    return { ...object, ...decidePrimacy({ frame: object.frame, slide, covers }) };
  });
  const hidden = findings.filter((f) => !isPrimary(f.verdict));
  return {
    findings,
    verdict: hidden.length === 0 ? 'pass' : 'fail',
    hiddenCount: hidden.length,
  };
}
