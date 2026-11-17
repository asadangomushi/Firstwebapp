import { describe, expect, it } from 'vitest';
import { parseSnapshot } from '../src/lib/drive';
import {
  KEEP_DELETIONS_MS,
  forUpload,
  mergeSync,
  sameRecord,
  type SyncData,
} from '../src/lib/syncmerge';
import type { Actual, Category, Deletion, PlannerEvent } from '../src/lib/types';

const NOW = 1_800_000_000_000;

const empty = (): SyncData => ({
  events: [],
  categories: [],
  projects: [],
  series: [],
  actuals: [],
  diary: [],
  files: [],
  calendars: [],
  deleted: [],
});

const ev = (id: string, patch: Partial<PlannerEvent> = {}): PlannerEvent => ({
  id,
  title: id,
  start: '2026-11-20T09:00',
  end: '2026-11-20T10:00',
  allDay: false,
  calendarId: 'local',
  location: '',
  memo: '',
  kind: 'normal',
  links: [],
  belongings: [],
  submissions: [],
  relatedIds: [],
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const cat = (id: string, name: string, patch: Partial<Category> = {}): Category => ({
  id,
  name,
  color: 'blue',
  keywords: [],
  monthMode: 'auto',
  order: 0,
  ...patch,
});

const del = (table: Deletion['table'], id: string, at: number, into?: string): Deletion => ({
  key: `${table}:${id}`,
  table,
  id,
  at,
  ...(into ? { into } : {}),
});

const ids = (list: { id: string }[]) => list.map((x) => x.id).sort();

describe('同じものが両方にあるとき', () => {
  it('あとから変更したほうを残す', () => {
    const local = { ...empty(), events: [ev('a', { title: '古い', updatedAt: 10 })] };
    const remote = { ...empty(), events: [ev('a', { title: '新しい', updatedAt: 20 })] };
    expect(mergeSync(local, remote, NOW).events[0].title).toBe('新しい');
    expect(mergeSync(remote, local, NOW).events[0].title).toBe('新しい');
  });

  it('同じ時刻なら、この端末のほうを残す', () => {
    const local = { ...empty(), events: [ev('a', { title: '手元', updatedAt: 10 })] };
    const remote = { ...empty(), events: [ev('a', { title: 'ドライブ', updatedAt: 10 })] };
    expect(mergeSync(local, remote, NOW).events[0].title).toBe('手元');
  });

  it('片方にしかないものは、そのまま足す', () => {
    const local = {
      ...empty(),
      events: [ev('a')],
      diary: [{ date: '2026-11-17', text: 'A', mood: '', updatedAt: 5 }],
    };
    const remote = {
      ...empty(),
      events: [ev('b')],
      diary: [{ date: '2026-11-18', text: 'B', mood: '', updatedAt: 5 }],
    };
    const m = mergeSync(local, remote, NOW);
    expect(ids(m.events)).toEqual(['a', 'b']);
    expect(m.diary.map((d) => d.date).sort()).toEqual(['2026-11-17', '2026-11-18']);
  });

  it('同期の結果をもう一度まとめても、何も変わらない', () => {
    const local = { ...empty(), events: [ev('a', { updatedAt: 3 })] };
    const remote = { ...empty(), events: [ev('b')], deleted: [del('events', 'x', NOW - 1)] };
    const once = mergeSync(local, remote, NOW);
    const twice = mergeSync(once, once, NOW);
    expect(sameRecord(once, twice)).toBe(true);
  });
});

describe('消したもの', () => {
  it('消した記録が最後の変更より新しければ、ほかの端末からも消える', () => {
    const local = { ...empty(), events: [ev('a', { updatedAt: NOW - 20 })] };
    const remote = { ...empty(), deleted: [del('events', 'a', NOW - 10)] };
    const m = mergeSync(local, remote, NOW);
    expect(m.events).toEqual([]);
    expect(m.deleted.map((d) => d.key)).toEqual(['events:a']);
  });

  it('消したあとに別の端末で直していたら、直したほうを残す', () => {
    const local = { ...empty(), events: [ev('a', { updatedAt: NOW - 10 })] };
    const remote = { ...empty(), deleted: [del('events', 'a', NOW - 20)] };
    expect(ids(mergeSync(local, remote, NOW).events)).toEqual(['a']);
  });

  it('日記も日付ごとに消せる', () => {
    const local = {
      ...empty(),
      diary: [{ date: '2026-11-17', text: 'x', mood: '', updatedAt: 1 }],
    };
    const remote = { ...empty(), deleted: [del('diary', '2026-11-17', NOW - 5)] };
    expect(mergeSync(local, remote, NOW).diary).toEqual([]);
  });

  it('とても古い消した記録は片付ける', () => {
    const old = del('events', 'z', NOW - KEEP_DELETIONS_MS - 1);
    expect(mergeSync({ ...empty(), deleted: [old] }, null, NOW).deleted).toEqual([]);
  });
});

describe('Googleカレンダーの同じ予定が二重になったとき', () => {
  const g = (id: string, createdAt: number, patch: Partial<PlannerEvent> = {}) =>
    ev(id, { calendarId: 'me@example.com', googleId: 'G1', createdAt, updatedAt: 0, ...patch });

  it('先に作られたほうに、書き足した情報をまとめる', () => {
    const local = {
      ...empty(),
      events: [
        g('b1', 200, { belongings: [{ id: 'k', text: '学生証', done: false }], updatedAt: 50 }),
      ],
    };
    const remote = {
      ...empty(),
      events: [
        g('a1', 100, {
          links: [{ id: 'l', label: 'メモ', url: 'https://example.com' }],
          kind: 'exam',
        }),
      ],
    };
    const m = mergeSync(local, remote, NOW);
    expect(ids(m.events)).toEqual(['a1']);
    const kept = m.events[0];
    expect(kept.links).toHaveLength(1);
    expect(kept.belongings).toHaveLength(1);
    expect(kept.kind).toBe('exam');
    expect(kept.updatedAt).toBeGreaterThanOrEqual(NOW);
    expect(m.deleted).toContainEqual(expect.objectContaining({ key: 'events:b1', into: 'a1' }));
  });

  it('どちらの端末でまとめても、同じほうが残る', () => {
    const a = { ...empty(), events: [g('a1', 100)] };
    const b = { ...empty(), events: [g('b1', 200)] };
    expect(ids(mergeSync(a, b, NOW).events)).toEqual(['a1']);
    expect(ids(mergeSync(b, a, NOW).events)).toEqual(['a1']);
  });

  it('消したほうを指していたもの（実績・つながり・ファイル）は、残したほうへ付け替える', () => {
    const actual: Actual = {
      id: 'x',
      start: '2026-11-20T09:00',
      end: '2026-11-20T10:00',
      title: '',
      memo: '',
      eventId: 'b1',
    };
    const local = {
      ...empty(),
      events: [g('b1', 200), ev('other', { relatedIds: ['b1'] })],
      actuals: [actual],
      files: [
        {
          id: 'f',
          eventId: 'b1',
          kind: 'note' as const,
          name: 'n.pdf',
          mime: 'application/pdf',
          size: 1,
          createdAt: 1,
        },
      ],
    };
    const remote = { ...empty(), events: [g('a1', 100)] };
    const m = mergeSync(local, remote, NOW);
    expect(m.events.find((e) => e.id === 'other')!.relatedIds).toEqual(['a1']);
    expect(m.actuals[0].eventId).toBe('a1');
    expect(m.files[0].eventId).toBe('a1');
  });

  it('まとめた記録だけを受け取った端末でも、付け替えて消す', () => {
    // この端末には b1 と、b1 を指す実績がある。ドライブには「b1 は a1 にまとめた」記録がある
    const actual: Actual = {
      id: 'x',
      start: '2026-11-20T09:00',
      end: '2026-11-20T10:00',
      title: '',
      memo: '',
      eventId: 'b1',
    };
    const local = { ...empty(), events: [g('b1', 200)], actuals: [actual] };
    const remote = {
      ...empty(),
      events: [g('a1', 100, { updatedAt: NOW })],
      deleted: [del('events', 'b1', NOW, 'a1')],
    };
    const m = mergeSync(local, remote, NOW + 1000);
    expect(ids(m.events)).toEqual(['a1']);
    expect(m.actuals[0].eventId).toBe('a1');
  });

  it('別のカレンダーの、たまたま同じIDの予定はまとめない', () => {
    const local = {
      ...empty(),
      events: [g('a1', 100), g('c1', 100, { calendarId: 'other@example.com' })],
    };
    expect(ids(mergeSync(local, null, NOW).events)).toEqual(['a1', 'c1']);
  });
});

describe('予定の種類が二重になったとき', () => {
  it('同じ名前の種類は、手を加えたほうにまとめ、予定の種類も付け替える', () => {
    const local = {
      ...empty(),
      categories: [cat('seed-0', '勉強', { updatedAt: 0 })],
      events: [ev('e', { categoryId: 'seed-0' })],
    };
    const remote = {
      ...empty(),
      categories: [cat('old-id', '勉強', { keywords: ['数学'], updatedAt: 99 })],
    };
    const m = mergeSync(local, remote, NOW);
    expect(ids(m.categories)).toEqual(['old-id']);
    expect(m.categories[0].keywords).toEqual(['数学']);
    expect(m.events[0].categoryId).toBe('old-id');
  });
});

describe('そのほか', () => {
  it('カレンダーは、知らないものだけ足す（表示のオン・オフは手元を残す）', () => {
    const local = {
      ...empty(),
      calendars: [
        {
          id: 'c',
          name: 'C',
          color: 'blue',
          visible: false,
          source: 'google' as const,
          writable: true,
        },
      ],
    };
    const remote = {
      ...empty(),
      calendars: [
        {
          id: 'c',
          name: 'C',
          color: 'blue',
          visible: true,
          source: 'google' as const,
          writable: true,
        },
        {
          id: 'd',
          name: 'D',
          color: 'red',
          visible: true,
          source: 'google' as const,
          writable: true,
        },
      ],
    };
    const m = mergeSync(local, remote, NOW);
    expect(m.calendars.find((c) => c.id === 'c')!.visible).toBe(false);
    expect(ids(m.calendars)).toEqual(['c', 'd']);
  });

  it('ドライブに送るときは、Googleへの送信待ちの印を外す', () => {
    const e = forUpload(ev('a', { sync: 'update', syncFields: ['title'] }));
    expect('sync' in e).toBe(false);
    expect('syncFields' in e).toBe(false);
  });

  it('項目の並び順が違っても、同じ中身なら同じとみなす', () => {
    expect(sameRecord({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1, c: undefined })).toBe(true);
    expect(sameRecord({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('ドライブのファイルは、手帳の形か確かめてから読む', () => {
    expect(() => parseSnapshot({ app: 'other' })).toThrow();
    expect(() => parseSnapshot({ app: 'techo', format: 2 })).toThrow(/新しい版/);
    const d = parseSnapshot({
      app: 'techo',
      format: 1,
      events: [{ id: 'a', title: 'x' }, { nope: 1 }],
    });
    expect(d.events).toHaveLength(1);
    expect(d.events[0].links).toEqual([]);
    expect(d.categories).toEqual([]);
  });
});
