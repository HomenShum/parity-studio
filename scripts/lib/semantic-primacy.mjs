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
 * At least this fraction of the object's own on-slide area must remain unoccluded. A chart 90%
 * covered by a later opaque shape is not the primary artifact even though its remaining 10% can
 * still be a large share of the slide — the design review's exact case. Measuring occlusion against
 * the OBJECT, not the slide, is what catches it.
 */
export const MIN_SELF_VISIBLE = 0.5;

const right2 = (f) => f.x + f.cx;
const bottom2 = (f) => f.y + f.cy;

/**
 * Exact union area of a set of rectangles, by coordinate compression. Overlapping occluders must
 * not be double-counted, or a chart covered by two overlapping shapes would read as more-than-fully
 * hidden. Exact rather than approximate because a primacy verdict turns on it.
 */
export function unionArea(rects) {
  if (rects.length === 0) return 0;
  const xs = [...new Set(rects.flatMap((r) => [r.x, right2(r)]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, bottom2(r)]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < ys.length - 1; j += 1) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (rects.some((r) => cx >= r.x && cx < right2(r) && cy >= r.y && cy < bottom2(r))) {
        area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      }
    }
  }
  return area;
}

/** Intersect two boxes, or null when they do not overlap. */
function intersectBox(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(right2(a), right2(b));
  const bo = Math.min(bottom2(a), bottom2(b));
  return r > x && bo > y ? { x, y, cx: r - x, cy: bo - y } : null;
}

/**
 * Decide primacy for one semantic object — Stage 0 of the causal-primacy gate.
 *
 * This is the REGION admission check: is the native object plausibly where the artifact lives, and
 * enough of it actually on show? It is necessary, not sufficient — it cannot prove the object is
 * what the audience SEES (a flattened duplicate underneath passes geometry). That is the knockout
 * render's job. Here the only question is effective visible area AFTER occlusion.
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
  const onSlideBox = intersectBox(frame, slideBox);
  if (!onSlideBox) {
    const inches = (v) => (v / EMU_PER_INCH).toFixed(2);
    return {
      verdict: 'off-slide',
      reason: `the object sits entirely outside the slide at (${inches(frame.x)}in, ${inches(frame.y)}in) — present in the file, invisible to the audience.`,
      visibleFraction: 0,
    };
  }

  const onSlideArea = onSlideBox.cx * onSlideBox.cy;
  // Occlusion measured as the UNION of every later opaque shape clipped to the object's on-slide
  // box — not "is it fully covered", which a 90%-cover defeats.
  const clippedCovers = covers
    .filter((cover) => cover.opaque && cover.frame)
    .map((cover) => ({ name: cover.name, box: intersectBox(cover.frame, onSlideBox) }))
    .filter((cover) => cover.box);
  const occludedArea = unionArea(clippedCovers.map((cover) => cover.box));
  const effectiveVisible = Math.max(0, onSlideArea - occludedArea);
  const effectiveSlideFraction = effectiveVisible / (slide.cx * slide.cy);
  const selfVisible = onSlideArea > 0 ? effectiveVisible / onSlideArea : 0;

  if (effectiveVisible <= 0 || selfVisible < MIN_SELF_VISIBLE) {
    // Name the largest occluder, so a failure points at the shape doing the hiding.
    const dominant = clippedCovers
      .slice()
      .sort((a, b) => b.box.cx * b.box.cy - a.box.cx * a.box.cy)[0];
    return {
      verdict: 'occluded',
      reason: `only ${(selfVisible * 100).toFixed(1)}% of the object is unoccluded${dominant?.name ? ` — a later opaque shape (${dominant.name}) covers the rest` : ' — later opaque shapes cover the rest'}, so it is not the artifact the audience sees.`,
      visibleFraction: effectiveSlideFraction,
    };
  }
  if (effectiveSlideFraction < MIN_AREA_FRACTION) {
    return {
      verdict: 'negligible',
      reason: `its effective visible area is ${(effectiveSlideFraction * 100).toFixed(3)}% of the slide, below the ${(MIN_AREA_FRACTION * 100).toFixed(1)}% needed to be the artifact rather than a token of one.`,
      visibleFraction: effectiveSlideFraction,
    };
  }
  return {
    verdict: 'visible',
    reason: `${(selfVisible * 100).toFixed(0)}% unoccluded and occupying ${(effectiveSlideFraction * 100).toFixed(1)}% of the slide.`,
    visibleFraction: effectiveSlideFraction,
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
