#!/usr/bin/env node
// Record focused README proof demos.
//
// DEMO=core        fresh prompt -> generate/decompose -> select -> comment -> agent edit -> export
// DEMO=inspiration inspiration search/apply -> agent stream receives/uses the plan
// DEMO=sync        source sync modal -> patch current run and MCP recapture guidance

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runsDir = resolve(repoRoot, 'runs');

const DEMO = process.env.DEMO ?? 'core';
const TARGET_URL = process.env.PARITY_STUDIO_URL ?? 'https://parity-studio.vercel.app';
const CONVEX_URL = process.env.PARITY_CONVEX_URL ?? 'https://blissful-pig-998.convex.cloud';
const CONVEX_SITE_URL =
  process.env.PARITY_CONVEX_SITE_URL ?? CONVEX_URL.replace('.convex.cloud', '.convex.site');
const EXISTING_RUN_ID = process.env.RUN_ID ?? 'jh721fbd9rnvckyxz3p5annjjd8602x7';
const WIDTH = Number.parseInt(process.env.VIEWPORT_WIDTH ?? '1680', 10);
const HEIGHT = Number.parseInt(process.env.VIEWPORT_HEIGHT ?? '900', 10);
const HEADED = process.env.HEADED === '1';
const WAIT_MAX_MS = Number.parseInt(process.env.WAIT_MAX_MS ?? `${14 * 60_000}`, 10);
const CHAT_WAIT_MS = Number.parseInt(process.env.CHAT_WAIT_MS ?? `${90_000}`, 10);
const VERIFY_RECOVERY_AFTER_MS = Number.parseInt(
  process.env.VERIFY_RECOVERY_AFTER_MS ?? `${2 * 60_000}`,
  10,
);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(runsDir, `readme-${DEMO}-demo-${stamp}`);
const scenesDir = join(outDir, 'scenes');
const finalMp4 =
  process.env.OUTPUT ?? join(runsDir, `demo-${DEMO}-workflow-${stamp.slice(0, 10)}.mp4`);
const finalGif = finalMp4.replace(/\.mp4$/i, '.gif');
const finalGif720 = finalMp4.replace(/\.mp4$/i, '-720.gif');

const CORE_PROMPT =
  process.env.CORE_PROMPT ??
  'Design a polished SaaS onboarding landing page for a finance workspace. Include a clear hero headline, one primary CTA, supporting cards, and a calm premium visual system.';
const CORE_COMMENT =
  process.env.CORE_COMMENT ??
  'Make this primary CTA much more obvious: larger pill, brighter terracotta fill, bolder white label, and stronger shadow.';
const CORE_INPUT_MODE = process.env.CORE_INPUT_MODE ?? 'prompt';
const CORE_SOURCE_KIT_RUN_ID = process.env.CORE_SOURCE_KIT_RUN_ID ?? EXISTING_RUN_ID;
const CORE_RESUME_RUN_ID = process.env.CORE_RUN_ID ?? (DEMO === 'core' ? process.env.RUN_ID : null);
const CORE_START_SCENE_MP4 = process.env.CORE_START_SCENE_MP4
  ? resolve(process.env.CORE_START_SCENE_MP4)
  : null;
const INSPIRATION_QUERY =
  process.env.INSPIRATION_QUERY ??
  'premium AI workspace landing page with clear left rail, calm coaching sidebar, and strong primary CTA';

const evidence = {
  version: 1,
  demo: DEMO,
  createdAt: new Date().toISOString(),
  targetUrl: TARGET_URL,
  convexUrl: CONVEX_URL,
  runId: DEMO === 'core' ? null : EXISTING_RUN_ID,
  checks: {},
  scenes: [],
  outputs: {
    mp4: finalMp4,
    gif: finalGif,
    gif720: finalGif720,
  },
};

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function baseUrl(url) {
  return url.replace(/\/$/, '');
}

function runUrl(runId) {
  return `${baseUrl(TARGET_URL)}/?run=${encodeURIComponent(runId)}`;
}

function exportZipUrl(runId) {
  return `${baseUrl(CONVEX_SITE_URL)}/api/runs/${encodeURIComponent(runId)}/zip`;
}

