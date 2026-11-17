import { describe, expect, it } from 'vitest';
import { detailCsv, summaryCsv, toCsv } from '../src/lib/csv';
import type { Actual, Category } from '../src/lib/types';

const cats: Category[] = [
  { id: 'study', name: '勉強', color: 'blue', keywords: [], monthMode: 'auto', order: 0 },
  { id: 'sleep', name: '睡眠', color: 'violet', keywords: [], monthMode: 'auto', order: 1 },
];

const act = (id: string, start: string, end: string, patch: Partial<Actual> = {}): Actual => ({
  id,
  start,
  end,
  title: id,
  memo: '',
  ...patch,
});

const actuals: Actual[] = [
  act('睡眠', '2026-11-15T23:30', '2026-11-16T07:00', { categoryId: 'sleep' }),
  act('授業', '2026-11-16T09:00', '2026-11-16T10:30', { categoryId: 'study', eventId: 'e1' }),
  act('散歩', '2026-11-16T18:00', '2026-11-16T18:30'),
  act('期間外', '2026-11-20T09:00', '2026-11-20T10:00', { categoryId: 'study' }),
];

const input = {
  actuals,
  categories: cats,
  eventTitle: (id: string) => (id === 'e1' ? '線形代数' : undefined),
  from: '2026-11-16',
  to: '2026-11-17',
};

const lines = (csv: string) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

describe('CSVの形', () => {
  it('Excelで化けないよう、先頭にBOMを付け、行は CRLF で区切る', () => {
    const csv = toCsv([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿a,b\r\nc,d\r\n');
  });

  it('カンマ・引用符・改行を含む文字は囲む', () => {
    expect(lines(toCsv([['a,b', 'say "hi"', '1行目\n2行目']]))[0]).toBe(
      '"a,b","say ""hi""","1行目\n2行目"',
    );
  });

  it("表計算ソフトで式として動いてしまう書き出しは、前に ' を付けて文字のままにする", () => {
    expect(lines(toCsv([['=HYPERLINK("x")', '+1', '-2', '@a', 'ふつう']]))[0]).toBe(
      `"'=HYPERLINK(""x"")",'+1,'-2,'@a,ふつう`,
    );
    // 数として渡したものはそのまま
    expect(lines(toCsv([[-5]]))[0]).toBe('-5');
  });
});

describe('実績1件ずつ', () => {
  it('期間にかかる実績を、開始の早い順に1行ずつ並べる', () => {
    const rows = lines(detailCsv(input));
    expect(rows[0]).toBe('開始日,開始時刻,終了日,終了時刻,時間（分）,内容,種類,元の予定,メモ');
    expect(rows.slice(1)).toEqual([
      '2026-11-15,23:30,2026-11-16,07:00,450,睡眠,睡眠,,',
      '2026-11-16,09:00,2026-11-16,10:30,90,授業,勉強,線形代数,',
      '2026-11-16,18:00,2026-11-16,18:30,30,散歩,,,',
    ]);
  });
});

describe('日ごとの合計', () => {
  it('日をまたぐ実績は日ごとに分け、出てきた種類だけを設定の順に並べる（未分類は最後）', () => {
    const rows = lines(summaryCsv(input));
    expect(rows).toEqual([
      '日付,勉強（時間）,睡眠（時間）,未分類（時間）,合計（時間）',
      '2026-11-16,1.5,7,0.5,9',
      '2026-11-17,0,0,0,0',
      '合計,1.5,7,0.5,9',
    ]);
  });
});
