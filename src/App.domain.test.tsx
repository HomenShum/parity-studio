// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The old scenario here was a gated surface that looked like an ungated default: `?domain=parity`
 * silently rendered NodeSlide because `VITE_ENABLE_PARITY_DOMAIN` was unset in production, and the
 * fix was a notice that named the variable.
 *
 * Phase 4 of docs/DECOUPLING_PLAN.md removes the gate instead of explaining it. Parity is this
 * repo's product again, so it is what an unqualified visit renders, and the notice is gone because
 * the state it described is no longer reachable by default. The regression to guard is now the
 * inverse of the original one: resurfacing parity must not quietly evict the NodeSlide and Atlas
 * routes that are still compiled into this bundle, because their deletion is Phase 3 and Phase 3
 * is gated on a port audit that is still red.
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

/**
 * The parity branch is the only one that needs the real provider tree — the NodeSlide and Atlas
 * stubs both render without one — so reaching it at all is part of the assertion.
 */
async function renderParityAt(search: string, env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  window.history.replaceState(null, '', `/${search}`);
  const [{ default: App }, { I18nProvider }] = await Promise.all([
    import('./App'),
    import('./lib/i18n'),
  ]);
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('domain routing: parity is the product this repo serves', () => {
  it('renders the Parity shell to someone who asked for nothing in particular', async () => {
    await renderParityAt('');
    expect(await screen.findByTestId('parity-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-nodeslide')).not.toBeInTheDocument();
  });

  it('renders the Parity shell for the documented deep link', async () => {
    await renderParityAt('?domain=parity');
    expect(await screen.findByTestId('parity-shell')).toBeInTheDocument();
  });

  it('no longer ships the disabled interstitial in any routing state', async () => {
    for (const search of ['', '?domain=parity', '?domain=nodeslide', '?domain=atlas']) {
      cleanup();
      await renderParityAt(search);
      expect(
        screen.queryByTestId('parity-domain-disabled'),
        `interstitial rendered for ${search || '(no query)'}`,
      ).not.toBeInTheDocument();
    }
  });

  it('keeps ?domain=nodeslide working as a route inside this bundle', async () => {
    // Production sends this to nodeslide.vercel.app at the edge (vercel.json), but the route
    // itself must survive here: deleting it is Phase 3, and Phase 3 has not exited.
    await renderAt('?domain=nodeslide');
    expect(await screen.findByTestId('stub-nodeslide')).toBeInTheDocument();
  });

  it('keeps the Atlas gallery reachable, which parity still declares itself canonical for', async () => {
    await renderAt('?domain=atlas');
    expect(await screen.findByTestId('stub-atlas')).toBeInTheDocument();
  });

  it('honours the kill switch: an explicit false falls back to NodeSlide', async () => {
    // The flag survives resurfacing as a way to undo it without a revert. It has to actually
    // work, or it is decoration in the one situation where someone reaches for it.
    await renderAt('', { VITE_ENABLE_PARITY_DOMAIN: 'false' });
    expect(await screen.findByTestId('stub-nodeslide')).toBeInTheDocument();
    cleanup();
    await renderAt('?domain=parity', { VITE_ENABLE_PARITY_DOMAIN: 'false' });
    expect(await screen.findByTestId('stub-nodeslide')).toBeInTheDocument();
  });

  it('lets VITE_STUDIO_DOMAIN pin a deployment to NodeSlide without touching the flag', async () => {
    await renderAt('', { VITE_STUDIO_DOMAIN: 'nodeslide' });
    expect(await screen.findByTestId('stub-nodeslide')).toBeInTheDocument();
  });
});
