#!/usr/bin/env node
// Record a README-focused Parity Studio demo.
//
// The old public demo stitched unrelated scenes together. This script records
// only the six product promises from README.md:
//   1. Drop/source a design and start a run.
//   2. Break it into verified ui_kit files.
//   3. Select a component/file.
//   4. Comment on the scoped preview.
//   5. Iterate/auto-fix that scoped slice.
//   6. Export the same canonical ui_kit shape as ZIP.
//
// To keep the GIF concise, backend wait time happens off-camera. The same runId
// created in scene 1 is reopened for the subsequent scenes.

import { chromium } from 'playwright';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const runsDir = resolve(repoRoot, 'runs');

const PARITY_STUDIO_URL = process.env.PARITY_STUDIO_URL ?? 'https://parity-studio.vercel.app/';
const PARITY_CONVEX_URL = process.env.PARITY_CONVEX_URL ?? 'https://blissful-pig-998.convex.cloud';
const INPUT_MODE = process.env.INPUT_MODE ?? 'existing';
const EXISTING_RUN_ID = process.env.EXISTING_RUN_ID ?? 'jh73jdermm6pm6zbcfrd3mpms985v2t0';
const SOURCE_IMAGE_PATH =
  process.env.SOURCE_IMAGE_PATH ?? resolve(repoRoot, 'runs', 'composer-dogfood', 'source.png');
const SOURCE_ZIP_PATH =
  process.env.SOURCE_ZIP_PATH ??
  resolve(repoRoot, 'runs', 'recording-shell-2026-04-30T06-32-54-320Z', 'downloads', 'hero-composer.zip');
const PROMPT =
  process.env.PROMPT ??
  'decompose this hero composer into a verified ui_kit with terracotta primary CTA, dark surface tokens, and production-ready component names';
const COMMENT_TEXT =
  process.env.COMMENT_TEXT ??
  'Tighten the hero card radius and make the primary CTA contrast more deliberate.';
const COMPONENT_FILE =
  process.env.COMPONENT_FILE ??
  'ui_kits/ableton-live-12/components/BackgroundMediaHero.tsx';
const HEADED = process.env.HEADED === '1';
const WAIT_MAX_MS = Number.parseInt(process.env.WAIT_MAX_MS ?? `${12 * 60_000}`, 10);
const WIDTH = Number.parseInt(process.env.VIEWPORT_WIDTH ?? '1680', 10);
const HEIGHT = Number.parseInt(process.env.VIEWPORT_HEIGHT ?? '900', 10);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(runsDir, `six-step-demo-${stamp}`);
const sceneRoot = join(outDir, 'scenes');
const downloadDir = join(outDir, 'downloads');
const finalMp4 = process.env.OUTPUT ?? join(runsDir, `demo-six-step-${stamp.slice(0, 10)}.mp4`);
const finalGif = finalMp4.replace(/\.mp4$/i, '.gif');
const finalGif720 = finalMp4.replace(/\.mp4$/i, '-720.gif');

const evidence = {
  version: 1,
  createdAt: new Date().toISOString(),
  target: PARITY_STUDIO_URL,
  inputMode: INPUT_MODE,
  existingRunId: EXISTING_RUN_ID,
  sourceImage: SOURCE_IMAGE_PATH,
  sourceZip: SOURCE_ZIP_PATH,
  prompt: PROMPT,
  comment: COMMENT_TEXT,
  runId: null,
  scenes: [],
  checks: {},
  outputs: {
    mp4: finalMp4,
    gif: finalGif,
    gif720: finalGif720,
  },
};

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function normalizeUrlBase(url) {
  return url.replace(/\/$/, '');
}

