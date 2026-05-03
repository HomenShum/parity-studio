// Scene 2 of the demo trilogy: ITERATE on an existing run.
//
// Showcases the post-2026-04-29 features the long end-to-end recorder
// doesn't cover:
//
//   1. Land on an existing populated run (?run=<id>) — left agent rail
//   2. Type a deliberately rough draft prompt
//   3. Click the ✨ enhance button — small-tier rewrites the prompt
//   4. Cycle the tier pill: Balanced → Frontier → Free (settle on Free
//      because that's the cheaper-than-feasible Kilo-style hook)
//   5. Send the chat turn — watch the assistant reply stream
//   6. Switch to preview tab, toggle Comment mode
//   7. Drag a bbox on the rendered artifact, type a comment
//   8. Click "✨ save + auto-fix" — kicks off the advisor-executor
//      (advise → execute → verify → close)
//   9. Watch the left agent rail stream turns in
//
// Run:
//   RUN_ID=<convex_run_id> node scripts/record-scene-iterate.mjs
//
// Optional env:
//   PARITY_STUDIO_URL  default https://parity-studio.vercel.app/
//   PROMPT             default 'soften the radius'
//   COMMENT_TEXT       default 'darker on-surface tokens, please'
//   HEADED             '0' to run headless (default headed for debugging)

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PARITY_STUDIO_URL = process.env.PARITY_STUDIO_URL ?? 'https://parity-studio.vercel.app/';
const RUN_ID = process.env.RUN_ID ?? '';
const PROMPT = process.env.PROMPT ?? 'soften the radius';
const COMMENT_TEXT = process.env.COMMENT_TEXT ?? 'darker on-surface tokens, please';
const HEADED = process.env.HEADED !== '0';

if (!RUN_ID) {
  console.error('error: RUN_ID env required (a populated run with files + a rendered preview).');
  console.error('  → grab one from the dashboard, or run scripts/record-end-to-end.mjs first.');
  process.exit(2);
}

