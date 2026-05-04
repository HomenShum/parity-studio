import { describe, expect, it } from 'vitest';
import {
  buildFigmaBridge,
  buildFigmaBridgeFiles,
  filesFromFigmaPayload,
  parseFigmaBridgeJson,
} from './figmaBridge';

const files = {
  'ui_kits/demo/index.html': '<main><h1>Hello Figma</h1><button>Start</button></main>',
  'ui_kits/demo/tokens.css':
    ':root { --color-accent: #d95f3f; --space-4: 16px; --radius-lg: 18px; }',
  'ui_kits/demo/components/Button.tsx':
    'export function Button(){ return <button>Start</button>; }',
};

describe('figmaBridge', () => {
  it('builds a plugin-importable bridge bundle from ui_kit files', () => {
    const bridge = buildFigmaBridge(files, 'demo', { runId: 'run123' });
    expect(bridge.mode).toBe('figma-bridge');
    expect(bridge.tokens.some((token) => token.name === 'color-accent')).toBe(true);
    expect(bridge.components.some((component) => component.name === 'Button')).toBe(true);

    const bridgeFiles = buildFigmaBridgeFiles(files, 'demo', { runId: 'run123' });
    expect(bridgeFiles['figma/manifest.json']).toContain('Parity Studio Import');
    expect(bridgeFiles['figma/code.js']).toContain('figma.createPage');
    expect(bridgeFiles['figma/ui.html']).toContain('Import Parity frames');
    expect(bridgeFiles['ui_kits/demo/figma.bridge.json']).toContain('figma-bridge');
  });

  it('round-trips a Parity Figma bridge back into editable ui_kit files', () => {
    const raw = JSON.stringify(buildFigmaBridge(files, 'demo'));
    const parsed = parseFigmaBridgeJson(raw);
    const result = filesFromFigmaPayload(parsed, 'fallback');
    expect(result.slug).toBe('demo');
    expect(result.files['ui_kits/demo/index.html']).toContain('Hello Figma');
    expect(result.files['ui_kits/demo/tokens.css']).toContain('--color-accent');
  });

  it('imports Figma REST-like document JSON into a review surface', () => {
    const result = filesFromFigmaPayload(
      {
        name: 'Figma Marketing Flow',
        document: {
          name: 'Document',
          type: 'DOCUMENT',
          children: [
            {
              id: '1:1',
              name: 'Landing page',
              type: 'FRAME',
              absoluteBoundingBox: { width: 1200, height: 800 },
              fills: [{ type: 'SOLID', color: { r: 0.9, g: 0.3, b: 0.2 } }],
              children: [{ id: '1:2', name: 'Title', type: 'TEXT', characters: 'Launch faster' }],
            },
          ],
        },
      },
      'fallback',
    );
    expect(result.slug).toBe('figma-marketing-flow');
    expect(result.files['ui_kits/figma-marketing-flow/index.html']).toContain('Launch faster');
    expect(result.files['ui_kits/figma-marketing-flow/figma.source.json']).toContain(
      'Landing page',
    );
  });
});
