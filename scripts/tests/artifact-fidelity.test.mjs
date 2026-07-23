import { describe, expect, it } from 'vitest';
import {
  compareFidelity,
  expectedContent,
  extractChartContent,
  extractDiagramContent,
  extractTableContent,
  extractTimelineContent,
  mutationProbe,
} from '../lib/artifact-fidelity.mjs';

/**
 * The point of a fidelity gate is that it can FAIL. Existence checks pass on an artifact of the
 * right kind holding the wrong values — these tests exist to prove this one does not.
 */

const chartXml = `<c:chartSpace><c:ser><c:tx><c:v>cost</c:v></c:tx>
  <c:cat><c:v>A</c:v><c:v>B</c:v></c:cat>
  <c:val><c:v>62</c:v><c:v>86</c:v></c:val></c:ser></c:chartSpace>`;

const chartFixture = {
  artifactSpec: {
    kind: 'chart',
    payload: { xAxis: { labels: ['A', 'B'] }, series: [{ id: 's1', values: [62, 86] }] },
  },
};

describe('fidelity: extraction reads the emitted bytes', () => {
  it('pulls series values and categories out of a chart part', () => {
    const out = extractChartContent(chartXml);
    expect(out.series).toHaveLength(1);
    expect(out.series[0].values).toEqual([62, 86]);
    expect(out.series[0].categories).toEqual(['A', 'B']);
  });

  it('pulls rows out of a table', () => {
    const xml =
      '<a:tbl><a:tr><a:tc><a:t>Status</a:t></a:tc><a:tc><a:t>6</a:t></a:tc></a:tr></a:tbl>';
    expect(extractTableContent(xml).rows).toEqual([['Status', '6']]);
  });

  it('resolves diagram edges through real shape ids, not connector labels', () => {
    const xml =
      '<p:cNvPr id="5" name="node-source"/><p:cNvPr id="7" name="node-claim"/>' +
      '<p:cxnSp><p:cNvPr id="9" name="edge-LYING-LABEL"/><a:stCxn id="5"/><a:endCxn id="7"/></p:cxnSp>';
    const out = extractDiagramContent(xml);
    expect(out.nodes).toEqual(['claim', 'source']);
    // The label says something else entirely; the binding is what counts.
    expect(out.edges).toEqual([['source', 'claim']]);
  });

  it('reads date serials only from a real time axis', () => {
    expect(extractTimelineContent('<c:catAx/><c:cat><c:v>46024</c:v></c:cat>').serials).toEqual([]);
    expect(
      extractTimelineContent('<c:dateAx></c:dateAx><c:cat><c:v>46024</c:v></c:cat>').serials,
    ).toEqual([46024]);
  });
});

describe('fidelity: the comparator catches drift', () => {
  it('passes when the emitted values match the spec', () => {
    const result = compareFidelity(expectedContent(chartFixture), extractChartContent(chartXml));
    expect(result.verdict).toBe('pass');
  });

  it('FAILS when one value drifted — the case an existence check cannot see', () => {
    const wrong = chartXml.replace('<c:v>86</c:v>', '<c:v>99</c:v>');
    const result = compareFidelity(expectedContent(chartFixture), extractChartContent(wrong));
    expect(result.verdict).toBe('fail');
    expect(result.mismatches[0]).toMatch(/expected \[62, 86\], emitted \[62, 99\]/);
  });

  it('FAILS when a series is missing entirely', () => {
    const result = compareFidelity(expectedContent(chartFixture), { series: [] });
    expect(result.verdict).toBe('fail');
  });

  it('accepts an archetype routing chart data into a table, but only if every value survives', () => {
    const routed = {
      series: [],
      rows: [
        ['Series', 'A', 'B'],
        ['s1', '62', '86'],
      ],
    };
    expect(compareFidelity(expectedContent(chartFixture), routed).verdict).toBe('pass');

    const lossy = {
      series: [],
      rows: [
        ['Series', 'A', 'B'],
        ['s1', '62'],
      ],
    };
    const result = compareFidelity(expectedContent(chartFixture), lossy);
    expect(result.verdict).toBe('fail');
    expect(result.mismatches[0]).toMatch(/86/);
  });

  it('FAILS when a declared edge is not actually bound between shapes', () => {
    const fixture = {
      artifactSpec: {
        kind: 'graph',
        payload: { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }] },
      },
    };
    const result = compareFidelity(expectedContent(fixture), { nodes: ['a', 'b'], edges: [] });
    expect(result.verdict).toBe('fail');
    expect(result.mismatches[0]).toMatch(/a->b/);
  });

  it('reports an unknown kind as not-checked, never as a pass', () => {
    const result = compareFidelity(
      expectedContent({ artifactSpec: { kind: 'spatial-scene' } }),
      {},
    );
    expect(result.verdict).toBe('not-checked');
    expect(result.verdict).not.toBe('pass');
  });
});

describe('fidelity: the mutation probe proves the check has teeth', () => {
  it('catches a perturbed chart expectation', () => {
    const probe = mutationProbe(expectedContent(chartFixture), extractChartContent(chartXml));
    expect(probe.ran).toBe(true);
    expect(probe.caught).toBe(true);
  });

  it('catches a perturbed diagram expectation', () => {
    const fixture = {
      artifactSpec: {
        kind: 'graph',
        payload: { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }] },
      },
    };
    const probe = mutationProbe(expectedContent(fixture), {
      nodes: ['a', 'b'],
      edges: [['a', 'b']],
    });
    expect(probe.caught).toBe(true);
  });

  it('reports honestly when no probe exists rather than claiming one ran', () => {
    const probe = mutationProbe({ kind: 'not-checked' }, {});
    expect(probe.ran).toBe(false);
    expect(probe.caught).toBe(false);
  });
});
