#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const planPath = resolve(repoRoot, 'docs/demo/three-deck-launch/recording-plan.json');
const defaultTargetUrl = 'https://parity-studio.vercel.app/';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const args = parseArgs(process.argv.slice(2));
const targetUrl = canonicalRoot(
  args.targetUrl ?? process.env.NODESLIDE_DEMO_URL ?? defaultTargetUrl,
);
const outputDir = resolve(
  args.outputDir ??
    process.env.NODESLIDE_THREE_DECK_OUTPUT ??
    resolve(repoRoot, 'artifacts', `nodeslide-three-deck-launch-${stamp}`),
);
const typingDelayMs = boundedInteger(
  args.typingDelayMs ?? process.env.NODESLIDE_TYPING_DELAY_MS ?? '12',
  1,
  200,
  'typing delay',
);
const worldCupData = optionalPath(args.worldCupData ?? process.env.NODESLIDE_WORLD_CUP_DATA);
const aiFundImage = optionalPath(args.aiFundImage ?? process.env.NODESLIDE_AI_FUND_IMAGE);
const imageCredit =
  args.imageCredit ??
  process.env.NODESLIDE_AI_FUND_IMAGE_CREDIT ??
  'Rights-cleared official-source image; source retained by recording operator';
const REQUIRED_CHECKPOINTS = Object.freeze([
  'opening',
  'ai-2027-create',
  'ai-2027-primitive-scan',
  'ai-2027-one-element-review',
  'ai-2027-multi-agent-handoffs',
  'ai-2027-math-edit',
  'ai-2027-layout-edit',
  'ai-2027-memory',
  'ai-fund-create',
  'ai-fund-primitive-scan',
  'ai-fund-web-one-slide-edit',
  'ai-fund-image-upload',
  'ai-fund-trace-citations',
  'ai-fund-source-monitoring',
  'world-cup-create',
  'world-cup-primitive-scan',
  'world-cup-bounded-multi-slide-edit',
  'world-cup-chart-grid-edit',
  'world-cup-trace-citations',
  'world-cup-pptx-json-export',
  'world-cup-pptx-link',
  'world-cup-connections',
  'closing',
]);

class ProbeComplete extends Error {
  constructor(checkpointId) {
    super(`Checkpoint probe completed: ${checkpointId}`);
    this.name = 'ProbeComplete';
    this.checkpointId = checkpointId;
  }
}

await main();

