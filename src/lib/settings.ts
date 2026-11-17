// 端末ごとの設定（localStorage）。APIキーなどもここに入り、この端末の外には送らない。
import { useSyncExternalStore } from 'react';
import { LOCAL_CALENDAR } from './db';

export type AssistantId = 'claude' | 'gemini';

/** アプリ内で話しかけられるAIの一覧（名前と、APIキーをしまう設定項目） */
export const ASSISTANTS: Record<
  AssistantId,
  { name: string; keyField: 'claudeApiKey' | 'geminiApiKey' }
> = {
  claude: { name: 'Claude', keyField: 'claudeApiKey' },
  gemini: { name: 'Gemini', keyField: 'geminiApiKey' },
};

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  /** 週の始まり 0=日曜 1=月曜 */
  weekStartsOn: 0 | 1;
  /** 月表示で「特別な予定だけ」に絞るか */
  monthSpecialOnly: boolean;
  /** 新しい予定を入れるカレンダー */
  defaultCalendarId: string;
  googleClientId: string;
  /** Googleドライブを使って、端末間で手帳の中身を同期するか */
  driveSync: boolean;
  /** 同期する範囲（今日から前後の月数） */
  syncPastMonths: number;
  syncFutureMonths: number;
  /** アプリ内で話しかけるAI */
  aiProvider: AssistantId;
  claudeApiKey: string;
  claudeModel: string;
  geminiApiKey: string;
  geminiModel: string;
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
  driveSync: false,
  syncPastMonths: 3,
  syncFutureMonths: 12,
  aiProvider: 'claude',
  claudeApiKey: '',
  claudeModel: 'claude-opus-5-5',
  geminiApiKey: '',
  // Google公式SDKの説明書で例に使われているモデル。設定画面で一覧から選び直せる。
  geminiModel: 'gemini-3.8-flash',
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

/** いま選ばれているAIの名前と、APIキーが入っているか */
export function assistantInfo(s: Settings): { name: string; hasKey: boolean } {
  const a = ASSISTANTS[s.aiProvider] ?? ASSISTANTS.claude;
  return { name: a.name, hasKey: !!s[a.keyField] };
}
