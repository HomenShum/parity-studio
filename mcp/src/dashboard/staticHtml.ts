/**
 * Single-file dashboard HTML. Inlined CSS + JS so the server has zero static
 * asset routing. Matches parity-studio's main app visual language: warm-dark
 * canvas, terracotta accent, Manrope + JetBrains Mono.
 *
 * The JS is hand-written vanilla (no framework) to keep the serve fast and
 * the dependency surface zero. SSE drives all live updates; REST gives the
 * hydration on first load.
 */

export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="dark" />
<title>Parity Studio · MCP dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
:root {
  --bg-primary: #1a1b26;
  --bg-secondary: #24253a;
  --bg-tertiary: #2d2e42;
  --text-primary: #e4e4e7;
  --text-secondary: #9ca3af;
  --text-faint: #6b7280;
  --accent: #c96442;
  --accent-soft: rgba(201, 100, 66, 0.12);
  --success: #22c55e;
  --warn: #f3c969;
  --danger: #ff7b72;
  --edge: rgba(255,255,255,0.08);
  --edge-strong: rgba(255,255,255,0.14);
  --radius: 8px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --font-sans: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
*:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
body { font-family: var(--font-sans); background: var(--bg-primary); color: var(--text-primary); min-height: 100vh; -webkit-font-smoothing: antialiased; }
::selection { background: var(--accent-soft); }

.shell { display: grid; grid-template-rows: 48px 1fr; min-height: 100vh; }

.topbar { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-lg); border-bottom: 1px solid var(--edge); }
.brand { display: flex; align-items: center; gap: var(--space-md); }
.brand-mark { width: 28px; height: 28px; background: var(--accent); border-radius: 6px; display: grid; place-items: center; font-weight: 700; color: white; font-size: 14px; }
.brand-name { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
.brand-context { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
.topbar-right { display: flex; align-items: center; gap: var(--space-lg); font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
.live-pill { display: flex; align-items: center; gap: var(--space-sm); }
.live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); }
.live-dot.disconnected { background: var(--danger); }

.main { display: grid; grid-template-columns: 320px 1fr; min-height: 0; }

.runs-rail { border-right: 1px solid var(--edge); overflow-y: auto; padding: var(--space-md); }
.section-label { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--text-secondary); margin-bottom: var(--space-md); }
.run-card { background: var(--bg-secondary); border: 1px solid var(--edge); border-radius: var(--radius); padding: var(--space-md); margin-bottom: var(--space-md); cursor: pointer; transition: border-color 0.15s ease; }
.run-card:hover { border-color: var(--edge-strong); }
.run-card.selected { border-color: var(--accent); }
.run-card-row { display: flex; justify-content: space-between; align-items: center; gap: var(--space-sm); }
.run-card-id { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
.run-card-status { font-family: var(--font-mono); font-size: 10px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.08em; }
.run-card-prompt { font-size: 13px; color: var(--text-primary); margin-top: 6px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.run-card-meta { display: flex; justify-content: space-between; gap: var(--space-sm); margin-top: var(--space-sm); font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
.runs-empty { padding: var(--space-lg); text-align: center; color: var(--text-faint); font-size: 13px; }

.detail { padding: var(--space-lg); overflow-y: auto; min-width: 0; }
.detail-empty { display: grid; place-items: center; height: 100%; color: var(--text-faint); }
.detail-empty-card { text-align: center; max-width: 420px; }
.detail-empty-title { font-size: 24px; font-weight: 500; margin-bottom: var(--space-sm); color: var(--text-primary); }
.detail-empty-sub { font-size: 14px; line-height: 1.6; }
.detail-empty-cmd { display: inline-block; margin-top: var(--space-md); padding: 6px 12px; background: var(--bg-secondary); border: 1px solid var(--edge); border-radius: 6px; font-family: var(--font-mono); font-size: 12px; color: var(--accent); }

.detail-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-lg); }
.detail-title { font-size: 20px; font-weight: 500; }
.detail-id { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); margin-top: 4px; }
.detail-actions { display: flex; gap: var(--space-sm); }
.btn { background: var(--bg-secondary); border: 1px solid var(--edge); padding: 8px 14px; border-radius: 6px; color: var(--text-primary); cursor: pointer; font-size: 13px; font-family: inherit; transition: background 0.15s ease; }
.btn:hover { background: var(--bg-tertiary); }
.btn-accent { background: var(--accent); border-color: var(--accent); color: white; font-weight: 500; }
.btn-accent:hover { opacity: 0.92; background: var(--accent); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.detail-grid { display: grid; grid-template-columns: 1fr 280px; gap: var(--space-lg); }
@media (max-width: 1100px) { .detail-grid { grid-template-columns: 1fr; } }

.section { background: var(--bg-secondary); border: 1px solid var(--edge); border-radius: var(--radius); margin-bottom: var(--space-lg); }
.section-head { padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--edge); font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--text-secondary); }
.section-body { padding: var(--space-lg); }

