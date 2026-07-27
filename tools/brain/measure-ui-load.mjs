/**
 * Count what the interface asks of a person at each step of the journey.
 *
 * "The Design tab is confusing, too much to read, too technical" was owner feedback given as a
 * judgement. This turns it into a number, because a judgement cannot be tracked and a count can.
 *
 * Three measures per step, chosen because they fail in different directions:
 *   controls   — every focusable affordance. The count a person must triage before acting.
 *   words      — visible text. Prose in persistent chrome is read once and occupies space forever.
 *   typeSizes  — distinct computed font sizes. The design contract caps the inspector at four;
 *                more than that is hierarchy asserted by shrinking rather than by colour.
 *
 * Counting controls alone would reward hiding things behind a menu, which moves cost rather than
 * removing it. Counting words alone would reward terse labels nobody understands. Together they are
 * harder to game than either.
 *
 * Usage: node tools/brain/measure-ui-load.mjs [--url <base>] [--out <dir>]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const BASE = flag('url', 'https://nodeslide.vercel.app');
const OUT = path.resolve(flag('out', 'docs/design/evidence/ui-load'));

/**
 * Measured over the whole page, and again over the inspector column where the contract applies.
 *
 * Passed to page.evaluate as a function, not as a source string. The first version built it as a
 * template and revived it with eval, which biome refused and was right to: a probe assembled from
 * a string is a probe nobody can typecheck or lint, in a file whose whole purpose is measurement
 * anyone can trust.
 */
function probe() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const measure = (root) => {
    if (!root) return null;
    const controls = [
      ...root.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(visible);
    const sizes = new Set();
    for (const el of root.querySelectorAll('*')) {
      if (!visible(el)) continue;
      // Only elements that own text decide a type size; a wrapper inherits one it never uses.
      const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (direct) sizes.add(getComputedStyle(el).fontSize);
    }
    const words = (root.innerText || '').trim().split(/\s+/).filter(Boolean).length;
    return {
      controls: controls.length,
      words,
      typeSizes: [...sizes].sort(),
      typeSizeCount: sizes.size,
    };
  };
  return {
    page: measure(document.body),
    inspector: measure(
      document.querySelector('.ns-inspector-scroll') ??
        document.querySelector('[class*="inspector"]'),
    ),
  };
}

const STEPS = [
  {
    id: 'landing',
    what: 'first arrival, before anything is chosen',
    async go(page) {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
      await page.waitForTimeout(1200);
    },
  },
  {
    id: 'workspace',
    what: 'the sample deck open, nothing selected',
    async go(page) {
      await page.getByText('Explore the editable sample workspace').first().click();
      await page.waitForTimeout(8000);
    },
  },
  {
    id: 'inspector-ai',
    what: 'the AI tab, where a change is asked for',
    async go(page) {
      await page.locator('[data-testid="inspector-tab-ai"]').click();
      await page.waitForTimeout(1500);
    },
  },
  {
    id: 'inspector-design',
    what: 'the Design tab — the one called too technical to bother with',
    async go(page) {
      await page.locator('[data-testid="inspector-tab-design"]').click();
      await page.waitForTimeout(1500);
    },
  },
  {
    id: 'inspector-data',
    what: 'the Evidence tab, where a claim is checked',
    async go(page) {
      await page.locator('[data-testid="inspector-tab-data"]').click();
      await page.waitForTimeout(1500);
    },
  },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const steps = [];
for (const step of STEPS) {
  try {
    await step.go(page);
    const m = await page.evaluate(probe);
    await page.screenshot({ path: path.join(OUT, `${step.id}.png`) });
    steps.push({ id: step.id, what: step.what, reached: true, ...m });
    const inspectorLine = m.inspector
      ? `   inspector ${m.inspector.controls} controls · ${m.inspector.words} words · ${m.inspector.typeSizeCount} sizes`
      : '';
    process.stdout.write(
      `  ${step.id.padEnd(18)} page ${String(m.page.controls).padStart(3)} controls · ${String(m.page.words).padStart(4)} words · ${m.page.typeSizeCount} type sizes${inspectorLine}\n`,
    );
  } catch (error) {
    steps.push({
      id: step.id,
      what: step.what,
      reached: false,
      reason: error.message.slice(0, 160),
    });
    process.stdout.write(`  ${step.id.padEnd(18)} NOT REACHED — ${error.message.slice(0, 90)}\n`);
  }
}

await browser.close();

const buildSha =
  (await (await fetch(BASE)).text()).match(/nodeslide-build-sha"\s+content="([a-f0-9]+)"/)?.[1] ??
  'unknown';

await writeFile(
  path.join(OUT, 'ui-load.json'),
  `${JSON.stringify({ schemaVersion: 'brain.ui-load/v1', target: BASE, buildSha, capturedAt: new Date().toISOString(), steps }, null, 2)}\n`,
  'utf8',
);
process.stdout.write(`\nreceipt ${path.join(OUT, 'ui-load.json')} @ ${buildSha.slice(0, 7)}\n`);
process.exitCode = steps.some((s) => !s.reached) ? 3 : 0;
