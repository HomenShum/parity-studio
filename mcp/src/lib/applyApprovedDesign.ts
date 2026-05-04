import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface ApprovedDesignMapping {
  fromPath: string;
  toPath: string;
  mode?: 'write' | 'append';
}

export interface ApprovedDesignOperation {
  fromPath: string;
  toPath: string;
  resolvedPath: string;
  mode: 'write' | 'append';
  sizeBytes: number;
  status: 'planned' | 'written';
}

export interface ApplyApprovedDesignInput {
  uiKitFiles: Record<string, string>;
  projectRoot: string;
  slug?: string;
  mappings?: ApprovedDesignMapping[];
  dryRun?: boolean;
}

export async function applyApprovedDesign(input: ApplyApprovedDesignInput): Promise<{
  dryRun: boolean;
  projectRoot: string;
  slug: string;
  operations: ApprovedDesignOperation[];
  writtenCount: number;
  safetyPolicy: string[];
}> {
  const root = resolve(input.projectRoot || '.');
  const slug = slugify(input.slug ?? inferSlug(input.uiKitFiles));
  const mappings =
    input.mappings && input.mappings.length > 0
      ? input.mappings
      : inferStagingMappings(input.uiKitFiles, slug);
  const operations = mappings.map((mapping) =>
    operationForMapping({
      root,
      files: input.uiKitFiles,
      mapping,
    }),
  );

  const dryRun = input.dryRun !== false;
  if (!dryRun) {
    for (const operation of operations) {
      await mkdir(dirname(operation.resolvedPath), { recursive: true });
      if (operation.mode === 'append')
        await appendFile(
          operation.resolvedPath,
          operationContent(input.uiKitFiles, operation.fromPath),
        );
      else
        await writeFile(
          operation.resolvedPath,
          operationContent(input.uiKitFiles, operation.fromPath),
        );
      operation.status = 'written';
    }
  }

  return {
    dryRun,
    projectRoot: root,
    slug,
    operations,
    writtenCount: operations.filter((operation) => operation.status === 'written').length,
    safetyPolicy: [
      'Default mode is dryRun=true.',
      'No writes outside projectRoot.',
      'No writes to .git, node_modules, .env files, or package manager lockfiles.',
      'Use explicit mappings for production component files; inferred mappings stage into .parity/approved-design/<slug>.',
    ],
  };
}

function operationForMapping({
  root,
  files,
  mapping,
}: {
  root: string;
  files: Record<string, string>;
  mapping: ApprovedDesignMapping;
}): ApprovedDesignOperation {
  if (!mapping.fromPath || files[mapping.fromPath] === undefined) {
    throw new Error(`Approved design source path not found: ${mapping.fromPath}`);
  }
  const mode = mapping.mode ?? 'write';
  if (mode !== 'write' && mode !== 'append') {
    throw new Error(`Unsupported approved design apply mode for ${mapping.toPath}: ${mode}`);
  }
  const resolvedPath = safeResolveTarget(root, mapping.toPath);
  return {
    fromPath: mapping.fromPath,
    toPath: normalizePath(mapping.toPath),
    resolvedPath,
    mode,
    sizeBytes: Buffer.byteLength(files[mapping.fromPath] ?? '', 'utf8'),
    status: 'planned',
  };
}

function operationContent(files: Record<string, string>, fromPath: string): string {
  return files[fromPath] ?? '';
}

function inferStagingMappings(
  files: Record<string, string>,
  slug: string,
): ApprovedDesignMapping[] {
  const root = `ui_kits/${slug}/`;
  const candidates = Object.keys(files)
    .filter(
      (path) =>
        path === `${root}index.html` ||
        path === `${root}tokens.css` ||
        path.startsWith(`${root}components/`) ||
        path === `${root}parity.contract.json` ||
        path === `${root}design-slug-manifest.json` ||
        path === `${root}ui-slugs.json`,
    )
    .sort((a, b) => a.localeCompare(b));
  return candidates.map((fromPath) => ({
    fromPath,
    toPath: `.parity/approved-design/${slug}/${fromPath.slice(root.length)}`,
    mode: 'write',
  }));
}

function safeResolveTarget(root: string, targetPath: string): string {
  if (!targetPath.trim()) throw new Error('Approved design target path is empty.');
  const normalized = normalizePath(targetPath);
  if (isForbiddenTarget(normalized)) {
    throw new Error(`Approved design target path is forbidden: ${targetPath}`);
  }
  const resolvedPath = isAbsolute(normalized) ? resolve(normalized) : resolve(root, normalized);
  const rel = relative(root, resolvedPath);
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Approved design target escapes projectRoot: ${targetPath}`);
  }
  return resolvedPath;
}

function isForbiddenTarget(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower === '.env' ||
    lower.startsWith('.env.') ||
    lower.includes('/.git/') ||
    lower.startsWith('.git/') ||
    lower.includes('/node_modules/') ||
    lower.startsWith('node_modules/') ||
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(lower)
  );
}

function inferSlug(files: Record<string, string>): string {
  for (const path of Object.keys(files)) {
    const match = path.match(/^ui_kits\/([^/]+)\//);
    if (match?.[1]) return match[1];
  }
  return 'approved-design';
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'approved-design'
  );
}