async function convexQuery(path, args) {
  const res = await fetch(`${normalizeUrlBase(PARITY_CONVEX_URL)}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const json = await res.json();
  if (!res.ok || json.status === 'error') {
    throw new Error(`Convex query failed for ${path}: ${json.errorMessage ?? res.statusText}`);
  }
  return json.value;
}

async function installOverlay(page) {
  await page.evaluate(() => {
    const prior = document.getElementById('__parity_demo_overlay');
    if (prior) prior.remove();
    const style = document.createElement('style');
    style.id = '__parity_demo_overlay_style';
    style.textContent = `
      #__parity_demo_overlay {
        position: fixed;
        left: 28px;
        bottom: 28px;
        z-index: 2147483647;
        width: min(560px, calc(100vw - 56px));
        padding: 16px 18px;
        border: 1px solid rgba(128, 74, 45, 0.28);
        border-radius: 18px;
        background: rgba(255, 250, 244, 0.94);
        box-shadow: 0 18px 48px rgba(61, 39, 24, 0.20);
        color: #201711;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        pointer-events: none;
      }
      #__parity_demo_overlay .kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font: 700 12px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #9a5634;
      }
      #__parity_demo_overlay .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #d97757;
        box-shadow: 0 0 0 5px rgba(217, 119, 87, 0.16);
      }
      #__parity_demo_overlay .title {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 26px;
        line-height: 1.04;
        letter-spacing: -0.035em;
        margin-bottom: 6px;
      }
      #__parity_demo_overlay .body {
        font-size: 14px;
        line-height: 1.45;
        color: #594a41;
      }
    `;
    document.head.appendChild(style);
    const overlay = document.createElement('div');
    overlay.id = '__parity_demo_overlay';
    overlay.innerHTML = `
      <div class="kicker"><span class="dot"></span><span data-kicker>Step</span></div>
      <div class="title" data-title></div>
      <div class="body" data-body></div>
    `;
    document.body.appendChild(overlay);
  });
}

async function setStep(page, step, title, body) {
  await installOverlay(page);
  await page.evaluate(
    ({ step: stepText, title: titleText, body: bodyText }) => {
      document.querySelector('#__parity_demo_overlay [data-kicker]').textContent = stepText;
      document.querySelector('#__parity_demo_overlay [data-title]').textContent = titleText;
      document.querySelector('#__parity_demo_overlay [data-body]').textContent = bodyText;
    },
    { step, title, body },
  );
}

async function createRecordedPage(sceneName) {
  const videoDir = join(sceneRoot, sceneName, 'video');
  await mkdir(videoDir, { recursive: true });
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: videoDir, size: { width: WIDTH, height: HEIGHT } },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[browser:${sceneName}] ${msg.text()}`);
  });
  return { browser, context, page, videoDir, sceneDir: join(sceneRoot, sceneName) };
}

async function finishRecordedPage(handle, sceneName) {
  await handle.context.close();
  await handle.browser.close();
  const videos = (await readdir(handle.videoDir)).filter((f) => f.endsWith('.webm'));
  if (videos.length === 0) throw new Error(`No webm output for ${sceneName}`);
  const webmPath = join(handle.videoDir, videos[0]);
  const sceneWebm = join(handle.sceneDir, `${sceneName}.webm`);
  const sceneMp4 = join(handle.sceneDir, `${sceneName}.mp4`);
  await copyFile(webmPath, sceneWebm);
  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-i', sceneWebm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', sceneMp4],
    { stdio: 'inherit' },
  );
  if (ff.status !== 0) throw new Error(`ffmpeg failed for ${sceneName}`);
  const duration = await probeDuration(sceneMp4);
  evidence.scenes.push({ name: sceneName, mp4: sceneMp4, durationSec: duration });
  return sceneMp4;
}

async function probeDuration(file) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return null;
  const v = Number.parseFloat((r.stdout ?? '').trim());
  return Number.isFinite(v) ? v : null;
}

async function recordScene(sceneName, fn) {
  console.log(`[six-step] recording ${sceneName}`);
  const handle = await createRecordedPage(sceneName);
  let thrown = null;
  try {
    await fn(handle.page);
  } catch (err) {
    thrown = err;
  }
  const mp4 = await finishRecordedPage(handle, sceneName);
  if (thrown) throw thrown;
  return mp4;
}

async function getRunIdFromPage(page) {
  for (let i = 0; i < 40; i += 1) {
    const url = new URL(page.url());
    const runId = url.searchParams.get('run');
    if (runId) return runId;
    await sleep(500);
  }
  return null;
}

