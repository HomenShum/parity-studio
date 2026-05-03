// Procedural ambient bed for the demo trilogy.
//
// Synthesizes a chill C-major pad via ffmpeg's sine generator, layered
// with a low octave drone + light tremolo + soft lowpass + 2s fade
// in/out. ~120 BPM-compatible, -22 dB (well under UI feedback), 4
// minutes total. No external assets, no licensing, deterministic.
//
// Why procedural: free, instant, MIT-clear, no network. Good enough
// as understated bed music when the screen is doing all the work.
//
// Run:
//   node scripts/make-music.mjs              → runs/music/demo-bed-240s.m4a
// Optional:
//   DURATION_SEC=180 node scripts/make-music.mjs   shorter
//   OUTPUT=runs/music/foo.m4a node scripts/make-music.mjs

import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const DURATION = Number.parseInt(process.env.DURATION_SEC ?? '240', 10);
const OUTPUT = process.env.OUTPUT ?? join(repoRoot, 'runs', 'music', `demo-bed-${DURATION}s.m4a`);

async function main() {
  await mkdir(dirname(OUTPUT), { recursive: true });
  console.log(`[music] generating ${DURATION}s ambient pad → ${OUTPUT}`);

  // Notes: C major triad voicing (low + mid). Frequencies in Hz.
  // C2  C3  G3   E4    G4    C5
  // 65  131 196  329   392   523
  //
  // Tremolo on the high voice (2 Hz, 8% depth) for life.
  // Apply a bell-curve volume swell over the full duration to keep
  // openings/closings calm.
  const fadeOutStart = Math.max(0, DURATION - 4);
  const filter = [
    // Low drone (root + fifth, octave below)
    `sine=f=65.41:duration=${DURATION}:sample_rate=44100[c2]`,
    `sine=f=98.00:duration=${DURATION}:sample_rate=44100[g2]`,
    // Mid pad (root + fifth)
    `sine=f=130.81:duration=${DURATION}:sample_rate=44100[c3]`,
    `sine=f=196.00:duration=${DURATION}:sample_rate=44100[g3]`,
    // High pad (third + fifth + root octave)
    `sine=f=329.63:duration=${DURATION}:sample_rate=44100[e4]`,
    `sine=f=392.00:duration=${DURATION}:sample_rate=44100[g4]`,
    `sine=f=523.25:duration=${DURATION}:sample_rate=44100[c5]`,

    // Mix low octave (drone)
    '[c2][g2]amix=inputs=2:weights=1.0 0.7:duration=longest[low]',
    // Mix mid pad
    '[c3][g3]amix=inputs=2:weights=0.7 0.5:duration=longest[mid]',
    // Mix high pad with light tremolo
    '[e4][g4][c5]amix=inputs=3:weights=0.4 0.4 0.5:duration=longest,tremolo=f=2:d=0.08[high]',

    // Sum, soften with lowpass + slight reverb-style high-shelf cut
    `[low][mid][high]amix=inputs=3:weights=2.0 1.2 0.8:duration=longest,lowpass=f=1400,highshelf=f=2000:g=-6,volume=-22dB,afade=t=in:st=0:d=3,afade=t=out:st=${fadeOutStart}:d=4[out]`,
  ].join(';');

  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-filter_complex',
      filter,
      '-map',
      '[out]',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-t',
      String(DURATION),
      OUTPUT,
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error('[music] ffmpeg failed');
    process.exit(r.status ?? 1);
  }
  console.log(`[music] done → ${OUTPUT}`);
}

main().catch((err) => {
  console.error('[music] fatal:', err);
  process.exit(1);
});
