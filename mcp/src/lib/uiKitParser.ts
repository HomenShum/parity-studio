/**
 * Lenient parser for the LLM-emitted ui_kit response. Same shape as
 * convex/lib/uiKitParser.ts. Recognizes:
 *   ```html path=ui_kits/<slug>/index.html ... ```
 *   ```tsx path=ui_kits/<slug>/components/Sidebar.tsx ... ```
 *   first-line `// path: ...` / `# path: ...` / `<!-- path: ... -->` fallbacks
 */

export interface ParsedUiKit {
  slug: string;
  files: Record<string, string>;
  warnings: string[];
}

const PATH_LANGS = new Set(['html', 'tsx', 'ts', 'jsx', 'js', 'css', 'json', 'md', 'svg', 'txt']);

function deriveSlug(paths: string[], fallback: string): string {
  for (const p of paths) {
    const m = p.match(/^ui_kits\/([^/]+)\//);
    if (m?.[1]) return m[1];
  }
  return fallback;
}

export function parseUiKitResponse(raw: string, fallbackSlug = 'untitled'): ParsedUiKit {
  const warnings: string[] = [];
  const files: Record<string, string> = {};
  const fenceRe = /```([a-z]+)?\s*(?:path\s*=\s*([^\s`]+))?\s*\n([\s\S]*?)```/gi;

  let match: RegExpExecArray | null = fenceRe.exec(raw);
  while (match !== null) {
    const lang = (match[1] ?? '').toLowerCase();
    let path = match[2];
    let body = match[3] ?? '';

    if (path === undefined) {
      const lines = body.split('\n');
      const first = (lines[0] ?? '').trim();
      const inlineMatch = first.match(/^(?:\/\/|#|<!--)\s*path\s*[:=]\s*([^\s>]+)/i);
      if (inlineMatch?.[1]) {
        path = inlineMatch[1];
        body = lines.slice(1).join('\n');
      }
    }

    if (path === undefined) {
      if (lang && PATH_LANGS.has(lang)) {
        warnings.push(`fenced block of type "${lang}" has no path; skipping`);
      }
    } else {
      const cleanPath = path.replace(/^\.?\/+/, '').replace(/\.\.\//g, '');
      files[cleanPath] = body.trimEnd();
    }
    match = fenceRe.exec(raw);
  }

  if (Object.keys(files).length === 0) {
    warnings.push('no fenced code blocks with paths found in response');
  }

  return { slug: deriveSlug(Object.keys(files), fallbackSlug), files, warnings };
}
