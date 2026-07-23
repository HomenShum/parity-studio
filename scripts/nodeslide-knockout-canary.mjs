/**
 * Knockout canary — the verifier-side runner that turns a baseline PPTX into a causal-primacy
 * verdict by actually rendering, never by trusting the producer.
 *
 * It carves the three decks itself (knockout-surgery), renders baseline + knockout + isolated +
 * blank through LibreOffice, rasterises the target slide, and measures two masks with ImageMagick:
 *
 *   native mask = | isolated - blank |     the pixels the native object draws
 *   causal mask = | baseline - knockout |  the pixels that vanish when it is removed
 *
 * decideKnockout then asks whether removing the native object removed what it draws. A flattened
 * duplicate makes baseline == knockout, so the causal mask is empty while the native mask is full —
 * the verdict is `flattened-duplicate`. If LibreOffice or ImageMagick is missing, it exits 2 and
 * says so: H-style honesty, `not-run` rather than a fabricated pass.
 *
 * Usage:
 *   node scripts/nodeslide-knockout-canary.mjs --pptx <deck.pptx> --slide <n> --kind <chart|table|diagram|equation>
 *        [--region x,y,w,h]   (fractions of the slide; default whole slide)
 *        [--dpi 150] [--work <dir>]
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { decideKnockout } from './lib/knockout-primacy.mjs';
import {
  blankSlide,
  isolatedSlide,
  knockoutSlide,
  ownershipSet,
  topLevelShapes,
} from './lib/knockout-surgery.mjs';

function flag(name, argv) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

const SOFFICE = process.env.SOFFICE || 'C:/Program Files/LibreOffice/program/soffice.com';
const MAGICK = process.env.MAGICK || 'magick';
const PDFTOPPM = process.env.PDFTOPPM || 'pdftoppm';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '', ok: r.status === 0 };
}

function toolsPresent() {
  const missing = [];
  if (!run(MAGICK, ['-version']).ok) missing.push('ImageMagick (magick)');
  if (!run(PDFTOPPM, ['-v']).ok && !run(PDFTOPPM, ['-h']).ok) missing.push('pdftoppm (poppler)');
  return missing;
}

/** Replace one slide's XML in a pptx buffer and return a new buffer. */
async function withSlide(buffer, slideNumber, newXml) {
  const zip = await JSZip.loadAsync(buffer);
  const target = Object.keys(zip.files).find((p) =>
    new RegExp(`ppt/slides/slide${slideNumber}\\.xml$`).test(p),
  );
  if (!target) throw new Error(`slide ${slideNumber} not found in deck`);
  zip.file(target, newXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Render a pptx to a PNG of the target slide, cropped to the region. Returns the png path. */
function renderSlidePng(pptxPath, slideNumber, region, dpi, workDir, tag) {
  const pdfDir = path.join(workDir, tag);
  run(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', pdfDir, pptxPath]);
  const pdf = path.join(pdfDir, `${path.basename(pptxPath, '.pptx')}.pdf`);
  // pdftoppm is 1-indexed; render only the target page.
  const base = path.join(pdfDir, 'page');
  run(PDFTOPPM, [
    '-png',
    '-r',
    String(dpi),
    '-f',
    String(slideNumber),
    '-l',
    String(slideNumber),
    pdf,
    base,
  ]);
  // pdftoppm names the file page-<n>.png with padding it chooses; find it with node, not a shell
  // glob (Windows backslash paths do not glob under bash).
  const pngName = readdirSync(pdfDir).find((f) => /^page-\d+\.png$/.test(f));
  if (!pngName) throw new Error(`no PNG rendered for ${tag}`);
  const produced = path.join(pdfDir, pngName);
  if (!region) return produced;
  // Crop to the region (fractions of the page).
  const cropped = path.join(pdfDir, 'region.png');
  const [rx, ry, rw, rh] = region;
  run(MAGICK, [
    produced,
    '-set',
    'option:cw',
    `%[fx:w*${rw}]`,
    '-set',
    'option:ch',
    `%[fx:h*${rh}]`,
    '-crop',
    `%[fx:round(w*${rw})]x%[fx:round(h*${rh})]+%[fx:round(w*${rx})]+%[fx:round(h*${ry})]`,
    '+repage',
    cropped,
  ]);
  return cropped;
}

/** White-pixel count of a binary mask made from |a - b| thresholded. */
function maskArea(a, b, workDir, tag) {
  const mask = path.join(workDir, `${tag}.png`);
  run(MAGICK, [
    a,
    b,
    '-resize',
    // guard against 1px render size drift between variants
    '%[fx:min(u.w,v.w)]x%[fx:min(u.h,v.h)]!',
    '-compose',
    'difference',
    '-composite',
    '-colorspace',
    'Gray',
    '-threshold',
    '10%',
    mask,
  ]);
  const area = Number(run(MAGICK, [mask, '-format', '%[fx:mean*w*h]', 'info:']).out.trim());
  return { mask, area: Number.isFinite(area) ? area : 0 };
}

function intersectionArea(m1, m2, workDir) {
  const out = path.join(workDir, 'overlap.png');
  run(MAGICK, [m1, m2, '-compose', 'multiply', '-composite', out]);
  const a = Number(run(MAGICK, [out, '-format', '%[fx:mean*w*h]', 'info:']).out.trim());
  return Number.isFinite(a) ? a : 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const pptxPath = flag('pptx', argv);
  const slideNumber = Number(flag('slide', argv));
  const kind = flag('kind', argv);
  if (!pptxPath || !slideNumber || !kind) {
    process.stderr.write('--pptx, --slide and --kind are required.\n');
    process.exit(1);
  }
  const region = flag('region', argv)?.split(',').map(Number) ?? null;
  const dpi = Number(flag('dpi', argv) || 150);
  const workDir = path.resolve(
    flag('work', argv) || path.join(path.dirname(fileURLToPath(import.meta.url)), '.knockout-work'),
  );

  const missing = toolsPresent();
  if (missing.length) {
    process.stderr.write(
      `Knockout canary cannot run: missing ${missing.join(', ')}. Verdict not-run — causal primacy is unproven, not passed.\n`,
    );
    process.exit(2);
  }

  const buffer = await readFile(pptxPath);
  const zip = await JSZip.loadAsync(buffer);
  const slidePath = Object.keys(zip.files).find((p) =>
    new RegExp(`ppt/slides/slide${slideNumber}\\.xml$`).test(p),
  );
  const slideXml = await zip.file(slidePath).async('string');

  const { shapes, hasGroups } = topLevelShapes(slideXml);
  if (hasGroups) {
    process.stderr.write('slide contains groups; this carver does not split them. not-run.\n');
    process.exit(2);
  }
  const owned = ownershipSet(shapes, kind);
  if (owned.length === 0) {
    process.stdout.write(
      JSON.stringify(
        decideKnockout({
          measured: true,
          nativeMaskArea: 0,
          causalMaskArea: 0,
          overlapArea: 0,
          regionArea: 1,
        }),
        null,
        2,
      ),
    );
    process.stderr.write(`\nno native ${kind} ownership set found on slide ${slideNumber}.\n`);
    process.exit(1);
  }

  await mkdir(workDir, { recursive: true });
  const decks = {
    baseline: buffer,
    knockout: await withSlide(buffer, slideNumber, knockoutSlide(slideXml, owned)),
    isolated: await withSlide(buffer, slideNumber, isolatedSlide(slideXml, owned)),
    blank: await withSlide(buffer, slideNumber, blankSlide(slideXml)),
  };
  const pngs = {};
  for (const [tag, buf] of Object.entries(decks)) {
    const p = path.join(workDir, `${tag}.pptx`);
    await writeFile(p, buf);
    pngs[tag] = renderSlidePng(p, slideNumber, region, dpi, workDir, tag);
  }

  const native = maskArea(pngs.isolated, pngs.blank, workDir, 'native-mask');
  const causal = maskArea(pngs.baseline, pngs.knockout, workDir, 'causal-mask');
  const overlap = intersectionArea(native.mask, causal.mask, workDir);
  // Region area in pixels = the native+blank frame size.
  const regionArea = Number(
    run(MAGICK, [pngs.isolated, '-format', '%[fx:w*h]', 'info:']).out.trim(),
  );

  const verdict = decideKnockout({
    measured: true,
    nativeMaskArea: native.area,
    causalMaskArea: causal.area,
    overlapArea: overlap,
    regionArea: regionArea || 1,
  });

  process.stdout.write(
    `${JSON.stringify({ slide: slideNumber, kind, ownedShapeIds: owned, nativeMaskArea: Math.round(native.area), causalMaskArea: Math.round(causal.area), overlapArea: Math.round(overlap), regionArea, ...verdict }, null, 2)}\n`,
  );
  process.exit(verdict.pass ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`knockout canary failed: ${error.message}\n`);
  process.exit(1);
});
