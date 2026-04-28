import { useQuery } from 'convex/react';
import { useState } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { CommentOverlay } from './CommentOverlay';
import { FileEditor } from './FileEditor';

/**
 * PreviewPane — live artifact preview from Convex `artifacts:getLatest`.
 * Renders artifact HTML in a sandboxed iframe via srcDoc. CommentOverlay
 * sits on top of the iframe and drives bbox region selection when comment
 * mode is active.
 */
interface PreviewPaneProps {
  runId: Id<'runs'> | null;
  commentModeActive: boolean;
  selectedFile?: string | null;
}

type Viewport = 'desktop' | 'tablet';
type Mode = 'preview' | 'code';

const PLACEHOLDER_HTML = `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#1c222b;color:#8d96a0;display:grid;place-items:center;height:100vh"><div style="text-align:center"><div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#5b6470;margin-bottom:12px;font-family:monospace">preview</div><div style="font-size:18px">Run a pipeline to see the artifact here.</div></div></body></html>`;

function loadingHtml(label: string): string {
  return `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#1c222b;color:#8d96a0;display:grid;place-items:center;height:100vh"><div style="text-align:center"><div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#5b6470;margin-bottom:12px;font-family:monospace">${label}</div><div style="font-size:14px">artifact streaming in...</div></div></body></html>`;
}

export function PreviewPane({ runId, commentModeActive, selectedFile }: PreviewPaneProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [mode, setMode] = useState<Mode>('preview');
  const artifact = useQuery(api.artifacts.getLatest, runId ? { runId } : 'skip');
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');

  let srcDoc = PLACEHOLDER_HTML;
  let versionLabel = 'v0';
  let artifactVersion = 0;
  if (runId !== null) {
    if (artifact === undefined || run === undefined) {
      srcDoc = loadingHtml('loading');
    } else if (artifact === null) {
      srcDoc = loadingHtml(run?.status ?? 'queued');
    } else {
      srcDoc = artifact.html;
      versionLabel = `v${artifact.version}`;
      artifactVersion = artifact.version;
    }
  }

  return (
    <>
      <div className="preview-section">
        <div className="preview-header">
          <span>ARTIFACT PREVIEW {versionLabel}</span>
          {commentModeActive ? (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                padding: '3px 8px',
                background: 'rgba(217,119,87,0.14)',
                color: '#d97757',
                borderRadius: 4,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
              }}
            >
              comment mode · drag to pin
            </span>
          ) : null}
          {selectedFile ? (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                padding: '3px 8px',
                background: 'rgba(34,197,94,0.12)',
                color: '#22c55e',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}
              title="Comments will be scoped to this file"
            >
              scoped → {selectedFile}
            </span>
          ) : null}
          <div className="preview-tabs" role="tablist" aria-label="Preview mode">
            {(['preview', 'code'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                // biome-ignore lint/a11y/useAriaPropsForRole: aria-selected accepts boolean per W3C
                aria-selected={mode === m}
                className={`tab ${mode === m ? 'active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
            {mode === 'preview'
              ? (['desktop', 'tablet'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    // biome-ignore lint/a11y/useAriaPropsForRole: aria-selected accepts boolean per W3C
                    aria-selected={viewport === v}
                    className={`tab ${viewport === v ? 'active' : ''}`}
                    onClick={() => setViewport(v)}
                  >
                    {v}
                  </button>
                ))
              : null}
          </div>
        </div>
        <div className="preview-body">
          {mode === 'preview' ? (
            <>
              <iframe
                title="artifact preview"
                srcDoc={srcDoc}
                sandbox="allow-same-origin"
                className="preview-iframe"
              />
              <CommentOverlay
                runId={runId}
                artifactVersion={artifactVersion}
                active={commentModeActive}
                targetFile={selectedFile ?? null}
              />
            </>
          ) : (
            <FileEditor runId={runId} selectedFile={selectedFile ?? null} />
          )}
        </div>
      </div>
    </>
  );
}
