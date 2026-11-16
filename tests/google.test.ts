import { describe, expect, it } from 'vitest';
import { fromGoogle, toGoogle, toRRule } from '../src/lib/google';
import { linkLabel, normalizeUrl } from '../src/lib/links';
import { linksFromText } from '../src/lib/share';
import { occurrenceDates } from '../src/lib/store';

describe('Googleカレンダーとの変換', () => {
  it('時間つきの予定は端末の時刻になる', () => {
    const core = fromGoogle({
      id: 'g1',
      summary: '線形代数',
      start: { dateTime: '2026-11-16T10:40:00+09:00' },
      end: { dateTime: '2026-11-16T12:10:00+09:00' },
    });
    // テストはどのタイムゾーンで走ってもよいよう、同じ瞬間を指すことだけ確かめる
    expect(new Date(core!.start).getTime()).toBe(new Date('2026-11-16T10:40:00+09:00').getTime());
    expect(core).toMatchObject({ title: '線形代数', allDay: false });
  });

  it('終日の予定と、題名のない予定', () => {
    const core = fromGoogle({
      id: 'g2',
      start: { date: '2026-11-21' },
      end: { date: '2026-11-23' },
    });
    expect(core).toEqual({
      title: '（タイトルなし）',
      start: '2026-11-21',
      end: '2026-11-23',
      allDay: true,
      location: '',
      memo: '',
    });
  });

  it('時刻のない予定は取り込まない', () => {
    expect(fromGoogle({ id: 'g3', summary: 'x' })).toBeNull();
  });

  it('変更した項目だけをGoogleへ送る', () => {
    const e = {
      title: '歓迎会',
      start: '2026-11-18T19:00',
      end: '2026-11-18T21:00',
      allDay: false,
      location: '駅前',
      memo: 'メモ',
    };
    expect(toGoogle(e, ['title'])).toEqual({ summary: '歓迎会' });
    const time = toGoogle(e, ['time']) as { start: { dateTime: string; date: null } };
    expect(new Date(time.start.dateTime).getTime()).toBe(new Date(2026, 10, 18, 19, 0).getTime());
    // 終日から時間つきへ変えたとき、Google側の日付指定を消すために null を送る
    expect(time.start.date).toBeNull();
    expect(Object.keys(toGoogle(e)).sort()).toEqual([
      'description',
      'end',
      'location',
      'start',
      'summary',
    ]);
  });

  it('繰り返しのルール', () => {
    expect(toRRule({ freq: 'weekly', until: '2027-03-31' }, true)).toBe(
      'RRULE:FREQ=WEEKLY;UNTIL=20270331',
    );
    expect(toRRule({ freq: 'daily', until: '2027-03-31' }, false)).toMatch(
      /^RRULE:FREQ=DAILY;UNTIL=\d{8}T\d{6}Z$/,
    );
  });
});

describe('繰り返しの各回', () => {
  it('毎週・毎月・毎日', () => {
    expect(occurrenceDates('2026-11-16T09:00', { freq: 'weekly', until: '2026-12-07' })).toEqual([
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
      '2026-12-07',
    ]);
    expect(occurrenceDates('2026-01-31', { freq: 'monthly', until: '2026-04-30' })).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(occurrenceDates('2026-11-16', { freq: 'daily', until: '2026-11-18' })).toHaveLength(3);
  });

  it('終了日が開始より前でも、最初の1回は作る', () => {
    expect(occurrenceDates('2026-11-16', { freq: 'weekly', until: '2026-11-01' })).toEqual([
      '2026-11-16',
    ]);
  });
});

describe('リンク', () => {
  it('http(s)とメール以外は受け付けない', () => {
    expect(normalizeUrl('docs.google.com/document/d/abc')).toBe(
      'https://docs.google.com/document/d/abc',
    );
    expect(normalizeUrl('mailto:teacher@example.com')).toBe('mailto:teacher@example.com');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('  ')).toBeNull();
  });

  it('リンク先に合わせて名前を付ける', () => {
    expect(linkLabel('https://docs.google.com/document/d/abc/edit')).toBe('Googleドキュメント');
    expect(linkLabel('https://docs.google.com/spreadsheets/d/abc')).toBe('Googleスプレッドシート');
    expect(linkLabel('https://mail.google.com/mail/u/0/#inbox/abc')).toBe('Gmail');
    expect(linkLabel('https://www.example.ac.jp/syllabus')).toBe('example.ac.jp');
  });

  it('共有された文章からリンクを取り出す', () => {
    expect(linksFromText('課題の案内\nhttps://docs.google.com/document/d/abc/edit')).toEqual([
      { label: '課題の案内', url: 'https://docs.google.com/document/d/abc/edit' },
    ]);
    expect(linksFromText('https://example.com/a')).toEqual([
      { label: 'example.com', url: 'https://example.com/a' },
    ]);
    expect(linksFromText('リンクなしの文章')).toEqual([]);
  });
});
