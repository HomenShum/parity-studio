#!/usr/bin/env node
// Record a README/release demo for the current Parity Studio workflow surface.
//
// This is separate from the v0.1.0 six-step demo. It focuses on newer product
// workflows: launch + model routing, BYOK/session privacy, run history/chat,
// file CRUD/source preview, Parity Coach, Inspiration, source sync/MCP setup,
// i18n, and export formats.

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runsDir = resolve(repoRoot, 'runs');

const TARGET_URL = process.env.PARITY_STUDIO_URL ?? 'https://parity-studio.vercel.app';
const RUN_ID = process.env.RUN_ID ?? 'jh721fbd9rnvckyxz3p5annjjd8602x7';
const WIDTH = Number.parseInt(process.env.VIEWPORT_WIDTH ?? '1680', 10);
const HEIGHT = Number.parseInt(process.env.VIEWPORT_HEIGHT ?? '900', 10);
const HEADED = process.env.HEADED === '1';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(runsDir, `current-workflows-demo-${stamp}`);
const videoDir = join(outDir, 'video');
const finalMp4 =
  process.env.OUTPUT ?? join(runsDir, `demo-current-workflows-${stamp.slice(0, 10)}.mp4`);
const finalGif = finalMp4.replace(/\.mp4$/i, '.gif');
const finalGif720 = finalMp4.replace(/\.mp4$/i, '-720.gif');

const evidence = {
  version: 1,
  createdAt: new Date().toISOString(),
  targetUrl: TARGET_URL,
  runId: RUN_ID,
  checks: {},
  outputs: {
    mp4: finalMp4,
    gif: finalGif,
    gif720: finalGif720,
    releaseAssetNames: {
      mp4: 'demo-current-workflows.mp4',
      gif: 'demo-current-workflows.gif',
      gif720: 'demo-current-workflows-720.gif',
    },
  },
};

function appUrl() {
  return `${TARGET_URL.replace(/\/$/, '')}/?run=${encodeURIComponent(RUN_ID)}`;
}