async function convexCall(kind, path, args) {
  const res = await fetch(`${baseUrl(CONVEX_URL)}/api/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const json = await res.json();
  if (!res.ok || json.status === 'error') {
    throw new Error(`Convex ${kind} failed for ${path}: ${json.errorMessage ?? res.statusText}`);
  }
  return json.value;
}

async function convexQuery(path, args) {
  return await convexCall('query', path, args);
}

async function convexAction(path, args) {
  return await convexCall('action', path, args);
}

async function waitForRunDone(runId) {
  const started = Date.now();
  let last = '';
  let recoveryTriggered = false;
  while (Date.now() - started < WAIT_MAX_MS) {
    const [run, uiKit, parity] = await Promise.all([
      convexQuery('runs:get', { runId }).catch(() => null),
      convexQuery('uiKits:getLatest', { runId }).catch(() => null),
      convexQuery('parityReports:getLatest', { runId }).catch(() => null),
    ]);
    const status = `${run?.status ?? 'unknown'} uiKit=${Boolean(uiKit)} parity=${Boolean(parity)}`;
    if (status !== last) {
      console.log(`[proof:${DEMO}] ${status}`);
      last = status;
    }
    if (run?.status === 'failed') {
      throw new Error(`Run ${runId} failed: ${run.errorMessage ?? 'unknown error'}`);
    }
    if (uiKit && parity) {
      evidence.checks.completedRun = {
        visible: true,
        status: run.status,
        fileCount: Object.keys(uiKit.files ?? {}).length,
        parity: {
          passCount: parity.passCount,
          totalChecks: parity.totalChecks,
          status: parity.status,
        },
      };
      return { run, uiKit, parity };
    }
    if (uiKit && !parity && !recoveryTriggered && Date.now() - started > VERIFY_RECOVERY_AFTER_MS) {
      recoveryTriggered = true;
      const recovery = await convexAction('parityReports:reverifyForRun', { runId }).catch(
        (err) => ({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      evidence.checks.verifyRecovery = {
        visible: Boolean(recovery?.ok),
        result: recovery,
      };
    }
    await sleep(5000);
  }
  throw new Error(`Timed out waiting for run ${runId}`);
}

async function installOverlay(page) {
  await page.evaluate(() => {
    document.getElementById('__parity_proof_overlay')?.remove();
    document.getElementById('__parity_proof_overlay_style')?.remove();
    const style = document.createElement('style');
    style.id = '__parity_proof_overlay_style';
    style.textContent = `
      #__parity_proof_overlay {
        position: fixed;
        left: 28px;
        bottom: 28px;
        z-index: 2147483647;
        width: min(620px, calc(100vw - 56px));
        padding: 16px 18px;
        border: 1px solid rgba(128, 74, 45, 0.28);
        border-radius: 20px;
        background: rgba(255, 250, 244, 0.94);
        box-shadow: 0 18px 48px rgba(61, 39, 24, 0.20);
        color: #201711;
        font-family: ui-sans-serif, system-ui, sans-serif;
        pointer-events: none;
      }
      #__parity_proof_overlay .kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font: 800 11px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #9a5634;
      }
      #__parity_proof_overlay .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #d45f40;
        box-shadow: 0 0 0 5px rgba(212, 95, 64, 0.16);
      }
      #__parity_proof_overlay .title {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 28px;
        line-height: 1.02;
        letter-spacing: -0.035em;
        margin-bottom: 6px;
      }
      #__parity_proof_overlay .body {
        font-size: 14px;
        line-height: 1.45;
        color: #594a41;
      }
    `;
    document.head.appendChild(style);
    const overlay = document.createElement('div');
    overlay.id = '__parity_proof_overlay';
    overlay.innerHTML = `
      <div class="kicker"><span class="dot"></span><span data-kicker></span></div>
      <div class="title" data-title></div>
      <div class="body" data-body></div>
    `;
    document.body.appendChild(overlay);
  });
}

async function setStep(page, kicker, title, body) {
  await installOverlay(page);
  await page.evaluate(
    ({ kicker: nextKicker, title: nextTitle, body: nextBody }) => {
      document.querySelector('#__parity_proof_overlay [data-kicker]').textContent = nextKicker;
      document.querySelector('#__parity_proof_overlay [data-title]').textContent = nextTitle;
      document.querySelector('#__parity_proof_overlay [data-body]').textContent = nextBody;
    },
    { kicker, title, body },
  );
}

async function createRecordedPage(sceneName) {
  const videoDir = join(scenesDir, sceneName, 'video');
  await mkdir(videoDir, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADED, args: ['--start-maximized'] });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: videoDir, size: { width: WIDTH, height: HEIGHT } },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  return { browser, context, page, sceneName, videoDir, consoleErrors };
}

async function finishRecordedPage(handle) {
  await handle.context.close();
  await handle.browser.close();
  const videos = (await readdir(handle.videoDir)).filter((name) => name.endsWith('.webm'));
  if (videos.length === 0) throw new Error(`No video produced for ${handle.sceneName}`);
  const webm = join(handle.videoDir, videos[0]);
  const mp4 = join(scenesDir, handle.sceneName, `${handle.sceneName}.mp4`);
  runFfmpeg(
    [
      '-y',
      '-i',
      webm,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      mp4,
    ],
    `encode ${handle.sceneName}`,
  );
  evidence.scenes.push({
    name: handle.sceneName,
    mp4,
    durationSec: await probeDuration(mp4),
    consoleErrors: handle.consoleErrors,
  });
  return mp4;
}

async function recordScene(sceneName, fn) {
  console.log(`[proof:${DEMO}] recording ${sceneName}`);
  const handle = await createRecordedPage(sceneName);
  let thrown = null;
  try {
    await fn(handle.page);
  } catch (err) {
    thrown = err;
  }
  const mp4 = await finishRecordedPage(handle);
  if (thrown) throw thrown;
  return mp4;
}

async function getRunIdFromUrl(page) {
  for (let i = 0; i < 80; i += 1) {
    const url = new URL(page.url());
    const runId = url.searchParams.get('run');
    if (runId) return runId;
    await sleep(500);
  }
  return null;
}

async function startFreshRunScene() {
  return await recordScene('01-start-generate', async (page) => {
    await page.goto(baseUrl(TARGET_URL), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText('Parity Studio', { exact: false }).waitFor({ timeout: 30_000 });
    await setStep(
      page,
      'Core 1 / 6',
      'Start a real prompt run',
      'This is not a static tour: the demo starts a fresh prompt run and lets Parity generate, decompose, and verify it.',
    );
    await page.getByRole('button', { name: /^new run$/i }).click();
    await page.locator('[role="dialog"] textarea').first().fill(CORE_PROMPT);
    await page.waitForTimeout(1200);
    await page
      .getByRole('button', { name: /start run|generate/i })
      .last()
      .click();
    const runId = await getRunIdFromUrl(page);
    if (!runId) throw new Error('Fresh run did not put run id in URL');
    evidence.runId = runId;
    evidence.checks.startedRun = { visible: true, runId, prompt: CORE_PROMPT };
    await setStep(
      page,
      'Core 2 / 6',
      'Generation is running live',
      'The same run streams through generate, decompose, verify, and ambient quality repair in the background.',
    );
    await page.waitForTimeout(14_000);
  });
}

async function downloadSourceKitZip() {
  const zipPath = join(outDir, `source-${CORE_SOURCE_KIT_RUN_ID}.zip`);
  const res = await fetch(exportZipUrl(CORE_SOURCE_KIT_RUN_ID));
  if (!res.ok) {
    throw new Error(`Failed to download source kit zip: ${res.status} ${await res.text()}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1000) throw new Error('Downloaded source kit zip is unexpectedly small');
  await writeFile(zipPath, bytes);
  return zipPath;
}

