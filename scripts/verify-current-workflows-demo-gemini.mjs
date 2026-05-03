#!/usr/bin/env node
// Gemini video verification for the current-workflows README/release demo.

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
  console.error(
    'usage: node scripts/verify-current-workflows-demo-gemini.mjs <video.mp4> [evidence.json]',
  );
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
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').trim() || null;
}

async function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const local = await readApiKeyFromLocalEnv();
  if (local) return local;
  return readApiKeyFromConvexEnv();
}

async function probeDuration(file) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) return null;
  const value = Number.parseFloat((result.stdout ?? '').trim());
  return Number.isFinite(value) ? value : null;
}

async function localChecks() {
  const fileStat = await stat(videoPath);
  const durationSec = await probeDuration(videoPath);
  const checks = {
    videoExists: fileStat.size > 0,
    videoSizeBytes: fileStat.size,
    durationSec,
    durationOk: durationSec !== null && durationSec >= 35 && durationSec <= 120,
    evidenceOk: true,
    evidenceFailures: [],
  };
  if (evidencePath) {
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    const required = [
      'agentRail',
      'launchAndModelRoute',
      'byok',
      'files',
      'parityCoach',
      'inspiration',
      'sourceSync',
      'i18nAndExport',
    ];
    for (const key of required) {
      if (!evidence.checks?.[key]?.visible) checks.evidenceFailures.push(key);
    }
    checks.evidenceOk = checks.evidenceFailures.length === 0;
    checks.runId = evidence.runId;
  }
  return checks;
}

async function startGeminiUpload(apiKey, sizeBytes) {
  const response = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
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
  if (!response.ok)
    throw new Error(`Gemini upload start failed: ${response.status} ${await response.text()}`);
  const uploadUrl = response.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini upload start response missing x-goog-upload-url');
  return uploadUrl;
}

async function finishGeminiUpload(uploadUrl, bytes) {
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
  });
  if (!response.ok)
    throw new Error(`Gemini upload finalize failed: ${response.status} ${await response.text()}`);
  return await response.json();
}

async function waitForGeminiFile(apiKey, fileName) {
  for (let i = 0; i < 30; i += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!response.ok)
      throw new Error(`Gemini file poll failed: ${response.status} ${await response.text()}`);
    const json = await response.json();
    const file = json.file ?? json;
    if (file.state === 'ACTIVE') return file;
    if (file.state === 'FAILED')
      throw new Error(`Gemini file processing failed: ${JSON.stringify(json)}`);
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 4000));
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
You are reviewing a GitHub README demo video for the current Parity Studio product.

The video should demonstrate newer workflows beyond the old six-step generation demo:
1. Agent rail: launch, keys/BYOK, run history, and chat are visible together.
2. New Run modal: idea/image/ui_kit entry paths and model routing are visible.
3. BYOK/session privacy: the UI explains key privacy and local MCP env export.
4. Files workflow: generated files can be selected/scoped and edited/saved/reverted/exported.
5. Parity Coach: end-user impact readout and top recommendations are visible.
6. Inspiration workflow: references/search/plan/apply-to-agent concept is visible.
7. Source sync/MCP setup: patch-vs-recapture and MCP setup instructions are visible.
8. Header utilities: language switch and export formats are visible.

Judge whether this is a clear README/release demo similar in spirit to Open CoDesign's concise product GIFs: it should be legible, focused, and understandable without audio.

Return only strict JSON:
{
  "pass": boolean,
  "score": number,
  "durationAssessment": "too_short" | "good" | "too_long",
  "workflows": {
    "agentRail": {"visible": boolean, "timestamp": string, "reason": string},
    "newRunModelRouting": {"visible": boolean, "timestamp": string, "reason": string},
    "byokPrivacy": {"visible": boolean, "timestamp": string, "reason": string},
    "filesEditingSource": {"visible": boolean, "timestamp": string, "reason": string},
    "parityCoach": {"visible": boolean, "timestamp": string, "reason": string},
    "inspiration": {"visible": boolean, "timestamp": string, "reason": string},
    "sourceSyncMcp": {"visible": boolean, "timestamp": string, "reason": string},
    "i18nExport": {"visible": boolean, "timestamp": string, "reason": string}
  },
  "readmeFit": {"visibleAtAGlance": boolean, "notDistracting": boolean, "reason": string},
  "blockingIssues": string[],
  "recommendedFixes": string[]
}

Pass only if all eight workflows are visibly represented and the demo is coherent as a current-product README asset.
`;
  const response = await fetch(
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
  if (!response.ok)
    throw new Error(`Gemini analysis failed: ${response.status} ${await response.text()}`);
  const json = await response.json();
  const text =
    json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '';
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
  const reportPath = videoPath.replace(/\.mp4$/i, '.current-workflows.gemini-verification.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  const allVisible = Object.values(analysis.workflows ?? {}).every(
    (workflow) => workflow?.visible === true,
  );
  if (!analysis.pass || !allVisible || analysis.readmeFit?.visibleAtAGlance !== true) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[verify-current-demo] fatal:', err);
  process.exit(1);
});
