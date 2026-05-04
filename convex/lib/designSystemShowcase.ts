export interface DesignSystemShowcaseOptions {
  exportedAt?: string;
}

export interface ShowcaseToken {
  name: string;
  value: string;
  type: 'color' | 'spacing' | 'radius' | 'typography' | 'shadow' | 'other';
  source: string;
}

export function buildDesignSystemShowcaseFiles(
  files: Record<string, string>,
  slug: string,
  options: DesignSystemShowcaseOptions = {},
): Record<string, string> {
  const cleanSlug = slugify(slug || 'imported-design');
  const tokens = collectTokens(files, cleanSlug);
  const components = collectComponents(files, cleanSlug);
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    generator: 'parity-studio',
    mode: 'design-system-showcase',
    slug: cleanSlug,
    exportedAt,
    tokens,
    components,
    roundTrip: {
      parityImport: 'drop-zip-or-json',
      canonicalRoot: `ui_kits/${cleanSlug}/`,
    },
  };
  const html = buildShowcaseHtml(cleanSlug, tokens, components);
  return {
    'design-system/tokens.json': `${JSON.stringify(payload, null, 2)}\n`,
    'design-system/showcase.html': html,
    [`ui_kits/${cleanSlug}/design-system-showcase.html`]: html,
  };
}