const targetUrl = `${PARITY_STUDIO_URL.replace(/\/$/, '')}/?run=${encodeURIComponent(RUN_ID)}`;

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(repoRoot, 'runs', `recording-iterate-${stamp}`);
  const videoDir = join(outDir, 'video');
  await mkdir(videoDir, { recursive: true });
  console.log(`[iterate] output: ${outDir}`);
  console.log(`[iterate] target: ${targetUrl}`);
  console.log(`[iterate] prompt: "${PROMPT}"`);
  console.log(`[iterate] comment: "${COMMENT_TEXT}"`);

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1680, height: 900 } },
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[browser] ${msg.text()}`);
  });

  try {
    // ── 1. land on the populated run ──────────────────────────────────
    console.log('[iterate] 1 — navigate');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(3_500);

    // ── 2. focus the persistent agent rail ────────────────────────────
    console.log('[iterate] 2 — agent rail visible');
    await page
      .locator('aside[aria-label*="Agent stream" i]')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(1_500);

    // ── 3. type a deliberately-rough draft ────────────────────────────
    console.log('[iterate] 3 — type rough draft');
    const composer = page.getByRole('textbox', { name: /chat with the parity-studio agent/i });
    await composer.click();
    await composer.fill('');
    await composer.type(PROMPT, { delay: 22 });
    await page.waitForTimeout(900);

    // ── 4. ✨ enhance — small-tier rewrites the prompt in place ───────
    console.log('[iterate] 4 — click ✨ enhance');
    const enhance = page.getByRole('button', { name: /enhance draft via the small-tier model/i });
    await enhance.click();

    // The enhance button pulses while running; wait for the textarea to
    // flip to the rewritten prompt (cap at 30s).
    const enhanceStart = Date.now();
    let rewroteAt = 0;
    while (Date.now() - enhanceStart < 30_000) {
      const cur = (await composer.inputValue()).trim();
      if (cur && cur !== PROMPT && cur.length > PROMPT.length + 10) {
        rewroteAt = Date.now();
        console.log(`[iterate]   prompt rewrote after ${rewroteAt - enhanceStart}ms`);
        console.log(`[iterate]   ${cur.slice(0, 120)}${cur.length > 120 ? '…' : ''}`);
        break;
      }
      await page.waitForTimeout(400);
    }
    if (rewroteAt === 0)
      console.log('[iterate]   ✨ did not rewrite within 30s — proceeding anyway');
    await page.waitForTimeout(1_500);

    // ── 5. cycle the tier pill: Balanced → Frontier → Free ────────────
    console.log('[iterate] 5 — cycle tier pill');
    // Pill aria-label is "Tier: <Label>. Click to cycle." — match by prefix.
    const tierPill = page.getByRole('button', { name: /^Tier: /i });
    for (let i = 0; i < 2; i += 1) {
      const before = await tierPill.getAttribute('aria-label');
      await tierPill.click();
      await page.waitForTimeout(900);
      const after = await tierPill.getAttribute('aria-label');
      console.log(`[iterate]   ${before} → ${after}`);
    }
    await page.waitForTimeout(1_200);

    // ── 6. send the chat turn (cmd/ctrl+enter is what the user shortcut
    //      shows, but we click the explicit Send button so the demo
    //      makes the action visible to viewers) ───────────────────────
    console.log('[iterate] 6 — send to agent');
    await page.getByRole('button', { name: /^send to agent$/i }).click();

    // Wait for at least one assistant row to appear in the panel.
    // The panel is the parent <section aria-label="Chat with the parity-studio agent">
    // and assistant rows render with role markers. Cheap heuristic:
    // wait until the rendered chat list mentions "advisor" or "executor"
    // or until 90s elapses.
    const sendStart = Date.now();
    while (Date.now() - sendStart < 90_000) {
      const text =
        (await page
          .locator(
            'aside[aria-label*="Agent stream" i], section[aria-label*="Chat" i], aside[aria-label*="Chat" i]',
          )
          .first()
          .textContent({ timeout: 2_000 })
          .catch(() => '')) ?? '';
      if (/advisor|executor|verify|close|tool|done/i.test(text) && text.length > 200) {
        console.log(
          `[iterate]   assistant reply detected after ${Math.round((Date.now() - sendStart) / 1000)}s`,
        );
        break;
      }
      await page.waitForTimeout(2_000);
    }
    await page.waitForTimeout(3_500);

    // ── 7. switch to preview tab ──────────────────────────────────────
    console.log('[iterate] 7 — preview tab');
    await page
      .getByRole('tab', { name: /^preview$/i })
      .first()
      .click();
    await page.waitForTimeout(2_500);

    // ── 8. toggle Comment mode (top-right pill) ───────────────────────
    console.log('[iterate] 8 — comment mode on');
    const commentToggle = page.getByRole('button', { name: /^comment mode$/i });
    await commentToggle.click();
    await page.waitForTimeout(1_500);

    // ── 9. trigger a pending bubble via postMessage ───────────────────
    //
    // The CommentOverlay component listens for `parity:element-click`
    // postMessage events from the artifact iframe (its helper script
    // posts these on click). Free-form drag-bbox also works in theory
    // but Playwright's viewport coordinates don't always land cleanly
    // inside the overlay's container rect. postMessage is the path the
    // app's own iframe helper uses every day — we just call it directly
    // so the bubble appears deterministically.
    console.log('[iterate] 9 — trigger pending bubble via postMessage');
    await page.evaluate(() => {
      window.postMessage(
        {
          type: 'parity:element-click',
          rect: { x: 0.22, y: 0.3, w: 0.34, h: 0.18 },
          selector: 'main > section.hero',
          tagName: 'SECTION',
          text: 'hero',
        },
        '*',
      );
    });
    await page.waitForTimeout(1_500);

    // ── 10. type the comment text in the pending bubble ──────────────
    //
    // The pending bubble's textarea placeholder is
    //   "Or write your own — what should change here?"
    // Match a few variants so we don't break on copy tweaks.
    console.log('[iterate] 10 — type comment');
    const commentBox = page
      .locator(
        'textarea[placeholder*="write your own" i], ' +
          'textarea[placeholder*="should change" i], ' +
          'textarea[placeholder*="what\'s wrong" i]',
      )
      .first();
    await commentBox.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    if ((await commentBox.count()) > 0) {
      await commentBox.click();
      await commentBox.fill('');
      await commentBox.type(COMMENT_TEXT, { delay: 24 });
    } else {
      console.log('[iterate]   pending bubble textarea not found — typing into focused element');
      await page.keyboard.type(COMMENT_TEXT, { delay: 24 });
    }
    await page.waitForTimeout(900);

    // ── 11. click ✨ save + auto-fix ──────────────────────────────────
    console.log('[iterate] 11 — ✨ save + auto-fix');
    await page.getByRole('button', { name: /save \+ auto-fix/i }).click();
    await page.waitForTimeout(2_000);

    // ── 12. the persistent agent rail streams the auto-fix
    //       — give the advisor-executor 60s to stream a few turns ────
    console.log('[iterate] 12 — watch advisor-executor stream');
    const fixStart = Date.now();
    let lastLen = 0;
    while (Date.now() - fixStart < 75_000) {
      const text =
        (await page
          .locator(
            'aside[aria-label*="Agent stream" i], section[aria-label*="Chat" i], aside[aria-label*="Chat" i]',
          )
          .first()
          .textContent({ timeout: 2_000 })
          .catch(() => '')) ?? '';
      if (text.length > lastLen + 100) {
        lastLen = text.length;
        console.log(
          `[iterate]   chat grew to ${text.length} chars at ${Math.round((Date.now() - fixStart) / 1000)}s`,
        );
      }
      // stop early once we see the executor verify/close stage
      if (/verified|verify|complete|close/i.test(text.slice(-1500)) && text.length > 800) {
        await page.waitForTimeout(4_000);
        break;
      }
      await page.waitForTimeout(3_000);
    }
    console.log(
      `[iterate] auto-fix loop captured after ${Math.round((Date.now() - fixStart) / 1000)}s`,
    );

    await page.waitForTimeout(2_500);
  } catch (err) {
    console.error('[iterate] error:', err);
  } finally {
    await context.close();
    await browser.close();
  }

  // ── ship the recording ───────────────────────────────────────────────
  const videos = (await readdir(videoDir)).filter((f) => f.endsWith('.webm'));
  if (videos.length === 0) {
    console.log('[iterate] no video file found');
    return;
  }
  const webmPath = join(videoDir, videos[0]);
  const renamedWebm = join(outDir, 'recording.webm');
  await copyFile(webmPath, renamedWebm);
  console.log(`[iterate] webm: ${renamedWebm}`);

  const mp4Path = join(outDir, 'recording.mp4');
  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-i', renamedWebm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', mp4Path],
    { stdio: 'inherit' },
  );
  if (ff.status === 0) {
    console.log(`[iterate] mp4: ${mp4Path}`);
  } else {
    console.log('[iterate] ffmpeg unavailable; webm is canonical');
  }
}

main().catch((err) => {
  console.error('[iterate] fatal:', err);
  process.exit(1);
});
