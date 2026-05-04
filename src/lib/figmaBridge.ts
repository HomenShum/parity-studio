export interface FigmaBridgeToken {
  name: string;
  value: string;
  type: 'color' | 'spacing' | 'radius' | 'typography' | 'shadow' | 'other';
  source?: string;
}

export interface FigmaBridgeComponent {
  name: string;
  path: string;
  kind: 'component' | 'page' | 'token' | 'asset';
  summary: string;
}

export interface FigmaBridgeFrame {
  id: string;
  name: string;
  slug: string;
  width: number;
  height: number;
  background: string;
  sourcePath: string;
  htmlPreview: string;
  text: string[];
  components: FigmaBridgeComponent[];
}

export interface FigmaBridgePage {
  name: string;
  frames: FigmaBridgeFrame[];
}

export interface FigmaBridgePayload {
  schemaVersion: 1;
  generator: 'parity-studio';
  mode: 'figma-bridge';
  exportedAt: string;
  source: {
    slug: string;
    runId?: string;
    activeSurface?: string | null;
  };
  tokens: FigmaBridgeToken[];
  components: FigmaBridgeComponent[];
  pages: FigmaBridgePage[];
  plugin: {
    instructions: string[];
    limitations: string[];
  };
  roundTrip: {
    parityImport: 'drop-zip-or-json';
    canonicalRoot: string;
  };
}

export interface FigmaBridgeBuildOptions {
  runId?: string;
  activeSurface?: string | null;
  exportedAt?: string;
}

export interface FigmaImportResult {
  slug: string;
  files: Record<string, string>;
  warnings: string[];
}

const DEFAULT_FRAME_WIDTH = 1440;
const DEFAULT_FRAME_HEIGHT = 900;
const JSON_LIMIT = 180_000;
const FIGMA_BRIDGE_NAMES = new Set([
  'figma.bridge.json',
  'parity-figma-bridge.json',
  'figma/parity-figma-bridge.json',
  'figma/figma.bridge.json',
]);

export function isLikelyFigmaBridgePath(path: string): boolean {
  return FIGMA_BRIDGE_NAMES.has(path.replace(/\\/g, '/').toLowerCase());
}

export function isParityFigmaBridge(value: unknown): value is FigmaBridgePayload {
  const maybe = value as Partial<FigmaBridgePayload> | null;
  return Boolean(
    maybe &&
      maybe.schemaVersion === 1 &&
      maybe.generator === 'parity-studio' &&
      maybe.mode === 'figma-bridge' &&
      Array.isArray(maybe.pages),
  );
}

export function parseFigmaBridgeJson(raw: string): unknown {
  const parsed = JSON.parse(raw) as unknown;
  if (isParityFigmaBridge(parsed)) return parsed;
  if (isFigmaRestDocument(parsed)) return parsed;
  throw new Error(
    'Unsupported Figma import JSON. Drop a Parity Figma bridge JSON/ZIP or a Figma REST file JSON with document.children.',
  );
}

export function buildFigmaBridge(
  files: Record<string, string>,
  slug: string,
  options: FigmaBridgeBuildOptions = {},
): FigmaBridgePayload {
  const cleanSlug = slugify(slug || 'imported-design');
  const root = `ui_kits/${cleanSlug}/`;
  const indexPath =
    files[`${root}index.html`] !== undefined
      ? `${root}index.html`
      : findEntryHtml(files, cleanSlug);
  const indexHtml = indexPath ? (files[indexPath] ?? '') : '';
  const css = collectCss(files, cleanSlug);
  const tokens = parseCssTokens(css);
  const components = extractComponents(files, cleanSlug);
  const text = extractTextSnippets(indexHtml, 18);
  const background = firstColor(tokens) ?? '#FAF7F3';
  const frame: FigmaBridgeFrame = {
    id: `frame-${cleanSlug}`,
    name: humanize(cleanSlug),
    slug: cleanSlug,
    width: inferWidth(indexHtml),
    height: inferHeight(indexHtml),
    background,
    sourcePath: indexPath ?? `${root}index.html`,
    htmlPreview: indexHtml.slice(0, 24_000),
    text,
    components,
  };

  return {
    schemaVersion: 1,
    generator: 'parity-studio',
    mode: 'figma-bridge',
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    source: {
      slug: cleanSlug,
      ...(options.runId ? { runId: options.runId } : {}),
      activeSurface: options.activeSurface ?? null,
    },
    tokens,
    components,
    pages: [{ name: humanize(cleanSlug), frames: [frame] }],
    plugin: {
      instructions: [
        'In Figma, open Plugins > Development > Import plugin from manifest and select figma/manifest.json.',
        'Run the plugin and click Import Parity frames.',
        'Review generated pages, token swatches, paint styles, and component guide frames before handing to designers.',
        'For production implementation, keep ui_kits/<slug>/ as the source-of-truth code contract.',
      ],
      limitations: [
        'The bridge creates editable Figma frames, token swatches, paint styles, and component guide cards from the Parity kit.',
        'It does not claim pixel-perfect vector reconstruction of arbitrary HTML/CSS layout; Parity remains the code-first source of truth.',
        'Complex component variants should be refined in Figma after import, then exported back as a new bridge JSON or annotated handoff.',
      ],
    },
    roundTrip: {
      parityImport: 'drop-zip-or-json',
      canonicalRoot: root,
    },
  };
}

