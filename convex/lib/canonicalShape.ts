/**
 * Canonical NodeBench skill-pack shape — pure-fn generator.
 *
 * Given a kit's source code (`ui_kits/<slug>/...`) plus run telemetry,
 * emits the *text* portion of the full canonical shape: README.md,
 * SKILL.md, colors_and_type.css, assets/*, preview/*, explorations/*,
 * screenshots/*, scraps/*. Binary files (uploads/source.png,
 * screenshots/source.png) live on the runs row and are injected at
 * export time, not stored here.
 *
 * Why a shared lib instead of generating-at-export-time:
 * once the shape lives in `ui_kits.files`, the chat agent can call
 * `patchFile` on ANY canonical path — `preview/component-X.html`,
 * `assets/og-<slug>.svg`, `explorations/iter-N.html` — and the edit
 * persists, round-trips, and shows up at next export verbatim. Without
 * this, only files under `ui_kits/<slug>/` are atomically editable.
 *
 * See docs/CANONICAL_KIT.md for the contract.
 */

import { buildOperatingContractFiles } from './kitContract';

export interface ExpandInput {
  slug: string;
  /**
   * Raw kit files (paths under `ui_kits/<slug>/`). Used to derive
   * preview/component-*.html and the explorations iteration list.
   */
  kitFiles: Record<string, string>;
  run: {
    runId: string;
    prompt?: string | undefined;
    costMicroUsd: number;
    iterationsCompleted: number;
    sourceImageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp' | undefined;
    /** Whether the run has a usable source image to reference at export time. */
    hasSourceImage: boolean;
  };
  parity: {
    passCount: number;
    totalChecks: number;
    status: string;
  } | null;
  /**
   * Optional prior artifacts for explorations/. Pass empty array if
   * the caller doesn't have iteration history yet (e.g. fresh import).
   */
  artifacts: Array<{ version: number; html: string; sizeBytes: number }>;
}

/**
 * Returns the canonical-shape text files. Paths are absolute under the
 * zip root (`README.md`, `assets/logo-mark.svg`, etc.). The returned
 * object is intended to be MERGED with kitFiles to produce the full
 * stored map — caller is responsible for that merge so kit edits win
 * over canonical-shape regeneration.
 */