async function waitForGeneratedRun(runId) {
  console.log(`[six-step] waiting off-camera for run ${runId}`);
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < WAIT_MAX_MS) {
    const [run, uiKit, parity] = await Promise.all([
      convexQuery('runs:get', { runId }).catch(() => null),
      convexQuery('uiKits:getLatest', { runId }).catch(() => null),
      convexQuery('parityReports:getLatest', { runId }).catch(() => null),
    ]);
    const status = `${run?.status ?? 'unknown'} uiKit=${Boolean(uiKit)} parity=${Boolean(parity)}`;
    if (status !== lastStatus) {
      console.log(`[six-step] ${status}`);
      lastStatus = status;
    }
    if (uiKit && parity && ['done', 'verified', 'needs_review', 'needs_iteration', 'failed'].includes(run?.status)) {
      const fileCount = Object.keys(uiKit.files ?? {}).length;
      evidence.checks.generated = {
        status: run.status,
        fileCount,
        parityStatus: parity.status,
        passCount: parity.passCount,
        totalChecks: parity.totalChecks,
      };
      return { run, uiKit, parity };
    }
    await sleep(5_000);
  }
  throw new Error(`Timed out waiting for generated run ${runId}`);
}

async function selectComponentFile(page) {
  await page.getByRole('tab', { name: /^files$/i }).click().catch(() => {});
  const candidates = [
    COMPONENT_FILE,
    'preview/component-backgroundmediahero.html',
    'preview/component-compactnav.html',
  ];
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    for (const file of candidates) {
      const direct = page.locator(`button[title="Scope next comment to ${file}"]`).first();
      if ((await direct.count()) > 0 && (await direct.isVisible().catch(() => false))) {
        await direct.scrollIntoViewIfNeeded().catch(() => {});
        await direct.click();
        return file;
      }
    }
    await page.waitForTimeout(500);
  }
  const componentButton = page.locator('button[title*="component-"]').first();
  await componentButton.waitFor({ state: 'visible', timeout: 15_000 });
  const title = (await componentButton.getAttribute('title')) ?? '';
  await componentButton.click();
  return title.replace(/^Scope next comment to\s+/, '');
}

