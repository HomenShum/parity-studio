import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';

const DEFAULT_EXTENSIONS = new Set([
  '.astro',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.scss',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
]);

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.vercel',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

export interface CodeContextOptions {
  projectRoot: string;
  maxFiles?: number;
  maxBytes?: number;
  maxFileBytes?: number;
}

export interface CodeContextResult {
  root: string;
  filesRead: number;
  bytesRead: number;
  skipped: string[];
  text: string;
}

export async function collectCodeContext(
  options: CodeContextOptions,
): Promise<CodeContextResult> {
  const root = resolve(options.projectRoot);
  const maxFiles = options.maxFiles ?? 60;
  const maxBytes = options.maxBytes ?? 120_000;
  const maxFileBytes = options.maxFileBytes ?? 12_000;
  const selected: string[] = [];
  const skipped: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (selected.length >= maxFiles) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (selected.length >= maxFiles) break;
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          skipped.push(`${rel}/`);
          continue;
        }
        await walk(abs);
      } else if (entry.isFile() && shouldInclude(entry.name)) {
        selected.push(abs);
      }
    }
  }

  await walk(root);

  let bytesRead = 0;
  let filesRead = 0;
  const chunks: string[] = [];
  for (const abs of selected) {
    if (bytesRead >= maxBytes) break;
    const rel = relative(root, abs).replace(/\\/g, '/');
    const info = await stat(abs).catch(() => null);
    if (!info || info.size > maxFileBytes * 2) {
      skipped.push(rel);
      continue;
    }
    const raw = await readFile(abs, 'utf8').catch(() => null);
    if (raw === null) {
      skipped.push(rel);
      continue;
    }
    const remaining = maxBytes - bytesRead;
    const body = raw.slice(0, Math.min(maxFileBytes, remaining));
    bytesRead += Buffer.byteLength(body, 'utf8');
    filesRead += 1;
    chunks.push(`--- file: ${rel}\n${body}${raw.length > body.length ? '\n/* truncated */' : ''}`);
  }

  return {
    root,
    filesRead,
    bytesRead,
    skipped,
    text: chunks.join('\n\n'),
  };
}

function shouldInclude(name: string): boolean {
  if (name === 'package.json' || name === 'tailwind.config.js' || name === 'vite.config.ts') {
    return true;
  }
  const base = basename(name).toLowerCase();
  if (base.startsWith('.env')) return false;
  if (
    base.endsWith('.pem') ||
    base.endsWith('.key') ||
    base.endsWith('.p12') ||
    base.endsWith('.pfx') ||
    base.includes('secret') ||
    base.includes('credential')
  ) {
    return false;
  }
  return DEFAULT_EXTENSIONS.has(extname(name).toLowerCase());
}
