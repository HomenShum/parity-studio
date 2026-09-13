/**
 * Record the NodeSlide walkthrough against live production.
 *
 * This exists because the reply to AI Fund offers a video instead of a call. A call can be talked
 * through; a video cannot. So the video is driven through the deployed application at
 * https://nodeslide.vercel.app, not through a local build and not through a mock, and every beat
 * asserts the text it claims to show before it moves on. When an assertion fails the beat is marked
 * missed in the report rather than quietly filmed as if it had worked.
 *
 * The pattern follows scripts/capture-ui.mjs, which already drives a real Chromium through
 * Playwright in this repo. The difference is recordVideo, and that the run is a sequence rather
 * than a single frame.
 *
 * Usage:
 *   node tools/brain/record-walkthrough.mjs [--out <dir>] [--url <base>] [--headed]
 *
 * Two facts about the live deck shape this script, and both were measured before it was written:
 *   1. Every visit seeds a fresh golden deck, so element ids differ per session. Nothing here
 *      hardcodes an element id. Ids are read from the page at the moment they are needed, and the
 *      report records the ones that were actually filmed.
 *   2. The canvas element and its navigator thumbnail share a data-testid, so canvas clicks are
 *      scoped to [data-testid="slide-canvas"] to avoid a strict mode violation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const BASE = String(flag('url', 'https://nodeslide.vercel.app'));
const OUT_DIR = String(flag('out', path.resolve('outputs/walkthrough')));
const HEADED = Boolean(flag('headed', false));
const WIDTH = 1440;
const HEIGHT = 900;

// The commit the deployed page should name, and the commit that fixed the agent route. Both are
// checked against the live page and against GitHub during beat 9 rather than asserted here.
const EXPECTED_SHA = 'a836c6a29e026bb219b959bdf3e2dc9e9f407c77';
const FIX_COMMIT = '15d2686';
// GitHub anchors a file diff by the sha256 of its path. This is convex/lib/nodeslideValidators.ts,
// so the commit page opens on the one added line instead of on a wall of eleven files.
const VALIDATORS_ANCHOR = 'diff-6cdadbf2153547d7ad23bcc8ac79b6bb30bfa026ff9e7c979f307a279e5976b1';

fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const notes = [];
const note = (line) => {
  notes.push(line);
  process.stdout.write(`    ${line}\n`);
};

const browser = await chromium.launch({ headless: !HEADED });
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  acceptDownloads: true,
  recordVideo: { dir: OUT_DIR, size: { width: WIDTH, height: HEIGHT } },
  colorScheme: 'light',
  deviceScaleFactor: 1,
});
context.setDefaultTimeout(30_000);
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});

const wait = (ms) => page.waitForTimeout(ms);
const inspectorText = () =>
  page.evaluate(() => document.querySelector('[data-testid="inspector"]')?.innerText ?? '');
const bodyText = () => page.evaluate(() => document.body?.innerText ?? '');

/**
 * The JSON tab renders its record into a <textarea>, and a textarea's content is its value, not its
 * text. Reading innerText here returns an empty string and would report a working panel as absent,
 * which is how the first run of this script wrongly marked beat 1 a miss. Read the value.
 */
const jsonBoxText = () =>
  page
    .locator('[data-testid="inspector"] textarea')
    .first()
    .inputValue()
    .catch(() => '');

/**
 * Each beat is given the screen time its claim needs to be read. The work inside a beat rarely
 * fills that, so the beat holds on its finished state until the budget is spent. Without this the
 * run came in at 149s against 213s of specified pacing, which reads as a flick-through.
 */
const BUDGET_SECONDS = { 1: 28, 2: 18, 3: 30, 4: 20, 5: 22, 6: 20, 7: 25, 8: 20, 9: 30 };
let beatStartedAt = Date.now();
const startBeat = () => {
  beatStartedAt = Date.now();
};
async function holdBeat(beat) {
  const spent = (Date.now() - beatStartedAt) / 1000;
  const remaining = (BUDGET_SECONDS[beat] ?? 20) - spent;
  if (remaining > 0.4) await wait(Math.round(remaining * 1000));
}

/**
 * A caption layer, not product UI. It is appended to <body> outside the React root, marked
 * pointer-events:none so it can never absorb a click the script means for the application, and
 * anchored bottom-left over the notes strip so it does not sit on top of the inspector.
 */