export function buildFigmaBridgeFiles(
  files: Record<string, string>,
  slug: string,
  options: FigmaBridgeBuildOptions = {},
): Record<string, string> {
  const bridge = buildFigmaBridge(files, slug, options);
  const bridgeJson = `${JSON.stringify(bridge, null, 2)}\n`;
  const cleanSlug = bridge.source.slug;
  return {
    [`ui_kits/${cleanSlug}/figma.bridge.json`]: bridgeJson,
    'figma/parity-figma-bridge.json': bridgeJson,
    'figma/tokens.json': `${JSON.stringify({ schemaVersion: 1, tokens: bridge.tokens }, null, 2)}\n`,
    'figma/manifest.json': `${JSON.stringify(buildPluginManifest(cleanSlug), null, 2)}\n`,
    'figma/code.js': buildPluginCode(),
    'figma/ui.html': buildPluginUi(bridge),
    'figma/import-to-figma.md': buildImportInstructions(cleanSlug),
    'figma/README.md': buildFigmaReadme(cleanSlug),
  };
}

export function filesFromFigmaPayload(
  value: unknown,
  fallbackSlug = 'figma-import',
): FigmaImportResult {
  if (isParityFigmaBridge(value)) return filesFromParityBridge(value, fallbackSlug);
  if (isFigmaRestDocument(value)) return filesFromFigmaRestDocument(value, fallbackSlug);
  throw new Error(
    'Unsupported Figma payload. Expected Parity bridge JSON or Figma REST document JSON.',
  );
}