.pipeline-list { padding: var(--space-md) 0; }
.pipeline-item { display: flex; align-items: center; gap: var(--space-md); padding: 10px var(--space-lg); font-size: 14px; color: var(--text-secondary); }
.pipeline-item.done { color: var(--text-primary); }
.pipeline-item.running { color: var(--text-primary); }
.pipeline-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--text-faint); flex-shrink: 0; }
.pipeline-item.done .pipeline-dot { background: var(--success); }
.pipeline-item.failed .pipeline-dot { background: var(--danger); }
.pipeline-item.running .pipeline-dot { background: var(--warn); animation: pulse 1.2s ease-in-out infinite; }
.pipeline-item.unavailable .pipeline-dot { background: var(--text-faint); opacity: 0.4; }
.pipeline-meta { margin-left: auto; font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.parity-block { padding: var(--space-lg); }
.parity-headline { display: flex; align-items: baseline; gap: var(--space-sm); }
.parity-score { font-family: var(--font-mono); font-size: 32px; font-weight: 600; }
.parity-of { font-family: var(--font-mono); font-size: 13px; color: var(--text-secondary); }
.parity-status-pill { display: inline-block; margin-top: var(--space-sm); font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; padding: 4px 10px; border-radius: 4px; }
.status-verified { background: rgba(34, 197, 94, 0.15); color: var(--success); }
.status-needs_review { background: rgba(243, 201, 105, 0.15); color: var(--warn); }
.status-needs_iteration { background: rgba(243, 201, 105, 0.2); color: var(--warn); }
.status-failed { background: rgba(255, 123, 114, 0.15); color: var(--danger); }
.status-unavailable { background: var(--bg-tertiary); color: var(--text-faint); }
.status-queued, .status-generating, .status-decomposing, .status-verifying, .status-iterating { background: rgba(243, 201, 105, 0.15); color: var(--warn); }
.status-done { background: rgba(34, 197, 94, 0.15); color: var(--success); }

.cost-line { display: flex; justify-content: space-between; padding: var(--space-md) var(--space-lg); font-family: var(--font-mono); font-size: 13px; }
.cost-value { color: var(--accent); font-weight: 600; }

.compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); padding: var(--space-md); }
.compare-pane { background: var(--bg-tertiary); border-radius: 6px; overflow: hidden; min-height: 200px; }
.compare-pane-label { padding: var(--space-sm) var(--space-md); font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-secondary); border-bottom: 1px solid var(--edge); }
.compare-pane img { width: 100%; height: auto; display: block; }
.compare-pane iframe { width: 100%; height: 280px; border: none; background: white; }
.compare-pane-empty { display: grid; place-items: center; padding: var(--space-lg); color: var(--text-faint); font-size: 12px; min-height: 180px; }

.files-list { padding: var(--space-md); font-family: var(--font-mono); font-size: 12px; }
.files-list-item { padding: 4px var(--space-md); color: var(--text-secondary); cursor: default; }
.files-list-item.dir { color: var(--text-primary); }

