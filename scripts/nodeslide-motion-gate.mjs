/**
 * Motion scene gate runner.
 *
 * Verifies every declared motion scene in a deck against checks A..H (scripts/lib/motion-gate.mjs)
 * and reports topology and runtime playback as SEPARATE verdicts — because valid OOXML proves the
 * animation exists, not that PowerPoint plays it.
 *
 * Usage:
 *   node scripts/nodeslide-motion-gate.mjs --pptx <deck.pptx> --expect <motion-expectations.json>
 *                                          [--captures <playback-canary.json>] [--json]
 *
 * Exit 1 when any scene's topology fails. A `not-run` playback does NOT fail the gate — it is
 * reported honestly as indeterminate for native playback.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { verifyMotionScene } from './lib/motion-gate.mjs';
import { deriveMotionOracle, reconcileMotionManifest } from './lib/motion-oracle.mjs';

function parseArgs(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(token.slice(2), true);
      continue;
    }
    flags.set(token.slice(2), next);
    index += 1;
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const pptxPath = flags.get('pptx');
const expectPath = flags.get('expect');
if (typeof pptxPath !== 'string' || typeof expectPath !== 'string') {
  process.stderr.write(
    '--pptx <deck.pptx> and --expect <motion-expectations.json> are required.\n',
  );
  process.exit(1);
}

/** Windows tooling writes UTF-8 with a BOM, which JSON.parse rejects. Strip it defensively. */
async function readJson(file) {
  return JSON.parse((await readFile(path.resolve(file), 'utf8')).replace(/^﻿/, ''));
}

const zip = await JSZip.loadAsync(await readFile(path.resolve(pptxPath)));
const expectations = await readJson(expectPath);
const captures =
  typeof flags.get('captures') === 'string' ? await readJson(flags.get('captures')) : null;

/**
 * Reconcile the compiler's manifest against the canonical fixtures BEFORE judging anything.
 *
 * Check D compares the emitted OOXML with `motion-expectations.json`, and the compiler writes that
 * file from the same objects it used to name the shapes — so detector and compiler agree by
 * construction, and a scene miscompiled consistently passes. The canonical atlas is the only
 * description of these scenes the compiler did not author.
 *
 * Optional flag rather than required, because the gate must stay runnable against a deck whose
 * fixtures are not to hand. When it IS supplied and disagrees, that is fatal: judging the OOXML
 * against an expectation already known to be wrong produces a verdict about nothing.
 */
let oracleReport = null;
if (typeof flags.get('canonical') === 'string') {
  const canonical = await readJson(flags.get('canonical'));
  oracleReport = reconcileMotionManifest(
    deriveMotionOracle(canonical.fixtures ?? []),
    expectations,
  );
  if (oracleReport.verdict === 'disagree') {
    process.stderr.write(
      `Motion manifest disagrees with the canonical fixtures — refusing to judge the deck against an expectation the compiler wrote for itself:\n${oracleReport.problems.map((p) => `  ${p}`).join('\n')}\n`,
    );
    process.exit(1);
  }
}

const slidePaths = Object.keys(zip.files)
  .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

// Slide dimensions, so G can check the pinned object is VISIBLE rather than merely un-animated.
// Without these it reports honestly that visibility went unchecked.
const presentationFile = zip.file('ppt/presentation.xml');
const sldSz = presentationFile
  ? /<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/.exec(await presentationFile.async('string'))
  : null;
const slideSize = sldSz ? { cx: Number(sldSz[1]), cy: Number(sldSz[2]) } : null;

const results = [];
for (const scene of expectations.scenes ?? []) {
  // Find the slide that actually carries this scene's pinned object.
  let sceneXml = null;
  let slideNumber = null;
  for (const p of slidePaths) {
    const xml = await zip.file(p).async('string');
    if (xml.includes(`name="${scene.pinnedObject}"`)) {
      sceneXml = xml;
      slideNumber = Number(p.match(/(\d+)/)[1]);
      break;
    }
  }
  if (!sceneXml) {
    results.push({
      sceneId: scene.sceneId,
      topology: 'fail',
      runtimePlayback: 'not-run',
      overall: 'fail',
      checks: { A_timingTopology: { pass: false, detail: 'no slide carries this scene' } },
    });
    continue;
  }
  results.push({
    slide: slideNumber,
    ...verifyMotionScene({
      xml: sceneXml,
      expectation: scene,
      runtimeCaptures: captures?.[scene.sceneId] ?? null,
      slideSize,
    }),
  });
}

const failed = results.filter((r) => r.topology === 'fail');

if (flags.get('json') === true) {
  process.stdout.write(`${JSON.stringify({ scenes: results, failed: failed.length }, null, 2)}\n`);
} else {
  const lines = [`Motion scene gate — ${path.basename(pptxPath)}`, `  scenes ${results.length}`];
  for (const r of results) {
    lines.push('');
    lines.push(`  ${r.sceneId} (slide ${r.slide ?? '?'}) — declared "${r.declaredTransition}"`);
    lines.push(`    topology         ${r.topology}`);
    lines.push(`    runtime playback ${r.runtimePlayback}`);
    lines.push(`    overall          ${r.overall}`);
    for (const [name, check] of Object.entries(r.checks)) {
      lines.push(`      ${check.pass ? 'PASS' : 'FAIL'} ${name.padEnd(26)} ${check.detail}`);
    }
  }
  if (results.some((r) => r.runtimePlayback === 'not-run')) {
    lines.push('');
    lines.push('  Valid OOXML proves the animation EXISTS, not that PowerPoint plays it.');
    lines.push('  Supply --captures from a real playback canary to close H.');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exit(failed.length > 0 ? 1 : 0);
