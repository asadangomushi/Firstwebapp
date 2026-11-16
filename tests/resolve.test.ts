import { describe, expect, it } from 'vitest';
import { isSpecial, matchCategory, resolveEvent, type Lookup } from '../src/lib/resolve';
import type { Category, PlannerEvent } from '../src/lib/types';

const cat = (
  id: string,
  name: string,
  keywords: string[],
  monthMode: Category['monthMode'] = 'auto',
): Category => ({
  id,
  name,
  color: 'blue',
  keywords,
  monthMode,
  order: 0,
});

const study = cat('study', '勉強', ['数学', '英語']);
const work = cat('work', 'バイト', ['バイト'], 'hide');
const fun = cat('fun', '遊び', ['遊ぶ'], 'show');
const categories = [study, work, fun];

const ev = (patch: Partial<PlannerEvent>): PlannerEvent => ({
  id: 'e',
  title: '',
  start: '2026-11-16T09:00',
  end: '2026-11-16T10:00',
  allDay: false,
  calendarId: 'local',
  location: '',
  memo: '',
  kind: 'normal',
  links: [],
  belongings: [],
  submissions: [],
  relatedIds: [],
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

const lk: Lookup = {
  categories,
  catById: new Map(categories.map((c) => [c.id, c])),
  projById: new Map(),
  calById: new Map(),
  series: new Map([['s1', { id: 's1', categoryId: 'fun' }]]),
};

describe('種類の自動判定', () => {
  it('タイトルに含まれるキーワードで決まる（例：数学 → 勉強）', () => {
    expect(matchCategory('数学', categories)?.name).toBe('勉強');
    expect(matchCategory('英語の予習', categories)?.name).toBe('勉強');
    expect(matchCategory('カフェでバイト', categories)?.name).toBe('バイト');
    expect(matchCategory('歯医者', categories)).toBeUndefined();
  });

  it('個別に選んだ種類が、自動判定より優先される', () => {
    expect(resolveEvent(ev({ title: '数学', categoryId: 'fun' }), lk).cat?.name).toBe('遊び');
  });

  it('繰り返しの予定は、まとまり全体の設定を使う', () => {
    const r = resolveEvent(ev({ title: '数学', seriesId: 's1', categoryId: 'work' }), lk);
    expect(r.cat?.name).toBe('遊び');
  });

  it('種類のない予定は淡い色（plain）になる', () => {
    expect(resolveEvent(ev({ title: '歯医者' }), lk).plain).toBe(true);
    expect(resolveEvent(ev({ title: '数学' }), lk).plain).toBe(false);
  });
});

describe('月表示に出す「特別な予定」', () => {
  it('毎週の繰り返しは隠し、単発の予定は出す', () => {
    expect(isSpecial(ev({ seriesId: 's' }), undefined, undefined)).toBe(false);
    expect(isSpecial(ev({}), undefined, undefined)).toBe(true);
  });

  it('種類の設定で、いつも出す／いつも隠すを決められる', () => {
    expect(isSpecial(ev({}), work, undefined)).toBe(false);
    expect(isSpecial(ev({ seriesId: 's' }), fun, undefined)).toBe(true);
  });

  it('テストと締切は必ず出す', () => {
    expect(isSpecial(ev({ kind: 'exam', seriesId: 's' }), work, undefined)).toBe(true);
    expect(isSpecial(ev({ kind: 'task' }), work, undefined)).toBe(true);
  });

  it('予定ごとに選んだ設定がいちばん強い', () => {
    expect(isSpecial(ev({ seriesId: 's' }), work, true)).toBe(true);
    expect(isSpecial(ev({ kind: 'exam' }), fun, false)).toBe(false);
  });
});
