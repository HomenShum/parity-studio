import { useQuery } from 'convex/react';
import { ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { CommentOverlay } from '../CommentOverlay';
import type { Device } from '../HeaderActions';

interface ArtifactPreviewProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  zoom: number;
  device: Device;
  commentModeActive: boolean;
  onAutoFixKicked?: () => void;
}

/** Reference device viewport dimensions in CSS px. */
const DEVICE_BOUNDS: Record<Device, { width: number; height: number; bezel: number }> = {
  desktop: { width: 0, height: 0, bezel: 0 }, // 0 = fill available
  tablet: { width: 820, height: 1180, bezel: 18 },
  phone: { width: 390, height: 844, bezel: 14 },
};

const PLACEHOLDER_HTML = `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#FAF7F3;color:#7a6f64;display:grid;place-items:center;height:100vh"><div style="text-align:center"><div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#a89c8e;margin-bottom:12px;font-family:monospace">artifact preview</div><div style="font-size:18px;font-family:'Times New Roman',serif">Run a pipeline to see the rendered ui_kit here.</div></div></body></html>`;

function loadingHtml(label: string): string {
  return `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#FAF7F3;color:#7a6f64;display:grid;place-items:center;height:100vh"><div style="text-align:center"><div style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#a89c8e;margin-bottom:12px;font-family:monospace">${label}</div><div style="font-size:14px">artifact streaming in…</div></div></body></html>`;
}

export function ArtifactPreview({
  runId,
  selectedFile,
  zoom,
  device,
  commentModeActive,
  onAutoFixKicked,
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

  // When comment mode is on, inject a tiny helper script that captures
  // clicks on any element, computes its normalized rect inside the iframe
  // viewport, and posts a `parity:element-click` message to the parent.
  // CommentOverlay listens for these and shows an anchored quick-action
  // bubble. Without this, comment mode would only support drag-bbox.
  function injectCommentHelper(html: string, on: boolean): string {
    if (!on) return html;
    const script = `<script data-parity-comment-helper="on">
(function(){
  if (window.__parityCommentHelper) return;
  window.__parityCommentHelper = true;
  var hover = null;
  var hoverRing = document.createElement('div');
  hoverRing.style.cssText = 'position:fixed;pointer-events:none;border:2px dashed #C76D54;border-radius:4px;z-index:2147483647;transition:all 80ms ease;';
  function attach() { if (document.body && !hoverRing.parentNode) document.body.appendChild(hoverRing); }
  function setHover(el) {
    if (!el || el === hover) return;
    hover = el;
    var r = el.getBoundingClientRect();
    hoverRing.style.left = r.left + 'px';
    hoverRing.style.top = r.top + 'px';
    hoverRing.style.width = r.width + 'px';
    hoverRing.style.height = r.height + 'px';
  }
  document.addEventListener('mousemove', function(e){ attach(); setHover(e.target); }, true);
  document.addEventListener('click', function(e){
    if (!e.target || e.target === hoverRing) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var r = el.getBoundingClientRect();
    var W = document.documentElement.clientWidth || window.innerWidth || 1;
    var H = document.documentElement.clientHeight || window.innerHeight || 1;
    var label = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    function buildSelector(node) {
      if (!node || !node.tagName) return '';
      if (node.id) return '#' + node.id;
      var sel = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        var cls = node.className.trim().split(/\\s+/).slice(0, 2).join('.');
        if (cls) sel += '.' + cls;
      }
      return sel;
    }
    window.parent.postMessage({
      type: 'parity:element-click',
      selector: buildSelector(el),
      tagName: el.tagName,
      text: label,
      rect: {
        x: Math.max(0, Math.min(1, r.left / W)),
        y: Math.max(0, Math.min(1, r.top / H)),
        w: Math.max(0, Math.min(1, r.width / W)),
        h: Math.max(0, Math.min(1, r.height / H))
      }
    }, '*');
  }, true);
})();
</script>
`;
    if (html.includes('</body>')) return html.replace('</body>', `${script}</body>`);
    return html + script;
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
      srcDoc = injectCommentHelper(
        injectLiveTokens(artifact.html, liveTokensCss),
        commentModeActive,
      );
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
        {device === 'desktop' ? (
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
                position: 'relative',
              }}
            >
              <iframe
                title="artifact preview"
                srcDoc={srcDoc}
                sandbox={commentModeActive ? 'allow-same-origin allow-scripts' : 'allow-same-origin'}
                style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
              />
              <CommentOverlay
                runId={runId}
                artifactVersion={artifactVersion}
                active={commentModeActive}
                targetFile={selectedFile ?? null}
                {...(onAutoFixKicked ? { onAutoFixKicked } : {})}
              />
            </div>
          </div>
        ) : (
          <DeviceFrame
            device={device}
            zoom={zoom}
            commentModeActive={commentModeActive}
            srcDoc={srcDoc}
            runId={runId}
            artifactVersion={artifactVersion}
            targetFile={selectedFile ?? null}
            {...(onAutoFixKicked ? { onAutoFixKicked } : {})}
          />
        )}
      </div>
    </div>
  );
}

/**
 * DeviceFrame — render the iframe inside a chrome bezel sized to the
 * target device viewport (390×844 phone, 820×1180 tablet). The iframe
 * gets the device's CSS pixel size so media queries fire correctly;
 * an outer wrapper scales-to-fit the available canvas area at the
 * user's chosen zoom level.
 */
function DeviceFrame({
  device,
  zoom,
  srcDoc,
  commentModeActive,
  runId,
  artifactVersion,
  targetFile,
  onAutoFixKicked,
}: {
  device: Device;
  zoom: number;
  srcDoc: string;
  commentModeActive: boolean;
  runId: Id<'runs'> | null;
  artifactVersion: number;
  targetFile: string | null;
  onAutoFixKicked?: () => void;
}) {
  const { width, height, bezel } = DEVICE_BOUNDS[device];
  const radius = device === 'phone' ? 44 : 24;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
        padding: 24,
        background:
          'radial-gradient(ellipse at center, var(--color-surface-active), var(--color-background-secondary))',
      }}
    >
      <div
        style={{
          transform: `scale(${zoom / 100})`,
          transformOrigin: 'center center',
        }}
      >
        <div
          style={{
            position: 'relative',
            width,
            height,
            padding: bezel,
            background: '#1a1a1a',
            borderRadius: radius,
            boxShadow:
              '0 24px 48px rgba(0,0,0,0.18), 0 8px 16px rgba(0,0,0,0.10), inset 0 0 0 2px rgba(255,255,255,0.04)',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              borderRadius: radius - bezel + 2,
              overflow: 'hidden',
              background: 'var(--color-artifact-bg)',
            }}
          >
            <iframe
              title="artifact preview"
              srcDoc={srcDoc}
              sandbox={commentModeActive ? 'allow-same-origin allow-scripts' : 'allow-same-origin'}
              style={{ width: '100%', height: '100%', border: 'none', background: 'transparent', display: 'block' }}
            />
            <CommentOverlay
              runId={runId}
              artifactVersion={artifactVersion}
              active={commentModeActive}
              targetFile={targetFile}
              {...(onAutoFixKicked ? { onAutoFixKicked } : {})}
            />
          </div>
          {device === 'phone' ? (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: '50%',
                top: bezel + 6,
                transform: 'translateX(-50%)',
                width: 100,
                height: 24,
                background: '#000',
                borderRadius: 12,
                pointerEvents: 'none',
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
