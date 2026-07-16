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

test.describe('NodeSlide self-authored browser journey proof', () => {
  test.skip(
    !enabled,
    'Requires NODESLIDE_JOURNEY_PROOF=1, live backend coverage, and an isolated mutation-safe deployment.',
  );

  test('creates its own deck, proposes, compares, validates, accepts once, exports, and records proof', async ({
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
    if (journeyMode === 'live') {
      await chooseLandingModel(page, { group: 'More live models', label: 'GLM 5.2' });
      await grantLandingSessionConsent(page);
    } else {
      await chooseDeterministicLandingModel(page);
    }
    const brief = [
      'Create exactly seven visually ambitious, claim-led slides explaining why NodeSlide should dogfood its own authoring system.',
      'Audience: product and design leadership. Decision: approve the governed live-agent authoring roadmap and require recorded browser proof for every release.',
      'Use a refined editorial product-design aesthetic: warm off-white canvas, near-black typography, electric blue and coral accents, generous whitespace, strong hierarchy, and a distinct composition on every slide. Avoid repeated bullet-card grids. Keep every visible object natively editable.',
      'Use this exact layout contract in order: hero, comparison, contract, flow, split, evidence_board, decision.',
      'Slide 1 is a bold thesis cover: “NodeSlide must beat one-shot generation on governed creativity,” with one supporting line and a visual tension motif.',
      'Slide 2 is a three-column competitive landscape. Canva AI wins brand and asset velocity; Gamma AI wins research-to-story speed; NodeSlide must own editable, governed execution.',
      'Slide 3 is an authoring contract that locks audience, decision, evidence ledger, and claim-led storyboard before layout. Show it as a structured editorial artifact, not bullets.',
      'Slide 4 is the only diagram: use exactly four short native editable nodes labeled Strategy, Agent team, Validate + review, and Editable export.',
      'Slide 5 uses a split composition: bounded repair on the left; HyperAgent-inspired versioned policy evolution, held-out evaluation, and safe promotion on the right.',
      'Slide 6 is an evidence board with labeled proof slots for provider, named model, input and output tokens, nonzero cost, candidate digest, durable validation receipt, version delta, and export artifact. Do not invent values.',
      'Slide 7 is a decisive release-gate checklist ending with “Approve the quality gate and require recorded proof for every release.”',
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
      journeyMode === 'live' ? await captureLiveTrace(page, 'brief-to-deck') : null;
    if (creationTrace) step('live_creation_verified', creationTrace);

    await page.getByTestId('inspector-tab-ai').click();
    await expect(page.getByTestId('ai-model-select')).toContainText(
      journeyMode === 'live' ? 'GLM 5.2' : 'Deterministic',
    );
    if (journeyMode === 'live') {
      const consent = page.getByTestId('ai-provider-consent');
      await expect(consent).toBeVisible();
      if (!(await consent.isChecked())) await consent.check();
    }
    const turbo = page.getByRole('switch', { name: 'Turbo for this session' });
    if (await turbo.isChecked()) await turbo.uncheck();
    await page.getByRole('button', { name: /^Slide 6:/u }).click();
    const composer = page.getByLabel('AI instruction');
    await composer.fill(
      'Replace the headline exactly with "A live run is only real when its receipt survives export."',
    );
    await composer.press('Enter');
    const proposal = page.getByTestId('proposal-card').first();
    await expect(proposal).toBeVisible({ timeout: 120_000 });
    step('proposal_ready', { deckVersion: base.version });

    const editTrace = journeyMode === 'live' ? await captureLiveTrace(page, 'edit-proposal') : null;
    if (editTrace) step('live_edit_verified', editTrace);
    await page.getByTestId('inspector-tab-ai').click();

    const preview = proposal.getByTestId('proposal-preview');
    await expect(preview).toBeEnabled();
    if ((await preview.getAttribute('aria-pressed')) !== 'true') await preview.click();
    await expect(page.getByLabel('Baseline and candidate comparison')).toBeVisible({
      timeout: 60_000,
    });
    step('compare_opened', { deckVersion: base.version });
    const receipt = page.getByTestId('candidate-receipt');
    await expect(receipt).toHaveAttribute('data-candidate-status', 'ready', { timeout: 120_000 });
    const validationDigest = digest(await receipt.innerText());
    step('validation_received', { deckVersion: base.version, receiptDigest: validationDigest });

    await expect(proposal.getByTestId('proposal-accept')).toBeEnabled();
    await proposal.getByTestId('proposal-accept').dblclick();
    const acceptedNotice = page.getByText('Validated proposal accepted as a new deck version.');
    await expect(acceptedNotice).toBeVisible({ timeout: 60_000 });
    step('proposal_accepted', { receiptDigest: digest(await acceptedNotice.innerText()) });
    const accepted = await readVersionState(page);
    expect(accepted.version).toBe(base.version + 1);
    step('version_advanced', { deckVersion: accepted.version });

    await page.getByRole('button', { name: 'Export deck' }).click();
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('export-pptx').click();
    const download = await downloadPromise;
    const exportedDeckPath = path.join(outputDirectory, 'nodeslide-self-authored.pptx');
    await download.saveAs(exportedDeckPath);
    step('export_downloaded', { deckVersion: accepted.version, artifactPath: exportedDeckPath });

    const finalScreenshotPath = path.join(outputDirectory, 'final-editor.png');
    await page.screenshot({ path: finalScreenshotPath, fullPage: true });
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
          acceptedVersion: accepted.version,
          steps,
          artifacts: {
            rawRecordingPath,
            gifPath,
            finalScreenshotPath,
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

async function captureLiveTrace(page: import('playwright/test').Page, phase: string) {
  await page.getByTestId('inspector-tab-trace').click();
  const trace = page.locator('.ns-trace-summary').first();
  await expect(trace).toBeVisible({ timeout: 120_000 });
  const traceText = (await trace.innerText()).replace(/\s+/gu, ' ').trim();
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
  expect(traceText, `${phase} must expose passing validation`).toMatch(/Validation\s+Passed/iu);
  return { phase, inputTokens, outputTokens, costUsd, traceText };
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
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
