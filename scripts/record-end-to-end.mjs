// End-to-end agent browser recording for the Parity Studio shell revamp.
//
// Captures (in order, one continuous take, default ~5–8 min depending on
// pipeline timing):
//   1. Land on https://parity-studio.vercel.app/
//   2. Drop the existing gpt-image-2 source (composer-dogfood/source.png)
//   3. Type the dogfood prompt in the bottom-left composer
//   4. Click ↑ (terracotta circle) — watch the right-rail PIPELINE
//      ACTIVITY card light up green, parity score climb, cost
//      telemetry stream as each stage completes
//   5. Switch the canvas tab to "code" (Monaco lazy-loads)
//   6. Click a file in the FILES group → green scoped→file badge
//   7. Toggle "Comment mode" pill in the top right
//   8. Switch to "preview" tab to show the rendered ui_kit
//   9. Click "Export" in the top-right cluster (or Export ZIP card)
//      and capture the downloaded zip
//  10. Save .webm and convert to .mp4 if ffmpeg present
//
// Run: node scripts/record-end-to-end.mjs

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PARITY_STUDIO_URL = process.env.PARITY_STUDIO_URL ?? 'https://parity-studio.vercel.app/';
const DEFAULT_SOURCE = resolve(
  repoRoot,
  '..',
  'cafecorner_nodebench',
  'nodebench_ai4',
  'nodebench-ai',
  'scripts',
  'career',
  'poc-headless-pipeline',
  'runs',
  'composer-dogfood',
  'source.png',
);
const SOURCE_IMAGE_PATH = process.env.SOURCE_IMAGE_PATH ?? DEFAULT_SOURCE;
const PROMPT =
  process.env.PROMPT ??
  'decompose this hero composer into a clean ui_kit with terracotta primary CTA and dark surface tokens';
const HEADED = process.env.HEADED !== '0';

const PIPELINE_MAX_MS = 9 * 60_000;

