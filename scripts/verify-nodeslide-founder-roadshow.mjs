#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  REQUIRED_ROADSHOW_SCENES,
  ROADSHOW_EVIDENCE_SCHEMA,
  ROADSHOW_VIDEO,
} from './nodeslide-founder-roadshow-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const evidencePath = resolve(args.evidence ?? '');

if (!args.evidence) {
  console.error(
    'Usage: node scripts/verify-nodeslide-founder-roadshow.mjs --evidence <run-dir>/evidence.json',
  );
  process.exit(2);
}

await main();

async function main() {
  const runDir = dirname(evidencePath);
  const reportPath = resolve(runDir, 'verification.json');
  const report = {
    schema: 'nodeslide-roadshow-verification/v1',
    createdAt: new Date().toISOString(),
    evidencePath,
    checks: [],
    verdict: 'failed',
  };

  try {
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    check(report, evidence.schema === ROADSHOW_EVIDENCE_SCHEMA, 'evidence schema', {
      actual: evidence.schema,
    });
    check(report, evidence.verdict === 'passed', 'recorder verdict is passed', {
      actual: evidence.verdict,
    });
    check(report, evidence.productStateSynthetic === false, 'product state is not synthetic');
    check(
      report,
      JSON.stringify(evidence.syntheticOverlays) ===
        JSON.stringify(['browser chrome', 'animated cursor', 'scene captions']),
      'only permitted overlays are declared',
      { actual: evidence.syntheticOverlays },
    );
    check(report, (evidence.pendingHooks ?? []).length === 0, 'no required hook remains pending', {
      pendingHooks: evidence.pendingHooks,
    });

    const sceneIds = (evidence.scenes ?? []).map((scene) => scene.id);
    check(
      report,
      JSON.stringify(sceneIds) === JSON.stringify(REQUIRED_ROADSHOW_SCENES),
      'all required scenes ran once and in order',
      { sceneIds },
    );
    check(
      report,
      (evidence.scenes ?? []).every((scene) => scene.status === 'passed'),
      'every required scene passed',
    );

    const finalMp4 = resolve(evidence.outputs?.finalMp4 ?? '');
    const srt = resolve(evidence.outputs?.srt ?? '');
    const [videoStats, srtStats] = await Promise.all([stat(finalMp4), stat(srt)]);
    check(report, videoStats.isFile() && videoStats.size > 1_000_000, 'final MP4 is non-trivial', {
      bytes: videoStats.size,
    });
    check(report, srtStats.isFile() && srtStats.size > 200, 'SRT exists and is non-trivial', {
      bytes: srtStats.size,
    });
    check(
      report,
      (await sha256File(finalMp4)) === evidence.outputs.finalSha256,
      'final MP4 SHA-256 matches recorder evidence',
    );

    const media = probeMedia(finalMp4);
    const videoStream = media.streams.find((stream) => stream.codec_type === 'video');
    check(
      report,
      videoStream?.width === ROADSHOW_VIDEO.width && videoStream?.height === ROADSHOW_VIDEO.height,
      'final video is 1920×1080',
      { width: videoStream?.width, height: videoStream?.height },
    );
    const duration = Number.parseFloat(media.format?.duration ?? '0');
    check(report, duration > 30, 'final video has a plausible continuous duration', { duration });
    check(
      report,
      Math.abs(duration - Number(evidence.outputs.finalDurationSeconds)) < 0.2,
      'ffprobe duration matches recorder evidence',
      { duration, recorded: evidence.outputs.finalDurationSeconds },
    );

    const srtText = await readFile(srt, 'utf8');
    const srtBlocks = srtText.trim().split(/\r?\n\r?\n/);
    check(
      report,
      srtBlocks.length === REQUIRED_ROADSHOW_SCENES.length,
      'SRT contains one caption block per required scene',
      { count: srtBlocks.length },
    );
    for (const sceneId of REQUIRED_ROADSHOW_SCENES) {
      const caption = evidence.captions?.find((item) => item.sceneId === sceneId);
      check(report, Boolean(caption), `caption evidence exists for ${sceneId}`);
    }

    for (const download of evidence.downloads ?? []) {
      const downloadPath = resolve(download.path);
      const downloadStats = await stat(downloadPath);
      check(
        report,
        downloadStats.size === download.bytes,
        `${download.format} byte count matches`,
        {
          bytes: downloadStats.size,
        },
      );
      check(
        report,
        (await sha256File(downloadPath)) === download.sha256,
        `${download.format} SHA-256 matches`,
      );
      if (download.format === 'PowerPoint') {
        const header = (await readFile(downloadPath)).subarray(0, 2).toString('ascii');
        check(report, header === 'PK', 'PowerPoint export is an OOXML ZIP container');
      }
      if (download.format === 'Deck JSON') {
        JSON.parse(await readFile(downloadPath, 'utf8'));
        check(report, true, 'Deck JSON export parses');
      }
    }
    check(
      report,
      new Set((evidence.downloads ?? []).map((item) => item.format)).has('PowerPoint') &&
        new Set((evidence.downloads ?? []).map((item) => item.format)).has('Deck JSON'),
      'both PowerPoint and Deck JSON exports are evidenced',
    );

    const framesDir = resolve(runDir, 'verification-frames');
    await mkdir(framesDir, { recursive: true });
    const contactSheet = resolve(framesDir, 'contact-sheet-%02d.png');
    const frames = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-i',
        finalMp4,
        '-vf',
        'fps=1/30,scale=480:-1,tile=4x3:padding=4:margin=4',
        '-vsync',
        'vfr',
        contactSheet,
      ],
      { encoding: 'utf8' },
    );
    check(report, frames.status === 0, 'ffmpeg generated visual contact sheets', {
      outputPattern: contactSheet,
    });

    report.verdict = 'passed';
    report.completedAt = new Date().toISOString();
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[roadshow:verify] PASS: ${finalMp4}`);
    console.log(`[roadshow:verify] report: ${reportPath}`);
  } catch (error) {
    report.failure = { name: error.name, message: error.message };
    report.completedAt = new Date().toISOString();
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {});
    console.error(`[roadshow:verify] FAIL: ${error.message}`);
    console.error(`[roadshow:verify] report: ${reportPath}`);
    process.exitCode = 1;
  }
}

function check(report, passed, label, details = {}) {
  report.checks.push({ label, passed: Boolean(passed), ...details });
  if (!passed) throw new Error(`Verification failed: ${label}`);
}

function probeMedia(path) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path}`);
  return JSON.parse(result.stdout);
}

async function sha256File(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--evidence') parsed.evidence = values[++index];
    else if (value === '--help' || value === '-h') {
      console.log(
        'Usage: node scripts/verify-nodeslide-founder-roadshow.mjs --evidence <run-dir>/evidence.json',
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}
