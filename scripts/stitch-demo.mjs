// Stitch the 3 scenes into a single fast-play demo (gif-style).
//
// Picks the most recent recording from each scene's output dir
// (recording-shell-*, recording-iterate-*, recording-mcp-*) under
// runs/, applies per-scene speed-up, and concatenates them via
// ffmpeg with a 600ms crossfade between each cut.
//
// Default speed-ups (gif-like quick demo, no audio):
//   SHELL_SPEED=6        (9:27 → 1:35)
//   ITERATE_SPEED=2.5    (2:30 → 1:00)
//   MCP_SPEED=1.2        (0:24 → 0:20)
//
// Music: if MUSIC=path or MUSIC=auto, mixes a bed underneath. Off by
// default for sped-up output (atempo doesn't time-stretch cleanly past
// 2x, and fast-play music sounds weird against pad ambient).
//
// GIF=1 also produces a .gif sibling at GIF_WIDTH (default 960) using
// ffmpeg's palettegen+paletteuse for sharp text rendering.
//
// Run:
//   node scripts/stitch-demo.mjs                   default 6x/2.5x/1.2x
//   GIF=1 node scripts/stitch-demo.mjs             also write .gif
//   SHELL_SPEED=8 ITERATE_SPEED=3 node scripts/stitch-demo.mjs
//   MUSIC=auto SHELL_SPEED=1 node scripts/stitch-demo.mjs   un-sped
//
// Optional:
//   SHELL_MP4=…  ITERATE_MP4=…  MCP_MP4=…          override picks
//   OUTPUT=runs/demo-2026-04-29.mp4                output path
//   NO_CROSSFADE=1                                 hard cuts (faster)
//   GIF=1   GIF_WIDTH=720                          also write .gif

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
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
  const v = Number.parseFloat((r.stdout || '').trim());
  return Number.isFinite(v) ? v : null;
}

