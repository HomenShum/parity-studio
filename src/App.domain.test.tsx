// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The scenario: someone follows README.md, opens `?domain=parity` on production, and gets the
 * NodeSlide studio. Nothing errored, nothing logged — the request was discarded in silence, so a
 * gated feature and an unrequested one rendered the same screen.
 *
 * That is what makes it worth a test rather than a one-line fix: verified against the deployed
 * bundle, `VITE_ENABLE_PARITY_DOMAIN` is absent from the shipped env object, so the documented
 * deep link has never worked in production. The regression to guard is the silence, not the flag.
 */

// The real App pulls in Convex, the whole legacy shell and two lazy studios. None of that is under
// test here — only the routing decision — so the leaves are stubbed to keep the assertion honest
// about what it is actually proving.
vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useMutation: () => async () => undefined,
  useAction: () => async () => undefined,
  useConvex: () => ({}),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: false }),
}));
vi.mock('./domains/nodeslide/NodeSlideStudio', () => ({
  NodeSlideStudio: () => <div data-testid="stub-nodeslide" />,
}));
vi.mock('./domains/nodeslide/atlas/AtlasGallery', () => ({
  AtlasGallery: () => <div data-testid="stub-atlas" />,
}));

async function renderAt(search: string, env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  window.history.replaceState(null, '', `/${search}`);
  const { default: App } = await import('./App');
  return render(<App />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('domain routing: a gated surface must not look like an ungated default', () => {
  it('explains itself when parity is requested but the flag is unset', async () => {
    await renderAt('?domain=parity');
    const notice = await screen.findByTestId('parity-domain-disabled');
    expect(notice).toBeInTheDocument();
    // Naming the variable is the difference between "broken link" and "one env var away".
    expect(screen.getByTestId('parity-domain-reason')).toHaveTextContent(
      'VITE_ENABLE_PARITY_DOMAIN',
    );
    expect(screen.queryByTestId('stub-nodeslide')).not.toBeInTheDocument();
  });

  it('serves the real Parity shell once the flag is set', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_ENABLE_PARITY_DOMAIN', 'true');
    window.history.replaceState(null, '', '/?domain=parity');
    // The legacy shell is the only branch that needs the real provider tree — reaching it at all
    // is the assertion, since the notice and the NodeSlide stub both render without one.
    const [{ default: App }, { I18nProvider }] = await Promise.all([
      import('./App'),
      import('./lib/i18n'),
    ]);
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    expect(screen.queryByTestId('parity-domain-disabled')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-nodeslide')).not.toBeInTheDocument();
  });

  it('does NOT show the notice to someone who never asked for parity', async () => {
    await renderAt('');
    expect(await screen.findByTestId('stub-nodeslide')).toBeInTheDocument();
    expect(screen.queryByTestId('parity-domain-disabled')).not.toBeInTheDocument();
  });

  it('keeps the atlas surface reachable regardless of the parity flag', async () => {
    // Atlas is checked before the gate and is the surface currently live in production.
    await renderAt('?domain=atlas');
    expect(await screen.findByTestId('stub-atlas')).toBeInTheDocument();
  });

  it('still routes an explicit nodeslide request to nodeslide', async () => {
    await renderAt('?domain=nodeslide');
    expect(await screen.findByTestId('stub-nodeslide')).toBeInTheDocument();
  });

  it('offers a way out of the notice instead of stranding the visitor', async () => {
    await renderAt('?domain=parity');
    await screen.findByTestId('parity-domain-disabled');
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('?domain=nodeslide');
    expect(links).toContain('?domain=atlas');
  });
});
