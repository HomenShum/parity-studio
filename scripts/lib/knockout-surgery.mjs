/**
 * Knockout surgery — the VERIFIER produces the three decks, never the producer.
 *
 * The design review's non-negotiable rule, carried over from the trace-forgery lesson: the compiler
 * must not hand the verifier a knockout deck, an isolated deck, or a "primacy passed" receipt. So
 * this module takes a producer's BASELINE pptx and, by parsing it, derives:
 *
 *   knockout  the native semantic ownership set removed   -> B
 *   isolated  ONLY the native semantic ownership set kept  -> C
 *   blank     every content shape removed                  -> baseline for the masks
 *
 * Ownership discovery is by parsing the slide, not by trusting a manifest. For a chart the owned set
 * is the graphicFrame carrying the chart relationship; for a diagram it is the connectors and the
 * shapes they bind; for a table/equation the a:tbl / m:oMath carriers. A flattened duplicate drawn
 * as autoshapes is NOT in the owned set — which is exactly why the knockout render exposes it.
 *
 * These operate on a single slide's XML. Nested <p:grpSp> is not split (the decks under test are
 * flat); a grouped deck is reported so it is never silently mis-carved.
 */

/** Top-level shape elements of the spTree, in paint order. Flat only — see module note on grpSp. */
export function topLevelShapes(slideXml) {
  const tree = /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(slideXml);
  if (!tree) return { shapes: [], hasGroups: false };
  const body = tree[1];
  const shapes = [];
  for (const match of body.matchAll(/<p:(sp|graphicFrame|cxnSp|pic|grpSp)\b[\s\S]*?<\/p:\1>/g)) {
    const xml = match[0];
    const tag = match[1];
    const id = (/<p:cNvPr[^>]*\bid="(\d+)"/.exec(xml) ?? [])[1] ?? null;
    const name = (/<p:cNvPr[^>]*\bname="([^"]*)"/.exec(xml) ?? [])[1] ?? '';
    shapes.push({
      tag,
      id,
      name,
      xml,
      isChart: tag === 'graphicFrame' && /<c:chart\b|graphicframe.*chart/i.test(xml),
      isTable: tag === 'graphicFrame' && /<a:tbl\b/.test(xml),
      isEquation: /<m:oMath\b/.test(xml),
      isConnector: tag === 'cxnSp',
      isPicture: tag === 'pic',
      isText: tag === 'sp',
    });
  }
  return { shapes, hasGroups: /<p:grpSp\b/.test(body) };
}

/**
 * The native semantic ownership set for a target artifact kind: the shape ids the native object
 * owns. Deliberately narrow — a shape-drawn duplicate of a chart is `sp`, never in the chart set.
 */
export function ownershipSet(shapes, artifactKind) {
  const owns = (predicate) =>
    shapes
      .filter(predicate)
      .map((s) => s.id)
      .filter(Boolean);
  switch (artifactKind) {
    case 'chart':
    case 'timeline':
      return owns((s) => s.isChart);
    case 'table':
      return owns((s) => s.isTable);
    case 'equation':
      return owns((s) => s.isEquation);
    case 'diagram': {
      // Connectors plus every shape a connector binds (its stCxn/endCxn targets).
      const connectorIds = new Set(shapes.filter((s) => s.isConnector).map((s) => s.id));
      const bound = new Set();
      for (const s of shapes) {
        if (!s.isConnector) continue;
        for (const m of s.xml.matchAll(/<a:(?:st|end)Cxn\s+id="(\d+)"/g)) bound.add(m[1]);
      }
      return shapes
        .filter((s) => connectorIds.has(s.id) || bound.has(s.id))
        .map((s) => s.id)
        .filter(Boolean);
    }
    default:
      return [];
  }
}

/** Rebuild spTree keeping only the shapes whose id passes `keep`. Background/props are preserved. */
function rewriteTree(slideXml, keep) {
  const { shapes } = topLevelShapes(slideXml);
  const removals = shapes.filter((s) => !keep(s));
  let out = slideXml;
  for (const shape of removals) out = out.replace(shape.xml, '');
  return out;
}

/** B — the native semantic ownership set removed; everything else (incl. any duplicate) stays. */
export function knockoutSlide(slideXml, ownedIds) {
  const owned = new Set(ownedIds);
  return rewriteTree(slideXml, (shape) => !owned.has(shape.id));
}

/** C — ONLY the native semantic ownership set kept. */
export function isolatedSlide(slideXml, ownedIds) {
  const owned = new Set(ownedIds);
  return rewriteTree(slideXml, (shape) => owned.has(shape.id));
}

/** The blank baseline: every content shape removed, so the masks measure against an empty slide. */
export function blankSlide(slideXml) {
  return rewriteTree(slideXml, () => false);
}
