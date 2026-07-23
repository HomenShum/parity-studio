import { describe, expect, it } from 'vitest';
import {
  artifactIsEmpty,
  contentDigest,
  evaluateDistinctness,
  placeholderSignals,
} from '../lib/artifact-distinctness.mjs';

/**
 * The scenario these are written against is the one that actually happened.
 *
 * A reviewer opens the Atlas deck expecting 38 distinct archetypes, because every per-slide gate
 * reported 38/38. What they find is roughly a dozen distinct artifacts and a lot of repetition:
 * three chart archetypes with the same two bars, four diagram archetypes with the same two boxes,
 * five slides whose whole body is their own title. Every case below is taken from that deck, and
 * the negative cases exist so the gate cannot buy its sensitivity by flagging honest work.
 */

const chart = (name, values, categories = ['A', 'B']) => ({
  series: [{ name, values, categories }],
});

/** The exact payload that shipped on slides 6, 7 and 12. */
const PLACEHOLDER_CHART = chart('series-1', [62, 86]);

describe('collapse: the taxonomy is a claim about the set, not about any slide', () => {
  it('catches three archetypes shipping one chart — the case every per-slide gate passed', () => {
    const result = evaluateDistinctness([
      { slide: 6, archetypeId: 'data.kpi-strip', kind: 'chart', content: PLACEHOLDER_CHART },
      { slide: 7, archetypeId: 'data.multi-series', kind: 'chart', content: PLACEHOLDER_CHART },
      { slide: 12, archetypeId: 'data.funnel', kind: 'chart', content: PLACEHOLDER_CHART },
    ]);
    expect(result.verdict).toBe('fail');
    const collapse = result.findings.find((f) => f.check === 'collapse');
    expect(collapse.slides).toEqual([6, 7, 12]);
    expect(collapse.detail).toMatch(/data\.kpi-strip.*data\.multi-series.*data\.funnel/);
    expect(result.distinctArtifacts).toBe(1);
  });

  it('catches four diagram archetypes sharing the same two-box stub', () => {
    const stub = { nodes: ['Output', 'Source A'], edges: [['Source A', 'Output']] };
    const result = evaluateDistinctness(
      [
        'systems.architecture',
        'systems.sequence',
        'systems.hierarchy',
        'evidence.claim-lineage',
      ].map((archetypeId, i) => ({ slide: 13 + i, archetypeId, kind: 'diagram', content: stub })),
    );
    expect(result.findings.filter((f) => f.check === 'collapse')).toHaveLength(1);
    expect(result.findings.find((f) => f.check === 'collapse').slides).toEqual([13, 14, 15, 16]);
  });

  it('does NOT flag the same archetype used twice — repetition is legitimate, collapse is not', () => {
    const result = evaluateDistinctness([
      {
        slide: 4,
        archetypeId: 'data.trend-line',
        kind: 'chart',
        content: chart('Latency', [3, 4]),
      },
      {
        slide: 9,
        archetypeId: 'data.trend-line',
        kind: 'chart',
        content: chart('Latency', [3, 4]),
      },
    ]);
    expect(result.findings.filter((f) => f.check === 'collapse')).toHaveLength(0);
  });

  it('does NOT collapse two charts that differ only in their values', () => {
    const routes = ['kimi', 'sonnet'];
    const result = evaluateDistinctness([
      { slide: 1, archetypeId: 'data.a', kind: 'chart', content: chart('Cost', [1, 2], routes) },
      { slide: 2, archetypeId: 'data.b', kind: 'chart', content: chart('Cost', [1, 3], routes) },
    ]);
    expect(result.verdict).toBe('pass');
  });

  it('treats 62 and 62.0 as the same value, so a float artefact cannot fake distinctness', () => {
    expect(contentDigest('chart', chart('s', [62, 86]))).toBe(
      contentDigest('chart', chart('s', [62.0, 86.0])),
    );
  });

  it('digests by content, not key order — the same chart declared differently is still the same', () => {
    const a = { series: [{ name: 's', values: [1], categories: ['x'] }] };
    const b = { series: [{ categories: ['x'], values: [1], name: 's' }] };
    expect(contentDigest('chart', a)).toBe(contentDigest('chart', b));
  });

  it('ignores empty artifacts when collapsing, so blankness reports as blank not as duplication', () => {
    const empty = { series: [{ name: 'x', values: [], categories: [] }] };
    const result = evaluateDistinctness([
      { slide: 1, archetypeId: 'a', kind: 'chart', content: empty },
      { slide: 2, archetypeId: 'b', kind: 'chart', content: empty },
    ]);
    expect(result.findings.filter((f) => f.check === 'collapse')).toHaveLength(0);
    expect(result.findings.filter((f) => f.check === 'degenerate')).toHaveLength(2);
  });
});

