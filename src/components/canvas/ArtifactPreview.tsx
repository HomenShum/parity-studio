import { useQuery } from 'convex/react';
import { ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { buildSurfacePreviewHtml, stripUnresolvedRelativeScripts } from '../../lib/previewSrcDoc';
import { activeSurfaceFor, surfaceTokenPath } from '../../lib/projectSurfaces';
import { CommentOverlay } from '../CommentOverlay';
import type { Device } from '../HeaderActions';

interface ArtifactPreviewProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  zoom: number;
  device: Device;
  commentModeActive: boolean;
  activeSurfaceSlug?: string | null;
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
  activeSurfaceSlug,
  onAutoFixKicked,
}: ArtifactPreviewProps) {
  const artifact = useQuery(api.artifacts.getLatest, runId ? { runId } : 'skip');
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');

  const livePreview = useMemo(() => {
    if (!uiKit) return null;
    const files = (uiKit.files as Record<string, string>) ?? {};
    const surface = activeSurfaceFor(files, uiKit.slug, activeSurfaceSlug);
    const entryHtml = surface?.entry ? (files[surface.entry] ?? null) : null;
    const html =
      entryHtml ?? files[`ui_kits/${uiKit.slug}/index.html`] ?? files['preview/index.html'] ?? null;
    const tokenPath = surfaceTokenPath(files, surface);
    return {
      surface,
      html,
      tokensCss: tokenPath ? (files[tokenPath] ?? null) : null,
      files,
    };
  }, [activeSurfaceSlug, uiKit]);

  const commentMessageToken = runId ? `parity-comment-${runId}` : 'parity-comment-empty';

  // Generated artifacts are untrusted previews and may contain demo JS.
  // Keep runtime errors inside the iframe so host-app QA is not polluted
  // by a generated page's optional interactions.
  function injectRuntimeGuard(html: string): string {
    const script = `<script data-parity-runtime-guard="on">
window.addEventListener('error', function(event) {
  event.preventDefault();
  return true;
}, true);
window.addEventListener('unhandledrejection', function(event) {
  event.preventDefault();
}, true);
</script>
`;
    if (html.includes('<head>')) return html.replace('<head>', `<head>${script}`);
    if (html.toLowerCase().includes('<head>')) return html.replace(/<head>/i, `<head>${script}`);
    if (html.includes('<script')) return html.replace('<script', `${script}<script`);
    return script + html;
  }

  // When comment mode is on, inject a tiny helper script that captures
  // clicks on any element, computes its normalized rect inside the iframe
  // viewport, and posts a `parity:element-click` message to the parent.
  // CommentOverlay listens for these and shows an anchored quick-action
  // bubble. Without this, comment mode would only support drag-bbox.
  function injectCommentHelper(html: string, on: boolean, messageToken: string): string {
    if (!on) return html;
    const script = `<script data-parity-comment-helper="on">
(function(){
  if (window.__parityCommentHelper) return;
  window.__parityCommentHelper = true;
  var MESSAGE_TOKEN = ${JSON.stringify(messageToken)};
  var hover = null;
  var hoverRing = document.createElement('div');
  hoverRing.style.cssText = 'position:fixed;pointer-events:none;border:2px dashed #C76D54;border-radius:8px;z-index:2147483647;transition:all 80ms ease;background:rgba(199,109,84,0.08);';
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
    function closestCommentTarget(node) {
      if (!node || !node.closest) return node;
      var actionable = node.closest('a, button, [role="button"], input, textarea, select, [data-component], [data-testid]');
      return actionable || node;
    }
    var el = closestCommentTarget(e.target);
    var r = el.getBoundingClientRect();
    var W = document.documentElement.clientWidth || window.innerWidth || 1;
    var H = document.documentElement.clientHeight || window.innerHeight || 1;
    var label = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    function buildSelector(node) {
      if (!node || !node.tagName) return '';
      if (node.id) return '#' + node.id;
      if (node.getAttribute && node.getAttribute('data-component')) return '[data-component="' + node.getAttribute('data-component') + '"]';
      if (node.getAttribute && node.getAttribute('data-testid')) return '[data-testid="' + node.getAttribute('data-testid') + '"]';
      var sel = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        var cls = node.className.trim().split(/\\s+/).slice(0, 2).join('.');
        if (cls) sel += '.' + cls;
      }
      return sel;
    }
    function buildDomPath(node) {
      var parts = [];
      var current = node;
      while (current && current.nodeType === 1 && current !== document.body && parts.length < 8) {
        var part = current.tagName.toLowerCase();
        if (current.id) {
          part += '#' + current.id;
          parts.unshift(part);
          break;
        }
        if (current.className && typeof current.className === 'string') {
          var classes = current.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2);
          if (classes.length) part += '.' + classes.join('.');
        }
        var index = 1;
        var prev = current.previousElementSibling;
        while (prev) {
          if (prev.tagName === current.tagName) index += 1;
          prev = prev.previousElementSibling;
        }
        part += ':nth-of-type(' + index + ')';
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    }
    function nearestComponent(node) {
      var current = node;
      while (current && current.nodeType === 1) {
        if (current.getAttribute) {
          var value = current.getAttribute('data-component') || current.getAttribute('data-component-name') || current.getAttribute('data-file');
          if (value) return value;
        }
        current = current.parentElement;
      }
      return '';
    }
    window.parent.postMessage({
      type: 'parity:element-click',
      token: MESSAGE_TOKEN,
      selector: buildSelector(el),
      domPath: buildDomPath(el),
      tagName: el.tagName,
      text: label,
      textSnippet: label.slice(0, 160),
      componentHint: nearestComponent(el),
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
    if (livePreview?.html !== null && livePreview?.html !== undefined) {
      const surfaceHtml = buildSurfacePreviewHtml({
        html: livePreview.html,
        files: livePreview.files,
        surface: livePreview.surface,
        tokensCss: livePreview.tokensCss,
      });
      srcDoc = injectCommentHelper(
        injectRuntimeGuard(stripUnresolvedRelativeScripts(surfaceHtml)),
        commentModeActive,
        commentMessageToken,
      );
      const baseVersion = uiKit?.artifactVersion ?? artifact?.version ?? 0;
      versionLabel = livePreview.surface
        ? `${livePreview.surface.label} kit v${baseVersion}`
        : `kit v${baseVersion}`;
      artifactVersion = baseVersion;
    } else if (artifact === undefined || run === undefined || uiKit === undefined) {
      srcDoc = loadingHtml('loading');
    } else if (artifact === null) {
      srcDoc = loadingHtml(run?.status ?? 'queued');
    } else {
      srcDoc = injectCommentHelper(
        injectRuntimeGuard(stripUnresolvedRelativeScripts(artifact.html)),
        commentModeActive,
        commentMessageToken,
      );
      versionLabel = `v${artifact.version}`;
      artifactVersion = artifact.version;
    }
  }

  const semverLabel = run ? `v2.${artifactVersion}.${run.iterationsCompleted ?? 0}` : 'v—';
  const previewKindLabel = versionLabel.includes('kit') ? 'Kit preview' : 'Artifact preview';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
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
          {previewKindLabel} {versionLabel}
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
                sandbox="allow-scripts"
                style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
              />
              <CommentOverlay
                runId={runId}
                artifactVersion={artifactVersion}
                active={commentModeActive}
                targetFile={selectedFile ?? null}
                messageToken={commentMessageToken}
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
            messageToken={commentMessageToken}
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
  messageToken,
  onAutoFixKicked,
}: {
  device: Device;
  zoom: number;
  srcDoc: string;
  commentModeActive: boolean;
  runId: Id<'runs'> | null;
  artifactVersion: number;
  targetFile: string | null;
  messageToken: string;
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
              sandbox="allow-scripts"
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                background: 'transparent',
                display: 'block',
              }}
            />
            <CommentOverlay
              runId={runId}
              artifactVersion={artifactVersion}
              active={commentModeActive}
              targetFile={targetFile}
              messageToken={messageToken}
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
