// 日付まわりの小さな道具。すべて端末のローカル時刻で扱う。

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
export const MIN_PER_DAY = 24 * 60;

const pad = (n: number) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date → 'YYYY-MM-DDTHH:mm' */
export function toLocal(d: Date): string {
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 'YYYY-MM-DD' または 'YYYY-MM-DDTHH:mm' → Date */
export function parse(s: string): Date {
  const [date, time] = s.split('T');
  const [y, m, d] = date.split('-').map(Number);
  if (!time) return new Date(y, m - 1, d);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

export function today(): string {
  return ymd(new Date());
}

/** 日付文字列に日数を足す */
export function addDays(date: string, n: number): string {
  const d = parse(date.slice(0, 10));
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** 月を足す。日は月末に収める（1/31 + 1か月 = 2/28）。 */
export function addMonths(date: string, n: number): string {
  const d = parse(date.slice(0, 10));
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return ymd(d);
}

/** 日時文字列に分を足す */
export function addMinutes(dt: string, n: number): string {
  const d = parse(dt);
  d.setMinutes(d.getMinutes() + n);
  return toLocal(d);
}

export function startOfWeek(date: string, weekStartsOn: number): string {
  const d = parse(date.slice(0, 10));
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(ymd(d), -diff);
}

export function startOfMonth(date: string): string {
  return date.slice(0, 8) + '01';
}

export function weekDays(date: string, weekStartsOn: number): string[] {
  const s = startOfWeek(date, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** 月表示に並べる週（それぞれ7日）。その月が収まるだけの週数を返す。 */
export function monthGrid(date: string, weekStartsOn: number): string[][] {
  const first = startOfMonth(date);
  const month = first.slice(0, 7);
  const weeks: string[][] = [];
  let cur = startOfWeek(first, weekStartsOn);
  do {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
    cur = addDays(cur, 7);
  } while (cur.slice(0, 7) === month);
  return weeks;
}

export function dayOfWeek(date: string): number {
  return parse(date.slice(0, 10)).getDay();
}

/** 2つの日付の差（b - a）を日数で */
export function diffDays(a: string, b: string): number {
  const ms = parse(b.slice(0, 10)).getTime() - parse(a.slice(0, 10)).getTime();
  return Math.round(ms / 86400000);
}

/** 2つの日時の差（b - a）を分で */
export function diffMinutes(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 60000);
}

/** その日の0時からの分。日付が違うときは前後にはみ出した値になる。 */
export function minutesFrom(day: string, dt: string): number {
  return diffMinutes(day + 'T00:00', dt.length === 10 ? dt + 'T00:00' : dt);
}

export function minutesToTime(min: number): string {
  const m = ((min % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** 日付 + 0時からの分 → 日時文字列（1440以上なら翌日になる） */
export function atMinutes(day: string, min: number): string {
  return addMinutes(day + 'T00:00', min);
}

export function snap(min: number, step: number): number {
  return Math.round(min / step) * step;
}

// ---- 表示用 ----

export function fmtTime(dt: string): string {
  const t = dt.slice(11, 16);
  return t.startsWith('0') ? t.slice(1) : t;
}

export function fmtMonthTitle(date: string): string {
  const d = parse(date.slice(0, 10));
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/** 11月16日(月) */
export function fmtDay(date: string, withYear = false): string {
  const d = parse(date.slice(0, 10));
  const base = `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
  return withYear ? `${d.getFullYear()}年${base}` : base;
}

/** 11/16(月) */
export function fmtDayShort(date: string): string {
  const d = parse(date.slice(0, 10));
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

export function fmtWeekTitle(days: string[]): string {
  const a = parse(days[0]);
  const b = parse(days[6]);
  if (a.getMonth() === b.getMonth()) return `${a.getFullYear()}年${a.getMonth() + 1}月`;
  if (a.getFullYear() === b.getFullYear()) {
    return `${a.getFullYear()}年${a.getMonth() + 1}月 – ${b.getMonth() + 1}月`;
  }
  return `${a.getFullYear()}年${a.getMonth() + 1}月 – ${b.getFullYear()}年${b.getMonth() + 1}月`;
}

/** 分 → '1時間30分' */
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}分`;
  if (r === 0) return `${h}時間`;
  return `${h}時間${r}分`;
}

/** 分 → '1.5h'（グラフの数値用） */
export function fmtHours(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return `${h}h`;
}

/** 予定の日時を人が読める形に */
export function fmtEventWhen(e: { start: string; end: string; allDay: boolean }): string {
  if (e.allDay) {
    const last = addDays(e.end, -1);
    if (last <= e.start) return fmtDay(e.start, true);
    return `${fmtDay(e.start, true)} – ${fmtDay(last)}`;
  }
  const sameDay = e.start.slice(0, 10) === e.end.slice(0, 10);
  if (sameDay) return `${fmtDay(e.start, true)} ${fmtTime(e.start)}–${fmtTime(e.end)}`;
  return `${fmtDay(e.start, true)} ${fmtTime(e.start)} – ${fmtDay(e.end)} ${fmtTime(e.end)}`;
}

/** 今日からの相対表現（あと3日 / 今日 / 2日前） */
export function fmtRelative(date: string): string {
  const n = diffDays(today(), date);
  if (n === 0) return '今日';
  if (n === 1) return '明日';
  if (n === -1) return '昨日';
  return n > 0 ? `あと${n}日` : `${-n}日前`;
}

// ---- 予定の範囲計算 ----

interface Span {
  start: string;
  end: string;
  allDay?: boolean;
}

/** 比較用に 'YYYY-MM-DDTHH:mm' へそろえる */
export function startKey(e: Span): string {
  return e.start.length === 10 ? e.start + 'T00:00' : e.start;
}
export function endKey(e: Span): string {
  return e.end.length === 10 ? e.end + 'T00:00' : e.end;
}

/** [from, to) と重なるか。from/to は 'YYYY-MM-DD'。 */
export function overlapsDays(e: Span, from: string, to: string): boolean {
  const s = startKey(e);
  const en = endKey(e);
  // 長さ0の予定（開始=終了）は開始時刻で判定する
  if (s === en) return s >= from + 'T00:00' && s < to + 'T00:00';
  return s < to + 'T00:00' && en > from + 'T00:00';
}

export function onDay(e: Span, day: string): boolean {
  return overlapsDays(e, day, addDays(day, 1));
}

/** 予定がかかる最後の日（含む） */
export function lastDay(e: Span): string {
  const en = endKey(e);
  const s = startKey(e);
  if (en <= s) return s.slice(0, 10);
  // 0:00ちょうどで終わるなら前日まで
  return en.endsWith('T00:00') ? addDays(en.slice(0, 10), -1) : en.slice(0, 10);
}

/** 複数日にまたがるか（終日予定は1日でも帯として扱う） */
export function isMultiDay(e: Span): boolean {
  return lastDay(e) > e.start.slice(0, 10);
}

/** 終日、または24時間以上続く予定（時間の枠ではなく上の帯に出す） */
export function isLong(e: Span): boolean {
  return !!e.allDay || e.start.length === 10 || diffMinutes(startKey(e), endKey(e)) >= MIN_PER_DAY;
}

/** その日の中での [開始分, 終了分]（0〜1440に切り詰め） */
export function clipToDay(e: Span, day: string): [number, number] {
  const s = Math.max(0, minutesFrom(day, startKey(e)));
  const en = Math.min(MIN_PER_DAY, minutesFrom(day, endKey(e)));
  return [s, Math.max(s, en)];
}