async function pickLatestMusic() {
  const musicDir = join(runsDir, 'music');
  const entries = await readdir(musicDir).catch(() => []);
  const audios = entries.filter((e) => /\.(m4a|mp3|aac|wav)$/i.test(e));
  if (audios.length === 0) return null;
  const stats = await Promise.all(
    audios.map(async (e) => {
      const p = join(musicDir, e);
      const s = await stat(p).catch(() => null);
      return { path: p, mtime: s ? s.mtimeMs : 0 };
    }),
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  return stats[0]?.path ?? null;
}

async function main() {
  const shell = process.env.SHELL_MP4 ?? (await pickLatest('recording-shell-'));
  const iterate = process.env.ITERATE_MP4 ?? (await pickLatest('recording-iterate-'));
  const mcp = process.env.MCP_MP4 ?? (await pickLatest('recording-mcp-'));
  let music = process.env.MUSIC ?? null;
  if (music === 'auto') music = await pickLatestMusic();

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
  console.log(`[stitch] music:   ${music ?? '(none)'}`);
  console.log(`[stitch] output:  ${out}`);

  if (process.env.NO_CROSSFADE) {
    // Simple concat. Re-encode for stream-format consistency.
    const args = ['-y', '-i', shell, '-i', iterate, '-i', mcp];
    let filter =
      '[0:v]scale=1680:900,setsar=1[v0];' +
      '[1:v]scale=1680:900,setsar=1[v1];' +
      '[2:v]scale=1680:900,setsar=1[v2];' +
      '[v0][v1][v2]concat=n=3:v=1[outv]';
    if (music) {
      args.push('-stream_loop', '-1', '-i', music);
      filter += ';[3:a]afade=t=out:st=999:d=2,volume=1.0[outa]';
    }
    args.push('-filter_complex', filter, '-map', '[outv]');
    if (music) args.push('-map', '[outa]', '-shortest', '-c:a', 'aac', '-b:a', '128k');
    else args.push('-an');
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', out);
    const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
    if (r.status === 0) console.log(`[stitch] done → ${out}`);
    else process.exit(r.status ?? 1);
    return;
  }

  // Crossfade: needs durations to compute offsets.
  const rawShell = await probeDuration(shell);
  const rawIter = await probeDuration(iterate);
  const rawMcp = await probeDuration(mcp);
  if (rawShell === null || rawIter === null || rawMcp === null) {
    console.error('error: ffprobe failed; rerun with NO_CROSSFADE=1 for hard cuts');
    process.exit(3);
  }

  // Per-scene speed-up via setpts=PTS/N (gif-like fast play).
  // Default 6x for the long pipeline scene, 2.5x for iterate, ~1x for mcp.
  const shellSpeed = Number.parseFloat(process.env.SHELL_SPEED ?? '6');
  const iterSpeed = Number.parseFloat(process.env.ITERATE_SPEED ?? '2.5');
  const mcpSpeed = Number.parseFloat(process.env.MCP_SPEED ?? '1.2');

  // Effective post-speed-up durations.
  const dShell = rawShell / shellSpeed;
  const dIter = rawIter / iterSpeed;
  const dMcp = rawMcp / mcpSpeed;

  const fadeMs = 600;
  const fade = fadeMs / 1000;
  const off1 = Math.max(0, dShell - fade);
  const off2 = Math.max(0, dShell + dIter - 2 * fade);
  const totalDuration = dShell + dIter + dMcp - 2 * fade;

  const isSpedUp = shellSpeed !== 1 || iterSpeed !== 1 || mcpSpeed !== 1;
  if (music && isSpedUp) {
    console.log('[stitch] note: speed > 1, dropping music (sped-up audio sounds weird)');
    music = null;
  }

  console.log(
    `[stitch] shell ${rawShell.toFixed(0)}s @ ${shellSpeed}x = ${dShell.toFixed(1)}s | ` +
      `iterate ${rawIter.toFixed(0)}s @ ${iterSpeed}x = ${dIter.toFixed(1)}s | ` +
      `mcp ${rawMcp.toFixed(0)}s @ ${mcpSpeed}x = ${dMcp.toFixed(1)}s`,
  );
  console.log(`[stitch] total ≈ ${totalDuration.toFixed(1)}s · xfade ${fade}s`);

  // setpts=PTS/N speeds up the stream by factor N. Apply BEFORE scale +
  // fps so the framerate normalization sees the new pacing.
  let filter =
    `[0:v]setpts=PTS/${shellSpeed},scale=1680:900,setsar=1,fps=30[v0];` +
    `[1:v]setpts=PTS/${iterSpeed},scale=1680:900,setsar=1,fps=30[v1];` +
    `[2:v]setpts=PTS/${mcpSpeed},scale=1680:900,setsar=1,fps=30[v2];` +
    `[v0][v1]xfade=transition=fade:duration=${fade}:offset=${off1.toFixed(3)}[v01];` +
    `[v01][v2]xfade=transition=fade:duration=${fade}:offset=${off2.toFixed(3)}[outv]`;

  const args = ['-y', '-i', shell, '-i', iterate, '-i', mcp];

  if (music) {
    args.push('-stream_loop', '-1', '-i', music);
    // Trim audio to total duration with 2s fade-out at the end.
    const fadeOutStart = Math.max(0, totalDuration - 2);
    filter +=
      `;[3:a]atrim=duration=${totalDuration.toFixed(3)},` +
      `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=2[outa]`;
  }

  args.push('-filter_complex', filter, '-map', '[outv]');
  if (music) args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '128k');
  else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', out);

  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('[stitch] ffmpeg failed; try NO_CROSSFADE=1 for plain concat');
    process.exit(r.status ?? 1);
  }
  console.log(`[stitch] done → ${out}`);

  // Optional GIF output via palettegen+paletteuse for sharp text.
  if (process.env.GIF) {
    const gifWidth = Number.parseInt(process.env.GIF_WIDTH ?? '960', 10);
    const gifPath = out.replace(/\.mp4$/i, '.gif');
    const palettePath = out.replace(/\.mp4$/i, '.palette.png');
    console.log(`[stitch] writing gif → ${gifPath} (width ${gifWidth}, 18 fps)`);
    const palR = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-i',
        out,
        '-vf',
        `fps=18,scale=${gifWidth}:-1:flags=lanczos,palettegen=stats_mode=diff`,
        palettePath,
      ],
      { stdio: 'inherit' },
    );
    if (palR.status !== 0) {
      console.error('[stitch] palettegen failed; skipping gif');
    } else {
      const gifR = spawnSync(
        'ffmpeg',
        [
          '-y',
          '-i',
          out,
          '-i',
          palettePath,
          '-filter_complex',
          `fps=18,scale=${gifWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
          '-loop',
          '0',
          gifPath,
        ],
        { stdio: 'inherit' },
      );
      if (gifR.status !== 0) {
        console.error('[stitch] paletteuse failed; gif not produced');
      } else {
        console.log(`[stitch] gif → ${gifPath}`);
      }
    }
  }
}

main().catch((err) => {
  console.error('[stitch] fatal:', err);
  process.exit(1);
});