describe('placeholder: the fixture stub must not survive into a slide that claims a subject', () => {
  it('flags the "series-1" naming convention no author writes on purpose', () => {
    expect(placeholderSignals('chart', PLACEHOLDER_CHART).join(' ')).toMatch(/fixture stub/);
  });

  it('flags bare single-character categories', () => {
    expect(placeholderSignals('chart', chart('Revenue', [1, 2], ['A', 'B'])).join(' ')).toMatch(
      /single characters/,
    );
  });

  it('does NOT flag a real one-series chart with real category names', () => {
    expect(
      placeholderSignals('chart', chart('p95 latency', [812, 940], ['Kimi', 'Sonnet'])),
    ).toEqual([]);
  });

  it('does NOT flag a chart whose series is merely unnamed', () => {
    // An empty name is a different defect; borrowing this signal for it would make both unfixable.
    expect(placeholderSignals('chart', chart('', [1, 2], ['Kimi', 'Sonnet']))).toEqual([]);
  });

  it('flags generic node labels but not a diagram that names real components', () => {
    expect(
      placeholderSignals('diagram', { nodes: ['Source A', 'Output'], edges: [] }).join(' '),
    ).toMatch(/generic stub/);
    expect(
      placeholderSignals('diagram', { nodes: ['Convex', 'OpenRouter', 'Deck CI'], edges: [] }),
    ).toEqual([]);
  });

  it('flags a diagram only when EVERY node is a stub, so one generic name is not enough', () => {
    expect(
      placeholderSignals('diagram', { nodes: ['Source A', 'Convex', 'Deck CI'], edges: [] }),
    ).toEqual([]);
  });

  it('flags the raw float that shipped in the comparison matrix', () => {
    const rows = [
      ['route', 'quality', 'cost'],
      ['kimi-k3', '0.9583333333333334', '0.001303'],
    ];
    expect(placeholderSignals('table', { rows }).join(' ')).toMatch(/raw float precision/);
  });

  it('does NOT flag a table that presents rounded numbers', () => {
    const rows = [
      ['route', 'quality', 'cost'],
      ['kimi-k3', '0.958', '$0.0013'],
    ];
    expect(placeholderSignals('table', { rows })).toEqual([]);
  });
});

