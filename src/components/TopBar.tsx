import { Wordmark } from './Wordmark';

/**
 * TopBar — Sprint 1 thin replacement.
 *
 * Sprint 2 expands this to include Breadcrumb (Projects / title / star) and
 * the right-side HeaderActions cluster (Comment mode · zoom · Export). For
 * now we just ship the Wordmark in the cream-light surface so the rest of
 * the app reskins consistently.
 */
export function TopBar() {
  return (
    <header
      className="header"
      style={{
        height: 'var(--size-titlebar-height)',
        background: 'var(--color-background)',
        borderBottom: '1px solid var(--color-border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-6)',
        flexShrink: 0,
      }}
    >
      <Wordmark />
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-mono-sm)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--color-surface-hover)',
            border: '1px solid var(--color-border-subtle)',
          }}
          aria-live="polite"
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-success)',
            }}
          />
          <span>Convex</span>
        </div>
        <a
          href="https://github.com/HomenShum/parity-studio"
          aria-label="View source on GitHub"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          source
        </a>
      </div>
    </header>
  );
}
