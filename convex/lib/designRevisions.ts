import type { Id } from '../_generated/dataModel';

export type DesignRevisionKind =
  | 'initial'
  | 'manual-edit'
  | 'agent-edit'
  | 'file-create'
  | 'file-rename'
  | 'file-delete'
  | 'import'
  | 'sync'
  | 'export';

export async function recordDesignRevision(
  // biome-ignore lint/suspicious/noExplicitAny: Convex ctx differs between mutation/internalMutation.
  ctx: any,
  args: {
    runId: Id<'runs'>;
    uiKitId: Id<'ui_kits'>;
    kind: DesignRevisionKind;
    label: string;
    summary: string;
    changedPaths: string[];
    files: Record<string, string>;
    source?: 'app' | 'agent' | 'mcp';
  },
) {
  const latest = await ctx.db
    .query('design_revisions')
    // biome-ignore lint/suspicious/noExplicitAny: Convex q builder type differs between public/internal contexts.
    .withIndex('by_run_revision', (q: any) => q.eq('runId', args.runId))
    .order('desc')
    .first();
  const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
  return await ctx.db.insert('design_revisions', {
    runId: args.runId,
    uiKitId: args.uiKitId,
    revisionNumber,
    kind: args.kind,
    label: args.label.slice(0, 120),
    summary: args.summary.slice(0, 500),
    changedPaths: args.changedPaths.slice(0, 40),
    fileCount: Object.keys(args.files).length,
    filesDigest: digestFiles(args.files),
    ...(args.source ? { source: args.source } : {}),
    createdAt: Date.now(),
  });
}

function digestFiles(files: Record<string, string>): string {
  const parts = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, value]) => `${path}:${value.length}:${sampleHash(value)}`)
    .join('|');
  return `pv1:${sampleHash(parts)}`;
}

function sampleHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
