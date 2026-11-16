import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme } from './lib/settings';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/calendar.css';
import './styles/pages.css';

applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

if (import.meta.env.DEV) {
  void import('./lib/devtools').then((m) => m.install());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
