import type { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { type Locator, type Page, test } from 'playwright/test';
import { api } from '../../convex/_generated/api.js';
import {
  FIXED_LIVE_CASES,
  RepeatedLiveFailureGuard,
  assertArtifactSafe,
  buildBudgetRunRecord,
  buildCreateRunRecord,
  buildEditRunRecord,
  resolveProducerOutputDirectory,
  writeTasteArtifact,
  writeUxRunArtifact,
} from '../../scripts/nodeslide-benchmark-producer-lib.mjs';

type CaseId = 'C01' | 'E01' | 'A05';
type BenchmarkStatus = 'FAIL' | 'UNSCORED';
type EnvironmentMode = 'local' | 'preview' | 'production';

interface LiveFixture {
  id: CaseId;
  request: { text: string; webResearch: boolean };
  setup: {
    activeSlideId: string | null;
    selectedElementIds: string[];
  };
  [key: string]: unknown;
}

interface StoredJobCapability {
  jobId: string;
  ownerAccessKey: string;
  kind: 'create_deck' | 'edit_proposal';
  deckId: string | null;
}

interface RunReceipt {
  job: {
    jobId: string;
    kind: string;
    status: string;
    resultDeckId?: string;
  };
  requestBinding: unknown;
  capability: {
    provider?: string;
    model?: string;
    egress?: string;
    hasConsent?: boolean;
  } | null;
  snapshot: {
    deck: { id: string; version: number };
    slides: Array<{ id: string; job?: string }>;
    elements: Array<{ id: string; content?: string }>;
    validation: unknown;
  } | null;
  patch: {
    id: string;
    status: string;
    baseDeckVersion: number;
    candidateDigest?: string;
    scope?: { kind?: string; slideIds?: string[]; elementIds?: string[] };
    operations?: unknown[];
  } | null;
  budget: {
    status?: string;
    events?: Array<{ kind?: string }>;
  } | null;
  [key: string]: unknown;
}

interface ProducerEnvironment {
  name: string;
  mode: EnvironmentMode;
}

interface OwnedDeck {
  deckId: string;
  ownerAccessKey: string;
}

interface PixelCapture {
  bytes: Buffer;
  width: number;
  height: number;
}

const EXACT_PROMPTS = Object.freeze({
  C01: 'Create a six-slide investor deck explaining the problem, product, traction, market, business model, and next milestone.',
  E01: 'Make this headline clearer for an investor.',
  A05: 'Spend no more than $1 on this run.',
});
const CASE_IDS = ['C01', 'E01', 'A05'] as const;
const LIVE_WRITE_ALLOWED = process.env['NODESLIDE_BENCH_ALLOW_LIVE_WRITE'] === '1';
const SESSION_ID_KEY = 'parity.studio.sessionId';
const AGENT_SESSION_PREFIX = 'nodeslide.agent-session:v1:';
const DECK_ACCESS_KEY = 'nodeslide.deckAccess.v1';
const PRIMARY_OWNER_ACCESS_KEY = 'nodeslide.ownerAccessKey';
const SESSION_CONSENT_KEY = 'nodeslide.external-consent:v1';
const GOLDEN_SESSION_ID = 'founder-roadshow-v1';
const GOLDEN_SLIDE_ID = 'slide_cb8dedf0734c6331aeef8b058d3f3a2b';
const GOLDEN_ELEMENT_ID = 'element_9b907246c1622d23e90d3dce6eb31b61';
const NEBIUS_MODEL_ID = 'nebius/zai-org/GLM-5.2';
const REPOSITORY_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ACTIVE_JOB_STATUSES = new Set(['preparing', 'queued', 'running', 'retrying']);
const JOB_CAPABILITY_TIMEOUT_MS = 60_000;
const LIVE_RECEIPT_TIMEOUT_MS = 300_000;

class ProducerOutcomeError extends Error {
  readonly caseId: CaseId;
  readonly status: BenchmarkStatus;
  readonly stage: string;

  constructor(caseId: CaseId, status: BenchmarkStatus, stage: string) {
    super(`${caseId} ${status}: ${stage}`);
    this.name = 'ProducerOutcomeError';
    this.caseId = caseId;
    this.status = status;
    this.stage = stage;
  }
}

test.use({
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});

test.describe('NodeSlide live benchmark producer', () => {
  test.describe.configure({ mode: 'serial', retries: 0 });
  test.skip(
    !LIVE_WRITE_ALLOWED,
    'Set NODESLIDE_BENCH_ALLOW_LIVE_WRITE=1 only for an owner-authorized live producer run.',
  );

  test('captures C01, A05, and E01 without retaining live credentials', async ({ page }) => {
    test.setTimeout(15 * 60_000);

    const fixtures = await loadExactFixtures();
    const sourceRevision = resolveSourceRevision();
    const outputDirectory = resolveProducerOutputDirectory(
      REPOSITORY_DIRECTORY,
      path.join('benchmark-results', 'live', sourceRevision),
    );
    const convexOriginProbe = observeConvexOrigin(page);
    const caseFailureGuard = new RepeatedLiveFailureGuard();
    const receiptFailureGuard = new RepeatedLiveFailureGuard();
    const failures: ProducerOutcomeError[] = [];
    let convexClient: ConvexHttpClient | null = null;
    let environment: ProducerEnvironment | null = null;
    let c01Job: StoredJobCapability | null = null;
    let c01Deck: OwnedDeck | null = null;
    let c01EditorReady = false;
    let c01DispatchAttempted = false;
    let c01PreviousJobId: string | null = null;

    try {
      await captureCase('C01', failures, caseFailureGuard, async () => {
        await guardedStage('C01', 'UNSCORED', 'fresh landing was unavailable', () =>
          openClearedLanding(page),
        );
        environment = producerEnvironment(page);
        assertArtifactSafe(environment);
        convexClient = await guardedStage(
          'C01',
          'UNSCORED',
          'the browser Convex deployment could not be bound',
          async () => new ConvexHttpClient(await resolveConvexUrl(convexOriginProbe)),
        );
        await guardedStage('C01', 'UNSCORED', 'Nebius generation controls did not match', () =>
          configureNebiusLanding(page),
        );
        await guardedStage(
          'C01',
          'UNSCORED',
          'the exact creation request was not submitted',
          async () => {
            c01PreviousJobId = await latestStoredJobId(page);
            await submitExactPrompt(page, fixtures.C01, 'landing', () => {
              c01DispatchAttempted = true;
            });
            c01Job = await waitForStoredJobCapability(page, {
              expectedKind: 'create_deck',
              previousJobId: c01PreviousJobId,
            });
          },
        );
        const receipt = await guardedStage(
          'C01',
          'UNSCORED',
          'the durable creation receipt was unavailable',
          () =>
            waitForRunReceipt(
              requireClient(convexClient, 'C01'),
              'C01',
              requireJob(c01Job, 'C01'),
              receiptFailureGuard,
              (candidate) => isSettledReceipt(candidate),
              0,
            ),
        );
        requireExpectedLiveCapability('C01', receipt, requireJob(c01Job, 'C01'));
        const createdDeckId = receipt.snapshot?.deck.id ?? receipt.job.resultDeckId;
        if (!createdDeckId) {
          throw new ProducerOutcomeError(
            'C01',
            'UNSCORED',
            'the authoritative receipt did not identify a synthetic deck',
          );
        }
        c01Deck = {
          deckId: createdDeckId,
          ownerAccessKey: requireJob(c01Job, 'C01').ownerAccessKey,
        };
        await guardedStage(
          'C01',
          'UNSCORED',
          'the sanitized creation artifact was not written',
          async () => {
            const record = buildCreateRunRecord(fixtures.C01, receipt);
            await writeUxRunArtifact({
              outputDirectory,
              fixture: fixtures.C01,
              record,
              sourceRevision,
              environment: requireEnvironment(environment),
            });
          },
        );
        await guardedStage(
          'C01',
          'FAIL',
          'the created deck did not resume in the editor',
          async () => {
            await page.getByTestId('deck-title').waitFor({ state: 'visible', timeout: 90_000 });
            const activeDeckId = new URL(page.url()).searchParams.get('deck');
            if (activeDeckId !== c01Deck?.deckId) throw new Error('created deck route mismatch');
            c01EditorReady = true;
          },
        );
      });

      if (c01DispatchAttempted && !c01Job) {
        throw new ProducerOutcomeError(
          'C01',
          'FAIL',
          'creation dispatch was attempted without a recoverable cleanup capability',
        );
      }

      if (c01Deck && c01EditorReady) {
        await captureCase('A05', failures, caseFailureGuard, async () => {
          await guardedStage('A05', 'UNSCORED', 'Nebius budget controls did not match', () =>
            configureNebiusEditor(page, false),
          );
          let budgetJob: StoredJobCapability | null = null;
          await guardedStage(
            'A05',
            'UNSCORED',
            'the exact budget request was not submitted',
            async () => {
              const previousJobId = await latestStoredJobId(page);
              await submitExactPrompt(page, fixtures.A05, 'editor');
              budgetJob = await waitForStoredJobCapability(page, {
                expectedKind: 'edit_proposal',
                previousJobId,
                expectedDeckId: c01Deck?.deckId,
              });
              if (
                budgetJob.ownerAccessKey !== c01Deck?.ownerAccessKey ||
                budgetJob.deckId !== c01Deck?.deckId
              ) {
                throw new Error('budget job deck capability mismatch');
              }
            },
          );
          const receipt = await guardedStage(
            'A05',
            'UNSCORED',
            'the durable budget receipt was unavailable',
            () =>
              waitForRunReceipt(
                requireClient(convexClient, 'A05'),
                'A05',
                requireJob(budgetJob, 'A05'),
                receiptFailureGuard,
                (candidate) => isSettledReceipt(candidate) && hasBudgetAccountingEnd(candidate),
                10_000,
              ),
          );
          requireExpectedLiveCapability('A05', receipt, requireJob(budgetJob, 'A05'));
          await guardedStage(
            'A05',
            'UNSCORED',
            'the sanitized budget artifact was not written',
            async () => {
              const record = buildBudgetRunRecord(fixtures.A05, receipt);
              await writeUxRunArtifact({
                outputDirectory,
                fixture: fixtures.A05,
                record,
                sourceRevision,
                environment: requireEnvironment(environment),
              });
            },
          );
          if (receipt.job.status === 'awaiting_review' && receipt.patch?.id) {
            await guardedStage(
              'A05',
              'FAIL',
              'the incidental budget proposal was not rejected',
              () => rejectProposal(page, receipt.patch?.id),
            );
          }
        });
      } else {
        recordCaseFailure(
          failures,
          caseFailureGuard,
          new ProducerOutcomeError('A05', 'UNSCORED', 'the C01 editor deck was unavailable'),
        );
      }

      await captureCase('E01', failures, caseFailureGuard, async () => {
        let submitted = false;
        let patchId: string | null = null;
        let proposalIdsBeforeDispatch = new Set<string>();
        let primaryFailure: ProducerOutcomeError | null = null;
        try {
          const sampleDeckId = await guardedStage(
            'E01',
            'UNSCORED',
            'the deterministic golden sample was unavailable',
            () => openGoldenSample(page),
          );
          await guardedStage('E01', 'UNSCORED', 'the stable headline could not be selected', () =>
            selectGoldenHeadline(page),
          );
          await guardedStage(
            'E01',
            'UNSCORED',
            'Nebius selected-element controls did not match',
            () => configureNebiusEditor(page, true),
          );
          proposalIdsBeforeDispatch = await storedProposalIds(page);
          let editJob: StoredJobCapability | null = null;
          await guardedStage(
            'E01',
            'UNSCORED',
            'the exact headline request was not submitted',
            async () => {
              const previousJobId = await latestStoredJobId(page);
              await submitExactPrompt(page, fixtures.E01, 'editor', () => {
                submitted = true;
              });
              editJob = await waitForStoredJobCapability(page, {
                expectedKind: 'edit_proposal',
                previousJobId,
                expectedDeckId: sampleDeckId,
              });
              if (editJob.deckId !== sampleDeckId) throw new Error('sample job deck mismatch');
            },
          );
          const receipt = await guardedStage(
            'E01',
            'UNSCORED',
            'the durable selected-element receipt was unavailable',
            () =>
              waitForRunReceipt(
                requireClient(convexClient, 'E01'),
                'E01',
                requireJob(editJob, 'E01'),
                receiptFailureGuard,
                (candidate) => isSettledReceipt(candidate),
                5_000,
              ),
          );
          requireExpectedLiveCapability('E01', receipt, requireJob(editJob, 'E01'));
          requireExactSelectedElementScope(receipt);
          patchId = receipt.patch?.id ?? null;
          await guardedStage(
            'E01',
            'UNSCORED',
            'the sanitized edit artifact was not written',
            async () => {
              const record = buildEditRunRecord(fixtures.E01, receipt);
              await writeUxRunArtifact({
                outputDirectory,
                fixture: fixtures.E01,
                record,
                sourceRevision,
                environment: requireEnvironment(environment),
              });
            },
          );
          const reviewPatchId = patchId;
          if (!reviewPatchId) {
            throw new ProducerOutcomeError(
              'E01',
              'UNSCORED',
              'the selected-element run produced no reviewable candidate',
            );
          }
          const pixels = await guardedStage(
            'E01',
            'UNSCORED',
            'baseline and candidate pixels could not be captured',
            () => captureComparisonPixels(page, reviewPatchId),
          );
          await guardedStage(
            'E01',
            'UNSCORED',
            'the sanitized taste artifacts were not written',
            async () => {
              const baselineState = {
                caseId: 'E01',
                phase: 'before',
                deckVersion: receipt.snapshot?.deck.version ?? null,
                slideId: GOLDEN_SLIDE_ID,
                selectedElementIds: [GOLDEN_ELEMENT_ID],
              };
              const candidateState = {
                caseId: 'E01',
                phase: 'after',
                baseDeckVersion: receipt.patch?.baseDeckVersion ?? null,
                patchId: reviewPatchId,
                candidateDigest: receipt.patch?.candidateDigest ?? null,
                slideId: GOLDEN_SLIDE_ID,
                selectedElementIds: [GOLDEN_ELEMENT_ID],
              };
              assertArtifactSafe(baselineState);
              assertArtifactSafe(candidateState);
              await writeTasteArtifact({
                outputDirectory,
                caseId: 'E01',
                phase: 'before',
                slideId: GOLDEN_SLIDE_ID,
                state: baselineState,
                pixelBytes: pixels.before.bytes,
                width: pixels.before.width,
                height: pixels.before.height,
                sourceRevision,
              });
              await writeTasteArtifact({
                outputDirectory,
                caseId: 'E01',
                phase: 'after',
                slideId: GOLDEN_SLIDE_ID,
                state: candidateState,
                pixelBytes: pixels.after.bytes,
                width: pixels.after.width,
                height: pixels.after.height,
                sourceRevision,
              });
            },
          );
        } catch (error) {
          primaryFailure = asProducerOutcome(
            error,
            'E01',
            'UNSCORED',
            'the live edit was incomplete',
          );
        }

        if (submitted) {
          try {
            if (!patchId) {
              patchId = await waitForNewProposalId(page, proposalIdsBeforeDispatch, 60_000);
            }
            if (!patchId) throw new Error('proposal id unavailable');
            await rejectProposal(page, patchId);
          } catch {
            throw new ProducerOutcomeError(
              'E01',
              'FAIL',
              'the golden-sample proposal was not rejected after capture',
            );
          }
        }
        if (primaryFailure) throw primaryFailure;
      });

      if (failures.length > 0) {
        throw new Error(
          `Live benchmark producer completed without fabricated results: ${failures
            .map((failure) => `${failure.caseId} ${failure.status} (${failure.stage})`)
            .join('; ')}`,
        );
      }
    } finally {
      await cleanupSyntheticC01({
        page,
        client: convexClient,
        job: c01Job,
        deck: c01Deck,
        dispatchAttempted: c01DispatchAttempted,
        previousJobId: c01PreviousJobId,
        receiptFailureGuard,
      });
    }
  });
});

async function loadExactFixtures(): Promise<Record<CaseId, LiveFixture>> {
  const entries = await Promise.all(
    CASE_IDS.map(async (caseId) => {
      const fixturePath = path.join(
        REPOSITORY_DIRECTORY,
        'qa',
        'nodeslide-agent-corpus',
        caseId === 'A05' ? 'live-fixtures' : 'fixtures',
        `${caseId}.json`,
      );
      let fixture: LiveFixture;
      try {
        fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as LiveFixture;
      } catch {
        throw new Error(`Fixture ${caseId} could not be loaded.`);
      }
      if (
        fixture.id !== caseId ||
        fixture.request?.text !== EXACT_PROMPTS[caseId] ||
        fixture.request.webResearch !== false ||
        FIXED_LIVE_CASES[caseId] !== EXACT_PROMPTS[caseId]
      ) {
        throw new Error(`Fixture ${caseId} is not bound to its exact fixed live request.`);
      }
      if (
        caseId === 'E01' &&
        (fixture.setup?.activeSlideId !== GOLDEN_SLIDE_ID ||
          fixture.setup.selectedElementIds.length !== 1 ||
          fixture.setup.selectedElementIds[0] !== GOLDEN_ELEMENT_ID)
      ) {
        throw new Error('Fixture E01 is not bound to the deterministic golden headline.');
      }
      return [caseId, fixture] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<CaseId, LiveFixture>;
}

function resolveSourceRevision(): string {
  const configured =
    process.env['NODESLIDE_BENCH_SOURCE_SHA']?.trim() ||
    process.env['VERCEL_GIT_COMMIT_SHA']?.trim() ||
    process.env['GITHUB_SHA']?.trim();
  let sourceRevision = configured;
  if (!sourceRevision) {
    try {
      sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: REPOSITORY_DIRECTORY,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      throw new Error('A full benchmark source SHA is required.');
    }
  }
  if (!/^[0-9a-f]{40,64}$/iu.test(sourceRevision)) {
    throw new Error('A full benchmark source SHA is required.');
  }
  return sourceRevision.toLowerCase();
}

async function openClearedLanding(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.name = '';
    window.history.replaceState(null, '', window.location.pathname);
  });
  await page.reload();
  await page.getByTestId('nodeslide-landing').waitFor({ state: 'visible', timeout: 60_000 });
  if ((await page.getByTestId('nodeslide-studio').count()) !== 0) {
    throw new Error('editor leaked onto landing');
  }
  const url = new URL(page.url());
  if (url.searchParams.has('deck') || url.searchParams.has('share')) {
    throw new Error('landing retained a deck route');
  }
  const cleared = await page.evaluate(
    ({ deckAccessKey, primaryOwnerAccessKey }) =>
      !window.localStorage.getItem(deckAccessKey) &&
      !window.localStorage.getItem(primaryOwnerAccessKey),
    { deckAccessKey: DECK_ACCESS_KEY, primaryOwnerAccessKey: PRIMARY_OWNER_ACCESS_KEY },
  );
  if (!cleared) throw new Error('landing retained owner access');
}

async function openGoldenSample(page: Page): Promise<string> {
  await page.goto('/');
  await page.evaluate(
    ({ sessionIdKey, sessionId }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.name = '';
      window.history.replaceState(null, '', window.location.pathname);
      window.localStorage.setItem(sessionIdKey, sessionId);
    },
    { sessionIdKey: SESSION_ID_KEY, sessionId: GOLDEN_SESSION_ID },
  );
  await page.reload();
  await page.getByTestId('nodeslide-landing').waitFor({ state: 'visible', timeout: 60_000 });
  const sessionId = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_ID_KEY);
  if (sessionId !== GOLDEN_SESSION_ID) throw new Error('golden session id mismatch');
  const sample = page.getByRole('button', { name: 'Explore the editable sample workspace' });
  await sample.waitFor({ state: 'visible', timeout: 30_000 });
  await sample.click();
  await page.getByTestId('deck-title').waitFor({ state: 'visible', timeout: 90_000 });
  const deckId = new URL(page.url()).searchParams.get('deck');
  if (!deckId) throw new Error('golden sample route missing deck id');
  return deckId;
}

async function selectGoldenHeadline(page: Page): Promise<void> {
  const targetSlide = page.getByTestId(`slide-thumbnail-${GOLDEN_SLIDE_ID}`);
  await targetSlide.waitFor({ state: 'visible', timeout: 30_000 });
  const activeSlide = page.locator(
    `[data-testid="editor-edit-canvas"] [data-slide-id="${GOLDEN_SLIDE_ID}"]`,
  );
  if ((await activeSlide.count()) !== 1) await targetSlide.click();
  await activeSlide.waitFor({ state: 'visible', timeout: 30_000 });
  const headline = page.getByTestId(`slide-element-${GOLDEN_ELEMENT_ID}`);
  if ((await headline.count()) !== 1) throw new Error('stable headline element missing');
  await headline.focus();
  await headline.press('Enter');
  if ((await headline.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('stable headline element was not selected');
  }
}

async function configureNebiusLanding(page: Page): Promise<void> {
  await chooseRecommendedNebius(page, 'landing');
  const provider = page.locator('.ns-landing-web');
  if ((await provider.textContent())?.trim() !== 'Nebius') {
    throw new Error('landing provider was not Nebius');
  }
  await grantSessionConsent(page.getByTestId('landing-provider-consent'));
  await requireRuntimeControls(page);
}

async function configureNebiusEditor(page: Page, selectedElementScope: boolean): Promise<void> {
  await page.getByTestId('inspector-tab-ai').click();
  await chooseRecommendedNebius(page, 'editor');
  const webToggle = page.getByTestId('ai-web-research-toggle');
  await webToggle.waitFor({ state: 'visible', timeout: 30_000 });
  const webPressed = await webToggle.getAttribute('aria-pressed');
  if (webPressed === 'true') await webToggle.click();
  if ((await webToggle.getAttribute('aria-pressed')) !== 'false') {
    throw new Error('web research was not off');
  }

  const controls = page.getByTestId('ai-provider-controls');
  if ((await controls.getAttribute('open')) === null) {
    await page.getByTestId('ai-provider-summary').click();
  }
  if ((await controls.getAttribute('open')) === null)
    throw new Error('advanced controls stayed closed');
  const reviewMode = controls.locator('input[type="radio"][value="review"]');
  if (!(await reviewMode.isChecked())) await reviewMode.check();
  if (!(await reviewMode.isChecked())) throw new Error('review mode was not active');

  if (selectedElementScope) {
    const selectionScope = controls.getByRole('button', { name: /^Selection/u });
    if (
      (await selectionScope.count()) !== 1 ||
      !/1\s*$/u.test((await selectionScope.innerText()).trim())
    ) {
      throw new Error('selected-element scope count did not match');
    }
    await selectionScope.click();
    if ((await selectionScope.getAttribute('aria-pressed')) !== 'true') {
      throw new Error('selected-element scope was not active');
    }
  }

  await grantSessionConsent(page.getByTestId('ai-provider-consent'));
  const routeStatus = (await page.getByTestId('ai-provider-route-status').textContent()) ?? '';
  if (
    !routeStatus.includes('Nebius') ||
    !routeStatus.includes('GLM 5.2') ||
    !routeStatus.includes('Medium effort') ||
    !routeStatus.includes('Consent attached')
  ) {
    throw new Error('editor route status did not match');
  }
  await requireRuntimeControls(page);
}

async function chooseRecommendedNebius(page: Page, surface: 'landing' | 'editor'): Promise<void> {
  const modelTestId = surface === 'landing' ? 'landing-model-select' : 'ai-model-select';
  const effortTestId = surface === 'landing' ? 'landing-effort-select' : 'ai-effort-select';
  const dialogName = surface === 'landing' ? 'Generation model' : 'Agent model';
  await page.getByTestId(modelTestId).click();
  const dialog = page.getByRole('dialog', { name: dialogName });
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  const recommended = dialog.getByLabel('Recommended').getByText('GLM 5.2', { exact: true });
  if ((await recommended.count()) !== 1) throw new Error('recommended GLM model was ambiguous');
  await recommended.click();
  const effort = page.getByTestId(effortTestId);
  await effort.click();
  const effortListbox = page.getByRole('listbox');
  await effortListbox.getByRole('option', { name: 'Medium', exact: true }).click();
  if (!(await effort.textContent())?.includes('Medium')) {
    throw new Error('reasoning effort was not medium');
  }
}

async function grantSessionConsent(consent: Locator): Promise<void> {
  await consent.waitFor({ state: 'visible', timeout: 30_000 });
  if (!(await consent.isChecked())) await consent.check();
  if (!(await consent.isChecked())) throw new Error('session consent was not granted');
}

async function requireRuntimeControls(page: Page): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const controls = await page.evaluate(
      ({ sessionIdKey, sessionPrefix, consentKey }) => {
        const sessionId = window.localStorage.getItem(sessionIdKey);
        if (!sessionId) return null;
        const raw = window.localStorage.getItem(`${sessionPrefix}${encodeURIComponent(sessionId)}`);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as {
            controls?: {
              model?: unknown;
              effort?: unknown;
              web?: { enabled?: unknown };
            };
          };
          let sessionConsent = false;
          const consentRaw = window.sessionStorage.getItem(consentKey);
          if (consentRaw) {
            const consent = JSON.parse(consentRaw) as { version?: unknown; grantedAt?: unknown };
            sessionConsent = consent.version === 1 && typeof consent.grantedAt === 'number';
          }
          return {
            model: parsed.controls?.model,
            effort: parsed.controls?.effort,
            webEnabled: parsed.controls?.web?.enabled,
            sessionConsent,
          };
        } catch {
          return null;
        }
      },
      {
        sessionIdKey: SESSION_ID_KEY,
        sessionPrefix: AGENT_SESSION_PREFIX,
        consentKey: SESSION_CONSENT_KEY,
      },
    );
    if (
      controls?.model === NEBIUS_MODEL_ID &&
      controls.effort === 'medium' &&
      controls.webEnabled === false &&
      controls.sessionConsent === true
    ) {
      return;
    }
    await delay(100);
  }
  throw new Error('runtime controls did not match the fixed live policy');
}

