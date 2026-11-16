// 端末ごとの設定（localStorage）。APIキーなどもここに入り、この端末の外には送らない。
import { useSyncExternalStore } from 'react';
import { LOCAL_CALENDAR } from './db';

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  /** 週の始まり 0=日曜 1=月曜 */
  weekStartsOn: 0 | 1;
  /** 月表示で「特別な予定だけ」に絞るか */
  monthSpecialOnly: boolean;
  /** 新しい予定を入れるカレンダー */
  defaultCalendarId: string;
  googleClientId: string;
  /** 同期する範囲（今日から前後の月数） */
  syncPastMonths: number;
  syncFutureMonths: number;
  claudeApiKey: string;
  claudeModel: string;
  /** 週の時間の使い方の表示 */
  timeUseMode: 'timeline' | 'total';
  timeUseShowPlan: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  weekStartsOn: 1,
  monthSpecialOnly: true,
  defaultCalendarId: LOCAL_CALENDAR,
  googleClientId: '',
  syncPastMonths: 3,
  syncFutureMonths: 12,
  claudeApiKey: '',
  claudeModel: 'claude-opus-5-5',
  timeUseMode: 'timeline',
  timeUseShowPlan: false,
};

const KEY = 'techo.settings';
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  let stored: Partial<Settings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
  } catch {
    // 壊れていたら初期値に戻す
  }
  cache = { ...DEFAULT_SETTINGS, ...stored };
  return cache;
}

export function getSettings(): Settings {
  return read();
}

export function setSettings(patch: Partial<Settings>): void {
  cache = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // 保存できなくても画面は動かす
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read);
}

/** ライト／ダークを画面に反映する */
export function applyTheme(): void {
  const t = read().theme;
  const dark =
    t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
