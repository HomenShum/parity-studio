import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NodeSlideWorkspace, SlideElement } from '../../../../shared/nodeslide';
import { JsonInspector } from './JsonInspector';

describe('JSON / Source inspector', () => {
  it('exposes the snapshot, last-patch, and selected-element views', () => {
    const markup = renderToStaticMarkup(
      <JsonInspector workspace={workspace} selectedElements={[]} onApplyPatch={() => undefined} />,
    );

    expect(markup).toContain('JSON / Source');
    expect(markup).toContain('Current snapshot');
    expect(markup).toContain('Last patch');
    expect(markup).toContain('Selected element');
    expect(markup).toContain('Copy valid JSON');
    expect(markup).toContain('&quot;deck&quot;');
  });

  it('labels bounded JSON and PPTX imports as reviewable proposals', () => {
    const markup = renderToStaticMarkup(
      <JsonInspector
        workspace={workspace}
        selectedElements={[]}
        onApplyPatch={() => undefined}
        onImportSourceFile={async () => 'Import proposed.'}
      />,
    );

    expect(markup).toContain('Review an external deck');
    expect(markup).toContain('Import Deck JSON');
    expect(markup).toContain('Import PPTX');
    expect(markup).toContain('stays unapplied until you accept its proposal');
    expect(markup).toContain('native, approximated, and dropped');
  });

  it('opens on the selected element source when selection already exists', () => {
    const markup = renderToStaticMarkup(
      <JsonInspector
        workspace={workspace}
        selectedElements={[selectedElement]}
        onApplyPatch={() => undefined}
      />,
    );

    expect(markup).toContain('role="tab" aria-selected="true"');
    expect(markup).toContain('Selected element</button>');
    expect(markup).toContain('&quot;id&quot;: &quot;element:test&quot;');
  });
});

const selectedElement = {
  id: 'element:test',
  slideId: 'slide:test',
  name: 'Headline',
  kind: 'text',
  bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
  rotation: 0,
  content: 'Selected source',
  style: {},
  sourceIds: [],
  locked: false,
  exportCapabilities: ['web_native'],
  version: 1,
} satisfies SlideElement;

const workspace = {
  deck: {
    id: 'deck:test',
    title: 'Source test',
    version: 3,
  },
  slides: [],
  elements: [],
  sources: [],
  patches: [],
} as unknown as NodeSlideWorkspace;
