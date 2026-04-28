// End-to-end agent browser recording for parity-studio.
//
// What this captures (in order, in one continuous take):
//   1. Land on https://parity-studio.vercel.app/
//   2. Drop the existing gpt-image-2 source image (composer-dogfood/source.png)
//   3. Type the dogfood prompt
//   4. Click Generate — watch generate -> decompose -> verify -> iterate -> done
//   5. Switch the preview tab to "code" — Monaco loads
//   6. Click a file in the file tree — FileEditor scopes to it
//   7. Toggle "Comment mode" in the right rail
//   8. Switch back to "preview" tab — rendered ui_kit visible
//   9. Click "Export ZIP" — download fires (saved to recordings/<run>/zip/)
//  10. Save video as MP4 (via ffmpeg if present, .webm otherwise)
//
// Run from parity-studio root:
//   node scripts/record-end-to-end.mjs
//
// Optional env:
//   PARITY_STUDIO_URL — override target (default: https://parity-studio.vercel.app/)
//   SOURCE_IMAGE_PATH — override the dropped image
//   PROMPT — override the prompt text
//   HEADED — set to "0" to record headless (smaller, no visible window)

import { chromium } from 'playwright';
import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PARITY_STUDIO_URL = process.env.PARITY_STUDIO_URL ?? 'https://parity-studio.vercel.app/';
// Default to the existing dogfood source — the same gpt-image-2 image the
// pipeline was originally built around. 1.58 MB, fits the 2 MB inline cap.
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

// Pipeline can take 3-5 minutes (generate ~30s, decompose ~1-3min with retries,
// iterate ~30-60s). Cap the wait at 8 minutes so a stuck run doesn't hang
// the recording forever — partial video is still useful.
const PIPELINE_MAX_MS = 8 * 60_000;

