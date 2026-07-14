import { describe, expect, it, vi } from 'vitest';
import type { DeckSnapshot, SlideElement } from '../../../../shared/nodeslide';
import { downloadDeckJson } from './download';
import { boundedJsonPreview, diffSelectedElementJson, jsonForCopy } from './jsonEdit';

describe('selected-element JSON editing', () => {
  it('diffs editable JSON fields into granular typed operations', () => {
    const candidate = structuredClone(textElement);
    candidate.bbox = { x: 0.2, y: 0.16, width: 0.55, height: 0.22 };
    candidate.content = 'Updated canonical copy';
    candidate.style = { ...candidate.style, fontSize: 36, color: '#102040' };
    candidate.sourceIds = ['source:brief'];
    candidate.visible = false;

    const result = diffSelectedElementJson(
      textElement,
      JSON.stringify(candidate),
      new Set(['source:brief']),
    );

    expect(result).toEqual({
      ok: true,
      operations: [
        {
          op: 'resize',
          slideId: 'slide:one',
          elementId: 'element:text',
          width: 0.55,
          height: 0.22,
        },
        { op: 'move', slideId: 'slide:one', elementId: 'element:text', x: 0.2, y: 0.16 },
        {
          op: 'update_style',
          slideId: 'slide:one',
          elementId: 'element:text',
          properties: { fontSize: 36, color: '#102040' },
        },
        {
          op: 'replace_text',
          slideId: 'slide:one',
          elementId: 'element:text',
          text: 'Updated canonical copy',
          sourceIds: ['source:brief'],
        },
        {
          op: 'set_visibility_v1',
          slideId: 'slide:one',
          elementId: 'element:text',
          visible: false,
        },
      ],
    });
  });

  it('uses update_chart directly and never replaces the whole element', () => {
    const current: SlideElement = {
      ...textElement,
      id: 'element:chart',
      name: 'Adoption chart',
      kind: 'chart',
      chart: {
        chartType: 'bar',
        labels: ['A', 'B'],
        series: [{ name: 'Teams', values: [2, 4] }],
      },
    };
    const candidate = structuredClone(current);
    candidate.chart = {
      chartType: 'line',
      labels: ['2025', '2026'],
      series: [{ name: 'Teams', values: [4, 9], color: '#3155d9' }],
      unit: 'teams',
    };

    const result = diffSelectedElementJson(current, JSON.stringify(candidate));

    expect(result).toEqual({
      ok: true,
      operations: [
        {
          op: 'update_chart',
          slideId: current.slideId,
          elementId: current.id,
          chart: candidate.chart,
        },
      ],
    });
    if (result.ok) {
      expect(result.operations.map((operation) => operation.op)).not.toContain('remove_element');
      expect(result.operations.map((operation) => operation.op)).not.toContain('add_element');
    }
  });

  it('uses update_image directly for an embedded image and its metadata', () => {
    const current: SlideElement = {
      ...textElement,
      id: 'element:image',
      name: 'Portrait',
      kind: 'image',
      image: { placeholder: true, sourceId: 'source:brief' },
      altText: 'Portrait placeholder',
    };
    const candidate = structuredClone(current);
    candidate.imageUrl = 'data:image/png;base64,aGVsbG8=';
    candidate.altText = 'Team portrait';
    candidate.image = {
      placeholder: false,
      credit: 'Internal team',
      sourceId: 'source:brief',
    };
    candidate.sourceIds = ['source:brief'];

    const result = diffSelectedElementJson(
      current,
      JSON.stringify(candidate),
      new Set(['source:brief']),
    );

    expect(result).toEqual({
      ok: true,
      operations: [
        {
          op: 'update_image',
          slideId: current.slideId,
          elementId: current.id,
          imageUrl: candidate.imageUrl,
          altText: candidate.altText,
          credit: 'Internal team',
          sourceIds: ['source:brief'],
        },
      ],
    });
  });

  it('rejects rotation and reports malformed JSON honestly', () => {
    const rotated = structuredClone(textElement);
    rotated.rotation = 15;

    expect(diffSelectedElementJson(textElement, JSON.stringify(rotated))).toEqual({
      ok: false,
      error: '“rotation” is read-only in Source. Rotation has no typed patch operation yet.',
    });
    const malformed = diffSelectedElementJson(textElement, '{"content":');
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error).toMatch(/^Invalid JSON:/);
  });

  it('copies complete valid JSON while bounding only the rendered preview', () => {
    const value = { payload: 'x'.repeat(200) };
    const copy = jsonForCopy(value);
    const preview = boundedJsonPreview(value, 40);

    expect(JSON.parse(copy)).toEqual(value);
    expect(preview.truncated).toBe(true);
    expect(preview.text.length).toBeLessThan(80);
    expect(preview.totalCharacters).toBe(copy.length);
  });

  it('downloads the canonical snapshot as formatted JSON', async () => {
    const anchor = { click: vi.fn(), remove: vi.fn(), hidden: false, href: '', download: '' };
    const append = vi.fn();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { append },
    });
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:deck-json');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const snapshot: DeckSnapshot = {
        deck: {
          schemaVersion: 'nodeslide.slidelang/v1',
          toolchainVersion: 'test',
          id: 'deck:test',
          projectId: 'project:test',
          title: 'Launch / Plan',
          brief: { prompt: 'Test', audience: 'Test', purpose: 'Test', successCriteria: [] },
          theme: {
            id: 'theme:test',
            name: 'Test',
            mode: 'light',
            colors: {
              canvas: '#ffffff',
              ink: '#111111',
              muted: '#666666',
              accent: '#aa4422',
              accentSoft: '#ffeee8',
              insight: '#005577',
              insightInk: '#ffffff',
              trace: '#7755aa',
              border: '#dddddd',
            },
            typography: { display: 'Arial', body: 'Arial', data: 'Arial' },
            defaultRadius: 8,
            spacingUnit: 8,
          },
          slideOrder: ['slide:one'],
          version: 1,
          status: 'ready',
          createdAt: 1,
          updatedAt: 1,
        },
        slides: [
          {
            id: 'slide:one',
            deckId: 'deck:test',
            title: 'One',
            background: '#ffffff',
            elementOrder: ['element:text'],
            version: 1,
          },
        ],
        elements: [{ ...textElement, version: 1 }],
        sources: [],
      };

      downloadDeckJson(snapshot);

      const blob = createObjectUrl.mock.calls[0]?.[0];
      expect(blob).toBeInstanceOf(Blob);
      if (!(blob instanceof Blob)) throw new Error('Expected a JSON Blob.');
      expect(blob.type).toBe('application/json;charset=utf-8');
      const downloaded = JSON.parse(await blob.text());
      expect(downloaded).toEqual({
        format: 'nodeslide.deck-snapshot',
        version: 1,
        snapshot,
      });
      expect(anchor.download).toBe('launch-plan.json');
      expect(anchor.click).toHaveBeenCalledOnce();
      vi.runAllTimers();
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:deck-json');
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});

const textElement: SlideElement = {
  id: 'element:text',
  slideId: 'slide:one',
  name: 'Headline',
  kind: 'text',
  role: 'title',
  bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
  rotation: 0,
  content: 'Original copy',
  style: { color: '#111111', fontSize: 32 },
  sourceIds: [],
  locked: false,
  exportCapabilities: ['web_native', 'pptx_editable'],
  version: 4,
};