export function expandToCanonicalShape(input: ExpandInput): Record<string, string> {
  const { slug, kitFiles, run, parity, artifacts } = input;
  const out: Record<string, string> = {};

  const parityLine =
    parity && parity.totalChecks > 0
      ? `${parity.passCount}/${parity.totalChecks} ${parity.status}`
      : 'n/a';
  const ext = run.sourceImageMimeType ? run.sourceImageMimeType.split('/')[1] ?? 'png' : null;
  const tokensCss = kitFiles[`ui_kits/${slug}/tokens.css`] ?? '';

  Object.assign(
    out,
    buildOperatingContractFiles({
      slug,
      runId: run.runId,
      prompt: run.prompt,
      sourceType: run.hasSourceImage ? 'image' : 'generated-html',
      importToParityStudio: true,
    }),
  );

  // ── Top-level docs ─────────────────────────────────────────────────
  out['README.md'] = `# ${slug} — Parity Studio export

A componentized \`ui_kit/\` produced by parity-studio. This zip follows
the canonical NodeBench AI Skill-pack shape and round-trips cleanly:
drop it back into parity-studio.vercel.app to import the same kit.

**Run:** ${run.runId}
**Source prompt:** ${run.prompt ?? '(image-only)'}
**Parity:** ${parityLine}
**Cost:** $${(run.costMicroUsd / 1_000_000).toFixed(4)}
**Iterations:** ${run.iterationsCompleted}

## What's inside

- \`SKILL.md\` - root Claude Skill descriptor
- \`.claude/skills/${slug}/SKILL.md\` - Claude Code project skill for this slug
- \`AGENTS.md\` and \`.cursor/rules/${slug}-parity-studio.mdc\` - agent rules for Codex, Cursor, Windsurf, and similar coding agents
- \`colors_and_type.css\` - root token entry; imports the active slug's tokens
- \`ui_kits/${slug}/\` - the active product (index.html, components, tokens, manifest, README, HANDOFF, parity.contract.json, performance.budget.json, api-wiring.plan.md, qa.plan.md)
- \`assets/\` - auto-generated logo + OG card; extend with real brand artifacts
- \`preview/\` — one HTML specimen per component + per token group
- \`explorations/\` — iteration history (one full index.html per artifact version)
${run.hasSourceImage && ext ? `- \`uploads/source.${ext}\` — original source image (round-trips back into the importer)` : ''}
- \`screenshots/\` — final composed renders go here
- \`scraps/\` — working PNGs (designer's intermediate state)

See [docs/CANONICAL_KIT.md](https://github.com/HomenShum/parity-studio/blob/main/docs/CANONICAL_KIT.md).
`;

  out['SKILL.md'] = `---
name: ${slug}
description: ${run.prompt ?? `${slug} — UI kit produced by parity-studio with deterministic ${parityLine} parity`}
user-invocable: true
---

Read README.md within this skill, then explore the ui_kits/${slug}/
folder. The kit ships with .tsx components, tokens.css, and a rendered
index.html. Import directly into a React + Vite project, or hand the
folder to Claude Code with: "integrate ui_kits/${slug}/ into <route>".

If you need to verify or iterate further, drop this same zip back into
https://parity-studio.vercel.app — it round-trips.
`;

  out['colors_and_type.css'] = `/* ==========================================================================
   ${slug} — Colors & Type
   Root token entry. Imports the active slug's per-kit tokens.css so a
   consumer can include this single file and get the full token surface.
   ========================================================================== */

@import url('./ui_kits/${slug}/tokens.css');
`;

  // ── ui_kits/<slug>/HANDOFF.md ─────────────────────────────────────
  out[`ui_kits/${slug}/HANDOFF.md`] = `# ${slug} — handoff

Generated by parity-studio run ${run.runId}.

Source prompt: ${run.prompt ?? '(image-only)'}
Final parity:  ${parityLine}
Total cost:    $${(run.costMicroUsd / 1_000_000).toFixed(4)}
Iterations:    ${run.iterationsCompleted}

## Integrate with Claude Code / Cursor / Windsurf

Unzip into your repo at the path of your choice. Then ask your coding agent:

> Integrate the ui_kits/${slug}/ folder into the existing app at <your route>.
> Use components/*.tsx as the building blocks. Wire tokens.css into your global stylesheet.
> Preserve all visible text and numbers verbatim — they came from the source mockup.

Verify visually before merging. If parity drifted from your render, run
parity_verify (via parity-studio-mcp) with the integrated render to surface gaps.

manifest.json schemaVersion 1 contract is stable across minor versions.
`;

  // ── assets/ ────────────────────────────────────────────────────────
  out['assets/logo-mark.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#C76D54"/>
  <text x="32" y="44" font-family="Georgia, 'Times New Roman', serif" font-size="38" font-weight="500" text-anchor="middle" fill="#FAF7F3">${escapeXml(initialFromSlug(slug))}</text>
</svg>
`;

  out[`assets/og-${slug}.svg`] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="#FAF7F3"/>
  <rect x="60" y="60" width="100" height="100" rx="22" fill="#C76D54"/>
  <text x="110" y="132" font-family="Georgia, serif" font-size="64" font-weight="500" text-anchor="middle" fill="#FAF7F3">${escapeXml(initialFromSlug(slug))}</text>
  <text x="200" y="120" font-family="Georgia, serif" font-size="42" fill="#3a342f">Parity Studio</text>
  <text x="200" y="160" font-family="ui-monospace, monospace" font-size="14" letter-spacing="0.18em" fill="#7a6f64">v0.1.0</text>
  <text x="60" y="320" font-family="Georgia, serif" font-size="84" font-weight="400" fill="#3a342f">${escapeXml(slug)}</text>
  <text x="60" y="380" font-family="ui-sans-serif, system-ui" font-size="28" fill="#7a6f64">${escapeXml((run.prompt ?? 'image to verified ui_kit').slice(0, 100))}</text>
  <text x="60" y="540" font-family="ui-monospace, monospace" font-size="20" fill="#3a342f">parity ${parityLine}</text>
  <text x="60" y="572" font-family="ui-monospace, monospace" font-size="16" fill="#7a6f64">$${(run.costMicroUsd / 1_000_000).toFixed(4)} · ${run.iterationsCompleted} iterations</text>
  <text x="1140" y="572" text-anchor="end" font-family="ui-monospace, monospace" font-size="14" fill="#7a6f64">parity-studio.vercel.app</text>
</svg>
`;

  out['assets/README.md'] = `# Assets

Auto-generated by parity-studio.

- \`logo-mark.svg\` — minimal terracotta P mark with the slug initial.
- \`og-${slug}.svg\` — 1200×630 OpenGraph card.

Drop additional brand assets (real logos, hero webp, mask icons) into
this folder when you wire the kit into your codebase. They survive a
re-import as long as they live under \`assets/\` in the zip.
`;

  // ── preview/ ───────────────────────────────────────────────────────
  out['preview/_shell.css'] = `/* shared shell for preview specimen pages */
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
`;

  const componentEntries = Object.entries(kitFiles).filter(([p]) =>
    /\.(tsx|jsx)$/.test(p) && !p.endsWith('/HANDOFF.md'),
  );
  const componentSpecimens = componentEntries.map(([p]) => {
    const base = (p.split('/').slice(-1)[0] ?? '').replace(/\.(tsx|jsx)$/, '');
    return { base, slug: slugify(base), path: p };
  });
  const tokenSpecimens = ['tokens-color', 'tokens-spacing', 'tokens-radius', 'tokens-typography'];

  out['preview/index.html'] = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>${escapeXml(slug)} — preview index</title>
<link rel="stylesheet" href="_shell.css"/>
</head><body>
<span class="eyebrow">${escapeXml(slug)} · preview</span>
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
    ${componentSpecimens.map((s) => `<li><a href="./component-${s.slug}.html">${s.base}</a></li>`).join('\n    ')}
  </ul>
</div>
</body></html>
`;

  for (const c of componentSpecimens) {
    const content = kitFiles[c.path] ?? '';
    const truncated = content.length > 8000
      ? `${content.slice(0, 8000)}\n\n/* …truncated at 8 KB; see ${c.path} for full source */`
      : content;
    out[`preview/component-${c.slug}.html`] = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>${escapeXml(c.base)} · ${escapeXml(slug)}</title>
<link rel="stylesheet" href="_shell.css"/>
</head><body>
<span class="eyebrow">${escapeXml(slug)} · components</span>
<h1>${escapeXml(c.base)}</h1>
<div style="font-family:var(--font-sans);color:var(--color-text-secondary);font-size:14px;margin-top:8px">${escapeXml(c.path)}</div>
<div class="specimen">
<pre>${escapeHtml(truncated)}</pre>
</div>
</body></html>
`;
  }

  const colorMatches = Array.from(
    tokensCss.matchAll(/--([a-z][a-z0-9-]*color[a-z0-9-]*|color-[a-z0-9-]+|accent[a-z0-9-]*|brand-[a-z0-9-]+)\s*:\s*([^;]+);/gi),
  ).slice(0, 40);
  out['preview/tokens-color.html'] = tokenPage('Color tokens', slug, swatches(colorMatches));
  const spacingMatches = Array.from(
    tokensCss.matchAll(/--(space-[a-z0-9-]+|size-[a-z0-9-]+|gap-[a-z0-9-]+)\s*:\s*([^;]+);/gi),
  ).slice(0, 40);
  out['preview/tokens-spacing.html'] = tokenPage('Spacing tokens', slug, kvList(spacingMatches));
  const radiusMatches = Array.from(
    tokensCss.matchAll(/--(radius-[a-z0-9-]+)\s*:\s*([^;]+);/gi),
  ).slice(0, 20);
  out['preview/tokens-radius.html'] = tokenPage('Radius tokens', slug, kvList(radiusMatches));
  const typeMatches = Array.from(
    tokensCss.matchAll(/--(font-[a-z0-9-]+|tracking-[a-z0-9-]+|leading-[a-z0-9-]+|text-[a-z0-9-]+)\s*:\s*([^;]+);/gi),
  ).slice(0, 40);
  out['preview/tokens-typography.html'] = tokenPage('Typography tokens', slug, kvList(typeMatches));

  // ── explorations/ ─────────────────────────────────────────────────
  if (artifacts.length > 0) {
    const sorted = [...artifacts].sort((a, b) => a.version - b.version);
    for (const art of sorted) {
      out[`explorations/iter-${art.version}.html`] = art.html;
    }
    out['explorations/README.md'] = `# Explorations

Each iteration's full \`index.html\` is preserved here so you can diff
the run's history.

${sorted.map((a) => `- \`iter-${a.version}.html\` — ${a.sizeBytes} bytes`).join('\n')}