async function main() {
  await mkdir(outputDir, { recursive: true });
  const plan = validatePlan(JSON.parse(await readFile(planPath, 'utf8')));
  const inputs = {
    worldCupData: await inspectInput(worldCupData),
    aiFundImage: await inspectInput(aiFundImage),
  };
  const evidence = {
    schema: 'nodeslide-three-deck-launch-evidence/v1',
    mode: args.dryRun ? 'dry-run' : args.probeThroughCheckpoint ? 'checkpoint-probe' : 'live',
    targetUrl,
    plan: relativeRepoPath(planPath),
    commitSha: gitCommitSha(),
    startedAt: new Date().toISOString(),
    inputs,
    checkpoints: [],
    decks: [],
    downloads: [],
    consoleErrors: [],
    pageErrors: [],
    outputs: {},
    verdict: 'running',
  };

  if (args.dryRun) {
    const blockers = [
      ...(inputs.worldCupData.exists ? [] : ['--world-cup-data is required for a live run']),
      ...(inputs.aiFundImage.exists ? [] : ['--ai-fund-image is required for a live run']),
    ];
    evidence.verdict = blockers.length
      ? 'contract-valid-live-blocked'
      : 'contract-valid-live-ready';
    evidence.blockers = blockers;
    evidence.completedAt = new Date().toISOString();
    await writeJson(resolve(outputDir, 'dry-run-evidence.json'), evidence);
    console.log(`[three-deck:dry-run] ${plan.decks.length} fresh deck contracts validated`);
    for (const blocker of blockers) console.log(`[three-deck:dry-run] LIVE BLOCKER: ${blocker}`);
    console.log(`[three-deck:dry-run] evidence: ${resolve(outputDir, 'dry-run-evidence.json')}`);
    return;
  }

  assertLiveInput(inputs.worldCupData, 'World Cup data');
  assertLiveInput(inputs.aiFundImage, 'AI Fund image');
  const dirs = {
    video: resolve(outputDir, 'raw-video'),
    checkpoints: resolve(outputDir, 'checkpoints'),
    failures: resolve(outputDir, 'failures'),
    downloads: resolve(outputDir, 'downloads'),
  };
  await Promise.all(Object.values(dirs).map((path) => mkdir(path, { recursive: true })));

  const browser = await chromium.launch({
    headless: !args.headed,
    args: args.headed ? ['--start-maximized'] : [],
  });
  let context;
  let page;
  let video;
  try {
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: dirs.video, size: { width: 1920, height: 1080 } },
      acceptDownloads: true,
      // The recorder's local browser-chrome shell embeds the real production app. Production
      // correctly sends frame-ancestors 'none'; bypassing CSP only inside this isolated capture
      // context preserves that security policy for every real user while allowing full-frame video.
      bypassCSP: true,
      ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? {
            extraHTTPHeaders: {
              'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
              'x-vercel-set-bypass-cookie': 'true',
            },
          }
        : {}),
    });
    const captureOrigin = new URL(targetUrl).origin;
    await context.route(`${captureOrigin}/**`, async (route) => {
      const response = await route.fetch();
      const blockedFrameHeaders = new Set([
        'content-security-policy',
        'content-security-policy-report-only',
        'x-frame-options',
      ]);
      const headers = Object.fromEntries(
        Object.entries(response.headers()).filter(([name]) => !blockedFrameHeaders.has(name)),
      );
      await route.fulfill({ response, headers });
    });
    page = await context.newPage();
    video = page.video();
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text().slice(0, 1_000));
    });
    page.on('pageerror', (error) => evidence.pageErrors.push(error.message.slice(0, 1_000)));
    await page.setContent(browserShellMarkup(targetUrl), { waitUntil: 'load' });
    const appFrame = page.frame({ name: 'nodeslide-app' });
    if (!appFrame)
      throw new Error('The full-browser recording shell did not create its app frame.');
    const run = createRunState({
      page,
      app: appFrame,
      plan,
      evidence,
      dirs,
      targetUrl,
      inputs,
      imageCredit,
    });

    await checkpoint(run, 'opening', async () => {
      const address = page.getByLabel('Address');
      await humanType(run, address, targetUrl, { clear: true });
      await address.press('Enter');
      await appFrame.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await syncAddress(run);
      await appFrame
        .getByTestId('nodeslide-landing')
        .waitFor({ state: 'visible', timeout: 60_000 });
      assertLandingUrl(appFrame.url());
      return { url: cleanUrl(appFrame.url()), editorMounted: false };
    });

    for (const deckPlan of plan.decks) {
      run.deckPlan = deckPlan;
      run.deck = { planId: deckPlan.id, title: deckPlan.title, checkpoints: [] };
      evidence.decks.push(run.deck);
      await createFreshDeck(run);
      await scanPrimitives(run);
      if (deckPlan.id === 'ai-2027') await recordAi2027(run);
      if (deckPlan.id === 'ai-fund') await recordAiFund(run);
      if (deckPlan.id === 'world-cup') await recordWorldCup(run);
    }

    await checkpoint(run, 'closing', async () => {
      if (new Set(run.createdDeckIds).size !== 3) {
        throw new Error(`Expected three unique new deck IDs; found ${run.createdDeckIds.length}.`);
      }
      await page.waitForTimeout(1_800);
      return { newDeckIds: [...run.createdDeckIds], allUnique: true };
    });

    if (evidence.consoleErrors.length || evidence.pageErrors.length) {
      throw new Error(
        `Recording emitted ${evidence.consoleErrors.length} console error(s) and ${evidence.pageErrors.length} page error(s).`,
      );
    }
    evidence.verdict = 'passed';
    evidence.completedAt = new Date().toISOString();
    await writeEvidence(evidence);
    await page.close();
    await context.close();
    const webm = resolve(outputDir, 'nodeslide-three-deck-launch.webm');
    await video.saveAs(webm);
    evidence.outputs.webm = webm;
    const mp4 = transcodeToMp4(webm, resolve(outputDir, 'nodeslide-three-deck-launch.mp4'));
    if (mp4) evidence.outputs.mp4 = mp4;
    await writeEvidence(evidence);
    console.log(`[three-deck] passed with new deck IDs: ${run.createdDeckIds.join(', ')}`);
    console.log(`[three-deck] video: ${mp4 ?? webm}`);
    console.log(`[three-deck] evidence: ${resolve(outputDir, 'evidence.json')}`);
  } catch (error) {
    if (error instanceof ProbeComplete) {
      evidence.verdict = 'checkpoint-probe-passed';
      evidence.completedAt = new Date().toISOString();
      await writeEvidence(evidence);
      await page?.close().catch(() => {});
      await context?.close().catch(() => {});
      if (video) {
        const probeVideo = resolve(outputDir, `probe-through-${error.checkpointId}.webm`);
        await video.saveAs(probeVideo);
        evidence.outputs.webm = probeVideo;
        await writeEvidence(evidence);
      }
      console.log(`[three-deck:probe] capture: ${evidence.outputs.webm ?? '<unavailable>'}`);
      return;
    }
    evidence.verdict = 'failed';
    evidence.failure = serializeError(error);
    evidence.completedAt = new Date().toISOString();
    if (page) {
      await page
        .screenshot({ path: resolve(dirs.failures, 'terminal-failure.png'), fullPage: false })
        .catch(() => {});
    }
    await writeEvidence(evidence).catch(() => {});
    throw error;
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function createRunState({ page, app, plan, evidence, dirs, targetUrl, inputs, imageCredit }) {
  return {
    page,
    app,
    plan,
    evidence,
    dirs,
    targetUrl,
    inputs,
    imageCredit,
    createdDeckIds: [],
    checkpointIndex: 0,
    deckPlan: null,
    deck: null,
    primitives: new Map(),
    lastPptxPath: null,
  };
}

async function createFreshDeck(run) {
  const id = `${run.deckPlan.id}-create`;
  await checkpoint(run, id, async () => {
    await run.app.goto(run.targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await syncAddress(run);
    await run.app.getByTestId('nodeslide-landing').waitFor({ state: 'visible', timeout: 60_000 });
    assertLandingUrl(run.app.url());
    if ((await run.app.getByTestId('nodeslide-studio').count()) !== 0) {
      throw new Error('A prior editor remained mounted at the fresh landing checkpoint.');
    }
    const attachment = run.deckPlan.id === 'world-cup' ? run.inputs.worldCupData.path : null;
    if (attachment) await attachLandingFile(run, attachment);
    await humanType(run, run.app.getByLabel('Presentation brief'), run.deckPlan.prompt, {
      clear: true,
    });
    await ensureNamedLandingModel(run);
    const effort = run.app.getByTestId('landing-effort-select');
    if (await effort.isVisible().catch(() => false)) await effort.selectOption('low');
    const consent = run.app.getByTestId('landing-provider-consent');
    if (await consent.isVisible().catch(() => false)) await humanCheck(run, consent);
    const submit = run.app.getByRole('button', { name: 'Create presentation' });
    if (await submit.isDisabled())
      throw new Error('Create presentation is disabled after a valid brief.');
    await humanClick(run, submit);
    await run.app.waitForFunction(
      () => {
        const studio = document.querySelector('[data-testid="nodeslide-studio"]');
        const error = document.querySelector('.ns-landing-create-error');
        return Boolean(studio?.getClientRects().length || error?.getClientRects().length);
      },
      undefined,
      { timeout: 300_000 },
    );
    const creationError = run.app.locator('.ns-landing-create-error');
    if (await creationError.isVisible().catch(() => false)) {
      throw new Error(`Deck creation failed: ${cleanText(await creationError.textContent())}`);
    }
    await run.app.getByTestId('nodeslide-studio').waitFor({ state: 'visible', timeout: 60_000 });
    await syncAddress(run);
    const deckId = deckIdFromUrl(run.app.url());
    if (!deckId) throw new Error(`New deck URL has no deck ID: ${cleanUrl(run.app.url())}`);
    if (run.createdDeckIds.includes(deckId)) throw new Error(`Deck ID was reused: ${deckId}`);
    run.createdDeckIds.push(deckId);
    run.deck.deckId = deckId;
    run.deck.url = cleanUrl(run.app.url());
    const thumbnails = run.app.locator('[data-testid^="slide-thumbnail-"]');
    await waitForStableCount(thumbnails, run.deckPlan.slideCount, 60_000);
    run.deck.slideCount = await thumbnails.count();
    return {
      deckId,
      uniqueWithinRun: true,
      slideCount: run.deck.slideCount,
      attachment: attachment ? relativeRepoPath(attachment) : null,
    };
  });
}

async function scanPrimitives(run) {
  await checkpoint(run, `${run.deckPlan.id}-primitive-scan`, async () => {
    run.primitives = new Map();
    const kinds = ['text', 'chart', 'math', 'image', 'connector'];
    const thumbnails = run.app.locator('[data-testid^="slide-thumbnail-"]');
    for (let index = 0; index < (await thumbnails.count()); index += 1) {
      await humanClick(run, thumbnails.nth(index), { moveMs: 180, settleMs: 180 });
      for (const kind of kinds) {
        if (run.primitives.has(kind)) continue;
        const element = run.app
          .locator(`.ns-editor-edit-canvas .ns-slide-element--${kind}`)
          .first();
        if (await element.isVisible().catch(() => false)) run.primitives.set(kind, index);
      }
    }
    const required =
      run.deckPlan.id === 'ai-2027'
        ? ['text', 'math']
        : run.deckPlan.id === 'ai-fund'
          ? ['text', 'image']
          : ['text', 'chart'];
    const missing = required.filter((kind) => !run.primitives.has(kind));
    if (missing.length)
      throw new Error(`${run.deckPlan.id} is missing ${missing.join(', ')} primitives.`);
    run.deck.primitives = Object.fromEntries(run.primitives);
    return { primitiveSlideIndexes: run.deck.primitives };
  });
}

async function recordAi2027(run) {
  await checkpoint(run, 'ai-2027-one-element-review', async () => {
    await openPrimitive(run, 'text');
    const element = run.app.locator('.ns-editor-edit-canvas .ns-slide-element--text').nth(1);
    await humanClick(run, element);
    await configureAgent(run, { scope: 'Selection', web: false, turbo: false });
    await submitAgent(
      run,
      'Replace only this selected headline with “AI 2027 is a decision system, not a forecast.” Preserve every other element and the current layout.',
    );
    const proposal = await waitForProposal(run);
    await assertMultiAgentHandoffs(run);
    return await compareAndAccept(run, proposal);
  });

  await checkpoint(run, 'ai-2027-multi-agent-handoffs', async () => {
    await openInspectorTab(run, 'ai');
    return await assertMultiAgentHandoffs(run, { present: true });
  });

  await checkpoint(run, 'ai-2027-math-edit', async () => {
    await openPrimitive(run, 'math');
    await humanClick(
      run,
      run.app.locator('.ns-editor-edit-canvas .ns-slide-element--math').first(),
    );
    await openInspectorTab(run, 'design');
    const input = await firstVisible([
      run.app.getByLabel('Math expression'),
      run.app.locator('.ns-text-content-field textarea'),
    ]);
    const baseVersion = await currentDeckVersion(run);
    const before = await input.inputValue();
    const after = 'Decision readiness = evidence quality × review confidence';
    await humanType(run, input, after, { clear: true });
    await input.press('Control+Enter');
    const version = await waitForVersionAdvance(run, baseVersion);
    return { before, after, version };
  });

  await checkpoint(run, 'ai-2027-layout-edit', async () => {
    await openPrimitive(run, 'text');
    await humanClick(
      run,
      run.app.locator('.ns-editor-edit-canvas .ns-slide-element--text').first(),
    );
    await openInspectorTab(run, 'design');
    const x = await firstVisible([
      run.app.getByLabel('X', { exact: true }),
      run.app.locator('.ns-field-grid--four input').first(),
    ]);
    const baseVersion = await currentDeckVersion(run);
    const before = Number.parseFloat(await x.inputValue());
    if (!Number.isFinite(before)) throw new Error('Selected element X position is not numeric.');
    const after = Number(Math.min(88, before + 1).toFixed(1));
    await humanType(run, x, String(after), { clear: true });
    await x.press('Tab');
    const version = await waitForVersionAdvance(run, baseVersion);
    return { property: 'x', before, after, version };
  });

  await checkpoint(run, 'ai-2027-memory', async () => {
    await openInspectorTab(run, 'ai');
    const memoryButton = run.app.getByTestId('ai-memory');
    if (!(await memoryButton.isVisible().catch(() => false))) {
      await humanClick(run, run.app.getByTestId('ai-tools-toggle'));
    }
    await humanClick(run, memoryButton);
    const dialog = run.app.getByTestId('memory-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    const text = 'Prefer action-led headlines and distinguish measured evidence from scenarios.';
    await humanType(run, dialog.getByPlaceholder(/Prefer concise executive headlines/i), text, {
      clear: true,
    });
    await humanClick(run, dialog.getByRole('button', { name: 'Add', exact: true }));
    await dialog.getByText(text, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await humanClick(run, dialog.getByRole('button', { name: 'Close' }));
    return { scopedPreference: text };
  });
}

async function recordAiFund(run) {
  await checkpoint(run, 'ai-fund-web-one-slide-edit', async () => {
    await openPrimitive(run, 'text');
    await configureAgent(run, { scope: 'This slide', web: true, turbo: false });
    await submitAgent(
      run,
      'On this slide only, verify the exact current roles of Mike Rubino, Andrew Ng, and Eli using official AI Fund pages. Correct only unsupported role text, bind each retained claim to its official source, and preserve the layout.',
    );
    const proposal = await waitForProposal(run, 240_000);
    await assertMultiAgentHandoffs(run);
    return await compareAndAccept(run, proposal);
  });

  await checkpoint(run, 'ai-fund-image-upload', async () => {
    await openPrimitive(run, 'image');
    await humanClick(
      run,
      run.app.locator('.ns-editor-edit-canvas .ns-slide-element--image').first(),
    );
    await openInspectorTab(run, 'design');
    const upload = run.app.getByTestId('image-upload');
    await upload.waitFor({ state: 'attached', timeout: 10_000 });
    const form = upload.locator('xpath=ancestor::form[1]');
    await humanType(
      run,
      form.getByLabel('Alt text', { exact: true }),
      'AI Fund team member shown in an official-source profile image',
      { clear: true },
    );
    await humanType(run, form.getByLabel('Credit', { exact: true }), run.imageCredit, {
      clear: true,
    });
    const baseVersion = await currentDeckVersion(run);
    await moveCursor(run, form.locator('.ns-image-upload-control'));
    await upload.setInputFiles(run.inputs.aiFundImage.path);
    await run.app
      .locator('.ns-editor-edit-canvas .ns-slide-element--image img')
      .waitFor({ state: 'visible', timeout: 30_000 });
    const version = await waitForVersionAdvance(run, baseVersion);
    return {
      file: relativeRepoPath(run.inputs.aiFundImage.path),
      sha256: run.inputs.aiFundImage.sha256,
      version,
    };
  });

  await traceCheckpoint(run, 'ai-fund-trace-citations');

  await checkpoint(run, 'ai-fund-source-monitoring', async () => {
    await openInspectorTab(run, 'data');
    const monitor = run.app.getByRole('button', { name: /^Monitor changes for / }).first();
    await monitor.waitFor({ state: 'visible', timeout: 20_000 });
    const label = await monitor.getAttribute('aria-label');
    await humanClick(run, monitor);
    await run.app
      .getByRole('button', { name: /^Pause /i })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    return { enabled: true, sourceControl: label };
  });
}

async function recordWorldCup(run) {
  await checkpoint(run, 'world-cup-bounded-multi-slide-edit', async () => {
    const actions = run.app.getByRole('button', { name: /^Slide \d+ actions$/ });
    if ((await actions.count()) < 2)
      throw new Error('World Cup deck has fewer than two selectable slides.');
    for (let index = 0; index < 2; index += 1) {
      await humanClick(run, actions.nth(index));
      await humanClick(
        run,
        run.app.getByRole('menuitemcheckbox', { name: 'Select for multi-slide edit' }),
      );
    }
    await run.app.getByText('2 selected', { exact: true }).waitFor({ state: 'visible' });
    await configureAgent(run, { scope: 'Selected slides', web: false, turbo: true });
    await submitAgent(
      run,
      'Make these two selected slides use parallel, data-led headlines and one consistent visual hierarchy. Preserve every uploaded value and change nothing outside the selected slides.',
    );
    const result = await waitForTurboApply(run, 240_000);
    await assertMultiAgentHandoffs(run);
    return result;
  });

  await checkpoint(run, 'world-cup-chart-grid-edit', async () => {
    await clearSlideSelection(run);
    await openPrimitive(run, 'chart');
    await humanClick(
      run,
      run.app.locator('.ns-editor-edit-canvas .ns-slide-element--chart').first(),
    );
    await openInspectorTab(run, 'design');
    const labels = run.app.locator('[data-testid^="chart-label-"]');
    const values = run.app.locator('[data-testid^="chart-value-"]');
    await labels.first().waitFor({ state: 'visible', timeout: 15_000 });
    const baseVersion = await currentDeckVersion(run);
    const beforeValues = await values.evaluateAll((nodes) =>
      nodes.map((node) => Number(node.value)),
    );
    const before = await labels.first().inputValue();
    const after = `${before.replace(/\s*·\s*verified$/i, '')} · verified`;
    await humanType(run, labels.first(), after, { clear: true });
    await humanClick(run, run.app.getByRole('button', { name: 'Apply chart data' }));
    const version = await waitForVersionAdvance(run, baseVersion);
    const afterValues = await values.evaluateAll((nodes) =>
      nodes.map((node) => Number(node.value)),
    );
    if (JSON.stringify(beforeValues) !== JSON.stringify(afterValues)) {
      throw new Error('Chart label edit unexpectedly changed uploaded numeric values.');
    }
    return { before, after, numericValuesPreserved: true, points: afterValues.length, version };
  });

  await traceCheckpoint(run, 'world-cup-trace-citations');

  await checkpoint(run, 'world-cup-pptx-json-export', async () => {
    const outputs = [];
    for (const format of [
      { testId: 'export-pptx', label: 'PowerPoint' },
      { testId: 'export-json', label: 'Deck JSON' },
    ]) {
      await humanClick(run, run.app.getByRole('button', { name: 'Export deck' }));
      const pending = run.page.waitForEvent('download', { timeout: 60_000 });
      await humanClick(run, run.app.getByTestId(format.testId));
      const download = await pending;
      const path = resolve(run.dirs.downloads, download.suggestedFilename());
      await download.saveAs(path);
      const inspected = await inspectInput(path);
      if (inspected.bytes < 100) throw new Error(`${format.label} export is unexpectedly empty.`);
      const item = { format: format.label, ...inspected };
      outputs.push(item);
      run.evidence.downloads.push(item);
      if (format.testId === 'export-pptx') run.lastPptxPath = path;
    }
    return { outputs };
  });

  await checkpoint(run, 'world-cup-pptx-link', async () => {
    if (!run.lastPptxPath) throw new Error('PowerPoint link requires the just-exported PPTX.');
    const dialog = await openConnections(run);
    const input = dialog.getByLabel('Link matching PowerPoint');
    await input.setInputFiles(run.lastPptxPath);
    const notice = dialog.locator('.ns-connection-notice');
    await notice.waitFor({ state: 'visible', timeout: 120_000 });
    const noticeText = (await notice.textContent())?.trim() ?? '';
    if (!/PowerPoint linked from an exact semantic match/i.test(noticeText)) {
      throw new Error(`PowerPoint link failed: ${noticeText || 'No connection result was shown.'}`);
    }
    return { linkedFile: relativeRepoPath(run.lastPptxPath), baseline: 'exact semantic match' };
  });

  await checkpoint(run, 'world-cup-connections', async () => {
    const dialog = run.app.getByRole('dialog', { name: 'Connect your own runtime' });
    await dialog.getByText('PowerPoint', { exact: true }).first().waitFor({ state: 'visible' });
    await dialog.getByText('Google Slides', { exact: true }).first().waitFor({ state: 'visible' });
    await dialog.getByText(/MCP/i).first().waitFor({ state: 'visible' });
    let google = 'workbench shown; OAuth not fabricated';
    if (args.googleSync) google = await exerciseAuthorizedGoogleSync(run, dialog);
    return { powerpoint: 'linked', googleSlides: google, mcp: 'connection configuration visible' };
  });
}

async function checkpoint(run, id, action) {
  if (run.evidence.checkpoints.some((item) => item.id === id)) {
    throw new Error(`Duplicate checkpoint ID: ${id}`);
  }
  run.checkpointIndex += 1;
  const caption = run.plan.captions[id];
  if (!caption) throw new Error(`Recording plan has no caption for checkpoint ${id}.`);
  await showCaption(run, caption);
  const started = Date.now();
  console.log(`[three-deck] checkpoint ${String(run.checkpointIndex).padStart(2, '0')}: ${id}`);
  try {
    const details = await action();
    await run.page.waitForTimeout(1_200);
    const screenshot = resolve(
      run.dirs.checkpoints,
      `${String(run.checkpointIndex).padStart(2, '0')}-${id}.png`,
    );
    await run.page.screenshot({ path: screenshot, fullPage: false });
    const receipt = {
      id,
      deckId: run.deck?.deckId ?? null,
      status: 'passed',
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      screenshot,
      details: redact(details),
    };
    run.evidence.checkpoints.push(receipt);
    run.deck?.checkpoints.push(id);
    await writeEvidence(run.evidence);
    if (args.probeThroughCheckpoint === id) {
      run.evidence.verdict = 'checkpoint-probe-passed';
      await writeEvidence(run.evidence);
      console.log(`[three-deck:probe] passed through ${id}`);
      throw new ProbeComplete(id);
    }
    return details;
  } catch (error) {
    if (error instanceof ProbeComplete) throw error;
    const screenshot = resolve(run.dirs.failures, `${run.checkpointIndex}-${id}.png`);
    await run.page.screenshot({ path: screenshot, fullPage: false }).catch(() => {});
    run.evidence.checkpoints.push({
      id,
      deckId: run.deck?.deckId ?? null,
      status: 'failed',
      durationMs: Date.now() - started,
      screenshot,
      failure: serializeError(error),
    });
    await writeEvidence(run.evidence);
    throw error;
  }
}

async function attachLandingFile(run, path) {
  const input = run.app.getByTestId('landing-file-input');
  await input.waitFor({ state: 'attached', timeout: 10_000 });
  const attach = run.app.getByRole('button', { name: 'Attach data' });
  if (await attach.isVisible().catch(() => false)) await moveCursor(run, attach);
  await input.setInputFiles(path);
  await run.app
    .getByLabel('Attached data files')
    .getByRole('button', { name: `Remove ${path.split(/[\\/]/).at(-1)}` })
    .waitFor({ state: 'visible', timeout: 20_000 });
}

async function ensureNamedLandingModel(run) {
  const trigger = run.app.getByTestId('landing-model-select');
  if (!(await trigger.isVisible().catch(() => false))) return;
  await humanClick(run, trigger);
  const dialog = run.app.getByRole('dialog', { name: 'Generation model' });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  const fastNamedRoute = dialog
    .locator('[cmdk-item]')
    .filter({ hasText: /Gemini 3\.5 Flash.*OpenRouter/s })
    .first();
  if (await fastNamedRoute.isVisible().catch(() => false)) {
    await humanClick(run, fastNamedRoute);
    return;
  }
  await humanClick(run, dialog.getByLabel('Recommended').locator('[cmdk-item]').first());
}

async function configureAgent(run, { scope, web, turbo }) {
  await openInspectorTab(run, 'ai');
  await ensureNamedEditorModel(run);
  const turboToggle = run.app.getByTestId('ai-turbo-toggle');
  if (await turboToggle.isVisible().catch(() => false)) {
    const active = (await turboToggle.getAttribute('aria-checked')) === 'true';
    if (active !== turbo) await humanClick(run, turboToggle);
  }
  const controls = run.app.getByTestId('ai-provider-controls');
  if (await controls.isVisible().catch(() => false)) {
    const isOpen = await controls.evaluate((node) => 'open' in node && Boolean(node.open));
    const summary = run.app.getByTestId('ai-provider-summary');
    if (!isOpen && (await summary.isVisible().catch(() => false))) await humanClick(run, summary);
  }
  const operationMode = run.app
    .getByTestId('ai-operation-mode')
    .or(run.app.getByLabel('Operation mode'))
    .first();
  if (await operationMode.isVisible().catch(() => false)) {
    const tagName = await operationMode.evaluate((node) => node.tagName.toLowerCase());
    if (tagName === 'select') {
      await operationMode.selectOption('unrestricted');
    } else {
      await humanClick(run, operationMode);
      await humanClick(run, run.app.getByRole('option', { name: 'Full edit' }));
    }
  }
  const external = run.app.getByTestId('ai-provider-external');
  if (await external.isVisible().catch(() => false)) await humanCheck(run, external);
  const scopeGroup = run.app.getByLabel('AI write scope');
  const button =
    scope === 'Selected slides'
      ? scopeGroup.getByRole('button', { name: /^Selected slides/ })
      : scopeGroup.getByRole('button', { name: new RegExp(`^${escapeRegExp(scope)}`) });
  if (await button.isVisible().catch(() => false)) await humanClick(run, button);
  const webToggle = run.app.getByTestId('ai-web-research-toggle');
  if (await webToggle.isVisible().catch(() => false)) {
    const active = (await webToggle.getAttribute('aria-pressed')) === 'true';
    if (active !== web) await humanClick(run, webToggle);
  }
  const providerConsent = run.app.getByTestId('ai-provider-consent');
  if (await providerConsent.isVisible().catch(() => false)) await humanCheck(run, providerConsent);
  if (web) {
    const webConsent = run.app.getByTestId('ai-web-research-consent');
    if (await webConsent.isVisible().catch(() => false)) await humanCheck(run, webConsent);
  }
}

async function ensureNamedEditorModel(run) {
  if (run.deck.editorModelReady) return;
  const trigger = run.app.getByTestId('ai-model-select');
  await trigger.waitFor({ state: 'visible', timeout: 15_000 });
  await humanClick(run, trigger);
  const dialog = run.app.getByRole('dialog', { name: 'Agent model' });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  const fastNamedRoute = dialog
    .locator('[cmdk-item]')
    .filter({ hasText: /Gemini 3\.5 Flash.*OpenRouter/s })
    .first();
  await humanClick(
    run,
    (await fastNamedRoute.isVisible().catch(() => false))
      ? fastNamedRoute
      : dialog.getByLabel('Recommended').locator('[cmdk-item]').first(),
  );
  run.deck.editorModelReady = true;
}

async function submitAgent(run, instruction) {
  await humanType(run, run.app.getByLabel('AI instruction'), instruction, { clear: true });
  const submit = run.app.getByTestId('ai-submit');
  if (await submit.isDisabled())
    throw new Error('AI submit remained disabled after scope and consent.');
  await humanClick(run, submit);
}

async function waitForProposal(run, timeout = 180_000) {
  await run.app.waitForFunction(
    () => {
      const proposal = document.querySelector('[data-testid="proposal-card"]');
      const failure = [...document.querySelectorAll('[role="alert"]')].some((node) =>
        /No proposal was created or applied/i.test(node.textContent ?? ''),
      );
      return Boolean(proposal?.getClientRects().length || failure);
    },
    undefined,
    { timeout },
  );
  const failure = run.app
    .getByRole('alert')
    .filter({ hasText: 'No proposal was created or applied' })
    .last();
  if (await failure.isVisible().catch(() => false)) {
    throw new Error(`Agent failed: ${cleanText(await failure.textContent())}`);
  }
  const proposal = run.app.getByTestId('proposal-card').first();
  await proposal.getByTestId('candidate-validation').waitFor({ state: 'visible', timeout: 60_000 });
  return proposal;
}

async function compareAndAccept(run, proposal) {
  const preview = proposal.getByTestId('proposal-preview');
  const comparison = run.app.getByLabel('Baseline and candidate comparison');
  if (!(await comparison.isVisible().catch(() => false))) {
    await humanClick(run, preview);
    if (!(await comparison.isVisible().catch(() => false))) {
      const compareTab = run.app.getByRole('tab', { name: 'Compare' });
      if (await compareTab.isVisible().catch(() => false)) await humanClick(run, compareTab);
    }
  }
  await comparison.waitFor({ state: 'visible', timeout: 15_000 });
  const receipt = run.app.getByTestId('candidate-receipt');
  const candidateStatus = await receipt.getAttribute('data-candidate-status');
  if (candidateStatus !== 'ready' && candidateStatus !== 'warning') {
    throw new Error('Candidate receipt is not ready for acceptance.');
  }
  await humanClick(run, proposal.getByTestId('proposal-accept'));
  await run.app
    .getByText('Validated proposal accepted as a new deck version.')
    .waitFor({ state: 'visible', timeout: 60_000 });
  return { compared: true, accepted: true };
}

async function waitForTurboApply(run, timeout) {
  await run.app.waitForFunction(
    () =>
      /auto-applied|applied as a new deck version|Undo/i.test(document.body.textContent ?? '') ||
      [...document.querySelectorAll('[role="alert"]')].some((node) =>
        /No proposal was created or applied/i.test(node.textContent ?? ''),
      ),
    undefined,
    { timeout },
  );
  const failure = run.app
    .getByRole('alert')
    .filter({ hasText: 'No proposal was created or applied' })
    .last();
  if (await failure.isVisible().catch(() => false)) {
    throw new Error(`Turbo run failed: ${cleanText(await failure.textContent())}`);
  }
  return { turbo: true, autoApplied: true, undoPreserved: true };
}

async function assertMultiAgentHandoffs(run, { present = false } = {}) {
  await openInspectorTab(run, 'ai');
  const showMore = run.app.getByTestId('agent-nested-show-more');
  while (await showMore.isVisible().catch(() => false)) await humanClick(run, showMore);
  const roles = ['Researcher', 'Analyst', 'Storyteller', 'Designer', 'Fact checker', 'Reviewer'];
  const found = [];
  const thread = run.app.getByTestId('assistant-ui-thread');
  for (const role of roles) {
    const locator = thread.getByText(new RegExp(`\\b${escapeRegExp(role)}\\b`, 'i')).first();
    await locator.waitFor({ state: 'attached', timeout: 60_000 });
    found.push(role);
  }
  const activity = cleanText(await thread.textContent().catch(() => ''));
  const parallelGroups = activity.match(/parallel/gi)?.length ?? 0;
  if (present) await run.page.waitForTimeout(1_500);
  return { roles: found, visibleHandoffs: true, parallelSignals: parallelGroups };
}

async function traceCheckpoint(run, id) {
  return await checkpoint(run, id, async () => {
    await openInspectorTab(run, 'trace');
    await run.app
      .getByRole('heading', { name: 'Run details' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    const picker = run.app.locator('label.ns-trace-picker select');
    const options = await picker.locator('option').count();
    let health = '';
    for (let index = 0; index < options; index += 1) {
      await picker.selectOption({ index });
      const summary = run.app.getByLabel('Compact trace activity');
      await summary.waitFor({ state: 'visible', timeout: 15_000 });
      health = cleanText(await summary.getByLabel('Trace health summary').textContent());
      if (/[1-9]\d*\s+cited/i.test(health)) break;
    }
    if (!/[1-9]\d*\s+cited/i.test(health))
      throw new Error('No source-bound trace run is available.');
    await humanClick(run, run.app.getByRole('button', { name: 'Open full trace timeline' }));
    const expanded = run.app.getByLabel('Expanded trace observability view');
    await expanded.waitFor({ state: 'visible', timeout: 15_000 });
    const waterfall = run.app.getByTestId('trace-waterfall');
    await waterfall.waitFor({ state: 'visible', timeout: 15_000 });
    await humanClick(run, waterfall.getByRole('button', { name: 'Sources', exact: true }));
    const citations = run.app.getByTestId('trace-source-citation');
    await citations.first().waitFor({ state: 'visible', timeout: 15_000 });
    const count = await citations.count();
    await humanClick(run, citations.first());
    await humanClick(run, run.app.getByRole('button', { name: 'Exit expanded trace view' }));
    return { traceHealth: health, sourceCitationCount: count, waterfall: true };
  });
}

async function openPrimitive(run, kind) {
  const index = run.primitives.get(kind);
  if (!Number.isInteger(index))
    throw new Error(`No ${kind} primitive was mapped for ${run.deckPlan.id}.`);
  const edit = run.app.getByRole('tab', { name: 'Edit', exact: true });
  if ((await edit.getAttribute('aria-selected')) !== 'true') await humanClick(run, edit);
  await humanClick(run, run.app.locator('[data-testid^="slide-thumbnail-"]').nth(index));
  await run.app
    .locator(`.ns-editor-edit-canvas .ns-slide-element--${kind}`)
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
}

async function clearSlideSelection(run) {
  const summary = run.app.locator('.ns-slide-selection-summary.has-selection');
  if (await summary.isVisible().catch(() => false)) {
    await humanClick(run, summary.getByRole('button', { name: 'Clear', exact: true }));
  }
}

async function openInspectorTab(run, id) {
  const tab = run.app.getByTestId(`inspector-tab-${id}`);
  if (!(await tab.isVisible().catch(() => false))) {
    const open = run.app.getByRole('button', { name: 'Open inspector' });
    if (await open.isVisible().catch(() => false)) await humanClick(run, open);
  }
  await humanClick(run, tab);
}

async function openConnections(run) {
  await humanClick(run, run.app.getByRole('button', { name: 'Project actions' }));
  await humanClick(run, run.app.getByRole('menuitem').filter({ hasText: 'Connections' }));
  const dialog = run.app.getByRole('dialog', { name: 'Connect your own runtime' });
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}

async function exerciseAuthorizedGoogleSync(run, dialog) {
  const connected = dialog.getByText('OAuth authorized', { exact: false });
  if (!(await connected.isVisible().catch(() => false))) {
    throw new Error(
      '--google-sync requires Google Slides to already be authorized in this browser session.',
    );
  }
  const create = dialog.getByRole('button', { name: 'Create compatible target' });
  if (await create.isVisible().catch(() => false)) {
    await humanClick(run, create);
    await dialog
      .getByRole('button', { name: /Plan NodeSlide push/ })
      .waitFor({ state: 'visible', timeout: 60_000 });
  }
  await humanClick(run, dialog.getByRole('button', { name: /Plan NodeSlide push/ }));
  const push = dialog.getByRole('button', { name: 'Push and verify' });
  await push.waitFor({ state: 'visible', timeout: 60_000 });
  await humanClick(run, push);
  await dialog
    .getByText(/Synchronization verified/i)
    .waitFor({ state: 'visible', timeout: 120_000 });
  return 'created, pushed, and read-after-write verified';
}

async function currentDeckVersion(run) {
  const label = run.app.locator('.ns-version-label').first();
  await label.waitFor({ state: 'visible', timeout: 15_000 });
  const match = cleanText(await label.textContent()).match(/v(\d+)/i);
  if (!match) throw new Error('The current deck version is not visible.');
  return Number.parseInt(match[1], 10);
}

async function waitForVersionAdvance(run, baseVersion, timeout = 60_000) {
  await run.app.waitForFunction(
    (base) => {
      const label = document.querySelector('.ns-version-label')?.textContent ?? '';
      const match = label.match(/v(\d+)/i);
      return Boolean(match && Number.parseInt(match[1], 10) > base);
    },
    baseVersion,
    { timeout },
  );
  return await currentDeckVersion(run);
}

async function humanClick(run, locator, { moveMs = 420, settleMs = 220 } = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await moveCursor(run, locator, moveMs);
  await run.page.evaluate(() => window.__demoCursorClick?.());
  await locator.click({ timeout: 15_000 });
  await run.page.waitForTimeout(settleMs);
}

async function humanCheck(run, locator) {
  if (await locator.isChecked().catch(() => false)) return;
  await moveCursor(run, locator, 360);
  await run.page.evaluate(() => window.__demoCursorClick?.());
  await locator.check({ timeout: 10_000 });
  await run.page.waitForTimeout(220);
}

async function humanType(run, locator, text, { clear = false } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await moveCursor(run, locator, 420);
  await run.page.evaluate(() => window.__demoCursorClick?.());
  await locator.click();
  if (clear) {
    await locator.press('Control+A').catch(() => {});
    await locator.press('Backspace').catch(() => {});
  }
  await locator.pressSequentially(text, {
    delay: typingDelayMs,
    timeout: Math.max(30_000, text.length * typingDelayMs * 3),
  });
  await run.page.waitForTimeout(260);
}

async function moveCursor(run, locator, duration = 420) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Visible cursor target has no bounding box.');
  const x = Math.round(box.x + Math.max(8, Math.min(box.width * 0.62, box.width - 8)));
  const y = Math.round(box.y + Math.max(8, Math.min(box.height * 0.58, box.height - 8)));
  await run.page.evaluate(({ x, y, duration }) => window.__demoCursorMove?.(x, y, duration), {
    x,
    y,
    duration,
  });
  await run.page.mouse.move(x, y, { steps: Math.max(4, Math.round(duration / 55)) });
  await run.page.waitForTimeout(duration + 60);
}

async function showCaption(run, text) {
  await run.page.evaluate((caption) => {
    const node = document.getElementById('__demo_caption');
    if (!node) throw new Error('Recorder caption overlay is missing.');
    node.textContent = caption;
    node.classList.add('is-visible');
  }, text);
}

async function syncAddress(run) {
  await run.page.getByLabel('Address').fill(cleanUrl(run.app.url()));
}

async function firstVisible(locators) {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      if (
        await locator
          .nth(index)
          .isVisible()
          .catch(() => false)
      )
        return locator.nth(index);
    }
  }
  throw new Error('Required visible control was not found.');
}

async function waitForStableCount(locator, expected, timeout) {
  const started = Date.now();
  let stableSince = 0;
  while (Date.now() - started < timeout) {
    const count = await locator.count();
    if (count === expected) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince > 1_000) return;
    } else stableSince = 0;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Expected exactly ${expected} slides; found ${await locator.count()}.`);
}

function browserShellMarkup(url) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#111827;font-family:Inter,Arial,sans-serif}.chrome{height:72px;background:#e9ebef;border-bottom:1px solid #c8cbd1;display:grid;grid-template-columns:120px 1fr 210px;gap:16px;align-items:center;padding:10px 18px;color:#374151}.traffic{display:flex;gap:10px}.traffic i{width:14px;height:14px;border-radius:50%}.traffic i:nth-child(1){background:#ff5f57}.traffic i:nth-child(2){background:#febc2e}.traffic i:nth-child(3){background:#28c840}.address{height:46px;border:1px solid #b8bdc7;border-radius:13px;background:#fff;display:flex;align-items:center;padding:0 16px;box-shadow:0 1px 3px #00000014}.address:focus-within{border-color:#b45f43;box-shadow:0 0 0 3px #b45f4324}.address input{width:100%;border:0;outline:0;font:500 15px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:#111827}.tab{font-size:13px;font-weight:650;white-space:nowrap}.app{display:block;width:100%;height:calc(100% - 72px);border:0;background:#fafafa}.cursor{position:fixed;z-index:2147483647;width:30px;height:38px;left:50%;top:52%;pointer-events:none;filter:drop-shadow(0 2px 2px #0008);transform-origin:3px 3px}.cursor svg{width:100%;height:100%}.caption{position:fixed;z-index:2147483646;left:50%;bottom:34px;max-width:1180px;transform:translateX(-50%) translateY(12px);padding:13px 22px;border-radius:12px;background:#111827dc;color:#fff;font:650 22px/1.32 Inter,Arial,sans-serif;text-align:center;box-shadow:0 8px 32px #0005;opacity:0;transition:.24s ease;pointer-events:none}.caption.is-visible{opacity:1;transform:translateX(-50%) translateY(0)}
</style></head><body><header class="chrome"><div class="traffic"><i></i><i></i><i></i></div><label class="address"><span style="position:absolute;width:1px;height:1px;overflow:hidden">Address</span><input aria-label="Address" value=""></label><div class="tab">NodeSlide · Three-deck launch</div></header><iframe class="app" name="nodeslide-app" title="NodeSlide application"></iframe><div id="__demo_cursor" class="cursor"><svg viewBox="0 0 28 36"><path d="M2 2L23 21h-9l5 11-5 2-5-11-7 7z" fill="#fff" stroke="#111827" stroke-width="2" stroke-linejoin="round"/></svg></div><div id="__demo_caption" class="caption" role="status"></div><script>const cursor=document.getElementById('__demo_cursor');window.__demoCursorMove=(x,y,duration=420)=>{cursor.animate([{left:cursor.style.left,top:cursor.style.top},{left:x+'px',top:y+'px'}],{duration,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});cursor.style.left=x+'px';cursor.style.top=y+'px'};window.__demoCursorClick=()=>cursor.animate([{transform:'scale(1)'},{transform:'scale(.72)'},{transform:'scale(1)'}],{duration:220,easing:'ease-out'});window.__target=${JSON.stringify(url)};</script></body></html>`;
}

function validatePlan(value) {
  if (value?.schema !== 'nodeslide-three-deck-launch/v1')
    throw new Error('Invalid recording plan schema.');
  if (!Array.isArray(value.decks) || value.decks.length !== 3)
    throw new Error('Plan must define exactly three decks.');
  const expected = ['ai-2027', 'ai-fund', 'world-cup'];
  if (JSON.stringify(value.decks.map((deck) => deck.id)) !== JSON.stringify(expected)) {
    throw new Error(`Plan deck order must be ${expected.join(', ')}.`);
  }
  for (const deck of value.decks) {
    if (!deck.prompt?.trim() || !Number.isInteger(deck.slideCount) || deck.slideCount < 3) {
      throw new Error(`Deck ${deck.id} has an invalid prompt or slide count.`);
    }
  }
  if (!value.captions || typeof value.captions !== 'object')
    throw new Error('Plan captions are missing.');
  const missingCaptions = REQUIRED_CHECKPOINTS.filter(
    (checkpoint) => !value.captions[checkpoint]?.trim(),
  );
  const unknownCaptions = Object.keys(value.captions).filter(
    (checkpoint) => !REQUIRED_CHECKPOINTS.includes(checkpoint),
  );
  if (missingCaptions.length) {
    throw new Error(`Plan is missing captions for: ${missingCaptions.join(', ')}.`);
  }
  if (unknownCaptions.length) {
    throw new Error(`Plan has unknown checkpoint captions: ${unknownCaptions.join(', ')}.`);
  }
  return value;
}

function assertLandingUrl(value) {
  const url = new URL(value);
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `Fresh creation did not begin at the canonical landing URL: ${cleanUrl(value)}`,
    );
  }
}

