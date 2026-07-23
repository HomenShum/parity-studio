/**
 * Deck-level distinctness — is the taxonomy real at the pixel level?
 *
 * Every other gate here judges ONE slide: is a native chart present, do its values match its spec,
 * did the animation play. All of them passed a deck in which three archetypes named KPI-STRIP,
 * MULTI-SERIES and FUNNEL emitted the byte-identical two-bar "series-1" placeholder, and four
 * archetypes named ARCHITECTURE, SEQUENCE, HIERARCHY and CLAIM-LINEAGE emitted the same two-box
 * "source -> output" stub.
 *
 * That is not a bug in any of those gates. Distinctness is a property of the SET, and nothing was
 * looking at the set. A coverage counter that reports 38 present artifacts reads exactly the same
 * whether the deck holds 38 distinct artifacts or three distinct ones repeated. So this gate takes
 * the whole deck at once and asks the three questions a human asks in the first five seconds:
 *
 *   COLLAPSE     two different archetypes emitted the same content
 *   PLACEHOLDER  the content is the fixture stub, not the thing the title claims
 *   DEGENERATE   the slide restates its own title, or carries an artifact with nothing in it
 *
 * Every finding names the slides involved, because "distinctness failed" is unactionable and
 * "slides 6, 7 and 12 are the same chart" is a fix.
 */

/** Stable, sorted-key digest of artifact CONTENT — geometry and ids deliberately excluded. */
export function contentDigest(kind, content) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
          acc[key] = canonical(value[key]);
          return acc;
        }, {});
    }
    // Numbers are normalised so 62 and 62.0 collapse; a float artefact must not read as distinct.
    return typeof value === 'number' ? Number(value.toPrecision(12)) : value;
  };
  return `${kind}:${JSON.stringify(canonical(content ?? null))}`;
}

const PLACEHOLDER_SERIES = /^series[-_ ]?\d*$/i;
const PLACEHOLDER_NODE =
  /^(source|sink|output|input|node|step|item|thing|foo|bar|baz)\s*[a-z0-9]?$/i;
const PLACEHOLDER_CELL = /^(col|column|row|cell|value|field)\s*[a-z0-9]?$/i;

/**
 * Reasons this content looks like the fixture stub rather than the slide's subject.
 *
 * Deliberately conservative: each signal is a naming convention no author writes on purpose, so a
 * real one-series chart or a genuinely short table is never flagged just for being small.
 */
export function placeholderSignals(kind, content) {
  const reasons = [];
  if (!content) return reasons;

  if (kind === 'chart' || kind === 'timeline') {
    const series = content.series ?? [];
    const named = series.filter((s) => PLACEHOLDER_SERIES.test(String(s.name ?? '').trim()));
    if (named.length > 0 && named.length === series.length) {
      reasons.push(
        `every series is named like a fixture stub (${named.map((s) => s.name).join(', ')})`,
      );
    }
    const categories = series.flatMap((s) => s.categories ?? []);
    if (
      categories.length > 0 &&
      categories.every((c) => String(c).trim().length === 1 && /[a-z0-9]/i.test(String(c).trim()))
    ) {
      reasons.push(
        `categories are bare single characters (${[...new Set(categories)].join(', ')})`,
      );
    }
  }

  if (kind === 'diagram') {
    const nodes = content.nodes ?? [];
    const stubs = nodes.filter((n) => PLACEHOLDER_NODE.test(String(n).trim()));
    if (stubs.length > 0 && stubs.length === nodes.length) {
      reasons.push(`every node is a generic stub label (${stubs.join(' -> ')})`);
    }
  }

  if (kind === 'table') {
    const rows = content.rows ?? [];
    const cells = rows.flat().filter((c) => String(c).trim().length > 0);
    const stubs = cells.filter(
      (c) => PLACEHOLDER_CELL.test(String(c).trim()) || PLACEHOLDER_SERIES.test(String(c).trim()),
    );
    if (cells.length > 0 && stubs.length / cells.length > 0.5) {
      reasons.push(`over half the cells are stub labels (${stubs.slice(0, 4).join(', ')})`);
    }
    // A presented table must not leak the raw float. This is the number a reader sees, not storage.
    const leaks = cells.filter((c) => /^-?\d+\.\d{7,}$/.test(String(c).trim()));
    if (leaks.length > 0) {
      reasons.push(`raw float precision is presented verbatim (${leaks.slice(0, 3).join(', ')})`);
    }
  }

  return reasons;
}

