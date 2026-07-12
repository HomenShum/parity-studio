/// <reference types="vite/client" />
import '@fontsource-variable/fraunces';
import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { convexWsUrl } from './lib/convexEndpoints';
import { I18nProvider } from './lib/i18n';
import './styles/tokens.css';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

try {
  const convex = new ConvexReactClient(convexWsUrl());
  createRoot(rootEl).render(
    <StrictMode>
      <I18nProvider>
        <ConvexProvider client={convex}>
          <App />
        </ConvexProvider>
      </I18nProvider>
    </StrictMode>,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : 'The backend binding is unavailable.';
  createRoot(rootEl).render(
    <main
      data-testid="deployment-configuration-error"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 32,
        background: '#f4f4f1',
        color: '#20211f',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <section style={{ maxWidth: 560 }}>
        <p style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          NodeSlide deployment guard
        </p>
        <h1>This preview is not connected to a backend.</h1>
        <p>{message}</p>
        <p>Configure this environment with its own Convex deployment, then redeploy.</p>
      </section>
    </main>,
  );
}
