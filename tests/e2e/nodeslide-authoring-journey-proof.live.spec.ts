import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'playwright/test';
import { readVersionState } from './helpers';
import { chooseDeterministicLandingModel, openIsolatedLanding } from './landing-start-flow.helpers';

const enabled =
  process.env['NODESLIDE_JOURNEY_PROOF'] === '1' &&
  process.env['NODESLIDE_E2E_LIVE_BACKEND'] === '1' &&
  process.env['NODESLIDE_E2E_MUTATIONS'] === '1';

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
    await chooseDeterministicLandingModel(page);
    const brief = [
      'Create exactly seven concise, claim-led slides explaining why NodeSlide should dogfood its own authoring system.',
      'Audience: product and design leadership.',
      'Slide 1 states that NodeSlide should ship governed creativity, not one-shot generation. Slide 2 benchmarks Canva AI, Gamma AI, NodeSlide, and Meta HyperAgent. Slide 3 defines the communication job, evidence ledger, and claim-led storyboard. Slide 4 shows the editable authoring workflow as a native diagram. Slide 5 separates specialist critics, bounded repair, and policy evolution. Slide 6 proves the browser journey, durable receipt, version advance, and editable export. Slide 7 ends with the adoption checklist.',
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

    await page.getByTestId('inspector-tab-ai').click();
    await expect(page.getByTestId('ai-model-select')).toContainText('Deterministic');
    const turbo = page.getByRole('switch', { name: 'Turbo for this session' });
    if (await turbo.isChecked()) await turbo.uncheck();
    await page
      .getByRole('button', {
        name: 'Ends with the adoption checklist',
        exact: true,
      })
      .click();
    const composer = page.getByLabel('AI instruction');
    await composer.fill(
      'Set the headline exactly to "Adopt the quality gate and require recorded proof for every release."',
    );
    await composer.press('Enter');
    const proposal = page.getByTestId('proposal-card').first();
    await expect(proposal).toBeVisible({ timeout: 120_000 });
    step('proposal_ready', { deckVersion: base.version });

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