async function caption(index, total, title, claim) {
  await page
    .evaluate(
      ({ index, total, title, claim }) => {
        let el = document.getElementById('nsw-caption');
        if (!el) {
          const style = document.createElement('style');
          style.textContent = `
            #nsw-caption{position:fixed;left:18px;bottom:18px;z-index:2147483647;pointer-events:none;
              max-width:620px;background:rgba(14,13,12,.93);color:#F7F4ED;border-radius:12px;
              padding:12px 16px 13px;box-shadow:0 10px 30px rgba(0,0,0,.35);
              font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;}
            #nsw-caption .k{font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:10px;
              letter-spacing:.14em;text-transform:uppercase;color:#C9A38C;margin-bottom:4px;}
            #nsw-caption .t{font-size:17px;font-weight:600;line-height:1.25;margin-bottom:4px;}
            #nsw-caption .c{font-size:13px;line-height:1.45;color:#D8D2C8;}
          `;
          document.head.appendChild(style);
          el = document.createElement('div');
          el.id = 'nsw-caption';
          document.body.appendChild(el);
        }
        el.innerHTML =
          `<div class="k">Beat ${index} of ${total}</div>` +
          `<div class="t"></div><div class="c"></div>`;
        el.querySelector('.t').textContent = title;
        el.querySelector('.c').textContent = claim;
      },
      { index, total, title, claim },
    )
    .catch(() => {});
}

/** Scroll a node into the middle of the inspector so the claimed text is not clipped at an edge. */
async function centreInInspector(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await wait(400);
}

/** Nudge a scrollable region a little at a time, so a reader can follow it. */
async function creep(selector, steps = 4, delta = 120, pause = 700) {
  for (let i = 0; i < steps; i += 1) {
    await page
      .evaluate(
        ({ selector, delta }) => {
          const node = document.querySelector(selector);
          if (node) node.scrollTop += delta;
        },
        { selector, delta },
      )
      .catch(() => {});
    await wait(pause);
  }
}

/**
 * Record whether the beat actually showed what it claims. `must` are strings that have to be on
 * screen; anything missing makes the beat a miss, and the miss is reported rather than hidden.
 */
async function verify(beat, must, haystack) {
  const text = haystack ?? (await bodyText());
  const missing = must.filter((needle) =>
    needle instanceof RegExp ? !needle.test(text) : !text.includes(needle),
  );
  const ok = missing.length === 0;
  results.push({ beat, ok, missing: missing.map(String) });
  process.stdout.write(
    ok
      ? `  [ok]     beat ${beat}\n`
      : `  [MISSED] beat ${beat} — not on screen: ${missing.map(String).join(' | ')}\n`,
  );
  return ok;
}

const startedAt = Date.now();
let filmedHeadlineId = null;
let filmedOps = [];
let deckJsonPath = null;

