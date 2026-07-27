/**
 * Capture the nine states the NodeKit frontend contract requires, from the deployed product.
 *
 * This is the honest half of `nodekit frontend benchmark`. The benchmark needs a render receipt, an
 * independent review receipt, and `criticIndependent: true` — a schema constant, so the artifact
 * cannot exist unless the critic really was independent. An agent that prompts its own reviewer,
 * on its own model, in its own session, cannot assert that. So the benchmark is not produced here.
 *
 * What can be produced honestly is the render half: drive a real browser to each required state and
 * record which were reached. A state that cannot be reached is the finding — a surface is not
 * designed until its failure states are, and `conflict` and `failed_safe` are the two that get
 * skipped precisely because nothing forces them to be visited.
 *
 * Every state is either REACHED with a screenshot, or NOT REACHED with the reason. There is no
 * third outcome and no way to record a state as covered without a file behind it.
 *
 * Usage: node tools/brain/capture-required-states.mjs [--url <base>] [--out <dir>]
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const BASE = flag('url', 'https://nodeslide.vercel.app');
const OUT = path.resolve(flag('out', 'outputs/required-states'));

/**
 * The nine states, each with how to reach it. `reach` returns true when the state is genuinely on
 * screen. Returning true without checking is the only way this script can lie, so each one asserts
 * something specific to that state rather than merely that the page loaded.
 */
const STATES = [
  {
    id: 'first_arrival',
    viewport: { width: 1440, height: 900 },
    async reach(page) {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
      await page
        .getByText('Explore the editable sample workspace')
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(8000);
      return page.locator('[data-testid="inspector-tab-ai"]').isVisible();
    },
  },
  {
    id: 'loading',
    viewport: { width: 1440, height: 900 },
    async reach(page) {
      // Caught mid-flight: click the direction generator and look for the busy label before it
      // settles. If it has already finished, the state was real but not captured — say so.
      await page.locator('[data-testid="inspector-tab-ai"]').click();
      await page.waitForTimeout(900);
      await page.getByText('Generate 3 directions', { exact: false }).first().click();
      for (let i = 0; i < 20; i += 1) {
        if (
          await page
            .getByText(/Generating/i)
            .first()
            .isVisible()
            .catch(() => false)
        )
          return true;
        await page.waitForTimeout(400);
      }
      return false;
    },
  },
  {
    id: 'populated',
    viewport: { width: 1440, height: 900 },
    async reach(page) {
      await page.locator('[data-testid="inspector-tab-data"]').click();
      await page.waitForTimeout(2000);
      return page
        .getByText(/Data & sources|EVIDENCE LAYER/i)
        .first()
        .isVisible();
    },
  },
  {
    id: 'exception',
    viewport: { width: 1440, height: 900 },
    async reach(page) {
      // A claim with nothing bound to it.
      //
      // The first version asserted getByText(/unsourced/i). nodeslide #72 renders the word
      // "Unsourced" as a chip LABEL, unconditionally, so that assertion was true on every deck
      // forever — including a deck where the state is impossible. It filed a screenshot reading
      // "Unsourced 0", a picture of the state's absence, as proof the state was reached. A sensor
      // that cannot read zero is welded open.
      //
      // Assert on an actual unsourced ELEMENT instead. The count testid would still be present at
      // zero; only the per-element testid requires the state to genuinely exist.
      await page.locator('[data-testid="inspector-tab-data"]').click();
      await page.waitForTimeout(1500);
      const unsourced = page.locator('[data-testid="evidence-unsourced-element"]');
      return (await unsourced.count()) > 0 && unsourced.first().isVisible();
    },
  },
  {
    id: 'proposal',
    viewport: { width: 1440, height: 900 },
    async reach(page) {
      await page.locator('[data-testid="inspector-tab-ai"]').click();
      await page.waitForTimeout(1200);
      for (let i = 0; i < 30; i += 1) {
        if (
          await page
            .getByRole('button', { name: /Accept/i })
            .first()
            .isVisible()
            .catch(() => false)
        )
          return true;
        await page.waitForTimeout(2000);
      }
      return false;
    },
  },
  {
    id: 'conflict',
    viewport: { width: 1440, height: 900 },
    async reach(page) {
      // A proposal whose base version has moved. Reaching this needs two writers racing, which a
      // single browser cannot stage. Recorded as not reached rather than faked.
      await page.waitForTimeout(200);
      return false;
    },
  },
  {
    id: 'failed_safe',
    viewport: { width: 1440, height: 900 },
    async reach(page) {
      // The product does surface this: when the external model cannot supply every direction it
      // labels the deterministic fallback rather than presenting it as a model result.
      //
      // Previously this ran with no navigation of its own, so it inherited whatever the `proposal`
      // state had left on screen. Both states then filed byte-identical screenshots — same sha256
      // — which is the tell: two "different" states cannot look the same. It was scoring the
      // previous state's frame. Assert the fallback label specifically, and let the digest
      // uniqueness check below catch any recurrence.
      await page.locator('[data-testid="inspector-tab-ai"]').click();
      await page.waitForTimeout(1500);
      return page
        .getByText(/deterministic fallback|could not safely supply|Fallback reason/i)
        .first()
        .isVisible()
        .catch(() => false);
    },
  },
  {
    id: 'completed',
    viewport: { width: 1440, height: 900 },
    async reach(page) {
      const accept = page.getByRole('button', { name: /Accept/i }).first();
      if (!(await accept.isVisible().catch(() => false))) return false;
      await accept.click();
      await page.waitForTimeout(6000);
      // The deck version advancing is the proof the change landed.
      return page
        .getByText(/\bv[2-9]\b/)
        .first()
        .isVisible()
        .catch(() => false);
    },
  },
  {
    id: 'mobile',
    viewport: { width: 390, height: 844 },
    async reach(page) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(2500);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      // One surface at a time means no horizontal scroll. A page wider than its viewport has not
      // adopted a mobile topology, it has been squeezed.
      return w <= 400;
    },
  },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const rendered = [];
