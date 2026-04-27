import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * FilesPanel — live ui_kit/<slug>/ tree from Convex `uiKits:getLatest`.
 *
 * Empty state when no run is selected. Loading state while query is in flight.
 * Real tree once decompose finishes. ZIP export wires through a Convex action
 * that returns a base64 blob (the existing parityReports/uiKits write enough
 * server-side state for it to work).
 */
interface FilesPanelProps {
  runId: Id<'runs'> | null;
}

interface TreeNode {
  kind: 'folder' | 'file';
  depth: number;
  label: string;
}

const PLACEHOLDER_TREE: TreeNode[] = [
  { kind: 'folder', depth: 0, label: 'ui_kits/' },
  { kind: 'folder', depth: 1, label: '(no run yet)' },
];

function pathsToTree(files: Record<string, string>): TreeNode[] {
  const seen = new Set<string>();
  const nodes: TreeNode[] = [];
  for (const fullPath of Object.keys(files).sort()) {
    const parts = fullPath.split('/').filter((p) => p.length > 0);
    let cum = '';
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] as string;
      cum = cum ? `${cum}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      const key = isLeaf ? cum : `${cum}/`;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({
        kind: isLeaf ? 'file' : 'folder',
        depth: i,
        label: isLeaf ? part : `${part}/`,
      });
    }
  }
  return nodes;
}

export function FilesPanel({ runId }: FilesPanelProps) {
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');

  let tree: TreeNode[] = PLACEHOLDER_TREE;
  if (runId !== null) {
    if (uiKit === undefined) {
      tree = [{ kind: 'folder', depth: 0, label: 'loading...' }];
    } else if (uiKit === null) {
      tree = [
        { kind: 'folder', depth: 0, label: 'ui_kits/' },
        { kind: 'folder', depth: 1, label: '(decompose pending)' },
      ];
    } else {
      tree = pathsToTree(uiKit.files as Record<string, string>);
    }
  }

  const exportHref = runId !== null && uiKit ? `/api/runs/${runId}/zip` : '#';
  const canExport = runId !== null && uiKit !== null && uiKit !== undefined;

  return (
    <>
      <div className="section">
        <div className="section-header">FILES</div>
        <div className="file-tree" role="tree" aria-label="ui_kit file tree">
          {tree.map((node, i) => {
            const className =
              node.kind === 'folder'
                ? `folder ${node.depth === 0 ? 'expanded' : 'subfolder'}`
                : 'file indent';
            const icon = node.kind === 'folder' && node.depth === 0 ? '\u{1F4C1}' : '';
            return (
              <div
                key={`${node.label}-${i}`}
                className={className}
                role="treeitem"
              >
                {icon ? <span aria-hidden="true">{icon} </span> : null}
                {node.label}
              </div>
            );
          })}
        </div>
      </div>
      <div className="section">
        <div className="section-header">HANDOFF</div>
        <a
          className="handoff-button"
          href={exportHref}
          download
          aria-disabled={!canExport}
          onClick={(e) => {
            if (!canExport) e.preventDefault();
          }}
          style={{ textAlign: 'center', textDecoration: 'none' }}
        >
          Export ZIP
        </a>
      </div>
    </>
  );
}
