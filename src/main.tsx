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

const convex = new ConvexReactClient(convexWsUrl());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    </I18nProvider>
  </StrictMode>,
);
