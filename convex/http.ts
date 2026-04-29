import { httpRouter } from 'convex/server';
import JSZip from 'jszip';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction } from './_generated/server';

const http = httpRouter();

/**
 * GET /api/runs/:id/zip
 *
 * Returns the latest ui_kit for the run as a downloadable ZIP. Includes a
 * HANDOFF.md file with integration instructions for Claude Code / Cursor /
 * Windsurf so the bundle is self-explanatory.
 *
 * 404 if the run doesn't exist or no ui_kit has been produced yet.
 *
 * Note: this lives in convex/http.ts (Node runtime) because JSZip's
 * generateAsync('nodebuffer') needs the Node Buffer API. The other queries
 * in this repo can stay in the default V8 runtime.
 */
http.route({
  pathPrefix: '/api/runs/',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/runs\/([a-z0-9_]+)\/zip$/i);
    if (m === null || m[1] === undefined) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const runId = m[1] as Id<'runs'>;

    const uiKit = await ctx.runQuery(internal.uiKits.getLatestInternal, { runId });
    if (uiKit === null) {
      return new Response(JSON.stringify({ error: 'no_ui_kit_yet' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const run = await ctx.runQuery(internal.runs.getInternal, { runId });
    const parity = await ctx.runQuery(internal.parityReports.getLatestInternal, { runId });

    const zip = new JSZip();
    const files = uiKit.files as Record<string, string>;
    // Files are already prefixed with `ui_kits/<slug>/`; copy verbatim.
    // The branch handles edge cases where a future writer might store
    // bare relative paths.
    for (const [path, content] of Object.entries(files)) {
      const out = path.startsWith(`ui_kits/${uiKit.slug}/`) ? path : `ui_kits/${uiKit.slug}/${path}`;
      zip.file(out, content);
    }

    // ── Canonical NodeBench skill-pack shape ─────────────────────────
    // See docs/CANONICAL_KIT.md. Symmetric with the importer in
    // src/components/composer/ComposerCard.tsx — a zip exported here
    // imports back cleanly without information loss.

    const parityLine =
      parity && parity.totalChecks > 0
        ? `${parity.passCount}/${parity.totalChecks} ${parity.status}`
        : 'n/a';
    const sourceMime = run?.sourceImageMimeType;
    const sourceB64 = run?.sourceImageBase64;
    const sourceExt = sourceMime ? sourceMime.split('/')[1] ?? 'png' : null;

    zip.file(
      'README.md',
      `# ${uiKit.slug} — Parity Studio export

A componentized \`ui_kit/\` produced by parity-studio. This zip follows
the canonical NodeBench AI Skill-pack shape and round-trips cleanly:
drop it back into parity-studio.vercel.app to import the same kit.

**Run:** ${String(runId)}
**Source prompt:** ${run?.prompt ?? '(image-only)'}
**Parity:** ${parityLine}
**Cost:** $${((run?.costMicroUsd ?? 0) / 1_000_000).toFixed(4)}
**Iterations:** ${run?.iterationsCompleted ?? 0}

## What's inside

- \`SKILL.md\` — Claude Skill descriptor; load this folder via Claude Code's \`.claude/skills/\` mechanism
- \`colors_and_type.css\` — root token entry; imports the active slug's \`tokens.css\`
- \`ui_kits/${uiKit.slug}/\` — the active product
  - \`index.html\` — full rendered artifact
  - \`components/\` — extracted React components (.tsx)
  - \`tokens.css\` — per-kit design tokens
  - \`manifest.json\` — slug + schemaVersion + entry point
  - \`HANDOFF.md\` — verbatim coding-agent instructions
${sourceB64 && sourceExt ? `- \`uploads/source.${sourceExt}\` — original source image` : ''}

See [docs/CANONICAL_KIT.md](https://github.com/HomenShum/parity-studio/blob/main/docs/CANONICAL_KIT.md) for the full shape contract.
`,
    );

    zip.file(
      'SKILL.md',
      `---
name: ${uiKit.slug}
description: ${run?.prompt ?? `${uiKit.slug} — UI kit produced by parity-studio with deterministic ${parityLine} parity`}
user-invocable: true
---

Read README.md within this skill, then explore the ui_kits/${uiKit.slug}/
folder. The kit ships with .tsx components, tokens.css, and a rendered
index.html. Import directly into a React + Vite project, or hand the
folder to Claude Code with: "integrate ui_kits/${uiKit.slug}/ into <route>".

If you need to verify or iterate further, drop this same zip back into
https://parity-studio.vercel.app — it round-trips.
`,
    );

    zip.file(
      'colors_and_type.css',
      `/* ==========================================================================
   ${uiKit.slug} — Colors & Type
   Root token entry. Imports the active slug's per-kit tokens.css so a
   consumer can include this single file and get the full token surface.
   ========================================================================== */

@import url('./ui_kits/${uiKit.slug}/tokens.css');
`,
    );

    if (sourceB64 && sourceExt) {
      // JSZip accepts base64 strings for binary files when given { base64: true }.
      zip.file(`uploads/source.${sourceExt}`, sourceB64, { base64: true });
    }

    const handoff = `# ${uiKit.slug} — handoff

Generated by parity-studio run ${String(runId)}.

Source prompt: ${run?.prompt ?? '(image-only)'}
Final parity:  ${parityLine}
Total cost:    $${((run?.costMicroUsd ?? 0) / 1_000_000).toFixed(4)}
Iterations:    ${run?.iterationsCompleted ?? 0}

## Integrate with Claude Code / Cursor / Windsurf

Unzip into your repo at the path of your choice. Then ask your coding agent:

> Integrate the ui_kits/${uiKit.slug}/ folder into the existing app at <your route>.
> Use components/*.tsx as the building blocks. Wire tokens.css into your global stylesheet.
> Preserve all visible text and numbers verbatim — they came from the source mockup.

Verify visually before merging. If parity drifted from your render, run
parity_verify (via parity-studio-mcp) with the integrated render to surface gaps.

manifest.json schemaVersion 1 contract is stable across minor versions.
`;
    zip.file(`ui_kits/${uiKit.slug}/HANDOFF.md`, handoff);

    // ── Enrichment: assets/, preview/, explorations/, screenshots/, scraps/ ─
    // Auto-generated from the run state. See docs/CANONICAL_KIT.md.
    const tokensCss = files[`ui_kits/${uiKit.slug}/tokens.css`] ?? '';

    // assets/logo-mark.svg — minimal terracotta P mark, slug-aware viewBox
    zip.file(
      'assets/logo-mark.svg',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#C76D54"/>
  <text x="32" y="44" font-family="Georgia, 'Times New Roman', serif" font-size="38" font-weight="500" text-anchor="middle" fill="#FAF7F3">${escapeXml(initialFromSlug(uiKit.slug))}</text>
</svg>
`,
    );

    // assets/og-<slug>.svg — OG card preview
    zip.file(
      `assets/og-${uiKit.slug}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="#FAF7F3"/>
  <rect x="60" y="60" width="100" height="100" rx="22" fill="#C76D54"/>
  <text x="110" y="132" font-family="Georgia, serif" font-size="64" font-weight="500" text-anchor="middle" fill="#FAF7F3">${escapeXml(initialFromSlug(uiKit.slug))}</text>
  <text x="200" y="120" font-family="Georgia, serif" font-size="42" fill="#3a342f">Parity Studio</text>
  <text x="200" y="160" font-family="ui-monospace, monospace" font-size="14" letter-spacing="0.18em" fill="#7a6f64">PRE-ALPHA</text>
  <text x="60" y="320" font-family="Georgia, serif" font-size="84" font-weight="400" fill="#3a342f">${escapeXml(uiKit.slug)}</text>
  <text x="60" y="380" font-family="ui-sans-serif, system-ui" font-size="28" fill="#7a6f64">${escapeXml(run?.prompt?.slice(0, 100) ?? 'image to verified ui_kit')}</text>
  <text x="60" y="540" font-family="ui-monospace, monospace" font-size="20" fill="#3a342f">parity ${parityLine}</text>
  <text x="60" y="572" font-family="ui-monospace, monospace" font-size="16" fill="#7a6f64">$${((run?.costMicroUsd ?? 0) / 1_000_000).toFixed(4)} · ${run?.iterationsCompleted ?? 0} iterations</text>
  <text x="1140" y="572" text-anchor="end" font-family="ui-monospace, monospace" font-size="14" fill="#7a6f64">parity-studio.vercel.app</text>
</svg>
`,
    );

    // assets/manifest.json — minimal asset index
    zip.file(
      'assets/README.md',
      `# Assets

Auto-generated by parity-studio.

- \`logo-mark.svg\` — minimal terracotta P mark with the slug initial.
- \`og-${uiKit.slug}.svg\` — 1200×630 OpenGraph card. Convert to PNG via
  rsvg-convert / sharp / inkscape if your platform needs raster.

Drop additional brand assets (real logos, hero webp, mask icons) into
this folder when you wire the kit into your codebase. They survive a
re-import as long as they live under \`assets/\` in the zip.
`,
    );

    // preview/_shell.css — shared shell for specimen pages
    zip.file(
      'preview/_shell.css',
      `/* shared shell for preview specimen pages */
@import url('../colors_and_type.css');
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--font-sans, ui-sans-serif, system-ui);
  background: var(--color-background, #FAF7F3);
  color: var(--color-text-primary, #3a342f);
  padding: 32px;
  min-height: 100vh;
}
h1 { font-family: var(--font-display, Georgia, serif); font-size: 36px; font-weight: 400; margin: 0 0 8px; }
.eyebrow { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-text-secondary, #7a6f64); }
.specimen { background: var(--color-surface, #fff); border: 1px solid var(--color-border-subtle, rgba(0,0,0,0.06)); border-radius: 12px; padding: 24px; margin-top: 24px; }
.swatch-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
.swatch { display: flex; flex-direction: column; gap: 6px; }
.swatch-fill { width: 100%; height: 80px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.06); }
.swatch-label { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--color-text-secondary, #7a6f64); }
pre { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.5; background: rgba(0,0,0,0.04); padding: 12px; border-radius: 8px; overflow-x: auto; }
`,
    );

    // preview/index.html — index of all specimens
    const componentEntries = Object.entries(files).filter(([p]) =>
      /\.(tsx|jsx)$/.test(p) && !p.endsWith('/HANDOFF.md'),
    );
    const componentSpecimens = componentEntries.map(([p]) => {
      const base = (p.split('/').slice(-1)[0] ?? '').replace(/\.(tsx|jsx)$/, '');
      return `component-${slugify(base)}`;
    });
    const tokenSpecimens = ['tokens-color', 'tokens-spacing', 'tokens-radius', 'tokens-typography'];
    zip.file(
      'preview/index.html',
      `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>${escapeXml(uiKit.slug)} — preview index</title>
<link rel="stylesheet" href="_shell.css"/>
</head><body>
<span class="eyebrow">${escapeXml(uiKit.slug)} · preview</span>
<h1>Specimen index</h1>
<div class="specimen">
  <div class="eyebrow">tokens</div>
  <ul style="margin:8px 0 0;padding-left:20px;line-height:1.8">
    ${tokenSpecimens.map((s) => `<li><a href="./${s}.html">${s}</a></li>`).join('\n    ')}
  </ul>
</div>
<div class="specimen">
  <div class="eyebrow">components (${componentSpecimens.length})</div>
  <ul style="margin:8px 0 0;padding-left:20px;line-height:1.8">
    ${componentSpecimens.map((s) => `<li><a href="./${s}.html">${s}</a></li>`).join('\n    ')}
  </ul>
</div>
</body></html>
`,
    );

    // preview/component-<base>.html — one per .tsx/.jsx component, shows
    // the file body inside <pre> with shell + token bindings so a
    // designer can scan all components without opening an editor.
    for (const [path, content] of componentEntries) {
      const base = (path.split('/').slice(-1)[0] ?? '').replace(/\.(tsx|jsx)$/, '');
      const slug = slugify(base);
      const truncated = content.length > 8000 ? `${content.slice(0, 8000)}\n\n/* …truncated at 8 KB; see ${path} for full source */` : content;
      zip.file(
        `preview/component-${slug}.html`,
        `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>${escapeXml(base)} · ${escapeXml(uiKit.slug)}</title>
<link rel="stylesheet" href="_shell.css"/>
</head><body>
<span class="eyebrow">${escapeXml(uiKit.slug)} · components</span>
<h1>${escapeXml(base)}</h1>
<div style="font-family:var(--font-sans);color:var(--color-text-secondary);font-size:14px;margin-top:8px">${escapeXml(path)}</div>
<div class="specimen">
<pre>${escapeHtml(truncated)}</pre>
</div>
</body></html>
`,
      );
    }

    // preview/tokens-*.html — parse tokens.css and emit specimen pages
    const colorMatches = Array.from(
      tokensCss.matchAll(/--([a-z][a-z0-9-]*color[a-z0-9-]*|color-[a-z0-9-]+|accent[a-z0-9-]*|brand-[a-z0-9-]+)\s*:\s*([^;]+);/gi),
    ).slice(0, 40);
    zip.file(
      'preview/tokens-color.html',
      tokenPage('Color tokens', uiKit.slug, swatches(colorMatches)),
    );
    const spacingMatches = Array.from(
      tokensCss.matchAll(/--(space-[a-z0-9-]+|size-[a-z0-9-]+|gap-[a-z0-9-]+)\s*:\s*([^;]+);/gi),
    ).slice(0, 40);
    zip.file(
      'preview/tokens-spacing.html',
      tokenPage('Spacing tokens', uiKit.slug, kvList(spacingMatches)),
    );
    const radiusMatches = Array.from(
      tokensCss.matchAll(/--(radius-[a-z0-9-]+)\s*:\s*([^;]+);/gi),
    ).slice(0, 20);
    zip.file(
      'preview/tokens-radius.html',
      tokenPage('Radius tokens', uiKit.slug, kvList(radiusMatches)),
    );
    const typeMatches = Array.from(
      tokensCss.matchAll(/--(font-[a-z0-9-]+|tracking-[a-z0-9-]+|leading-[a-z0-9-]+|text-[a-z0-9-]+)\s*:\s*([^;]+);/gi),
    ).slice(0, 40);
    zip.file(
      'preview/tokens-typography.html',
      tokenPage('Typography tokens', uiKit.slug, kvList(typeMatches)),
    );

    // explorations/iter-N.html — every artifact version, oldest → newest.
    // Lets the recipient compare iterations side by side with the
    // current rendered ui_kit.
    const allArtifacts = (await ctx.runQuery(internal.artifacts.listForRunInternal, { runId })) ?? [];
    if (allArtifacts.length > 0) {
      const sorted = [...allArtifacts].sort((a, b) => a.version - b.version);
      for (const art of sorted) {
        zip.file(`explorations/iter-${art.version}.html`, art.html);
      }
      zip.file(
        'explorations/README.md',
        `# Explorations

Each iteration's full \`index.html\` is preserved here so you can diff
the run's history.

${sorted.map((a) => `- \`iter-${a.version}.html\` — ${a.sizeBytes} bytes`).join('\n')}

The latest is duplicated as \`ui_kits/${uiKit.slug}/index.html\` for the
active kit.
`,
      );
    }

    // screenshots/ + scraps/ — best-effort placeholders.
    // We don't run a headless render in convex actions, so we can't
    // capture rendered PNGs here. We DO have the source image (already
    // in uploads/), which we duplicate as screenshots/source.<ext> so a
    // visual handoff has something to compare against.
    if (sourceB64 && sourceExt) {
      zip.file(`screenshots/source.${sourceExt}`, sourceB64, { base64: true });
    }
    zip.file(
      'screenshots/README.md',
      `# Screenshots

Final composed renders go here. parity-studio's deterministic verifier
runs without a headless browser, so we cannot generate rendered PNGs
in this export. Run the kit (\`ui_kits/${uiKit.slug}/index.html\`) in a
browser and screenshot manually, or wire the visual verifier path
(future v0.0.2) to populate this folder automatically.

${sourceB64 && sourceExt ? `\`source.${sourceExt}\` mirrors the original \`uploads/\` source image for convenience.` : ''}
`,
    );
    zip.file(
      'scraps/README.md',
      `# Scraps

Working PNGs from intermediate iterations live here in the canonical
NodeBench skill-pack shape. parity-studio doesn't capture intermediate
visual states (the deterministic verifier operates on HTML/CSS, not
pixels), so this folder is a documented hook point for future work
rather than populated content. Drop your own working PNGs here when
you iterate downstream.
`,
    );

    // V8 runtime: use 'arraybuffer' since Convex's Response typing prefers
    // ArrayBuffer/string over Uint8Array (which carries an ArrayBufferLike
    // generic that doesn't satisfy BodyInit in the strict path).
    const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${uiKit.slug}.zip"`,
        'cache-control': 'private, no-store',
      },
    });
  }),
});

