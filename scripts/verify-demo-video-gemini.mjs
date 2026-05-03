#!/usr/bin/env node
// Verify that a demo MP4 visibly demonstrates the README's 6-step flow.
//
// Local checks validate the recorder evidence. Gemini video understanding then
// analyzes the composed MP4 and returns strict JSON. This uses the Gemini Files
// API so large README videos are handled correctly.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const videoPath = resolve(process.argv[2] ?? '');
const evidencePath = process.argv[3] ? resolve(process.argv[3]) : null;
const model = process.env.GEMINI_VIDEO_MODEL ?? 'gemini-2.5-flash';
const deployment = process.env.CONVEX_DEPLOYMENT_FOR_ENV ?? 'blissful-pig-998';

if (!videoPath || !existsSync(videoPath)) {
  console.error('usage: node scripts/verify-demo-video-gemini.mjs <video.mp4> [evidence.json]');
  process.exit(2);
}

function parseDotEnv(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function readApiKeyFromLocalEnv() {
  for (const name of ['.env.local', '.env.prod.local', '.env']) {
    const path = join(repoRoot, name);
    if (!existsSync(path)) continue;
    const vars = parseDotEnv(await readFile(path, 'utf8'));
    if (vars.GEMINI_API_KEY) return vars.GEMINI_API_KEY;
  }
  return null;
}

function readApiKeyFromConvexEnv() {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const args =
    process.platform === 'win32'
      ? ['/c', 'npx', 'convex', 'env', 'get', 'GEMINI_API_KEY', '--deployment', deployment]
      : ['convex', 'env', 'get', 'GEMINI_API_KEY', '--deployment', deployment];
  const r = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (r.status !== 0) return null;
  const key = (r.stdout ?? '').trim();
  return key || null;
}

async function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const local = await readApiKeyFromLocalEnv();
  if (local) return local;
  return readApiKeyFromConvexEnv();
}

async function probeDuration(file) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return null;
  const n = Number.parseFloat((r.stdout ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

async function localChecks() {
  const s = await stat(videoPath);
  const durationSec = await probeDuration(videoPath);
  const checks = {
    videoExists: s.size > 0,
    videoSizeBytes: s.size,
    durationSec,
    durationOk: durationSec !== null && durationSec >= 20 && durationSec <= 120,
    evidenceOk: true,
    evidenceFailures: [],
  };
  if (evidencePath) {
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    const required = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'];
    for (const key of required) {
      if (!evidence.checks?.[key]?.ok) checks.evidenceFailures.push(key);
    }
    if (!evidence.runId) checks.evidenceFailures.push('runId');
    if ((evidence.checks?.generated?.fileCount ?? 0) < 2)
      checks.evidenceFailures.push('generated.fileCount');
    checks.evidenceOk = checks.evidenceFailures.length === 0;
    checks.runId = evidence.runId;
  }
  return checks;
}

async function startGeminiUpload(apiKey, sizeBytes) {
  const res = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(sizeBytes),
      'X-Goog-Upload-Header-Content-Type': 'video/mp4',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: basename(videoPath) } }),
  });
  if (!res.ok) throw new Error(`Gemini upload start failed: ${res.status} ${await res.text()}`);
  const uploadUrl = res.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini upload start response missing x-goog-upload-url');
  return uploadUrl;
}

async function finishGeminiUpload(uploadUrl, bytes) {
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Gemini upload finalize failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function waitForGeminiFile(apiKey, fileName) {
  for (let i = 0; i < 30; i += 1) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!res.ok) throw new Error(`Gemini file poll failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    if (json.file?.state === 'ACTIVE' || json.state === 'ACTIVE') return json.file ?? json;
    if (json.file?.state === 'FAILED' || json.state === 'FAILED') {
      throw new Error(`Gemini file processing failed: ${JSON.stringify(json)}`);
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 4_000));
  }
  throw new Error('Gemini file did not become ACTIVE in time');
}

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

async function geminiAnalyze(apiKey, file) {
  const prompt = `
You are reviewing a GitHub README demo video for Parity Studio.

The README promises a six-step user flow:
1. Drop/source a gpt-image-2 image, canonical ui_kit zip, or generate from a prompt.
2. Break it down into individual UI components / ui_kit files with parity verification.
3. Select a component in the file tree.
4. Comment on that component or pinned preview region.
5. Iterate/edit the scoped slice, not the whole artifact.
6. Export as a ui_kit ZIP for coding-agent handoff.

Judge the video as a README hero demo similar in spirit to Open CoDesign's concise "See it generate" GIF: clear, focused, no unrelated terminal/MCP detours, and visually understandable without audio.

Return only strict JSON with this schema:
{
  "pass": boolean,
  "score": number,
  "durationAssessment": "too_short" | "good" | "too_long",
  "steps": {
    "step1_source_or_prompt": {"visible": boolean, "timestamp": string, "reason": string},
    "step2_decompose_verify": {"visible": boolean, "timestamp": string, "reason": string},
    "step3_select_component": {"visible": boolean, "timestamp": string, "reason": string},
    "step4_comment": {"visible": boolean, "timestamp": string, "reason": string},
    "step5_iterate_scoped": {"visible": boolean, "timestamp": string, "reason": string},
    "step6_export_zip": {"visible": boolean, "timestamp": string, "reason": string}
  },
  "readmeFit": {"visibleAtAGlance": boolean, "notDistracting": boolean, "reason": string},
  "blockingIssues": string[],
  "recommendedFixes": string[]
}

Pass only if every step is visible and the video is coherent as a README demo.
For Step 4, the bbox/comment must be placed on a meaningful UI element, not a random blank area or generic region.
Prefer a click-to-pin interaction on a visible element over a hand-drawn generic rectangle.
For Step 5, the demo must show the real chat/agent surface working on the scoped comment: an advisor/executor plan, tool calls, or visibly growing chat transcript. Do not pass a manual token tweak as a substitute for agent iteration.
`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                file_data: {
                  mime_type: file.mimeType ?? 'video/mp4',
                  file_uri: file.uri,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini analysis failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
  if (!text.trim())
    throw new Error(`Gemini response missing text: ${JSON.stringify(json).slice(0, 1000)}`);
  return extractJson(text);
}

async function main() {
  const checks = await localChecks();
  if (!checks.videoExists || !checks.durationOk || !checks.evidenceOk) {
    console.error(JSON.stringify({ localChecks: checks }, null, 2));
    process.exit(1);
  }

  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    console.error('GEMINI_API_KEY not found in process env, local env files, or Convex env.');
    process.exit(2);
  }

  const bytes = await readFile(videoPath);
  const uploadUrl = await startGeminiUpload(apiKey, bytes.length);
  const upload = await finishGeminiUpload(uploadUrl, bytes);
  const activeFile = await waitForGeminiFile(apiKey, upload.file?.name ?? upload.name);
  const analysis = await geminiAnalyze(apiKey, activeFile);

  const report = {
    video: videoPath,
    evidence: evidencePath,
    model,
    localChecks: checks,
    gemini: analysis,
  };
  const reportPath = videoPath.replace(/\.mp4$/i, '.gemini-verification.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  const allVisible = Object.values(analysis.steps ?? {}).every((step) => step?.visible === true);
  if (!analysis.pass || !allVisible || analysis.readmeFit?.visibleAtAGlance !== true) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[verify-demo] fatal:', err);
  process.exit(1);
});