function collectTokens(files: Record<string, string>, slug: string): ShowcaseToken[] {
  const entries = Object.entries(files).filter(
    ([path]) =>
      path === 'colors_and_type.css' ||
      path === `ui_kits/${slug}/tokens.css` ||
      /^ui_kits\/[^/]+\/tokens\.css$/i.test(path),
  );
  const out: ShowcaseToken[] = [];
  const seen = new Set<string>();
  for (const [source, css] of entries) {
    for (const match of css.matchAll(/--([a-z0-9][a-z0-9-_]*)\s*:\s*([^;]+);/gi)) {
      const name = match[1]?.trim();
      const value = match[2]?.trim();
      if (!name || !value) continue;
      const key = `${name}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, value, type: classifyToken(name, value), source });
    }
  }
  return out.slice(0, 160);
}

function collectComponents(files: Record<string, string>, slug: string) {
  return Object.keys(files)
    .filter((path) =>
      new RegExp(`^ui_kits/${escapeRegExp(slug)}/components/.+\\.(tsx|jsx|ts|js)$`, 'i').test(path),
    )
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 80)
    .map((path) => {
      const name = (path.split('/').pop() ?? path).replace(/\.(tsx|jsx|ts|js)$/i, '');
      return {
        name,
        path,
        kind: inferComponentKind(name),
      };
    });
}

function buildShowcaseHtml(
  slug: string,
  tokens: ShowcaseToken[],
  components: ReturnType<typeof collectComponents>,
): string {
  const colors = tokens.filter((token) => token.type === 'color').slice(0, 36);
  const spacing = tokens.filter((token) => token.type === 'spacing').slice(0, 24);
  const radii = tokens.filter((token) => token.type === 'radius').slice(0, 18);
  const typography = tokens.filter((token) => token.type === 'typography').slice(0, 24);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(humanize(slug))} design system showcase</title>
<style>
${baseCss()}
</style>
</head>
<body>
<main class="shell">
  <section class="hero">
    <span class="eyebrow">Parity Studio design-system showcase</span>
    <h1>${escapeHtml(humanize(slug))}</h1>
    <p>Generated from the same ui_kit files that agents edit, verify, export, and bridge into Figma. Use this page as the design-system inspection surface before applying production code deltas.</p>
    <div class="stats">
      <span>${tokens.length} tokens</span>
      <span>${components.length} components</span>
      <span>Figma bridge ready</span>
    </div>
  </section>
  <section class="panel">
    <div class="section-head">
      <h2>Color tokens</h2>
      <p>Brand, semantic, and state colors extracted from tokens.css.</p>
    </div>
    <div class="swatches">
      ${colors.map((token) => `<article class="swatch"><div class="fill" style="background:${escapeStyle(token.value)}"></div><strong>--${escapeHtml(token.name)}</strong><span>${escapeHtml(token.value)}</span></article>`).join('\n      ') || '<p class="empty">No color tokens found yet.</p>'}
    </div>
  </section>
  <section class="grid two">
    <div class="panel">
      <div class="section-head"><h2>Spacing</h2><p>Density and layout rhythm.</p></div>
      ${tokenList(spacing)}
    </div>
    <div class="panel">
      <div class="section-head"><h2>Radius</h2><p>Corner language across cards and controls.</p></div>
      ${tokenList(radii)}
    </div>
  </section>
  <section class="grid two">
    <div class="panel">
      <div class="section-head"><h2>Typography</h2><p>Type families, tracking, leading, and size aliases.</p></div>
      ${tokenList(typography)}
    </div>
    <div class="panel">
      <div class="section-head"><h2>Component inventory</h2><p>Editable surfaces the agent can map back to production files.</p></div>
      ${componentList(components)}
    </div>
  </section>
</main>
</body>
</html>
`;
}

function tokenList(tokens: ShowcaseToken[]): string {
  if (tokens.length === 0) return '<p class="empty">No tokens found yet.</p>';
  return `<div class="rows">${tokens
    .map(
      (token) =>
        `<div class="row"><code>--${escapeHtml(token.name)}</code><span>${escapeHtml(token.value)}</span></div>`,
    )
    .join('\n')}</div>`;
}

function componentList(components: ReturnType<typeof collectComponents>): string {
  if (components.length === 0) return '<p class="empty">No components found yet.</p>';
  return `<div class="rows">${components
    .map(
      (component) =>
        `<div class="row"><code>${escapeHtml(component.name)}</code><span>${escapeHtml(component.kind)} / ${escapeHtml(component.path)}</span></div>`,
    )
    .join('\n')}</div>`;
}

function classifyToken(name: string, value: string): ShowcaseToken['type'] {
  const lower = `${name} ${value}`.toLowerCase();
  if (/#[0-9a-f]{3,8}|rgb\(|hsl\(|oklch\(|color|accent|brand|surface|background|border/.test(lower))
    return 'color';
  if (/space|spacing|gap|padding|margin|size/.test(lower)) return 'spacing';
  if (/radius|rounded|corner/.test(lower)) return 'radius';
  if (/font|type|text|tracking|leading|letter|line-height/.test(lower)) return 'typography';
  if (/shadow|elevation|blur/.test(lower)) return 'shadow';
  return 'other';
}

function inferComponentKind(name: string): string {
  const lower = name.toLowerCase();
  if (/nav|header|footer|sidebar/.test(lower)) return 'layout';
  if (/button|input|select|toggle|composer/.test(lower)) return 'control';
  if (/card|panel|tile|item/.test(lower)) return 'container';
  if (/hero|page|view|screen/.test(lower)) return 'surface';
  return 'component';
}

function baseCss(): string {
  return `:root {
  color-scheme: light;
  --bg: #faf7f3;
  --surface: #fffaf4;
  --ink: #2f2722;
  --muted: #776b60;
  --line: rgba(69, 49, 35, 0.12);
  --accent: #d85f42;
  --accent-soft: #f7e4dc;
}
* { box-sizing: border-box; }
body { margin: 0; background: radial-gradient(circle at 20% 0%, #fff7ee, var(--bg) 36%, #f3ece1 100%); color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.shell { width: min(1180px, calc(100vw - 48px)); margin: 0 auto; padding: 52px 0 72px; }
.hero { padding: 34px; border: 1px solid var(--line); border-radius: 28px; background: linear-gradient(135deg, rgba(255,255,255,0.82), rgba(255,248,239,0.64)); box-shadow: 0 22px 70px rgba(55, 37, 23, 0.08); }
.eyebrow { display: inline-block; margin-bottom: 12px; color: var(--accent); font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.18em; text-transform: uppercase; }
h1, h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-weight: 500; }
h1 { font-size: clamp(42px, 7vw, 88px); line-height: 0.94; max-width: 820px; }
h2 { font-size: 28px; }
p { color: var(--muted); max-width: 760px; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
.stats span { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 8px 12px; font-weight: 700; color: var(--ink); }
.grid { display: grid; gap: 18px; margin-top: 18px; }
.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.panel { margin-top: 18px; border: 1px solid var(--line); border-radius: 22px; background: rgba(255, 252, 247, 0.86); padding: 22px; box-shadow: 0 10px 34px rgba(55, 37, 23, 0.05); }
.section-head { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
.section-head p { margin: 0; max-width: 420px; font-size: 13px; }
.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.swatch { border: 1px solid var(--line); border-radius: 18px; background: #fff; padding: 10px; min-width: 0; }
.fill { height: 92px; border-radius: 13px; border: 1px solid rgba(0,0,0,0.06); margin-bottom: 10px; }
.swatch strong, .swatch span, code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.swatch strong { display: block; font-size: 12px; }
.swatch span { display: block; color: var(--muted); font-size: 11px; }
.rows { display: grid; gap: 8px; }
.row { display: grid; grid-template-columns: minmax(120px, 0.55fr) minmax(0, 1fr); gap: 12px; align-items: center; border: 1px solid var(--line); border-radius: 14px; background: #fff; padding: 10px 12px; }
code { color: var(--accent); font: 700 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
.row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
.empty { margin: 0; color: var(--muted); }
@media (max-width: 800px) { .shell { width: min(100vw - 28px, 1180px); padding-top: 28px; } .hero { padding: 24px; border-radius: 22px; } .two { grid-template-columns: 1fr; } .section-head { display: block; } .row { grid-template-columns: 1fr; } }`;
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'imported-design'
  );
}

function humanize(value: string): string {
  return slugify(value)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeStyle(value: string): string {
  const trimmed = value.trim();
  if (
    /^(#[0-9a-f]{3,8}|rgb\([^)]*\)|rgba\([^)]*\)|hsl\([^)]*\)|hsla\([^)]*\)|oklch\([^)]*\)|[a-z]+)$/i.test(
      trimmed,
    )
  ) {
    return trimmed;
  }
  return '#f2e7dc';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
