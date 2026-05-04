import { describe, expect, it } from 'vitest';
import { buildDesignSystemShowcaseFiles } from './designSystemShowcase';

const files = {
  'ui_kits/demo/index.html': '<main><h1>Demo</h1></main>',
  'ui_kits/demo/tokens.css':
    ':root { --color-accent: #d95f3f; --space-4: 16px; --radius-lg: 18px; --font-display: Georgia; }',
  'ui_kits/demo/components/Button.tsx':
    'export function Button(){ return <button>Start</button>; }',
};

describe('designSystemShowcase', () => {
  it('builds a portable showcase and token payload from ui_kit files', () => {
    const out = buildDesignSystemShowcaseFiles(files, 'demo', {
      exportedAt: '2026-05-04T00:00:00.000Z',
    });
    expect(out['design-system/showcase.html']).toContain('Demo');
    expect(out['design-system/showcase.html']).toContain('--color-accent');
    expect(out['ui_kits/demo/design-system-showcase.html']).toContain('Component inventory');

    const payload = JSON.parse(out['design-system/tokens.json'] ?? '{}') as {
      tokens?: Array<{ name: string }>;
      components?: Array<{ name: string }>;
    };
    expect(payload.tokens?.some((token) => token.name === 'color-accent')).toBe(true);
    expect(payload.components?.some((component) => component.name === 'Button')).toBe(true);
  });
});
