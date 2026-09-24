import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { pruneHistory } from './data/history';
import { registerPwa } from './pwa';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerPwa();

// keep the change history within its storage budget (data/history.ts); failures are harmless
void pruneHistory().catch(() => undefined);