function filesFromParityBridge(
  bridge: FigmaBridgePayload,
  fallbackSlug: string,
): FigmaImportResult {
  const slug = slugify(bridge.source.slug || fallbackSlug);
  const root = `ui_kits/${slug}/`;
  const html = htmlFromBridge(bridge, slug);
  const tokensCss = cssFromTokens(bridge.tokens);
  const manifest = {
    schemaVersion: 1,
    slug,
    source: 'figma-bridge',
    index: `${root}index.html`,
    importedAt: new Date().toISOString(),
  };
  const files: Record<string, string> = {
    [`${root}index.html`]: html,
    [`${root}tokens.css`]: tokensCss,
    [`${root}manifest.json`]: `${JSON.stringify(manifest, null, 2)}\n`,
    [`${root}figma.bridge.json`]: `${JSON.stringify(bridge, null, 2)}\n`,
    [`${root}README.md`]: `# ${slug}\n\nImported from a Parity Studio Figma bridge. Use this kit as the editable code contract after reviewing the generated Figma frames.\n`,
    'parity.project.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        generator: 'parity-studio',
        activeSurface: slug,
        source: { format: 'project-pack', importedAt: new Date().toISOString() },
        surfaces: [
          {
            slug,
            label: humanize(slug),
            kind: 'design-system',
            entry: `${root}index.html`,
            defaultDevice: 'desktop',
          },
        ],
      },
      null,
      2,
    )}\n`,
  };
  return { slug, files, warnings: bridge.plugin.limitations };
}

function filesFromFigmaRestDocument(value: unknown, fallbackSlug: string): FigmaImportResult {
  const document = (value as { document: FigmaNode; name?: string }).document;
  const slug = slugify((value as { name?: string }).name ?? fallbackSlug);
  const frames = collectFigmaFrames(document).slice(0, 24);
  const tokens = tokensFromFigmaFrames(frames);
  const bridge: FigmaBridgePayload = {
    schemaVersion: 1,
    generator: 'parity-studio',
    mode: 'figma-bridge',
    exportedAt: new Date().toISOString(),
    source: { slug, activeSurface: slug },
    tokens,
    components: frames.map((frame) => ({
      name: frame.name,
      path: `figma:${frame.id ?? frame.name}`,
      kind: 'component',
      summary: `${frame.type} node imported from Figma JSON`,
    })),
    pages: [
      {
        name: humanize(slug),
        frames: frames.map((frame, index) => ({
          id: String(frame.id ?? `figma-frame-${index + 1}`),
          name: frame.name || `Frame ${index + 1}`,
          slug,
          width: Math.round(frame.absoluteBoundingBox?.width ?? DEFAULT_FRAME_WIDTH),
          height: Math.round(frame.absoluteBoundingBox?.height ?? DEFAULT_FRAME_HEIGHT),
          background: colorFromFigmaNode(frame) ?? '#FAF7F3',
          sourcePath: `figma:${frame.id ?? frame.name}`,
          htmlPreview: '',
          text: collectFigmaText(frame).slice(0, 18),
          components: [],
        })),
      },
    ],
    plugin: {
      instructions: ['Imported from Figma REST JSON into Parity Studio.'],
      limitations: [
        'Figma REST JSON does not include executable HTML; Parity generated an editable review surface from frame metadata.',
      ],
    },
    roundTrip: { parityImport: 'drop-zip-or-json', canonicalRoot: `ui_kits/${slug}/` },
  };
  const result = filesFromParityBridge(bridge, slug);
  result.files[`ui_kits/${slug}/figma.source.json`] =
    `${JSON.stringify(value, null, 2).slice(0, JSON_LIMIT)}\n`;
  return result;
}

interface FigmaNode {
  id?: string;
  name: string;
  type: string;
  characters?: string;
  absoluteBoundingBox?: { width?: number; height?: number; x?: number; y?: number };
  fills?: Array<{ type?: string; color?: { r?: number; g?: number; b?: number; a?: number } }>;
  children?: FigmaNode[];
}

function isFigmaRestDocument(value: unknown): value is { document: FigmaNode; name?: string } {
  const maybe = value as { document?: { children?: unknown } } | null;
  return Boolean(maybe?.document && Array.isArray(maybe.document.children));
}

function collectFigmaFrames(node: FigmaNode): FigmaNode[] {
  const out: FigmaNode[] = [];
  const visit = (current: FigmaNode) => {
    if (['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION', 'CANVAS'].includes(current.type)) {
      if (current.type !== 'DOCUMENT') out.push(current);
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return out.filter((frame) => frame.type !== 'CANVAS' || (frame.children?.length ?? 0) > 0);
}

function collectFigmaText(node: FigmaNode): string[] {
  const out: string[] = [];
  const visit = (current: FigmaNode) => {
    if (current.type === 'TEXT' && current.characters) out.push(current.characters.trim());
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return [...new Set(out.filter(Boolean))];
}

function tokensFromFigmaFrames(frames: FigmaNode[]): FigmaBridgeToken[] {
  const tokens: FigmaBridgeToken[] = [];
  const seen = new Set<string>();
  for (const frame of frames) {
    const color = colorFromFigmaNode(frame);
    if (!color || seen.has(color)) continue;
    seen.add(color);
    tokens.push({
      name: `figma-color-${tokens.length + 1}`,
      value: color,
      type: 'color',
      source: frame.name,
    });
  }
  return tokens;
}

function colorFromFigmaNode(node: FigmaNode): string | null {
  const fill = node.fills?.find((item) => item.type === 'SOLID' && item.color);
  if (!fill?.color) return null;
  const r = Math.round((fill.color.r ?? 0) * 255);
  const g = Math.round((fill.color.g ?? 0) * 255);
  const b = Math.round((fill.color.b ?? 0) * 255);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function buildPluginManifest(slug: string): Record<string, unknown> {
  return {
    name: `Parity Studio Import - ${humanize(slug)}`,
    id: `parity-studio-${slug}`.slice(0, 60),
    api: '1.0.0',
    main: 'code.js',
    ui: 'ui.html',
    editorType: ['figma', 'figjam'],
  };
}

function buildPluginCode(): string {
  return `'use strict';