The latest is duplicated as \`ui_kits/${slug}/index.html\` for the
active kit.
`;
  }

  // ── tweak-schema.json — auto-derived from tokens.css ──────────────
  // Drives the TweakPanel's UI (color picker / slider / enum / toggle / text)
  // per token. Heuristic auto-derivation:
  //   #hex / oklch(...) / rgb(...) / hsl(...) → color picker
  //   plain number with px/rem/em → number slider with sensible bounds
  //   font-* tokens → enum if comma-separated stack, else string
  //   true/false literals → boolean toggle
  //   anything else → text input (string)
  // The agent can refine this via upsert_file on the same path; on next
  // export the canonical regen only fills in NEW tokens (existing
  // user/agent edits to tweak-schema.json survive thanks to iterate's
  // merge policy).
  out[`ui_kits/${slug}/tweak-schema.json`] = JSON.stringify(
    deriveTweakSchema(tokensCss),
    null,
    2,
  );

  // ── screenshots/ + scraps/ — README docs only; binaries injected at zip
  out['screenshots/README.md'] = `# Screenshots

Final composed renders go here. parity-studio's deterministic verifier
runs without a headless browser, so we cannot generate rendered PNGs
in this export. Run the kit (\`ui_kits/${slug}/index.html\`) in a
browser and screenshot manually, or wire the visual verifier path
(future v0.0.2) to populate this folder automatically.

${run.hasSourceImage && ext ? `\`source.${ext}\` mirrors the original \`uploads/\` source image for convenience (injected at zip-time, not stored).` : ''}
`;

  out['scraps/README.md'] = `# Scraps

