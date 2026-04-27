import { useState } from 'react';

export function InputBar() {
  const [prompt, setPrompt] = useState('');
  const [imageName, setImageName] = useState<string | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setImageName(f.name);
  }

  async function onRun() {
    // TODO: wire to convex mutation `runs:start` with prompt + uploaded storage id
    console.warn('run not wired yet', { prompt, imageName });
  }

  const canRun = prompt.trim().length > 0 || imageName !== null;

  return (
    <div className="border-b border-[var(--color-edge)] px-5 py-3">
      <div className="flex items-center gap-3">
        <label className="cursor-pointer rounded-md border border-[var(--color-edge-strong)] px-3 py-2 text-xs text-[var(--color-content-muted)] hover:text-[var(--color-content)] hover:bg-[var(--color-surface-2)] transition-colors">
          {imageName ? (
            <span className="mono">{imageName.slice(0, 24)}</span>
          ) : (
            <>+ source image</>
          )}
          <input type="file" accept="image/*" className="hidden" onChange={onFile} />
        </label>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="describe the UI, or just upload a sketch..."
          className="flex-1 rounded-md border border-[var(--color-edge)] bg-[var(--color-surface)] px-3 py-2 text-sm placeholder:text-[var(--color-content-faint)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-soft)]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canRun) {
              void onRun();
            }
          }}
        />
        <button
          type="button"
          disabled={!canRun}
          onClick={onRun}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-[#0e1117] transition-opacity hover:bg-[var(--color-accent-strong)] disabled:opacity-30"
        >
          Generate
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between mono text-[10px] text-[var(--color-content-faint)]">
        <span>cmd/ctrl + enter to run</span>
        <span>est. cost $0.10-0.60 per full pipeline</span>
      </div>
    </div>
  );
}