describe('degenerate: a slide that says one thing twice, or shows an empty shell', () => {
  it('catches the body that restates the title, ignoring case and punctuation', () => {
    const result = evaluateDistinctness([
      {
        slide: 1,
        archetypeId: 'narrative.thesis',
        kind: 'text',
        content: null,
        title: 'Reviewability turns generation into a product decision',
        body: 'Reviewability turns generation into a product decision.',
      },
    ]);
    expect(result.findings[0].check).toBe('degenerate');
    expect(result.findings[0].detail).toMatch(/appears twice/);
  });

  it('does NOT flag a body that develops the title instead of repeating it', () => {
    const result = evaluateDistinctness([
      {
        slide: 1,
        archetypeId: 'narrative.thesis',
        kind: 'text',
        content: null,
        title: 'Reviewability turns generation into a product decision',
        body: 'Every artifact carries the path back to the source that justified it.',
      },
    ]);
    expect(result.verdict).toBe('pass');
  });

  /**
   * The emitter marks no title placeholder — the eyebrow is simply the first shape — so any rule
   * that guesses which body is the title misses all five real cases. The gate takes every body and
   * looks for a repeated sentence instead.
   */
  it('catches the real deck shape: eyebrow, title, page number, title again', () => {
    const result = evaluateDistinctness([
      {
        slide: 1,
        archetypeId: 'narrative.hero-thesis',
        kind: 'text',
        textBodies: [
          'NARRATIVE.HERO-THESIS',
          'Reviewability turns generation into a product decision',
          '1',
          'Reviewability turns generation into a product decision',
        ],
      },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].detail).toMatch(/appears twice/);
  });

  it('stays silent on the same shape when the title appears only once', () => {
    const result = evaluateDistinctness([
      {
        slide: 36,
        archetypeId: 'systems.comparison-matrix',
        kind: 'text',
        textBodies: [
          'SYSTEMS.COMPARISON-MATRIX',
          'Different models fail differently under the same contract',
          '36',
        ],
      },
    ]);
    expect(result.verdict).toBe('pass');
  });

  it('does not count the title as its own duplicate when both fields are supplied', () => {
    // The first cut of this gate passed `title` alongside `textBodies` and flagged 18 of 38 slides.
    const result = evaluateDistinctness([
      {
        slide: 21,
        archetypeId: 'progression.scrollytelling',
        kind: 'text',
        title: 'PROGRESSION.SCROLLYTELLING',
        textBodies: ['PROGRESSION.SCROLLYTELLING', 'Evidence becomes a decision in five states'],
      },
    ]);
    expect(result.verdict).toBe('pass');
  });

  it('ignores short repeats — a page number or a twice-used axis label is not the defect', () => {
    const result = evaluateDistinctness([
      { slide: 9, archetypeId: 'data.waterfall', kind: 'text', textBodies: ['Cost', '9', 'Cost'] },
    ]);
    expect(result.verdict).toBe('pass');
  });

  it('catches an equation shape that declares an equation and holds nothing', () => {
    const result = evaluateDistinctness([
      { slide: 32, archetypeId: 'technical.equation', kind: 'equation', content: { text: '' } },
    ]);
    expect(result.findings[0].detail).toMatch(/carries no content/);
  });

  it('knows emptiness per kind', () => {
    expect(artifactIsEmpty('table', { rows: [[' ', '']] })).toBe(true);
    expect(artifactIsEmpty('table', { rows: [['route', 'cost']] })).toBe(false);
    expect(artifactIsEmpty('timeline', { serials: [] })).toBe(true);
    expect(artifactIsEmpty('timeline', { serials: [46_030] })).toBe(false);
  });
});

describe('at deck scale: the gate has to stay quiet on an honest deck and loud on the real one', () => {
  /** 38 archetypes, each with genuinely its own content — the deck we are trying to reach. */
  const honestDeck = Array.from({ length: 38 }, (_, i) => ({
    slide: i + 1,
    archetypeId: `family.archetype-${i}`,
    kind: 'chart',
    content: chart(`metric ${i}`, [i + 1, i * 2 + 3], [`route-${i}`, `route-${i + 100}`]),
    title: `Finding ${i}`,
    body: `What slide ${i} actually argues, at some length.`,
  }));

  it('passes 38 genuinely distinct slides with no findings at all', () => {
    const result = evaluateDistinctness(honestDeck);
    expect(result.verdict).toBe('pass');
    expect(result.distinctArtifacts).toBe(38);
    expect(result.findings).toEqual([]);
  });

  it('fails the moment two of those 38 are silently made identical', () => {
    const sabotaged = honestDeck.map((entry, i) =>
      i === 20 ? { ...entry, content: honestDeck[5].content } : entry,
    );
    const result = evaluateDistinctness(sabotaged);
    expect(result.verdict).toBe('fail');
    expect(result.distinctArtifacts).toBe(37);
    expect(result.findings.find((f) => f.check === 'collapse').slides).toEqual([6, 21]);
  });

  it('reports every defect on a deck carrying all three at once, not just the first', () => {
    const result = evaluateDistinctness([
      ...honestDeck.slice(0, 5),
      { slide: 6, archetypeId: 'data.kpi-strip', kind: 'chart', content: PLACEHOLDER_CHART },
      { slide: 7, archetypeId: 'data.multi-series', kind: 'chart', content: PLACEHOLDER_CHART },
      { slide: 32, archetypeId: 'technical.equation', kind: 'equation', content: { text: '' } },
      {
        slide: 38,
        archetypeId: 'narrative.close',
        kind: 'text',
        content: null,
        title: 'Reuse the visual vocabulary, then adapt the communication contract',
        body: 'Reuse the visual vocabulary, then adapt the communication contract',
      },
    ]);
    const kinds = new Set(result.findings.map((f) => f.check));
    expect(kinds).toEqual(new Set(['collapse', 'placeholder', 'degenerate']));
    expect(result.summary).toMatch(/1 collapse, 4 placeholder, 2 degenerate/);
  });

  it('an empty deck is a pass, not a crash — no slides means nothing to contradict', () => {
    expect(evaluateDistinctness([]).verdict).toBe('pass');
  });
});
