export function PreviewPane() {
  // Placeholder iframe — wires to artifact.html from Convex query later
  const placeholder = `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#151a21;color:#8d96a0;display:grid;place-items:center;height:100vh"><div style="text-align:center"><div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#5b6470;margin-bottom:12px;font-family:monospace">preview</div><div style="font-size:18px">Run a pipeline to see the artifact here.</div></div></body></html>`;

  return (
    <section className="flex flex-1 min-w-0 flex-col bg-[var(--color-surface-2)]">
      <div className="flex items-center justify-between border-b border-[var(--color-edge)] px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="section-label">artifact preview</span>
          <span className="mono text-[10px] text-[var(--color-content-faint)]">v0</span>
        </div>
        <div className="flex items-center gap-2 mono text-[10px] text-[var(--color-content-faint)]">
          <button
            type="button"
            className="rounded-sm px-2 py-1 hover:bg-[var(--color-surface)] hover:text-[var(--color-content-muted)]"
          >
            desktop
          </button>
          <button
            type="button"
            className="rounded-sm px-2 py-1 hover:bg-[var(--color-surface)] hover:text-[var(--color-content-muted)]"
          >
            tablet
          </button>
          <button
            type="button"
            className="rounded-sm px-2 py-1 hover:bg-[var(--color-surface)] hover:text-[var(--color-content-muted)]"
          >
            mobile
          </button>
        </div>
      </div>
      <iframe
        title="artifact preview"
        srcDoc={placeholder}
        sandbox="allow-same-origin"
        className="flex-1 w-full bg-white"
      />
    </section>
  );
}
