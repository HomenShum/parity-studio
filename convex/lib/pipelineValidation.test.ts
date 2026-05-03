import { describe, expect, it } from 'vitest';
import {
  normalizeHtmlArtifact,
  validateGeneratedHtml,
  validateParsedUiKit,
} from './pipelineValidation';
import { parseUiKitResponse } from './uiKitParser';

const VALID_HTML = `<!doctype html>
<html>
<head>
  <style>
    body { font-family: Inter, sans-serif; }
    .shell { display: grid; grid-template-columns: 240px 1fr; gap: 24px; }
  </style>
</head>
<body>
  <header><nav>Acme Home Reports Settings</nav></header>
  <main class="shell">
    <section><h1>Finance workspace onboarding</h1><p>Connect accounts, invite teammates, and review cash movement before launch.</p></section>
    <section><article>Step 1: connect bank accounts and reconcile the first cash report.</article><article>Step 2: invite teammates, assign approval roles, and confirm audit coverage.</article></section>
    <section><h2>Launch checklist</h2><p>Review revenue recognition, vendor bills, burn-rate trend, and board packet readiness before sharing the workspace.</p></section>
    <aside>Customer success is ready with migration notes, security review answers, and onboarding support.</aside>
  </main>
  <footer>Trusted by operators</footer>
</body>
</html>`;

describe('pipeline validation', () => {
  it('extracts a complete HTML document from fenced or prefaced output', () => {
    const normalized = normalizeHtmlArtifact(
      `Here is the page:\n\n\`\`\`html\n${VALID_HTML}\n\`\`\``,
    );
    expect(normalized.startsWith('<!doctype html>')).toBe(true);
    expect(normalized.endsWith('</html>')).toBe(true);
  });

  it('wraps substantial styled fragments instead of treating them as blank runs', () => {
    const normalized = normalizeHtmlArtifact(`
<style>.hero { display: grid; gap: 24px; }</style>
<main class="hero">
  <section><h1>Launch finance operations with confidence</h1><p>Connect accounts, verify controls, invite teammates, and prepare the board packet.</p></section>
  <section><article>Cash visibility</article><article>Approval routing</article><article>Audit exports</article></section>
  <section><p>Every team member can see what still needs review, what changed since yesterday, and which launch task is blocking distribution readiness.</p></section>
  <footer>Security reviewed, SOC2-ready, and prepared for customer handoff.</footer>
</main>`);
    expect(normalized.startsWith('<!doctype html>')).toBe(true);
    expect(validateGeneratedHtml(normalized).ok).toBe(true);
  });

  it('rejects blank or thin generated artifacts before they become preview runs', () => {
    expect(validateGeneratedHtml('<html><body></body></html>').ok).toBe(false);
    expect(validateGeneratedHtml(VALID_HTML).ok).toBe(true);
  });

  it('rejects malformed ui_kit responses before saving them', () => {
    const bad = parseUiKitResponse('```html\n<html><body>missing path</body></html>\n```');
    expect(validateParsedUiKit(bad).ok).toBe(false);

    const good = parseUiKitResponse(`
\`\`\`html path=ui_kits/acme/index.html
${VALID_HTML}
\`\`\`
\`\`\`css path=ui_kits/acme/tokens.css
:root { --color-brand: #d8613d; }
\`\`\`
\`\`\`json path=ui_kits/acme/manifest.json
{"schemaVersion":1,"slug":"acme","components":["Hero"]}
\`\`\`
\`\`\`tsx path=ui_kits/acme/components/Hero.tsx
export function Hero(){ return <section>Finance workspace onboarding</section>; }
\`\`\`
\`\`\`md path=ui_kits/acme/README.md
# Acme
\`\`\`
`);
    expect(validateParsedUiKit(good).ok).toBe(true);
  });

  it('allows renderable kits even when scaffoldable support files are missing', () => {
    const parsed = parseUiKitResponse(`
\`\`\`html path=ui_kits/acme/index.html
${VALID_HTML}
\`\`\`
\`\`\`tsx path=ui_kits/acme/components/Hero.tsx
export function Hero(){ return <section>Finance workspace onboarding</section>; }
\`\`\`
\`\`\`tsx path=ui_kits/acme/components/Footer.tsx
export function Footer(){ return <footer>Trusted by operators</footer>; }
\`\`\`
\`\`\`md path=ui_kits/acme/README.md
# Acme
\`\`\`
\`\`\`md path=ui_kits/acme/HANDOFF.md
# Handoff
\`\`\`
`);
    expect(validateParsedUiKit(parsed).ok).toBe(true);
  });
});
