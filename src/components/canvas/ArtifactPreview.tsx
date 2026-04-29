import { useQuery } from 'convex/react';
import { ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { CommentOverlay } from '../CommentOverlay';

interface ArtifactPreviewProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  zoom: number;
  commentModeActive: boolean;
}

const PLACEHOLDER_HTML = `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#FAF7F3;color:#7a6f64;display:grid;place-items:center;height:100vh"><div style="text-align:center"><div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#a89c8e;margin-bottom:12px;font-family:monospace">artifact preview</div><div style="font-size:18px;font-family:'Times New Roman',serif">Run a pipeline to see the rendered ui_kit here.</div></div></body></html>`;

function loadingHtml(label: string): string {
  return `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#FAF7F3;color:#7a6f64;display:grid;place-items:center;height:100vh"><div style="text-align:center"><div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#a89c8e;margin-bottom:12px;font-family:monospace">${label}</div><div style="font-size:14px">artifact streaming in…</div></div></body></html>`;
}

export function ArtifactPreview({
  runId,
  selectedFile,
  zoom,
  commentModeActive,
}: ArtifactPreviewProps) {
  const artifact = useQuery(api.artifacts.getLatest, runId ? { runId } : 'skip');
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');

  const liveTokensCss = useMemo(() => {
    if (!uiKit) return null;
    const files = (uiKit.files as Record<string, string>) ?? {};
    const path = `ui_kits/${uiKit.slug}/tokens.css`;
    return files[path] ?? null;
  }, [uiKit]);

  // Stitch tokens.css into the iframe srcDoc so TweakPanel edits show
  // live. Inserts a synthetic `<style data-parity-tokens>` block right
  // after `<head>`, OR before `</body>` if no head. The artifact's own
  // styles still load AFTER (cascade order), so they win on conflicts —
  // but `var(--…)` references in the artifact will pick up the live
  // tokens.css values declared by our injected block.
  function injectLiveTokens(html: string, tokens: string | null): string {
    if (!tokens) return html;
    const tag = `<style data-parity-tokens="live">\n${tokens}\n</style>\n`;
    if (html.includes('<head>')) return html.replace('<head>', `<head>\n${tag}`);
    if (html.toLowerCase().includes('<head>')) return html.replace(/<head>/i, `<head>\n${tag}`);
    if (html.includes('<body')) return html.replace('<body', `${tag}<body`);
    return tag + html;
  }

  let srcDoc = PLACEHOLDER_HTML;
  let versionLabel = 'v0';
  let artifactVersion = 0;
  if (runId !== null) {
    if (artifact === undefined || run === undefined) {
      srcDoc = loadingHtml('loading');
    } else if (artifact === null) {
      srcDoc = loadingHtml(run?.status ?? 'queued');
    } else {
      srcDoc = injectLiveTokens(artifact.html, liveTokensCss);
      versionLabel = `v${artifact.version}`;
      artifactVersion = artifact.version;
    }
  }

  const semverLabel = run ? `v2.${artifactVersion}.${run.iterationsCompleted ?? 0}` : 'v—';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        gap: 'var(--space-3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: 'var(--tracking-eyebrow)',
          textTransform: 'uppercase',
          color: 'var(--color-text-secondary)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ExternalLink size={11} aria-hidden />
          Artifact preview {versionLabel}
        </span>
        <span style={{ color: 'var(--color-text-faint)', textTransform: 'none', letterSpacing: 0 }}>
          {semverLabel}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: 'var(--color-artifact-bg)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border-subtle)',
          overflow: 'hidden',
          position: 'relative',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            justifyContent: 'center',
            overflow: 'auto',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
            }}
          >
            <iframe
              title="artifact preview"
              srcDoc={srcDoc}
              sandbox="allow-same-origin"
              style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
            />
          </div>
        </div>
        <CommentOverlay
          runId={runId}
          artifactVersion={artifactVersion}
          active={commentModeActive}
          targetFile={selectedFile ?? null}
        />
      </div>
    </div>
  );
}
