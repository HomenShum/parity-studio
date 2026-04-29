import { ChevronDown, Download, MessageSquare } from 'lucide-react';

interface HeaderActionsProps {
  commentModeActive: boolean;
  onToggleCommentMode: () => void;
  zoom: number;
  onZoomChange: (next: number) => void;
  exportHref: string;
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

/**
 * Top-bar right cluster: Comment mode · zoom · Export.
 * Mirrors the reference exactly.
 */
export function HeaderActions({
  commentModeActive,
  onToggleCommentMode,
  zoom,
  onZoomChange,
  exportHref,
  exportEnabled,
}: HeaderActionsProps) {
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
        aria-pressed={commentModeActive}
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

      {exportEnabled ? (
        <a
          href={exportHref}
          download
          style={{
            ...PILL,
            textDecoration: 'none',
          }}
        >
          <Download size={13} />
          Export
        </a>
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
    </div>
  );
}
