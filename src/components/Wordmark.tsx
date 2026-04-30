/**
 * Wordmark — brand cluster used in the TopBar.
 *
 * Layout: terracotta P-square logo + "Parity Studio" wordmark (display serif)
 * + version badge. Mirrors the reference in
 * docs/plans/2026-04-28-shell-revamp-from-reference.md §10.
 */
interface WordmarkProps {
  badge?: string;
  size?: 'sm' | 'md';
}

export function Wordmark({ badge = 'v0.1.0', size = 'md' }: WordmarkProps) {
  const squareSize = size === 'sm' ? 28 : 36;
  const titleSize = size === 'sm' ? 17 : 19;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
      }}
    >
      <div
        aria-hidden
        style={{
          width: squareSize,
          height: squareSize,
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-accent)',
          color: 'var(--color-on-accent)',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: size === 'sm' ? 16 : 20,
          letterSpacing: '-0.02em',
          boxShadow: 'var(--shadow-soft)',
        }}
      >
        P
      </div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 'var(--space-3)',
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: titleSize,
            fontWeight: 500,
            letterSpacing: '-0.015em',
            color: 'var(--color-text-primary)',
            lineHeight: 1,
          }}
        >
          Parity Studio
        </span>
        {badge ? (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.12em',
              color: 'var(--color-text-secondary)',
              background: 'var(--color-surface-active)',
              padding: '3px 7px',
              borderRadius: 'var(--radius-sm)',
              textTransform: 'uppercase',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}