async function sleep(ms) {
  return await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function installOverlay(page) {
  await page.evaluate(() => {
    const prior = document.getElementById('__parity_current_demo_overlay');
    if (prior) prior.remove();
    const priorStyle = document.getElementById('__parity_current_demo_overlay_style');
    if (priorStyle) priorStyle.remove();

    const style = document.createElement('style');
    style.id = '__parity_current_demo_overlay_style';
    style.textContent = `
      #__parity_current_demo_overlay {
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
      #__parity_current_demo_overlay .kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font: 800 11px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #9a5634;
      }
      #__parity_current_demo_overlay .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #d45f40;
        box-shadow: 0 0 0 5px rgba(212, 95, 64, 0.16);
      }
      #__parity_current_demo_overlay .title {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 28px;
        line-height: 1.02;
        letter-spacing: -0.035em;
        margin-bottom: 6px;
      }
      #__parity_current_demo_overlay .body {
        font-size: 14px;
        line-height: 1.45;
        color: #594a41;
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = '__parity_current_demo_overlay';
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
      document.querySelector('#__parity_current_demo_overlay [data-kicker]').textContent =
        nextKicker;
      document.querySelector('#__parity_current_demo_overlay [data-title]').textContent = nextTitle;
      document.querySelector('#__parity_current_demo_overlay [data-body]').textContent = nextBody;
    },
    { kicker, title, body },
  );
}

async function clickFirst(page, locators, timeout = 4000) {
  for (const locator of locators) {
    const item = typeof locator === 'string' ? page.locator(locator).first() : locator.first();
    if ((await item.count().catch(() => 0)) === 0) continue;
    if (!(await item.isVisible({ timeout: 500 }).catch(() => false))) continue;
    await item.click({ timeout });
    return true;
  }
  return false;
}

async function waitForAnyText(page, texts, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const text of texts) {
      if (
        (await page
          .getByText(text, { exact: false })
          .count()
          .catch(() => 0)) > 0
      )
        return true;
    }
    await sleep(300);
  }
  return false;
}

async function selectFirstFile(page) {
  await page
    .getByRole('tab', { name: /^files$/i })
    .click()
    .catch(() => {});
  await page.waitForTimeout(1200);
  const preferred = [
    'button[title*="App.tsx"]',
    'button[title*="AgentRail.tsx"]',
    'button[title*="index.html"]',
    'button[title*="BackgroundMediaHero.tsx"]',
    'button[title^="Scope next comment to"]',
  ];
  for (const selector of preferred) {
    const btn = page.locator(selector).first();
    if ((await btn.count().catch(() => 0)) === 0) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    const title = await btn.getAttribute('title').catch(() => null);
    await btn.click();
    return title?.replace(/^Scope next comment to\s+/, '') ?? selector;
  }
  throw new Error('No file row found to select');
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
  await mkdir(videoDir, { recursive: true });
  console.log(`[current-demo] target: ${appUrl()}`);
  console.log(`[current-demo] output: ${finalMp4}`);

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

  await page.goto(appUrl(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByText('Parity Studio', { exact: false }).waitFor({ timeout: 30_000 });
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(2000);

  await setStep(
    page,
    'Current workflow 1 / 8',
    'One agent rail for launch, keys, history, and chat',
    'The left sidebar is now the command center: start runs, manage BYOK, revisit history, and keep the live agent stream visible.',
  );
  evidence.checks.agentRail = {
    visible:
      (await page
        .getByText('Agent stream', { exact: false })
        .count()
        .catch(() => 0)) > 0 &&
      (await page
        .getByText('New run', { exact: false })
        .count()
        .catch(() => 0)) > 0,
  };
  await page.waitForTimeout(4200);

  await clickFirst(page, [
    page.getByRole('button', { name: /^new run$/i }),
    page.getByText('New run', { exact: true }),
  ]);
  await setStep(
    page,
    'Current workflow 2 / 8',
    'Start with an idea, image, or ui_kit',
    'The launch modal explains all entry paths and keeps the model route picker at the top of the composer.',
  );
  const launchVisible = await waitForAnyText(page, ['Start with an idea', 'Prompt', 'Image']);
  await page
    .getByText('Balanced AI', { exact: false })
    .first()
    .click()
    .catch(() => {});
  await waitForAnyText(page, ['Best quality AI', 'Free AI route', 'Advanced'], 3000);
  evidence.checks.launchAndModelRoute = { visible: launchVisible };
  await page.waitForTimeout(5200);
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page
    .getByRole('button', { name: /^close$/i })
    .first()
    .click()
    .catch(() => {});
  await page
    .locator('[role="dialog"]')
    .waitFor({ state: 'detached', timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(700);

  await clickFirst(page, [page.getByRole('button', { name: /keys.*byok/i })]);
  await setStep(
    page,
    'Current workflow 3 / 8',
    'Session privacy and BYOK are explicit',
    'Browser fields stay scoped to this tab/session. The secure path is copying MCP env so provider keys stay local.',
  );
  const byokVisible = await waitForAnyText(page, ['Session privacy', 'Copy MCP env', 'Clear keys']);
  evidence.checks.byok = { visible: byokVisible };
  await page.waitForTimeout(5200);

  const selectedFile = await selectFirstFile(page);
  await setStep(
    page,
    'Current workflow 4 / 8',
    'Files are editable, exportable, and scoped',
    'Selecting a file scopes the next comment/edit. The file workspace exposes save, revert, rename, delete, and ZIP handoff.',
  );
  const editorVisible = await waitForAnyText(page, ['File workspace', 'browse + edit', 'save']);
  evidence.checks.files = { visible: editorVisible, selectedFile };
  await clickFirst(page, [page.getByRole('button', { name: /preview source image/i })], 2000).catch(
    () => {},
  );
  await page.waitForTimeout(6200);

  await page
    .getByRole('tab', { name: /^preview$/i })
    .click()
    .catch(() => {});
  await setStep(
    page,
    'Current workflow 5 / 8',
    'Parity Coach explains end-user impact',
    'The right rail now summarizes what the score means for trust, clarity, and adoption instead of dumping raw check rows first.',
  );
  const coachVisible = await waitForAnyText(page, ['End-user impact', 'Top recommendations']);
  evidence.checks.parityCoach = { visible: coachVisible };
  await page.waitForTimeout(5600);

  await page.getByRole('tab', { name: /inspiration/i }).click();
  await setStep(
    page,
    'Current workflow 6 / 8',
    'Inspiration search becomes an agent brief',
    'Parity searches references, extracts safe patterns, and can apply a plan to the current ui_kit without copying assets.',
  );
  const inspirationVisible = await waitForAnyText(page, [
    'Inspiration workflow',
    'Top reference products',
    'Recommended redesign plan',
  ]);
  const searchInput = page.locator('#inspiration-query').first();
  if ((await searchInput.count().catch(() => 0)) > 0) {
    await searchInput.fill('premium AI workspace with clear left rail and coach sidebar');
  }
  await page.waitForTimeout(6500);
  evidence.checks.inspiration = { visible: inspirationVisible };

  await clickFirst(page, [
    page.getByRole('button', { name: /sync source/i }),
    page.getByTitle(/recapture the source route/i),
  ]);
  await setStep(
    page,
    'Current workflow 7 / 8',
    'Version control explains patch vs. recapture',
    'Website users can patch this run. Local/private apps use the copied MCP setup so localhost and provider keys stay on the user machine.',
  );
  const syncVisible = await waitForAnyText(page, [
    'Sync from latest source',
    'Patch this run',
    'Copy MCP setup',
  ]);
  evidence.checks.sourceSync = { visible: syncVisible };
  await page.waitForTimeout(6500);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(700);

  await setStep(
    page,
    'Current workflow 8 / 8',
    'Language and export are first-class',
    'The header supports preview device, zoom, ZIP/HTML/Markdown export, comment mode, and English/Simplified Chinese switching.',
  );
  await page
    .locator('select[aria-label="Language"]')
    .selectOption('zh-CN')
    .catch(() => {});
  await page.waitForTimeout(1800);
  await page
    .locator('select[aria-label*="语言"], select[aria-label="Language"]')
    .selectOption('en')
    .catch(() => {});
  await page.waitForTimeout(700);
  await clickFirst(page, [page.getByRole('button', { name: /export/i })], 2000).catch(() => {});
  const exportVisible = await waitForAnyText(page, ['ZIP', 'HTML', 'Markdown'], 2500);
  evidence.checks.i18nAndExport = { visible: exportVisible };
  await page.waitForTimeout(5200);

  await context.close();
  await browser.close();

  const videos = (await readdir(videoDir)).filter((name) => name.endsWith('.webm'));
  if (videos.length === 0) throw new Error('Playwright did not write a recorded video');
  const sourceWebm = join(videoDir, videos[0]);
  runFfmpeg(
    [
      '-y',
      '-i',
      sourceWebm,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      finalMp4,
    ],
    'mp4 encode',
  );
  await writeGif(finalMp4, finalGif, 960, 12);
  await writeGif(finalMp4, finalGif720, 720, 10);

  evidence.outputs.durationSec = await probeDuration(finalMp4);
  evidence.outputs.mp4Size = (await stat(finalMp4)).size;
  evidence.outputs.gifSize = (await stat(finalGif)).size;
  evidence.outputs.gif720Size = (await stat(finalGif720)).size;
  evidence.consoleErrors = consoleErrors;

  const evidencePath = join(outDir, 'evidence.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`[current-demo] mp4:      ${finalMp4}`);
  console.log(`[current-demo] gif:      ${finalGif}`);
  console.log(`[current-demo] gif 720:  ${finalGif720}`);
  console.log(`[current-demo] evidence: ${evidencePath}`);
}

main().catch((err) => {
  console.error('[current-demo] fatal:', err);
  process.exit(1);
});
