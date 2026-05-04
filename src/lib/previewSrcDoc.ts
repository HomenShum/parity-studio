import type { ProjectSurface } from './projectSurfaces';

const EXTERNAL_URL_RE = /^(https?:|data:|blob:|about:|mailto:|tel:|#|javascript:)/i;

export function buildSurfacePreviewHtml({
  html,
  files,
  surface,
  tokensCss,
}: {
  html: string;
  files: Record<string, string>;
  surface: ProjectSurface | null;
  tokensCss: string | null;
}): string {
  const baseDir = dirname(surface?.entry ?? (surface ? `ui_kits/${surface.slug}/index.html` : ''));
  return injectLiveTokens(
    rewriteRelativeImages(
      inlineRelativeScripts(inlineRelativeStyles(html, files, baseDir), files, baseDir),
      files,
      baseDir,
    ),
    tokensCss,
  );
}

export function stripUnresolvedRelativeScripts(html: string): string {
  return html.replace(
    /<script\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
    (tag, _before: string, _quote: string, src: string) => {
      const normalized = src.trim().toLowerCase();
      if (EXTERNAL_URL_RE.test(normalized)) return tag;
      const safeSrc = src.replace(/-->/g, '');
      return `<!-- parity: stripped unresolved preview script ${safeSrc} -->`;
    },
  );
}

function injectLiveTokens(html: string, tokens: string | null): string {
  if (!tokens) return html;
  const tag = `<style data-parity-tokens="live">\n${tokens}\n</style>\n`;
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`);
  if (html.toLowerCase().includes('</head>')) return html.replace(/<\/head>/i, `${tag}</head>`);
  if (html.includes('<body')) return html.replace('<body', `${tag}<body`);
  return tag + html;
}

function inlineRelativeStyles(
  html: string,
  files: Record<string, string>,
  baseDir: string,
): string {
  return html.replace(
    /<link\b([^>]*?)\bhref=(["'])([^"']+\.css(?:\?[^"']*)?)\2([^>]*)>/gi,
    (tag, before: string, _quote: string, href: string, after: string) => {
      const path = resolveRelativePath(href, baseDir);
      if (!path) return tag;
      const css = files[path];
      if (css === undefined) return tag;
      const media = mediaAttribute(`${before} ${after}`);
      const mediaPrefix = media ? ` media="${escapeAttribute(media)}"` : '';
      return `<style data-parity-inlined="${escapeAttribute(path)}"${mediaPrefix}>\n${css}\n</style>`;
    },
  );
}

function inlineRelativeScripts(
  html: string,
  files: Record<string, string>,
  baseDir: string,
): string {
  return html.replace(
    /<script\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
    (tag, before: string, _quote: string, src: string, after: string) => {
      const path = resolveRelativePath(src, baseDir);
      if (!path) return tag;
      const source = files[path];
      if (source === undefined) return tag;
      const attrs = `${before} ${after}`.replace(/\s*\bsrc=(["']).*?\1\s*/i, ' ').trim();
      return `<script ${attrs} data-parity-inlined="${escapeAttribute(path)}">\n${source}\n</script>`;
    },
  );
}

function rewriteRelativeImages(
  html: string,
  files: Record<string, string>,
  baseDir: string,
): string {
  return html.replace(
    /\b(src|poster)=(["'])([^"']+)\2/gi,
    (match, attr: string, quote: string, value: string) => {
      const path = resolveRelativePath(value, baseDir);
      if (!path) return match;
      const content = files[path];
      if (content === undefined) return match;
      const dataUrl = textAssetDataUrl(path, content);
      if (!dataUrl) return match;
      return `${attr}=${quote}${dataUrl}${quote}`;
    },
  );
}

function resolveRelativePath(raw: string, baseDir: string): string | null {
  const withoutQuery = raw.split('?')[0]?.split('#')[0] ?? raw;
  let value = withoutQuery.trim();
  if (!value || EXTERNAL_URL_RE.test(value) || value.startsWith('//')) return null;
  // Imported app captures often preserve root-relative asset URLs such as
  // `/nodebench.css?v=12`. Inside an iframe srcDoc those would incorrectly
  // resolve against parity-studio.vercel.app, so treat them as surface-local.
  if (value.startsWith('/')) value = value.replace(/^\/+/, '');
  const parts = `${baseDir}/${value}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index) : '';
}

function textAssetDataUrl(path: string, content: string): string | null {
  if (/\.svg$/i.test(path)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
  }
  return null;
}

function mediaAttribute(attrs: string): string | null {
  const match = attrs.match(/\bmedia=(["'])([^"']+)\1/i);
  return match?.[2] ?? null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