Working PNGs from intermediate iterations live here in the canonical
NodeBench skill-pack shape. parity-studio doesn't capture intermediate
visual states (the deterministic verifier operates on HTML/CSS, not
pixels), so this folder is a documented hook point for future work
rather than populated content. Drop your own working PNGs here when
you iterate downstream.
`;

  return out;
}

// ── Tweak-schema derivation ─────────────────────────────────────────────

/**
 * TweakSchemaEntry — per-token UI control hint.
 *
 * Mirrors OCD's TweakSchema but lives in a standalone JSON file rather
 * than inside an EDITMODE marker block, so the agent can edit it via
 * upsert_file without touching tokens.css.
 *
 * `kind` drives which control the TweakPanel renders:
 *   color   → native color input + hex text field
 *   number  → range slider with min/max/step/unit + text input
 *   enum    → segmented control over `options`
 *   boolean → toggle switch (value is "true" | "false" string)
 *   string  → text input with optional placeholder
 */
export interface TweakSchemaEntry {
  kind: 'color' | 'number' | 'enum' | 'boolean' | 'string';
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  placeholder?: string;
}

export interface TweakSchema {
  version: 1;
  /** Map of CSS custom property name (with `--` prefix) → schema hint. */
  tokens: Record<string, TweakSchemaEntry>;
}

const COLOR_VALUE_RE =
  /^(#[0-9a-f]{3,8}|oklch\([^)]*\)|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;
const NUMERIC_VALUE_RE = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|s|ms)?$/i;
const FONT_STACK_RE = /,/;

function deriveTweakSchema(tokensCss: string): TweakSchema {
  const tokens: Record<string, TweakSchemaEntry> = {};

  // Capture every `--name: value;` (or until `}` for last in block) inside :root.
  // We don't try to handle media queries / other selectors; tokens.css typically
  // declares everything in :root.
  const declRe = /--([a-z][a-z0-9-]*)\s*:\s*([^;]+);/gi;
  for (const m of tokensCss.matchAll(declRe)) {
    const rawName = `--${m[1]}`;
    const value = (m[2] ?? '').trim();
    if (rawName in tokens) continue;

    const label = humanLabel(rawName);

    if (COLOR_VALUE_RE.test(value)) {
      tokens[rawName] = { kind: 'color', label };
      continue;
    }

    const numMatch = value.match(NUMERIC_VALUE_RE);
    if (numMatch) {
      const n = Number(numMatch[1]);
      const unit = numMatch[2] ?? '';
      const entry: TweakSchemaEntry = { kind: 'number', label };
      if (unit) entry.unit = unit;
      // Sensible bounds per unit. Designers typically stay within these
      // ranges; the agent can override to widen.
      if (unit === 'px') {
        entry.min = 0;
        entry.max = Math.max(64, Math.ceil(n * 2));
        entry.step = 1;
      } else if (unit === 'rem' || unit === 'em') {
        entry.min = 0;
        entry.max = Math.max(4, Math.ceil(n * 2));
        entry.step = 0.05;
      } else if (unit === '%') {
        entry.min = 0;
        entry.max = 100;
        entry.step = 1;
      } else if (unit === 's' || unit === 'ms') {
        entry.min = 0;
        entry.max = unit === 's' ? Math.max(2, Math.ceil(n * 4)) : Math.max(1000, Math.ceil(n * 4));
        entry.step = unit === 's' ? 0.05 : 10;
      } else {
        entry.min = 0;
        entry.max = Math.max(100, Math.ceil(Math.abs(n) * 4));
        entry.step = Number.isInteger(n) ? 1 : 0.1;
      }
      tokens[rawName] = entry;
      continue;
    }

    if (rawName.includes('font') && FONT_STACK_RE.test(value)) {
      const options = value
        .split(',')
        .map((s) => s.replace(/['"]/g, '').trim())
        .filter(Boolean);
      tokens[rawName] = { kind: 'enum', label, options };
      continue;
    }

    if (value === 'true' || value === 'false') {
      tokens[rawName] = { kind: 'boolean', label };
      continue;
    }

    tokens[rawName] = { kind: 'string', label, placeholder: value };
  }

  return { version: 1, tokens };
}

function humanLabel(rawName: string): string {
  return rawName
    .replace(/^--/, '')
    .split('-')
    .map((w) => (w.length === 0 ? '' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// ── Helpers ──────────────────────────────────────────────────────────────

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
