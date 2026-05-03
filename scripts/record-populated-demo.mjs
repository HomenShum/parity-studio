// Quick populated-walkthrough recording — exercises every UI feature of
// the new Parity Studio shell against a pre-finished run, so we get a
// crisp ~45s demo without waiting on the live pipeline.
//
// Run: node scripts/record-populated-demo.mjs
//
// Env:
//   POPULATED_RUN_ID  the runId to deep-link into (default: known good)
//   PARITY_STUDIO_URL  override target

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PARITY_STUDIO_URL = process.env.PARITY_STUDIO_URL ?? 'https://parity-studio.vercel.app/';
// Known-good finished run with the new 16-row parity rubric backfilled.
const POPULATED_RUN_ID = process.env.POPULATED_RUN_ID ?? 'jh7ads5ptrpvs4hpbareene7ks85qzwj';
const HEADED = process.env.HEADED !== '0';

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(repoRoot, 'runs', `recording-populated-${stamp}`);
  const videoDir = join(outDir, 'video');
  const downloadDir = join(outDir, 'downloads');
  await mkdir(videoDir, { recursive: true });
  await mkdir(downloadDir, { recursive: true });
  console.log(`[demo] output: ${outDir}`);
  console.log(`[demo] target: ${PARITY_STUDIO_URL}?run=${POPULATED_RUN_ID}`);

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1680, height: 900 } },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`[browser] ${m.text()}`);
  });

  try {
    // 1. Boot the populated shell
    console.log('[demo] 1 — load populated shell');
    await page.goto(`${PARITY_STUDIO_URL}?run=${POPULATED_RUN_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    // Wait for parity report to render (16 rows visible)
    await page
      .waitForFunction(
        () => document.querySelectorAll('aside[aria-label="Deterministic parity"] *').length > 30,
        { timeout: 30_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(3_000);

    // 2. Hover over a few parity rows to show interactivity
    console.log('[demo] 2 — explore the parity rubric');
    const rows = page.locator('aside[aria-label="Deterministic parity"] button[aria-expanded]');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      // Click row 6 (Font fidelity, fail) to expand evidence
      const failRow = rows.nth(5);
      await failRow.scrollIntoViewIfNeeded().catch(() => {});
      await failRow.click().catch(() => {});
      await page.waitForTimeout(2_500);
      // Click row 12 (Responsive breakpoints, warn)
      const warnRow = rows.nth(11);
      await warnRow.scrollIntoViewIfNeeded().catch(() => {});
      await warnRow.click().catch(() => {});
      await page.waitForTimeout(2_000);
    }

    // 3. Switch to code tab — Monaco loads
    console.log('[demo] 3 — code tab');
    await page
      .getByRole('tab', { name: /code/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(3_500);

    // 4. Back to Files, click a file in the tree to scope it
    console.log('[demo] 4 — file scope');
    await page
      .getByRole('tab', { name: /^files$/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(1_200);
    const scopeBtn = page.locator('button[title^="Scope next comment"]').first();
    if ((await scopeBtn.count()) > 0) {
      await scopeBtn.click();
      await page.waitForTimeout(1_500);
    }

    // 5. Toggle Comment mode in the top-right cluster
    console.log('[demo] 5 — comment mode toggle');
    const commentBtn = page.getByRole('button', { name: /comment mode/i });
    if ((await commentBtn.count()) > 0) {
      await commentBtn.first().click();
      await page.waitForTimeout(1_500);
    }

    // 6. Switch to preview tab to show the rendered ui_kit
    console.log('[demo] 6 — preview tab');
    await page
      .getByRole('tab', { name: /^preview$/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(3_000);

    // 7. Export ZIP from the top-right pill
    console.log('[demo] 7 — export zip');
    const exportLink = page.getByRole('link', { name: /^export$/i });
    try {
      const dlPromise = page.waitForEvent('download', { timeout: 15_000 });
      await exportLink.first().click();
      const dl = await dlPromise;
      const path = join(downloadDir, dl.suggestedFilename() || 'ui_kit.zip');
      await dl.saveAs(path);
      const sz = (await stat(path)).size;
      console.log(`[demo] zip saved: ${path} (${sz} bytes)`);
    } catch (err) {
      console.log(`[demo] zip download didn't fire: ${err?.message || err}`);
    }

    // 8. Final calm frame
    await page.waitForTimeout(2_000);
  } catch (err) {
    console.error('[demo] error:', err);
  } finally {
    await context.close();
    await browser.close();
  }

  const videos = (await readdir(videoDir)).filter((f) => f.endsWith('.webm'));
  if (videos.length === 0) {
    console.log('[demo] no video file found');
    return;
  }
  const webmPath = join(videoDir, videos[0]);
  const renamedWebm = join(outDir, 'recording.webm');
  await copyFile(webmPath, renamedWebm);
  console.log(`[demo] webm: ${renamedWebm}`);

  const mp4Path = join(outDir, 'recording.mp4');
  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-i', renamedWebm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', mp4Path],
    { stdio: 'inherit' },
  );
  if (ff.status === 0) {
    console.log(`[demo] mp4: ${mp4Path}`);
  } else {
    console.log('[demo] ffmpeg unavailable — webm is canonical');
  }
}

main().catch((err) => {
  console.error('[demo] fatal:', err);
  process.exit(1);
});
