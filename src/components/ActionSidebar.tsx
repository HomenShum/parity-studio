type StageStatus = 'idle' | 'running' | 'done' | 'failed' | 'unavailable';

interface Stage {
  id: string;
  label: string;
  status: StageStatus;
  detail?: string;
}

const PLACEHOLDER_STAGES: Stage[] = [
  { id: 'generate', label: 'generate', status: 'idle' },
  { id: 'decompose', label: 'decompose', status: 'idle' },
  { id: 'verify-deterministic', label: 'verify · deterministic', status: 'idle' },
  { id: 'verify-visual', label: 'verify · visual', status: 'idle' },
  { id: 'iterate', label: 'iterate', status: 'idle' },
];

const STATUS_DOT: Record<StageStatus, string> = {
  idle: 'bg-[var(--color-content-faint)]',
  running: 'bg-[var(--color-warn)] animate-pulse',
  done: 'bg-[var(--color-success)]',
  failed: 'bg-[var(--color-danger)]',
  unavailable: 'bg-[var(--color-content-faint)] opacity-40',
};

export function ActionSidebar() {
  const stages = PLACEHOLDER_STAGES;

  return (
    <aside className="w-72 shrink-0 border-l border-[var(--color-edge)] bg-[var(--color-surface)] p-4">
      <div className="section-label mb-3">pipeline</div>
      <ol className="space-y-2.5">
        {stages.map((s) => (
          <li key={s.id} className="flex items-center gap-3">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s.status]}`} />
            <span className="text-[12px] text-[var(--color-content)]">{s.label}</span>
            {s.detail !== undefined && (
              <span className="ml-auto mono text-[10px] text-[var(--color-content-faint)]">
                {s.detail}
              </span>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-6 section-label">parity</div>
      <div className="mt-2 rounded-md border border-[var(--color-edge-strong)] bg-[var(--color-surface-2)] p-3">
        <div className="flex items-baseline gap-2">
          <span className="mono text-2xl font-semibold text-[var(--color-content)]">—</span>
          <span className="text-[10px] text-[var(--color-content-faint)]">/ 12 checks</span>
        </div>
        <div className="mt-1 mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-content-muted)]">
          status: idle
        </div>
      </div>

      <div className="mt-6 section-label">cost</div>
      <div className="mt-2 mono text-[14px] text-[var(--color-content)]">$0.0000</div>

      <div className="mt-6 section-label">tools</div>
      <div className="mt-2 space-y-1.5">
        <button
          type="button"
          className="w-full rounded-md border border-[var(--color-edge-strong)] px-3 py-1.5 text-[11px] text-left text-[var(--color-content-muted)] hover:text-[var(--color-content)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          Comment mode
        </button>
        <button
          type="button"
          className="w-full rounded-md border border-[var(--color-edge-strong)] px-3 py-1.5 text-[11px] text-left text-[var(--color-content-muted)] hover:text-[var(--color-content)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          Iterate now
        </button>
        <button
          type="button"
          className="w-full rounded-md border border-[var(--color-edge-strong)] px-3 py-1.5 text-[11px] text-left text-[var(--color-content-muted)] hover:text-[var(--color-content)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          Hand off to Claude Code
        </button>
      </div>
    </aside>
  );
}