async function submitExactPrompt(
  page: Page,
  fixture: LiveFixture,
  surface: 'landing' | 'editor',
  beforeDispatch?: () => void,
): Promise<void> {
  const expected = EXACT_PROMPTS[fixture.id];
  if (fixture.request.text !== expected || FIXED_LIVE_CASES[fixture.id] !== expected) {
    throw new Error('fixed prompt binding changed');
  }
  const textbox = page.getByLabel(surface === 'landing' ? 'Presentation brief' : 'AI instruction');
  await textbox.fill(expected);
  if ((await textbox.inputValue()) !== expected)
    throw new Error('composer changed the fixed prompt');
  const submit = page.getByRole('button', {
    name: surface === 'landing' ? 'Create presentation' : 'Propose edit',
  });
  await submit.waitFor({ state: 'visible', timeout: 30_000 });
  if (!(await submit.isEnabled())) throw new Error('fixed prompt submit was disabled');
  // This is the sole mutating dispatch for the case. Read-side polling below may repeat; this click may not.
  beforeDispatch?.();
  await submit.click();
}

async function latestStoredJobId(page: Page): Promise<string | null> {
  return page.evaluate(
    ({ sessionIdKey, sessionPrefix }) => {
      const sessionId = window.localStorage.getItem(sessionIdKey);
      if (!sessionId) return null;
      const raw = window.localStorage.getItem(`${sessionPrefix}${encodeURIComponent(sessionId)}`);
      if (!raw) return null;
      try {
        const state = JSON.parse(raw) as {
          activeJob?: { jobId?: unknown } | null;
          lastJob?: { jobId?: unknown } | null;
        };
        const activeJobId = state.activeJob?.jobId;
        if (typeof activeJobId === 'string' && activeJobId) return activeJobId;
        const lastJobId = state.lastJob?.jobId;
        return typeof lastJobId === 'string' && lastJobId ? lastJobId : null;
      } catch {
        return null;
      }
    },
    { sessionIdKey: SESSION_ID_KEY, sessionPrefix: AGENT_SESSION_PREFIX },
  );
}