figma.showUI(__html__, { width: 440, height: 560, themeColors: true });

figma.ui.onmessage = async (msg) => {
  if (!msg || msg.type !== 'parity-import') return;
  const bridge = msg.bridge;
  await ensureFonts();
  const created = [];
  for (const token of bridge.tokens || []) {
    if (token.type === 'color' && /^#([0-9a-f]{6})$/i.test(token.value)) {
      const style = figma.createPaintStyle();
      style.name = 'Parity/' + token.name;
      style.paints = [{ type: 'SOLID', color: hexToRgb(token.value) }];
      created.push(style.id);
    }
  }
  for (const pageData of bridge.pages || []) {
    const page = figma.createPage();
    page.name = pageData.name || 'Parity Studio';
    await figma.setCurrentPageAsync(page);
    let y = 0;
    for (const frameData of pageData.frames || []) {
      const frame = figma.createFrame();
      frame.name = frameData.name || 'Parity frame';
      frame.resize(Math.max(320, frameData.width || 1440), Math.max(320, frameData.height || 900));
      frame.x = 0;
      frame.y = y;
      frame.fills = [{ type: 'SOLID', color: hexToRgb(frameData.background || '#FAF7F3') }];
      frame.clipsContent = false;
      frame.setPluginData('parity-source-path', frameData.sourcePath || '');
      page.appendChild(frame);
      created.push(frame.id);

      const title = figma.createText();
      title.name = 'Parity title';
      title.characters = frameData.name || bridge.source?.slug || 'Parity Studio';
      title.fontSize = 42;
      title.fills = [{ type: 'SOLID', color: hexToRgb('#231A14') }];
      title.x = 48;
      title.y = 44;
      frame.appendChild(title);

      const textLines = (frameData.text || []).slice(0, 10);
      let textY = 116;
      for (const line of textLines) {
        const text = figma.createText();
        text.name = 'Parity text';
        text.characters = String(line).slice(0, 180);
        text.fontSize = textY === 116 ? 24 : 17;
        text.fills = [{ type: 'SOLID', color: hexToRgb('#4B4038') }];
        text.x = 52;
        text.y = textY;
        text.resize(Math.min(760, frame.width - 104), text.height);
        frame.appendChild(text);
        textY += textY === 116 ? 44 : 30;
      }

      const guide = figma.createFrame();
      guide.name = 'Parity component guide';
      guide.resize(Math.min(480, frame.width - 96), 220);
      guide.x = 48;
      guide.y = Math.max(260, frame.height - 280);
      guide.fills = [{ type: 'SOLID', color: hexToRgb('#FFF9F1') }];
      guide.strokes = [{ type: 'SOLID', color: hexToRgb('#E6D7C8') }];
      guide.cornerRadius = 18;
      frame.appendChild(guide);

      const guideText = figma.createText();
      guideText.name = 'Parity component list';
      guideText.characters = ['Components from ui_kit:', ...(frameData.components || []).slice(0, 8).map((c) => '- ' + c.name)].join('\\n');
      guideText.fontSize = 14;
      guideText.fills = [{ type: 'SOLID', color: hexToRgb('#3A2B22') }];
      guideText.x = 20;
      guideText.y = 20;
      guideText.resize(guide.width - 40, guide.height - 40);
      guide.appendChild(guideText);

      y += frame.height + 80;
    }
  }
  figma.ui.postMessage({ type: 'parity-import-complete', createdCount: created.length });
};

async function ensureFonts() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }).catch(async () => {
    await figma.loadFontAsync({ family: 'Arial', style: 'Regular' });
  });
}

