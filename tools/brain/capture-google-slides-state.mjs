/**
 * Capture whether NodeSlide's connections surface offers Google Slides sync.
 *
 * The owner decided on 2026-07-27 to keep the two-way Google Slides integration. It is fully built
 * in parity-studio — real calls to slides.googleapis.com/v1/presentations under the narrow
 * drive.file scope, an OAuth runtime, and seven Convex actions bound to the connections dialog —
 * and entirely absent from the repo that ships. The board recorded it as "capability LABELS, not an
 * API", which is the opposite of what the code says.
 *
 * This records the deployed state so the port has a before to be measured against. It asserts on
 * the presence of a Google affordance rather than on a screenshot alone, because a screenshot
 * proves what a page looked like and not what it offered.
 *
 * Usage: node tools/brain/capture-google-slides-state.mjs --label before [--url <base>]
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const BASE = flag('url', 'https://nodeslide.vercel.app');
const LABEL = flag('label', 'state');
const OUT = path.resolve(flag('out', 'docs/design/evidence/google-slides'));

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
await page.getByRole('button', { name: /BYOK \/ Agents/i }).click();
await page.waitForTimeout(1500);

/**
 * Two independent probes. The visible-text one is what a person would see; the second reads the
 * shipped bundle, because an affordance can be built and not rendered — which is exactly how
 * FirstRunDialog stayed "present" while being tree-shaken out of production.
 */
const bodyText = await page.evaluate(() => document.body.innerText);
const offersGoogle = /google slides|google presentation|connect google/i.test(bodyText);

const bundleHasRuntime = await page.evaluate(async () => {
  const sources = [...document.querySelectorAll('script[src]')].map((s) => s.src);
  for (const src of sources) {
    const text = await (await fetch(src)).text();
    if (text.includes('nodeslideGoogleSlidesRuntime')) return true;
  }
  return false;
});

const shot = path.join(OUT, `connections-${LABEL}.png`);
await page.screenshot({ path: shot, fullPage: true });
await browser.close();

const buildSha =
  (await (await fetch(BASE)).text()).match(/nodeslide-build-sha"\s+content="([a-f0-9]+)"/)?.[1] ??
  'unknown';

const receipt = {
  schemaVersion: 'brain.capability-state/v1',
  capability: 'nodeslide.google-slides-sync',
  label: LABEL,
  target: BASE,
  buildSha,
  capturedAt: new Date().toISOString(),
  offersGoogleInVisibleText: offersGoogle,
  bundleReferencesRuntime: bundleHasRuntime,
  screenshot: path.relative(process.cwd(), shot),
  digest: `sha256:${createHash('sha256')
    .update(await readFile(shot))
    .digest('hex')}`,
};

await writeFile(
  path.join(OUT, `connections-${LABEL}.json`),
  `${JSON.stringify(receipt, null, 2)}\n`,
  'utf8',
);

process.stdout.write(
  `${LABEL} @ ${buildSha.slice(0, 7)}\n  visible Google affordance: ${offersGoogle}\n  bundle references runtime: ${bundleHasRuntime}\n  ${shot}\n`,
);