async function waitForStoredJobCapability(
  page: Page,
  options: {
    expectedKind: StoredJobCapability['kind'];
    previousJobId: string | null;
    expectedDeckId?: string | null;
  },
): Promise<StoredJobCapability> {
  const deadline = Date.now() + JOB_CAPABILITY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const capability = await page.evaluate(
      ({
        sessionIdKey,
        sessionPrefix,
        deckAccessKey,
        expectedKind,
        previousJobId,
        expectedDeckId,
      }) => {
        const sessionId = window.localStorage.getItem(sessionIdKey);
        if (!sessionId) return null;
        const raw = window.localStorage.getItem(`${sessionPrefix}${encodeURIComponent(sessionId)}`);
        if (!raw) return null;
        try {
          const state = JSON.parse(raw) as {
            activeJob?: Record<string, unknown> | null;
            lastJob?: Record<string, unknown> | null;
          };
          const candidates = [state.activeJob, state.lastJob].filter(
            (candidate): candidate is Record<string, unknown> =>
              Boolean(candidate) && typeof candidate === 'object',
          );
          const job = candidates.find(
            (candidate) =>
              candidate['kind'] === expectedKind &&
              typeof candidate['jobId'] === 'string' &&
              candidate['jobId'] !== previousJobId,
          );
          if (!job || typeof job['jobId'] !== 'string') return null;

          let deckAccess: Record<string, string> = {};
          const deckAccessRaw = window.localStorage.getItem(deckAccessKey);
          if (deckAccessRaw) {
            const parsed = JSON.parse(deckAccessRaw) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              deckAccess = Object.fromEntries(
                Object.entries(parsed).filter(
                  (entry): entry is [string, string] =>
                    Boolean(entry[0]) && typeof entry[1] === 'string' && Boolean(entry[1]),
                ),
              );
            }
          }
          const storedDeckId =
            expectedDeckId ||
            (typeof job['targetDeckId'] === 'string' ? job['targetDeckId'] : null) ||
            (typeof job['resultDeckId'] === 'string' ? job['resultDeckId'] : null);
          const directOwner =
            typeof job['ownerAccessKey'] === 'string' && job['ownerAccessKey']
              ? job['ownerAccessKey']
              : null;
          const deckOwner = storedDeckId ? deckAccess[storedDeckId] : undefined;
          const ownerAccessKey = directOwner || deckOwner;
          if (!ownerAccessKey) return null;
          return {
            jobId: job['jobId'],
            ownerAccessKey,
            kind: expectedKind,
            deckId: storedDeckId,
          };
        } catch {
          return null;
        }
      },
      {
        sessionIdKey: SESSION_ID_KEY,
        sessionPrefix: AGENT_SESSION_PREFIX,
        deckAccessKey: DECK_ACCESS_KEY,
        expectedKind: options.expectedKind,
        previousJobId: options.previousJobId,
        expectedDeckId: options.expectedDeckId ?? null,
      },
    );
    if (capability) return capability;
    await delay(250);
  }
  throw new Error('fresh durable job capability did not appear');
}

