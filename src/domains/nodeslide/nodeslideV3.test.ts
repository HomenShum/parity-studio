import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./nodeslideV3.css', import.meta.url), 'utf8');
const baseCss = readFileSync(new URL('./nodeslide.css', import.meta.url), 'utf8');
const studioSource = readFileSync(new URL('./NodeSlideStudio.tsx', import.meta.url), 'utf8');
const slideCanvasSource = readFileSync(
  new URL('./components/SlideCanvas.tsx', import.meta.url),
  'utf8',
);
const aiInspectorSource = readFileSync(
  new URL('./inspector/AiInspector.tsx', import.meta.url),
  'utf8',
);

describe('NodeSlide v3 visual contract', () => {
  it('loads the v3 contract after the authoritative editor shell styles', () => {
    expect(studioSource.indexOf("import './nodeslide.css'")).toBeLessThan(
      studioSource.indexOf("import './nodeslideV3.css'"),
    );
    expect(baseCss).toContain(
      '@layer nodeslide.tokens, nodeslide.base, nodeslide.editor, nodeslide.inspector, nodeslide.contract;',
    );
    expect(css).toContain('@layer nodeslide.contract');
  });

  it('locks the desktop navigator while preserving the user-resizable inspector width', () => {
    const desktop = mediaBlock('@media (min-width: 1100px)', '@media (min-width: 700px)');

    expect(desktop).toContain('--ns-nav-width: 260px !important');
    expect(desktop).not.toContain('--ns-inspector-width: 340px !important');
    expect(desktop).toMatch(/\.ns-navigator:not\(\.is-collapsed\)[\s\S]*width: 260px/);
    expect(desktop).toMatch(
      /\.ns-inspector:not\(\.is-collapsed\)[\s\S]*width: var\(--ns-inspector-width\) !important/,
    );
    expect(baseCss).toContain('--ns-inspector-width: 400px');
    expect(studioSource).toContain('useState(400)');
  });

  it('protects a 500px canvas floor at the narrow desktop breakpoint', () => {
    const constrainedDesktop = mediaBlock(
      '@media (min-width: 1100px) and (max-width: 1339px)',
      '@media (min-width: 700px)',
    );

    expect(constrainedDesktop).toContain(
      '--ns-inspector-width: clamp(304px, calc(100vw - 760px), 400px) !important',
    );
  });

  it('keeps navigation and inspector reachable as tablet overlays', () => {
    const tablet = mediaBlock(
      '@media (min-width: 700px) and (max-width: 1099px)',
      '@media (max-width: 699px)',
    );

    expect(tablet).toMatch(/\.ns-navigator[\s\S]*position: absolute[\s\S]*width: 260px/);
    expect(tablet).toMatch(
      /\.ns-inspector\.is-drawer-open[\s\S]*position: fixed[\s\S]*width: clamp\(360px, 46vw, 480px\) !important/,
    );
    expect(tablet).toMatch(/\.ns-toolbar \.ns-navigator-toggle[\s\S]*display: inline-flex/);
    expect(tablet).toMatch(
      /\.ns-toolbar-history,[\s\S]*?\.ns-language-menu,[\s\S]*?\.ns-reset-view[\s\S]*?display: none/,
    );
  });

  it('keeps core first-run actions reachable on phones', () => {
    const phone = mediaBlock('@media (max-width: 699px)', '@media (prefers-reduced-motion');

    expect(phone).toContain('grid-template-rows: 82px minmax(0, 1fr)');
    expect(phone).toMatch(/\.ns-navigator,[\s\S]*height: 82px[\s\S]*width: 100%/);
    expect(phone).toMatch(/\.ns-slide-list[\s\S]*overflow-x: auto/);
    expect(phone).toMatch(
      /\.ns-toolbar-actions--v3 \.ns-toolbar-labeled[\s\S]*display: inline-flex/,
    );
    expect(phone).toMatch(/\.ns-toolbar-actions--v3 \.ns-export-menu[\s\S]*display: block/);
    expect(phone).toMatch(/\.ns-toolbar-actions--v3 \.ns-language-menu[\s\S]*display: none/);
    expect(phone).toMatch(/\.ns-command-button[\s\S]*display: none/);
    expect(phone).toMatch(/\.ns-navigator,[\s\S]*max-width: none/);
    expect(phone).toMatch(/\.ns-inspector\.is-drawer-open[\s\S]*position: fixed/);
    expect(phone).toMatch(/\.ns-inspector\.is-collapsed[\s\S]*display: none/);
    expect(phone).toMatch(/\.ns-slide-stepper[\s\S]*display: flex/);
    expect(phone).toMatch(/\.ns-slide-more[\s\S]*display: flex !important/);
    expect(phone).toMatch(/\.ns-navigator-footer[\s\S]*display: flex !important/);
    expect(phone).toMatch(/\.ns-add-slide-button[\s\S]*font-size: 0/);
    expect(phone).toMatch(/\.ns-slide-row[\s\S]*grid-template-columns: 12px 72px 40px/);
    expect(phone).toMatch(/\.ns-slide-more[\s\S]*height: 40px[\s\S]*width: 40px/);
    expect(phone).toMatch(/\.ns-add-slide-button[\s\S]*height: 44px[\s\S]*width: 44px/);
  });

  it('gives the root landing a single responsive composer instead of editor chrome', () => {
    const runtimeLanding = css.slice(css.lastIndexOf('/* Landing runtime contract'));
    expect(css).toMatch(
      /\.nodeslide-studio\.ns-landing[\s\S]*?display: flex;[\s\S]*?overflow-y: auto;/,
    );
    expect(runtimeLanding).toMatch(
      /\.ns-landing-composer[\s\S]*?border-radius: 20px;[\s\S]*?overflow: hidden;/,
    );
    expect(runtimeLanding).toMatch(
      /@media \(max-width: 699px\)[\s\S]*?\.ns-landing-main[\s\S]*?padding: 36px 14px 28px;/,
    );
    expect(runtimeLanding).toContain('.ns-landing-recents-toggle');
    expect(css).not.toContain('.ns-provider-consent');
    expect(studioSource).toContain('<NodeSlideLanding');
    expect(studioSource).not.toContain('<FirstRunDialog');
  });

  it('keeps secondary text at AA contrast in both themes', () => {
    expect(contrast('#667085', '#fafafa')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#a8583f', '#fafafa')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#9aa5b1', '#0c0e11')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#df8e70', '#0c0e11')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', '#ad5f45')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', '#9f503a')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps notifications clear of the authoritative bottom decision bar', () => {
    expect(css).toMatch(
      /\.nodeslide-studio \.ns-toast[\s\S]*?bottom: auto;[\s\S]*?right: calc\(var\(--ns-inspector-width\) \+ 14px\);[\s\S]*?top: 64px;/,
    );
  });

  it('keeps selected-element actions labeled and scrollbar-free in narrow canvases', () => {
    expect(baseCss).toMatch(
      /\.ns-canvas-panel[\s\S]*?container-name: nodeslide-canvas;[\s\S]*?container-type: inline-size;/,
    );
    expect(baseCss).toMatch(/\.ns-workspace-object-toolbar[\s\S]*?overflow-x: hidden;/);
    expect(css).toMatch(
      /@container nodeslide-canvas \(max-width: 720px\)[\s\S]*?\.ns-object-action-label[\s\S]*?display: none;/,
    );
    expect(slideCanvasSource).toContain('className="ns-object-action-label"');
    for (const label of ['Ask AI', 'Comment', 'Duplicate', 'Bring forward', 'Send backward']) {
      expect(slideCanvasSource).toContain(`aria-label="${label}"`);
    }
  });

  it('keeps consequential AI review text above the readable inspector floor', () => {
    expect(baseCss).toContain('--ns-font-control: 11px');
    expect(baseCss).toContain('--ns-chrome-min-font: var(--ns-font-control)');
    expect(css).toMatch(
      /\.ns-ai-v3-shell \.ns-agent-honesty-state strong[\s\S]*?font-size: 11\.5px/,
    );
    expect(css).toMatch(/\.ns-ai-v3-shell \.ns-proposal-card h3[\s\S]*?font-size: 12\.5px/);
    expect(css).toMatch(/\.ns-ai-v3-shell \.ns-proposal-evidence dd[\s\S]*?font-size: 10px/);
    expect(css).toMatch(/\.ns-ai-v3-shell \.ns-proposal-actions \.ns-button[\s\S]*?height: 34px/);
  });

  it('keeps the AI chat primary and advanced controls compact', () => {
    expect(css).toMatch(/\.ns-ai-v3-welcome[\s\S]*?grid-template-columns: 28px minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.ns-ai-v3-policy-summary[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/);
    expect(css).toMatch(
      /\.ns-ai-v3-controls-disclosure[\s\S]*?border-radius: 9px;[\s\S]*?overflow: hidden;/,
    );
    expect(css).toMatch(/\.ns-ai-v3-composer > \*[\s\S]*?flex-shrink: 0;/);
    expect(css).toMatch(
      /\.ns-composer-token-toolbar button[\s\S]*?background: transparent;[\s\S]*?width: auto;/,
    );
  });

  it('makes typing the primary composer action', () => {
    expect(css).toMatch(/\.ns-ai-v3-composer-field[\s\S]*?order: 1;/);
    expect(css).toMatch(/\.ns-ai-v3-suggested-actions[\s\S]*?order: 3;/);
    expect(css).toMatch(/\.ns-composer-field:focus-within[\s\S]*?border-color:[\s\S]*?box-shadow:/);
    expect(css).toMatch(/\.ns-composer-field textarea[\s\S]*?min-height: 92px;/);

    // The composer remains primary while external egress stays fail-closed behind
    // one compact, revocable browser-tab consent control.
    expect(aiInspectorSource).toContain('<NodeSlidePromptComposer');
    expect(aiInspectorSource).toContain('composerClassName="ns-ai-v3-prompt"');
    expect(aiInspectorSource).toContain('ns-session-consent-pill ns-ai-session-consent');
    expect(aiInspectorSource).toContain('data-testid="ai-provider-consent"');
    expect(css).toContain('.nodeslide-studio .ns-agent-message:not(.is-user)');
    expect(css).toContain('grid-template-columns: 28px minmax(0, 1fr);');
    expect(css).toContain('.nodeslide-studio .ns-ai-v3-tool');
    expect(css).toMatch(
      /\.nodeslide-studio \.ns-ai-v3-prompt \.ns-prompt-textarea[\s\S]*?min-height: 104px;[\s\S]*?padding: 15px 14px 10px;/,
    );
    expect(css).toMatch(
      /\.nodeslide-studio \.ns-ai-v3-prompt \.ns-prompt-tools[\s\S]*?flex-wrap: wrap;/,
    );
    expect(css).toMatch(
      /@container nodeslide-inspector \(max-width: 430px\)[\s\S]*?\.ns-prompt-footer-status[\s\S]*?display: none;[\s\S]*?\.ns-ai-tool-label[\s\S]*?display: none;/,
    );
    expect(aiInspectorSource).toContain(
      'follow={!activityAutoScrollPaused && activityHasScrollTarget}',
    );
  });

  it('switches the agent rail into a review-first state without a nested composer scroller', () => {
    expect(aiInspectorSource).toContain("'is-awaiting-review'");
    expect(aiInspectorSource).toContain(
      "data-composer-mode={compactReviewComposer ? 'follow-up' : 'full'}",
    );
    expect(css).toMatch(
      /Agent rail state contract[\s\S]*?\.ns-ai-v3-composer \{[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/,
    );
    expect(css).toMatch(
      /\.ns-ai-v3-shell\.is-awaiting-review \.ns-ai-v3-context-note[\s\S]*?display: none;/,
    );
    expect(css).toMatch(
      /\.ns-ai-v3-shell \.ns-proposal-actions[\s\S]*?bottom: 0;[\s\S]*?position: sticky;/,
    );
    expect(css).toMatch(
      /\.ns-ai-v3-composer\.is-review-compact \.ns-prompt-textarea[\s\S]*?height: 50px;[\s\S]*?min-height: 50px;/,
    );
    expect(css).toMatch(
      /\.ns-ai-v3-composer\.is-review-compact\s+\.ns-prompt-tools\s+:is\([\s\S]*?\.ns-ai-tool-button[\s\S]*?display: none;/,
    );
    expect(css).toMatch(
      /\.ns-ai-v3-composer\.is-review-compact \.ns-prompt-tools[\s\S]*?display: contents;/,
    );
    expect(css).toMatch(
      /\.ns-ai-v3-composer\.is-review-compact \.ns-ai-session-consent[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 2;/,
    );
    expect(studioSource).toContain(
      "previewedPatch && (inspectorCollapsed || activeInspectorTab !== 'ai')",
    );
  });

  it('keeps expanded agent controls in document flow instead of covering the composer', () => {
    const stateContract = css.slice(css.indexOf('/* Agent rail state contract.'));

    expect(stateContract).toMatch(
      /\.ns-ai-v3-controls-disclosure \{[\s\S]*?overflow: hidden;[\s\S]*?position: static;/,
    );
    expect(stateContract).toMatch(
      /\.ns-ai-v3-controls-disclosure\[open\] > \.ns-ai-v3-controls-body \{[\s\S]*?max-height: min\(44vh, 420px\);[\s\S]*?position: static;/,
    );
    expect(stateContract).not.toMatch(
      /\.ns-ai-v3-controls-disclosure\[open\][^{]*\{[^}]*position: absolute;/,
    );
  });

  it('keeps readable canvas and inspector navigation after the global reset', () => {
    expect(css).toMatch(
      /Runtime visual-system boundary[\s\S]*?\.ns-editor-mode-controls button[\s\S]*?min-height: 28px;[\s\S]*?padding: 5px 10px;/,
    );
    expect(css).toMatch(
      /\.nodeslide-studio \.ns-inspector-nav[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/,
    );
    expect(css).toMatch(
      /\.nodeslide-studio \.ns-inspector-tabs button,[\s\S]*?\.ns-inspector-more-trigger[\s\S]*?min-height: 39px;/,
    );
  });

  it('contains narrow inspector rails without horizontal drift', () => {
    expect(css).toMatch(
      /\.nodeslide-studio \.ns-inspector[\s\S]*?container-name: nodeslide-inspector;[\s\S]*?container-type: inline-size;[\s\S]*?overflow: clip;/,
    );
    expect(css).toMatch(
      /:is\(\.ns-ai-v3-review-scroll, \.ns-ai-v3-composer, \.ns-ai-v3-controls-body\)[\s\S]*?overflow-x: hidden;[\s\S]*?overscroll-behavior-x: none;/,
    );

    const narrowRail = containerBlock('@container nodeslide-inspector (max-width: 380px)');
    expect(narrowRail).toMatch(
      /\.ns-scope-row \.ns-chip-group[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*?width: 100%;/,
    );
    expect(narrowRail).toMatch(
      /\.ns-ai-policy-grid[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    );
  });

  it('keeps the trace receipt surface and dark honesty states readable', () => {
    expect(css).toMatch(
      /\.nodeslide-studio \.ns-trace-summary[\s\S]*?border-radius: 12px;[\s\S]*?padding: 0;/,
    );
    expect(css).toMatch(
      /\.ns-trace-attrib > span:last-child[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
    );
    expect(css).toMatch(
      /\[data-ns-theme="dark"\] \.ns-trace-inspector[\s\S]*?--ns-trace-warning: #f6ad55;/,
    );
    expect(contrast('#a5b4fc', '#14181d')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#f0a080', '#14181d')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#34d399', '#14181d')).toBeGreaterThanOrEqual(4.5);
    expect(baseCss).toMatch(
      /\.nodeslide-studio\[data-ns-theme="dark"\][\s\S]*?--ns-positive: #34d399;/,
    );
    expect(contrast('#f6ad55', '#14181d')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#fb7185', '#14181d')).toBeGreaterThanOrEqual(4.5);
  });
});

function mediaBlock(start: string, end: string) {
  const startIndex = css.indexOf(start);
  const endIndex = css.indexOf(end, startIndex + start.length);

  expect(startIndex, `Missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `Missing ${end} after ${start}`).toBeGreaterThan(startIndex);
  return css.slice(startIndex, endIndex);
}

function containerBlock(start: string) {
  const startIndex = css.indexOf(start);
  expect(startIndex, `Missing ${start}`).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = css.indexOf('{', startIndex); index < css.length; index += 1) {
    const character = css[index];
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return css.slice(startIndex, index + 1);
  }

  throw new Error(`Unclosed ${start}`);
}

function contrast(foreground: string, background: string) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string) {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Invalid color: ${hex}`);
  }
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
