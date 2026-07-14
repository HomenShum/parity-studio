import { Buffer } from 'node:buffer';
import { statSync } from 'node:fs';
import { type Locator, type Page, expect, test } from 'playwright/test';
import {
  type SurfaceSnapshot,
  createMatrixArtifactWriter,
  expectDocumentHasNoHorizontalOverflow,
  expectKeyboardFocusVisible,
  expectRuntimeClean,
  expectSurfaceSnapshotOperable,
  settleUi,
  snapshotSurface,
  watchRuntimeProblems,
} from './editor-control-matrix.helpers';
import { openFreshLanding, openSampleWorkspace } from './helpers';

test.describe('NodeSlide editor-wide control and surface matrix', () => {
  test.describe.configure({ mode: 'serial' });

  test('toolbar, dialogs, downloads, presenter, and command palette remain reachable', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const runtime = watchRuntimeProblems(page);
    const artifacts = createMatrixArtifactWriter(page, testInfo);
    await openSampleWorkspace(page);

    const toolbar = page.locator('.ns-toolbar');
    const studio = page.getByTestId('nodeslide-studio');
    const inspector = page.getByTestId('inspector');
    const navigator = page.getByTestId('slide-navigator');
    await expectKeyboardFocusVisible(
      page.getByTestId('project-actions-trigger'),
      'Project actions',
    );

    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(studio).toHaveAttribute('data-ns-theme', 'dark');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(studio).toHaveAttribute('data-ns-theme', 'light');

    await openProjectMenu(page);
    await expect(page.getByRole('menuitem', { name: /New deck/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Open deck/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Connections/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Back up recovery key/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Delete deck/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('project-actions-trigger')).toBeFocused();

    await openProjectMenu(page);
    await page.getByRole('menuitem', { name: /Open deck/ }).click();
    const projectDialog = page.getByTestId('new-deck-modal');
    await expect(projectDialog).toBeVisible();
    await expect(projectDialog.getByRole('heading', { name: 'Open a deck' })).toBeVisible();
    await page.getByRole('button', { name: 'Close project dialog' }).click();
    await expect(projectDialog).toHaveCount(0);

    await openProjectMenu(page);
    await page.getByRole('menuitem', { name: /Connections/ }).click();
    const connections = page.getByRole('dialog', { name: /Connect your own runtime/ });
    await expect(connections).toBeVisible();
    await connections.getByRole('tab', { name: 'Codex' }).click();
    await expect(connections.getByRole('tab', { name: 'Codex' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await connections.getByRole('tab', { name: /Claude Code/ }).click();
    await expect(connections.getByRole('button', { name: /Continue to Google/ })).toBeVisible();
    await connections.getByRole('button', { name: 'Close' }).click();
    await expect(connections).toHaveCount(0);

    await openProjectMenu(page);
    await page.getByRole('menuitem', { name: /Delete deck/ }).click();
    const deleteDialog = page.getByTestId('delete-deck-dialog');
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog.getByTestId('delete-deck-confirm')).toBeDisabled();
    await deleteDialog.getByTestId('delete-deck-confirmation').fill('not the deck title');
    await expect(deleteDialog.getByTestId('delete-deck-confirm')).toBeDisabled();
    await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(deleteDialog).toHaveCount(0);

    const language = page.getByRole('button', { name: /Language and clarity/ });
    await language.click();
    const languageDialog = page.getByRole('dialog', { name: 'Language and clarity' });
    await expect(languageDialog).toBeVisible();
    await expect(languageDialog.getByRole('radio', { name: /English/ })).toBeChecked();
    await expect(languageDialog.getByRole('radio').nth(1)).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(language).toBeFocused();

    const commandTrigger = page.getByRole('button', { name: 'Open command palette' });
    await commandTrigger.click();
    const commandDialog = page.getByRole('dialog', { name: 'Command palette' });
    const commandSearch = commandDialog.getByRole('searchbox', { name: 'Search commands' });
    await expect(commandSearch).toBeFocused();
    await commandSearch.fill('comments');
    await commandSearch.press('Enter');
    await expect(page.getByTestId('inspector-tab-comments')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.getByRole('button', { name: 'Share deck' }).click();
    const shareDialog = page.getByRole('dialog', { name: /Share a frozen, validated deck/ });
    await expect(shareDialog).toBeVisible();
    await expect(shareDialog.getByText(/immutable snapshot/i)).toBeVisible();
    await shareDialog.getByRole('button', { name: 'Close share dialog' }).click();
    await expect(shareDialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Present deck' }).click();
    await expect(page.getByRole('button', { name: 'Exit presenter' })).toBeVisible();
    const notes = page.getByRole('button', { name: 'Notes' });
    await notes.click();
    await expect(page.locator('.ns-presenter-notes')).toBeVisible();
    await notes.click();
    const presenterCounter = page.locator('.ns-presenter-controls > span');
    const firstCounter = await presenterCounter.textContent();
    await page.getByRole('button', { name: 'Next slide' }).click();
    await expect(presenterCounter).not.toHaveText(firstCounter ?? '');
    await page.getByRole('button', { name: 'Previous slide' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Present deck' })).toBeVisible();

    for (const item of [
      { testId: 'export-json', extension: '.json' },
      { testId: 'export-html', extension: '.html' },
      { testId: 'export-pptx', extension: '.pptx' },
    ] as const) {
      await page.getByRole('button', { name: 'Export deck' }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByTestId(item.testId).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename().toLowerCase().endsWith(item.extension)).toBe(true);
      const downloadPath = testInfo.outputPath(
        'editor-control-matrix',
        download.suggestedFilename(),
      );
      await download.saveAs(downloadPath);
      expect(statSync(downloadPath).size).toBeGreaterThan(0);
    }

    await page.getByRole('button', { name: 'Collapse inspector' }).click();
    await expect(page.getByRole('button', { name: 'Open inspector' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open inspector' }).first().click();
    await expect(inspector).toHaveAttribute('aria-label', 'NodeSlide inspector');

    const snapshots = await Promise.all([
      snapshotSurface(page, toolbar, 'toolbar'),
      snapshotSurface(page, navigator, 'navigator'),
      snapshotSurface(page, inspector, 'inspector'),
    ]);
    for (const snapshot of snapshots) expectSurfaceSnapshotOperable(snapshot);
    await artifacts.json('shell-control-inventory', snapshots);
    await artifacts.screenshot('shell-controls-light');
    await expectDocumentHasNoHorizontalOverflow(page);

    await openProjectMenu(page);
    await page.getByRole('menuitem', { name: /New deck/ }).click();
    await expect(page.getByTestId('nodeslide-landing')).toBeVisible();
    expectRuntimeClean(runtime);
  });

  test('navigator, layers, canvas modes, slide movement, and zoom preserve state', async ({
    page,
  }, testInfo) => {
    const runtime = watchRuntimeProblems(page);
    const artifacts = createMatrixArtifactWriter(page, testInfo);
    await openSampleWorkspace(page);

    const navigator = page.getByTestId('slide-navigator');
    const navigatorTabs = navigator.getByRole('tablist', { name: 'Navigator views' });
    const slidesTab = navigatorTabs.getByRole('tab', { name: 'Slides' });
    const outlineTab = navigatorTabs.getByRole('tab', { name: 'Outline' });
    const layersTab = navigatorTabs.getByRole('tab', { name: 'Layers' });
    await expect(slidesTab).toHaveAttribute('aria-selected', 'true');

    const firstSection = navigator.locator('.ns-section-toggle').first();
    await expect(firstSection).toHaveAttribute('aria-expanded', 'true');
    await firstSection.click();
    await expect(firstSection).toHaveAttribute('aria-expanded', 'false');
    await firstSection.click();

    await slidesTab.focus();
    await slidesTab.press('ArrowRight');
    await expect(outlineTab).toHaveAttribute('aria-selected', 'true');
    const outlineItems = navigator.getByLabel('Deck story outline').getByRole('button');
    expect(await outlineItems.count()).toBeGreaterThan(1);
    await outlineItems.nth(1).click();

    await outlineTab.press('ArrowRight');
    await expect(layersTab).toHaveAttribute('aria-selected', 'true');
    const layerList = navigator.locator('.ns-layer-list');
    await expect(layerList).toBeVisible();
    const layers = layerList.locator('.ns-layer-select');
    expect(await layers.count()).toBeGreaterThan(1);
    await layers.nth(0).click();
    await expect(layers.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await layers.nth(1).click({ modifiers: ['Control'] });
    await expect(layers.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(navigator.getByRole('toolbar', { name: 'Layer actions' })).toBeVisible();

    await layersTab.press('Home');
    await expect(slidesTab).toHaveAttribute('aria-selected', 'true');
    const slideActions = navigator.getByRole('button', { name: /Slide 1 actions/ });
    await slideActions.click();
    const slideMenu = navigator.getByRole('menu');
    await expect(slideMenu.getByRole('menuitemcheckbox')).toBeVisible();
    await expect(slideMenu.getByRole('menuitem', { name: /Rename slide/ })).toBeVisible();
    await expect(slideMenu.getByRole('menuitem', { name: /Duplicate slide/ })).toBeVisible();
    await expect(slideMenu.getByRole('menuitem', { name: /Delete slide/ })).toBeVisible();
    await slideMenu.getByRole('menuitemcheckbox').click();
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
    await navigator.getByRole('button', { name: 'Clear' }).click();

    const collapseNavigator = page.getByRole('button', { name: 'Collapse slide navigator' });
    if (await collapseNavigator.first().isVisible()) {
      await collapseNavigator.first().click();
      await expect(navigator).toHaveClass(/is-collapsed/);
      await page.getByRole('button', { name: /Go to slide 2/ }).click();
      await page.getByRole('button', { name: 'Open slide navigator' }).first().click();
      await expect(navigator).not.toHaveClass(/is-collapsed/);
    }

    const canvasTabs = page.getByRole('tablist', { name: 'Canvas views' });
    const editTab = canvasTabs.getByRole('tab', { name: 'Edit' });
    const overviewTab = canvasTabs.getByRole('tab', { name: 'Overview' });
    const compareTab = canvasTabs.getByRole('tab', { name: 'Compare' });
    await editTab.focus();
    await editTab.press('ArrowRight');
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    const overviewSlides = page.locator('[data-testid^="overview-slide-"]');
    expect(await overviewSlides.count()).toBeGreaterThan(1);
    await overviewSlides.nth(2).click();
    await overviewTab.press('ArrowRight');
    await expect(compareTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('no-candidate-state')).toBeVisible();

    const comparisonModes = page.getByRole('tablist', { name: 'Comparison presentation' });
    for (const label of ['Side by side', 'Slider', 'Overlay', 'Blink']) {
      await comparisonModes.getByRole('tab', { name: label }).click();
      await expect(comparisonModes.getByRole('tab', { name: label })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await compareTab.press('Home');
    await expect(editTab).toHaveAttribute('aria-selected', 'true');

    const slideCounter = page.locator('.ns-slide-stepper span');
    const counterBefore = await slideCounter.textContent();
    await page.getByRole('button', { name: 'Next slide' }).last().click();
    await expect(slideCounter).not.toHaveText(counterBefore ?? '');
    await page.getByRole('button', { name: 'Previous slide' }).last().click();

    const zoomControls = page.getByLabel('Canvas zoom and pan controls');
    const zoomLabel = zoomControls.locator('.ns-zoom-value');
    const zoomBefore = await zoomLabel.textContent();
    await zoomControls.getByRole('button', { name: 'Zoom in' }).click();
    await expect(zoomLabel).not.toHaveText(zoomBefore ?? '');
    await zoomControls.getByRole('button', { name: 'Zoom out' }).click();
    const pan = zoomControls.getByRole('button', { name: 'Toggle pan tool' });
    if (await pan.isVisible()) {
      await pan.click();
      await expect(pan).toHaveAttribute('aria-pressed', 'true');
      await pan.click();
    }
    await zoomControls.getByRole('button', { name: 'Fit slide to workspace' }).click();

    const canvasElement = page
      .getByTestId('slide-canvas')
      .locator('[data-testid^="slide-element-"]:not([aria-label*="locked"])')
      .first();
    await canvasElement.click();
    const elementActions = page.getByRole('toolbar', { name: 'Element actions' });
    await expect(elementActions).toBeVisible();
    await elementActions.getByRole('button', { name: 'Ask AI' }).click();
    await expect(page.getByTestId('inspector-tab-ai')).toHaveAttribute('aria-selected', 'true');
    await canvasElement.click();
    await elementActions.getByRole('button', { name: 'Comment' }).click();
    await expect(page.getByTestId('inspector-tab-comments')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const snapshots = [
      await snapshotSurface(page, navigator, 'navigator-after-interactions'),
      await snapshotSurface(page, page.getByTestId('slide-canvas'), 'slide-canvas'),
    ];
    for (const snapshot of snapshots) expectSurfaceSnapshotOperable(snapshot);
    await artifacts.json('navigator-canvas-control-inventory', snapshots);
    await artifacts.screenshot('navigator-canvas-final');
    await expectDocumentHasNoHorizontalOverflow(page);
    expectRuntimeClean(runtime);
  });

  test('AI, Design, Comments, Evidence, Trace, Versions, and JSON retain local state', async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const runtime = watchRuntimeProblems(page);
    const artifacts = createMatrixArtifactWriter(page, testInfo);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openSampleWorkspace(page);
    const inspector = page.getByTestId('inspector');
    const inventories: SurfaceSnapshot[] = [];

    const aiTab = page.getByTestId('inspector-tab-ai');
    await aiTab.click();
    const instruction = page.getByRole('textbox', { name: 'AI instruction' });
    await instruction.fill('Draft state that must survive inspector tab changes');
    await page.getByTestId('ai-model-select').click();
    const modelDialog = page.getByRole('dialog', { name: 'Agent model' });
    await expect(modelDialog).toBeVisible();
    await modelDialog.getByText('Deterministic', { exact: true }).click();
    await page.getByTestId('ai-model-select').click();
    await modelDialog.getByLabel('Recommended').locator('[role="option"]').first().click();
    await expect(page.getByTestId('ai-effort-select')).toBeVisible();
    const effort = page.getByTestId('ai-effort-select');
    const effortOptions = await effort
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    if (effortOptions.length > 1) await effort.selectOption(effortOptions.at(-1) ?? '');

    await page.getByTestId('ai-data-file-input').setInputFiles({
      name: 'matrix.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('label,value\nA,1\nB,2\n'),
    });
    await expect(page.getByLabel('Attached data files')).toContainText('matrix.csv');
    await page.getByRole('button', { name: 'Remove matrix.csv' }).click();

    await page.getByTestId('ai-connect-agent').click();
    const connections = page.getByRole('dialog', { name: /Connect your own runtime/ });
    await expect(connections).toBeVisible();
    await connections.getByRole('button', { name: 'Close' }).click();
    const web = page.getByTestId('ai-web-research-toggle');
    await web.click();
    await expect(web).toHaveAttribute('aria-pressed', 'true');
    await web.click();
    await page.getByTestId('ai-memory').click();
    const memoryDialog = page.getByTestId('memory-dialog');
    await expect(memoryDialog).toBeVisible();
    await memoryDialog.getByRole('tab', { name: /Archived/ }).click();
    await memoryDialog.getByRole('tab', { name: /Active/ }).click();
    await memoryDialog.getByRole('button', { name: 'Close' }).click();

    await chooseFirstMenuItem(
      page,
      page.getByRole('button', { name: 'Add read context reference' }),
    );
    await chooseFirstMenuItem(page, page.getByRole('button', { name: 'Add command' }));
    const expand = page.getByRole('button', { name: 'Expand composer' });
    await expand.click();
    await expect(page.getByRole('button', { name: 'Collapse composer' })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse composer' }).click();
    const providerSummary = page.getByTestId('ai-provider-summary');
    await providerSummary.click();
    await expect(page.getByTestId('ai-provider-controls')).toHaveAttribute('open', '');
    await providerSummary.click();
    inventories.push(await snapshotSurface(page, inspector, 'inspector-ai'));

    const canvasElement = page
      .getByTestId('slide-canvas')
      .locator('[data-testid^="slide-element-"]:not([aria-label*="locked"])')
      .first();
    await canvasElement.click();
    await page.getByTestId('inspector-tab-design').click();
    const contentSection = page.getByTestId('design-section-content').getByRole('button').first();
    const appearanceSection = page
      .getByTestId('design-section-appearance')
      .getByRole('button')
      .first();
    const advancedSection = page.getByTestId('design-section-advanced').getByRole('button').first();
    await expect(contentSection).toHaveAttribute('aria-expanded', 'true');
    await expect(appearanceSection).toHaveAttribute('aria-expanded', 'false');
    await expect(advancedSection).toHaveAttribute('aria-expanded', 'false');
    await appearanceSection.click();
    await advancedSection.click();
    inventories.push(await snapshotSurface(page, inspector, 'inspector-design'));

    await page.getByTestId('inspector-tab-comments').click();
    const commentBox = page.getByPlaceholder('Leave focused feedback…');
    for (const anchor of ['Deck', 'Slide', 'Element', 'Box']) {
      const button = page.locator('.ns-anchor-options').getByRole('button', { name: anchor });
      if (await button.isEnabled()) await button.click();
    }
    await commentBox.fill('Unsaved matrix comment draft');
    await expect(page.getByRole('button', { name: 'Post comment' })).toBeEnabled();
    await page.locator('.ns-comment-filter').getByRole('button', { name: /All/ }).click();
    await page.locator('.ns-comment-filter').getByRole('button', { name: /Open/ }).click();
    inventories.push(await snapshotSurface(page, inspector, 'inspector-comments'));

    await page.getByTestId('inspector-tab-data').click();
    await expect(page.getByRole('heading', { name: 'Data & sources' })).toBeVisible();
    inventories.push(await snapshotSurface(page, inspector, 'inspector-evidence'));

    await page.getByTestId('inspector-tab-trace').click();
    const detailTabs = page.getByRole('tablist', { name: 'Trace detail level' });
    for (const density of ['Summary', 'Timeline', 'Raw']) {
      await detailTabs.getByRole('tab', { name: density }).click();
      await expect(detailTabs.getByRole('tab', { name: density })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    const expandTrace = page.getByRole('button', { name: 'Expand trace view' });
    if (await expandTrace.isVisible()) {
      await expandTrace.click();
      await expect(page.getByLabel('Expanded trace observability view')).toBeVisible();
      await artifacts.screenshot('trace-expanded');
      await page.keyboard.press('Escape');
      await expect(expandTrace).toBeFocused();
    } else {
      await artifacts.screenshot('trace-compact-expand-unreachable');
      await artifacts.json('trace-expand-unreachable', {
        severity: 'P1',
        surface: 'Trace inspector',
        symptom: 'The compact Trace rail exposes no reachable control for the expanded view.',
        expectedControl: 'button[aria-label="Expand trace view"]',
      });
    }
    inventories.push(await snapshotSurface(page, inspector, 'inspector-trace'));

    await openMoreInspectorView(page, 'Versions');
    await expect(page.getByRole('heading', { name: 'Versions' })).toBeVisible();
    const compareVersion = page
      .getByLabel('Deck revisions')
      .getByRole('button', { name: 'Compare' });
    const enabledCompare = await firstEnabled(compareVersion);
    if (enabledCompare) {
      await enabledCompare.click();
      await expect(page.getByText('Compare summary')).toBeVisible();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
    }
    inventories.push(await snapshotSurface(page, inspector, 'inspector-versions'));

    await openMoreInspectorView(page, 'JSON');
    const jsonTabs = page.getByRole('tablist', { name: 'JSON view' });
    for (const mode of ['Deck', 'Slide', 'Selection', 'Last patch']) {
      await jsonTabs.getByRole('tab', { name: mode }).click();
      await expect(jsonTabs.getByRole('tab', { name: mode })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await jsonTabs.getByRole('tab', { name: 'Deck' }).click();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    const jsonDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download deck.json' }).click();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename().toLowerCase().endsWith('.json')).toBe(true);
    await page.getByLabel('Import Deck JSON').setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not valid json'),
    });
    await expect(page.getByRole('alert')).toBeVisible();
    inventories.push(await snapshotSurface(page, inspector, 'inspector-json'));

    await aiTab.click();
    await expect(instruction).toHaveValue(
      /^Draft state that must survive inspector tab changes.*@.*\/variations/su,
    );
    await page.getByTestId('inspector-tab-design').click();
    await expect(appearanceSection).toHaveAttribute('aria-expanded', 'true');
    await expect(advancedSection).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('inspector-tab-comments').click();
    await expect(commentBox).toHaveValue('Unsaved matrix comment draft');

    for (const inventory of inventories) expectSurfaceSnapshotOperable(inventory);
    await artifacts.json('inspector-control-inventory', inventories);
    await artifacts.screenshot('inspector-state-preservation');
    await expectDocumentHasNoHorizontalOverflow(page);
    expectRuntimeClean(runtime);
  });

  test('compact Trace rail exposes the expanded observability action', async ({
    page,
  }, testInfo) => {
    const artifacts = createMatrixArtifactWriter(page, testInfo);
    await openSampleWorkspace(page);
    await page.getByTestId('inspector-tab-trace').click();
    const expand = page.getByRole('button', { name: 'Expand trace view' });
    const reachable = await expand.isVisible();
    if (!reachable) await artifacts.screenshot('trace-expand-action-missing');
    test.fail(
      !reachable,
      'P1: the compact Trace rail hides the only control that opens the full observability view.',
    );
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(page.getByLabel('Expanded trace observability view')).toBeVisible();
  });

  for (const visualCase of [
    { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
    { name: 'desktop-dark', width: 1440, height: 1000, theme: 'dark' },
    { name: 'tablet-light', width: 900, height: 1100, theme: 'light' },
    { name: 'tablet-dark', width: 900, height: 1100, theme: 'dark' },
    { name: 'mobile-light', width: 390, height: 844, theme: 'light' },
    { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' },
  ] as const) {
    test(`${visualCase.name} keeps editor actions reachable without rail overflow`, async ({
      page,
    }, testInfo) => {
      const runtime = watchRuntimeProblems(page);
      const artifacts = createMatrixArtifactWriter(page, testInfo);
      await page.setViewportSize({ width: visualCase.width, height: visualCase.height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openFreshLanding(page);
      await page.getByRole('button', { name: 'Explore the editable sample workspace' }).click();
      await expect(page.getByTestId('deck-title')).toBeVisible({ timeout: 60_000 });
      await expect(page).toHaveURL(/[?&]deck=/);
      const studio = page.getByTestId('nodeslide-studio');
      if ((await studio.getAttribute('data-ns-theme')) !== visualCase.theme) {
        await page
          .locator('.ns-theme-toggle')
          .evaluate((button: HTMLButtonElement) => button.click());
      }
      await expect(studio).toHaveAttribute('data-ns-theme', visualCase.theme);

      const toolbar = page.locator('.ns-toolbar');
      const toolbarSnapshot = await snapshotSurface(page, toolbar, `${visualCase.name}-toolbar`);
      expectSurfaceSnapshotOperable(toolbarSnapshot);

      const inspector = page.getByTestId('inspector');
      if ((await inspector.getAttribute('aria-label')) !== 'NodeSlide inspector') {
        await page.getByRole('button', { name: 'Open inspector' }).first().click();
      }
      await expect(page.getByTestId('ai-composer')).toBeVisible();
      await expectKeyboardFocusVisible(page.getByTestId('inspector-tab-ai'), 'AI inspector tab');
      const inspectorSnapshot = await snapshotSurface(
        page,
        inspector,
        `${visualCase.name}-inspector`,
      );
      expectSurfaceSnapshotOperable(inspectorSnapshot);
      await expectDocumentHasNoHorizontalOverflow(page);
      await artifacts.screenshot(`${visualCase.name}-inspector`);

      const navigator = page.getByTestId('slide-navigator');
      if (await navigator.evaluate((element) => element.classList.contains('is-collapsed'))) {
        const closeInspector = page.getByRole('button', { name: 'Collapse inspector' });
        if (await closeInspector.isVisible()) await closeInspector.click();
        await page.getByRole('button', { name: 'Open slide navigator' }).first().click();
      }
      const navigatorSnapshot = await snapshotSurface(
        page,
        navigator,
        `${visualCase.name}-navigator`,
      );
      const clippedNavigatorControls = navigatorSnapshot.controls.filter(
        (control) => control.horizontallyClipped,
      );
      if (clippedNavigatorControls.length > 0) {
        await artifacts.screenshot(`${visualCase.name}-navigator-clipped`);
        await artifacts.json(`${visualCase.name}-navigator-clipped`, {
          severity: 'P1',
          surface: 'Slide navigator',
          viewport: navigatorSnapshot.viewport,
          controls: clippedNavigatorControls.map(({ name, testId, left, right }) => ({
            name,
            testId,
            left,
            right,
          })),
        });
      }
      test.fail(
        clippedNavigatorControls.length > 0,
        'P1: the mobile slide navigator expands beyond the viewport and clips later slide actions.',
      );
      expectSurfaceSnapshotOperable(navigatorSnapshot);
      await expectDocumentHasNoHorizontalOverflow(page);
      await artifacts.screenshot(`${visualCase.name}-navigator`);

      const snapshots = [toolbarSnapshot, inspectorSnapshot, navigatorSnapshot];
      await artifacts.json(`${visualCase.name}-control-inventory`, snapshots);
      expectRuntimeClean(runtime);
    });
  }
});

async function openProjectMenu(page: Page): Promise<void> {
  const trigger = page.getByTestId('project-actions-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(page.getByRole('menu', { name: 'Project actions' })).toBeVisible();
}

async function openMoreInspectorView(page: Page, name: 'Versions' | 'JSON'): Promise<void> {
  await page.getByTestId('inspector-more').click();
  await page.getByRole('menuitem', { name }).click();
  await expect(page.getByTestId('inspector-more')).toHaveAttribute(
    'aria-label',
    new RegExp(`current: ${name}`, 'i'),
  );
}

async function chooseFirstMenuItem(page: Page, trigger: Locator): Promise<void> {
  await trigger.click();
  const menu = page.locator('[role="menu"]:visible').last();
  const enabledItems = menu.getByRole('menuitem').filter({ hasNot: page.locator('[disabled]') });
  if (await enabledItems.count()) await enabledItems.first().click();
  else await page.keyboard.press('Escape');
}

async function firstEnabled(locator: Locator): Promise<Locator | null> {
  for (let index = 0; index < (await locator.count()); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isEnabled()) return candidate;
  }
  return null;
}
