import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./nodeslideV3.css', import.meta.url), 'utf8');
const studioSource = readFileSync(new URL('./NodeSlideStudio.tsx', import.meta.url), 'utf8');
const aiInspectorSource = readFileSync(
  new URL('./inspector/AiInspector.tsx', import.meta.url),
  'utf8',
);

describe('NodeSlide v3 visual contract', () => {
  it('loads the v3 contract after the authoritative editor shell styles', () => {
    expect(studioSource.indexOf("import './nodeslide.css'")).toBeLessThan(
      studioSource.indexOf("import './nodeslideV3.css'"),
    );
  });

  it('locks the supplied desktop geometry', () => {
    const desktop = mediaBlock('@media (min-width: 1100px)', '@media (min-width: 700px)');

    expect(desktop).toContain('--ns-nav-width: 300px !important');
    expect(desktop).toContain('--ns-inspector-width: 340px !important');
    expect(desktop).toMatch(/\.ns-navigator:not\(\.is-collapsed\)[\s\S]*width: 300px/);
    expect(desktop).toMatch(/\.ns-inspector:not\(\.is-collapsed\)[\s\S]*width: 340px !important/);
  });

  it('keeps navigation and inspector reachable as tablet overlays', () => {
    const tablet = mediaBlock(
      '@media (min-width: 700px) and (max-width: 1099px)',
      '@media (min-width: 1100px)',
    );

    expect(tablet).toMatch(/\.ns-navigator[\s\S]*position: absolute[\s\S]*width: 300px/);
    expect(tablet).toMatch(
      /\.ns-inspector:not\(\.is-collapsed\)[\s\S]*position: absolute[\s\S]*width: 420px !important/,
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
    expect(phone).toMatch(/\.ns-inspector:not\(\.is-collapsed\)[\s\S]*position: fixed/);
    expect(phone).toMatch(/\.ns-inspector\.is-collapsed[\s\S]*display: none/);
    expect(phone).toMatch(/\.ns-slide-stepper[\s\S]*display: flex/);
    expect(phone).toMatch(/\.ns-slide-more[\s\S]*display: flex !important/);
    expect(phone).toMatch(/\.ns-navigator-footer[\s\S]*display: flex !important/);
    expect(phone).toMatch(/\.ns-add-slide-button[\s\S]*font-size: 0/);
  });

  it('gives the root landing a single responsive composer instead of editor chrome', () => {
    expect(css).toMatch(
      /\.nodeslide-studio\.ns-landing[\s\S]*?display: flex;[\s\S]*?overflow-y: auto;/,
    );
    expect(css).toMatch(/\.ns-landing-composer[\s\S]*?border-radius: 22px;[\s\S]*?width: 100%;/);
    expect(css).toMatch(
      /@media \(max-width: 699px\)[\s\S]*?\.ns-landing-main[\s\S]*?padding: 48px 15px 30px;/,
    );
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

  it('keeps consequential AI review text above the readable inspector floor', () => {
    expect(css).toContain('--ns-chrome-min-font: 11px');
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
    expect(css).toMatch(
      /\.ns-composer-token-toolbar button[\s\S]*?background: transparent;[\s\S]*?width: auto;/,
    );
  });

  it('makes typing the primary composer action', () => {
    expect(css).toMatch(/\.ns-ai-v3-composer-field[\s\S]*?order: 1;/);
    expect(css).toMatch(/\.ns-ai-v3-suggested-actions[\s\S]*?order: 3;/);
    expect(css).toMatch(/\.ns-composer-field:focus-within[\s\S]*?border-color:[\s\S]*?box-shadow:/);
    expect(css).toMatch(/\.ns-composer-field textarea[\s\S]*?min-height: 92px;/);

    const composerStart = aiInspectorSource.indexOf(
      'className="ns-composer-field ns-ai-v3-composer-field"',
    );
    const consentStart = aiInspectorSource.indexOf(
      'className="ns-ai-inline-consent"',
      composerStart,
    );
    const composerEnd = aiInspectorSource.indexOf('\n        </div>', consentStart);
    expect(composerStart).toBeGreaterThanOrEqual(0);
    expect(consentStart).toBeGreaterThan(composerStart);
    expect(composerEnd).toBeGreaterThan(consentStart);
  });

  it('contains narrow inspector rails without horizontal drift', () => {
    expect(css).toMatch(
      /\.nodeslide-studio \.ns-inspector[\s\S]*?container-name: nodeslide-inspector;[\s\S]*?container-type: inline-size;[\s\S]*?overflow-x: clip;/,
    );
    expect(css).toMatch(
      /:is\(\.ns-ai-v3-review-scroll, \.ns-ai-v3-composer, \.ns-ai-v3-controls-body\)[\s\S]*?overflow-x: hidden;[\s\S]*?overscroll-behavior-x: none;/,
    );

    const narrowRail = containerBlock('@container nodeslide-inspector (max-width: 380px)');
    expect(narrowRail).toMatch(
      /\.ns-ai-provider-controls > label:not\(\.ns-ai-provider-consent\)[\s\S]*?flex: 1 1 100%;[\s\S]*?min-width: 0;[\s\S]*?width: 100%;/,
    );
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
