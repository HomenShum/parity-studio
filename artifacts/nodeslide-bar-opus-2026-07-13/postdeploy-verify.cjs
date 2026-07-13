/* Post-deploy verification for the NodeSlide F1/F2/F3 fixes.
 * Run AFTER the codex/nodeslide-agentic-authoring branch deploys to parity-studio.vercel.app.
 * Confirms: (F3) create dialog exposes [data-testid=new-deck-title] and create is reliable;
 *           (F1/F2) live GLM edit yields a REVIEWABLE proposal (live or labeled fallback),
 *                   never a raw "Server Error Called by client".
 * Doubles as a "did it deploy yet?" probe: if new-deck-title is absent, the build is still old.
 *
 * Usage: node postdeploy-verify.cjs
 * Needs the prod access code at scratchpad/code.txt (see profile: `npx convex env get NODESLIDE_PREVIEW_ACCESS_CODE --prod`).
 */
const path = require('node:path');
const fs = require('node:fs');
const REPO = 'D:/VSCode Projects/parity-studio';
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const URL = 'https://parity-studio.vercel.app/?domain=nodeslide';
const SCR =
  'C:/Users/hshum/AppData/Local/Temp/claude/D--VSCode-Projects-parity-studio/2bf30363-5471-4781-9120-42a571eab9b5/scratchpad';
const CODE = (() => {
  try {
    return fs.readFileSync(path.join(SCR, 'code.txt'), 'utf8').trim();
  } catch {
    return '';
  }
})();
const wait = (p, ms) => p.waitForTimeout(ms);
const panelText = (p) =>
  p.evaluate(
    () =>
      (document.querySelector('[data-testid="nodeslide-studio"]') || document.body).innerText || '',
  );

async function createDeck(page) {
  const cmd = page.getByText('Create my deck');
  if (await cmd.count()) await cmd.first().click();
  else await page.locator('[data-testid="new-deck-trigger"]').first().click();
  await page.waitForTimeout(900);
  // F3 assertion: the dialog title input must be unambiguously targetable
  const dlgTitle = page.locator('[data-testid="new-deck-title"]');
  const hasNewTestid = (await dlgTitle.count()) > 0;
  if (!hasNewTestid)
    return {
      hasNewTestid: false,
      created: false,
      note: 'new-deck-title absent — OLD BUILD still deployed',
    };
  await dlgTitle.fill(`Postdeploy verify ${Math.floor(page.__i || 0)}`);
  await page
    .locator('textarea[placeholder*="evidence-led"]')
    .first()
    .fill(
      'Explain why slide handoffs cost teams review cycles and hours each quarter; give the risk, the fix, and one measurable outcome.',
    );
  await page.locator('[data-testid="preview-access-code"]').fill(CODE);
  await wait(page, 300);
  await page
    .getByRole('button', { name: /Create deck/i })
    .first()
    .click();
  let created = false;
  try {
    await page.waitForFunction(
      () => /deck=deck_/.test(location.href) && !/deck_golden/.test(location.href),
      { timeout: 60000 },
    );
    created = true;
  } catch {}
  await wait(page, 2000);
  return { hasNewTestid: true, created, url: page.url() };
}

async function liveEditOnGolden(page) {
  const disc = page.getByText(/(Web|External model):\s*off/i);
  if (await disc.count()) {
    try {
      await disc.first().click();
      await wait(page, 500);
    } catch {}
  }
  try {
    await page.locator('input[type=radio][value="openrouter_free"]').first().check({ force: true });
    await wait(page, 400);
  } catch {}
  const checks = page.locator('input[type=checkbox]');
  const n = await checks.count();
  for (let i = 0; i < n; i++) {
    const c = checks.nth(i);
    if (await c.isEnabled().catch(() => false)) {
      try {
        await c.check({ force: true });
      } catch {}
    }
  }
  const armed = await page.evaluate(() => {
    const r = document.querySelector('input[type=radio][value="openrouter_free"]');
    return r ? r.checked : false;
  });
  if (!armed) return { armed: false };
  const ta = page.locator('textarea[placeholder*="crisp executive"]').first();
  await ta.click();
  await ta.fill(
    'Rewrite this slide body into two crisp bullets about keeping decisions editable and sources attached.',
  );
  await wait(page, 300);
  await page.locator('[aria-label="Propose edit"]').first().click();
  const t0 = Date.now();
  let outcome = 'timeout';
  for (let i = 0; i < 90; i++) {
    await wait(page, 1000);
    const t = await panelText(page);
    if (/Server Error|Called by client/i.test(t)) {
      outcome = 'RAW_SERVER_ERROR';
      break;
    } // F1/F2 FAILURE
    if (/deterministic fallback/i.test(t)) {
      outcome = 'fallback_proposal';
      break;
    } // acceptable (honest)
    if (
      /Replace slide|Review the proposed|Discard proposal|Accept edit|Candidate ready|6 changes|\d+ changes/i.test(
        t,
      ) &&
      !/Drafting proposal/i.test(t)
    ) {
      outcome = 'live_or_review_proposal';
      break;
    }
    if (/\bFailed\b/i.test(t) && !/Drafting proposal/i.test(t)) {
      outcome = 'failed_clean';
      break;
    }
  }
  return { armed: true, outcome, ms: Date.now() - t0 };
}

(async () => {
  const browser = await chromium.launch();
  const out = { createSamples: [], editSamples: [], ts: new Date().toISOString?.() || 'n/a' };
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 } });
    const page = await ctx.newPage();
    page.__i = i;
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await wait(page, 1500);
    out.createSamples.push(await createDeck(page).catch((e) => ({ err: String(e).slice(0, 120) })));
    // live edit on the golden deck in this same session
    const explore = page.getByText('Explore the sample');
    if (await explore.count()) {
      try {
        await explore.first().click();
        await wait(page, 1200);
      } catch {}
    }
    out.editSamples.push(
      await liveEditOnGolden(page).catch((e) => ({ err: String(e).slice(0, 120) })),
    );
    await ctx.close();
  }
  const deployed = out.createSamples.some((s) => s.hasNewTestid);
  const anyRawError = out.editSamples.some((s) => s.outcome === 'RAW_SERVER_ERROR');
  const createReliable = out.createSamples.filter((s) => s.created).length;
  out.verdict = {
    deployed,
    F3_create_reliable: `${createReliable}/3`,
    F1F2_no_raw_error: !anyRawError,
    editOutcomes: out.editSamples.map((s) => s.outcome || s.err),
  };
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('VERIFY_ERR', e?.message || e);
  process.exit(1);
});