function hexToRgb(hex) {
  const clean = String(hex || '#000000').replace('#', '');
  const value = /^[0-9a-f]{6}$/i.test(clean) ? clean : '000000';
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  };
}
`;
}

function buildPluginUi(bridge: FigmaBridgePayload): string {
  const bridgeJson = JSON.stringify(bridge).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head><meta charset="utf-8"/><style>
body{margin:0;padding:20px;font:13px Inter,Arial,sans-serif;background:#fbf7ef;color:#261b14}h1{font:600 22px Georgia,serif;margin:0 0 8px}.box{border:1px solid #e4d7c9;border-radius:14px;background:#fffaf4;padding:14px;margin:14px 0}button{border:0;border-radius:999px;background:#d95f3f;color:white;padding:10px 14px;font-weight:700;cursor:pointer}code{font:11px ui-monospace,monospace;background:#f3e7d9;border-radius:6px;padding:2px 5px}.muted{color:#7a6b60;line-height:1.45}</style></head>
<body>
<h1>Import Parity frames</h1>
<p class="muted">Creates editable Figma pages, frames, paint styles, token swatches, and component guide cards from this Parity Studio kit.</p>
<div class="box"><strong>${escapeHtml(bridge.source.slug)}</strong><br/><span class="muted">${bridge.pages.length} page(s), ${bridge.tokens.length} token(s), ${bridge.components.length} component(s)</span></div>
<button id="import">Import Parity frames</button>
<p id="status" class="muted"></p>
<script id="parity-bridge" type="application/json">${bridgeJson}</script>
<script>
const bridge = JSON.parse(document.getElementById('parity-bridge').textContent);
document.getElementById('import').onclick = () => {
  document.getElementById('status').textContent = 'Importing...';
  parent.postMessage({ pluginMessage: { type: 'parity-import', bridge } }, '*');
};
window.onmessage = (event) => {
  const msg = event.data && event.data.pluginMessage;
  if (msg && msg.type === 'parity-import-complete') {
    document.getElementById('status').textContent = 'Created ' + msg.createdCount + ' Figma objects. Review before publishing as a library.';
  }
};
</script>
</body></html>
`;
}

function buildImportInstructions(slug: string): string {
  return `# Import ${slug} into Figma

1. Unzip this export.
2. Open Figma desktop or web.
3. Go to Plugins > Development > Import plugin from manifest.
4. Select \`figma/manifest.json\` from this bundle.
5. Run \`Parity Studio Import - ${humanize(slug)}\`.
6. Click \`Import Parity frames\`.
7. Review the generated frames, paint styles, token guide, and component cards.

Round-trip back to Parity Studio by exporting \`figma/parity-figma-bridge.json\` or dropping this whole ZIP back into Parity Studio.
`;
}

function buildFigmaReadme(slug: string): string {
  return `# Figma bridge

This folder is a native Figma plugin bridge for \`${slug}\`.

- \`manifest.json\` - Figma development plugin manifest.
- \`code.js\` - Plugin code that creates frames, paint styles, text, and component guide cards.
- \`ui.html\` - Plugin UI with embedded bridge JSON.
- \`parity-figma-bridge.json\` - Round-trip payload Parity Studio can import directly.
- \`tokens.json\` - Extracted design tokens.

This is code-first Figma interoperability. The canonical \`ui_kits/${slug}/\` folder remains the source of truth for implementation.
`;
}

