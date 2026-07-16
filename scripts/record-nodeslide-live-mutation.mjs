import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repo, 'artifacts', 'nodeslide-agent-ux-2026-07-15');
const videoDir = join(outDir, 'raw');
const webmPath = join(outDir, 'live-deck-mutation.webm');
const mp4Path = join(outDir, 'live-deck-mutation.mp4');
const gifPath = join(outDir, 'live-deck-mutation.gif');
const palettePath = join(outDir, 'live-deck-mutation-palette.png');
const appUrl = process.env.NODESLIDE_URL ?? 'http://127.0.0.1:4173/';

mkdirSync(videoDir, { recursive: true });
rmSync(webmPath, { force: true });
rmSync(mp4Path, { force: true });
rmSync(gifPath, { force: true });
rmSync(palettePath, { force: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const video = page.video();

try {
  await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.getByText('Explore the editable sample workspace', { exact: true }).click();
  await page.getByTestId('ai-composer').waitFor({ state: 'visible', timeout: 90_000 });
  await installProofLayer(page);

  await setCaption(page, 'One request. One review. One live mutation.');
  await page.waitForTimeout(1_100);

  const model = page.getByTestId('ai-model-select');
  await pointAt(page, model);
  await model.selectOption('deterministic');

  const composer = page.locator('textarea[aria-label="AI instruction"], textarea').first();
  await pointAt(page, composer);
  await composer.click();
  await setCaption(page, '1 · Describe the outcome');
  await composer.pressSequentially(
    'Replace "Build the story. Keep every decision editable." with "Live deck mutation. Zero friction.".',
    { delay: 18 },
  );
  await page.waitForTimeout(650);

  const propose = page.getByTestId('ai-submit');
  await pointAt(page, propose);
  await setCaption(page, '2 · Propose — the deck stays unchanged');
  await propose.click();

  const proposal = page.getByTestId('proposal-card').first();
  await proposal.waitFor({ state: 'visible', timeout: 60_000 });
  await proposal.scrollIntoViewIfNeeded();
  await setCaption(page, '3 · Review the scoped, validated patch');
  await page.waitForTimeout(1_800);

  const accept = page.getByTestId('proposal-accept').first();
  await pointAt(page, accept);
  await setCaption(page, '4 · Approve to mutate');
  await accept.click();

  await page.getByText('Live deck mutation. Zero friction.', { exact: true }).first().waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  await setCaption(page, 'Done · Updated, versioned, and recoverable');
  await page.waitForTimeout(2_200);
} finally {
  await page.close();
}

await video.saveAs(webmPath);
await context.close();
await browser.close();

runFfmpeg([
  '-y',
  '-i',
  webmPath,
  '-ss',
  '2.3',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  mp4Path,
]);

const gifFilter = 'fps=10,scale=1000:-1:flags=lanczos';
runFfmpeg(['-y', '-i', mp4Path, '-vf', `${gifFilter},palettegen=stats_mode=diff`, palettePath]);
runFfmpeg([
  '-y',
  '-i',
  mp4Path,
  '-i',
  palettePath,
  '-lavfi',
  `${gifFilter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
  gifPath,
]);
rmSync(palettePath, { force: true });

console.log(`WROTE ${webmPath}`);
console.log(`WROTE ${mp4Path}`);
console.log(`WROTE ${gifPath}`);

async function installProofLayer(target) {
  await target.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #nodeslide-proof-caption {
        position: fixed; left: 50%; top: 66px; transform: translateX(-50%);
        z-index: 99999; max-width: 760px; padding: 10px 16px;
        border: 1px solid rgba(255,255,255,.16); border-radius: 999px;
        background: rgba(17,24,39,.92); color: white;
        box-shadow: 0 10px 30px rgba(15,23,42,.22);
        font: 650 14px/1.2 -apple-system,BlinkMacSystemFont,Inter,sans-serif;
        letter-spacing: .01em; pointer-events: none;
      }
      #nodeslide-proof-cursor {
        position: fixed; left: 50%; top: 50%; z-index: 100000;
        width: 18px; height: 18px; margin: -9px 0 0 -9px;
        border: 2px solid white; border-radius: 50%;
        background: #d97757; box-shadow: 0 0 0 3px rgba(17,24,39,.45);
        pointer-events: none; transition: left .36s cubic-bezier(.2,.8,.2,1), top .36s cubic-bezier(.2,.8,.2,1), transform .12s ease;
      }
    `;
    document.head.append(style);
    const caption = document.createElement('div');
    caption.id = 'nodeslide-proof-caption';
    caption.textContent = 'Live deck mutation';
    document.body.append(caption);
    const cursor = document.createElement('div');
    cursor.id = 'nodeslide-proof-cursor';
    document.body.append(cursor);
  });
}

async function setCaption(target, text) {
  await target.locator('#nodeslide-proof-caption').evaluate((node, value) => {
    node.textContent = value;
  }, text);
}

async function pointAt(target, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await target.locator('#nodeslide-proof-cursor').evaluate(
    (node, point) => {
      node.style.left = `${point.x}px`;
      node.style.top = `${point.y}px`;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  await target.waitForTimeout(430);
}

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', args, { cwd: repo, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed with exit code ${result.status}`);
}