async function main() {
  if (!existsSync(SOURCE_IMAGE_PATH)) {
    console.error(`source image not found: ${SOURCE_IMAGE_PATH}`);
    console.error('set SOURCE_IMAGE_PATH env or move composer-dogfood/source.png into reach.');
    process.exit(2);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(repoRoot, 'runs', `recording-${stamp}`);
  const videoDir = join(outDir, 'video');
  const downloadDir = join(outDir, 'downloads');
  await mkdir(videoDir, { recursive: true });
  await mkdir(downloadDir, { recursive: true });
  console.log(`[record] output dir: ${outDir}`);
  console.log(`[record] target:     ${PARITY_STUDIO_URL}`);
  console.log(`[record] source img: ${SOURCE_IMAGE_PATH}`);
  console.log(`[record] prompt:     "${PROMPT}"`);

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: videoDir,
      size: { width: 1440, height: 900 },
    },
    acceptDownloads: true,
  });

  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[browser console] ${msg.text()}`);
  });

  try {
    // ── Step 1: load landing ─────────────────────────────────────────────
    console.log('[record] step 1 — navigate');
    await page.goto(PARITY_STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.input-section', { timeout: 30_000 });
    await page.waitForTimeout(1_500);

    // ── Step 2: drop the source image ────────────────────────────────────
    console.log('[record] step 2 — upload source image');
    const fileChooserInput = page.locator('input[type=file][accept*="png"]').first();
    await fileChooserInput.setInputFiles(SOURCE_IMAGE_PATH);
    await page.waitForTimeout(800);

    // ── Step 3: type prompt ──────────────────────────────────────────────
    console.log('[record] step 3 — type prompt');
    const promptInput = page.locator('input.input-field');
    await promptInput.click();
    await promptInput.fill('');
    await promptInput.type(PROMPT, { delay: 18 });
    await page.waitForTimeout(600);

    // ── Step 4: click Generate, then poll until pipeline completes ───────
    console.log('[record] step 4 — click Generate, watch pipeline');
    await page.locator('button.generate-button').click();

    const pipelineStartedAt = Date.now();
    let lastStatus = '';
    while (Date.now() - pipelineStartedAt < PIPELINE_MAX_MS) {
      // Read the right-rail "STATUS:" line. ActionSidebar renders it as
      // ".parity-subtitle" with text "STATUS: <UPPER>". When parity report
      // exists we'll see VERIFIED|NEEDS_ITERATION|FAILED|UNAVAILABLE; before
      // that we see the run.status (GENERATING|DECOMPOSING|...).
      const statusText = await page
        .locator('.parity-subtitle')
        .first()
        .textContent()
        .catch(() => '');
      const normalized = (statusText ?? '').trim();
      if (normalized && normalized !== lastStatus) {
        console.log(`[record] pipeline: ${normalized}`);
        lastStatus = normalized;
      }
      // Terminal: parity rendered (VERIFIED/NEEDS_REVIEW/NEEDS_ITERATION/FAILED)
      // OR a 9+ file count appears in FilesPanel meaning ui_kit landed.
      if (
        normalized.includes('VERIFIED') ||
        normalized.includes('NEEDS_REVIEW') ||
        normalized.includes('NEEDS_ITERATION') ||
        normalized.includes('FAILED')
      ) {
        // Give the UI 2s to settle (cost panel finishes streaming, etc.)
        await page.waitForTimeout(2_000);
        break;
      }
      await page.waitForTimeout(2_500);
    }
    console.log(`[record] pipeline reached: "${lastStatus}" after ${(Date.now() - pipelineStartedAt) / 1000}s`);

    // ── Step 5: switch preview to code mode ──────────────────────────────
    console.log('[record] step 5 — switch preview to code mode');
    const codeTab = page.getByRole('tab', { name: 'code', exact: true });
    if (await codeTab.count() > 0) {
      await codeTab.first().click();
      // Monaco lazy-loads via CDN; wait for it to render.
      await page.waitForSelector('.monaco-editor, [data-monaco], .file-editor', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2_500);
    } else {
      console.log('[record] code tab not found — skipping');
    }

    // ── Step 6: click a file in the tree ─────────────────────────────────
    console.log('[record] step 6 — click a file in the tree');
    const firstFileButton = page.locator('button.file').first();
    if (await firstFileButton.count() > 0) {
      await firstFileButton.click();
      await page.waitForTimeout(2_000);
      // If a second file exists, click it too to show file-switching.
      const filesCount = await page.locator('button.file').count();
      if (filesCount > 1) {
        await page.locator('button.file').nth(1).click();
        await page.waitForTimeout(1_500);
      }
    }

    // ── Step 7: toggle comment mode ──────────────────────────────────────
    console.log('[record] step 7 — toggle comment mode');
    const commentToggle = page.getByRole('button', {
      name: /toggle bbox region selection/i,
    });
    if (await commentToggle.count() > 0) {
      await commentToggle.first().click();
      await page.waitForTimeout(1_500);
    }

    // ── Step 8: switch back to preview tab to show rendered ui_kit ───────
    console.log('[record] step 8 — back to preview tab');
    const previewTab = page.getByRole('tab', { name: 'preview', exact: true });
    if (await previewTab.count() > 0) {
      await previewTab.first().click();
      await page.waitForTimeout(2_000);
    }

    // ── Step 9: click Export ZIP ─────────────────────────────────────────
    console.log('[record] step 9 — export zip');
    const exportLink = page.getByText('Export ZIP', { exact: true });
    if (await exportLink.count() > 0) {
      try {
        const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
        await exportLink.first().click();
        const download = await downloadPromise;
        const zipPath = join(downloadDir, download.suggestedFilename() || 'ui_kit.zip');
        await download.saveAs(zipPath);
        const sz = (await stat(zipPath)).size;
        console.log(`[record] zip saved: ${zipPath} (${sz} bytes)`);
      } catch (err) {
        console.log(`[record] export click did not produce a download: ${(err && err.message) || err}`);
      }
    }

    // Final pause so the closing frame is calm, not mid-action.
    await page.waitForTimeout(2_500);
  } catch (err) {
    console.error('[record] error during recording:', err);
  } finally {
    // Closing the context flushes the .webm to disk.
    await context.close();
    await browser.close();
  }

  // ── Step 10: rename + try to convert to mp4 ────────────────────────────
  const videos = (await readdir(videoDir)).filter((f) => f.endsWith('.webm'));
  if (videos.length === 0) {
    console.log('[record] no video file found — recording skipped or failed before any frames');
    return;
  }
  const webmPath = join(videoDir, videos[0]);
  const renamedWebm = join(outDir, 'recording.webm');
  await copyFile(webmPath, renamedWebm);
  console.log(`[record] webm: ${renamedWebm}`);

  // Try ffmpeg → mp4 if present. Not required.
  const mp4Path = join(outDir, 'recording.mp4');
  const ff = spawnSync('ffmpeg', ['-y', '-i', renamedWebm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', mp4Path], {
    stdio: 'inherit',
  });
  if (ff.status === 0) {
    console.log(`[record] mp4: ${mp4Path}`);
  } else {
    console.log('[record] ffmpeg not available or failed; webm is the canonical output');
  }
}

main().catch((err) => {
  console.error('[record] fatal:', err);
  process.exit(1);
});