async function main() {
  if (!existsSync(SOURCE_IMAGE_PATH)) {
    console.error(`source image not found: ${SOURCE_IMAGE_PATH}`);
    process.exit(2);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(repoRoot, 'runs', `recording-shell-${stamp}`);
  const videoDir = join(outDir, 'video');
  const downloadDir = join(outDir, 'downloads');
  await mkdir(videoDir, { recursive: true });
  await mkdir(downloadDir, { recursive: true });
  console.log(`[record] output:     ${outDir}`);
  console.log(`[record] target:     ${PARITY_STUDIO_URL}`);
  console.log(`[record] source img: ${SOURCE_IMAGE_PATH}`);
  console.log(`[record] prompt:     "${PROMPT}"`);

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1680, height: 900 } },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[browser] ${msg.text()}`);
  });

  try {
    // ── 1. land ────────────────────────────────────────────────────────
    console.log('[record] step 1 — navigate');
    await page.goto(PARITY_STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2_500);

    // ── 2. drop source image (the hidden file input lives inside the
    //      ComposerCard's paperclip button) ───────────────────────────
    console.log('[record] step 2 — upload source image');
    const fileInput = page.locator('input[type=file][accept*="png"]').first();
    await fileInput.setInputFiles(SOURCE_IMAGE_PATH);
    await page.waitForTimeout(800);

    // ── 3. type prompt in the composer ────────────────────────────────
    console.log('[record] step 3 — type prompt');
    const composer = page.getByRole('textbox', { name: /describe the design/i });
    await composer.click();
    await composer.fill('');
    await composer.type(PROMPT, { delay: 18 });
    await page.waitForTimeout(800);

    // ── 4. submit, watch the pipeline activity + parity rail ──────────
    console.log('[record] step 4 — submit, watch pipeline');
    await page
      .getByRole('button', { name: /^generate$/i })
      .click()
      .catch(async () => {
        // Fallback: terracotta circle ↑ button has aria-label "Generate"
        // (or "Starting run…"); submit by Cmd+Enter on the textarea.
        await composer.press('Control+Enter');
      });

    const startedAt = Date.now();
    let lastSnapshot = '';
    while (Date.now() - startedAt < PIPELINE_MAX_MS) {
      // Read the right-rail score line "N / 16" + status pill text.
      const score = await page
        .locator('aside[aria-label="Deterministic parity"] >> nth=0')
        .first()
        .textContent()
        .catch(() => '');
      const norm = (score ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (norm && norm !== lastSnapshot) {
        console.log(`[record] right-rail: ${norm}`);
        lastSnapshot = norm;
      }
      // Terminal: parity score reaches 16/16 OR status pill says Done/Failed
      if (
        /1[6-9]\s*\/\s*16/.test(norm) ||
        norm.includes('Status: Done') ||
        norm.includes('Failed')
      ) {
        await page.waitForTimeout(2_500);
        break;
      }
      // Also break when an artifact iframe is rendered with non-placeholder content
      const hasArtifact = await page
        .evaluate(() => {
          const f = document.querySelector('iframe[title="artifact preview"]');
          if (!f) return false;
          try {
            const doc = f.contentDocument;
            if (!doc) return false;
            return (doc.body?.innerText ?? '').length > 80;
          } catch {
            return false;
          }
        })
        .catch(() => false);
      if (hasArtifact) {
        // Pipeline completed enough to render a real artifact — keep watching for parity to stabilize, then break
        await page.waitForTimeout(8_000);
        break;
      }
      await page.waitForTimeout(3_000);
    }
    console.log(`[record] pipeline reached after ${Math.round((Date.now() - startedAt) / 1000)}s`);

    // ── 5. switch to code tab (Monaco lazy-loads) ─────────────────────
    console.log('[record] step 5 — code tab');
    await page
      .getByRole('tab', { name: /code/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(3_000);

    // ── 6. click a file in the FILES group ────────────────────────────
    console.log('[record] step 6 — click a file');
    // First switch back to Files tab so the tree is visible
    await page
      .getByRole('tab', { name: /^files$/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(1_000);
    const firstFile = page.locator('button.file, button[title^="Scope next comment"]').first();
    if ((await firstFile.count()) > 0) {
      await firstFile.click();
      await page.waitForTimeout(1_500);
    } else {
      // New shell: file buttons are the inline buttons in the Files group
      const fileBtn = page
        .locator('aside[aria-label="Artifact canvas"], section[aria-label="Artifact canvas"]')
        .locator('button[title^="Scope next comment"]')
        .first();
      if ((await fileBtn.count()) > 0) {
        await fileBtn.click();
        await page.waitForTimeout(1_500);
      }
    }

    // ── 7. toggle comment mode ────────────────────────────────────────
    console.log('[record] step 7 — comment mode');
    const commentToggle = page.getByRole('button', { name: /comment mode/i });
    if ((await commentToggle.count()) > 0) {
      await commentToggle.first().click();
      await page.waitForTimeout(2_000);
    }

    // ── 8. switch to preview tab ──────────────────────────────────────
    console.log('[record] step 8 — preview tab');
    await page
      .getByRole('tab', { name: /^preview$/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(3_000);

    // ── 9. export ZIP via top-right Export button (opens menu, then ZIP) ─
    //
    // 2026-04-29: HeaderActions changed from <a> to <button> + menu of
    // <a role=menuitem href=…/zip|html|markdown>. We open the menu, hover
    // briefly so it's visible in the recording, then click ZIP. Wrap the
    // download promise in a catch so a failed click doesn't leak an
    // unhandled rejection on the 20s timeout.
    console.log('[record] step 9 — export zip');
    try {
      const exportButton = page.getByRole('button', { name: /^export$/i });
      await exportButton.first().click({ timeout: 5_000 });
      await page.waitForTimeout(800); // menu open animation
      const zipItem = page.getByRole('menuitem').filter({ hasText: /zip/i }).first();
      const dlPromise = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
      await zipItem.click({ timeout: 5_000 });
      const dl = await dlPromise;
      if (dl) {
        const path = join(downloadDir, dl.suggestedFilename() || 'ui_kit.zip');
        await dl.saveAs(path);
        const sz = (await stat(path)).size;
        console.log(`[record] zip via export menu: ${path} (${sz} bytes)`);
      } else {
        console.log(
          "[record] export menu opened but download didn't fire (export endpoint unavailable for this run)",
        );
      }
    } catch (err) {
      console.log(`[record] export step skipped: ${err?.message || err}`);
    }

    await page.waitForTimeout(2_500);
  } catch (err) {
    console.error('[record] error:', err);
  } finally {
    await context.close();
    await browser.close();
  }

  const videos = (await readdir(videoDir)).filter((f) => f.endsWith('.webm'));
  if (videos.length === 0) {
    console.log('[record] no video file found');
    return;
  }
  const webmPath = join(videoDir, videos[0]);
  const renamedWebm = join(outDir, 'recording.webm');
  await copyFile(webmPath, renamedWebm);
  console.log(`[record] webm: ${renamedWebm}`);

  const mp4Path = join(outDir, 'recording.mp4');
  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-i', renamedWebm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', mp4Path],
    { stdio: 'inherit' },
  );
  if (ff.status === 0) {
    console.log(`[record] mp4: ${mp4Path}`);
  } else {
    console.log('[record] ffmpeg unavailable; webm is canonical');
  }
}

main().catch((err) => {
  console.error('[record] fatal:', err);
  process.exit(1);
});
