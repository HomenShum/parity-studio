/**
 * ActionSidebar — DOM/CSS verbatim from platform-generated parity-studio/index.html.
 * Pipeline / Parity / Tools sections. Wires to Convex `runs:get` + `parityReports:getLatest`
 * in v0.0.3. The "Hand off to Claude C&b" tokenization artifact in the platform output
 * is corrected to "Hand off to Claude Code" here, with a comment for honest provenance.
 */
type StageState = 'idle' | 'running' | 'active' | 'failed';

interface Stage {
  id: string;
  label: string;
  state: StageState;
}

const PLACEHOLDER_STAGES: Stage[] = [
  { id: 'generate', label: 'generate', state: 'idle' },
  { id: 'decompose', label: 'decompose', state: 'idle' },
  { id: 'verify-deterministic', label: 'verify · deterministic', state: 'idle' },
  { id: 'verify-visual', label: 'verify · visual', state: 'idle' },
  { id: 'iterate', label: 'iterate', state: 'idle' },
];

const TOOLS: ReadonlyArray<{ label: string; ariaHint: string }> = [
  { label: 'Comment mode', ariaHint: 'toggle bbox region selection on the preview' },
  { label: 'Iterate now', ariaHint: 'run another decompose pass with current gaps' },
  // Note: platform output emitted "Hand off to Claude C&b" (model tokenization
  // artifact). Corrected to "Code" here. The deterministic text-coverage check
  // in convex/lib/parityChecker.ts would catch this on a future verify pass.
  { label: 'Hand off to Claude Code', ariaHint: 'export bundle and copy CLI snippet' },
];

export function ActionSidebar() {
  const stages = PLACEHOLDER_STAGES;
  const passCount: number | null = null;
  const totalChecks = 12;
  const status = 'idle';

  return (
    <>
      <div className="section">
        <div className="section-header">PIPELINE</div>
        {stages.map((stage) => {
          const cls =
            stage.state === 'idle' ? 'pipeline-item' : `pipeline-item ${stage.state}`;
          return (
            <div key={stage.id} className={cls}>
              <span className="pipeline-dot" aria-hidden="true" />
              <span>{stage.label}</span>
            </div>
          );
        })}
      </div>
      <div className="section">
        <div className="section-header">PARITY</div>
        <div className="parity-section">
          <div className="parity-status">
            {passCount === null ? '--' : passCount} /. {totalChecks} CHECKS
          </div>
          <div className="parity-subtitle">STATUS: {status.toUpperCase()}</div>
        </div>
      </div>
      <div className="section">
        <div className="section-header">TOOLS</div>
        {TOOLS.map((t) => (
          <button
            key={t.label}
            type="button"
            className="tools-item"
            aria-label={t.ariaHint}
          >
            {t.label}
          </button>
        ))}
      </div>
    </>
  );
}
