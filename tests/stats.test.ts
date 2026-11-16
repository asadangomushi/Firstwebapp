import { describe, expect, it } from 'vitest';
import { applyFold, daySegments, foldKeys, niceMax, sumMinutes, totals } from '../src/lib/stats';
import type { Category } from '../src/lib/types';

const cats: Category[] = ['勉強', '生活', '睡眠'].map((name, order) => ({
  id: name,
  name,
  color: ['blue', 'magenta', 'violet'][order],
  keywords: [],
  monthMode: 'auto',
  order,
}));
const byName = new Map(cats.map((c) => [c.id, c]));
const catOf = (a: { cat?: string }) => (a.cat ? byName.get(a.cat) : undefined);

const items = [
  { start: '2026-11-15T23:30', end: '2026-11-16T07:00', title: '睡眠', cat: '睡眠' },
  { start: '2026-11-16T09:00', end: '2026-11-16T12:00', title: '授業', cat: '勉強' },
  { start: '2026-11-16T12:00', end: '2026-11-16T13:00', title: '昼食', cat: '生活' },
  { start: '2026-11-16T19:00', end: '2026-11-16T21:00', title: 'レポート', cat: '勉強' },
  { start: '2026-11-16T21:00', end: '2026-11-16T21:30', title: '散歩' },
];

describe('時間の使い方の集計', () => {
  it('日をまたぐ実績は、その日の分だけ数える', () => {
    const segs = daySegments('2026-11-16', items, catOf);
    expect(segs[0]).toMatchObject({ key: '睡眠', start: 0, end: 7 * 60 });
    expect(daySegments('2026-11-15', items, catOf)).toHaveLength(1);
  });

  it('種類ごとの合計は、設定の並び順（未分類は最後）', () => {
    const t = totals(daySegments('2026-11-16', items, catOf), cats);
    expect(t.map((x) => [x.label, x.minutes])).toEqual([
      ['勉強', 300],
      ['生活', 60],
      ['睡眠', 420],
      ['未分類', 30],
    ]);
    expect(sumMinutes(t)).toBe(810);
  });

  it('種類が多すぎるときは、少ないものを「その他」にまとめる', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      key: `k${i}`,
      label: `種類${i}`,
      color: 'blue',
      minutes: (i + 1) * 10,
    }));
    const fold = foldKeys(many, 8);
    expect(fold.size).toBe(3);
    const out = applyFold(many, fold);
    expect(out).toHaveLength(8);
    expect(out.at(-1)).toMatchObject({ label: 'その他', minutes: 10 + 20 + 30 });
    expect(sumMinutes(out)).toBe(sumMinutes(many));
  });

  it('目盛りの上限はきりのよい時間', () => {
    expect(niceMax(200)).toBe(240);
    expect(niceMax(60)).toBe(120);
    expect(niceMax(13 * 60)).toBe(16 * 60);
  });
});
