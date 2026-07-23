/**
 * Semantic fidelity — does the emitted artifact carry the CONTENT its spec asked for?
 *
 * Every other gate in this repo answers "is an artifact of the right kind present?". None of them
 * answers "does it hold the right values?". A chart part with the wrong series passes the topology
 * gate perfectly. That is existence checked and correspondence assumed, and it is the same error
 * that let a step-build be called a scrub and let five distinct frames be called five states.
 *
 * So this extracts the artifact's content back OUT of the OOXML and diffs it against the
 * `artifactSpec` payload that produced it. Extraction is deliberately independent of the compiler:
 * it reads the emitted bytes, not the builder's in-memory objects, so a compiler that silently
 * drops a value is caught rather than confirmed.
 *
 * Kinds it cannot yet decide are reported `not-checked` — never as a pass.
 */

/** Values inside one <c:ser>. Reads the emitted chart part, not the builder's input. */
export function extractChartContent(chartXml) {
  const series = [];
  for (const match of chartXml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) ?? []) {
    const valBlock = (match.match(/<c:val>[\s\S]*?<\/c:val>/) ?? [''])[0];
    const catBlock = (match.match(/<c:cat>[\s\S]*?<\/c:cat>/) ?? [''])[0];
    const txBlock = (match.match(/<c:tx>[\s\S]*?<\/c:tx>/) ?? [''])[0];
    series.push({
      name: (txBlock.match(/<c:v>([^<]*)<\/c:v>/) ?? [null, ''])[1],
      values: [...valBlock.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((m) => Number(m[1])),
      categories: [...catBlock.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((m) => m[1]),
    });
  }
  return { series };
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Rows of cell text from the first <a:tbl> on the slide. */
export function extractTableContent(slideXml) {
  const table = (slideXml.match(/<a:tbl\b[\s\S]*?<\/a:tbl>/) ?? [''])[0];
  const rows = [];
  for (const tr of table.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) ?? []) {
    const cells = [];
    for (const tc of tr.match(/<a:tc\b[\s\S]*?<\/a:tc>/g) ?? []) {
      cells.push(
        [...tc.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
          .map((m) => decodeXml(m[1]))
          .join('')
          .trim(),
      );
    }
    rows.push(cells);
  }
  return { rows };
}

/**
 * Node ids and the edges actually BOUND between them. Edges come from the connector's
 * stCxn/endCxn shape ids resolved back to node names — not from the connector's own label, which
 * could say anything.
 */
export function extractDiagramContent(slideXml) {
  const nameById = new Map();
  for (const m of slideXml.matchAll(/<p:cNvPr id="(\d+)" name="node-([^"]+)"/g)) {
    nameById.set(m[1], m[2]);
  }
  const edges = [];
  for (const block of slideXml.match(/<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g) ?? []) {
    const from = (block.match(/<a:stCxn id="(\d+)"/) ?? [])[1];
    const to = (block.match(/<a:endCxn id="(\d+)"/) ?? [])[1];
    if (nameById.has(from) && nameById.has(to)) edges.push([nameById.get(from), nameById.get(to)]);
  }
  return { nodes: [...nameById.values()].sort(), edges };
}

/** Date serials on a real time axis. */
export function extractTimelineContent(chartXml) {
  if (!/<c:dateAx>/.test(chartXml)) return { serials: [] };
  const cat = (chartXml.match(/<c:cat>[\s\S]*?<\/c:cat>/) ?? [''])[0];
  return { serials: [...cat.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((m) => Number(m[1])) };
}

const EPOCH = Date.UTC(2026, 0, 1);
const serialOf = (offset, unit) => {
  const perUnit = unit === 'week' ? 7 : unit === 'month' ? 30 : 1;
  return Math.round(
    (EPOCH + Number(offset) * perUnit * 86_400_000 - Date.UTC(1899, 11, 30)) / 86_400_000,
  );
};

/**
 * What the artifactSpec payload says the artifact must contain. Kept independent of the compiler's
 * own transforms so the two can actually disagree.
 */
export function expectedContent(fixture) {
  const spec = fixture.artifactSpec ?? {};
  const p = spec.payload ?? {};
  switch (spec.kind) {
    case 'chart':
      return {
        kind: 'chart',
        values: (p.series ?? []).map((s) => (s.values ?? []).map(Number)),
      };
    case 'waterfall':
      return {
        kind: 'chart',
        values: [
          [
            Number(p.baseline ?? 0),
            ...(p.deltas ?? []).map((d) => Number(d.value ?? 0)),
            Number(p.final ?? 0),
          ],
        ],
      };
    case 'timeline':
      return {
        kind: 'timeline',
        serials: (p.events ?? []).map((e) => serialOf(e.start ?? 0, p.unit ?? 'day')),
      };
    case 'gantt':
      return {
        kind: 'timeline',
        serials: (p.tasks ?? []).map((t) => serialOf(t.start ?? 0, p.unit ?? 'day')),
      };
    case 'graph':
    case 'causal-loop':
      return {
        kind: 'diagram',
        nodes: (p.nodes ?? []).map((n) => n.id).sort(),
        edges: (p.edges ?? []).map((e) => [e.from, e.to]),
      };
    case 'sankey': {
      const seen = new Set();
      const edges = [];
      for (const l of p.links ?? []) {
        const key = `${l.source}->${l.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([l.source, l.target]);
      }
      return { kind: 'diagram', nodes: (p.nodes ?? []).map((n) => n.id).sort(), edges };
    }
    default:
      return { kind: 'not-checked' };
  }
}

const sameNumbers = (a, b) =>
  a.length === b.length && a.every((v, i) => Math.abs(Number(v) - Number(b[i])) < 1e-9);

/**
 * Diff expected against observed. Returns explicit mismatches — a fidelity failure must say WHICH
 * value drifted, otherwise it is no more useful than the existence check it replaces.
 */
export function compareFidelity(expected, observed) {
  const mismatches = [];
  if (expected.kind === 'not-checked') {
    return {
      verdict: 'not-checked',
      mismatches,
      detail: 'no fidelity extractor for this artifact kind',
    };
  }

  if (expected.kind === 'chart') {
    // An archetype may legitimately route chart-shaped data into a table (data.table demands a
    // lookup grid, not a plot). Fidelity is about the VALUES surviving the routing, not about which
    // native object won — so when a table was emitted instead, require the numbers to be present
    // in its cells. Losing a value is a failure either way.
    if ((observed.series ?? []).length === 0 && (observed.rows ?? []).length > 0) {
      const cells = new Set(observed.rows.flat().map((c) => String(c).trim()));
      for (const [i, want] of expected.values.entries()) {
        const missing = want.filter((v) => !cells.has(String(v)));
        if (missing.length > 0) {
          mismatches.push(
            `series ${i} values missing from the emitted table: [${missing.join(', ')}]`,
          );
        }
      }
      return {
        verdict: mismatches.length === 0 ? 'pass' : 'fail',
        mismatches,
        detail:
          mismatches.length === 0
            ? 'chart-shaped payload routed to a table by its archetype; every value survives'
            : `${mismatches.length} value(s) lost in routing`,
      };
    }

    const got = (observed.series ?? []).map((s) => s.values);
    if (got.length !== expected.values.length) {
      mismatches.push(`series count: expected ${expected.values.length}, emitted ${got.length}`);
    }
    expected.values.forEach((want, i) => {
      const have = got[i] ?? [];
      if (!sameNumbers(want, have)) {
        mismatches.push(
          `series ${i} values: expected [${want.join(', ')}], emitted [${have.join(', ')}]`,
        );
      }
    });
  }

  if (expected.kind === 'timeline') {
    const have = observed.serials ?? [];
    if (!sameNumbers(expected.serials, have)) {
      mismatches.push(
        `date serials: expected [${expected.serials.join(', ')}], emitted [${have.join(', ')}]`,
      );
    }
  }

  if (expected.kind === 'diagram') {
    const haveNodes = observed.nodes ?? [];
    const missing = expected.nodes.filter((n) => !haveNodes.includes(n));
    if (missing.length > 0) mismatches.push(`nodes absent from the slide: ${missing.join(', ')}`);

    const key = ([f, t]) => `${f}->${t}`;
    const haveEdges = new Set((observed.edges ?? []).map(key));
    const missingEdges = expected.edges.filter((e) => !haveEdges.has(key(e)));
    if (missingEdges.length > 0) {
      mismatches.push(`edges not bound between real shapes: ${missingEdges.map(key).join(', ')}`);
    }
  }

  return {
    verdict: mismatches.length === 0 ? 'pass' : 'fail',
    mismatches,
    detail:
      mismatches.length === 0
        ? `${expected.kind} content matches the spec`
        : `${mismatches.length} content mismatch(es)`,
  };
}

/**
 * Mutation probe: perturb the expectation and require the comparator to NOTICE. A fidelity check
 * that cannot fail is not a check — this is what proves the gate has teeth rather than asserting it.
 */
export function mutationProbe(expected, observed) {
  const mutated = structuredClone(expected);
  if (mutated.kind === 'chart' && mutated.values[0]?.length) {
    mutated.values[0] = [...mutated.values[0]];
    mutated.values[0][0] = Number(mutated.values[0][0]) + 41;
  } else if (mutated.kind === 'timeline' && mutated.serials.length) {
    mutated.serials = [...mutated.serials];
    mutated.serials[0] += 41;
  } else if (mutated.kind === 'diagram' && mutated.nodes.length) {
    mutated.nodes = [...mutated.nodes, 'ghost-node-that-does-not-exist'];
  } else {
    return { ran: false, caught: false, detail: 'no probe available for this kind' };
  }
  const result = compareFidelity(mutated, observed);
  return {
    ran: true,
    caught: result.verdict === 'fail',
    detail:
      result.verdict === 'fail' ? 'perturbed spec was rejected' : 'PERTURBED SPEC STILL PASSED',
  };
}
