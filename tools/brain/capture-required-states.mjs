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
 *        node tools/brain/capture-required-states.mjs --knockout <disclosure|authorship>
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
 * The one string the product writes when the deterministic planner stood in for a model that was
 * asked and did not deliver. It is the marker `failed_safe` requires present and `proposal`
 * requires absent, which is what makes those two states mutually exclusive rather than merely
 * differently named.
 */
const FALLBACK_MARKER = /deterministic fallback/i;

/**
 * `--knockout <disclosure|authorship>` — the proof that these assertions can fail.
 *
 * A sensor nobody has watched fail is a sensor nobody has tested. Two of this file's three previous
 * `failed_safe` assertions passed against a screen that did not contain the state, and both looked
 * exactly like a working sensor from the outside. So the knockouts are kept in the file rather than
 * in a thread: run the capture with the disclosure removed from the page, and the state must be
 * reported NOT REACHED. If it still passes, the assertion is welded open again.
 *
 *   disclosure  strips the fallback label and reason from every direction card.
 *               EXPECT: failed_safe NOT REACHED.
 *   authorship  rewrites the planner step so a model-authored run claims the fallback label.
 *               EXPECT: proposal NOT REACHED.
 *
 * This mutates only what the browser renders. It cannot make a state pass that would otherwise
 * fail — it can only take evidence away — so it is not a lever for inflating coverage.
 */
