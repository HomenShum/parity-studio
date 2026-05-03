import { Star } from 'lucide-react';
import { useT } from '../lib/i18n';

interface BreadcrumbProps {
  project?: string;
  title: string;
  starred?: boolean;
  onToggleStar?: () => void;
}

/**
 * Top-bar breadcrumb cluster: 📁 Projects / Title ▾ ⭐
 * Matches the reference's middle column.
 */
export function Breadcrumb({ project, title, starred = false, onToggleStar }: BreadcrumbProps) {
  const t = useT();
  const projectLabel = project ?? t('breadcrumb.projects');
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        minWidth: 0,
        flex: 1,
        justifyContent: 'center',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--font-size-body)',
        color: 'var(--color-text-secondary)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--color-text-secondary)',
        }}
      >
        <span aria-hidden style={{ fontSize: 14 }}>
          📁
        </span>
        <span>{projectLabel}</span>
      </span>
      <span aria-hidden style={{ color: 'var(--color-text-faint)' }}>
        /
      </span>
      <span
        style={{
          color: 'var(--color-text-primary)',
          fontWeight: 500,
          maxWidth: 360,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={title}
      >
        {title}
      </span>
      <button
        type="button"
        onClick={onToggleStar}
        aria-label={starred ? t('breadcrumb.unstar') : t('breadcrumb.star')}
        aria-pressed={starred}
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 24,
          height: 24,
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          color: starred ? 'var(--color-warning)' : 'var(--color-text-faint)',
          cursor: 'pointer',
        }}
      >
        <Star size={14} fill={starred ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}
