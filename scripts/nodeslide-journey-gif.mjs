import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function createNodeSlideJourneyGif({ input, output, width = 960, fps = 12 }) {
  const source = path.resolve(input);
  const target = path.resolve(output);
  const temporary = await mkdtemp(path.join(tmpdir(), 'nodeslide-journey-gif-'));
  const palette = path.join(temporary, 'palette.png');
  try {
    run([
      '-y',
      '-i',
      source,
      '-vf',
      `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`,
      palette,
    ]);
    run([
      '-y',
      '-i',
      source,
      '-i',
      palette,
      '-filter_complex',
      `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop',
      '0',
      target,
    ]);
    return target;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function run(args) {
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited with status ${result.status}.`);
}

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const outputIndex = args.indexOf('--output');
if (inputIndex >= 0 || outputIndex >= 0) {
  const input = args[inputIndex + 1];
  const output = args[outputIndex + 1];
  if (!input || !output)
    throw new Error('Usage: node scripts/nodeslide-journey-gif.mjs --input <video> --output <gif>');
  await createNodeSlideJourneyGif({ input, output });
  process.stdout.write(`${output}\n`);
}
