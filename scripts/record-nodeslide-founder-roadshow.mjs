#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  MissingRoadshowCapabilityError,
  REQUIRED_ROADSHOW_SCENES,
  ROADSHOW_VIDEO,
  assertRoadshowLiveReady,
  browserChromeMarkup,
  buildCaptionTimeline,
  buildFfmpegCommands,
  buildSrt,
  readRoadshowJson,
  recorderEvidenceSkeleton,
  sanitizeEvidenceUrl,
  validateRoadshowContract,
} from './nodeslide-founder-roadshow-lib.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storyboardPath = resolve(repoRoot, 'docs/demo/founder-roadshow/storyboard.json');
const captionsPath = resolve(repoRoot, 'docs/demo/founder-roadshow/captions.json');
const defaultTargetUrl = 'https://parity-studio.vercel.app/';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const CREATION_PROMPT = [
  'Create a six-slide founder roadshow for NodeSlide aimed at early-stage AI investors.',
  'Explain the evidence-to-story problem, the structured authoring insight, the editable workflow,',
  'measured prototype proof, the founder and researcher wedge, and the next design-partner milestone.',
  'Use the attached PRD, TDD, measured metrics, dogfooding notes, and design reference.',
  'Use web research only for cited external claims. Include native editable text, chart, math, image,',
  'and diagram primitives. Distinguish measured evidence from future targets. Add concise speaker notes.',
].join(' ');

const args = parseArgs(process.argv.slice(2));
const targetUrl = canonicalTarget(
  args.targetUrl ?? process.env.NODESLIDE_DEMO_URL ?? defaultTargetUrl,
);
const mode = args.dryRun ? 'dry-run' : 'live';
const outputDir = resolve(
  args.outputDir ??
    process.env.NODESLIDE_DEMO_OUTPUT ??
    resolve(repoRoot, 'artifacts', `nodeslide-founder-roadshow-${stamp}`),
);
const typingDelayMs = positiveInteger(
  process.env.NODESLIDE_TYPING_DELAY_MS ?? args.typingDelayMs ?? '14',
  'typing delay',
);
const headed = args.headed || process.env.NODESLIDE_RECORDER_HEADED === '1';

await main();

