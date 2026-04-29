// Programmatic round-trip test for the canonical ui_kit zip:
//   1. drop NodeBench AI Design System (2).zip onto the composer
//   2. wait for verifyImportedKit to land (right-rail rubric populated)
//   3. click Export ZIP
//   4. unpack the export, confirm canonical shape:
//      README.md, SKILL.md, colors_and_type.css, uploads/source.*,
//      ui_kits/<slug>/{index.html, components/, tokens.css, ...}
//   5. round-trip: drop the EXPORTED zip back onto a fresh page, confirm
//      it imports cleanly
//
// Run: node scripts/test-canonical-import.mjs
//
// Env:
//   PARITY_STUDIO_URL  override target (default: live prod)
//   CANONICAL_ZIP      path to the source zip (default: NodeBench v2)
//   HEADED             "0" to run headless (default: headed)

import { chromium } from 'playwright';
import JSZip from 'jszip';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PARITY_STUDIO_URL = process.env.PARITY_STUDIO_URL ?? 'https://parity-studio.vercel.app/';
const CANONICAL_ZIP = process.env.CANONICAL_ZIP ?? 'C:\\Users\\hshum\\Downloads\\NodeBench AI Design System (2).zip';
const HEADED = process.env.HEADED !== '0';

async function main() {
  if (!existsSync(CANONICAL_ZIP)) {
    console.error(`canonical zip not found: ${CANONICAL_ZIP}`);
    process.exit(2);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(repoRoot, 'runs', `import-test-${stamp}`);
  await mkdir(outDir, { recursive: true });
  console.log(`[test] output: ${outDir}`);
  console.log(`[test] target: ${PARITY_STUDIO_URL}`);
  console.log(`[test] zip:    ${CANONICAL_ZIP}`);

  const browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({
    viewport: { width: 1680, height: 900 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[browser]', m.text());
  });

  try {
    console.log('[test] 1 — load shell');
    await page.goto(PARITY_STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2_500);

    console.log('[test] 2 — drop canonical zip onto paperclip');
    const fileInput = page.locator('input[type=file]').first();
    await fileInput.setInputFiles(CANONICAL_ZIP);

    // Wait for the run to materialize: the breadcrumb flips to a real
    // session title and the right-rail score lights up.
    console.log('[test] 3 — wait for verifyImportedKit to land');
    let pass = '';
    for (let i = 0; i < 60; i += 1) {
      await page.waitForTimeout(2_000);
      const txt = (await page
        .locator('aside[aria-label="Deterministic parity"]')
        .first()
        .textContent()
        .catch(() => '')) ?? '';
      const m = txt.match(/(\d+)\s*\/\s*16\s*checks passing/);
      if (m && m[1] && Number(m[1]) > 0) {
        pass = m[1];
        break;
      }
      // Also break if "Status: Done" appears
      if (txt.includes('Status: Done')) break;
    }
    console.log(`[test] right-rail shows ${pass || 'unknown'} / 16 checks passing`);

    console.log('[test] 4 — click Export ZIP');
    const dlPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('link', { name: /^export$/i }).first().click();
    const dl = await dlPromise;
    const exportedZipPath = join(outDir, dl.suggestedFilename() || 'exported.zip');
    await dl.saveAs(exportedZipPath);
    const exportedSize = (await stat(exportedZipPath)).size;
    console.log(`[test] exported: ${exportedZipPath} (${exportedSize} bytes)`);

    console.log('[test] 5 — verify canonical shape of the export');
    const exportedBuf = await readFile(exportedZipPath);
    const exportedZip = await JSZip.loadAsync(exportedBuf);
    const required = [
      'README.md',
      'SKILL.md',
      'colors_and_type.css',
    ];
    const present = Object.keys(exportedZip.files);
    const missing = required.filter((p) => !present.includes(p));
    const hasUiKit = present.some((p) => p.match(/^ui_kits\/[^/]+\/index\.html$/));
    const hasUpload = present.some((p) => p.match(/^uploads\/source\.(png|jpeg|jpg|webp)$/));
    const skillMd = await exportedZip.file('SKILL.md')?.async('string');
    console.log(`[test] required top-level: ${required.length - missing.length}/${required.length} present`);
    if (missing.length > 0) console.log(`[test] missing: ${missing.join(', ')}`);
    console.log(`[test] ui_kits/<slug>/index.html present: ${hasUiKit}`);
    console.log(`[test] uploads/source.* present: ${hasUpload}`);
    if (skillMd) {
      const desc = skillMd.match(/description:\s*([^\n]+)/i)?.[1] ?? '<none>';
      console.log(`[test] SKILL.md description: ${desc.slice(0, 80)}…`);
    }

    console.log('[test] 6 — round-trip: drop the EXPORTED zip onto a fresh page');
    await page.goto(PARITY_STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2_500);
    await fileInput.setInputFiles(exportedZipPath).catch(async () => {
      // The file input was replaced after navigation
      const fresh = page.locator('input[type=file]').first();
      await fresh.setInputFiles(exportedZipPath);
    });
    let roundTrip = '';
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(2_000);
      const txt = (await page
        .locator('aside[aria-label="Deterministic parity"]')
        .first()
        .textContent()
        .catch(() => '')) ?? '';
      const m = txt.match(/(\d+)\s*\/\s*16\s*checks passing/);
      if (m && m[1] && Number(m[1]) > 0) {
        roundTrip = m[1];
        break;
      }
    }
    console.log(`[test] round-trip parity: ${roundTrip || 'unknown'} / 16`);

    await page.waitForTimeout(1_000);
    const finalShot = join(outDir, 'final-state.png');
    await page.screenshot({ path: finalShot, fullPage: false });
    console.log(`[test] final screenshot: ${finalShot}`);

    // Summary
    const ok =
      missing.length === 0 &&
      hasUiKit &&
      Number(pass) > 0 &&
      Number(roundTrip) > 0;
    console.log('---');
    console.log(`[test] PASS: ${ok}`);
    console.log(`  initial parity: ${pass}/16`);
    console.log(`  exported size:  ${exportedSize} bytes`);
    console.log(`  canonical:      ${missing.length === 0 ? 'shape ok' : `missing ${missing.join(', ')}`}`);
    console.log(`  round-trip:     ${roundTrip}/16`);

    await writeFile(
      join(outDir, 'summary.json'),
      JSON.stringify(
        {
          ok,
          initialParity: pass,
          exportedSize,
          canonicalMissing: missing,
          uiKitPresent: hasUiKit,
          uploadsPresent: hasUpload,
          roundTripParity: roundTrip,
        },
        null,
        2,
      ),
    );
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('[test] error:', err);
    process.exit(1);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[test] fatal:', err);
  process.exit(1);
});
