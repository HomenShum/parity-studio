/**
 * Extract atomic design facts from a shipped surface, for design-dna ReferenceObservation records.
 *
 * The rule this exists to enforce: "clean hierarchy" is unretrievable and unfalsifiable, and every
 * reader decodes it differently. `label and value both 13px, differentiated by colour not size` can
 * be cited by a score, argued with by a person, and re-verified next month.
 *
 * So this emits only measurements, counts, relationships and timings — each with a
 * locatorDescription a stranger could follow to the same element. Nothing here decides whether a
 * value is good; that judgement belongs in a DesignRule, where it carries a confidence and boundary
 * conditions and can be wrong out loud.
 *
 * Licensing: this is pointed at OUR surfaces only. nodeslide-owned carries cache: true, so its facts
 * and its pixels may be stored. Mobbin and Uiverse are remote-inspection-only under the approved
 * source policy, and a screenshot of someone else's app must never land in the corpus.
 *
 * Usage: node tools/brain/extract-design-facts.mjs [--url <base>] [--out <dir>]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const BASE = flag('url', 'https://nodeslide.vercel.app');
const OUT = path.resolve(flag('out', 'docs/design/references/design-dna/observations'));

/**
 * Runs in the page. Returns raw measurements only — no adjectives, no verdicts.
 *
 * Passed as a function rather than a source string so it is linted and typechecked like the rest of
 * the repository; an earlier probe in this directory built itself from a template and had to be
 * revived with eval, which biome refused and was right to.
 */
function collect() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  /** Where an element is, described so a stranger could find it again without a selector. */
  const locate = (el) => {
    const r = el.getBoundingClientRect();
    const col =
      r.left < innerWidth / 3 ? 'left' : r.left > (innerWidth * 2) / 3 ? 'right' : 'centre';
    const row =
      r.top < innerHeight / 3 ? 'upper' : r.top > (innerHeight * 2) / 3 ? 'lower' : 'middle';
    const text = (el.textContent || '').trim().slice(0, 34);
    return `${row} ${col} of the viewport${text ? `, reading "${text}"` : ''}`;
  };

  const facts = [];
  const push = (kind, subject, property, value, unit, el) =>
    facts.push({
      kind,
      subject,
      property,
      value,
      unit,
      locatorDescription: el ? locate(el) : 'the page as a whole',
    });

  // ---- counts -------------------------------------------------------------
  const controls = [
    ...document.querySelectorAll(
      'button, a[href], input, select, textarea, [role="button"], [role="tab"]',
    ),
  ].filter(visible);
  push('count', 'surface', 'interactive-controls', controls.length, 'controls', null);

  const tabs = [...document.querySelectorAll('[data-testid^="inspector-tab-"]')].filter(visible);
  push('count', 'inspector', 'top-level-tabs', tabs.length, 'tabs', tabs[0] ?? null);

  // ---- type scale ---------------------------------------------------------
  const inspector = document.querySelector('.ns-inspector-scroll');
  const scopeSizes = (root) => {
    const sizes = new Map();
    if (!root) return sizes;
    for (const el of root.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const owns = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!owns) continue;
      const px = getComputedStyle(el).fontSize;
      sizes.set(px, (sizes.get(px) ?? 0) + 1);
    }
    return sizes;
  };

  const inspectorSizes = scopeSizes(inspector);
  if (inspector) {
    push('count', 'inspector', 'distinct-font-sizes', inspectorSizes.size, 'sizes', inspector);
    const smallest = [...inspectorSizes.keys()].map(Number.parseFloat).sort((a, b) => a - b)[0];
    if (smallest)
      push('measurement', 'inspector', 'smallest-persistent-text', smallest, 'px', inspector);
  }

  const pageSizes = scopeSizes(document.body);
  const chrome = [...pageSizes.keys()].map(Number.parseFloat).filter((n) => n >= 8);
  push('count', 'page', 'distinct-font-sizes-at-or-above-8px', new Set(chrome).size, 'sizes', null);

  // ---- label/value differentiation ---------------------------------------
  // The relationship that matters: is hierarchy carried by size, or by colour?
  const labels = [...document.querySelectorAll('[class*="label"], dt, .ns-field-label')]
    .filter(visible)
    .slice(0, 6);
  for (const label of labels) {
    const value = label.nextElementSibling;
    if (!value || !visible(value)) continue;
    const a = getComputedStyle(label);
    const b = getComputedStyle(value);
    push(
      'relationship',
      'label-and-value',
      'differentiated-by',
      a.fontSize === b.fontSize
        ? a.color === b.color
          ? 'neither size nor colour'
          : 'colour'
        : 'size',
      null,
      label,
    );
    break;
  }

  // ---- motion tokens ------------------------------------------------------
  const root = getComputedStyle(document.documentElement);
  for (const name of [
    '--duration-fast',
    '--duration-normal',
    '--duration-slow',
    '--ns-duration-fast',
    '--ns-duration-normal',
  ]) {
    const v = root.getPropertyValue(name).trim();
    if (v) push('timing', 'motion-token', name, v, null, null);
  }
  for (const name of ['--ease-out-expo', '--ease-spring', '--ns-ease-out', '--ns-ease-spring']) {
    const v = root.getPropertyValue(name).trim();
    if (v) push('easing', 'motion-token', name, v, null, null);
  }

  // ---- infinite loops, which the motion ladder caps at zero unguarded ------
  let infinite = 0;
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.animationIterationCount.split(',').some((c) => c.trim() === 'infinite')) infinite += 1;
  }
  push('count', 'page', 'elements-with-infinite-animation', infinite, 'elements', null);

  // ---- artifact dominance -------------------------------------------------
  //
  // No `main` fallback, deliberately. The first version ended with `, main` in the selector and
  // every surface reported the artifact at 100 per cent of viewport width — including the landing
  // page, which has no artifact at all. It was measuring the document, not the slide, and the
  // number looked plausible enough to survive review.
  //
  // A fact that silently measures a different element is worse than a missing fact: the missing one
  // is visible as a gap, and the wrong one gets cited by a score. So the selector names the canvas
  // or the fact is not emitted, and its absence is recorded as a reason.
  const canvas = document.querySelector(
    '[class*="slide-canvas"], [class*="slide-stage"], [data-testid*="canvas"]',
  );
  if (canvas && visible(canvas)) {
    const r = canvas.getBoundingClientRect();
    push(
      'measurement',
      'artifact',
      'share-of-viewport-width',
      Math.round((r.width / innerWidth) * 100),
      'percent',
      canvas,
    );
  } else {
    push('count', 'artifact', 'canvas-elements-matching-known-selectors', 0, 'elements', null);
  }

  return facts;
}

