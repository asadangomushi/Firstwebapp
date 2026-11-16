// 時間の使い方の集計（帯グラフ用）。
import { clipToDay, onDay } from './date';
import type { Category } from './types';

export const NONE_KEY = 'none';
export const OTHER_KEY = 'other';

export interface Seg {
  /** 種類のID（未分類は 'none'） */
  key: string;
  label: string;
  color: string;
  /** その日の0時からの分 */
  start: number;
  end: number;
  title: string;
}

export interface Total {
  key: string;
  label: string;
  color: string;
  minutes: number;
}

interface Timed {
  start: string;
  end: string;
  title: string;
}

/** 1日分の帯（時刻順）。日をまたぐものはその日の分だけ切り出す。 */
export function daySegments<T extends Timed>(
  day: string,
  items: T[],
  catOf: (item: T) => Category | undefined,
): Seg[] {
  const out: Seg[] = [];
  for (const it of items) {
    if (!onDay(it, day)) continue;
    const [start, end] = clipToDay(it, day);
    if (end <= start) continue;
    const cat = catOf(it);
    out.push({
      key: cat?.id ?? NONE_KEY,
      label: cat?.name ?? '未分類',
      color: cat?.color ?? 'gray',
      start,
      end,
      title: it.title,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 種類ごとの合計。並びは種類の設定順で固定（未分類は最後）。 */
export function totals(segs: Seg[], categories: Category[]): Total[] {
  const map = new Map<string, Total>();
  for (const s of segs) {
    const t = map.get(s.key) ?? { key: s.key, label: s.label, color: s.color, minutes: 0 };
    t.minutes += s.end - s.start;
    map.set(s.key, t);
  }
  const order = new Map(categories.map((c, i) => [c.id, i]));
  return [...map.values()].sort(
    (a, b) => (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9),
  );
}

/**
 * 色で見分けられるのは8種類ほどまで。それより多いときは、
 * 時間の少ないものを「その他」にまとめる。どれをまとめるかは期間全体で決める
 * （日によって色の意味が変わらないようにするため）。
 */
export function foldKeys(all: Total[], max = 8): Set<string> {
  if (all.length <= max) return new Set();
  const ranked = [...all].sort((a, b) => b.minutes - a.minutes);
  return new Set(ranked.slice(max - 1).map((t) => t.key));
}

export function applyFold(list: Total[], fold: Set<string>): Total[] {
  if (fold.size === 0) return list;
  const kept = list.filter((t) => !fold.has(t.key));
  const rest = list.filter((t) => fold.has(t.key));
  if (rest.length === 0) return kept;
  return [
    ...kept,
    {
      key: OTHER_KEY,
      label: 'その他',
      color: 'gray',
      minutes: rest.reduce((n, t) => n + t.minutes, 0),
    },
  ];
}

export function sumMinutes(list: Array<{ minutes: number }>): number {
  return list.reduce((n, t) => n + t.minutes, 0);
}

/** 目盛りの上限をきりのよい時間にする（分で返す） */
export function niceMax(minutes: number): number {
  const h = minutes / 60;
  const steps = [2, 4, 6, 8, 12, 16, 20, 24];
  const pick = steps.find((s) => h <= s) ?? Math.ceil(h / 6) * 6;
  return pick * 60;
}
