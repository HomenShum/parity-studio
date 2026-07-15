import { describe, expect, it } from 'vitest';
import type { ChartData, DeckSnapshot, SlideElement } from '../../shared/nodeslide';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import {
  type NodeSlideSemanticPatch,
  evaluateNodeSlideSemantics,
} from './nodeslideSemanticEvaluation';

const NOW = 1_800_000_000_000;

describe('NodeSlide semantic evaluation patch and evidence scenarios', () => {
  it('materializes a patch deterministically, binds the blocker, and leaves the base unchanged', () => {
    const snapshot = fixture();
    const before = structuredClone(snapshot);
    const chart = requiredChart(snapshot);
    const patch = {
      baseDeckVersion: snapshot.deck.version,
      scope: {
        kind: 'elements',
        deckId: snapshot.deck.id,
        slideIds: [chart.slideId],
        elementIds: [chart.id],
        operationMode: 'unrestricted',
      },
      operations: [
        {
          op: 'update_chart',
          slideId: chart.slideId,
          elementId: chart.id,
          chart: {
            ...structuredClone(chart.chart),
            series: [{ name: 'Signal', values: [1], color: '#cc5522' }],
          },
        },
      ],
    } satisfies NodeSlideSemanticPatch;

    const first = evaluateNodeSlideSemantics(
      { kind: 'patch', base: snapshot, patch },
      { referenceTime: NOW, policy: { requireOpeningAndClose: false } },
    );
    const second = evaluateNodeSlideSemantics(
      { kind: 'patch', base: snapshot, patch },
      { referenceTime: NOW, policy: { requireOpeningAndClose: false } },
    );

    expect(first).toEqual(second);
    expect(first.target).toMatchObject({
      kind: 'patch',
      baseDeckVersion: snapshot.deck.version,
      candidateDeckVersion: snapshot.deck.version + 1,
    });
    expect(first.target.patchDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.outcome).toBe('blocked');
    const finding = first.findings.find(
      (candidate) => candidate.code === 'chart_label_value_mismatch',
    );
    expect(finding).toMatchObject({
      disposition: 'hard_blocker',
      slideId: chart.slideId,
      elementId: chart.id,
    });
    expect(finding?.bindings.sourceIds).toEqual(expect.arrayContaining(chart.sourceIds));
    expect(finding?.evidence[0]?.path).toMatch(/\/chart\/series\/0\/values$/);
    expect(snapshot).toEqual(before);
  });

  it('produces chart-, caption-, and axis-bound evidence for explicit semantic disagreement', () => {
    const snapshot = fixture();
    const chart = requiredChart(snapshot);
    const slide = snapshot.slides.find((candidate) => candidate.id === chart.slideId);
    if (!slide || !chart.chart) throw new Error('Expected chart slide fixture.');
    const companions = [
      textCompanion(chart, 'chart-x-axis', 'x_axis', 'ok | publish | release'),
      textCompanion(chart, 'chart-y-axis', 'y_axis', 'Success (%)'),
      textCompanion(chart, 'chart-caption', 'caption', 'ok: 2'),
    ];
    snapshot.elements.push(...companions);
    slide.elementOrder.push(...companions.map((element) => element.id));

    const receipt = evaluateNodeSlideSemantics(
      { kind: 'snapshot', snapshot },
      { referenceTime: NOW, policy: { requireOpeningAndClose: false } },
    );
    const codes = receipt.findings.map((finding) => finding.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        'chart_axis_label_mismatch',
        'chart_axis_unit_mismatch',
        'chart_caption_value_mismatch',
      ]),
    );
    for (const code of [
      'chart_axis_label_mismatch',
      'chart_axis_unit_mismatch',
      'chart_caption_value_mismatch',
    ] as const) {
      const finding = receipt.findings.find((candidate) => candidate.code === code);
      expect(finding?.bindings.elementIds).toContain(chart.id);
      expect(finding?.evidence.length).toBeGreaterThanOrEqual(2);
      expect(finding?.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('returns an explicit blocker when the bounded receipt cannot retain every finding', () => {
    const snapshot = fixture();
    const chart = requiredChart(snapshot);
    if (!chart.chart) throw new Error('Expected chart fixture.');
    chart.chart.series[0] = { name: 'Signal', values: [Number.NaN] };

    const receipt = evaluateNodeSlideSemantics(
      { kind: 'snapshot', snapshot },
      {
        referenceTime: NOW,
        policy: { maxFindings: 1, requireOpeningAndClose: false },
      },
    );

    expect(receipt.findings).toHaveLength(1);
    expect(receipt.findings[0]).toMatchObject({
      code: 'evaluation_findings_truncated',
      severity: 'critical',
      disposition: 'hard_blocker',
      rank: 1,
    });
    expect(receipt.bounds.findingsTruncated).toBe(true);
    expect(receipt.bounds.observedFindings).toBeGreaterThan(1);
    expect(receipt.outcome).toBe('blocked');
  });
});

function fixture(): DeckSnapshot {
  return buildGoldenNodeSlide('semantic-evaluation-patch-tests', NOW).snapshot;
}

function requiredChart(snapshot: DeckSnapshot): SlideElement & { chart: ChartData } {
  const chart = snapshot.elements.find((element) => element.kind === 'chart');
  if (!chart?.chart) throw new Error('Expected a structured chart fixture.');
  return chart as SlideElement & { chart: ChartData };
}

function textCompanion(
  chart: SlideElement,
  id: string,
  role: string,
  content: string,
): SlideElement {
  return {
    id,
    slideId: chart.slideId,
    name: id,
    kind: 'text',
    role,
    bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
    rotation: 0,
    content,
    style: {},
    sourceIds: [...chart.sourceIds],
    locked: false,
    exportCapabilities: ['web_native', 'pptx_editable'],
    version: 1,
  };
}
