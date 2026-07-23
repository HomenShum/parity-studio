/**
 * Embedded-asset gate — provenance, safety attestation, and pair honesty.
 *
 * Run before a deck built from real product captures leaves the team. It answers three questions
 * the topology and fidelity gates never asked: where did this image come from, has anyone checked
 * it for secrets, and do images captioned as two states actually differ?
 *
 * Usage:
 *   node scripts/nodeslide-asset-gate.mjs --pptx <deck.pptx> --manifest <embedded-assets.json>
 *                                         [--pairs <pairs.json>] [--json]
 * Exit 1 on any unprovenanced asset, missing secrets review, metadata leak, or identical pair.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { resolveSlideImagePairs, verifyEmbeddedAssets } from './lib/asset-provenance.mjs';

function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(token.slice(2), true);
      continue;
    }
    flags.set(token.slice(2), next);
    i += 1;
  }
  return flags;
}

const readJson = async (f) =>
  JSON.parse((await readFile(path.resolve(f), 'utf8')).replace(/^﻿/, ''));

const flags = parseArgs(process.argv.slice(2));
const pptxPath = flags.get('pptx');
const manifestPath = flags.get('manifest');
if (typeof pptxPath !== 'string' || typeof manifestPath !== 'string') {
  process.stderr.write('--pptx and --manifest are required.\n');
  process.exit(1);
}

const zip = await JSZip.loadAsync(await readFile(path.resolve(pptxPath)));
const manifest = await readJson(manifestPath);

const embedded = [];
for (const part of Object.keys(zip.files).filter((p) =>
  /^ppt\/media\/.+\.(png|jpe?g|gif)$/i.test(p),
)) {
  embedded.push({ part, buffer: await zip.file(part).async('nodebuffer') });
}

// Images a before/after archetype presents as two states, resolved from each slide's own
// relationships rather than from the writer's filename convention. See resolveSlideImagePairs.
const relsBySlide = {};
for (const relsPath of Object.keys(zip.files).filter((p) =>
  /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(p),
)) {
  relsBySlide[relsPath.match(/slide(\d+)\.xml\.rels$/)[1]] = await zip
    .file(relsPath)
    .async('string');
}
const pairs = resolveSlideImagePairs(relsBySlide);

const report = verifyEmbeddedAssets({ embedded, manifest, pairs });

if (flags.get('json') === true) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const lines = [
    `Embedded asset gate — ${path.basename(pptxPath)}`,
    `  embedded images   ${report.assets.length} (${new Set(report.assets.map((a) => a.sha256)).size} distinct)`,
    `  provenance+safety ${report.assets.length - report.failed} pass / ${report.failed} fail`,
    `  declared pairs    ${report.pairs.length - report.pairFailed} pass / ${report.pairFailed} fail`,
    `  pixel review      ${report.pixelReview}`,
  ];
  for (const a of report.assets.filter((x) => x.verdict === 'fail')) {
    lines.push('', `  FAIL ${a.part}  ${a.path ?? '(unknown source)'}`);
    for (const p of a.problems) lines.push(`    ${p}`);
  }
  for (const p of report.pairs.filter((x) => x.verdict === 'fail')) {
    lines.push('', `  FAIL ${p.label}`, `    ${p.detail}`);
  }
  if (report.flaggedForExternalPublication.length > 0) {
    lines.push('', '  Cleared for internal use, NOT for external publication:');
    for (const a of report.flaggedForExternalPublication) {
      lines.push(`    ${a.path}`, `      ${a.findings}`);
    }
  }
  if (report.verdict === 'pass') {
    lines.push('', '  Every embedded image resolves to a declared source with an attested review,');
    lines.push('  and every declared pair shows two genuinely different captures.');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exit(report.verdict === 'pass' ? 0 : 1);
