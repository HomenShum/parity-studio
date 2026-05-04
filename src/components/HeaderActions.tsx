import {
  ChevronDown,
  Download,
  FileCode2,
  FileText,
  Globe2,
  MessageSquare,
  Monitor,
  Package,
  PenTool,
  Smartphone,
  Tablet,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { availableLocales, localeLabels, useI18n, useT } from '../lib/i18n';

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
   * The dropdown appends `/zip`, `/html`, `/markdown`, `/figma` per format.
   */
  exportHrefBase: string;
  exportEnabled: boolean;
  exportReady?: boolean;
  exportWarning?: string | undefined;
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
    Icon: Package,
  },
  {
    id: 'html' as const,
    Icon: FileCode2,
  },
  {
    id: 'markdown' as const,
    Icon: FileText,
  },
  {
    id: 'figma' as const,
    Icon: PenTool,
  },
];

const DEVICE_META: Record<Device, { Icon: typeof Monitor; label: string }> = {
  desktop: { Icon: Monitor, label: 'device.desktop' },
  tablet: { Icon: Tablet, label: 'device.tablet' },
  phone: { Icon: Smartphone, label: 'device.phone' },
};

/**
 * Top-bar right cluster: Comment mode · device · zoom · Export.
 * Export is a dropdown with ZIP / HTML / Markdown / Figma bridge.
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
  exportReady = false,
  exportWarning,
}: HeaderActionsProps) {
  const t = useT();
  const { locale, setLocale } = useI18n();
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
            : (PILL.border?.toString() ?? 'transparent'),
        }}
      >
        <MessageSquare size={13} />
        {t('header.commentOnPreview')}
      </button>

      <div
        role="radiogroup"
        aria-label={t('header.previewDevice')}
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
          const displayLabel = t(label);
          return (
            <label
              key={d}
              title={displayLabel}
              style={{
                position: 'relative',
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
              <input
                type="radio"
                name="preview-device"
                checked={active}
                aria-label={displayLabel}
                onChange={() => onDeviceChange(d)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0,
                  cursor: 'pointer',
                }}
              />
              <Icon size={13} />
            </label>
          );
        })}
      </div>

      <label style={{ ...PILL, paddingRight: 8 }}>
        <select
          value={zoom}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          aria-label={t('header.zoomLevel')}
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
            <option key={z} value={z}>
              {z}%
            </option>
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
            {exportReady ? t('header.export') : t('header.exportDraft')}
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
            {t('header.export')}
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
            {!exportReady && exportWarning ? (
              <div
                style={{
                  margin: 4,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-warning)',
                  background: 'color-mix(in srgb, var(--color-warning) 12%, var(--color-surface))',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--font-size-body-sm)',
                  lineHeight: 1.45,
                }}
              >
                <strong>{t('header.notReadyYet')}</strong> {exportWarning}
              </div>
            ) : null}
            {FORMATS.map((f) => {
              const { Icon } = f;
              const label = t(`header.formats.${f.id}.label`);
              const sublabel = t(`header.formats.${f.id}.sublabel`);
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
                    (e.currentTarget as HTMLAnchorElement).style.background =
                      'var(--color-surface-hover)';
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
                    <span style={{ fontWeight: 500 }}>{label}</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--color-text-secondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      {sublabel}
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        ) : null}
      </div>
      <label style={{ ...PILL, paddingRight: 8 }} title={t('header.language')}>
        <Globe2 size={13} aria-hidden />
        <select
          value={locale}
          onChange={(event) => setLocale(event.target.value)}
          aria-label={t('header.language')}
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
          {availableLocales.map((item) => (
            <option key={item} value={item}>
              {localeLabels[item]}
            </option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden />
      </label>
    </div>
  );
}