async function waitForRunReceipt(
  client: ConvexHttpClient,
  caseId: CaseId,
  capability: StoredJobCapability,
  failureGuard: RepeatedLiveFailureGuard,
  ready: (receipt: RunReceipt) => boolean,
  terminalGraceMs: number,
): Promise<RunReceipt> {
  const deadline = Date.now() + LIVE_RECEIPT_TIMEOUT_MS;
  let latest: RunReceipt | null = null;
  let terminalSince: number | null = null;
  while (Date.now() < deadline) {
    try {
      const receipt = (await client.query(api.nodeslideJobs.getRunReceipt, {
        jobId: capability.jobId,
        ownerAccessKey: capability.ownerAccessKey,
      })) as RunReceipt | null;
      if (receipt?.job.jobId === capability.jobId) {
        latest = receipt;
        if (ready(receipt)) return receipt;
        if (isSettledReceipt(receipt)) {
          terminalSince ??= Date.now();
          if (Date.now() - terminalSince >= terminalGraceMs) return receipt;
        }
      }
    } catch {
      try {
        failureGuard.observe(new Error(`${caseId} receipt query unavailable`));
      } catch {
        throw new ProducerOutcomeError(
          caseId,
          'UNSCORED',
          'repeated receipt query failure stopped the live run',
        );
      }
    }
    await delay(1_000);
  }
  if (latest && isSettledReceipt(latest)) return latest;
  throw new Error('durable receipt did not settle');
}