// ── Helpers used by the canonical zip exporter ──────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function initialFromSlug(slug: string): string {
  // Take the first non-namespace word's initial; fall back to the slug's first letter.
  const parts = slug.split(/[-_]/);
  for (const p of parts) {
    if (p.length > 0 && p !== 'nodebench') return p[0]?.toUpperCase() ?? 'P';
  }
  return slug.charAt(0).toUpperCase() || 'P';
}

function tokenPage(title: string, slug: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>${escapeXml(title)} · ${escapeXml(slug)}</title>
<link rel="stylesheet" href="_shell.css"/>
</head><body>
<span class="eyebrow">${escapeXml(slug)} · tokens</span>
<h1>${escapeXml(title)}</h1>
<div class="specimen">
${body || '<div class="swatch-label">No matching tokens declared in tokens.css.</div>'}
</div>
</body></html>
`;
}

function swatches(matches: RegExpMatchArray[]): string {
  if (matches.length === 0) return '';
  const cells = matches
    .map((m) => {
      const name = m[1] ?? '';
      const value = (m[2] ?? '').trim();
      return `<div class="swatch"><div class="swatch-fill" style="background:${escapeXml(value)}"></div><div class="swatch-label">--${escapeXml(name)}</div><div class="swatch-label" style="color:var(--color-text-muted, #999)">${escapeXml(value)}</div></div>`;
    })
    .join('\n');
  return `<div class="swatch-row">${cells}</div>`;
}

function kvList(matches: RegExpMatchArray[]): string {
  if (matches.length === 0) return '';
  const rows = matches
    .map((m) => {
      const name = m[1] ?? '';
      const value = (m[2] ?? '').trim();
      return `<div style="display:grid;grid-template-columns:1fr auto;gap:12px;padding:6px 0;border-bottom:1px solid rgba(0,0,0,0.04);font-family:var(--font-mono, ui-monospace)"><span class="swatch-label">--${escapeXml(name)}</span><span class="swatch-label" style="color:var(--color-text-primary, #222)">${escapeXml(value)}</span></div>`;
    })
    .join('\n');
  return `<div>${rows}</div>`;
}

export default http;
