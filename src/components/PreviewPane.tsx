import { useQuery } from 'convex/react';
import { useState } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * PreviewPane — live artifact preview from Convex `artifacts:getLatest`.
 *
 * Renders the latest emitted HTML in a sandboxed iframe via srcDoc. While the
 * pipeline is generating, shows a skeleton + the run status so the user knows
 * something is happening (no blank screen).
 */
interface PreviewPaneProps {
  runId: Id<'runs'> | null;
}

type Viewport = 'desktop' | 'tablet';

const PLACEHOLDER_HTML = `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#1c222b;color:#8d96a0;display:grid;place-items:center;height:100vh"><div style="text-align:center"><div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#5b6470;margin-bottom:12px;font-family:monospace">preview</div><div style="font-size:18px">Run a pipeline to see the artifact here.</div></div></body></html>`;

function loadingHtml(label: string): string {
  return `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#1c222b;color:#8d96a0;display:grid;place-items:center;height:100vh"><div style="text-align:center"><div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#5b6470;margin-bottom:12px;font-family:monospace">${label}</div><div style="font-size:14px">artifact streaming in...</div></div></body></html>`;
}

export function PreviewPane({ runId }: PreviewPaneProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const artifact = useQuery(api.artifacts.getLatest, runId ? { runId } : 'skip');
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');

  let srcDoc = PLACEHOLDER_HTML;
  let versionLabel = 'v0';
  if (runId !== null) {
    if (artifact === undefined || run === undefined) {
      srcDoc = loadingHtml('loading');
    } else if (artifact === null) {
      srcDoc = loadingHtml(run?.status ?? 'queued');
    } else {
      srcDoc = artifact.html;
      versionLabel = `v${artifact.version}`;
    }
  }

  return (
    <>
      <div className="preview-section">
        <div className="preview-header">
          <span>ARTIFACT PREVIEW {versionLabel}</span>
          <div className="preview-tabs" role="tablist" aria-label="Preview viewport">
            {(['desktop', 'tablet'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={viewport === v ? 'true' : 'false'}
                className={`tab ${viewport === v ? 'active' : ''}`}
                onClick={() => setViewport(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <iframe
          title="artifact preview"
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          className="preview-iframe"
        />
      </div>
    </>
  );
}
