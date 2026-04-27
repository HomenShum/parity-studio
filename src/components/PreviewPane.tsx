import { useState } from 'react';

/**
 * PreviewPane — DOM/CSS verbatim from platform-generated parity-studio/index.html.
 * Center column with the artifact preview iframe + cost row. Iframe content wires
 * to Convex `artifacts:getLatest` in v0.0.3; for now it shows a placeholder.
 */
type Viewport = 'desktop' | 'tablet';

export function PreviewPane() {
  const [viewport, setViewport] = useState<Viewport>('desktop');

  return (
    <>
      <div className="preview-section">
        <div className="preview-header">
          <span>ARTIFACT PREVIEW v0</span>
          <div className="preview-tabs" role="tablist" aria-label="Preview viewport">
            {(['desktop', 'tablet'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={viewport === v}
                className={`tab ${viewport === v ? 'active' : ''}`}
                onClick={() => setViewport(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="preview-content" role="status">
          <div style={{ fontSize: 20 }}>PREVIEW</div>
          <div>Run a pipeline to see the artifact</div>
          <div>here.</div>
        </div>
      </div>
      <div className="cost-section">
        <span className="cost-label">COST</span>
        <span className="cost-value">$0.0000</span>
      </div>
    </>
  );
}
