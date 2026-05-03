// Scene 3 of the demo trilogy: MCP TOOLS from Claude Code's perspective.
//
// We can't film a real terminal session reliably across Windows/macOS
// without asciinema + agg, and asciinema doesn't render well on Windows.
// Instead we drive a Playwright "fake terminal" — an HTML page styled
// like a Codex-/Claude-Code-style prompt — and programmatically type
// each MCP tool call + response.
//
// What it shows (in 45–60s):
//   1. parity_run_listRecent  → grab a runId
//   2. parity_enhance_prompt  → small-tier rewrite of a rough draft
//   3. parity_chat_send       → kick off the agent on the runId
//   4. parity_chat_history    → last few turns
//   5. parity_export          → markdown handoff for Claude Code
//
// We pre-record the responses (snapshots from a live run) so the demo
// is deterministic and doesn't depend on Convex availability at film
// time. To refresh snapshots, run with FETCH_LIVE=1 and a populated
// RUN_ID — the script will hit the hosted Convex endpoints and write
// `scripts/record-scene-mcp.snapshots.json`.
//
// Run:
//   node scripts/record-scene-mcp.mjs
// Optional:
//   FETCH_LIVE=1 RUN_ID=<id> node scripts/record-scene-mcp.mjs

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const HEADED = process.env.HEADED !== '0';
const SNAPSHOTS_PATH = resolve(__dirname, 'record-scene-mcp.snapshots.json');

// ── DEFAULT SNAPSHOTS — overwritten when run with FETCH_LIVE=1 ─────────
// These are short, illustrative payloads. The shape matches what the
// MCP tools actually return; values are pruned for legibility.
const DEFAULT_SNAPSHOTS = {
  parity_run_listRecent: [
    {
      _id: 'jh77w2k1bsmf0k4s4d3y8d8z6h7c8e3a',
      slug: 'minimal-saas-dashboard',
      prompt: 'minimal SaaS dashboard, terracotta primary',
      status: 'verified',
      tier: 'free',
      passCount: 25,
      totalChecks: 28,
      costMicroUsd: 1873,
    },
    {
      _id: 'jh67vx2kbsmf0k4s4d3y8d8z6h7c8e3b',
      slug: 'pricing-page-3-tier',
      prompt: 'simple pricing page, 3 tiers, friendly type',
      status: 'needs_review',
      tier: 'balanced',
      passCount: 18,
      totalChecks: 24,
      costMicroUsd: 412_000,
    },
  ],
  parity_enhance_prompt: {
    enhanced:
      'Redesign the hero composer card with: (1) a soft 12px border radius on the primary CTA, (2) a darker on-surface token for the input background, and (3) a 4px terracotta focus ring. Keep the existing icon row inline.',
    model: 'inclusionai/ling-2.6-1t:free',
    costMicroUsd: 0,
    inputTokens: 21,
    outputTokens: 64,
  },
  parity_chat_send: {
    runId: 'jh77w2k1bsmf0k4s4d3y8d8z6h7c8e3a',
    turnCreated: 4,
    scheduledAgent: true,
  },
  parity_chat_history: {
    messages: [
      { role: 'user', turn: 4, content: '[enhanced prompt above]' },
      { role: 'assistant', turn: 5, content: 'Reading components/Composer.tsx + tokens.css…' },
      { role: 'tool', turn: 6, name: 'read_file', result: '/* 142 lines */' },
      { role: 'assistant', turn: 7, content: 'Updating radius token + composer styles…' },
      { role: 'tool', turn: 8, name: 'upsert_file', result: 'wrote 2 files' },
      { role: 'assistant', turn: 9, content: 'Done. lint clean. preview rendered.' },
    ],
  },
  parity_export: {
    format: 'markdown',
    bytes: 8420,
    sample:
      '# minimal-saas-dashboard\n\n## Files\n- index.html (1.2 KB)\n- components/Composer.tsx (3.4 KB)\n- tokens.css (820 B)\n…',
  },
};

async function loadSnapshots() {
  if (existsSync(SNAPSHOTS_PATH)) {
    try {
      const raw = await readFile(SNAPSHOTS_PATH, 'utf8');
      return JSON.parse(raw);
    } catch {
      // fall through to defaults
    }
  }
  return DEFAULT_SNAPSHOTS;
}

async function fetchLive() {
  // Optional: hit the hosted Convex deployment to refresh snapshots.
  // Reuses the same URL the MCP server uses by default.
  const PARITY_CONVEX_URL =
    process.env.PARITY_CONVEX_URL ?? 'https://blissful-pig-998.convex.cloud';
  const RUN_ID = process.env.RUN_ID;
  if (!RUN_ID) {
    console.log('[mcp] FETCH_LIVE set but RUN_ID missing — skipping');
    return null;
  }
  const fresh = JSON.parse(JSON.stringify(DEFAULT_SNAPSHOTS));
  // listRecent
  const recents = await fetch(`${PARITY_CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'runs:listRecent', args: { limit: 2 }, format: 'json' }),
  })
    .then((r) => r.json())
    .catch(() => null);
  if (recents?.value) fresh.parity_run_listRecent = recents.value.slice(0, 2);
  // chat history
  const history = await fetch(`${PARITY_CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'chat:listForRun', args: { runId: RUN_ID }, format: 'json' }),
  })
    .then((r) => r.json())
    .catch(() => null);
  if (history?.value) fresh.parity_chat_history = { messages: history.value.slice(-6) };
  await writeFile(SNAPSHOTS_PATH, JSON.stringify(fresh, null, 2));
  console.log(`[mcp] wrote fresh snapshots → ${SNAPSHOTS_PATH}`);
  return fresh;
}

