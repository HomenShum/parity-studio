/**
 * Cross-platform browser launcher. Best-effort: never fails the MCP call if
 * the browser open fails — just logs and continues. The dashboard URL is
 * also returned in the MCP tool response so the agent can show it to the
 * user as a fallback.
 *
 * Behavior is gated by PARITY_DASHBOARD env:
 *   "auto-open" (default) — open the browser on first run; reuse existing
 *   "server-only"          — start the HTTP server but never open a browser
 *   "disabled"             — don't even start the server
 */

import open from 'open';

export type DashboardMode = 'auto-open' | 'server-only' | 'disabled';

export function dashboardMode(): DashboardMode {
  const v = (process.env['PARITY_DASHBOARD'] ?? 'auto-open').toLowerCase().trim();
  if (v === 'server-only') return 'server-only';
  if (v === 'disabled' || v === 'off' || v === 'false' || v === '0') return 'disabled';
  return 'auto-open';
}

let openedOnce = false;

export async function openDashboardOnce(url: string): Promise<void> {
  if (openedOnce) return;
  if (dashboardMode() !== 'auto-open') return;
  openedOnce = true;
  try {
    await open(url);
  } catch (err) {
    // Don't crash the MCP call — log to stderr (which doesn't pollute the
    // MCP stdout JSON-RPC channel) and continue. The agent can still surface
    // the URL to the user from the tool response.
    console.error(
      `[parity-studio-mcp] failed to auto-open dashboard at ${url}; open it manually:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
