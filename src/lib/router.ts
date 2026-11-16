// URLの # 以降で画面を切り替える（戻るボタンがそのまま効く）。
import { useSyncExternalStore } from 'react';
import { today } from './date';

export type CalView = 'month' | 'week' | 'day';

export type Route =
  | { name: CalView; date: string }
  | { name: 'timeuse'; date: string }
  | { name: 'diary'; date: string }
  | { name: 'event'; id: string }
  | { name: 'projects' }
  | { name: 'project'; id: string }
  | { name: 'settings' }
  | { name: 'inbox' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LAST_VIEW = 'techo.lastView';

function lastView(): CalView {
  try {
    const v = localStorage.getItem(LAST_VIEW);
    if (v === 'month' || v === 'week' || v === 'day') return v;
  } catch {
    // 無視
  }
  return 'month';
}

export function parseHash(hash: string): Route {
  const [name, arg] = hash.replace(/^#\/?/, '').split('/');
  const date = arg && DATE.test(arg) ? arg : today();
  switch (name) {
    case 'month':
    case 'week':
    case 'day':
    case 'timeuse':
    case 'diary':
      return { name, date };
    case 'event':
      return arg ? { name, id: decodeURIComponent(arg) } : { name: lastView(), date: today() };
    case 'project':
      return arg ? { name, id: decodeURIComponent(arg) } : { name: 'projects' };
    case 'projects':
    case 'settings':
    case 'inbox':
      return { name };
    default:
      return { name: lastView(), date: today() };
  }
}

export function toHash(r: Route): string {
  if ('date' in r) return `#/${r.name}/${r.date}`;
  if ('id' in r) return `#/${r.name}/${encodeURIComponent(r.id)}`;
  return `#/${r.name}`;
}

let cached: { hash: string; route: Route } | null = null;

function current(): Route {
  const hash = location.hash;
  if (!cached || cached.hash !== hash) cached = { hash, route: parseHash(hash) };
  return cached.route;
}

function subscribe(l: () => void): () => void {
  window.addEventListener('hashchange', l);
  return () => window.removeEventListener('hashchange', l);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current);
}

export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const hash = toHash(r);
  if (r.name === 'month' || r.name === 'week' || r.name === 'day') {
    try {
      localStorage.setItem(LAST_VIEW, r.name);
    } catch {
      // 無視
    }
  }
  if (hash === location.hash) return;
  if (opts.replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

/** 予定ページなどから戻る。履歴がなければカレンダーへ。 */
export function goBack(): void {
  if (history.length > 1) history.back();
  else navigate({ name: lastView(), date: today() });
}

export function isCalView(r: Route): r is { name: CalView; date: string } {
  return r.name === 'month' || r.name === 'week' || r.name === 'day';
}