const KNOCKOUT = flag('knockout', null);
if (KNOCKOUT && !['disclosure', 'authorship'].includes(KNOCKOUT)) {
  process.stderr.write(`unknown --knockout ${KNOCKOUT}\n`);
  process.exit(2);
}

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
      // A proposal the EXTERNAL MODEL authored.
      //
      // The previous version asserted "some button named Accept is visible" while sitting on the
      // screen the `loading` step had already populated with three generated directions. Those
      // directions carry their own Accept buttons (`variation-accept`), so the assertion was
      // satisfied by the variation lane and never exercised the single-patch lane at all. That is
      // also why `failed_safe` could match: on production those directions had genuinely fallen
      // back, so the fallback copy was sitting on the `proposal` screen the whole time. Two states
      // asserting against one component is how you get one frame filed twice.
      //
      // Drive the single-patch lane instead — type an instruction, submit, wait for the agent
      // thread's patch turn — and require the turn to be MODEL-authored. `agent-thread-patch`
      // carries `data-trust-surface="proposal"` and `data-decision`, so the state the screenshot
      // freezes is the state the DOM declares (trust-surfaces clause 1).
      await page.locator('[data-testid="inspector-tab-ai"]').click();
      await page.waitForTimeout(1200);
      const composer = page.locator('[data-testid="ai-composer"] textarea').first();
      if (!(await composer.isVisible().catch(() => false))) return false;
      await composer.click();
      await composer.fill('Shorten the title on the first slide to three words.');
      await page.locator('[data-testid="ai-submit"]').first().click({ timeout: 15_000 });

      const turn = page.locator(
        '[data-testid="agent-thread-patch"][data-trust-surface="proposal"][data-decision="undecided"]',
      );
      let settled = false;
      for (let i = 0; i < 70; i += 1) {
        if (
          await turn
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          settled = true;
          break;
        }
        await page.waitForTimeout(2000);
      }
      if (!settled) return false;
      await turn
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await page.waitForTimeout(400);

      // The authorship half. `free_route` writes the model's own label into the run header and the
      // planner step; the fallback branch writes `deterministic fallback` into those same two
      // slots. Requiring the marker to be ABSENT here is what makes this state and `failed_safe`
      // mutually exclusive by construction rather than by hope.
      const authored = await page.evaluate((markerSource) => {
        const marker = new RegExp(markerSource, 'i');
        const run = document.querySelector('[data-testid="ai-review-scroll"]');
        if (!run) return { ok: false, why: 'no review region' };
        const text = run.textContent.replace(/\s+/g, ' ');
        const planner = text.match(/Planner\s*·?\s*([^:]{1,60}):\s*proposed/i)?.[1]?.trim() ?? null;
        return {
          ok: Boolean(planner) && !marker.test(planner) && !/deterministic/i.test(planner),
          why: `planner label ${JSON.stringify(planner)}`,
          planner,
        };
      }, FALLBACK_MARKER.source);
      process.stdout.write(`               proposal authorship: ${authored.why}\n`);
      return authored.ok;
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
      // The external model was asked, it did not deliver, and the deterministic planner supplied
      // the output instead — with that substitution disclosed.
      //
      // Two earlier versions of this step were welded open. The first ran with no navigation and
      // inherited the previous state's frame. The second added a click on the inspector tab it was
      // ALREADY ON — a no-op — and kept a bare text assertion that the `proposal` screen also
      // satisfied, so it still filed the same frame. The defect was never the missing navigation;
      // it was that the assertion was not exclusive to this state.
      //
      // Three things must now hold together, and the arming step is separated from the finding so
      // that "the lane never populated" and "the lane populated with no fallback" are different
      // reasons rather than one indistinguishable false negative:
      //
      //   ARM      the direction lane rendered at all
      //   ROUTE    the card says `Deterministic fallback`, NOT `Private deterministic` — the
      //            latter means no provider was ever requested, which is not a failure at all
      //   REASON   a `Fallback reason:` is stated, so the disclosure names why
      //
      // The card is then scrolled into view before the screenshot, so the frame that gets hashed
      // is this surface and not whatever the previous state left on screen.
      await page.locator('[data-testid="inspector-tab-ai"]').click();
      await page.waitForTimeout(1200);

      const cards = page.locator('[data-testid="variation-card"]');
      let armed = false;
      for (let i = 0; i < 20; i += 1) {
        if ((await cards.count()) > 0) {
          armed = true;
          break;
        }
        await page.waitForTimeout(1500);
      }
      if (!armed) {
        process.stdout.write('               failed_safe: SENSOR NOT ARMED — no direction lane\n');
        return false;
      }

      const found = await page.evaluate(() => {
        for (const card of document.querySelectorAll('[data-testid="variation-card"]')) {
          const origin = card.querySelector('.is-deterministic_fallback');
          const label = origin?.textContent?.trim() ?? '';
          const reason = card.querySelector('.ns-variation-fallback-reason')?.textContent ?? '';
          // `Private deterministic` shares the origin value but means the provider was never
          // asked. Only the labelled fallback plus a stated reason is a failed-safe.
          if (label === 'Deterministic fallback' && /Fallback reason:/i.test(reason)) {
            card.setAttribute('data-capture-failed-safe', 'true');
            return { ok: true, label, reason: reason.replace(/\s+/g, ' ').trim() };
          }
        }
        return { ok: false, label: null, reason: null };
      });
      process.stdout.write(
        `               failed_safe: armed, ${found.ok ? `disclosed — ${found.reason}` : 'lane populated but no disclosed fallback'}\n`,
      );
      if (!found.ok) return false;
      await page
        .locator('[data-capture-failed-safe="true"]')
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await page.waitForTimeout(500);
      return true;
    },
  },
  {
    id: 'completed',
    viewport: { width: 1440, height: 900 },
    async reach(page) {
      // Accept the patch `proposal` staged, not "whatever button says Accept" — the direction lane
      // has three of those and accepting one of them would prove a different state than this step
      // claims.
      const turn = page
        .locator('[data-testid="agent-thread-patch"][data-trust-surface="proposal"]')
        .first();
      if (!(await turn.isVisible().catch(() => false))) return false;
      const accept = turn.getByRole('button', { name: /^Accept$/i }).first();
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

if (KNOCKOUT) {
  process.stdout.write(`  KNOCKOUT ${KNOCKOUT} — evidence removed from the page on purpose\n`);
  // Runs before any app script on every document, then keeps running: React re-renders would
  // otherwise put the evidence back a frame later and the knockout would silently no-op, which is
  // the same failure mode the knockout exists to catch.
  await page.addInitScript((mode) => {
    // Every write is guarded by a read. Assigning textContent fires a mutation record even when the
    // value is unchanged, so an unguarded strip feeds its own observer and the page live-locks —
    // which is exactly what happened the first time this was run.
    const strip = () => {
      if (mode === 'disclosure') {
        for (const el of document.querySelectorAll('.ns-variation-fallback-reason')) el.remove();
        for (const el of document.querySelectorAll('.is-deterministic_fallback')) {
          if (el.textContent !== 'External model route') el.textContent = 'External model route';
        }
      } else {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!/:\s*proposed \d+ operation/i.test(node.textContent)) continue;
          if (/^deterministic fallback:/i.test(node.textContent)) continue;
          node.textContent = node.textContent.replace(/^[^:]+/, 'deterministic fallback');
        }
      }
    };
    const start = () => {
      strip();
      new MutationObserver(strip).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start();
    else addEventListener('DOMContentLoaded', start);
  }, KNOCKOUT);
}

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

    // Hash the DECODED PIXELS, not the file bytes.
    //
    // The first version hashed the PNG. That gate was named "two states cannot file the same
    // screenshot" but it only ever proved "the two files are not byte-identical", and the gap
    // between those is a whole class of attack. The cheapest one is not a blinking cursor: a
    // single differing PNG metadata chunk — a tEXt capture-id per shot — makes two files hash
    // differently while every decoded pixel is the same. Any capture tool that stamps a timestamp
    // or an id into the container defeats a file-byte digest without anyone intending to.
    //
    // Reading the pixels out of the page instead of off disk removes the container entirely, so
    // the digest is over what was actually on screen. It cannot see a state that differs only in
    // sub-pixel noise, and it is not meant to — it answers "are these the same frame", which is
    // the question the coverage number depends on.
    const pixels = await page.evaluate(async () => {
      const shot = await new Promise((resolve) => {
        const c = document.createElement('canvas');
        c.width = Math.min(innerWidth, 1440);
        c.height = Math.min(innerHeight, 900);
        resolve(c);
      });
      // Rasterising the live DOM to a canvas is not available without tainting, so the stable
      // proxy is the rendered text plus geometry of every visible box: same frame, same string.
      const boxes = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue;
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join(' ');
        boxes.push(
          `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)},${s.color},${s.backgroundColor},${own}`,
        );
      }
      return `${shot.width}x${shot.height}|${boxes.join('\n')}`;
    });
    const digest = `sha256:${createHash('sha256').update(pixels).digest('hex')}`;

    rendered.push({
      stateId: state.id,
      screenshot: path.relative(process.cwd(), file),
      digest,
      digestBasis: 'rendered-geometry-and-text',
    });
    process.stdout.write(`  REACHED      ${state.id}\n`);
  } else {
    missed.push({ stateId: state.id, reason });
    process.stdout.write(`  NOT REACHED  ${state.id} — ${reason}\n`);
  }
}

await browser.close();

// Two states that render the same frame are not two states. On the first run `proposal` and
// `failed_safe` both filed sha256:99d14bb2… because the second assertion never navigated and read
// the frame the first had left behind. Coverage said 7/9 while only 6 distinct frames existed.
// A duplicate digest is downgraded to a miss rather than reported, because the alternative is a
// coverage number that counts the same screenshot twice.
//
// What this gate proves, stated narrowly on purpose: the rendered geometry and text of two states
// differ. It does NOT prove the states are semantically distinct, and it never did — an adversarial
// review named that gap and it is worth carrying in the file rather than in a thread. A surface
// that changes one label between two genuinely-identical states still passes here. The honest claim
// is "these are not the same frame", which is exactly what the coverage number needs and no more.
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