.gaps-list { padding: var(--space-md); }
.gap-item { padding: 10px var(--space-md); border-radius: 6px; background: var(--bg-tertiary); margin-bottom: 8px; font-size: 12px; line-height: 1.5; }
.gap-severity { display: inline-block; font-family: var(--font-mono); font-size: 10px; padding: 1px 6px; border-radius: 3px; margin-right: 8px; text-transform: uppercase; letter-spacing: 0.08em; }
.gap-high { background: rgba(255,123,114,0.18); color: var(--danger); }
.gap-medium { background: rgba(243,201,105,0.18); color: var(--warn); }
.gap-low { background: var(--bg-secondary); color: var(--text-secondary); }

.log-list { padding: var(--space-md); font-family: var(--font-mono); font-size: 11px; max-height: 280px; overflow-y: auto; }
.log-line { display: grid; grid-template-columns: 80px 50px 1fr; gap: var(--space-sm); padding: 2px 0; color: var(--text-secondary); }
.log-line.warn { color: var(--warn); }
.log-line.error { color: var(--danger); }
.log-time { color: var(--text-faint); }
.log-level { text-transform: uppercase; font-size: 10px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
</style>
</head>
<body>
<div class="shell">
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">P</div>
      <div class="brand-name">Parity Studio</div>
      <div class="brand-context">MCP dashboard</div>
    </div>
    <div class="topbar-right">
      <div class="live-pill" id="live-pill">
        <span class="live-dot" id="live-dot"></span>
        <span id="live-label">connecting...</span>
      </div>
      <span id="run-counter">0 runs</span>
    </div>
  </header>
  <main class="main">
    <aside class="runs-rail">
      <div class="section-label">recent runs</div>
      <div id="runs-list">
        <div class="runs-empty">No runs yet. Invoke <code>parity_pipeline</code> from your agent.</div>
      </div>
    </aside>
    <section class="detail" id="detail">
      <div class="detail-empty">
        <div class="detail-empty-card">
          <div class="detail-empty-title">Waiting for the first run</div>
          <div class="detail-empty-sub">
            This dashboard auto-opened when your coding agent invoked the parity-studio MCP server.
            Trigger any pipeline tool from Claude Code, Cursor, or Windsurf to see live progress.
          </div>
          <div class="detail-empty-cmd">use parity_pipeline to ...</div>
        </div>
      </div>
    </section>
  </main>
</div>

<script>
const state = { runs: new Map(), selectedId: null, sse: null, sseConnected: false };

const fmtTime = (ms) => {
  const d = new Date(ms);
  return d.toTimeString().slice(0, 8);
};
const fmtRelative = (ms) => {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  return Math.floor(diff / 3600) + 'h ago';
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setLive(connected) {
  state.sseConnected = connected;
  document.getElementById('live-dot').classList.toggle('disconnected', !connected);
  document.getElementById('live-label').textContent = connected ? 'live' : 'reconnecting...';
}

function renderRunsList() {
  const list = document.getElementById('runs-list');
  const counter = document.getElementById('run-counter');
  const runs = Array.from(state.runs.values()).sort((a, b) => b.createdAt - a.createdAt);
  counter.textContent = runs.length + ' run' + (runs.length === 1 ? '' : 's');
  if (runs.length === 0) {
    list.innerHTML = '<div class="runs-empty">No runs yet. Invoke <code>parity_pipeline</code> from your agent.</div>';
    return;
  }
  list.innerHTML = runs.map((r) => {
    const sel = r.id === state.selectedId ? ' selected' : '';
    const promptText = r.prompt ? escapeHtml(r.prompt.slice(0, 120)) : '<i>image-only</i>';
    return \`
      <div class="run-card\${sel}" data-id="\${r.id}">
        <div class="run-card-row">
          <span class="run-card-id">\${r.id.slice(0, 12)}</span>
          <span class="run-card-status status-\${r.status}">\${r.status}</span>
        </div>
        <div class="run-card-prompt">\${promptText}</div>
        <div class="run-card-meta">
          <span>\${fmtRelative(r.createdAt)}</span>
          <span>$\${r.costUsd.toFixed(4)}</span>
        </div>
      </div>
    \`;
  }).join('');
  for (const card of list.querySelectorAll('.run-card')) {
    card.addEventListener('click', () => {
      state.selectedId = card.getAttribute('data-id');
      renderDetail();
      renderRunsList();
    });
  }
}

function renderDetail() {
  const detail = document.getElementById('detail');
  if (state.selectedId === null) {
    // keep the empty state
    return;
  }
  const r = state.runs.get(state.selectedId);
  if (!r) {
    detail.innerHTML = '<div class="detail-empty"><div class="detail-empty-card"><div class="detail-empty-title">Run gone</div></div></div>';
    return;
  }
  const stages = ['generate', 'decompose', 'verify', 'iterate', 'done'];
  const pipelineHtml = stages.map((s) => {
    const st = r.stages?.[s] || 'idle';
    const lat = r.latencies?.[s];
    const model = r.modelsUsed?.[s];
    const meta = lat ? \`\${(lat / 1000).toFixed(1)}s\${model ? ' · ' + model : ''}\` : (model || '');
    return \`<div class="pipeline-item \${st}"><span class="pipeline-dot"></span><span>\${s}</span>\${meta ? '<span class="pipeline-meta">' + escapeHtml(meta) + '</span>' : ''}</div>\`;
  }).join('');

  const parity = r.parityReport;
  const parityHtml = parity ? \`
    <div class="parity-block">
      <div class="parity-headline">
        <span class="parity-score">\${parity.parityScore.toFixed(2)}</span>
        <span class="parity-of">/ \${parity.passCount}/\${parity.totalChecks} checks</span>
      </div>
      <div class="parity-status-pill status-\${parity.status}">\${parity.status.replace(/_/g, ' ')}</div>
      <div style="margin-top: 12px; font-size: 13px; color: var(--text-secondary); line-height: 1.5;">\${escapeHtml(parity.summary || '')}</div>
    </div>
  \` : \`
    <div class="parity-block">
      <div class="parity-headline">
        <span class="parity-score">--</span>
        <span class="parity-of">/ 0 checks</span>
      </div>
      <div class="parity-status-pill status-unavailable">no report yet</div>
    </div>
  \`;

  const filesHtml = (r.uiKitFilePaths || []).length === 0 ? '<div class="files-list-item">no files yet</div>' :
    r.uiKitFilePaths.map((p) => {
      const isDir = p.endsWith('/');
      return \`<div class="files-list-item\${isDir ? ' dir' : ''}">\${escapeHtml(p)}</div>\`;
    }).join('');

  const sourceHtml = r.sourceImageBase64 && r.sourceImageMimeType
    ? \`<img src="data:\${r.sourceImageMimeType};base64,\${r.sourceImageBase64}" alt="source mockup" />\`
    : '<div class="compare-pane-empty">no source image</div>';
  const renderedHtml = r.artifactHtmlPreview
    ? \`<iframe srcdoc="\${escapeHtml(r.artifactHtmlPreview)}" sandbox="allow-same-origin" title="rendered preview"></iframe>\`
    : '<div class="compare-pane-empty">artifact will appear here</div>';

  const failedChecks = (parity?.failedChecks || []).filter((c) => !c.passed);
  const gapsHtml = failedChecks.length === 0 ? '<div class="files-list-item">no gaps reported</div>' :
    failedChecks.map((c) => \`<div class="gap-item"><span class="gap-severity gap-high">\${escapeHtml(c.dimension || 'check')}</span>\${escapeHtml(c.note || '')}</div>\`).join('');

  const logHtml = (r.log || []).slice(-50).reverse().map((l) =>
    \`<div class="log-line \${l.level}"><span class="log-time">\${fmtTime(l.ts)}</span><span class="log-level">\${l.level}</span><span>\${escapeHtml(l.message)}</span></div>\`
  ).join('') || '<div class="log-line"><span class="log-time">--:--:--</span><span class="log-level">info</span><span>waiting for events...</span></div>';

  const canExport = r.uiKitFileCount > 0;
  const zipUrl = canExport ? \`/api/runs/\${encodeURIComponent(r.id)}/zip\` : '#';

  detail.innerHTML = \`
    <div class="detail-header">
      <div>
        <div class="detail-title">\${escapeHtml(r.uiKitSlug || r.prompt?.slice(0, 60) || 'Run')}</div>
        <div class="detail-id">\${r.id} · \${fmtRelative(r.createdAt)}</div>
      </div>
      <div class="detail-actions">
        <a class="btn btn-accent" href="\${zipUrl}" \${canExport ? 'download' : 'aria-disabled="true"'} \${canExport ? '' : 'onclick="return false"'}>Export ZIP</a>
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="section">
          <div class="section-head">source ↔ rendered</div>
          <div class="compare-grid">
            <div class="compare-pane">
              <div class="compare-pane-label">source mockup</div>
              \${sourceHtml}
            </div>
            <div class="compare-pane">
              <div class="compare-pane-label">rendered ui_kit</div>
              \${renderedHtml}
            </div>
          </div>
        </div>
        <div class="section">
          <div class="section-head">files (\${r.uiKitFileCount || 0})</div>
          <div class="files-list">\${filesHtml}</div>
        </div>
        <div class="section">
          <div class="section-head">gaps</div>
          <div class="gaps-list">\${gapsHtml}</div>
        </div>
        <div class="section">
          <div class="section-head">log</div>
          <div class="log-list">\${logHtml}</div>
        </div>
      </div>
      <div>
        <div class="section">
          <div class="section-head">pipeline</div>
          <div class="pipeline-list">\${pipelineHtml}</div>
        </div>
        <div class="section">
          <div class="section-head">parity</div>
          \${parityHtml}
        </div>
        <div class="section">
          <div class="section-head">cost</div>
          <div class="cost-line">
            <span>this run</span>
            <span class="cost-value">$\${r.costUsd.toFixed(4)}</span>
          </div>
        </div>
      </div>
    </div>
  \`;
}

async function hydrate() {
  try {
    const res = await fetch('/api/runs');
    const data = await res.json();
    state.runs.clear();
    for (const r of data.runs) state.runs.set(r.id, r);
    if (state.selectedId === null && data.runs.length > 0) {
      state.selectedId = data.runs[0].id;
    }
    renderRunsList();
    renderDetail();
  } catch (err) {
    console.error('hydrate failed', err);
  }
}

function connectSse() {
  if (state.sse) state.sse.close();
  const sse = new EventSource('/events');
  state.sse = sse;
  sse.addEventListener('hello', () => setLive(true));
  sse.addEventListener('run.created', (e) => {
    const r = JSON.parse(e.data);
    state.runs.set(r.id, r);
    if (state.selectedId === null) state.selectedId = r.id;
    renderRunsList();
    renderDetail();
  });
  sse.addEventListener('run.updated', (e) => {
    const r = JSON.parse(e.data);
    state.runs.set(r.id, r);
    renderRunsList();
    if (state.selectedId === r.id) renderDetail();
  });
  sse.addEventListener('run.stage', () => {});
  sse.addEventListener('run.cost', () => {});
  sse.addEventListener('run.log', () => {});
  sse.onerror = () => {
    setLive(false);
    setTimeout(connectSse, 1500);
  };
}

setLive(false);
hydrate();
connectSse();

// Slow re-render every 30s so relative times update on long-idle dashboards
setInterval(() => {
  renderRunsList();
  if (state.selectedId !== null) renderDetail();
}, 30_000);
</script>
</body>
</html>`;
}
