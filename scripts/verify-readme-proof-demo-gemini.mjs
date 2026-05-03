#!/usr/bin/env node
// Gemini verification for focused README proof demos.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const videoPath = resolve(process.argv[2] ?? '');
const evidencePath = process.argv[3] ? resolve(process.argv[3]) : null;
const demo = process.env.DEMO ?? 'core';
const model = process.env.GEMINI_VIDEO_MODEL ?? 'gemini-2.5-flash';
const deployment = process.env.CONVEX_DEPLOYMENT_FOR_ENV ?? 'blissful-pig-998';

if (!videoPath || !existsSync(videoPath)) {
  console.error('usage: node scripts/verify-readme-proof-demo-gemini.mjs <video.mp4> [evidence]');
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
    durationOk: durationSec !== null && durationSec >= 20 && durationSec <= 180,
    evidenceOk: true,
    evidenceFailures: [],
  };
  if (evidencePath) {
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    const requiredByDemo = {
      core: [
        'startedRun',
        'completedRun',
        'selectedFile',
        'meaningfulComment',
        'agentScopedEdit',
        'exportZip',
      ],
      inspiration: ['inspirationSearch', 'inspirationApplied'],
      sync: ['syncModal', 'syncPatch', 'mcpSetup'],
    };
    for (const key of requiredByDemo[demo] ?? []) {
      const row = evidence.checks?.[key];
      if (!row?.visible) checks.evidenceFailures.push(key);
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

function promptForDemo() {
  if (demo === 'inspiration') {
    return `
You are verifying a README demo for Parity Studio's Inspiration workflow.

The video must show the workflow being used, not just the tab:
1. The Inspiration tab/search surface is open.
2. A reference query/search or loaded reference plan is visible.
3. A recommended plan/reference pattern is visible.
4. The user applies the plan to the agent.
5. The agent stream/chat receives or works on that inspiration brief.

Return strict JSON:
{
  "pass": boolean,
  "score": number,
  "steps": {
    "openInspiration": {"visible": boolean, "timestamp": string, "reason": string},
    "searchOrPlan": {"visible": boolean, "timestamp": string, "reason": string},
    "applyToAgent": {"visible": boolean, "timestamp": string, "reason": string},
    "agentUsesBrief": {"visible": boolean, "timestamp": string, "reason": string}
  },
  "readmeFit": {"visibleAtAGlance": boolean, "notDistracting": boolean, "reason": string},
  "blockingIssues": string[],
  "recommendedFixes": string[]
}
Pass only if the flow is visibly used end-to-end.`;
  }
  if (demo === 'sync') {
    return `
You are verifying a README demo for Parity Studio's version/source sync workflow.

The video must show the workflow being used, not just the modal:
1. The Source Sync/version-control modal opens.
2. The user sees patch-current-run vs recapture/MCP choices.
3. Patch current run is triggered and the agent/chat stream starts work.
4. MCP/local recapture setup guidance is visible.

Return strict JSON:
{
  "pass": boolean,
  "score": number,
  "steps": {
    "openSync": {"visible": boolean, "timestamp": string, "reason": string},
    "choicesExplained": {"visible": boolean, "timestamp": string, "reason": string},
    "patchTriggered": {"visible": boolean, "timestamp": string, "reason": string},
    "mcpSetupVisible": {"visible": boolean, "timestamp": string, "reason": string}
  },
  "readmeFit": {"visibleAtAGlance": boolean, "notDistracting": boolean, "reason": string},
  "blockingIssues": string[],
  "recommendedFixes": string[]
}
Pass only if patch/sync is visibly used and MCP setup guidance is visible.`;
  }
  return `
You are verifying a README demo for Parity Studio's core generate/comment/edit/export workflow.

The video must prove the product workflow, not just show UI snippets:
1. A fresh run is started from a prompt, image, or canonical ui_kit ZIP.
2. Generation/decomposition/verification OR import/verification is shown, and the same run later reopens ready to edit.
3. A generated file/component is selected.
4. A meaningful bbox/element comment is placed on a visible design element.
5. Save + auto-fix or equivalent triggers the live agent stream/chat/tool work.
6. The edited canonical ui_kit is exported as ZIP.

Return strict JSON:
{
  "pass": boolean,
  "score": number,
  "steps": {
    "startFreshRun": {"visible": boolean, "timestamp": string, "reason": string},
    "generateOrImportVerify": {"visible": boolean, "timestamp": string, "reason": string},
    "selectComponent": {"visible": boolean, "timestamp": string, "reason": string},
    "meaningfulComment": {"visible": boolean, "timestamp": string, "reason": string},
    "agentScopedEdit": {"visible": boolean, "timestamp": string, "reason": string},
    "exportZip": {"visible": boolean, "timestamp": string, "reason": string}
  },
  "readmeFit": {"visibleAtAGlance": boolean, "notDistracting": boolean, "reason": string},
  "blockingIssues": string[],
  "recommendedFixes": string[]
}
Pass only if all six core steps are visibly represented, the comment lands on a visible UI element, and the flow is coherent without audio.`;
}

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

async function geminiAnalyze(apiKey, file) {
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
              { text: promptForDemo() },
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
    console.error('GEMINI_API_KEY not found in env, local env files, or Convex env.');
    process.exit(2);
  }

  const bytes = await readFile(videoPath);
  const uploadUrl = await startGeminiUpload(apiKey, bytes.length);
  const upload = await finishGeminiUpload(uploadUrl, bytes);
  const activeFile = await waitForGeminiFile(apiKey, upload.file?.name ?? upload.name);
  const analysis = await geminiAnalyze(apiKey, activeFile);
  const report = {
    demo,
    video: videoPath,
    evidence: evidencePath,
    model,
    localChecks: checks,
    gemini: analysis,
  };
  const reportPath = videoPath.replace(/\.mp4$/i, `.${demo}.gemini-verification.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  const allVisible = Object.values(analysis.steps ?? {}).every((step) => step?.visible === true);
  if (!analysis.pass || !allVisible || analysis.readmeFit?.visibleAtAGlance !== true) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[verify-proof:${demo}] fatal:`, err);
  process.exit(1);
});
