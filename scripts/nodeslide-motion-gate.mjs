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

const slidePaths = Object.keys(zip.files)
  .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

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
