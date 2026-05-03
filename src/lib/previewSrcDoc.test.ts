import { describe, expect, it } from 'vitest';
import { buildSurfacePreviewHtml, stripUnresolvedRelativeScripts } from './previewSrcDoc';
import type { ProjectSurface } from './projectSurfaces';

describe('previewSrcDoc', () => {
  const surface: ProjectSurface = {
    slug: 'nodebench-web',
    label: 'NodeBench Web',
    kind: 'web',
    entry: 'ui_kits/nodebench-web/index.html',
    defaultDevice: 'desktop',
    fileCount: 3,
    hasIndex: true,
  };

  it('inlines same-surface css and script files for srcDoc previews', () => {
    const html = [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="./styles.css">',
      '<script type="text/babel" src="./App.jsx"></script>',
      '</head><body><img src="./logo.svg"></body></html>',
    ].join('');
    const out = buildSurfacePreviewHtml({
      html,
      surface,
      tokensCss: ':root{--accent:#c76d54;}',
      files: {
        'ui_kits/nodebench-web/styles.css': 'body{color:red;}',
        'ui_kits/nodebench-web/App.jsx': 'window.__ok = true;',
        'ui_kits/nodebench-web/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      },
    });
    expect(out).toContain('data-parity-inlined="ui_kits/nodebench-web/styles.css"');
    expect(out).toContain('data-parity-inlined="ui_kits/nodebench-web/App.jsx"');
    expect(out).toContain('data:image/svg+xml');
    expect(out).toContain('data-parity-tokens="live"');
  });

  it('strips only unresolved relative scripts', () => {
    const out = stripUnresolvedRelativeScripts(
      '<script src="https://cdn.example/a.js"></script><script src="./missing.js"></script>',
    );
    expect(out).toContain('https://cdn.example/a.js');
    expect(out).toContain('stripped unresolved preview script ./missing.js');
  });
});