function deckIdFromUrl(value) {
  const url = new URL(value);
  return url.searchParams.get('deck') ?? url.pathname.match(/deck[=/]([^/?#]+)/)?.[1] ?? null;
}

function canonicalRoot(value) {
  const url = new URL(value);
  if (url.search || url.hash)
    throw new Error('--target-url must not contain a deck, query, or hash.');
  url.pathname = '/';
  return url.toString();
}

async function inspectInput(path) {
  if (!path) return { path: null, exists: false, bytes: 0, sha256: null };
  try {
    const details = await stat(path);
    if (!details.isFile()) return { path, exists: false, bytes: 0, sha256: null };
    return {
      path,
      exists: true,
      bytes: details.size,
      sha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    };
  } catch {
    return { path, exists: false, bytes: 0, sha256: null };
  }
}

function assertLiveInput(input, label) {
  if (!input.exists) throw new Error(`${label} is required and must be a readable file.`);
}

function transcodeToMp4(webm, mp4) {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.status !== 0) return null;
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      webm,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      mp4,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0)
    throw new Error(`ffmpeg MP4 transcode failed with status ${result.status}.`);
  return mp4;
}

async function writeEvidence(evidence) {
  await writeJson(resolve(outputDir, 'evidence.json'), evidence);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(redact(value), null, 2)}\n`, 'utf8');
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /secret|token|password|access.?key|owner.?key|capability/i.test(key)
        ? '[redacted]'
        : redact(item),
    ]),
  );
}

function serializeError(error) {
  return { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/token|secret|key|code/i.test(key)) url.searchParams.set(key, '[redacted]');
  }
  return url.toString();
}

function optionalPath(value) {
  return value ? resolve(value) : null;
}

function relativeRepoPath(path) {
  if (!path) return null;
  const root = `${repoRoot.replaceAll('\\', '/')}/`;
  const normalized = resolve(path).replaceAll('\\', '/');
  return normalized.startsWith(root) ? normalized.slice(root.length) : normalized;
}

function gitCommitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function boundedInteger(value, min, max, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function parseArgs(values) {
  const parsed = { dryRun: false, headed: false, googleSync: false };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === '--dry-run') parsed.dryRun = true;
    else if (flag === '--headed') parsed.headed = true;
    else if (flag === '--google-sync') parsed.googleSync = true;
    else if (flag === '--target-url') parsed.targetUrl = requireValue(values, ++index, flag);
    else if (flag === '--output-dir') parsed.outputDir = requireValue(values, ++index, flag);
    else if (flag === '--world-cup-data') parsed.worldCupData = requireValue(values, ++index, flag);
    else if (flag === '--ai-fund-image') parsed.aiFundImage = requireValue(values, ++index, flag);
    else if (flag === '--image-credit') parsed.imageCredit = requireValue(values, ++index, flag);
    else if (flag === '--typing-delay-ms')
      parsed.typingDelayMs = requireValue(values, ++index, flag);
    else if (flag === '--probe-through-checkpoint')
      parsed.probeThroughCheckpoint = requireValue(values, ++index, flag);
    else if (flag === '--help' || flag === '-h') {
      console.log(
        'Usage: node scripts/record-nodeslide-three-deck-launch.mjs [options]\n\n  --dry-run\n  --target-url URL\n  --output-dir PATH\n  --world-cup-data PATH\n  --ai-fund-image PATH\n  --image-credit TEXT\n  --typing-delay-ms N\n  --probe-through-checkpoint ID\n  --google-sync\n  --headed',
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  return parsed;
}

function requireValue(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}