async function main() {
  await mkdir(outputDir, { recursive: true });
  const [storyboard, captionPlan] = await Promise.all([
    readRoadshowJson(storyboardPath),
    readRoadshowJson(captionsPath),
  ]);
  const contract = validateRoadshowContract(storyboard, captionPlan);
  const commitSha = gitCommitSha();
  const evidence = recorderEvidenceSkeleton({ targetUrl, commitSha, mode, storyboard });
  evidence.contract = contract;
  evidence.storyboardPath = relativeRepoPath(storyboardPath);
  evidence.captionsPath = relativeRepoPath(captionsPath);

  const inputPaths = storyboard.inputs.map((path) => resolve(repoRoot, path));
  evidence.inputs = await inspectInputs(inputPaths);
  const imagePath = resolveOptionalPath(
    args.imagePath ?? process.env.NODESLIDE_DEMO_IMAGE_PATH ?? null,
  );
  evidence.imageInput = imagePath ? await inspectInput(imagePath) : null;

  if (args.dryRun) {
    await writeDryRun({ storyboard, captionPlan, evidence });
    return;
  }

  assertRoadshowLiveReady(storyboard);
  assertFfmpegAvailable();
  assertRequiredInputs(evidence.inputs);
  if (!imagePath || !evidence.imageInput?.exists) {
    throw new Error(
      'Live recording requires NODESLIDE_DEMO_IMAGE_PATH (or --image-path) pointing to a rights-cleared local image.',
    );
  }

  const rawDir = resolve(outputDir, 'raw');
  const downloadsDir = resolve(outputDir, 'downloads');
  const failuresDir = resolve(outputDir, 'failures');
  await Promise.all([
    mkdir(rawDir, { recursive: true }),
    mkdir(downloadsDir, { recursive: true }),
    mkdir(failuresDir, { recursive: true }),
  ]);

  console.log(`[roadshow] target: ${targetUrl}`);
  console.log(`[roadshow] output: ${outputDir}`);
  console.log(`[roadshow] browser: ${headed ? 'headed debug mode' : 'headless/background-safe'}`);
  console.log(`[roadshow] contract: ${contract.sceneCount} required scenes, no silent skips`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: !headed,
      args: headed ? ['--start-maximized'] : [],
    });
    const preRoll = await recordBrowserPreRoll(browser, rawDir, targetUrl);
    evidence.outputs.browserChromePng = preRoll.browserChromePng;
    evidence.outputs.preRollRaw = preRoll.videoPath;
    evidence.preRollDurationMs = Math.round((await probeDuration(preRoll.videoPath)) * 1_000);

    const product = await recordProduct({
      browser,
      targetUrl,
      outputDir,
      rawDir,
      downloadsDir,
      failuresDir,
      storyboard,
      captionPlan,
      evidence,
      inputPaths,
      imagePath,
    });
    evidence.outputs.productRaw = product.videoPath;
    evidence.productDurationMs = Math.round((await probeDuration(product.videoPath)) * 1_000);

    const captionTimeline = buildCaptionTimeline(
      evidence.scenes,
      captionPlan,
      evidence.preRollDurationMs,
    );
    const srtPath = resolve(outputDir, 'nodeslide-founder-roadshow.srt');
    await writeFile(srtPath, buildSrt(captionTimeline), 'utf8');
    evidence.captions = captionTimeline;
    evidence.outputs.srt = srtPath;

    const ffmpeg = buildFfmpegCommands({
      preRollRaw: preRoll.videoPath,
      productRaw: product.videoPath,
      browserChromePng: preRoll.browserChromePng,
      captionsSrt: srtPath,
      outputDir,
    });
    evidence.ffmpeg = ffmpeg.commands.map((command) => ({
      label: command.label,
      executable: command.executable,
      args: command.args,
    }));
    for (const command of ffmpeg.commands) runCommand(command);

    const finalStats = await stat(ffmpeg.outputs.finalMp4);
    evidence.outputs.finalMp4 = ffmpeg.outputs.finalMp4;
    evidence.outputs.finalBytes = finalStats.size;
    evidence.outputs.finalDurationSeconds = await probeDuration(ffmpeg.outputs.finalMp4);
    evidence.outputs.finalSha256 = await sha256File(ffmpeg.outputs.finalMp4);
    evidence.verdict = 'passed';
    evidence.completedAt = new Date().toISOString();
    await writeEvidence(evidence);
    console.log(`[roadshow] final: ${ffmpeg.outputs.finalMp4}`);
    console.log(`[roadshow] captions: ${srtPath}`);
    console.log(`[roadshow] evidence: ${resolve(outputDir, 'evidence.json')}`);
  } catch (error) {
    evidence.verdict = 'failed';
    evidence.completedAt = new Date().toISOString();
    evidence.failure = serializeError(error);
    await writeEvidence(evidence);
    console.error(`[roadshow] failed: ${error.message}`);
    console.error(`[roadshow] evidence: ${resolve(outputDir, 'evidence.json')}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function writeDryRun({ storyboard, captionPlan, evidence }) {
  const missingInputs = evidence.inputs.filter((input) => !input.exists).map((input) => input.path);
  let clock = 0;
  const captionByScene = new Map(captionPlan.captions.map((caption) => [caption.sceneId, caption]));
  evidence.scenes = storyboard.scenes.map((scene) => {
    const minimum = captionByScene.get(scene.id)?.minimumDurationMs ?? 2_500;
    const result = {
      id: scene.id,
      title: scene.title,
      hook: scene.hook,
      status: 'passed',
      startedAtMs: clock,
      endedAtMs: clock + minimum + 800,
      dryRun: true,
    };
    clock = result.endedAtMs + 240;
    return result;
  });
  const timeline = buildCaptionTimeline(
    evidence.scenes,
    captionPlan,
    ROADSHOW_VIDEO.preRollMinimumMs,
  );
  const srtPath = resolve(outputDir, 'captions-preview.srt');
  await writeFile(srtPath, buildSrt(timeline), 'utf8');
  const ffmpeg = buildFfmpegCommands({
    preRollRaw: resolve(outputDir, 'raw', 'browser-preroll.webm'),
    productRaw: resolve(outputDir, 'raw', 'product.webm'),
    browserChromePng: resolve(outputDir, 'browser-chrome.png'),
    captionsSrt: srtPath,
    outputDir,
  });
  evidence.captions = timeline;
  evidence.outputs.srtPreview = srtPath;
  evidence.ffmpeg = ffmpeg.commands;
  evidence.preflight = {
    missingInputs,
    imageInputPresent: Boolean(evidence.imageInput?.exists),
    pendingHooks: evidence.pendingHooks,
  };
  evidence.verdict =
    evidence.pendingHooks.length === 0 && missingInputs.length === 0 && evidence.imageInput?.exists
      ? 'dry-run-live-ready'
      : 'dry-run-contract-valid-live-blocked';
  evidence.completedAt = new Date().toISOString();
  await writeEvidence(evidence, 'dry-run-evidence.json');

  console.log(`[roadshow:dry-run] contract valid: ${REQUIRED_ROADSHOW_SCENES.length} scenes`);
  if (evidence.pendingHooks.length > 0) {
    for (const hook of evidence.pendingHooks) {
      console.log(`[roadshow:dry-run] LIVE BLOCKER ${hook.sceneId}: ${hook.reason}`);
    }
  }
  for (const path of missingInputs)
    console.log(`[roadshow:dry-run] LIVE BLOCKER missing input: ${path}`);
  if (!evidence.imageInput?.exists) {
    console.log('[roadshow:dry-run] LIVE BLOCKER: NODESLIDE_DEMO_IMAGE_PATH is not ready');
  }
  console.log(`[roadshow:dry-run] SRT: ${srtPath}`);
  console.log(`[roadshow:dry-run] evidence: ${resolve(outputDir, 'dry-run-evidence.json')}`);
}

async function recordBrowserPreRoll(browser, rawDir, url) {
  const videoDir = resolve(rawDir, 'browser-preroll-video');
  await mkdir(videoDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: ROADSHOW_VIDEO.width, height: ROADSHOW_VIDEO.height },
    recordVideo: {
      dir: videoDir,
      size: { width: ROADSHOW_VIDEO.width, height: ROADSHOW_VIDEO.height },
    },
  });
  const page = await context.newPage();
  const video = page.video();
  const started = Date.now();
  await page.setContent(browserChromeMarkup(url), { waitUntil: 'load' });
  const address = page.getByLabel('Address');
  await moveVirtualCursor(page, address, { durationMs: 760 });
  await clickPulse(page);
  await address.click();
  await address.pressSequentially(url, { delay: Math.max(24, typingDelayMs) });
  await page.keyboard.press('Enter');
  await address.evaluate((element) => element.blur());
  await page.locator('.stage span').evaluate((element) => {
    element.textContent = 'Loading NodeSlide…';
  });
  while (Date.now() - started < ROADSHOW_VIDEO.preRollMinimumMs) await page.waitForTimeout(120);
  await page.evaluate(() => {
    const cursor = document.getElementById('__nodeslide_demo_cursor');
    if (cursor) cursor.style.display = 'none';
  });
  const browserChromePng = resolve(rawDir, 'browser-chrome.png');
  await page.screenshot({
    path: browserChromePng,
    clip: {
      x: 0,
      y: 0,
      width: ROADSHOW_VIDEO.width,
      height: ROADSHOW_VIDEO.browserChromeHeight,
    },
  });
  await page.close();
  await context.close();
  const videoPath = resolve(rawDir, 'browser-preroll.webm');
  await video.saveAs(videoPath);
  return { videoPath, browserChromePng };
}

async function recordProduct({
  browser,
  targetUrl,
  outputDir,
  rawDir,
  downloadsDir,
  failuresDir,
  storyboard,
  captionPlan,
  evidence,
  inputPaths,
  imagePath,
}) {
  const videoDir = resolve(rawDir, 'product-video');
  await mkdir(videoDir, { recursive: true });
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const context = await browser.newContext({
    viewport: { width: ROADSHOW_VIDEO.width, height: ROADSHOW_VIDEO.appHeight },
    recordVideo: {
      dir: videoDir,
      size: { width: ROADSHOW_VIDEO.width, height: ROADSHOW_VIDEO.appHeight },
    },
    acceptDownloads: true,
    ...(bypass
      ? {
          extraHTTPHeaders: {
            'x-vercel-protection-bypass': bypass,
            'x-vercel-set-bypass-cookie': 'true',
          },
        }
      : {}),
  });
  await context.addInitScript(virtualCursorInit);
  const page = await context.newPage();
  const video = page.video();
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text().slice(0, 1_000));
  });
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message.slice(0, 1_000)));
  const productStartedAt = Date.now();
  const captionByScene = new Map(captionPlan.captions.map((caption) => [caption.sceneId, caption]));
  const state = {
    page,
    targetUrl,
    outputDir,
    downloadsDir,
    inputPaths,
    imagePath,
    evidence,
    primitiveSlides: new Map(),
    pendingProposal: null,
    lastAcceptedVersion: null,
  };

  const hooks = createSceneHooks(state);
  try {
    for (const scene of [...storyboard.scenes].sort((a, b) => a.sequence - b.sequence)) {
      const hook = hooks[scene.id];
      if (!hook) throw new Error(`No runtime hook registered for required scene ${scene.id}`);
      const startedAtMs = Date.now() - productStartedAt;
      console.log(`[roadshow] scene ${scene.sequence}/${storyboard.scenes.length}: ${scene.id}`);
      try {
        const details = await hook();
        const minimum = captionByScene.get(scene.id)?.minimumDurationMs ?? 2_500;
        const elapsed = Date.now() - productStartedAt - startedAtMs;
        if (elapsed < minimum + 420) await page.waitForTimeout(minimum + 420 - elapsed);
        evidence.scenes.push({
          id: scene.id,
          title: scene.title,
          hook: scene.hook,
          status: 'passed',
          startedAtMs,
          endedAtMs: Date.now() - productStartedAt,
          details: redactDetails(details),
        });
      } catch (error) {
        const failurePath = resolve(failuresDir, `${scene.sequence}-${scene.id}.png`);
        await page.screenshot({ path: failurePath, fullPage: false }).catch(() => {});
        evidence.scenes.push({
          id: scene.id,
          title: scene.title,
          hook: scene.hook,
          status: 'failed',
          startedAtMs,
          endedAtMs: Date.now() - productStartedAt,
          failure: serializeError(error),
          screenshot: failurePath,
        });
        throw error;
      }
    }
    if (evidence.pageErrors.length > 0 || evidence.consoleErrors.length > 0) {
      throw new Error(
        `The product capture emitted ${evidence.pageErrors.length} page error(s) and ${evidence.consoleErrors.length} console error(s).`,
      );
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
  const videoPath = resolve(rawDir, 'product.webm');
  await video.saveAs(videoPath);
  return { videoPath };
}

function createSceneHooks(state) {
  return {
    fresh_landing: async () => {
      await state.page.goto(state.targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await state.page
        .getByTestId('nodeslide-landing')
        .waitFor({ state: 'visible', timeout: 60_000 });
      const url = new URL(state.page.url());
      if (url.pathname !== '/' || url.search) {
        throw new Error(`Fresh landing is not canonical: ${sanitizeEvidenceUrl(url.toString())}`);
      }
      if ((await state.page.getByTestId('nodeslide-studio').count()) !== 0) {
        throw new Error('Editor mounted before a new deck was created.');
      }
      await ensureCursor(state.page);
      return { canonicalUrl: sanitizeEvidenceUrl(url.toString()), editorMounted: false };
    },

    attach_evidence: async () => {
      const button = await requiredLocator(state.page, 'attach_evidence', 'Attach data button', [
        [
          'role:button[name=Attach data]',
          () => state.page.getByRole('button', { name: 'Attach data' }),
        ],
        ['testid:landing-file-input sibling', () => state.page.getByTestId('landing-file-input')],
      ]);
      const fileInput = state.page.getByTestId('landing-file-input');
      if ((await fileInput.count()) !== 1) {
        throw new MissingRoadshowCapabilityError('attach_evidence', 'unique landing file input', [
          '[data-testid="landing-file-input"]',
        ]);
      }
      if ((await button.getAttribute('type').catch(() => null)) !== 'file') {
        await moveVirtualCursor(state.page, button);
      }
      await fileInput.setInputFiles(state.inputPaths);
      const shelf = state.page.getByLabel('Attached data files');
      await shelf.waitFor({ state: 'visible', timeout: 20_000 });
      const names = state.inputPaths.map((path) => path.split(/[\\/]/).at(-1));
      for (const name of names) {
        if (!(await shelf.getByText(name, { exact: false }).count())) {
          throw new Error(`Attached file is not visible in the composer: ${name}`);
        }
      }
      return { attachedFiles: names };
    },

    consent_model_web: async () => {
      const model = state.page.getByTestId('landing-model-select');
      await model.waitFor({ state: 'visible', timeout: 10_000 });
      const selectedModel = (await model.innerText()).trim();
      await humanClick(state.page, model);
      const dialog = state.page.getByRole('dialog', { name: 'Generation model' });
      await dialog.waitFor({ state: 'visible', timeout: 10_000 });
      const recommended = dialog
        .getByLabel('Recommended')
        .getByText(selectedModel, { exact: true });
      await humanClick(state.page, recommended);
      const consent = state.page.getByTestId('landing-provider-consent');
      await humanCheck(state.page, consent);
      return {
        selectedModel,
        creationConsent: true,
        webResearchConsent: 'deferred to the first editor research run',
      };
    },

    create_six_slide_deck: async () => {
      const prompt = state.page.getByLabel('Presentation brief');
      await humanType(state.page, prompt, CREATION_PROMPT);
      const submit = state.page.getByRole('button', { name: 'Create presentation' });
      if (await submit.isDisabled()) {
        throw new Error('Create presentation remains disabled after prompt, files, and consent.');
      }
      await humanClick(state.page, submit);
      await state.page.getByTestId('nodeslide-studio').waitFor({
        state: 'visible',
        timeout: 240_000,
      });
      await state.page
        .getByTestId('slide-navigator')
        .waitFor({ state: 'visible', timeout: 60_000 });
      const thumbnails = state.page.locator('[data-testid^="slide-thumbnail-"]');
      await waitForCount(thumbnails, 6, 60_000);
      const count = await thumbnails.count();
      if (count !== 6) throw new Error(`Expected exactly six new slides; found ${count}.`);
      return { deckUrl: sanitizeEvidenceUrl(state.page.url()), slideCount: count };
    },

    inspect_editable_primitives: async () => {
      const requiredKinds = ['text', 'chart', 'math', 'image', 'connector'];
      const thumbnails = state.page.locator('[data-testid^="slide-thumbnail-"]');
      const count = await thumbnails.count();
      const found = new Map();
      for (let index = 0; index < count; index += 1) {
        const thumbnail = thumbnails.nth(index);
        await humanClick(state.page, thumbnail, { durationMs: 260 });
        await state.page.waitForTimeout(350);
        for (const kind of requiredKinds) {
          const element = state.page
            .locator(`.ns-editor-edit-canvas .ns-slide-element--${kind}`)
            .first();
          if (!found.has(kind) && (await element.isVisible().catch(() => false))) {
            found.set(kind, index);
            state.primitiveSlides.set(kind, index);
          }
        }
      }
      const missing = requiredKinds.filter((kind) => !found.has(kind));
      if (missing.length) {
        throw new MissingRoadshowCapabilityError(
          'inspect_editable_primitives',
          `generated deck is missing editable primitive(s): ${missing.join(', ')}`,
          missing.map((kind) => `.ns-slide-element--${kind}`),
        );
      }
      return { primitiveSlideIndexes: Object.fromEntries(found) };
    },

    one_element_edit: async () => {
      await openPrimitive(state, 'text');
      const textElement = state.page
        .locator('.ns-editor-edit-canvas .ns-slide-element--text')
        .first();
      await humanClick(state.page, textElement);
      await configureAiRun(state, { scope: 'Selection', web: false });
      await submitAiInstruction(
        state,
        'Rewrite only this selected headline so it states one decisive investor takeaway. Preserve every other element and the current layout.',
      );
      state.pendingProposal = await waitForProposal(state.page);
      return { scope: 'one selected element', canonicalMutation: false };
    },

    compare_accept: async () => {
      const result = await compareAndAccept(state, state.pendingProposal);
      state.pendingProposal = null;
      return result;
    },

    one_slide_edit: async () => {
      await configureAiRun(state, { scope: 'This slide', web: true });
      await submitAiInstruction(
        state,
        'Strengthen only this slide with one concise externally verifiable claim about editable programmatic presentations. Use web research, bind the source to the exact claim, and leave the design structure intact.',
      );
      const proposal = await waitForProposal(state.page, 180_000);
      return await compareAndAccept(state, proposal);
    },

    bounded_multi_slide_edit: async () => {
      const slideSelectors = state.page.locator(
        '[data-testid^="slide-scope-select-"], [aria-label^="Select slide for AI scope"]',
      );
      if ((await slideSelectors.count()) < 2) {
        throw new MissingRoadshowCapabilityError(
          'bounded_multi_slide_edit',
          'a stable UI contract for selecting two explicit slide IDs as the write scope',
          ['[data-testid^="slide-scope-select-"]', '[aria-label^="Select slide for AI scope"]'],
        );
      }
      await humanCheck(state.page, slideSelectors.nth(0));
      await humanCheck(state.page, slideSelectors.nth(1));
      await configureAiRun(state, { scope: 'Selected slides', web: false });
      await submitAiInstruction(
        state,
        'Make the selected slides use parallel, action-led headlines. Change nothing outside this two-slide write scope.',
      );
      const proposal = await waitForProposal(state.page);
      return await compareAndAccept(state, proposal);
    },

    chart_change: async () => {
      await openPrimitive(state, 'chart');
      await humanClick(
        state.page,
        state.page.locator('.ns-editor-edit-canvas .ns-slide-element--chart').first(),
      );
      await openInspectorTab(state.page, 'design');
      const value = await requiredLocator(state.page, 'chart_change', 'first chart value', [
        ['testid:chart-value-0', () => state.page.getByTestId('chart-value-0')],
        ['label:Value for point 1', () => state.page.getByLabel('Value for point 1')],
      ]);
      const before = Number.parseFloat(await value.inputValue());
      if (!Number.isFinite(before)) throw new Error('The first chart value is not numeric.');
      const after = Number((before * 1.05 + 1).toFixed(2));
      await humanType(state.page, value, String(after));
      await humanClick(state.page, state.page.getByRole('button', { name: 'Apply chart data' }));
      await waitForValidationReady(state.page);
      return { changedPoint: 1, before, after };
    },

    math_change: async () => {
      await openPrimitive(state, 'math');
      await humanClick(
        state.page,
        state.page.locator('.ns-editor-edit-canvas .ns-slide-element--math').first(),
      );
      await openInspectorTab(state.page, 'design');
      const expression = await requiredLocator(state.page, 'math_change', 'Math expression', [
        ['label:Math expression', () => state.page.getByLabel('Math expression')],
        ['content group textarea', () => state.page.locator('.ns-text-content-field textarea')],
      ]);
      const before = await expression.inputValue();
      const after = 'R = accepted_reviewed_edits / accepted_edits';
      await humanType(state.page, expression, after);
      await expression.press('Control+Enter');
      await waitForValidationReady(state.page);
      return { before, after };
    },

    layout_change: async () => {
      await openPrimitive(state, 'text');
      await humanClick(
        state.page,
        state.page.locator('.ns-editor-edit-canvas .ns-slide-element--text').first(),
      );
      await openInspectorTab(state.page, 'design');
      const x = await requiredLocator(state.page, 'layout_change', 'X position', [
        ['label:X', () => state.page.getByLabel('X', { exact: true })],
        ['position first input', () => state.page.locator('.ns-field-grid--four input').first()],
      ]);
      const before = Number.parseFloat(await x.inputValue());
      if (!Number.isFinite(before)) throw new Error('X position is not numeric.');
      const after = Number(Math.min(88, before + 1.5).toFixed(1));
      await humanType(state.page, x, String(after));
      await x.press('Enter');
      await waitForValidationReady(state.page);
      return { property: 'x', before, after };
    },

    image_change: async () => {
      await openPrimitive(state, 'image');
      await humanClick(
        state.page,
        state.page.locator('.ns-editor-edit-canvas .ns-slide-element--image').first(),
      );
      await openInspectorTab(state.page, 'design');
      const alt = await requiredLocator(state.page, 'image_change', 'Alt text', [
        ['label:Alt text', () => state.page.getByLabel('Alt text')],
      ]);
      const credit = await requiredLocator(state.page, 'image_change', 'Image credit', [
        ['label:Credit', () => state.page.getByLabel('Credit')],
      ]);
      await humanType(state.page, alt, 'Founder reviewing a sourced, editable NodeSlide roadshow');
      await humanType(
        state.page,
        credit,
        process.env.NODESLIDE_DEMO_IMAGE_CREDIT ??
          'Rights-cleared demo image; source recorded by operator',
      );
      const upload = state.page.getByTestId('image-upload');
      await moveVirtualCursor(
        state.page,
        state.page.getByText('Upload downloaded image', { exact: false }),
      );
      await upload.setInputFiles(state.imagePath);
      await state.page
        .locator('.ns-editor-edit-canvas .ns-slide-element--image img')
        .waitFor({ state: 'visible', timeout: 30_000 });
      await waitForValidationReady(state.page);
      return {
        file: state.imagePath.split(/[\\/]/).at(-1),
        sha256: await sha256File(state.imagePath),
      };
    },

    trace_source_lineage: async () => {
      await openInspectorTab(state.page, 'trace');
      await state.page.getByRole('heading', { name: 'Run details' }).waitFor({
        state: 'visible',
        timeout: 30_000,
      });
      const attribution = state.page.locator('.ns-trace-attribution').first();
      const attributionText = cleanText(await attribution.textContent());
      if (
        !attributionText ||
        !/(openrouter|nebius|google|anthropic|openai|z-ai|glm)/i.test(attributionText)
      ) {
        throw new Error(
          `Trace does not expose a named provider/model: ${attributionText || '<empty>'}`,
        );
      }
      const citations = state.page.getByTestId('trace-source-citation');
      const citationCount = await citations.count();
      if (citationCount < 1) {
        throw new MissingRoadshowCapabilityError(
          'trace_source_lineage',
          'claim/element-bound source citation in the trace',
          ['[data-testid="trace-source-citation"]'],
        );
      }
      await humanClick(state.page, citations.first());
      return { attribution: attributionText, sourceCitationCount: citationCount };
    },

    persistent_memory: async () => {
      await openInspectorTab(state.page, 'ai');
      await humanClick(state.page, state.page.getByTestId('ai-memory'));
      const dialog = state.page.getByTestId('memory-dialog');
      await dialog.waitFor({ state: 'visible', timeout: 10_000 });
      const text = 'Prefer concise action-led headlines and cite every external market claim.';
      const input = dialog.getByPlaceholder(/Prefer concise executive headlines/i);
      await humanType(state.page, input, text);
      await humanClick(state.page, dialog.getByRole('button', { name: 'Add', exact: true }));
      await dialog.getByText(text, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
      const useMemory = dialog
        .getByText('Use relevant memory in new runs')
        .locator('..')
        .getByRole('checkbox');
      if (!(await useMemory.isChecked())) await humanCheck(state.page, useMemory);
      await humanClick(state.page, dialog.getByRole('button', { name: 'Close' }));
      return { category: 'preference', enabled: true };
    },

    present_share: async () => {
      await humanClick(state.page, state.page.getByTestId('present'));
      await state.page.locator('.ns-presenter').waitFor({ state: 'visible', timeout: 30_000 });
      await humanClick(state.page, state.page.getByRole('button', { name: 'Next slide' }));
      const notes = state.page.getByRole('button', { name: 'Notes' });
      if (await notes.count()) await humanClick(state.page, notes);
      await state.page.waitForTimeout(1_200);
      await humanClick(state.page, state.page.getByRole('button', { name: 'Exit presenter' }));
      await state.page
        .getByTestId('nodeslide-studio')
        .waitFor({ state: 'visible', timeout: 20_000 });
      await humanClick(state.page, state.page.getByTestId('share'));
      const dialog = state.page.getByRole('dialog', { name: 'Share a frozen, validated deck' });
      await dialog.waitFor({ state: 'visible', timeout: 10_000 });
      const publish = dialog.getByRole('button', {
        name: /Publish(?: current version)?(?: & copy link)?/i,
      });
      if (await publish.count()) await humanClick(state.page, publish);
      const link = dialog.getByLabel('Published view-only link');
      await link.waitFor({ state: 'visible', timeout: 60_000 });
      const shareUrl = sanitizeEvidenceUrl(await link.inputValue());
      await humanClick(state.page, dialog.getByRole('button', { name: 'Close share dialog' }));
      return { presenterShown: true, shareUrl };
    },

    export_pptx_json: async () => {
      const outputs = [];
      for (const format of [
        { testId: 'export-pptx', label: 'PowerPoint' },
        { testId: 'export-json', label: 'Deck JSON' },
      ]) {
        await humanClick(state.page, state.page.getByRole('button', { name: 'Export deck' }));
        const downloadPromise = state.page.waitForEvent('download', { timeout: 30_000 });
        await humanClick(state.page, state.page.getByTestId(format.testId));
        const download = await downloadPromise;
        const filename = download.suggestedFilename();
        const path = resolve(state.downloadsDir, filename);
        await download.saveAs(path);
        const fileStats = await stat(path);
        if (fileStats.size < 100) throw new Error(`${format.label} export is unexpectedly empty.`);
        const item = {
          format: format.label,
          filename,
          path,
          bytes: fileStats.size,
          sha256: await sha256File(path),
        };
        outputs.push(item);
        state.evidence.downloads.push(item);
      }
      return { exports: outputs };
    },
  };
}

async function openPrimitive(state, kind) {
  const index = state.primitiveSlides.get(kind);
  if (!Number.isInteger(index)) {
    throw new MissingRoadshowCapabilityError(`${kind}_change`, `${kind} primitive slide mapping`);
  }
  const thumbnail = state.page.locator('[data-testid^="slide-thumbnail-"]').nth(index);
  await humanClick(state.page, thumbnail);
  await state.page.waitForTimeout(450);
  const element = state.page.locator(`.ns-editor-edit-canvas .ns-slide-element--${kind}`).first();
  await element.waitFor({ state: 'visible', timeout: 10_000 });
}

async function configureAiRun(state, { scope, web }) {
  await openInspectorTab(state.page, 'ai');
  const advanced = state.page.getByTestId('ai-provider-summary');
  if ((await advanced.getAttribute('aria-expanded')) !== 'true')
    await humanClick(state.page, advanced);
  const external = state.page.getByTestId('ai-provider-external');
  if (!(await external.isChecked())) await humanCheck(state.page, external);
  const scopeButton = state.page
    .getByLabel('AI write scope')
    .getByRole('button', { name: scope, exact: true });
  if (!(await scopeButton.count())) {
    throw new MissingRoadshowCapabilityError('ai_scope', `AI write scope control "${scope}"`, [
      `aria-label="AI write scope" button "${scope}"`,
    ]);
  }
  await humanClick(state.page, scopeButton);
  if (web) {
    const webToggle = state.page.getByTestId('ai-web-research-toggle');
    if ((await webToggle.getAttribute('aria-pressed')) !== 'true') {
      await humanClick(state.page, webToggle);
    }
  }
  const providerConsent = state.page.getByTestId('ai-provider-consent');
  await humanCheck(state.page, providerConsent);
  if (web) await humanCheck(state.page, state.page.getByTestId('ai-web-research-consent'));
}

async function submitAiInstruction(state, instruction) {
  const composer = state.page.getByLabel('AI instruction');
  await humanType(state.page, composer, instruction);
  const submit = state.page.getByTestId('ai-submit');
  if (await submit.isDisabled()) {
    throw new Error('AI submit is disabled after explicit scope and consent.');
  }
  await humanClick(state.page, submit);
}

async function waitForProposal(page, timeout = 150_000) {
  const proposal = page.getByTestId('proposal-card').first();
  await proposal.waitFor({ state: 'visible', timeout });
  const validation = proposal.getByTestId('candidate-validation');
  await validation.waitFor({ state: 'visible', timeout: 30_000 });
  const text = cleanText(await validation.textContent());
  if (!/passed/i.test(text)) throw new Error(`Candidate validation did not pass: ${text}`);
  return proposal;
}

async function compareAndAccept(state, suppliedProposal) {
  const proposal = suppliedProposal ?? (await waitForProposal(state.page));
  const preview = proposal.getByTestId('proposal-preview');
  if ((await preview.getAttribute('aria-pressed')) !== 'true')
    await humanClick(state.page, preview);
  await state.page.getByLabel('Baseline and candidate comparison').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  const receipt = state.page.getByTestId('candidate-receipt');
  const receiptStatus = await receipt.getAttribute('data-candidate-status');
  if (receiptStatus !== 'ready')
    throw new Error(`Candidate receipt is ${receiptStatus ?? 'missing'}.`);
  await humanClick(state.page, proposal.getByTestId('proposal-accept'));
  await state.page.getByText('Validated proposal accepted as a new deck version.').waitFor({
    state: 'visible',
    timeout: 60_000,
  });
  return { compared: true, candidateStatus: receiptStatus, accepted: true };
}

async function openInspectorTab(page, id) {
  const tab = page.getByTestId(`inspector-tab-${id}`);
  if (!(await tab.isVisible().catch(() => false))) {
    const open = page.getByRole('button', { name: 'Open inspector' });
    if (await open.isVisible().catch(() => false)) await humanClick(page, open);
  }
  await humanClick(page, tab);
}

async function waitForValidationReady(page) {
  const validation = page.getByTestId('validation-status');
  await validation.waitFor({ state: 'visible', timeout: 30_000 });
  const text = cleanText(await validation.textContent());
  if (!/passed|ready|checks passed/i.test(text)) {
    throw new Error(`Deck validation is not ready after edit: ${text}`);
  }
}

async function requiredLocator(page, sceneId, capability, alternatives) {
  const attempted = [];
  for (const [label, factory] of alternatives) {
    attempted.push(label);
    const locator = factory();
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  throw new MissingRoadshowCapabilityError(sceneId, capability, attempted);
}

async function humanClick(page, locator, { durationMs = 520 } = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await moveVirtualCursor(page, locator, { durationMs });
  await clickPulse(page);
  await locator.click({ timeout: 15_000 });
  await page.waitForTimeout(240);
}

async function humanCheck(page, locator) {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  if (await locator.isChecked().catch(() => false)) return;
  await moveVirtualCursor(page, locator, { durationMs: 420 });
  await clickPulse(page);
  await locator.check({ timeout: 10_000 });
  await page.waitForTimeout(260);
}

async function humanType(page, locator, text) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await moveVirtualCursor(page, locator, { durationMs: 460 });
  await clickPulse(page);
  await locator.click();
  await locator.press('Control+A').catch(() => {});
  await locator.press('Backspace').catch(() => {});
  await locator.pressSequentially(text, { delay: typingDelayMs });
  await page.waitForTimeout(360);
}

async function ensureCursor(page) {
  await page.evaluate(virtualCursorInstall);
}

async function moveVirtualCursor(page, locator, { durationMs = 550 } = {}) {
  await ensureCursor(page);
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cannot move the visible cursor to an element without a bounding box.');
  const x = Math.round(box.x + Math.min(box.width * 0.62, Math.max(8, box.width - 8)));
  const y = Math.round(box.y + Math.min(box.height * 0.58, Math.max(8, box.height - 8)));
  await page.evaluate(
    ({ x: nextX, y: nextY, duration }) => {
      window.__nodeslideDemoCursorMove?.(nextX, nextY, duration);
    },
    { x, y, duration: durationMs },
  );
  await page.mouse.move(x, y, { steps: Math.max(4, Math.round(durationMs / 60)) });
  await page.waitForTimeout(durationMs + 80);
}

async function clickPulse(page) {
  await page.evaluate(() => window.__nodeslideDemoCursorClick?.());
  await page.waitForTimeout(150);
}

function virtualCursorInit() {
  window.addEventListener('DOMContentLoaded', () => {
    const install = () => {
      if (!document.body || document.getElementById('__nodeslide_demo_cursor')) return;
      const cursor = document.createElement('div');
      cursor.id = '__nodeslide_demo_cursor';
      cursor.setAttribute('aria-hidden', 'true');
      cursor.innerHTML =
        '<svg viewBox="0 0 28 36"><path d="M2 2L23 21h-9l5 11-5 2-5-11-7 7z" fill="#fff" stroke="#111827" stroke-width="2" stroke-linejoin="round"/></svg>';
      Object.assign(cursor.style, {
        position: 'fixed',
        zIndex: '2147483647',
        width: '28px',
        height: '36px',
        left: '50%',
        top: '50%',
        pointerEvents: 'none',
        filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.28))',
        transformOrigin: '3px 3px',
      });
      cursor.querySelector('svg').style.cssText = 'width:100%;height:100%;display:block';
      document.body.appendChild(cursor);
      window.__nodeslideDemoCursorMove = (x, y, duration = 500) => {
        cursor.animate(
          [
            { left: cursor.style.left, top: cursor.style.top },
            { left: `${x}px`, top: `${y}px` },
          ],
          { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
        );
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
      };
      window.__nodeslideDemoCursorClick = () => {
        cursor.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(.72)' }, { transform: 'scale(1)' }],
          {
            duration: 220,
            easing: 'ease-out',
          },
        );
      };
    };
    install();
    new MutationObserver(install).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

function virtualCursorInstall() {
  if (document.getElementById('__nodeslide_demo_cursor')) return;
  const cursor = document.createElement('div');
  cursor.id = '__nodeslide_demo_cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML =
    '<svg viewBox="0 0 28 36"><path d="M2 2L23 21h-9l5 11-5 2-5-11-7 7z" fill="#fff" stroke="#111827" stroke-width="2" stroke-linejoin="round"/></svg>';
  Object.assign(cursor.style, {
    position: 'fixed',
    zIndex: '2147483647',
    width: '28px',
    height: '36px',
    left: '50%',
    top: '50%',
    pointerEvents: 'none',
    filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.28))',
    transformOrigin: '3px 3px',
  });
  cursor.querySelector('svg').style.cssText = 'width:100%;height:100%;display:block';
  document.body.appendChild(cursor);
  window.__nodeslideDemoCursorMove = (x, y, duration = 500) => {
    cursor.animate(
      [
        { left: cursor.style.left, top: cursor.style.top },
        { left: `${x}px`, top: `${y}px` },
      ],
      { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
  };
  window.__nodeslideDemoCursorClick = () => {
    cursor.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(.72)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'ease-out' },
    );
  };
}

async function waitForCount(locator, expected, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if ((await locator.count()) === expected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  throw new Error(`Timed out waiting for exactly ${expected} matching elements.`);
}

async function inspectInputs(paths) {
  return await Promise.all(paths.map((path) => inspectInput(path)));
}

async function inspectInput(path) {
  try {
    const fileStats = await stat(path);
    return {
      path: relativeRepoPath(path),
      exists: fileStats.isFile(),
      bytes: fileStats.size,
      sha256: fileStats.isFile() ? await sha256File(path) : null,
    };
  } catch {
    return { path: relativeRepoPath(path), exists: false, bytes: 0, sha256: null };
  }
}

function assertRequiredInputs(inputs) {
  const missing = inputs.filter((input) => !input.exists);
  if (missing.length) {
    throw new Error(
      `Live recording is missing required evidence input(s): ${missing.map((item) => item.path).join(', ')}`,
    );
  }
}

async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

function runCommand(command) {
  console.log(`[roadshow] ffmpeg: ${command.label}`);
  const result = spawnSync(command.executable, command.args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command.label} failed with status ${result.status}`);
}

