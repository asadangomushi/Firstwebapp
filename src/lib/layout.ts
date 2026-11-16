// カレンダーの配置計算（重なった予定を横に並べる／月表示で帯を段に割り振る）。
import { addDays, isLong, lastDay, startKey } from './date';

export interface Box<T> {
  item: T;
  start: number;
  end: number;
  /** 何列目か（0始まり） */
  col: number;
  /** 同じかたまりの列数 */
  cols: number;
}

/** 見た目の最小の高さ（分）。これより短い予定も、重なり判定ではこの長さとして扱う。 */
export const MIN_VISUAL = 20;

/** 1日の中で重なる予定を列に分ける */
export function layoutDay<T>(items: Array<{ item: T; start: number; end: number }>): Box<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Box<T>[] = [];
  let cluster: Box<T>[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const b of cluster) b.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };

  for (const it of sorted) {
    const vEnd = Math.max(it.end, it.start + MIN_VISUAL);
    if (cluster.length && it.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.start);
    if (col === -1) col = colEnds.length;
    colEnds[col] = vEnd;
    clusterEnd = cluster.length ? Math.max(clusterEnd, vEnd) : vEnd;
    cluster.push({ item: it.item, start: it.start, end: it.end, col, cols: 1 });
  }
  flush();
  return out;
}

interface Span {
  start: string;
  end: string;
  allDay: boolean;
}

export interface WeekBar<T> {
  item: T;
  /** 週の中の開始列 0–6 */
  col: number;
  /** 何日分の幅か */
  span: number;
  /** 上から何段目か */
  lane: number;
  /** 前の週から続いている／次の週へ続く */
  contLeft: boolean;
  contRight: boolean;
  /** 帯（終日・複数日）か、その日だけの時間つき予定か */
  bar: boolean;
}

/** 1週間分の予定を段に割り振る。帯を先に置き、時間つきの予定を空いた段に詰める。 */
export function layoutWeek<T extends Span>(days: string[], items: T[]): WeekBar<T>[] {
  const first = days[0];
  const last = days[days.length - 1];
  const idx = (d: string) => days.indexOf(d);
  const isBar = (e: T) => isLong(e);

  const bars = items
    .filter(isBar)
    .sort(
      (a, b) =>
        startKey(a).localeCompare(startKey(b)) || lastDay(b).localeCompare(lastDay(a)),
    );
  const singles = items
    .filter((e) => !isBar(e))
    .sort((a, b) => startKey(a).localeCompare(startKey(b)));

  const used: boolean[][] = [];
  const isFree = (lane: number, c0: number, c1: number) => {
    const row = used[lane];
    if (!row) return true;
    for (let c = c0; c <= c1; c++) if (row[c]) return false;
    return true;
  };
  const take = (lane: number, c0: number, c1: number) => {
    const row = (used[lane] ??= []);
    for (let c = c0; c <= c1; c++) row[c] = true;
  };
  const place = (c0: number, c1: number) => {
    let lane = 0;
    while (!isFree(lane, c0, c1)) lane++;
    take(lane, c0, c1);
    return lane;
  };

  const out: WeekBar<T>[] = [];
  for (const e of bars) {
    const s = e.start.slice(0, 10);
    const en = lastDay(e);
    if (en < first || s > last) continue;
    const c0 = s < first ? 0 : idx(s);
    const c1 = en > last ? days.length - 1 : idx(en);
    out.push({
      item: e,
      col: c0,
      span: c1 - c0 + 1,
      lane: place(c0, c1),
      contLeft: s < first,
      contRight: en > last,
      bar: true,
    });
  }
  for (const e of singles) {
    const c = idx(e.start.slice(0, 10));
    if (c === -1) continue;
    out.push({ item: e, col: c, span: 1, lane: place(c, c), contLeft: false, contRight: false, bar: false });
  }
  return out;
}

/** 表示できる段数に収め、あふれた分を日ごとの「他n件」にする */
export function fitWeek<T>(
  bars: WeekBar<T>[],
  maxLanes: number,
  dayCount = 7,
): { shown: WeekBar<T>[]; more: number[] } {
  const more = new Array<number>(dayCount).fill(0);
  if (maxLanes <= 0) {
    for (const b of bars) for (let c = b.col; c < b.col + b.span; c++) more[c]++;
    return { shown: [], more };
  }
  // あふれる日は最後の段を「他n件」に使う
  const overflow = new Array<boolean>(dayCount).fill(false);
  for (const b of bars) {
    if (b.lane >= maxLanes) for (let c = b.col; c < b.col + b.span; c++) overflow[c] = true;
  }
  const shown: WeekBar<T>[] = [];
  for (const b of bars) {
    let hide = b.lane >= maxLanes;
    if (!hide && b.lane === maxLanes - 1) {
      for (let c = b.col; c < b.col + b.span; c++) if (overflow[c]) hide = true;
    }
    if (hide) for (let c = b.col; c < b.col + b.span; c++) more[c]++;
    else shown.push(b);
  }
  return { shown, more };
}

export function rangeDays(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}
