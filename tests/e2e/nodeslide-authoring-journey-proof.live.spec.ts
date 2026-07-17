import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'playwright/test';
import { readVersionState } from './helpers';
import {
  chooseDeterministicLandingModel,
  chooseLandingModel,
  grantLandingSessionConsent,
  openIsolatedLanding,
} from './landing-start-flow.helpers';

const enabled =
  process.env['NODESLIDE_JOURNEY_PROOF'] === '1' &&
  process.env['NODESLIDE_E2E_LIVE_BACKEND'] === '1' &&
  process.env['NODESLIDE_E2E_MUTATIONS'] === '1';
const journeyMode = process.env['NODESLIDE_JOURNEY_MODE'] === 'live' ? 'live' : 'deterministic';
const creationMode =
  process.env['NODESLIDE_JOURNEY_CREATION_MODE'] === 'live' ? 'live' : 'deterministic';

test.describe('NodeSlide self-authored browser journey proof', () => {
  test.skip(
    !enabled,
    'Requires NODESLIDE_JOURNEY_PROOF=1, live backend coverage, and an isolated mutation-safe deployment.',
  );

  test('creates its own deck, validates and applies once, exposes Undo, exports, and records proof', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const outputDirectory = path.resolve(
      process.env['NODESLIDE_JOURNEY_OUTPUT'] ??
        path.join(
          'artifacts',
          `nodeslide-journey-${new Date().toISOString().replace(/[:.]/gu, '-')}`,
        ),
    );
    await mkdir(outputDirectory, { recursive: true });
    const steps: Array<Record<string, unknown>> = [];
    const step = (kind: string, extra: Record<string, unknown> = {}) => {
      steps.push({ kind, occurredAt: Date.now(), ...extra });
    };

    await openIsolatedLanding(page);
    if (creationMode === 'live') {
      await chooseLandingModel(page, { group: 'More live models', label: 'GLM 5.2' });
      await page.getByTestId('landing-effort-select').selectOption('low');
      await expect(page.getByTestId('landing-effort-select')).toHaveValue('low');
      await grantLandingSessionConsent(page);
    } else {
      await chooseDeterministicLandingModel(page);
    }
    const brief = [
      'Create exactly seven visually ambitious, claim-led slides explaining why NodeSlide should dogfood its own authoring system.',
      'Audience: product and design leadership. Decision: approve the governed live-agent authoring roadmap and require recorded browser proof for every release.',
      'Use a refined editorial product-design aesthetic: warm off-white canvas, near-black typography, electric blue and coral accents, generous whitespace, strong hierarchy, and a distinct composition on every slide. Avoid repeated bullet-card grids. Keep every visible object natively editable.',
      'Use this exact layout contract in order: hero, comparison, contract, flow, split, evidence_board, decision.',
      'Slide 1 is a bold thesis cover: "NodeSlide must beat one-shot generation on governed creativity," with one supporting line and a visual tension motif.',
      'Slide 2 is a three-column competitive landscape. Canva AI wins brand and asset velocity; Gamma AI wins research-to-story speed; NodeSlide must own editable, governed execution.',
      'Slide 3 is an authoring contract that locks audience, decision, evidence ledger, and claim-led storyboard before layout. Show it as a structured editorial artifact, not bullets.',
      'Slide 4 is the only diagram: use exactly four short native editable nodes labeled Strategy, Agent team, Validate + review, and Editable export.',
      'Slide 5 uses a split composition: bounded repair on the left; HyperAgent-inspired versioned policy evolution, held-out evaluation, and safe promotion on the right.',
      'Slide 6 is an evidence board with labeled proof slots for provider, named model, input and output tokens, nonzero cost, candidate digest, durable validation receipt, version delta, and export artifact. Do not invent values.',
      'Slide 7 is a decisive release-gate checklist ending with "Approve the quality gate and require recorded proof for every release."',
      'Keep copy concise, use sentence-case headlines, preserve source notes for external references, and do not invent data or benchmark metrics.',
      'Treat Canva and Gamma as design inspirations rather than unverified performance claims. Treat HyperAgent as inspiration for versioned policy evolution, held-out evaluation, and safe promotion—not permission to mutate production code. Keep every object editable and do not invent data.',
    ].join(' ');
    await page.getByLabel('Presentation brief').fill(brief);
    await page.getByRole('button', { name: 'Create presentation' }).click();
    step('brief_submitted');

    await expect(page.getByTestId('deck-title')).toBeVisible({ timeout: 180_000 });
    const deckUrl = new URL(page.url());
    const deckId = deckUrl.searchParams.get('deck');
    if (!deckId) throw new Error('The created deck URL is missing its deck id.');
    step('deck_created', { deckVersion: 1 });
    await expect(page.getByRole('button', { name: /^Slide \d+:/u })).toHaveCount(7);
    const base = await readVersionState(page);

    const creationTrace =
      creationMode === 'live' ? await captureTrace(page, 'brief-to-deck', true) : null;
    if (creationTrace) step('live_creation_verified', creationTrace);

    await page.getByTestId('inspector-tab-ai').click();
    const turbo = page.getByRole('switch', { name: 'Turbo for this session' });
    await expect(turbo).toBeVisible();
    if ((await turbo.getAttribute('aria-checked')) !== 'true') await turbo.click();
    await expect(turbo).toHaveAttribute('aria-checked', 'true');
    if (journeyMode === 'live' && creationMode !== 'live') {
      await chooseEditorModel(page, { group: 'More live models', label: 'GLM 5.2' });
    }
    await expect(page.getByTestId('ai-model-select')).toContainText(
      journeyMode === 'live' ? 'GLM 5.2' : 'Deterministic',
    );
    if (journeyMode === 'live') {
      const consent = page.getByTestId('ai-provider-consent');
      await expect(consent).toBeVisible();
      if (!(await consent.isChecked())) await consent.check();
    }
    await page.getByRole('button', { name: /^Slide 6:/u }).click();
    const headline = page.getByRole('button', { name: 'Headline, text slide element' });
    const beforeContentDigest = digest((await headline.innerText()).trim());
    const composer = page.getByLabel('AI instruction');
    await composer.fill(
      'On slide 6, replace only the unlocked Headline text element with "A live run is only real when its receipt survives export." Use exactly one replace_text operation with the existing headline elementId; do not use update_slide.',
    );
    await composer.press('Enter');
    step('edit_submitted', { deckVersion: base.version });

    const appliedCard = page.getByTestId('applied-change-card');
    await expect(appliedCard).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('proposal-accept')).toHaveCount(0);
    const applied = await readVersionState(page);
    expect(applied.version).toBe(base.version + 1);
    await page.getByTestId('inspector-tab-ai').click();

    const binding = await appliedCard.evaluate((element) => ({
      runId: element.getAttribute('data-run-id') ?? '',
      patchId: element.getAttribute('data-patch-id') ?? '',
      candidateDigest: element.getAttribute('data-candidate-digest') ?? '',
      baseDeckVersion: Number(element.getAttribute('data-base-version')),
      resultingDeckVersion: Number(element.getAttribute('data-resulting-version')),
    }));
    expect(binding.runId).not.toBe('');
    expect(binding.patchId).not.toBe('');
    expect(binding.candidateDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(binding.baseDeckVersion).toBe(base.version);
    expect(binding.resultingDeckVersion).toBe(applied.version);
    const appliedContent = (await headline.innerText()).trim();
    const appliedContentDigest = digest(appliedContent);

    const editTrace = await captureTrace(page, 'edit-auto-apply', journeyMode === 'live');
    if (journeyMode === 'live') step('live_edit_verified', editTrace);
    const validationDigest = digest(JSON.stringify({ binding, traceText: editTrace.traceText }));
    step('validation_received', {
      deckVersion: base.version,
      receiptDigest: validationDigest,
      ...binding,
    });
    await page.getByTestId('inspector-tab-ai').click();
    await expect(appliedCard).toBeVisible();
    const appliedReceiptDigest = digest(`${await appliedCard.innerText()}\n${editTrace.traceText}`);
    step('edit_applied', {
      deckVersion: applied.version,
      receiptDigest: appliedReceiptDigest,
      contentDigest: appliedContentDigest,
      ...binding,
    });
    await expect(page.getByTestId('applied-change-undo')).toBeEnabled();
    const finalScreenshotPath = path.join(outputDirectory, 'final-editor.png');
    await page.screenshot({ path: finalScreenshotPath, fullPage: true });

    await page.getByTestId('applied-change-undo').click();
    await expect(page.locator('.ns-version-label')).toHaveText(`v${applied.version + 1}`, {
      timeout: 60_000,
    });
    const undone = await readVersionState(page);
    await page.getByRole('button', { name: /^Slide 6:/u }).click();
    const undoneContentDigest = digest((await headline.innerText()).trim());
    expect(undoneContentDigest).toBe(beforeContentDigest);
    step('undo_verified', {
      deckVersion: undone.version,
      patchId: binding.patchId,
      contentDigest: undoneContentDigest,
      receiptDigest: digest(`undo:${binding.patchId}:${undone.version}:${undoneContentDigest}`),
    });

    const redo = page.getByRole('button', { name: 'Redo' });
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(page.locator('.ns-version-label')).toHaveText(`v${applied.version + 2}`, {
      timeout: 60_000,
    });
    const redone = await readVersionState(page);
    await page.getByRole('button', { name: /^Slide 6:/u }).click();
    const redoneContentDigest = digest((await headline.innerText()).trim());
    expect(redoneContentDigest).toBe(appliedContentDigest);
    step('redo_verified', {
      deckVersion: redone.version,
      patchId: binding.patchId,
      contentDigest: redoneContentDigest,
      receiptDigest: digest(`redo:${binding.patchId}:${redone.version}:${redoneContentDigest}`),
    });
    step('version_advanced', { deckVersion: redone.version });

    const slideScreenshotPaths: string[] = [];
    const compositionFingerprints: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      await page.getByRole('button', { name: new RegExp(`^Slide ${index + 1}:`, 'u') }).click();
      const canvas = page.getByRole('region', { name: `Canvas, slide ${index + 1}` });
      await expect(canvas).toBeVisible();
      const visibleCopy = (await canvas.innerText()).replace(/\s+/gu, ' ').trim();
      expect(visibleCopy, `Slide ${index + 1} leaked authoring instructions`).not.toMatch(
        /Slide \d+ is|use exactly/iu,
      );
      if (index === 3) {
        await expect(canvas.getByRole('button', { name: /^Diagram node \d+,/u })).toHaveCount(4);
        await expect(canvas.getByRole('button', { name: /^Diagram connector \d+,/u })).toHaveCount(
          3,
        );
      }
      compositionFingerprints.push(
        await canvas.locator('[data-element-id]').evaluateAll((elements) =>
          elements
            .map((element) => {
              const style = getComputedStyle(element);
              return `${element.getAttribute('data-element-kind')}:${style.left}:${style.top}:${style.width}:${style.height}`;
            })
            .sort()
            .join('|'),
        ),
      );
      const screenshotPath = path.join(
        outputDirectory,
        `slide-${String(index + 1).padStart(2, '0')}.png`,
      );
      await canvas.screenshot({ path: screenshotPath });
      slideScreenshotPaths.push(screenshotPath);
    }
    expect(new Set(compositionFingerprints).size).toBe(7);
    step('full_deck_visual_qa', {
      deckVersion: redone.version,
      slideCount: slideScreenshotPaths.length,
      distinctCompositionCount: new Set(compositionFingerprints).size,
      screenshotDigest: digest(slideScreenshotPaths.join('\n')),
    });

    await page.getByRole('button', { name: 'Export deck' }).click();
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('export-pptx').click();
    const download = await downloadPromise;
    const exportedDeckPath = path.join(outputDirectory, 'nodeslide-self-authored.pptx');
    await download.saveAs(exportedDeckPath);
    step('export_downloaded', { deckVersion: redone.version, artifactPath: exportedDeckPath });

    const video = page.video();
    if (!video) throw new Error('Journey proof mode did not enable Playwright video.');
    await page.close();
    const rawRecordingPath = path.join(outputDirectory, 'browser-journey.webm');
    await video.saveAs(rawRecordingPath);
    const gifPath = path.join(outputDirectory, 'browser-journey.gif');
    runNodeScript('scripts/nodeslide-journey-gif.mjs', [
      '--input',
      rawRecordingPath,
      '--output',
      gifPath,
    ]);

    const runManifestPath = path.join(outputDirectory, 'run-manifest.json');
    await writeFile(
      runManifestPath,
      `${JSON.stringify(
        {
          deckId,
          journeyMode,
          creationMode,
          modelExpectation: journeyMode === 'live' ? 'openrouter / z-ai/glm-5.2' : 'deterministic',
          expectedLayouts: [
            'hero',
            'comparison',
            'contract',
            'flow',
            'split',
            'evidence_board',
            'decision',
          ],
          liveCreationTrace: creationTrace,
          liveEditTrace: editTrace,
          expectedCreationProvenance: 'brief_to_new_deck',
          actualCreationProvenance: 'brief_to_new_deck',
          baseVersion: base.version,
          appliedVersion: applied.version,
          finalVersion: redone.version,
          steps,
          artifacts: {
            rawRecordingPath,
            gifPath,
            finalScreenshotPath,
            slideScreenshotPaths,
            exportedDeckPath,
            runManifestPath,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    runNodeScript('scripts/nodeslide-journey-proof.mjs', ['--manifest', runManifestPath]);
  });
});

async function captureTrace(
  page: import('playwright/test').Page,
  phase: string,
  requireLiveProvider: boolean,
) {
  await page.getByTestId('inspector-tab-trace').click();
  const trace = page.locator('.ns-trace-summary').first();
  await expect(trace).toBeVisible({ timeout: 120_000 });
  const traceText = (await trace.innerText()).replace(/\s+/gu, ' ').trim();
  expect(traceText, `${phase} must expose passing validation`).toMatch(/Validation\s+Passed/iu);
  if (!requireLiveProvider) return { phase, traceText };
  expect(traceText, `${phase} must identify OpenRouter`).toMatch(/openrouter/iu);
  expect(traceText, `${phase} must identify GLM 5.2`).toMatch(/(?:z-ai\/glm-5\.2|GLM 5\.2)/iu);
  expect(traceText, `${phase} must not be a deterministic fallback`).not.toMatch(
    /deterministic fallback|provider attempt before fallback|no external provider billing.*fallback/iu,
  );
  const tokenText = await trace
    .locator('.ns-trace-kpis > span')
    .filter({ hasText: 'Tokens' })
    .innerText();
  const tokenValues = tokenText.match(/[\d,]+/gu) ?? [];
  expect(tokenValues, `${phase} must expose input and output token usage`).toHaveLength(2);
  const inputTokens = Number(tokenValues[0]?.replaceAll(',', ''));
  const outputTokens = Number(tokenValues[1]?.replaceAll(',', ''));
  expect(inputTokens).toBeGreaterThan(0);
  expect(outputTokens).toBeGreaterThan(0);
  const costText = await trace
    .locator('.ns-trace-kpis > span')
    .filter({ hasText: 'Cost' })
    .innerText();
  const costMatch = costText.match(/\$(\d+\.\d+)/u);
  expect(costMatch, `${phase} must expose cost`).not.toBeNull();
  const costUsd = Number(costMatch?.[1]);
  expect(costUsd).toBeGreaterThan(0);
  return { phase, inputTokens, outputTokens, costUsd, traceText };
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function chooseEditorModel(
  page: import('playwright/test').Page,
  model: { group: string; label: string },
) {
  await page.getByTestId('ai-model-select').click();
  const dialog = page.getByRole('dialog', { name: 'Agent model' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(model.group).getByText(model.label, { exact: true }).click();
  await expect(dialog).toBeHidden();
}

function runNodeScript(script: string, args: string[]): void {
  const result = spawnSync(process.execPath, [path.resolve(script), ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed: ${result.stderr || result.stdout}`);
  }
}
