// 実績をCSV（表のファイル）に書き出す計算。画面には触らないので、テストで確かめられる。
// Excel と Google スプレッドシートのどちらで開いても、日本語が化けずに読めるようにしてある。
import { addDays, diffMinutes, overlapsDays, startKey } from './date';
import { NONE_KEY, daySegments, sumMinutes, totals } from './stats';
import type { Actual, Category } from './types';

/**
 * 表計算ソフトが「式」として実行してしまう書き出し（= + - @ など）で始まる文字の前に ' を付ける。
 * 予定の題名などには、Googleの予定やAIが書いたものも入るため（書き出したファイルを開いたときに
 * 勝手に計算や外部への接続が起きないように）。
 */
function safeText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function cell(v: string | number): string {
  const s = typeof v === 'number' ? String(v) : safeText(v);
  // , " 改行 を含むときは "" で囲み、中の " は2つ重ねる
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 行の並びをCSVの文字列にする。先頭のBOMは、Excelに「UTF-8の日本語」だと伝えるため。 */
export function toCsv(rows: Array<Array<string | number>>): string {
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** 分 → 時間（小数2けた） */
function hours(min: number): number {
  return Math.round((min / 60) * 100) / 100;
}

export interface ExportInput {
  actuals: Actual[];
  categories: Category[];
  /** 実績のもとになった予定の題名を引くため */
  eventTitle: (id: string) => string | undefined;
  /** 'YYYY-MM-DD'（含む） */
  from: string;
  /** 'YYYY-MM-DD'（含む） */
  to: string;
}

/** 期間にかかる実績（開始の早い順） */
export function actualsIn(actuals: Actual[], from: string, to: string): Actual[] {
  return actuals
    .filter((a) => overlapsDays(a, from, addDays(to, 1)))
    .sort((a, b) => startKey(a).localeCompare(startKey(b)));
}

/** 実績1件を1行にした表 */
export function detailCsv(input: ExportInput): string {
  const cat = new Map(input.categories.map((c) => [c.id, c.name]));
  const rows: Array<Array<string | number>> = [
    ['開始日', '開始時刻', '終了日', '終了時刻', '時間（分）', '内容', '種類', '元の予定', 'メモ'],
  ];
  for (const a of actualsIn(input.actuals, input.from, input.to)) {
    rows.push([
      a.start.slice(0, 10),
      a.start.slice(11, 16),
      a.end.slice(0, 10),
      a.end.slice(11, 16),
      Math.max(0, diffMinutes(a.start, a.end)),
      a.title,
      (a.categoryId && cat.get(a.categoryId)) || '',
      (a.eventId && input.eventTitle(a.eventId)) || '',
      a.memo,
    ]);
  }
  return toCsv(rows);
}

/**
 * 日ごと・種類ごとの合計時間の表。日をまたぐ実績は、それぞれの日の分に分けて数える
 * （「時間の使い方」のグラフと同じ数え方）。
 */
export function summaryCsv(input: ExportInput): string {
  const catOf = (a: Actual) =>
    a.categoryId ? input.categories.find((c) => c.id === a.categoryId) : undefined;
  const days: string[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) days.push(d);
  const perDay = days.map((d) => totals(daySegments(d, input.actuals, catOf), input.categories));

  // 期間のどこかに出てきた種類だけを、設定の並び順で列にする（未分類は最後）
  const labels = new Map(perDay.flat().map((t) => [t.key, t.label]));
  const order = [
    ...input.categories.map((c) => c.id).filter((id) => labels.has(id)),
    ...(labels.has(NONE_KEY) ? [NONE_KEY] : []),
  ];
  const columns = order.map((key) => ({ key, label: labels.get(key)! }));

  const rows: Array<Array<string | number>> = [
    ['日付', ...columns.map((c) => `${c.label}（時間）`), '合計（時間）'],
  ];
  for (const [i, d] of days.entries()) {
    const byKey = new Map(perDay[i].map((t) => [t.key, t.minutes]));
    rows.push([
      d,
      ...columns.map((c) => hours(byKey.get(c.key) ?? 0)),
      hours(sumMinutes(perDay[i])),
    ]);
  }
  const all = perDay.flat();
  rows.push([
    '合計',
    ...columns.map((c) =>
      hours(all.filter((t) => t.key === c.key).reduce((n, t) => n + t.minutes, 0)),
    ),
    hours(sumMinutes(all)),
  ]);
  return toCsv(rows);
}
