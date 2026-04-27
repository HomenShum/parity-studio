/**
 * FilesPanel — DOM/CSS verbatim from platform-generated parity-studio/index.html.
 * File tree + Handoff section. Wires to Convex `uiKits:getLatest` query in v0.0.3.
 *
 * The placeholder tree below mirrors what the platform model rendered — once
 * the backend is wired, this becomes a live tree of `ui_kits/<slug>/` files.
 */
const PLACEHOLDER_TREE: Array<{ kind: 'folder' | 'file'; depth: number; label: string }> = [
  { kind: 'folder', depth: 0, label: 'ui_kits/' },
  { kind: 'folder', depth: 1, label: 'saas-dashboard/' },
  { kind: 'file', depth: 2, label: 'index.html' },
  { kind: 'folder', depth: 2, label: 'components/' },
  { kind: 'file', depth: 3, label: 'Sidebar.tsx' },
  { kind: 'file', depth: 3, label: 'MetricCard.tsx' },
  { kind: 'file', depth: 2, label: 'tokens.css' },
  { kind: 'file', depth: 2, label: 'manifest.json' },
  { kind: 'file', depth: 2, label: 'README.md' },
];

export function FilesPanel() {
  return (
    <>
      <div className="section">
        <div className="section-header">FILES</div>
        <div className="file-tree" role="tree" aria-label="ui_kit file tree">
          {PLACEHOLDER_TREE.map((node, i) => {
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
                aria-level={node.depth + 1}
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
        <button type="button" className="handoff-button">
          Export ZIP
        </button>
      </div>
    </>
  );
}
