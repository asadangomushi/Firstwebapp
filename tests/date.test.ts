import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMinutes,
  addMonths,
  clipToDay,
  diffDays,
  fmtDuration,
  fmtEventWhen,
  isLong,
  lastDay,
  monthGrid,
  onDay,
  overlapsDays,
  startOfWeek,
  weekDays,
} from '../src/lib/date';

describe('日付の計算', () => {
  it('日・月・分を足す', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMinutes('2026-11-16T23:30', 45)).toBe('2026-11-17T00:15');
    expect(diffDays('2026-11-16', '2026-12-05')).toBe(19);
  });

  it('週の始まり（月曜・日曜）', () => {
    // 2026-11-16 は月曜
    expect(startOfWeek('2026-11-18', 1)).toBe('2026-11-16');
    expect(startOfWeek('2026-11-18', 0)).toBe('2026-11-15');
    expect(startOfWeek('2026-11-15', 1)).toBe('2026-11-09');
    expect(weekDays('2026-11-18', 1)).toHaveLength(7);
  });

  it('月表示のマス目は、その月が収まる週数になる', () => {
    const nov = monthGrid('2026-11-16', 1);
    expect(nov[0][0]).toBe('2026-10-26');
    expect(nov.at(-1)![6]).toBe('2026-12-06');
    expect(nov).toHaveLength(6);
    // 2026年2月は日曜始まりならちょうど4週
    expect(monthGrid('2026-02-10', 0)).toHaveLength(4);
  });
});

describe('予定の範囲', () => {
  const timed = { start: '2026-11-16T09:00', end: '2026-11-16T10:30', allDay: false };
  const overnight = { start: '2026-11-16T23:00', end: '2026-11-17T07:00', allDay: false };
  const trip = { start: '2026-11-27', end: '2026-11-30', allDay: true };

  it('その日にかかるか', () => {
    expect(onDay(timed, '2026-11-16')).toBe(true);
    expect(onDay(timed, '2026-11-17')).toBe(false);
    expect(onDay(overnight, '2026-11-17')).toBe(true);
    expect(onDay(trip, '2026-11-29')).toBe(true);
    // 終日の終わりは「含まない」
    expect(onDay(trip, '2026-11-30')).toBe(false);
    expect(overlapsDays(trip, '2026-11-30', '2026-12-07')).toBe(false);
  });

  it('0時ちょうどに終わる予定は前日まで', () => {
    expect(lastDay({ start: '2026-11-16T22:00', end: '2026-11-17T00:00' })).toBe('2026-11-16');
    expect(lastDay(overnight)).toBe('2026-11-17');
    expect(lastDay(trip)).toBe('2026-11-29');
  });

  it('日をまたぐ予定は、その日の分だけ切り出す', () => {
    expect(clipToDay(overnight, '2026-11-16')).toEqual([23 * 60, 24 * 60]);
    expect(clipToDay(overnight, '2026-11-17')).toEqual([0, 7 * 60]);
  });

  it('終日・24時間以上は帯として扱う', () => {
    expect(isLong(trip)).toBe(true);
    expect(isLong(overnight)).toBe(false);
    expect(isLong({ start: '2026-11-16T09:00', end: '2026-11-17T09:00', allDay: false })).toBe(true);
  });

  it('表示用の文字列', () => {
    expect(fmtDuration(90)).toBe('1時間30分');
    expect(fmtDuration(45)).toBe('45分');
    expect(fmtEventWhen(timed)).toBe('2026年11月16日(月) 9:00–10:30');
    expect(fmtEventWhen(trip)).toBe('2026年11月27日(金) – 11月29日(日)');
  });
});
