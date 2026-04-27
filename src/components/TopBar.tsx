/**
 * TopBar — DOM structure verbatim from platform-generated parity-studio/index.html.
 * Header with logo + Convex status + source link.
 */
export function TopBar() {
  return (
    <header className="header">
      <div className="logo">
        <div className="logo-icon" aria-hidden="true">
          P
        </div>
        <span>Parity Studio</span>
      </div>
      <div className="header-right">
        <div className="convex-badge" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          <span>Convex</span>
        </div>
        <a
          href="https://github.com/HomenShum/parity-studio"
          aria-label="View source on GitHub"
        >
          source
        </a>
      </div>
    </header>
  );
}
