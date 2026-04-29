import { useQuery } from 'convex/react';
import { ImageOff, Maximize2, Minimize2, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

interface SourceImagePopoverProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
}

/**
 * SourceImagePopover — pins the gpt-image-2 / uploaded source image
 * alongside the scoped component, so the user can compare what they
 * intended to what the decomposer produced.
 *
 * Closes the gap from the original 6-step user flow vision: "show the
 * gpt image 2 生成的原型图 next to or as a popover for the contexts
 * referenced within the UI component display on a sidebar".
 *
 * Visibility rules:
 *   - hidden when runId is null (no run, nothing to anchor)
 *   - hidden when no selectedFile (nothing to scope to)
 *   - hidden when run has no source image stored
 *   - dismissible per session via the × button
 *   - resizable: minimized (small thumbnail) or expanded (larger preview)
 *
 * Anchored bottom-right of the canvas pane via fixed-positioned wrapper
 * supplied by the caller.
 */
export function SourceImagePopover({ runId, selectedFile }: SourceImagePopoverProps) {
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!runId || !selectedFile || dismissed) return null;
  if (!run || !run.sourceImageBase64 || !run.sourceImageMimeType) return null;

  const dataUrl = `data:${run.sourceImageMimeType};base64,${run.sourceImageBase64}`;
  const componentName = selectedFile.split('/').slice(-1)[0] ?? selectedFile;

  return (
    <div
      role="complementary"
      aria-label="Source image reference"
      style={{
        position: 'absolute',
        bottom: 'var(--space-5)',
        right: 'var(--space-5)',
        width: expanded ? 360 : 200,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-elevated)',
        overflow: 'hidden',
        zIndex: 30,
        transition: 'width var(--duration-base) var(--ease-out)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-surface-hover)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.06em',
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span aria-hidden style={{ fontSize: 12 }}>📎</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            source · {componentName}
          </span>
        </span>
        <span style={{ display: 'inline-flex', gap: 2 }}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Minimize source image' : 'Expand source image'}
            style={iconBtnStyle}
          >
            {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss source image"
            style={iconBtnStyle}
          >
            <X size={11} />
          </button>
        </span>
      </div>
      <div
        style={{
          padding: 10,
          background: 'var(--color-surface-active)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={dataUrl}
          alt={`Source reference for ${componentName}`}
          style={{
            maxWidth: '100%',
            maxHeight: expanded ? 320 : 160,
            objectFit: 'contain',
            borderRadius: 'var(--radius-sm)',
            display: 'block',
          }}
        />
      </div>
      <div
        style={{
          padding: '6px 10px 8px',
          fontFamily: 'var(--font-sans)',
          fontSize: 10,
          color: 'var(--color-text-faint)',
          lineHeight: 'var(--leading-snug)',
        }}
      >
        Reference for the scoped component. Comments and iterate-now will
        target this file specifically — the source above is what you’re
        matching to.
      </div>
    </div>
  );
}

/**
 * Empty fallback used when the run is present but has no inline source.
 * Currently unused (the main component returns null instead) — kept as
 * a hook point for the future "uploaded via Convex Storage" branch.
 */
export function SourceImageMissing({ reason }: { reason: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'var(--space-5)',
        right: 'var(--space-5)',
        padding: '8px 12px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--color-text-faint)',
        background: 'var(--color-surface)',
        border: '1px dashed var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <ImageOff size={11} aria-hidden />
      {reason}
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  width: 22,
  height: 22,
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-secondary)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};
