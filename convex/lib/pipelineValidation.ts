import type { ParsedUiKit } from './uiKitParser';

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function normalizeHtmlArtifact(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/i);
  const unfenced = (fenceMatch?.[1] ?? trimmed).trim();

  const docStart = unfenced.search(/(?:<!doctype\s+html\b|<html\b)/i);
  const htmlClose = unfenced.match(/<\/html\s*>/i);
  if (docStart >= 0 && htmlClose?.index !== undefined) {
    return unfenced.slice(docStart, htmlClose.index + htmlClose[0].length).trim();
  }
  if (docStart >= 0) {
    let doc = unfenced.slice(docStart).trim();
    if (!/<body\b/i.test(doc) && /<(main|section|article|header|nav|footer|div)\b/i.test(doc)) {
      doc = doc.replace(/(<\/head\s*>)/i, '$1\n<body>');
      if (!/<body\b/i.test(doc)) doc = doc.replace(/<html\b([^>]*)>/i, '<html$1><body>');
    }
    if (/<body\b/i.test(doc) && !/<\/body\s*>/i.test(doc)) doc += '\n</body>';
    if (!/<\/html\s*>/i.test(doc)) doc += '\n</html>';
    return doc.trim();
  }
  if (/<(main|section|article|header|nav|footer|div)\b/i.test(unfenced)) {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
${unfenced}
</body>
</html>`;
  }
  return unfenced;
}

function stripTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateGeneratedHtml(html: string): ValidationResult {
  const normalized = normalizeHtmlArtifact(html);
  if (normalized.length < 700) {
    return { ok: false, reason: `generated HTML is too small (${normalized.length} chars)` };
  }
  if (
    !/<html\b/i.test(normalized) ||
    !/<body\b/i.test(normalized) ||
    !/<\/html\s*>/i.test(normalized)
  ) {
    return { ok: false, reason: 'generated output is not a complete HTML document' };
  }
  if (!/<style\b/i.test(normalized)) {
    return { ok: false, reason: 'generated output is missing inline CSS' };
  }
  const visibleText = stripTags(normalized);
  if (visibleText.length < 120) {
    return { ok: false, reason: 'generated output has too little visible text' };
  }
  const sectioningTags = ['header', 'main', 'section', 'nav', 'footer', 'aside', 'article'];
  const sectioningCount = sectioningTags.reduce((sum, tag) => {
    const re = new RegExp(`<${tag}\\b`, 'gi');
    return sum + (normalized.match(re) ?? []).length;
  }, 0);
  if (sectioningCount < 3) {
    return { ok: false, reason: 'generated output lacks enough semantic product structure' };
  }
  if (/^(i\s+can('|no)t|sorry|as an ai|i am unable)\b/i.test(visibleText)) {
    return { ok: false, reason: 'generated output appears to be a refusal/commentary, not HTML' };
  }
  return { ok: true };
}

function fileBySuffix(files: Record<string, string>, suffix: string): string | null {
  const found = Object.entries(files).find(([path]) => path.endsWith(suffix));
  return found?.[1] ?? null;
}

export function validateParsedUiKit(parsed: ParsedUiKit): ValidationResult {
  const paths = Object.keys(parsed.files);
  if (paths.length < 5) {
    return { ok: false, reason: `ui_kit has too few files (${paths.length})` };
  }
  const indexHtml = fileBySuffix(parsed.files, '/index.html') ?? parsed.files['index.html'];
  if (!indexHtml) {
    return { ok: false, reason: 'ui_kit is missing index.html' };
  }
  if (indexHtml.length < 500) {
    return { ok: false, reason: `ui_kit index.html is too small (${indexHtml.length} chars)` };
  }
  if (!/<(?:html|main|section|div|body)\b/i.test(indexHtml)) {
    return { ok: false, reason: 'ui_kit index.html does not contain renderable markup' };
  }
  // tokens.css and manifest.json are required in the exported canonical
  // shape, but missing ones are repairable by the pipeline scaffold. Do
  // not fail an otherwise renderable kit here.
  return { ok: true };
}
