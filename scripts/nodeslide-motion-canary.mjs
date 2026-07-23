/**
 * Playback canary orchestrator — closes check H.
 *
 * Topology says the animation EXISTS. Only this says PowerPoint PLAYS it. The flow:
 *   1. locate each declared scene's slide (by its pinned object, same as the gate)
 *   2. drive a real PowerPoint runtime: start the slideshow, capture the initial frame, advance
 *      once per declared transition, capture each resulting frame
 *   3. hand the captured signatures back to the motion gate so H is decided by observation
 *
 * If no PowerPoint runtime exists, this exits 2 and says so. It never synthesizes captures —
 * a fabricated frame would make the one check that proves playback the easiest one to fake.
 *
 * Usage:
 *   node scripts/nodeslide-motion-canary.mjs --pptx <deck.pptx> --expect <motion-expectations.json>
 *                                            [--frames <dir>] [--out <captures.json>]
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

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

function runPowerShell(args) {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      err += d;
      // Never swallow the runtime's error: a silent canary failure is indistinguishable from a
      // canary that ran and found nothing.
      process.stderr.write(d);
    });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

const flags = parseArgs(process.argv.slice(2));
const pptxPath = flags.get('pptx');
const expectPath = flags.get('expect');
if (typeof pptxPath !== 'string' || typeof expectPath !== 'string') {
  process.stderr.write('--pptx and --expect are required.\n');
  process.exit(1);
}

// fileURLToPath, not manual URL surgery: a path containing a space arrives percent-encoded.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(
  typeof flags.get('out') === 'string'
    ? flags.get('out')
    : path.join(path.dirname(path.resolve(expectPath)), 'motion-playback-captures.json'),
);
const frameDir =
  typeof flags.get('frames') === 'string'
    ? path.resolve(flags.get('frames'))
    : path.join(path.dirname(outPath), 'playback-frames');

// 1. Resolve each scene to its slide by locating the pinned object — the same anchor the gate uses.
const zip = await JSZip.loadAsync(await readFile(path.resolve(pptxPath)));
const expectations = JSON.parse(await readFile(path.resolve(expectPath), 'utf8'));
const slidePaths = Object.keys(zip.files)
  .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

const scenes = [];
for (const scene of expectations.scenes ?? []) {
  for (const p of slidePaths) {
    const xml = await zip.file(p).async('string');
    if (!xml.includes(`name="${scene.pinnedObject}"`)) continue;
    scenes.push({
      sceneId: scene.sceneId,
      slide: Number(p.match(/(\d+)/)[1]),
      states: scene.states.length,
      // Normalised rectangles the canary measures per frame — this is what turns "five distinct
      // frames" into "frame N shows exactly states 0..N-1".
      regions: scene.states.map((s) => s.region).filter(Boolean),
    });
    break;
  }
}
if (scenes.length === 0) {
  process.stderr.write('No declared motion scenes were found in the deck.\n');
  process.exit(1);
}

await mkdir(path.dirname(outPath), { recursive: true });
const scenesPath = path.join(path.dirname(outPath), 'motion-canary-scenes.json');
await writeFile(scenesPath, `${JSON.stringify(scenes, null, 2)}\n`);

process.stdout.write(
  `Playing ${scenes.length} scene(s) in a real PowerPoint runtime: ${scenes
    .map((s) => `${s.sceneId}@slide${s.slide} (${s.states} states)`)
    .join(', ')}\n`,
);

// 2. Drive PowerPoint. This takes over the screen briefly — a slideshow needs a real window.
const { code } = await runPowerShell([
  '-File',
  path.join(scriptDir, 'nodeslide-motion-canary.ps1'),
  '-Pptx',
  path.resolve(pptxPath),
  '-ScenesJson',
  scenesPath,
  '-OutJson',
  outPath,
  '-FrameDir',
  frameDir,
]);

if (code !== 0) {
  process.stderr.write(
    `\nPowerPoint canary did not run (exit ${code}). H stays 'not-run': playback is unproven, not failed.\n`,
  );
  process.exit(2);
}

// 3. Report what was actually observed. Distinctness is the proof that advancing changed the screen.
const captures = JSON.parse(await readFile(outPath, 'utf8'));
const summary = Object.entries(captures).map(([sceneId, frames]) => {
  const distinct = new Set(frames.map((f) => f.signature)).size;
  return { sceneId, frames: frames.length, distinct, allDistinct: distinct === frames.length };
});
process.stdout.write(
  `\n${summary
    .map(
      (s) =>
        `  ${s.sceneId}: ${s.frames} frames, ${s.distinct} distinct ${s.allDistinct ? '(each advance changed the screen)' : '(FRAMES REPEATED — an advance changed nothing)'}`,
    )
    .join(
      '\n',
    )}\n\nCaptures: ${outPath}\nFrames:   ${frameDir}\nFeed to the gate with --captures to decide H.\n`,
);

process.exit(summary.every((s) => s.allDistinct) ? 0 : 1);