const SURFACES = [
  {
    id: 'landing',
    surface: 'first-arrival landing',
    problemTags: ['first-run-orientation', 'route-disclosure-before-egress'],
    intentTags: ['state-a-goal', 'choose-a-model'],
    async reach(page) {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
      await page.waitForTimeout(1200);
    },
  },
  {
    id: 'workspace',
    surface: 'deck open, nothing selected',
    problemTags: ['artifact-dominance', 'three-panel-orientation'],
    intentTags: ['read-the-slide', 'reach-the-agent'],
    async reach(page) {
      await page.getByText('Explore the editable sample workspace').first().click();
      await page.waitForTimeout(8000);
    },
  },
  {
    id: 'inspector-evidence',
    surface: 'evidence tab, claim checking',
    problemTags: ['dense-data-scan', 'claim-to-source-tracing'],
    intentTags: ['check-what-backs-this-number'],
    async reach(page) {
      await page.locator('[data-testid="inspector-tab-data"]').click();
      await page.waitForTimeout(1500);
    },
  },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const today = new Date().toISOString().slice(0, 10);
const written = [];

for (const s of SURFACES) {
  try {
    await s.reach(page);
    const facts = (await page.evaluate(collect)).map((f, i) => ({ id: `f${i + 1}`, ...f }));
    const record = {
      id: `obs-nodeslide-${s.id}-1`,
      source: {
        url: BASE,
        app: 'NodeSlide',
        surface: s.surface,
        capturedVia: 'chrome-live',
        sourcePolicyId: 'nodeslide-owned',
      },
      firstSeenAt: today,
      lastVerifiedAt: today,
      facts,
      problemTags: s.problemTags,
      intentTags: s.intentTags,
      layoutTags: ['three-panel', 'persistent-inspector'],
      interactionTags: ['tab-switching', 'direct-edit'],
    };
    const file = path.join(OUT, `${record.id}.json`);
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    written.push({ id: record.id, facts: facts.length });
    process.stdout.write(`  ${record.id.padEnd(34)} ${facts.length} facts\n`);
  } catch (error) {
    process.stdout.write(`  ${s.id.padEnd(34)} NOT REACHED — ${error.message.slice(0, 70)}\n`);
  }
}

await browser.close();
process.stdout.write(`\n${written.length}/${SURFACES.length} surfaces recorded in ${OUT}\n`);
process.exitCode = written.length === SURFACES.length ? 0 : 3;