function isSettledReceipt(receipt: RunReceipt): boolean {
  return !ACTIVE_JOB_STATUSES.has(receipt.job.status);
}

function hasBudgetAccountingEnd(receipt: RunReceipt): boolean {
  const events = receipt.budget?.events ?? [];
  return events.some((event) =>
    ['settled', 'unreconciled', 'released', 'finalized', 'denied'].includes(event.kind ?? ''),
  );
}

function requireExpectedLiveCapability(
  caseId: CaseId,
  receipt: RunReceipt,
  job: StoredJobCapability,
): void {
  const capability = receipt.capability;
  if (
    receipt.job.jobId !== job.jobId ||
    capability?.provider !== 'nebius' ||
    capability.model !== NEBIUS_MODEL_ID ||
    capability.egress !== 'model' ||
    capability.hasConsent !== true
  ) {
    throw new ProducerOutcomeError(
      caseId,
      'UNSCORED',
      'the receipt did not prove Nebius GLM 5.2 with Web off and consent',
    );
  }
}

function requireExactSelectedElementScope(receipt: RunReceipt): void {
  const scope = receipt.patch?.scope;
  if (
    scope?.kind !== 'elements' ||
    scope.elementIds?.length !== 1 ||
    scope.elementIds[0] !== GOLDEN_ELEMENT_ID ||
    scope.slideIds?.length !== 1 ||
    scope.slideIds[0] !== GOLDEN_SLIDE_ID
  ) {
    throw new ProducerOutcomeError(
      'E01',
      'FAIL',
      'the durable proposal did not preserve the exact selected-element scope',
    );
  }
}

