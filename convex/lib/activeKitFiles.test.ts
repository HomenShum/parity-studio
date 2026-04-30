import { describe, expect, it } from 'vitest';
import { findActiveKitFile, inferActiveKitSlug } from './activeKitFiles';

describe('active kit file selection', () => {
  it('prefers product ui_kits/<slug>/index.html over preview/index.html', () => {
    const files = {
      'preview/index.html': '<html><body>preview shell</body></html>',
      'ui_kits/release-demo/index.html': '<html><body>actual product</body></html>',
      'ui_kits/release-demo/tokens.css': ':root { --color-brand: #f55; }',
    };

    expect(findActiveKitFile(files, 'release-demo', 'index.html')).toContain('actual product');
    expect(findActiveKitFile(files, 'release-demo', 'tokens.css')).toContain('--color-brand');
  });

  it('infers the active slug from ui_kits paths', () => {
    expect(
      inferActiveKitSlug({
        'preview/index.html': '',
        'ui_kits/checkout/index.html': '',
      }),
    ).toBe('checkout');
  });
});
