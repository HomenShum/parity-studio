import { describe, expect, it } from 'vitest';
import { checkDeterministic } from './parityChecker';

const SOURCE_HTML = `
<html>
  <head>
    <style>
      :root { --color-brand: #c96442; --space-md: 16px; }
      body { font-family: Inter, sans-serif; color: #1f1712; }
      main { display: flex; gap: var(--space-md); }
      .metric { font-size: 16px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); }
      button:hover, button:focus-visible, button:active { color: var(--color-brand); }
      @media (max-width: 720px) { main { display: block; } }
    </style>
  </head>
  <body>
    <header><h1>Acme Analytics</h1></header>
    <main>
      <section class="metrics">
        <div class="metric"><span>MRR</span><span>$12,400</span></div>
        <div class="metric"><span>Churn</span><span>2.1%</span></div>
        <button aria-label="Refresh metrics"><svg aria-hidden="true"></svg></button>
      </section>
    </main>
    <footer>copyright Acme</footer>
  </body>
</html>`;

const HIGH_PARITY_DECOMP = `
<html>
  <head>
    <style>
      :root { --color-brand: #c96442; --space-md: 16px; }
      body { font-family: Inter, sans-serif; color: #1f1712; }
      main { display: flex; gap: var(--space-md); }
      .metric { font-size: 16px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); }
      button:hover, button:focus-visible, button:active { color: var(--color-brand); }
      @media (max-width: 720px) { main { display: block; } }
    </style>
  </head>
  <body>
    <header><h1>Acme Analytics</h1></header>
    <main>
      <section>
        <div><span>MRR</span><span>$12,400</span></div>
        <div><span>Churn</span><span>2.1%</span></div>
        <button aria-label="Refresh metrics"><svg aria-hidden="true"></svg></button>
      </section>
    </main>
    <footer>copyright Acme</footer>
  </body>
</html>`;

const LOW_PARITY_DECOMP = '<html><body><div>just one tile</div></body></html>';

const TOKENS_CSS = ':root { --color-brand: #c96442; --space-md: 16px; }';

describe('checkDeterministic', () => {
  it('reports high parity when decomposed faithfully mirrors source', () => {
    const r = checkDeterministic({
      sourceHtml: SOURCE_HTML,
      decomposedHtml: HIGH_PARITY_DECOMP,
      tokensCss: TOKENS_CSS,
      uiKitFiles: {
        'ui_kits/x/index.html': HIGH_PARITY_DECOMP,
        'ui_kits/x/tokens.css': TOKENS_CSS,
        'ui_kits/x/manifest.json': '{}',
        'ui_kits/x/README.md': '',
      },
    });
    expect(r.passCount).toBeGreaterThanOrEqual(13);
    expect(r.totalChecks).toBe(16);
    expect(['verified', 'needs_review']).toContain(r.status);
  });

  it('reports failed when decomposed is structurally thin', () => {
    const r = checkDeterministic({
      sourceHtml: SOURCE_HTML,
      decomposedHtml: LOW_PARITY_DECOMP,
      tokensCss: '',
      uiKitFiles: { 'ui_kits/x/index.html': LOW_PARITY_DECOMP },
    });
    expect(r.passCount).toBeLessThan(8);
    expect(['needs_iteration', 'failed']).toContain(r.status);
  });

  it('reports unavailable-equivalent failed when index.html missing', () => {
    const r = checkDeterministic({
      sourceHtml: SOURCE_HTML,
      decomposedHtml: null,
      tokensCss: null,
      uiKitFiles: {},
    });
    expect(r.status).toBe('failed');
    expect(r.parityScore).toBe(0);
    expect(r.gaps[0]?.kind).toBe('missing-file');
  });

  // Regression for CodeQL js/bad-tag-filter (HIGH) — ported from PR #241 fix.
  // Crafted source HTML uses HTML5-tolerated end-tag forms (`</script >`,
  // `</script foo="bar">`, `</style >`, `</SCRIPT>`). If stripTags' close-tag
  // pattern were the literal `</script>`, those bodies would leak into the
  // visible-text vocabulary. None of the leaked tokens should appear in the
  // resulting parity report when decomposed correctly omits the script/style.
  it('strips script + style bodies even with attrs/whitespace in end tags', () => {
    const sourceWithCraftedScript = `
      <html><body>
        <h1>Acme Analytics</h1>
        <script>secretLeakedTokenAaa()</script >
        <script>anotherLeakedTokenBbb()</script foo="bar">
        <style>.x{color:#f00}/*secretLeakedCssCcc*/</style >
        <SCRIPT>upperCaseLeakedTokenDdd()</SCRIPT>
      </body></html>
    `;
    const cleanDecomp = '<html><body><h1>Acme Analytics</h1></body></html>';
    const r = checkDeterministic({
      sourceHtml: sourceWithCraftedScript,
      decomposedHtml: cleanDecomp,
      tokensCss: '',
      uiKitFiles: { 'ui_kits/x/index.html': cleanDecomp },
    });
    const blob = JSON.stringify(r).toLowerCase();
    expect(blob).not.toContain('secretleakedtoken');
    expect(blob).not.toContain('anotherleakedtoken');
    expect(blob).not.toContain('secretleakedcss');
    expect(blob).not.toContain('uppercaseleakedtoken');
  });
});