/** Does the artifact carry anything at all? An empty shell passes a presence check but shows nothing. */
export function artifactIsEmpty(kind, content) {
  if (!content) return true;
  if (kind === 'chart') return (content.series ?? []).every((s) => (s.values ?? []).length === 0);
  if (kind === 'timeline') return (content.serials ?? []).length === 0;
  if (kind === 'table') return (content.rows ?? []).flat().join('').trim().length === 0;
  if (kind === 'diagram') return (content.nodes ?? []).length === 0;
  if (kind === 'equation') return String(content.text ?? '').trim().length === 0;
  return false;
}

const normalise = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The first sentence that appears twice among a slide's text bodies.
 *
 * Short strings are ignored: a page number, an eyebrow and a repeated axis label are not the
 * defect. The defect is a whole sentence printed twice, which is what a reader sees as an empty
 * slide with its own headline in the middle of it.
 */
const MIN_REPEAT_LENGTH = 24;
function repeatedSentence(values) {
  const seen = new Set();
  for (const value of values) {
    const key = normalise(value);
    if (key.length < MIN_REPEAT_LENGTH) continue;
    if (seen.has(key)) return String(value).trim();
    seen.add(key);
  }
  return null;
}

/**
 * Judge a whole deck.
 *
 * `slides` entries: { slide, archetypeId, kind, content, title, body }.
 * Returns a verdict plus one finding per real defect, each naming its slides.
 */
export function evaluateDistinctness(slides) {
  const findings = [];

  // COLLAPSE — the same content under two different archetype names. Repeating an archetype is
  // legitimate; claiming two taxonomy entries and shipping one artifact is not.
  const byDigest = new Map();
  for (const entry of slides) {
    if (artifactIsEmpty(entry.kind, entry.content)) continue;
    const digest = contentDigest(entry.kind, entry.content);
    if (!byDigest.has(digest)) byDigest.set(digest, []);
    byDigest.get(digest).push(entry);
  }
  for (const [digest, group] of byDigest) {
    const archetypes = [...new Set(group.map((e) => e.archetypeId))];
    if (archetypes.length < 2) continue;
    findings.push({
      check: 'collapse',
      slides: group.map((e) => e.slide),
      detail: `${archetypes.length} archetypes emit identical ${group[0].kind} content: ${archetypes.join(', ')} (slides ${group.map((e) => e.slide).join(', ')})`,
      digest,
    });
  }

  for (const entry of slides) {
    // PLACEHOLDER — the fixture stub survived into a slide that claims a subject.
    for (const reason of placeholderSignals(entry.kind, entry.content)) {
      findings.push({
        check: 'placeholder',
        slides: [entry.slide],
        detail: `slide ${entry.slide} (${entry.archetypeId}): ${reason}`,
      });
    }

    // DEGENERATE — an artifact with nothing in it, or a body that only restates the title.
    if (entry.kind && entry.kind !== 'text' && artifactIsEmpty(entry.kind, entry.content)) {
      findings.push({
        check: 'degenerate',
        slides: [entry.slide],
        detail: `slide ${entry.slide} (${entry.archetypeId}): declares a ${entry.kind} that carries no content`,
      });
    }
    // A slide that says one thing twice. Detected as "two text bodies carry the same sentence"
    // rather than "the body equals the title": the emitter marks no placeholder, so any rule that
    // has to guess which shape IS the title misses the real cases. Two identical sentences on one
    // slide is the defect regardless of which one was meant to be the heading.
    // `textBodies` is the complete set when supplied; mixing it with `title`/`body` would count the
    // title as its own duplicate and flag every slide on the deck.
    const repeated = repeatedSentence(entry.textBodies ?? [entry.title, entry.body]);
    if (repeated) {
      findings.push({
        check: 'degenerate',
        slides: [entry.slide],
        detail: `slide ${entry.slide} (${entry.archetypeId}): "${repeated.slice(0, 60)}" appears twice, so the slide says one thing twice`,
      });
    }
  }

  const counted = (check) => findings.filter((f) => f.check === check).length;
  return {
    verdict: findings.length === 0 ? 'pass' : 'fail',
    slidesChecked: slides.length,
    distinctArtifacts: byDigest.size,
    findings,
    summary: `${slides.length} slides, ${byDigest.size} distinct artifacts — ${counted('collapse')} collapse, ${counted('placeholder')} placeholder, ${counted('degenerate')} degenerate`,
  };
}
