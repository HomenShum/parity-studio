/// <reference types="vite/client" />
import '@fontsource-variable/fraunces';
import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles.css';

const convexUrl = import.meta.env['VITE_CONVEX_URL'] as string | undefined;
const convex = new ConvexReactClient(convexUrl ?? 'https://placeholder.convex.cloud');

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>,
);