function assertFfmpegAvailable() {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  const ffprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' });
  if (ffmpeg.status !== 0 || ffprobe.status !== 0) {
    throw new Error('ffmpeg and ffprobe are required for the final recorder pipeline.');
  }
}

async function probeDuration(path) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`ffprobe could not read ${path}`);
  const duration = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid duration for ${path}`);
  return duration;
}

async function writeEvidence(evidence, name = 'evidence.json') {
  await writeFile(resolve(outputDir, name), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function gitCommitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function canonicalTarget(value) {
  const url = new URL(value);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function parseArgs(values) {
  const parsed = { dryRun: false, headed: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--dry-run') parsed.dryRun = true;
    else if (value === '--headed') parsed.headed = true;
    else if (value === '--target-url') parsed.targetUrl = requireValue(values, ++index, value);
    else if (value === '--output-dir') parsed.outputDir = requireValue(values, ++index, value);
    else if (value === '--image-path') parsed.imagePath = requireValue(values, ++index, value);
    else if (value === '--typing-delay-ms')
      parsed.typingDelayMs = requireValue(values, ++index, value);
    else if (value === '--help' || value === '-h') {
      console.log(
        'Usage: node scripts/record-nodeslide-founder-roadshow.mjs [options]\n\n  --dry-run             Validate scenes, captions, inputs, and ffmpeg commands only\n  --target-url URL       Canonical deployed NodeSlide root\n  --output-dir PATH      Recorder output directory\n  --image-path PATH      Rights-cleared local image for the image-change scene\n  --typing-delay-ms N    Per-character delay (default 14)\n  --headed               Foreground debug only; headless is the safe default',
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

function requireValue(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error(`${label} must be an integer from 1 to 200`);
  }
  return parsed;
}

function relativeRepoPath(path) {
  const normalizedRoot = `${repoRoot.replaceAll('\\', '/')}/`;
  const normalized = resolve(path).replaceAll('\\', '/');
  return normalized.startsWith(normalizedRoot)
    ? normalized.slice(normalizedRoot.length)
    : normalized;
}

function resolveOptionalPath(value) {
  return value ? resolve(value) : null;
}

function serializeError(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    ...(error?.details ? { details: redactDetails(error.details) } : {}),
  };
}

function redactDetails(value) {
  if (Array.isArray(value)) return value.map(redactDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /token|secret|password|accessKey|bypass/i.test(key) ? '[redacted]' : redactDetails(item),
    ]),
  );
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
