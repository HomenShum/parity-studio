/**
 * Parse the LLM-emitted ui_kit response into a structured file tree.
 *
 * The decompose prompt instructs the model to emit a series of fenced code
 * blocks, each preceded by a path attribute on the opening fence:
 *
 *   ```html path=ui_kits/saas-dashboard/index.html
 *   <!doctype html>...
 *   ```
 *
 *   ```tsx path=ui_kits/saas-dashboard/components/Sidebar.tsx
 *   export function Sidebar() { ... }
 *   ```
 *
 * This parser is intentionally lenient: leading-whitespace tolerant, accepts
 * `path=...` and inline `// path: ...` / `# path: ...` / `<!-- path: ... -->`
 * fallbacks. Models drift in formatting and we want to recover what we can
 * rather than fail hard.
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

  const slug = deriveSlug(Object.keys(files), fallbackSlug);
  return { slug, files, warnings };
}

/** Tree node for the FilesPanel. Pure data, no DOM. */
export interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children: TreeNode[]; // empty for files
}

/**
 * Convert a flat path-keyed file map into a directory tree, sort-stable.
 * Directories come first, then files; both alphabetically. Pure recursive
 * build — no Proxy, no mutation tricks.
 */
export function filesToTree(files: Record<string, string>): TreeNode[] {
  // group: top segment -> { path: string; isLeaf: boolean; rest: string[] }[]
  const byTop = new Map<string, Array<{ fullPath: string; rest: string[] }>>();

  for (const fullPath of Object.keys(files).sort()) {
    const parts = fullPath.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    const top = parts[0] as string;
    if (!byTop.has(top)) byTop.set(top, []);
    byTop.get(top)?.push({ fullPath, rest: parts.slice(1) });
  }

  const nodes: TreeNode[] = [];
  for (const [top, entries] of byTop) {
    const isFile = entries.length === 1 && entries[0]?.rest.length === 0;
    const path = isFile ? top : `${top}/`;
    const node: TreeNode = { name: top, path, isFile, children: [] };

    if (!isFile) {
      // Reconstruct child file map by stripping the top segment, recurse
      const childMap: Record<string, string> = {};
      for (const e of entries) {
        if (e.rest.length === 0) continue;
        const childPath = e.rest.join('/');
        const original = files[e.fullPath];
        if (original !== undefined) childMap[childPath] = original;
      }
      node.children = filesToTree(childMap);
    }

    nodes.push(node);
  }

  // Stable sort: directories before files, then alphabetical
  nodes.sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}
