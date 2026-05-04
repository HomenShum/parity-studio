import { describe, expect, it } from 'vitest';
import {
  buildSurfacePreviewHtml,
  shouldUseUrlLoadedPreview,
  stripUnresolvedRelativeScripts,
} from './previewSrcDoc';
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

  it('inlines root-relative assets against the active surface', () => {
    const out = buildSurfacePreviewHtml({
      html: [
        '<!doctype html><html><head>',
        '<link rel="stylesheet" href="/nodebench.css?v=12">',
        '<style>@import url("/nodebench.css?v=12");</style>',
        '</head><body></body></html>',
      ].join(''),
      surface,
      tokensCss: null,
      files: {
        'ui_kits/nodebench-web/nodebench.css': 'body{background:#faf7f3;}',
      },
    });
    expect(out).toContain('data-parity-inlined="ui_kits/nodebench-web/nodebench.css"');
    expect(out).toContain('parity: inlined @import ui_kits/nodebench-web/nodebench.css');
    expect(out).toContain('body{background:#faf7f3;}');
    expect(out).not.toContain('href="/nodebench.css');
    expect(out).not.toContain('@import url("/nodebench.css');
  });

  it('strips only unresolved relative scripts', () => {
    const out = stripUnresolvedRelativeScripts(
      '<script src="https://cdn.example/a.js"></script><script src="./missing.js"></script>',
    );
    expect(out).toContain('https://cdn.example/a.js');
    expect(out).toContain('stripped unresolved preview script ./missing.js');
  });

  it('uses URL-loaded previews only for substantial non-comment kit previews', () => {
    expect(
      shouldUseUrlLoadedPreview({
        commentModeActive: false,
        hasLiveKitHtml: true,
        liveKitFileCount: 9,
      }),
    ).toBe(true);
    expect(
      shouldUseUrlLoadedPreview({
        commentModeActive: true,
        hasLiveKitHtml: true,
        liveKitFileCount: 9,
      }),
    ).toBe(false);
    expect(
      shouldUseUrlLoadedPreview({
        commentModeActive: false,
        hasLiveKitHtml: true,
        liveKitFileCount: 2,
      }),
    ).toBe(false);
  });
});