async function captureComparisonPixels(
  page: Page,
  patchId: string,
): Promise<{ before: PixelCapture; after: PixelCapture }> {
  const proposal = proposalById(page, patchId);
  await proposal.waitFor({ state: 'visible', timeout: 120_000 });
  const preview = proposal.getByTestId('proposal-preview');
  if ((await preview.getAttribute('aria-pressed')) !== 'true') {
    if (!(await preview.isEnabled())) throw new Error('exact proposal comparison was unavailable');
    await preview.click();
  }
  if ((await preview.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('exact proposal comparison did not activate');
  }
  const comparison = page.getByLabel('Baseline and candidate comparison');
  await comparison.waitFor({ state: 'visible', timeout: 120_000 });
  const beforeSurface = comparison.locator('.ns-compare-frame.is-baseline .ns-compare-surface');
  const afterSurface = comparison.locator('.ns-compare-frame.is-candidate .ns-compare-surface');
  if ((await beforeSurface.count()) !== 1 || (await afterSurface.count()) !== 1) {
    throw new Error('comparison surfaces were ambiguous');
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const beforeBytes = await beforeSurface.screenshot({
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
  const afterBytes = await afterSurface.screenshot({
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
  const before = pixelCapture(beforeBytes);
  const after = pixelCapture(afterBytes);
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error('comparison pixel dimensions differed');
  }
  return { before, after };
}

function pixelCapture(bytes: Buffer): PixelCapture {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    !signature.every((byte, index) => bytes[index] === byte) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('manual capture was not a PNG');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) throw new Error('manual capture dimensions were invalid');
  return { bytes, width, height };
}

async function storedProposalIds(page: Page): Promise<Set<string>> {
  const ids = await page.locator('[data-testid="proposal-card"]').evaluateAll((cards) =>
    cards.flatMap((card) => {
      const id = card.getAttribute('data-proposal-id');
      return id && /^[a-zA-Z0-9:_-]+$/u.test(id) ? [id] : [];
    }),
  );
  return new Set(ids);
}

async function waitForNewProposalId(
  page: Page,
  existingIds: ReadonlySet<string>,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const newIds = [...(await storedProposalIds(page))].filter((id) => !existingIds.has(id));
    if (newIds.length > 1) throw new Error('new proposal identity was ambiguous');
    if (newIds.length === 1) return newIds[0] ?? null;
    await delay(250);
  }
  return null;
}

async function rejectProposal(page: Page, patchId: string | null | undefined): Promise<void> {
  if (!patchId || !/^[a-zA-Z0-9:_-]+$/u.test(patchId)) {
    throw new Error('proposal id was unavailable');
  }
  const proposal = proposalById(page, patchId);
  await proposal.waitFor({ state: 'visible', timeout: 60_000 });
  const reject = proposal.getByTestId('proposal-reject');
  if (!(await reject.isEnabled())) throw new Error('proposal reject was disabled');
  await reject.click();
  await proposal.waitFor({ state: 'detached', timeout: 60_000 });
}

function proposalById(page: Page, patchId: string): Locator {
  if (!/^[a-zA-Z0-9:_-]+$/u.test(patchId)) throw new Error('proposal id was invalid');
  return page.locator(`[data-testid="proposal-card"][data-proposal-id="${patchId}"]`);
}

function observeConvexOrigin(page: Page): { current: () => string | null } {
  let origin: string | null = null;
  const consider = (rawUrl: string) => {
    try {
      const url = new URL(rawUrl);
      const convexHost = /(?:\.convex\.cloud|\.convex\.site)$/iu.test(url.hostname);
      const convexPath = /^\/api\/(?:sync|query|mutation|action)/u.test(url.pathname);
      if (!convexHost && !convexPath) return;
      if (url.protocol === 'wss:') url.protocol = 'https:';
      if (url.protocol === 'ws:') url.protocol = 'http:';
      if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin;
    } catch {
      // Ignore unrelated browser traffic; a missing binding fails closed before the first write.
    }
  };
  page.on('request', (request) => consider(request.url()));
  page.on('websocket', (socket) => consider(socket.url()));
  return { current: () => origin };
}

async function resolveConvexUrl(probe: { current: () => string | null }): Promise<string> {
  const observedDeadline = Date.now() + 10_000;
  while (!probe.current() && Date.now() < observedDeadline) await delay(100);
  const observed = normalizeConvexUrl(probe.current());
  const configured = normalizeConvexUrl(
    process.env['NODESLIDE_BENCH_CONVEX_URL']?.trim() ||
      process.env['VITE_CONVEX_URL']?.trim() ||
      null,
  );
  if (observed && configured && observed !== configured) {
    throw new Error('configured Convex deployment did not match the browser deployment');
  }
  if (observed) return observed;
  if (configured) return configured;

  const envContent = await readFile(path.join(REPOSITORY_DIRECTORY, '.env.local'), 'utf8').catch(
    () => '',
  );
  const line = envContent
    .split(/\r?\n/u)
    .find((candidate) => candidate.trim().startsWith('VITE_CONVEX_URL='));
  const fromFile = normalizeConvexUrl(
    line
      ?.slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^["']|["']$/gu, '') ?? null,
  );
  if (!fromFile) throw new Error('Convex deployment URL was unavailable');
  return fromFile;
}

function normalizeConvexUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function producerEnvironment(page: Page): ProducerEnvironment {
  const url = new URL(page.url());
  const host = url.hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const mode: EnvironmentMode = local
    ? 'local'
    : host === 'parity-studio.vercel.app'
      ? 'production'
      : 'preview';
  return { name: host || 'local', mode };
}

async function cleanupSyntheticC01(options: {
  page: Page;
  client: ConvexHttpClient | null;
  job: StoredJobCapability | null;
  deck: OwnedDeck | null;
  dispatchAttempted: boolean;
  previousJobId: string | null;
  receiptFailureGuard: RepeatedLiveFailureGuard;
}): Promise<void> {
  if (!options.dispatchAttempted && !options.job && !options.deck) return;
  const client = options.client;
  if (!client) {
    throw new ProducerOutcomeError('C01', 'FAIL', 'synthetic deck cleanup had no Convex client');
  }
  let job = options.job;
  if (!job && options.dispatchAttempted) {
    try {
      job = await waitForStoredJobCapability(options.page, {
        expectedKind: 'create_deck',
        previousJobId: options.previousJobId,
      });
    } catch {
      throw new ProducerOutcomeError(
        'C01',
        'FAIL',
        'synthetic deck cleanup could not recover the creation capability',
      );
    }
  }
  let deck = options.deck;
  if (!deck && job) {
    let receipt: RunReceipt;
    try {
      receipt = await waitForRunReceipt(
        client,
        'C01',
        job,
        options.receiptFailureGuard,
        (candidate) => isSettledReceipt(candidate),
        0,
      );
    } catch {
      throw new ProducerOutcomeError(
        'C01',
        'FAIL',
        'synthetic deck cleanup could not recover the creation receipt',
      );
    }
    const deckId = receipt.snapshot?.deck.id ?? receipt.job.resultDeckId;
    if (!deckId) {
      if (['failed', 'cancelled', 'rejected', 'stale'].includes(receipt.job.status)) return;
      throw new ProducerOutcomeError(
        'C01',
        'FAIL',
        'synthetic deck cleanup could not identify the created deck',
      );
    }
    deck = { deckId, ownerAccessKey: job.ownerAccessKey };
  }
  if (!deck) return;
  try {
    await client.mutation(api.nodeslide.deleteDeck, {
      deckId: deck.deckId,
      ownerAccessKey: deck.ownerAccessKey,
    });
    const remaining = await client.query(api.nodeslide.getWorkspace, {
      deckId: deck.deckId,
      ownerAccessKey: deck.ownerAccessKey,
    });
    if (remaining !== null) throw new Error('synthetic deck still exists');
  } catch {
    throw new ProducerOutcomeError('C01', 'FAIL', 'synthetic deck deletion was not verified');
  }
}

async function captureCase(
  caseId: CaseId,
  failures: ProducerOutcomeError[],
  failureGuard: RepeatedLiveFailureGuard,
  capture: () => Promise<void>,
): Promise<void> {
  try {
    await capture();
  } catch (error) {
    recordCaseFailure(
      failures,
      failureGuard,
      asProducerOutcome(error, caseId, 'UNSCORED', 'the live case was incomplete'),
    );
  }
}

function recordCaseFailure(
  failures: ProducerOutcomeError[],
  failureGuard: RepeatedLiveFailureGuard,
  failure: ProducerOutcomeError,
): void {
  failures.push(failure);
  try {
    failureGuard.observe(new Error(`${failure.status} ${failure.stage}`));
  } catch {
    throw new ProducerOutcomeError(
      failure.caseId,
      failure.status,
      'repeated identical live failure stopped the producer',
    );
  }
}

async function guardedStage<T>(
  caseId: CaseId,
  status: BenchmarkStatus,
  stage: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw asProducerOutcome(error, caseId, status, stage);
  }
}

function asProducerOutcome(
  error: unknown,
  caseId: CaseId,
  status: BenchmarkStatus,
  stage: string,
): ProducerOutcomeError {
  return error instanceof ProducerOutcomeError
    ? error
    : new ProducerOutcomeError(caseId, status, stage);
}

function requireJob(job: StoredJobCapability | null, caseId: CaseId): StoredJobCapability {
  if (!job) throw new ProducerOutcomeError(caseId, 'UNSCORED', 'job capability was unavailable');
  return job;
}

function requireClient(client: ConvexHttpClient | null, caseId: CaseId): ConvexHttpClient {
  if (!client) throw new ProducerOutcomeError(caseId, 'UNSCORED', 'Convex client was unavailable');
  return client;
}

function requireEnvironment(environment: ProducerEnvironment | null): ProducerEnvironment {
  if (!environment) throw new Error('producer environment was unavailable');
  return environment;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