async function sceneStartRun() {
  if (INPUT_MODE === 'existing') {
    return await recordScene('01-start-run', async (page) => {
      const runId = EXISTING_RUN_ID;
      await page.goto(`${normalizeUrlBase(PARITY_STUDIO_URL)}/?run=${encodeURIComponent(runId)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await setStep(
        page,
        'Step 1 / 6',
        'Start from a real source-image run',
        'The left rail shows the generated run history; the same run continues through files, comments, iterate, and export.',
      );
      evidence.runId = runId;
      evidence.checks.step1 = { ok: true, runId, mode: 'existing' };
      await page.waitForTimeout(5_000);
    });
  }
  if (INPUT_MODE === 'zip' && !existsSync(SOURCE_ZIP_PATH)) throw new Error(`Source ZIP not found: ${SOURCE_ZIP_PATH}`);
  if (INPUT_MODE !== 'zip' && !existsSync(SOURCE_IMAGE_PATH)) throw new Error(`Source image not found: ${SOURCE_IMAGE_PATH}`);
  return await recordScene('01-start-run', async (page) => {
    await page.goto(PARITY_STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (INPUT_MODE === 'zip') {
      await setStep(
        page,
        'Step 1 / 6',
        'Drop a canonical ui_kit ZIP',
        'The same kit shape that coding agents consume can be imported back into Parity Studio.',
      );
    } else {
      await setStep(
        page,
        'Step 1 / 6',
        'Drop a source image + prompt',
        'The run starts from a real image and a product prompt, not a canned screenshot.',
      );
    }
    await page.waitForTimeout(1_200);
    if (INPUT_MODE === 'zip') {
      await page.locator('input[type=file]').first().setInputFiles(SOURCE_ZIP_PATH);
    } else {
      await page.locator('input[type=file][accept*="png"]').first().setInputFiles(SOURCE_IMAGE_PATH);
      await page.waitForTimeout(900);
      const composer = page.getByRole('textbox', { name: /describe the design/i });
      await composer.click();
      await composer.fill('');
      await composer.type(PROMPT, { delay: 12 });
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: /^generate$/i }).click();
    }
    const runId = await getRunIdFromPage(page);
    if (!runId) throw new Error('Run id did not appear in URL after starting/importing a run');
    evidence.runId = runId;
    evidence.checks.step1 = { ok: true, runId };
    await page.waitForTimeout(2_500);
  });
}

async function sceneVerifiedRun(runId) {
  return await recordScene('02-decompose-verify', async (page) => {
    await page.goto(`${normalizeUrlBase(PARITY_STUDIO_URL)}/?run=${encodeURIComponent(runId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await setStep(
      page,
      'Step 2 / 6',
      'Break it into verified ui_kit files',
      'The file tree, rendered preview, parity rows, and cost telemetry come from the generated run.',
    );
    await page.waitForTimeout(3_000);
    await page.getByRole('tab', { name: /^files$/i }).click().catch(() => {});
    await page.waitForTimeout(2_500);
    await page.getByRole('tab', { name: /^preview$/i }).click().catch(() => {});
    await page.waitForTimeout(3_000);
    const parityText = await page.locator('aside[aria-label="Deterministic parity"]').textContent().catch(() => '');
    evidence.checks.step2 = {
      ok: /\/\s*16|checks/i.test(parityText ?? ''),
      parityText: (parityText ?? '').replace(/\s+/g, ' ').slice(0, 280),
    };
  });
}

async function sceneSelectFile(runId) {
  return await recordScene('03-select-component', async (page) => {
    await page.goto(`${normalizeUrlBase(PARITY_STUDIO_URL)}/?run=${encodeURIComponent(runId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await setStep(
      page,
      'Step 3 / 6',
      'Select a component',
      'Click a real file in the generated ui_kit so the next comment is scoped.',
    );
    const selected = await selectComponentFile(page);
    evidence.checks.step3 = {
      ok: /component|BackgroundMediaHero|CompactNav|KitCard|KitGallery|RichFooter/i.test(selected),
      selected,
    };
    await page.waitForTimeout(3_000);
  });
}

async function sceneCommentIterate(runId) {
  return await recordScene('04-comment-iterate', async (page) => {
    await page.goto(`${normalizeUrlBase(PARITY_STUDIO_URL)}/?run=${encodeURIComponent(runId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const selected = await selectComponentFile(page);
    await page.getByRole('tab', { name: /^preview$/i }).click().catch(() => {});
    await page.waitForTimeout(2_000);
    await setStep(
      page,
      'Step 4 / 6',
      'Comment on the scoped preview',
      'Comment mode drops a pin on the artifact instead of rewriting the whole design.',
    );
    const commentToggle = page.getByRole('button', { name: /^comment mode$/i });
    await commentToggle.click();
    await page.waitForTimeout(1_000);
    const chatBefore = await convexQuery('chat:list', { runId }).catch(() => []);
    const commentsBefore = await convexQuery('comments:listForRun', { runId }).catch(() => []);
    const previousCommentIds = new Set(commentsBefore.map((c) => c._id));
    const iframe = page.locator('iframe[title="artifact preview"]').first();
    const box = await iframe.boundingBox();
    if (!box) throw new Error('Artifact iframe bbox unavailable for comment click');
    const start = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.24 };
    const end = { x: box.x + box.width * 0.58, y: box.y + box.height * 0.43 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(1_000);
    const commentBox = page.locator('textarea[placeholder*="write your own" i], textarea[placeholder*="should change" i]').first();
    await commentBox.waitFor({ state: 'visible', timeout: 8_000 });
    await commentBox.click();
    await commentBox.fill('');
    await commentBox.type(COMMENT_TEXT, { delay: 14 });
    evidence.checks.step4 = { ok: true, comment: COMMENT_TEXT, selected };
    await page.waitForTimeout(1_000);
    await setStep(
      page,
      'Step 5 / 6',
      'Iterate only that slice',
      'Save + auto-fix sends the scoped comment into the advisor/executor loop.',
    );
    await page.getByRole('button', { name: /save \+ auto-fix/i }).click();
    await page.waitForTimeout(2_500);
    await page.getByRole('tab', { name: /^chat$/i }).click().catch(() => {});
    const started = Date.now();
    let sawAgent = null;
    while (Date.now() - started < 60_000) {
      const [comments, chat] = await Promise.all([
        convexQuery('comments:listForRun', { runId }).catch(() => []),
        convexQuery('chat:list', { runId }).catch(() => []),
      ]);
      const matchingComment = comments.find(
        (c) => !previousCommentIds.has(c._id) && c.text === COMMENT_TEXT && c.targetFile === selected,
      );
      const newChat = chat.slice(chatBefore.length);
      const autoFixTurn = newChat.find((m) => /Auto-fix triggered/i.test(m.content ?? ''));
      const agentTurn = newChat.find((m) => m.role !== 'user');
      if (matchingComment && autoFixTurn && agentTurn) {
        sawAgent = {
          commentId: matchingComment._id,
          targetFile: matchingComment.targetFile,
          chatTurn: autoFixTurn.turn,
          agentTurn: agentTurn.turn,
          agentRole: agentTurn.role,
          chatDelta: newChat.length,
        };
        break;
      }
      await page.waitForTimeout(2_000);
    }
    evidence.checks.step5 = { ok: Boolean(sawAgent), ...(sawAgent ?? {}) };
    await page.waitForTimeout(4_000);
  });
}

async function sceneExport(runId) {
  return await recordScene('05-export-zip', async (page) => {
    await page.goto(`${normalizeUrlBase(PARITY_STUDIO_URL)}/?run=${encodeURIComponent(runId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await setStep(
      page,
      'Step 6 / 6',
      'Export the canonical ui_kit ZIP',
      'The same NodeBench-style kit shape comes out for coding-agent handoff.',
    );
    await page.waitForTimeout(2_000);
    await page.getByRole('button', { name: /^export$/i }).first().click({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await mkdir(downloadDir, { recursive: true });
    const dlPromise = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
    await page.getByRole('menuitem').filter({ hasText: /zip/i }).first().click({ timeout: 10_000 });
    const dl = await dlPromise;
    if (!dl) throw new Error('ZIP export did not download');
    const zipPath = join(downloadDir, dl.suggestedFilename() || 'ui_kit.zip');
    await dl.saveAs(zipPath);
    const size = (await stat(zipPath)).size;
    evidence.checks.step6 = { ok: size > 0, zipPath, size };
    await page.waitForTimeout(2_500);
  });
}

async function sceneContinuousSixStep() {
  if (INPUT_MODE !== 'existing') return null;
  return await recordScene('01-six-step-flow', async (page) => {
    const runId = EXISTING_RUN_ID;
    await page.goto(`${normalizeUrlBase(PARITY_STUDIO_URL)}/?run=${encodeURIComponent(runId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    evidence.runId = runId;

    await page.getByRole('tab', { name: /^preview$/i }).click().catch(() => {});
    await page.locator('iframe[title="artifact preview"]').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(1_500);

    await setStep(
      page,
      'Step 1 / 6',
      'Start from a real source-image run',
      'This completed run began from an image + prompt; the same run continues through files, comments, iterate, and export.',
    );
    evidence.checks.step1 = { ok: true, runId, mode: 'existing' };
    await page.waitForTimeout(4_000);

    await setStep(
      page,
      'Step 2 / 6',
      'Break it into verified ui_kit files',
      'Generated component files, rendered preview, parity rows, and cost telemetry all stay visible in one flow.',
    );
    await page.getByRole('tab', { name: /^files$/i }).click().catch(() => {});
    await page.waitForTimeout(2_500);
    await page.getByRole('tab', { name: /^preview$/i }).click().catch(() => {});
    await page.waitForTimeout(2_500);
    const parityText = await page.locator('aside[aria-label="Deterministic parity"]').textContent().catch(() => '');
    evidence.checks.step2 = {
      ok: /\/\s*16|checks/i.test(parityText ?? ''),
      parityText: (parityText ?? '').replace(/\s+/g, ' ').slice(0, 280),
    };

    await setStep(
      page,
      'Step 3 / 6',
      'Select a component',
      'Scope the next action to a generated component file, not the whole artifact.',
    );
    const selected = await selectComponentFile(page);
    evidence.checks.step3 = {
      ok: /component|BackgroundMediaHero|CompactNav|KitCard|KitGallery|RichFooter/i.test(selected),
      selected,
    };
    await page.waitForTimeout(2_000);

    await page.getByRole('tab', { name: /^preview$/i }).click().catch(() => {});
    await page.waitForTimeout(1_000);
    await setStep(
      page,
      'Step 4 / 6',
      'Comment on the scoped preview',
      'A pinned bbox and text comment are attached to the selected component file.',
    );
    const commentToggle = page.getByRole('button', { name: /^comment mode$/i });
    const pressed = await commentToggle.getAttribute('aria-pressed').catch(() => 'false');
    if (pressed !== 'true') await commentToggle.click();
    await page.waitForTimeout(800);
    const chatBefore = await convexQuery('chat:list', { runId }).catch(() => []);
    const commentsBefore = await convexQuery('comments:listForRun', { runId }).catch(() => []);
    const previousCommentIds = new Set(commentsBefore.map((c) => c._id));
    const iframe = page.locator('iframe[title="artifact preview"]').first();
    const box = await iframe.boundingBox();
    if (!box) throw new Error('Artifact iframe bbox unavailable for comment drag');
    const start = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.24 };
    const end = { x: box.x + box.width * 0.58, y: box.y + box.height * 0.43 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 16 });
    await page.mouse.up();
    const commentBox = page.locator('textarea[placeholder*="write your own" i], textarea[placeholder*="should change" i]').first();
    await commentBox.waitFor({ state: 'visible', timeout: 8_000 });
    await commentBox.click();
    await commentBox.fill('');
    await commentBox.type(COMMENT_TEXT, { delay: 10 });
    evidence.checks.step4 = { ok: true, comment: COMMENT_TEXT, selected };
    await page.waitForTimeout(800);

    await setStep(
      page,
      'Step 5 / 6',
      'Iterate only that slice',
      'Save + auto-fix starts the advisor/executor, then opens the scoped component file to show the edit target.',
    );
    await page.getByRole('button', { name: /save \+ auto-fix/i }).click();
    await page.waitForTimeout(1_500);
    await page.getByRole('tab', { name: /^chat$/i }).click().catch(() => {});
    const started = Date.now();
    let sawAgent = null;
    while (Date.now() - started < 60_000) {
      const [comments, chat] = await Promise.all([
        convexQuery('comments:listForRun', { runId }).catch(() => []),
        convexQuery('chat:list', { runId }).catch(() => []),
      ]);
      const matchingComment = comments.find(
        (c) => !previousCommentIds.has(c._id) && c.text === COMMENT_TEXT && c.targetFile === selected,
      );
      const newChat = chat.slice(chatBefore.length);
      const autoFixTurn = newChat.find((m) => /Auto-fix triggered/i.test(m.content ?? ''));
      const agentTurn = newChat.find((m) => m.role !== 'user');
      if (matchingComment && autoFixTurn && agentTurn) {
        sawAgent = {
          commentId: matchingComment._id,
          targetFile: matchingComment.targetFile,
          chatTurn: autoFixTurn.turn,
          agentTurn: agentTurn.turn,
          agentRole: agentTurn.role,
          chatDelta: newChat.length,
        };
        break;
      }
      await page.waitForTimeout(2_000);
    }
    evidence.checks.step5 = { ok: Boolean(sawAgent), ...(sawAgent ?? {}) };
    await page.waitForTimeout(3_000);
    await page.getByRole('tab', { name: /^code$/i }).click().catch(() => {});
    await page.waitForTimeout(4_000);

    await page.getByRole('tab', { name: /^files$/i }).click().catch(() => {});
    await page.waitForTimeout(1_500);
    await setStep(
      page,
      'Step 6 / 6',
      'Export the canonical ui_kit ZIP',
      'Click the visible handoff export; the exact generated kit downloads as a coding-agent ZIP.',
    );
    await page.waitForTimeout(1_000);
    await mkdir(downloadDir, { recursive: true });
    const dlPromise = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
    await page.getByRole('link', { name: /Export ZIP/i }).first().click({ timeout: 10_000 });
    const dl = await dlPromise;
    if (!dl) throw new Error('ZIP export did not download');
    const zipPath = join(downloadDir, dl.suggestedFilename() || 'ui_kit.zip');
    await dl.saveAs(zipPath);
    const size = (await stat(zipPath)).size;
    evidence.checks.step6 = { ok: size > 0, zipPath, size };
    await setStep(
      page,
      'Step 6 / 6',
      'ZIP downloaded',
      `${dl.suggestedFilename() || 'ui_kit.zip'} exported from the same generated ui_kit shape.`,
    );
    await page.getByRole('tab', { name: /^preview$/i }).click().catch(() => {});
    await page.waitForTimeout(2_500);
  });
}

async function concatScenes(sceneFiles) {
  const filter = sceneFiles
    .map((_, i) => `[${i}:v]scale=${WIDTH}:${HEIGHT},setsar=1,fps=30[v${i}]`)
    .join(';') + `;${sceneFiles.map((_, i) => `[v${i}]`).join('')}concat=n=${sceneFiles.length}:v=1[outv]`;
  const args = ['-y'];
  for (const file of sceneFiles) args.push('-i', file);
  args.push(
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    finalMp4,
  );
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Final MP4 concat failed');
}

async function writeGif(input, output, width, fps) {
  const palette = output.replace(/\.gif$/i, '.palette.png');
  const pal = spawnSync(
    'ffmpeg',
    ['-y', '-i', input, '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`, palette],
    { stdio: 'inherit' },
  );
  if (pal.status !== 0) throw new Error(`palettegen failed for ${output}`);
  const gif = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      input,
      '-i',
      palette,
      '-filter_complex',
      `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      '-loop',
      '0',
      output,
    ],
    { stdio: 'inherit' },
  );
  if (gif.status !== 0) throw new Error(`paletteuse failed for ${output}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(sceneRoot, { recursive: true });
  await mkdir(downloadDir, { recursive: true });
  console.log(`[six-step] output dir: ${outDir}`);
  console.log(`[six-step] target:     ${PARITY_STUDIO_URL}`);
  console.log(`[six-step] input mode: ${INPUT_MODE}`);
  console.log(`[six-step] source:     ${INPUT_MODE === 'zip' ? SOURCE_ZIP_PATH : SOURCE_IMAGE_PATH}`);

  const sceneFiles = [];
  const continuous = await sceneContinuousSixStep();
  if (continuous) {
    sceneFiles.push(continuous);
    const runId = evidence.runId;
    if (!runId) throw new Error('No runId recorded');
    await waitForGeneratedRun(runId);
  } else {
    sceneFiles.push(await sceneStartRun());
    const runId = evidence.runId;
    if (!runId) throw new Error('No runId recorded');
    await waitForGeneratedRun(runId);
    sceneFiles.push(await sceneVerifiedRun(runId));
    sceneFiles.push(await sceneSelectFile(runId));
    sceneFiles.push(await sceneCommentIterate(runId));
    sceneFiles.push(await sceneExport(runId));
  }

  await concatScenes(sceneFiles);
  await writeGif(finalMp4, finalGif, 960, 14);
  await writeGif(finalMp4, finalGif720, 720, 12);

  evidence.outputs.mp4Size = (await stat(finalMp4)).size;
  evidence.outputs.gifSize = (await stat(finalGif)).size;
  evidence.outputs.gif720Size = (await stat(finalGif720)).size;
  evidence.outputs.durationSec = await probeDuration(finalMp4);
  evidence.outputs.releaseAssetNames = {
    mp4: 'demo-six-step.mp4',
    gif: 'demo-six-step.gif',
    gif720: 'demo-six-step-720.gif',
  };

  const evidencePath = join(outDir, 'evidence.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`[six-step] mp4:      ${finalMp4}`);
  console.log(`[six-step] gif:      ${finalGif}`);
  console.log(`[six-step] gif 720:  ${finalGif720}`);
  console.log(`[six-step] evidence: ${evidencePath}`);
}

main().catch((err) => {
  console.error('[six-step] fatal:', err);
  process.exit(1);
});
