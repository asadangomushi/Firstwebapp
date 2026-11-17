import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme } from './lib/settings';
import { registerServiceWorker } from './lib/share';
import { installSyncHooks } from './lib/sync-hooks';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/calendar.css';
import './styles/pages.css';
import './styles/day.css';
import './styles/chat.css';

applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

if (import.meta.env.DEV) {
  void import('./lib/devtools').then((m) => m.install());
}

registerServiceWorker();
// データの変更を見張る（端末間の同期のため）。データベースに書き込む前に付けておく
installSyncHooks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
