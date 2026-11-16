// 画面全体で使うデータをまとめて読み込む。データベースが変わると自動で再描画される。
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { db } from './db';
import { resolveEvent, type Lookup, type Resolved } from './resolve';
import type { Actual, CalendarInfo, DiaryEntry, FileRec, Project } from './types';

export interface Data extends Lookup {
  ready: boolean;
  /** すべての予定 */
  all: Resolved[];
  /** 表示オンのカレンダーの予定 */
  events: Resolved[];
  byId: Map<string, Resolved>;
  /** 親の予定ID → 逆算計画のステップ（日付順） */
  steps: Map<string, Resolved[]>;
  projects: Project[];
  calendars: CalendarInfo[];
  actuals: Actual[];
  diary: Map<string, DiaryEntry>;
  files: FileRec[];
}

const Ctx = createContext<Data | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const rawEvents = useLiveQuery(() => db.events.toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy('order').toArray(), []);
  const projects = useLiveQuery(() => db.projects.orderBy('order').toArray(), []);
  const calendars = useLiveQuery(() => db.calendars.toArray(), []);
  const series = useLiveQuery(() => db.series.toArray(), []);
  const actuals = useLiveQuery(() => db.actuals.orderBy('start').toArray(), []);
  const diary = useLiveQuery(() => db.diary.toArray(), []);
  const files = useLiveQuery(() => db.files.toArray(), []);

  const value = useMemo<Data>(() => {
    const cats = categories ?? [];
    const projs = projects ?? [];
    const cals = (calendars ?? []).slice().sort((a, b) => {
      // この端末のカレンダーを先頭に、次にメインのGoogleカレンダー
      const rank = (c: CalendarInfo) => (c.source === 'local' ? 0 : c.primary ? 1 : 2);
      return rank(a) - rank(b) || a.name.localeCompare(b.name, 'ja');
    });
    const lk: Lookup = {
      categories: cats,
      catById: new Map(cats.map((c) => [c.id, c])),
      projById: new Map(projs.map((p) => [p.id, p])),
      calById: new Map(cals.map((c) => [c.id, c])),
      series: new Map((series ?? []).map((s) => [s.id, s])),
    };
    const all = (rawEvents ?? []).map((e) => resolveEvent(e, lk));
    const byId = new Map(all.map((e) => [e.id, e]));
    const steps = new Map<string, Resolved[]>();
    for (const e of all) {
      if (!e.parentId) continue;
      const list = steps.get(e.parentId) ?? [];
      list.push(e);
      steps.set(e.parentId, list);
    }
    for (const list of steps.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return {
      ...lk,
      ready:
        rawEvents !== undefined &&
        categories !== undefined &&
        calendars !== undefined &&
        series !== undefined,
      all,
      events: all.filter((e) => e.shown),
      byId,
      steps,
      projects: projs,
      calendars: cals,
      actuals: actuals ?? [],
      diary: new Map((diary ?? []).map((d) => [d.date, d])),
      files: files ?? [],
    };
  }, [rawEvents, categories, projects, calendars, series, actuals, diary, files]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const v = useContext(Ctx);
  if (!v) throw new Error('DataProvider の外で useData が呼ばれました');
  return v;
}