async function startZipImportScene() {
  const sourceZip = await downloadSourceKitZip();
  return await recordScene('01-import-kit', async (page) => {
    await page.goto(baseUrl(TARGET_URL), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText('Parity Studio', { exact: false }).waitFor({ timeout: 30_000 });
    await setStep(
      page,
      'Core 1 / 6',
      'Start from a canonical ui_kit ZIP',
      'The original entry path is symmetric: drop a generated/exported ui_kit in, edit it, and export the same shape back out.',
    );
    await page.getByRole('button', { name: /^new run$/i }).click();
    await page.locator('[role="dialog"] input[type="file"]').first().setInputFiles(sourceZip);
    // ZIP import starts immediately after client-side parsing; prompt/image runs
    // use the Start button, but canonical kit imports intentionally skip it.
    const runId = await getRunIdFromUrl(page);
    if (!runId) throw new Error('Imported kit run did not put run id in URL');
    evidence.runId = runId;
    evidence.checks.startedRun = {
      visible: true,
      runId,
      inputMode: 'zip',
      sourceRunId: CORE_SOURCE_KIT_RUN_ID,
      sourceZip,
    };
    await setStep(
      page,
      'Core 2 / 6',
      'The imported kit verifies live',
      'Parity rebuilds the run, populates files, preview, coach, and export from the canonical ZIP.',
    );
    await page.waitForTimeout(9000);
  });
}

async function selectLikelyComponent(page) {
  await page
    .getByRole('tab', { name: /^files$/i })
    .click()
    .catch(() => {});
  await page.waitForTimeout(1200);
  const candidates = [
    'button[title*="Hero"]',
    'button[title*="CTA"]',
    'button[title*="Card"]',
    'button[title*="index.html"]',
    'button[title^="Scope next comment to ui_kits/"]',
    'button[title^="Scope next comment to preview/"]',
  ];
  for (const selector of candidates) {
    const btn = page.locator(selector).first();
    if ((await btn.count().catch(() => 0)) === 0) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    const title = await btn.getAttribute('title').catch(() => '');
    await btn.click();
    return title.replace(/^Scope next comment to\s+/, '');
  }
  throw new Error('No component/file row found');
}

async function clickMeaningfulPreviewElement(page) {
  const iframe = page.locator('iframe[title="artifact preview"]').first();
  await iframe.waitFor({ state: 'visible', timeout: 30_000 });
  const frame = page.frameLocator('iframe[title="artifact preview"]');
  const selectors = [
    'a:visible',
    'button:visible',
    '[role="button"]:visible',
    'h1:visible',
    'h2:visible',
  ];
  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    if ((await locator.count().catch(() => 0)) === 0) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.click({ position: { x: 12, y: 12 }, force: true });
    return selector;
  }
  const box = await iframe.boundingBox();
  if (!box) throw new Error('Artifact preview bbox unavailable');
  await page.mouse.click(box.x + box.width * 0.22, box.y + box.height * 0.34);
  return 'fallback-preview-point';
}

