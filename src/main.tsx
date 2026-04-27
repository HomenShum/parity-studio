import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
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
