// Stitch the 3 scenes into a single MP4.
//
// Picks the most recent recording from each scene's output dir
// (recording-shell-*, recording-iterate-*, recording-mcp-*) under
// runs/, and concatenates them via ffmpeg with a 600ms crossfade
// between each cut.
//
// Run:
//   node scripts/stitch-demo.mjs
// Optional:
//   SHELL_MP4=...  ITERATE_MP4=...  MCP_MP4=...   override picks
//   OUTPUT=runs/demo-2026-04-29.mp4               output path
//   NO_CROSSFADE=1                                hard cuts (faster)

import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const runsDir = resolve(repoRoot, 'runs');

async function pickLatest(prefix) {
  const entries = await readdir(runsDir).catch(() => []);
  const candidates = entries.filter((e) => e.startsWith(prefix));
  if (candidates.length === 0) return null;
  // Sort by mtime desc.
  const stats = await Promise.all(
    candidates.map(async (e) => {
      const p = join(runsDir, e);
      const s = await stat(p).catch(() => null);
      return { path: p, name: e, mtime: s ? s.mtimeMs : 0 };
    }),
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  for (const s of stats) {
    const mp4 = join(s.path, 'recording.mp4');
    if (existsSync(mp4)) return mp4;
    const webm = join(s.path, 'recording.webm');
    if (existsSync(webm)) return webm;
  }
  return null;
}

async function probeDuration(file) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return null;
  const v = parseFloat((r.stdout || '').trim());
  return Number.isFinite(v) ? v : null;
}

async function main() {
  const shell = process.env.SHELL_MP4 ?? (await pickLatest('recording-shell-'));
  const iterate = process.env.ITERATE_MP4 ?? (await pickLatest('recording-iterate-'));
  const mcp = process.env.MCP_MP4 ?? (await pickLatest('recording-mcp-'));

  const missing = [];
  if (!shell) missing.push('shell (record-end-to-end.mjs)');
  if (!iterate) missing.push('iterate (record-scene-iterate.mjs)');
  if (!mcp) missing.push('mcp (record-scene-mcp.mjs)');
  if (missing.length > 0) {
    console.error('error: missing recordings:', missing.join(', '));
    console.error('  run the scene scripts first, then re-run stitch.');
    process.exit(2);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const out = process.env.OUTPUT ?? join(runsDir, `demo-${stamp}.mp4`);
  console.log(`[stitch] shell:   ${shell}`);
  console.log(`[stitch] iterate: ${iterate}`);
  console.log(`[stitch] mcp:     ${mcp}`);
  console.log(`[stitch] output:  ${out}`);

  if (process.env.NO_CROSSFADE) {
    // Simple concat. Re-encode for stream-format consistency.
    const r = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-i', shell,
        '-i', iterate,
        '-i', mcp,
        '-filter_complex',
        '[0:v]scale=1680:900,setsar=1[v0];' +
          '[1:v]scale=1680:900,setsar=1[v1];' +
          '[2:v]scale=1680:900,setsar=1[v2];' +
          '[v0][v1][v2]concat=n=3:v=1[outv]',
        '-map', '[outv]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-an',
        out,
      ],
      { stdio: 'inherit' },
    );
    if (r.status === 0) console.log(`[stitch] done → ${out}`);
    else process.exit(r.status ?? 1);
    return;
  }

  // Crossfade: needs durations to compute offsets.
  const dShell = await probeDuration(shell);
  const dIter = await probeDuration(iterate);
  if (dShell === null || dIter === null) {
    console.error('error: ffprobe failed; rerun with NO_CROSSFADE=1 for hard cuts');
    process.exit(3);
  }
  const fadeMs = 600;
  const fade = fadeMs / 1000;
  const off1 = Math.max(0, dShell - fade);
  const off2 = Math.max(0, dShell + dIter - 2 * fade);

  console.log(`[stitch] shell ${dShell.toFixed(2)}s + iterate ${dIter.toFixed(2)}s + mcp = ?`);
  console.log(`[stitch] xfade offsets: ${off1.toFixed(2)}s, ${off2.toFixed(2)}s · duration ${fade}s`);

  const filter =
    `[0:v]scale=1680:900,setsar=1,fps=30[v0];` +
    `[1:v]scale=1680:900,setsar=1,fps=30[v1];` +
    `[2:v]scale=1680:900,setsar=1,fps=30[v2];` +
    `[v0][v1]xfade=transition=fade:duration=${fade}:offset=${off1.toFixed(3)}[v01];` +
    `[v01][v2]xfade=transition=fade:duration=${fade}:offset=${off2.toFixed(3)}[outv]`;

  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i', shell,
      '-i', iterate,
      '-i', mcp,
      '-filter_complex', filter,
      '-map', '[outv]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-an',
      out,
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error('[stitch] ffmpeg failed; try NO_CROSSFADE=1 for plain concat');
    process.exit(r.status ?? 1);
  }
  console.log(`[stitch] done → ${out}`);
}

main().catch((err) => {
  console.error('[stitch] fatal:', err);
  process.exit(1);
});