async function waitForChatUse(runId, beforeLength) {
  const started = Date.now();
  let lastCount = 0;
  while (Date.now() - started < CHAT_WAIT_MS) {
    const chat = await convexQuery('chat:list', { runId }).catch(() => []);
    const delta = chat.slice(beforeLength);
    if (delta.length !== lastCount) {
      lastCount = delta.length;
      console.log(`[proof:${DEMO}] chat delta ${delta.length}`);
    }
    const agentTurn = delta.find((turn) => turn.role !== 'user');
    const toolTurn = delta.find((turn) => turn.role === 'tool' || turn.toolName);
    const completion = [...delta]
      .reverse()
      .find((turn) => /change|complete|done|updated|patch|applied|sync/i.test(turn.content ?? ''));
    if (agentTurn && (toolTurn || completion)) {
      return {
        visible: true,
        delta: delta.length,
        agentTurn: agentTurn.turn,
        toolTurn: toolTurn?.turn,
        completionTurn: completion?.turn,
      };
    }
    await sleep(2500);
  }
  const chat = await convexQuery('chat:list', { runId }).catch(() => []);
  return {
    visible: chat.length > beforeLength,
    delta: Math.max(0, chat.length - beforeLength),
    timedOutBeforeCompletion: true,
  };
}

async function coreEditExportScene(runId) {
  return await recordScene('02-comment-edit-export', async (page) => {
    await page.goto(runUrl(runId), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText('Parity Studio', { exact: false }).waitFor({ timeout: 30_000 });
    await setStep(
      page,
      'Core 3 / 6',
      'Select the generated component',
      'The file selection scopes the next visual comment so the agent edits a slice instead of rewriting the whole artifact.',
    );
    const selectedFile = await selectLikelyComponent(page);
    evidence.checks.selectedFile = { visible: true, selectedFile };
    await page.waitForTimeout(2600);

    await page
      .getByRole('tab', { name: /^preview$/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(1600);
    await setStep(
      page,
      'Core 4 / 6',
      'Pin a meaningful design comment',
      'The comment is placed on a visible CTA/heading region and saved as an auto-fix request.',
    );
    const commentButton = page.getByRole('button', { name: /comment/i }).first();
    const pressed = await commentButton.getAttribute('aria-pressed').catch(() => 'false');
    if (pressed !== 'true') await commentButton.click();
    await page.waitForTimeout(900);
    const commentsBefore = await convexQuery('comments:listForRun', { runId }).catch(() => []);
    const chatBefore = await convexQuery('chat:list', { runId }).catch(() => []);
    const clicked = await clickMeaningfulPreviewElement(page);
    const textArea = page
      .locator('textarea[placeholder*="exact change" i], textarea[placeholder*="Describe"]')
      .first();
    await textArea.waitFor({ state: 'visible', timeout: 10_000 });
    await textArea.fill(CORE_COMMENT);
    evidence.checks.meaningfulComment = {
      visible: true,
      clicked,
      comment: CORE_COMMENT,
      previousCommentCount: commentsBefore.length,
    };
    await page.waitForTimeout(1000);

    await setStep(
      page,
      'Core 5 / 6',
      'The agent edits that scoped slice',
      'Save + auto-fix starts the advisor/executor loop, streams chat/tool work, and updates the generated kit files.',
    );
    await page.getByRole('button', { name: /save \+ auto-fix/i }).click();
    await page.waitForTimeout(2500);
    const chatUse = await waitForChatUse(runId, chatBefore.length);
    evidence.checks.agentScopedEdit = chatUse;
    await page.waitForTimeout(3000);

    await setStep(
      page,
      'Core 6 / 6',
      'Export the edited ui_kit',
      'The exported ZIP is the same canonical shape the user can hand to Claude Code, Codex, Cursor, or a real repo.',
    );
    await page
      .getByRole('tab', { name: /^files$/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(1200);
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
    const exportLink = page.getByRole('link', { name: /Export ZIP/i }).first();
    if ((await exportLink.count().catch(() => 0)) > 0) {
      await exportLink.click();
    } else {
      await page
        .getByRole('button', { name: /export/i })
        .first()
        .click();
      await page.getByRole('menuitem').filter({ hasText: /zip/i }).first().click();
    }
    const download = await downloadPromise;
    if (!download) throw new Error('Export ZIP did not download');
    const suggested = download.suggestedFilename() || 'ui_kit.zip';
    const outZip = join(outDir, suggested);
    await download.saveAs(outZip);
    evidence.checks.exportZip = {
      visible: true,
      filename: suggested,
      size: (await stat(outZip)).size,
    };
    await page.waitForTimeout(3000);
  });
}

async function recordCore() {
  const scenes = [];
  if (CORE_INPUT_MODE === 'zip') {
    scenes.push(await startZipImportScene());
    const runId = evidence.runId;
    if (!runId) throw new Error('Core zip demo did not create a run id');
    await waitForRunDone(runId);
    scenes.push(await coreEditExportScene(runId));
    return scenes;
  }
  if (CORE_RESUME_RUN_ID) {
    evidence.runId = CORE_RESUME_RUN_ID;
    evidence.checks.startedRun = {
      visible: true,
      runId: CORE_RESUME_RUN_ID,
      prompt: CORE_PROMPT,
      resumedFromExistingRun: true,
      ...(CORE_START_SCENE_MP4 ? { startSceneMp4: CORE_START_SCENE_MP4 } : {}),
    };
    if (CORE_START_SCENE_MP4) {
      await stat(CORE_START_SCENE_MP4);
      scenes.push(CORE_START_SCENE_MP4);
      evidence.scenes.push({
        name: '01-start-generate',
        mp4: CORE_START_SCENE_MP4,
        durationSec: await probeDuration(CORE_START_SCENE_MP4),
        resumed: true,
      });
    }
    await waitForRunDone(CORE_RESUME_RUN_ID);
    scenes.push(await coreEditExportScene(CORE_RESUME_RUN_ID));
    return scenes;
  }
  scenes.push(await startFreshRunScene());
  const runId = evidence.runId;
  if (!runId) throw new Error('Core demo did not create a run id');
  await waitForRunDone(runId);
  scenes.push(await coreEditExportScene(runId));
  return scenes;
}

async function recordInspiration() {
  const runId = EXISTING_RUN_ID;
  evidence.runId = runId;
  return [
    await recordScene('01-inspiration-apply', async (page) => {
      await page.goto(runUrl(runId), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.getByText('Parity Studio', { exact: false }).waitFor({ timeout: 30_000 });
      await page.getByRole('tab', { name: /inspiration/i }).click();
      await setStep(
        page,
        'Inspiration 1 / 3',
        'Search references for this generated kit',
        'The user does not need to invent a redesign plan. Parity searches references and converts patterns into a safe brief.',
      );
      await page.locator('#inspiration-query').first().fill(INSPIRATION_QUERY);
      await page.getByRole('button', { name: /^search$/i }).click();
      await page.waitForTimeout(6000);
      const reportVisible =
        (await page.getByText('Recommended redesign plan', { exact: false }).count()) > 0;
      evidence.checks.inspirationSearch = { visible: reportVisible, query: INSPIRATION_QUERY };

      await setStep(
        page,
        'Inspiration 2 / 3',
        'Apply the plan to the agent',
        'The selected references become an actionable agent brief with safety constraints and provenance.',
      );
      const chatBefore = await convexQuery('chat:list', { runId }).catch(() => []);
      await page
        .getByRole('button', { name: /apply.*agent/i })
        .first()
        .click();
      await page.waitForTimeout(2500);
      await page
        .locator('aside[aria-label*="Agent stream" i]')
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      const chatUse = await waitForChatUse(runId, chatBefore.length);
      evidence.checks.inspirationApplied = chatUse;

      await setStep(
        page,
        'Inspiration 3 / 3',
        'The agent now works from the inspiration brief',
        'The workflow is search -> plan -> apply -> agent stream, not just a static reference gallery.',
      );
      await page.waitForTimeout(5000);
    }),
  ];
}

async function recordSync() {
  const runId = EXISTING_RUN_ID;
  evidence.runId = runId;
  async function openSyncModal(page) {
    const candidates = [
      page.getByRole('button', { name: /sync.*source/i }).first(),
      page.getByTitle(/patch this run|recapture the source route/i).first(),
      page
        .locator('button')
        .filter({ hasText: /sync source/i })
        .first(),
    ];
    for (const candidate of candidates) {
      if ((await candidate.count().catch(() => 0)) === 0) continue;
      if (!(await candidate.isVisible().catch(() => false))) continue;
      await candidate.click();
      await page
        .getByRole('dialog', { name: /sync from latest source/i })
        .waitFor({ state: 'visible', timeout: 10_000 });
      return;
    }
    throw new Error('Could not find the Sync source/version-control entry point');
  }
  return [
    await recordScene('01-source-sync', async (page) => {
      await page.goto(runUrl(runId), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.getByText('Parity Studio', { exact: false }).waitFor({ timeout: 30_000 });
      await page
        .getByRole('tab', { name: /^preview$/i })
        .click()
        .catch(() => {});
      await setStep(
        page,
        'Version 1 / 3',
        'Detect stale generated UI',
        'A saved kit is a snapshot. Source sync explains whether to patch this run or recapture the source route.',
      );
      await openSyncModal(page);
      await page.waitForTimeout(3000);
      const syncVisible =
        (await page.getByText('Sync from latest source', { exact: false }).count()) > 0;
      evidence.checks.syncModal = { visible: syncVisible };

      await setStep(
        page,
        'Version 2 / 3',
        'Recapture private/local apps through MCP',
        'When localhost or repo context changed broadly, users copy MCP setup so keys and private code stay local.',
      );
      await page
        .getByRole('button', { name: /copy mcp setup/i })
        .click()
        .catch(() => {});
      await page.waitForTimeout(5200);
      evidence.checks.mcpSetup = {
        visible:
          (await page
            .getByText('No local agent connected yet', { exact: false })
            .count()
            .catch(() => 0)) > 0,
      };

      await setStep(
        page,
        'Version 3 / 3',
        'Patch this run from the website',
        'For a visible stale surface, the web app can ask the agent to patch the current kit directly, then stream the work in chat.',
      );
      const chatBefore = await convexQuery('chat:list', { runId }).catch(() => []);
      await page.getByRole('button', { name: /ask agent to sync/i }).click();
      await page.waitForTimeout(2500);
      const chatUse = await waitForChatUse(runId, chatBefore.length);
      evidence.checks.syncPatch = chatUse;
      await page.waitForTimeout(5200);
    }),
  ];
}

async function probeDuration(file) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return null;
  const value = Number.parseFloat((r.stdout ?? '').trim());
  return Number.isFinite(value) ? value : null;
}

function runFfmpeg(args, label) {
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${label} failed`);
}

async function concatScenes(sceneFiles) {
  if (sceneFiles.length === 1) {
    runFfmpeg(
      ['-y', '-i', sceneFiles[0], '-c:v', 'copy', '-an', finalMp4],
      `copy final ${finalMp4}`,
    );
    return;
  }
  const filter = `${sceneFiles
    .map((_, index) => `[${index}:v]scale=${WIDTH}:${HEIGHT},setsar=1,fps=30[v${index}]`)
    .join(
      ';',
    )};${sceneFiles.map((_, index) => `[v${index}]`).join('')}concat=n=${sceneFiles.length}:v=1[outv]`;
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
  runFfmpeg(args, `concat final ${finalMp4}`);
}

async function writeGif(input, output, width, fps) {
  const palette = output.replace(/\.gif$/i, '.palette.png');
  runFfmpeg(
    [
      '-y',
      '-i',
      input,
      '-vf',
      `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`,
      palette,
    ],
    `palettegen ${output}`,
  );
  runFfmpeg(
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
    `paletteuse ${output}`,
  );
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(scenesDir, { recursive: true });
  let sceneFiles;
  if (DEMO === 'core') sceneFiles = await recordCore();
  else if (DEMO === 'inspiration') sceneFiles = await recordInspiration();
  else if (DEMO === 'sync') sceneFiles = await recordSync();
  else throw new Error(`Unknown DEMO=${DEMO}; use core, inspiration, or sync`);

  await concatScenes(sceneFiles);
  await writeGif(finalMp4, finalGif, 960, DEMO === 'core' ? 12 : 10);
  await writeGif(finalMp4, finalGif720, 720, DEMO === 'core' ? 10 : 8);

  evidence.outputs.durationSec = await probeDuration(finalMp4);
  evidence.outputs.mp4Size = (await stat(finalMp4)).size;
  evidence.outputs.gifSize = (await stat(finalGif)).size;
  evidence.outputs.gif720Size = (await stat(finalGif720)).size;
  evidence.outputs.releaseAssetNames = {
    mp4: `demo-${DEMO}-workflow.mp4`,
    gif: `demo-${DEMO}-workflow.gif`,
    gif720: `demo-${DEMO}-workflow-720.gif`,
  };
  const evidencePath = join(outDir, 'evidence.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`[proof:${DEMO}] mp4:      ${finalMp4}`);
  console.log(`[proof:${DEMO}] gif:      ${finalGif}`);
  console.log(`[proof:${DEMO}] gif720:   ${finalGif720}`);
  console.log(`[proof:${DEMO}] evidence: ${evidencePath}`);
}

main().catch((err) => {
  console.error(`[proof:${DEMO}] fatal:`, err);
  process.exit(1);
});
