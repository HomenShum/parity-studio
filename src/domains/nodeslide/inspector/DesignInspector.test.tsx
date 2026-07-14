import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SlideElement } from '../../../../shared/nodeslide';
import {
  CollapsibleInspectorSection,
  DEFAULT_DESIGN_INSPECTOR_SECTIONS,
  appendChartDataRow,
  buildChartUpdateOperation,
  chartRowsFromElement,
  removeChartDataRow,
  toggleDesignInspectorSection,
} from './DesignInspector';

const inspectorSource = readFileSync(new URL('./DesignInspector.tsx', import.meta.url), 'utf8');
const studioSource = readFileSync(new URL('../NodeSlideStudio.tsx', import.meta.url), 'utf8');

describe('NodeSlide Design inspector sections', () => {
  it('starts with Content and Data open while Appearance and Advanced stay collapsed', () => {
    expect(DEFAULT_DESIGN_INSPECTOR_SECTIONS).toEqual({
      content: true,
      data: true,
      appearance: false,
      advanced: false,
    });

    const collapsed = renderToStaticMarkup(
      <CollapsibleInspectorSection id="advanced" title="Advanced" open={false} onToggle={() => {}}>
        <span>Advanced controls</span>
      </CollapsibleInspectorSection>,
    );
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('hidden=""');

    const toggled = toggleDesignInspectorSection(DEFAULT_DESIGN_INSPECTOR_SECTIONS, 'advanced');
    const expanded = renderToStaticMarkup(
      <CollapsibleInspectorSection
        id="advanced"
        title="Advanced"
        open={toggled.advanced}
        onToggle={() => {}}
      >
        <span>Advanced controls</span>
      </CollapsibleInspectorSection>,
    );
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).not.toContain('hidden=""');
  });

  it('persists disclosure state for the browser session and visibly labels both steppers', () => {
    expect(inspectorSource).toContain('window.sessionStorage.setItem(DESIGN_SECTION_STORAGE_KEY');
    expect(inspectorSource).toContain('label="Corner radius"');
    expect(inspectorSource).toContain('label="Opacity %"');
    expect(inspectorSource).toContain('className="ns-stepper-label"');
  });
});

describe('NodeSlide chart label/value grid', () => {
  it('round-trips four points and applies an edited value through the existing update_chart op', () => {
    const element = chartElement();
    const rows = chartRowsFromElement(element);
    expect(rows).toHaveLength(4);

    const editedRows = rows.map((row, index) => (index === 2 ? { ...row, value: '181' } : row));
    const result = buildChartUpdateOperation({
      element,
      rows: editedRows,
      chartType: 'bar',
      seriesName: 'Audience',
      unit: 'millions',
    });

    expect(result.error).toBeNull();
    expect(result.operation?.op).toBe('update_chart');
    if (result.operation?.op !== 'update_chart') throw new Error('Expected update_chart');
    expect(result.operation.chart.labels).toEqual(['2010', '2014', '2018', '2022']);
    expect(result.operation.chart.series[0]?.values).toEqual([145, 171, 181, 172]);

    expect(studioSource).toContain('baseDeckVersion: currentWorkspace.deck.version');
    expect(studioSource).toContain('baseSlideVersions: clocks.baseSlideVersions');
    expect(studioSource).toContain('baseElementVersions: applyExpectedElementVersions(');
  });

  it('adds a fifth point and removes one point without comma-string parsing', () => {
    const rows = chartRowsFromElement(chartElement());
    const withFifth = appendChartDataRow(rows, 'chart-1:new:4').map((row, index) =>
      index === 4 ? { ...row, label: '2026', value: '190' } : row,
    );
    expect(withFifth).toHaveLength(5);

    const withThree = removeChartDataRow(rows, rows[1]?.id ?? 'missing');
    expect(withThree).toHaveLength(3);
    expect(withThree.map((row) => row.label)).toEqual(['2010', '2018', '2022']);

    expect(inspectorSource).not.toContain('data-testid="chart-labels"');
    expect(inspectorSource).not.toContain('data-testid="chart-values"');
    expect(inspectorSource).not.toContain("form.get('labels')");
    expect(inspectorSource).not.toContain("form.get('values')");
  });

  it('blocks an empty or non-numeric value with an inline interface hint', () => {
    const element = chartElement();
    for (const invalidValue of ['', 'not-a-number']) {
      const rows = chartRowsFromElement(element).map((row, index) =>
        index === 1 ? { ...row, value: invalidValue } : row,
      );
      const result = buildChartUpdateOperation({
        element,
        rows,
        chartType: 'line',
        seriesName: 'Audience',
        unit: 'millions',
      });
      expect(result.operation).toBeNull();
      expect(result.error).toBe('Enter a number for every point.');
    }
  });
});

function chartElement(): SlideElement {
  return {
    id: 'chart-1',
    slideId: 'slide-1',
    name: 'Tournament audience',
    kind: 'chart',
    bbox: { x: 0.08, y: 0.28, width: 0.84, height: 0.56 },
    rotation: 0,
    style: {},
    chart: {
      chartType: 'bar',
      labels: ['2010', '2014', '2018', '2022'],
      series: [{ name: 'Audience', values: [145, 171, 169, 172], color: '#b35a3f' }],
      unit: 'millions',
      sourceId: 'source-fifa',
    },
    sourceIds: ['source-fifa'],
    locked: false,
    exportCapabilities: ['web_native', 'pptx_editable'],
    version: 4,
  };
}