function buildHtml(snapshots) {
  // Codex-/Claude-Code-style terminal aesthetic; dark, mono.
  // We render frames by appending lines to #term and scrolling.
  return /* html */ `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:#0c0d0e;color:#e8e6e3;font-family:'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;font-size:15px;line-height:1.55;}
  #wrap{max-width:1280px;margin:0 auto;padding:36px 48px;}
  .titlebar{display:flex;align-items:center;gap:8px;padding-bottom:18px;border-bottom:1px solid #222;margin-bottom:18px;}
  .dot{width:11px;height:11px;border-radius:50%;}
  .dot.red{background:#ff5f56;} .dot.yellow{background:#ffbd2e;} .dot.green{background:#27c93f;}
  .title{margin-left:8px;color:#888;font-size:13px;}
  .prompt{color:#d97757;}
  .tool{color:#7ad48a;}
  .arg{color:#8ab4ff;}
  .key{color:#c98ee0;}
  .str{color:#e8b86d;}
  .dim{color:#666;}
  .ok{color:#27c93f;}
  .head{color:#bbb;border-top:1px dashed #333;margin:14px 0 6px 0;padding-top:10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;}
  pre{margin:0;white-space:pre-wrap;word-break:break-word;}
  .cursor{display:inline-block;width:8px;height:18px;background:#e8e6e3;vertical-align:-3px;margin-left:2px;animation:blink 1s steps(2) infinite;}
  @keyframes blink{50%{opacity:0;}}
  #term{min-height:780px;}
  .row{margin:2px 0;}
</style>
</head>
<body>
<div id="wrap">
  <div class="titlebar">
    <span class="dot red"></span>
    <span class="dot yellow"></span>
    <span class="dot green"></span>
    <span class="title">claude-code · parity-studio MCP server (10 tools)</span>
  </div>
  <div id="term"></div>
</div>
<script>
window.__SNAP = ${JSON.stringify(snapshots)};
window.__appendLine = function(html, klass) {
  const div = document.createElement('div');
  div.className = 'row' + (klass ? ' ' + klass : '');
  div.innerHTML = html;
  document.getElementById('term').appendChild(div);
  window.scrollTo(0, document.body.scrollHeight);
  return div;
};
window.__type = async function(target, text, delayMs) {
  for (let i = 0; i < text.length; i += 1) {
    target.textContent = (target.textContent || '') + text[i];
    await new Promise((r) => setTimeout(r, delayMs));
  }
};
</script>
</body>
</html>
`.trim();
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(repoRoot, 'runs', `recording-mcp-${stamp}`);
  const videoDir = join(outDir, 'video');
  await mkdir(videoDir, { recursive: true });
  console.log(`[mcp] output: ${outDir}`);

  let snapshots = await loadSnapshots();
  if (process.env.FETCH_LIVE) {
    const fresh = await fetchLive();
    if (fresh) snapshots = fresh;
  }

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1680, height: 900 } },
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[browser] ${msg.text()}`);
  });

  await page.setContent(buildHtml(snapshots));
  await page.waitForTimeout(800);

  // ── helpers driven from the page context ─────────────────────────────
  const newline = () => page.evaluate(() => window.__appendLine('&nbsp;'));
  const appendHtml = (html, klass) =>
    page.evaluate(({ html, klass }) => window.__appendLine(html, klass), { html, klass });
  const printPrompt = () =>
    page.evaluate(() =>
      window.__appendLine(
        '<span class="prompt">claude-code &gt;</span>&nbsp;<span class="cmd"></span><span class="cursor"></span>',
      ),
    );
  const typeIntoLastCmd = async (text, delay = 18) => {
    // Type into the last .cmd span
    for (const ch of text) {
      await page.evaluate((ch) => {
        const cmds = document.querySelectorAll('span.cmd');
        const last = cmds[cmds.length - 1];
        if (last) last.textContent = (last.textContent || '') + ch;
        window.scrollTo(0, document.body.scrollHeight);
      }, ch);
      await page.waitForTimeout(delay);
    }
  };
  const removeCursorOnLast = () =>
    page.evaluate(() => {
      const rows = document.querySelectorAll('#term .row');
      const last = rows[rows.length - 1];
      if (last) {
        const c = last.querySelector('.cursor');
        if (c) c.remove();
      }
    });

  // ── opening ──────────────────────────────────────────────────────────
  await appendHtml(
    '<span class="dim"># Connected to parity-studio MCP server v0.1.0 (10 tools)</span>',
  );
  await appendHtml(
    '<span class="dim"># 6 hosted-Convex tools available — no local API keys needed</span>',
  );
  await page.waitForTimeout(900);

  // ── 1. parity_run_listRecent ─────────────────────────────────────────
  await printPrompt();
  await typeIntoLastCmd('parity_run_listRecent { limit: 2 }');
  await page.waitForTimeout(500);
  await removeCursorOnLast();
  await appendHtml('<span class="head">→ result</span>');
  for (const run of snapshots.parity_run_listRecent) {
    const tierColor = run.tier === 'free' ? 'ok' : 'arg';
    await appendHtml(
      `  <span class="key">${run.slug}</span> <span class="dim">·</span> ` +
        `<span class="${tierColor}">${run.tier}</span> <span class="dim">·</span> ` +
        `${run.passCount}/${run.totalChecks} <span class="dim">·</span> ` +
        `<span class="dim">$${(run.costMicroUsd / 1_000_000).toFixed(4)}</span> <span class="dim">·</span> ` +
        `<span class="str">${run.status}</span>`,
    );
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(1_400);

  // ── 2. parity_enhance_prompt ─────────────────────────────────────────
  await printPrompt();
  await typeIntoLastCmd("parity_enhance_prompt { text: 'soften the radius' }");
  await page.waitForTimeout(500);
  await removeCursorOnLast();
  await appendHtml('<span class="head">→ result · ling-2.6-1t:free · $0.0000</span>');
  await appendHtml(`  <span class="str">${snapshots.parity_enhance_prompt.enhanced}</span>`);
  await page.waitForTimeout(1_600);

  // ── 3. parity_chat_send ──────────────────────────────────────────────
  const runId = snapshots.parity_run_listRecent[0]?._id ?? 'jh77...';
  await printPrompt();
  await typeIntoLastCmd(
    `parity_chat_send { runId: '${runId.slice(0, 12)}…', text: '[enhanced prompt]' }`,
  );
  await page.waitForTimeout(500);
  await removeCursorOnLast();
  await appendHtml('<span class="head">→ scheduled · agent loop running</span>');
  await appendHtml(
    `  <span class="dim">runId:</span> <span class="key">${runId.slice(0, 16)}…</span> <span class="dim">·</span> <span class="ok">turn 4 created</span>`,
  );
  await page.waitForTimeout(1_600);

  // ── 4. parity_chat_history (after some agent work) ───────────────────
  await printPrompt();
  await typeIntoLastCmd(`parity_chat_history { runId: '${runId.slice(0, 12)}…' }`);
  await page.waitForTimeout(500);
  await removeCursorOnLast();
  await appendHtml('<span class="head">→ last 6 turns</span>');
  for (const m of snapshots.parity_chat_history.messages) {
    const colorClass =
      m.role === 'user'
        ? 'arg'
        : m.role === 'tool'
          ? 'tool'
          : m.role === 'assistant'
            ? 'str'
            : 'dim';
    const head =
      m.role === 'tool'
        ? `<span class="${colorClass}">tool · ${m.name ?? '?'}</span>`
        : `<span class="${colorClass}">${m.role}</span>`;
    await appendHtml(
      `  <span class="dim">[${m.turn}]</span> ${head} <span class="dim">→</span> ${m.content ?? m.result ?? ''}`,
    );
    await page.waitForTimeout(280);
  }
  await page.waitForTimeout(1_500);

  // ── 5. parity_export ─────────────────────────────────────────────────
  await printPrompt();
  await typeIntoLastCmd(`parity_export { runId: '${runId.slice(0, 12)}…', format: 'markdown' }`);
  await page.waitForTimeout(500);
  await removeCursorOnLast();
  await appendHtml(`<span class="head">→ markdown · ${snapshots.parity_export.bytes} bytes</span>`);
  await appendHtml(
    `<pre class="dim">${snapshots.parity_export.sample.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
  );
  await page.waitForTimeout(2_500);

  await appendHtml('<span class="ok"># Demo complete — handoff ready for Claude Code</span>');
  await page.waitForTimeout(2_000);

  await context.close();
  await browser.close();

  const videos = (await readdir(videoDir)).filter((f) => f.endsWith('.webm'));
  if (videos.length === 0) {
    console.log('[mcp] no video file found');
    return;
  }
  const webmPath = join(videoDir, videos[0]);
  const renamedWebm = join(outDir, 'recording.webm');
  await copyFile(webmPath, renamedWebm);
  console.log(`[mcp] webm: ${renamedWebm}`);

  const mp4Path = join(outDir, 'recording.mp4');
  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-i', renamedWebm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', mp4Path],
    { stdio: 'inherit' },
  );
  if (ff.status === 0) console.log(`[mcp] mp4: ${mp4Path}`);
  else console.log('[mcp] ffmpeg unavailable; webm is canonical');
}

main().catch((err) => {
  console.error('[mcp] fatal:', err);
  process.exit(1);
});
