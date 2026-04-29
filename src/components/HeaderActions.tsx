import { ChevronDown, Download, FileCode2, FileText, MessageSquare, Monitor, Package, Smartphone, Tablet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type Device = 'desktop' | 'tablet' | 'phone';

interface HeaderActionsProps {
  commentModeActive: boolean;
  onToggleCommentMode: () => void;
  zoom: number;
  onZoomChange: (next: number) => void;
  device: Device;
  onDeviceChange: (next: Device) => void;
  /**
   * Base path of the run's HTTP routes — e.g. https://blissful-pig-998.convex.site/api/runs/<runId>
   * The dropdown appends `/zip`, `/html`, `/markdown` per format.
   */
  exportHrefBase: string;
  exportEnabled: boolean;
}

const ZOOM_OPTIONS = [50, 75, 100, 125, 150];

const PILL: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 12px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border-subtle)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-body-sm)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  transition: 'background var(--duration-faster) var(--ease-out)',
};

const FORMATS = [
  {
    id: 'zip' as const,
    label: 'Canonical ZIP',
    sublabel: 'Full skill-pack — round-trips back into Parity Studio',
    Icon: Package,
  },
  {
    id: 'html' as const,
    label: 'Single HTML',
    sublabel: 'index.html with tokens inlined; drop into a CMS',
    Icon: FileCode2,
  },
  {
    id: 'markdown' as const,
    label: 'Markdown',
    sublabel: 'Prose handoff for coding agents',
    Icon: FileText,
  },
];

const DEVICE_META: Record<Device, { Icon: typeof Monitor; label: string }> = {
  desktop: { Icon: Monitor, label: 'Desktop' },
  tablet: { Icon: Tablet, label: 'Tablet' },
  phone: { Icon: Smartphone, label: 'Phone' },
};

/**
 * Top-bar right cluster: Comment mode · device · zoom · Export.
 * Export is a dropdown with 3 formats: ZIP / HTML / Markdown.
 * Device is a segmented control: Desktop / Tablet / Phone.
 */
export function HeaderActions({
  commentModeActive,
  onToggleCommentMode,
  zoom,
  onZoomChange,
  device,
  onDeviceChange,
  exportHrefBase,
  exportEnabled,
}: HeaderActionsProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
      }}
    >
      <button
        type="button"
        onClick={onToggleCommentMode}
        aria-pressed={commentModeActive ? 'true' : 'false'}
        style={{
          ...PILL,
          background: commentModeActive ? 'var(--color-accent-soft)' : PILL.background,
          color: commentModeActive ? 'var(--color-accent)' : PILL.color,
          borderColor: commentModeActive
            ? 'var(--color-accent)'
            : PILL.border?.toString() ?? 'transparent',
        }}
      >
        <MessageSquare size={13} />
        Comment mode
      </button>

      <div
        role="radiogroup"
        aria-label="Preview device"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: 2,
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-subtle)',
          height: 32,
        }}
      >
        {(Object.keys(DEVICE_META) as Device[]).map((d) => {
          const active = d === device;
          const { Icon, label } = DEVICE_META[d];
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={active ? 'true' : 'false'}
              onClick={() => onDeviceChange(d)}
              title={label}
              style={{
                display: 'inline-grid',
                placeItems: 'center',
                width: 28,
                height: 26,
                borderRadius: 'var(--radius-sm)',
                background: active ? 'var(--color-accent-soft)' : 'transparent',
                color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <Icon size={13} />
            </button>
          );
        })}
      </div>

      <label style={{ ...PILL, paddingRight: 8 }}>
        <select
          value={zoom}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          aria-label="Zoom level"
          style={{
            appearance: 'none',
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
            paddingRight: 4,
          }}
        >
          {ZOOM_OPTIONS.map((z) => (
            <option key={z} value={z}>{z}%</option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden />
      </label>

      <div ref={wrapRef} style={{ position: 'relative' }}>
        {exportEnabled ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open ? 'true' : 'false'}
            style={PILL}
          >
            <Download size={13} />
            Export
            <ChevronDown size={12} aria-hidden style={{ marginLeft: 2 }} />
          </button>
        ) : (
          <span
            style={{
              ...PILL,
              opacity: 0.5,
              cursor: 'not-allowed',
            }}
            aria-disabled
          >
            <Download size={13} />
            Export
          </span>
        )}
        {open && exportEnabled ? (
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              minWidth: 280,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-elevated)',
              padding: 4,
              zIndex: 40,
            }}
          >
            {FORMATS.map((f) => {
              const { Icon } = f;
              return (
                <a
                  key={f.id}
                  role="menuitem"
                  href={`${exportHrefBase}/${f.id}`}
                  download
                  onClick={() => setOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    textDecoration: 'none',
                    color: 'var(--color-text-primary)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--font-size-body-sm)',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = 'var(--color-surface-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-grid',
                      placeItems: 'center',
                      width: 28,
                      height: 28,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-accent-soft)',
                      color: 'var(--color-accent)',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={13} />
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 500 }}>{f.label}</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--color-text-secondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      {f.sublabel}
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