function htmlFromBridge(bridge: FigmaBridgePayload, slug: string): string {
  const cards = bridge.pages
    .flatMap((page) => page.frames.map((frame) => ({ page: page.name, frame })))
    .map(({ page, frame }) => {
      const lines = frame.text
        .slice(0, 8)
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join('');
      const components = frame.components
        .slice(0, 8)
        .map((component) => `<span>${escapeHtml(component.name)}</span>`)
        .join('');
      return `<article class="frame-card"><p class="eyebrow">${escapeHtml(page)}</p><h2>${escapeHtml(frame.name)}</h2><ul>${lines}</ul><div class="chips">${components}</div></article>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(slug)} - Figma import</title><link rel="stylesheet" href="tokens.css"/><style>body{margin:0;background:var(--figma-bg,#fbf7ef);color:var(--figma-text,#2c211a);font-family:var(--figma-font,Inter,system-ui,sans-serif)}main{padding:40px;max-width:1180px;margin:0 auto}.eyebrow{font:11px ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:#8a7667}h1{font:500 46px Georgia,serif;margin:8px 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}.frame-card{border:1px solid #e3d4c4;border-radius:22px;background:#fffaf3;padding:22px;box-shadow:0 20px 55px rgba(62,40,25,.08)}h2{margin:0 0 10px;font-size:24px}.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:16px}.chips span{border:1px solid #eadccc;border-radius:999px;padding:5px 9px;background:#fbefe4;font-size:12px}</style></head><body><main><p class="eyebrow">Parity Studio Figma bridge</p><h1>${escapeHtml(humanize(slug))}</h1><p>Imported from Figma bridge metadata. Use this surface to continue comments, edits, verification, and export inside Parity Studio.</p><section class="grid">${cards || '<article class="frame-card"><h2>No frames</h2><p>Bridge payload contained no frames.</p></article>'}</section></main></body></html>`;
}

export function parseCssTokens(css: string): FigmaBridgeToken[] {
  const tokens: FigmaBridgeToken[] = [];
  const re = /--([a-zA-Z0-9-_]+)\s*:\s*([^;]+);/g;
  for (const match of css.matchAll(re)) {
    const name = match[1]?.trim();
    const value = match[2]?.trim();
    if (!name || !value) continue;
    tokens.push({ name, value, type: tokenType(name, value), source: 'tokens.css' });
  }
  return tokens.slice(0, 240);
}

function tokenType(name: string, value: string): FigmaBridgeToken['type'] {
  const lower = `${name} ${value}`.toLowerCase();
  if (/#[0-9a-f]{3,8}|rgb\(|hsl\(|color|accent|background|border|fill/.test(lower)) return 'color';
  if (/shadow|box-shadow/.test(lower)) return 'shadow';
  if (/radius|rounded/.test(lower)) return 'radius';
  if (/font|type|leading|tracking|line-height/.test(lower)) return 'typography';
  if (/space|spacing|gap|size|padding|margin|\d(px|rem|em)/.test(lower)) return 'spacing';
  return 'other';
}

function cssFromTokens(tokens: FigmaBridgeToken[]): string {
  const lines = [':root {'];
  for (const token of tokens) lines.push(`  --${cssName(token.name)}: ${token.value};`);
  lines.push('  --figma-bg: #fbf7ef;', '  --figma-text: #2c211a;', '}', '');
  return lines.join('\n');
}

function extractComponents(files: Record<string, string>, slug: string): FigmaBridgeComponent[] {
  const root = `ui_kits/${slug}/`;
  return Object.entries(files)
    .filter(([path]) => path.startsWith(root) && /\.(tsx|jsx|ts|js|html|css|svg)$/i.test(path))
    .slice(0, 80)
    .map(([path, content]) => ({
      name: componentNameFromPath(path),
      path,
      kind: componentKind(path),
      summary: summarizeText(content),
    }));
}

function componentKind(path: string): FigmaBridgeComponent['kind'] {
  if (/tokens|styles|css/i.test(path)) return 'token';
  if (/assets|\.svg$/i.test(path)) return 'asset';
  if (/index\.html$/i.test(path)) return 'page';
  return 'component';
}

function collectCss(files: Record<string, string>, slug: string): string {
  const root = `ui_kits/${slug}/`;
  return Object.entries(files)
    .filter(
      ([path]) =>
        path === 'colors_and_type.css' || (path.startsWith(root) && path.endsWith('.css')),
    )
    .map(([, value]) => value)
    .join('\n');
}

function findEntryHtml(files: Record<string, string>, slug: string): string | null {
  const root = `ui_kits/${slug}/`;
  const first = Object.keys(files)
    .filter((path) => path.startsWith(root) && path.endsWith('.html'))
    .sort()[0];
  return first ?? null;
}

function extractTextSnippets(html: string, limit: number): string[] {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((item) => item.trim().replace(/\s+/g, ' '))
    .filter((item) => item.length >= 3 && item.length <= 180);
  return [...new Set(stripped)].slice(0, limit);
}

function summarizeText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function inferWidth(html: string): number {
  if (/mobile|phone|iphone/i.test(html)) return 390;
  if (/tablet|ipad/i.test(html)) return 768;
  return DEFAULT_FRAME_WIDTH;
}

function inferHeight(html: string): number {
  if (/mobile|phone|iphone/i.test(html)) return 844;
  return DEFAULT_FRAME_HEIGHT;
}

function firstColor(tokens: FigmaBridgeToken[]): string | null {
  const token = tokens.find((item) => item.type === 'color' && /^#[0-9a-f]{6}$/i.test(item.value));
  return token?.value ?? null;
}

function componentNameFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.(tsx|jsx|ts|js|html|css|svg)$/i, '').replace(/[-_]+/g, ' ');
}

function humanize(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function slugify(value: string): string {
  return (
    (value || 'figma-import')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'figma-import'
  );
}

function cssName(value: string): string {
  return slugify(value).replace(/^-+/, '');
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
