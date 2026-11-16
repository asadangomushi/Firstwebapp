import { describe, expect, it } from 'vitest';
import { weekDays } from '../src/lib/date';
import { fitWeek, layoutDay, layoutWeek } from '../src/lib/layout';

describe('1日の中の重なり', () => {
  it('重ならない予定は1列', () => {
    const out = layoutDay([
      { item: 'a', start: 540, end: 600 },
      { item: 'b', start: 600, end: 660 },
    ]);
    expect(out.map((b) => [b.item, b.col, b.cols])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ]);
  });

  it('重なる予定は横に並べる', () => {
    const out = layoutDay([
      { item: 'a', start: 540, end: 660 },
      { item: 'b', start: 600, end: 720 },
      { item: 'c', start: 660, end: 700 },
    ]);
    const by = Object.fromEntries(out.map((b) => [b.item, b]));
    expect(by.a.col).toBe(0);
    expect(by.b.col).toBe(1);
    // c は a が終わったあとの列を再利用する
    expect(by.c.col).toBe(0);
    expect(out.every((b) => b.cols === 2)).toBe(true);
  });
});

describe('月表示の段の割り振り', () => {
  const days = weekDays('2026-11-23', 1); // 11/23(月)〜11/29(日)
  const ev = (id: string, start: string, end: string, allDay = false) => ({ id, start, end, allDay });

  it('複数日の帯は先に置かれ、週をまたぐと切られる', () => {
    const trip = ev('trip', '2026-11-27', '2026-12-01', true);
    const bars = layoutWeek(days, [trip]);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ col: 4, span: 3, lane: 0, contLeft: false, contRight: true });
  });

  it('同じ日の予定は別の段に入る', () => {
    const bars = layoutWeek(days, [
      ev('a', '2026-11-24T09:00', '2026-11-24T10:00'),
      ev('b', '2026-11-24T13:00', '2026-11-24T14:00'),
      ev('c', '2026-11-25T09:00', '2026-11-25T10:00'),
    ]);
    const by = Object.fromEntries(bars.map((b) => [b.item.id, b]));
    expect(by.a.lane).toBe(0);
    expect(by.b.lane).toBe(1);
    expect(by.c.lane).toBe(0);
  });

  it('入りきらない分は「他n件」になる', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      ev(`e${i}`, `2026-11-24T${String(9 + i).padStart(2, '0')}:00`, `2026-11-24T${String(10 + i).padStart(2, '0')}:00`),
    );
    const { shown, more } = fitWeek(layoutWeek(days, many), 3);
    // 3段のうち最後の1段は「他n件」に使う
    expect(shown).toHaveLength(2);
    expect(more[1]).toBe(3);
    expect(more[0]).toBe(0);
  });
});