const missed = [];

for (const state of STATES) {
  let ok = false;
  let reason = '';
  try {
    ok = Boolean(await state.reach(page));
    if (!ok) reason = 'the assertion for this state did not become true';
  } catch (error) {
    ok = false;
    reason = error.message.slice(0, 160);
  }

  if (ok) {
    const file = path.join(OUT, `${state.id}.png`);
    await page.screenshot({ path: file });
    const { readFile } = await import('node:fs/promises');
    const digest = `sha256:${createHash('sha256')
      .update(await readFile(file))
      .digest('hex')}`;
    rendered.push({ stateId: state.id, screenshot: path.relative(process.cwd(), file), digest });
    process.stdout.write(`  REACHED      ${state.id}\n`);
  } else {
    missed.push({ stateId: state.id, reason });
    process.stdout.write(`  NOT REACHED  ${state.id} — ${reason}\n`);
  }
}

await browser.close();

// Two states that file the same bytes are not two states. On the first run `proposal` and
// `failed_safe` both filed sha256:99d14bb2… because the second assertion never navigated and read
// the frame the first had left behind. Coverage said 7/9 while only 6 distinct frames existed.
// A duplicate digest is downgraded to a miss rather than reported, because the alternative is a
// coverage number that counts the same screenshot twice.
const byDigest = new Map();
for (const entry of rendered) {
  const prior = byDigest.get(entry.digest);
  if (prior) {
    missed.push({
      stateId: entry.stateId,
      reason: `filed a screenshot byte-identical to ${prior} (${entry.digest.slice(0, 20)}…), so this state was not distinctly reached`,
    });
  } else {
    byDigest.set(entry.digest, entry.stateId);
  }
}
const distinct = rendered.filter((entry) => byDigest.get(entry.digest) === entry.stateId);
if (distinct.length !== rendered.length) {
  process.stdout.write(
    `\n  ${rendered.length - distinct.length} state(s) demoted: duplicate screenshot digest\n`,
  );
}

const receipt = {
  schemaVersion: 'brain.required-state-capture/v1',
  note: 'The render half of nodekit frontend benchmark. Not a benchmark: that additionally requires an independent review receipt and criticIndependent, which is a schema constant of true and cannot be honestly asserted by the agent that authored the change.',
  target: BASE,
  capturedAt: new Date().toISOString(),
  requiredStateIds: STATES.map((s) => s.id),
  renderedStates: distinct,
  missedStates: missed,
  coverage: `${distinct.length}/${STATES.length}`,
};

await writeFile(path.join(OUT, 'capture-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(
  `\ncoverage ${receipt.coverage} · receipt ${path.join(OUT, 'capture-receipt.json')}\n`,
);
process.exitCode = missed.length > 0 ? 3 : 0;
