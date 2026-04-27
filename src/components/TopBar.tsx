export function TopBar() {
  return (
    <header className="flex h-12 items-center justify-between border-b border-[var(--color-edge)] px-5">
      <div className="flex items-center gap-3">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-[var(--color-accent)] text-[13px] font-bold text-[#0e1117]">
          P
        </div>
        <span className="text-sm font-semibold tracking-tight">Parity Studio</span>
        <span className="mono text-[10px] text-[var(--color-content-faint)]">v0.0.1</span>
      </div>
      <div className="flex items-center gap-4 mono text-[11px] text-[var(--color-content-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
          Convex
        </span>
        <span className="text-[var(--color-content-faint)]">·</span>
        <a
          href="https://github.com/HomenShum/parity-studio"
          className="hover:text-[var(--color-content)] transition-colors"
        >
          source
        </a>
      </div>
    </header>
  );
}
