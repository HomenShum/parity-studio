import { useQuery } from 'convex/react';
import { Image as ImageIcon, ImageOff, Maximize2, Minimize2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

interface SourceImagePopoverProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Pins the uploaded/generated source image beside the active artifact so users
 * can compare the original reference with the current ui_kit output.
 */
export function SourceImagePopover({
  runId,
  selectedFile,
  open = false,
  onOpenChange,
}: SourceImagePopoverProps) {
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDismissed(false);
    setExpanded(true);
  }, [open]);

  const shouldShow = open || selectedFile !== null;
  if (!runId || !shouldShow || dismissed) return null;
  if (!run || !run.sourceImageBase64 || !run.sourceImageMimeType) return null;

  const dataUrl = `data:${run.sourceImageMimeType};base64,${run.sourceImageBase64}`;
  const componentName = selectedFile ? (selectedFile.split('/').slice(-1)[0] ?? selectedFile) : 'full source';

  function close() {
    setDismissed(true);
    onOpenChange?.(false);
  }

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
          <ImageIcon size={12} aria-hidden />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            source - {componentName}
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
          <button type="button" onClick={close} aria-label="Dismiss source image" style={iconBtnStyle}>
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
        Reference for the scoped component. Comments and iterate-now target this file; the source above is
        what you are matching to.
      </div>
    </div>
  );
}

/**
 * Empty fallback used when the run is present but has no inline source. Kept as
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
