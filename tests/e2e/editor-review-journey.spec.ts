import { expect, test } from 'playwright/test';
import { expectNoDocumentOverflow, openSampleWorkspace, readVersionState } from './helpers';

const mutationCoverageEnabled = process.env['NODESLIDE_E2E_MUTATIONS'] === '1';

test.describe('deployed editor review boundary', () => {
  test.skip(
    !mutationCoverageEnabled,
    'Set NODESLIDE_E2E_MUTATIONS=1 against an isolated preview deployment.',
  );

  test('types, proposes before mutation, accepts once, attributes, and recovers', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const providerBrowserRequests: string[] = [];
    page.on('request', (request) => {
      if (/openrouter|nebius|api\.inference|generativelanguage/i.test(request.url())) {
        providerBrowserRequests.push(request.url());
      }
    });

    await openSampleWorkspace(page);
    const deckUrl = page.url();
    const deckTitle = await page.getByTestId('deck-title').inputValue();

    const studio = page.getByTestId('nodeslide-studio');
    await expect(studio).toHaveAttribute('data-ns-theme', 'light');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(studio).toHaveAttribute('data-ns-theme', 'dark');
    await page.screenshot({ path: testInfo.outputPath('editor-dark.png'), fullPage: true });
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(studio).toHaveAttribute('data-ns-theme', 'light');

    await page.getByTestId('ai-model-select').click();
    await page
      .getByRole('dialog', { name: 'Agent model' })
      .getByText('Deterministic', { exact: true })
      .click();
    await page.getByRole('button', { name: 'Expand composer' }).click();
    await page.getByTestId('ai-provider-summary').click();
    await expect(page.getByTestId('ai-provider-route-status')).toContainText('External model: off');
    await expect(page.getByTestId('ai-provider-route-status')).toContainText(
      'Private deterministic',
    );

    const composer = page.getByLabel('AI instruction');
    await composer.fill('First line');
    await composer.press('Shift+Enter');
    await composer.type('Second line');
    await expect(composer).toHaveValue('First line\nSecond line');

    const initial = await readVersionState(page);
    await page.getByTestId('inspector-tab-ai').click();
    const instruction =
      'Set the headline copy exactly to "Launch-ready decisions stay reviewable".';
    await composer.fill(instruction);
    await composer.press('Enter');
    await expect(composer).toHaveValue('');

    const proposal = page.getByTestId('proposal-card').first();
    await expect(proposal).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('ai-composer')).toHaveAttribute(
      'data-composer-mode',
      'follow-up',
    );
    await expect(proposal.getByTestId('proposal-accept')).toBeVisible();
    await expect(proposal.getByTestId('proposal-reject')).toBeVisible();
    await expect(page.locator('.ns-candidate-actions')).toHaveCount(0);
    await expect(proposal.getByTestId('candidate-validation')).toContainText(
      'Candidate validation passed',
    );

    const beforeAccept = await readVersionState(page);
    expect(beforeAccept).toEqual(initial);
    await page.getByTestId('inspector-tab-ai').click();
    const preview = proposal.getByTestId('proposal-preview');
    if ((await preview.getAttribute('aria-pressed')) !== 'true') await preview.click();
    await expect(page.getByTestId('candidate-receipt')).toHaveAttribute(
      'data-candidate-status',
      'ready',
    );
    await expect(page.getByLabel('Baseline and candidate comparison')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('proposal-before-accept.png'),
      fullPage: true,
    });

    await expect(proposal.getByTestId('proposal-accept')).toBeEnabled({ timeout: 120_000 });
    await proposal.getByTestId('proposal-accept').dblclick();
    await expect(page.getByText('Validated proposal accepted as a new deck version.')).toBeVisible({
      timeout: 60_000,
    });
    await expect(proposal).toHaveCount(0);

    const accepted = await readVersionState(page);
    expect(accepted.version).toBe(initial.version + 1);
    expect(accepted.revisionCount).toBe(initial.revisionCount + 1);
    await page.waitForTimeout(1_000);
    const stable = await readVersionState(page);
    expect(stable).toEqual(accepted);

    await page.getByTestId('inspector-tab-trace').click();
    await expect(page.getByRole('heading', { name: 'Run details' })).toBeVisible();
    await expect(page.getByTestId('trace-proof-summary')).toContainText(/deterministic/i);
    await expect(
      page.getByText('Provider, work performed, validation, and human approval'),
    ).toBeVisible();
    expect(providerBrowserRequests).toEqual([]);

    await page.reload();
    await expect(page).toHaveURL(deckUrl);
    await expect(page.getByTestId('deck-title')).toHaveValue(deckTitle, { timeout: 60_000 });
    const recovered = await readVersionState(page);
    expect(recovered).toEqual(accepted);

    for (const viewport of [
      { name: 'desktop', width: 1440, height: 1000 },
      { name: 'tablet', width: 900, height: 1100 },
      { name: 'mobile', width: 390, height: 844 },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(studio).toBeVisible();
      await expectNoDocumentOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`recovered-editor-${viewport.name}.png`),
        fullPage: true,
      });
    }
  });
});