try {
  // ---------------------------------------------------------------- beat 1
  process.stdout.write('recording against ' + BASE + '\n');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await wait(2500);

  await caption(
    1,
    9,
    'The headline is a record',
    'A slide element is addressable typed data carrying an id, normalised geometry, export capabilities and bound sources. It is not pixels.',
  );
  await wait(2000);

  await page.getByText('Explore the editable sample workspace', { exact: false }).first().click();
  await wait(9000);
  // The workspace load is not part of the beat's reading time, so the clock starts here.
  startBeat();

  const canvas = page.getByTestId('slide-canvas');
  const headline = canvas.locator('[aria-label*="Headline"]').first();
  await headline.click();
  await wait(1600);
  filmedHeadlineId = await headline.getAttribute('data-element-id');
  note(`headline element filmed: ${filmedHeadlineId}`);

  await page.locator('[data-testid="inspector-tab-json"]').click();
  await wait(1400);
  await page.getByRole('tab', { name: 'Selection', exact: true }).click();
  await wait(2200);

  // The record opens on bbox. Walk it down so id, exportCapabilities, sourceIds and version are
  // all seen, rather than claiming them from the first screenful.
  await creep('[data-testid="inspector"] textarea', 5, 90, 1100);
  await wait(1200);
  // Walking down proves the record is longer than one screen, but the fields the claim rests on
  // (bbox, exportCapabilities, sourceIds) sit near the top, so the beat holds there rather than on
  // the tail it happened to stop at.
  await page
    .evaluate(() => {
      const box = document.querySelector('[data-testid="inspector"] textarea');
      if (box) box.scrollTop = 0;
    })
    .catch(() => {});
  await wait(1500);

  const selectionRecord = await jsonBoxText();
  note(
    `selection record fields: ${
      ['id', 'bbox', 'exportCapabilities', 'sourceIds', 'version']
        .filter((k) => selectionRecord.includes(`"${k}"`))
        .join(', ') || '(none)'
    }`,
  );
  await verify(
    1,
    ['"bbox"', '"exportCapabilities"', '"sourceIds"', '"version"'],
    `${selectionRecord}\n${await inspectorText()}`,
  );
  await holdBeat(1);

  // ---------------------------------------------------------------- beat 2
  await caption(
    2,
    9,
    'The whole deck downloads as its schema',
    'One canonical DeckSpec is the source of truth, the rendered slide is derived from it, and it leaves with the user.',
  );
  startBeat();
  await page.getByRole('tab', { name: 'Deck', exact: true }).click();
  await wait(2200);
  await creep('[data-testid="inspector"] textarea', 3, 110, 1000);
  await wait(1000);

  const deckRecord = await jsonBoxText();
  const deckOk = await verify(
    2,
    ['DECK AS CODE', 'nodeslide.slidelang/v1', 'Download deck.json', '"slideOrder"', '"theme"'],
    `${deckRecord}\n${await inspectorText()}`,
  );
  if (deckOk) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.getByRole('button', { name: 'Download deck.json' }).click(),
      ]);
      deckJsonPath = path.join(OUT_DIR, 'deck.json');
      await download.saveAs(deckJsonPath);
      note(`deck.json saved: ${deckJsonPath} (${fs.statSync(deckJsonPath).size} bytes)`);
    } catch (error) {
      note(`download did not complete: ${error.message.split('\n')[0]}`);
    }
  }
  await holdBeat(2);

  // ---------------------------------------------------------------- beat 3
  await caption(
    3,
    9,
    'An agent edit is a bounded patch',
    'The agent returns scoped operations on named elements, and the slide does not change while those operations are being read.',
  );
  await page.locator('[data-testid="inspector-tab-ai"]').click();
  await wait(2000);
  await page.locator('[data-testid="ai-generate-directions"]').click();

  const genStart = Date.now();
  for (let i = 0; i < 40; i += 1) {
    await wait(3000);
    if ((await page.locator('[data-testid="variation-card"]').count()) > 0) break;
  }
  // Generation is real latency and is left in the recording, but it is not reading time. The beat's
  // clock starts when there is something to read, so a slow run cannot eat the beat.
  startBeat();
  await wait(2500);
  const cardCount = await page.locator('[data-testid="variation-card"]').count();
  note(`directions returned: ${cardCount} in ${Math.round((Date.now() - genStart) / 1000)}s`);

  const reviewToggle = page.getByText(/Review \d+ bounded changes?/).first();
  await centreInInspector(reviewToggle);
  await reviewToggle.click();
  await wait(2400);

  const aiText = await inspectorText();
  filmedOps = (aiText.match(/Update [^\n]*\n?\s*element_[0-9a-f]+/g) ?? []).map((s) =>
    s.replace(/\s+/g, ' ').trim(),
  );
  note(`operations filmed: ${filmedOps.join(' ; ') || '(none parsed)'}`);
  const opsTargetHeadline = filmedHeadlineId ? aiText.includes(filmedHeadlineId) : false;
  note(
    opsTargetHeadline
      ? `operations name the element opened in beat 1 (${filmedHeadlineId})`
      : `operations do NOT name the beat 1 element (${filmedHeadlineId}); the run scoped elsewhere`,
  );

  await verify(
    3,
    [
      'Ready to review',
      'based on v1',
      'Validation clean',
      'Your slide stays unchanged until Accept',
      /Update .*element_/,
    ],
    aiText,
  );
  await holdBeat(3);

  // ---------------------------------------------------------------- beat 4
  await caption(
    4,
    9,
    'The same run says the model degraded',
    'When the external model cannot supply a direction, the product labels the substitute and gives a per-branch reason rather than passing it off as the model’s work.',
  );
  startBeat();
  // Same run, no reload. Scroll the review column back to the banner that sits above the cards.
  await page
    .evaluate(() => {
      const node = document.querySelector('[data-testid="ai-review-scroll"]');
      if (node) node.scrollTop = 0;
    })
    .catch(() => {});
  await wait(2600);

  const degradedText = await inspectorText();
  const reasons = [...new Set(degradedText.match(/Fallback reason: [^\n]+/g) ?? [])];
  note(`fallback reasons on screen: ${reasons.join(' | ') || '(none)'}`);
  await verify(
    4,
    ['could not safely supply every direction', 'Deterministic fallback', /Fallback reason: /],
    degradedText,
  );
  await creep('[data-testid="ai-review-scroll"]', 3, 130, 1000);
  await holdBeat(4);

  // ---------------------------------------------------------------- beat 5
  await caption(
    5,
    9,
    'Review is a diff',
    'A proposal is inspected against the baseline before anything is written to the deck.',
  );
  startBeat();
  await page
    .evaluate(() => {
      const node = document.querySelector('[data-testid="ai-review-scroll"]');
      if (node) node.scrollTop = 0;
    })
    .catch(() => {});
  await wait(600);
  await page.locator('[data-testid="variation-preview"]').first().click();
  await wait(3500);

  const compareText = await bodyText();
  await verify(
    5,
    [
      'Compare',
      'Side by side',
      'Slider',
      'Overlay',
      'Blink',
      'Baseline',
      'pending review',
      /update style/,
    ],
    compareText,
  );
  await holdBeat(5);

  // ---------------------------------------------------------------- beat 6
  await caption(
    6,
    9,
    'Accept writes a version that restores',
    'Acceptance is a recorded version with the agent named as its author, and the prior state stays reachable.',
  );
  startBeat();
  await wait(1500);
  await page.locator('[data-testid="variation-accept"]').first().click();
  await wait(5000);

  await page.locator('[data-testid="inspector-tab-versions"]').click();
  await wait(2600);
  const versionsText = await inspectorText();
  await verify(6, [/v2/, 'Agent', 'Initial deck', 'System', 'Restore', 'Compare'], versionsText);
  await creep('[data-testid="inspector"] .ns-inspector-scroll', 2, 120, 1000);
  await holdBeat(6);

  // ---------------------------------------------------------------- beat 7
  await caption(
    7,
    9,
    'Sources bind to elements, and the limit is printed',
    'Citations attach to named elements rather than to a slide as a whole, and the product states in its own UI what it does not check.',
  );
  startBeat();
  await page.locator('[data-testid="inspector-tab-data"]').click();
  await wait(2600);

  const firstCiting = page.locator('[data-testid="evidence-citing-list"]').first();
  await centreInInspector(firstCiting);
  await wait(2200);
  const evidenceText = await inspectorText();
  const citedBy = evidenceText.match(/Cited by \d+ elements/g) ?? [];
  note(`evidence bindings on screen: ${citedBy.join(' | ') || '(none)'}`);
  await verify(
    7,
    [
      'EVIDENCE LAYER',
      'Data & sources',
      'it does not independently verify facts',
      /Cited by \d+ elements/,
    ],
    evidenceText,
  );
  await creep('[data-testid="inspector"] .ns-inspector-scroll', 3, 140, 1000);
  await holdBeat(7);

  // ---------------------------------------------------------------- beat 8
  await caption(
    8,
    9,
    'The trace refuses to invent telemetry',
    'Run receipts report only what was observed, and they report absence as absence.',
  );
  startBeat();
  await page.locator('[data-testid="inspector-tab-trace"]').click();
  await wait(2800);
  const traceText = await inspectorText();
  await verify(
    8,
    [
      'not recorded',
      'No external provider billing was recorded',
      'Structured timeline unavailable',
      'do not invent span timing',
      'unsealed',
      'Provisional seal',
    ],
    traceText,
  );
  await creep('[data-testid="inspector"] .ns-inspector-scroll', 4, 130, 1000);
  await holdBeat(8);

  // ---------------------------------------------------------------- beat 9
  await caption(
    9,
    9,
    'The deployed page names its commit',
    'The application just filmed is the repository at one specific commit, and that commit’s history contains the fix that made this agent route run at all.',
  );
  const beat9 = () =>
    caption(
      9,
      9,
      'The deployed page names its commit',
      'The application just filmed is the repository at one specific commit, and that commit’s history contains the fix that made this agent route run at all.',
    );
  startBeat();
  await wait(2000);

  // The page states its own build. view-source is used rather than a rendered claim, so the meta
  // tag is read from the bytes the server sent.
  await page.goto(`view-source:${BASE}/`, { timeout: 45_000 });
  await wait(2500);
  await beat9();
  const sourceHasSha = await page.evaluate(
    (sha) => document.body.innerText.includes(sha),
    EXPECTED_SHA,
  );
  // Chromium's find selects and scrolls to the match, which puts the meta tag on screen.
  await page.evaluate((sha) => window.find && window.find(sha), EXPECTED_SHA).catch(() => {});
  await wait(3500);
  note(`view-source carries ${EXPECTED_SHA}: ${sourceHasSha}`);

  await page.goto('https://github.com/HomenShum/NodeSlide/commits/main', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await wait(4000);
  await beat9();
  await wait(1000);
  const ghHead = await page.evaluate(() => document.body.innerText);
  const ghMatchesDeploy = ghHead.includes(EXPECTED_SHA.slice(0, 7));
  note(`github main HEAD shows ${EXPECTED_SHA.slice(0, 7)}: ${ghMatchesDeploy}`);
  await wait(3000);

  await page.goto(
    `https://github.com/HomenShum/NodeSlide/commit/${FIX_COMMIT}#${VALIDATORS_ANCHOR}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 },
  );
  await wait(5500);
  await beat9();
  await wait(1000);
  const commitText = await bodyText();
  await verify(
    9,
    ['nodeslideValidators.ts', 'nodeslideAgentModelValidator', 'moonshotai/kimi-k3'],
    `${commitText}\n${sourceHasSha ? EXPECTED_SHA : ''}${ghMatchesDeploy ? EXPECTED_SHA.slice(0, 7) : ''}`,
  );
  if (!sourceHasSha || !ghMatchesDeploy) {
    note('beat 9 partial: the build sha could not be shown on both surfaces');
  }
  await holdBeat(9);
} catch (error) {
  process.stderr.write(`run aborted: ${error.message}\n`);
  results.push({ beat: 'run', ok: false, missing: [error.message.split('\n')[0]] });
  process.exitCode = 1;
} finally {
  const wallSeconds = Math.round((Date.now() - startedAt) / 1000);
  const video = page.video();
  const tempPath = video ? await video.path() : null;
  await context.close(); // the webm is only flushed on close
  await browser.close();

  let finalPath = null;
  let bytes = 0;
  if (tempPath && fs.existsSync(tempPath)) {
    finalPath = path.join(OUT_DIR, 'nodeslide-walkthrough.webm');
    if (fs.existsSync(finalPath)) fs.rmSync(finalPath);
    fs.renameSync(tempPath, finalPath);
    bytes = fs.statSync(finalPath).size;
  }

  const missed = results.filter((r) => !r.ok);
  const report = {
    recordedAt: new Date().toISOString(),
    target: BASE,
    video: finalPath,
    bytes,
    megabytes: bytes ? Number((bytes / 1024 / 1024).toFixed(2)) : 0,
    wallSeconds,
    viewport: `${WIDTH}x${HEIGHT}`,
    beats: results,
    missedBeats: missed.map((m) => m.beat),
    filmedHeadlineId,
    filmedOps,
    deckJsonPath,
    notes,
    consoleErrors: consoleErrors.slice(0, 5),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'walkthrough-report.json'), JSON.stringify(report, null, 2));

  process.stdout.write(
    `\nvideo    ${finalPath ?? '(none written)'}\n` +
      `size     ${bytes} bytes (${report.megabytes} MB)\n` +
      `duration ${wallSeconds}s of recorded wall clock\n` +
      `beats    ${results.filter((r) => r.ok).length}/${results.length} verified on screen\n` +
      (missed.length ? `missed   ${missed.map((m) => m.beat).join(', ')}\n` : '') +
      `report   ${path.join(OUT_DIR, 'walkthrough-report.json')}\n`,
  );
}
