export function FilesPanel() {
  // Placeholder tree — wires to Convex `uiKits:getLatest` query later
  const files = [
    'ui_kits/',
    '  saas-dashboard/',
    '    index.html',
    '    components/',
    '      Sidebar.tsx',
    '      MetricCard.tsx',
    '      ChartPanel.tsx',
    '    tokens.css',
    '    manifest.json',
    '    README.md',
  ];

  return (
    <aside className="w-60 shrink-0 border-r border-[var(--color-edge)] bg-[var(--color-surface)] p-4">
      <div className="section-label mb-3">files</div>
      <ul className="space-y-0.5">
        {files.map((f, i) => {
          const isFile = !f.endsWith('/');
          return (
            <li
              key={`${f}-${i}`}
              className={`mono text-[11px] leading-relaxed ${
                isFile ? 'text-[var(--color-content)]' : 'text-[var(--color-content-muted)]'
              }`}
            >
              {f}
            </li>
          );
        })}
      </ul>
      <div className="mt-6 section-label">handoff</div>
      <button
        type="button"
        className="mt-2 w-full rounded-md border border-[var(--color-edge-strong)] px-3 py-2 text-[11px] text-[var(--color-content-muted)] hover:text-[var(--color-content)] hover:bg-[var(--color-surface-2)] transition-colors"
      >
        Export ZIP
      </button>
    </aside>
  );
}
