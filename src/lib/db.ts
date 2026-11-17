// 端末の中（IndexedDB）にすべてのデータを保存する。
// サーバーは持たないので、データはこのブラウザの外には出ない。
import Dexie, { type Table } from 'dexie';
import type {
  Actual,
  CalendarInfo,
  Category,
  Deletion,
  DiaryEntry,
  FileRec,
  PlannerEvent,
  Project,
  SeriesMeta,
  Tombstone,
} from './types';

export const LOCAL_CALENDAR = 'local';

class TechoDB extends Dexie {
  events!: Table<PlannerEvent, string>;
  categories!: Table<Category, string>;
  projects!: Table<Project, string>;
  calendars!: Table<CalendarInfo, string>;
  series!: Table<SeriesMeta, string>;
  actuals!: Table<Actual, string>;
  diary!: Table<DiaryEntry, string>;
  files!: Table<FileRec, string>;
  tombstones!: Table<Tombstone, string>;
  deleted!: Table<Deletion, string>;

  constructor() {
    super('techo');
    this.version(1).stores({
      events: 'id, start, calendarId, googleId, seriesId, projectId, parentId, sync',
      categories: 'id, order',
      projects: 'id, order',
      calendars: 'id',
      series: 'id',
      actuals: 'id, start, eventId',
      diary: 'date',
      files: 'id, eventId',
      tombstones: 'googleId',
    });
    // 端末間の同期のため、消したものの記録を足した
    this.version(2).stores({ deleted: 'key, at' });
  }
}

export const db = new TechoDB();

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** はじめて開いたときに、最低限の種類とカレンダーを用意する */
export async function seedIfEmpty(): Promise<void> {
  await db.transaction('rw', db.calendars, db.categories, async () => {
    if (!(await db.calendars.get(LOCAL_CALENDAR))) {
      await db.calendars.put({
        id: LOCAL_CALENDAR,
        name: '手帳（この端末）',
        color: 'gray',
        visible: true,
        source: 'local',
        writable: true,
      });
    }
    if ((await db.categories.count()) === 0) {
      const seed: Array<[string, string, string[], Category['monthMode']]> = [
        ['勉強', 'blue', ['授業', '講義', '数学', '英語', '勉強', 'ゼミ'], 'auto'],
        ['バイト', 'orange', ['バイト', 'シフト'], 'hide'],
        ['運動', 'aqua', ['運動', 'ジム', 'ランニング', '部活'], 'auto'],
        ['遊び', 'yellow', ['遊ぶ', '遊び', '飲み会', '旅行'], 'show'],
        ['生活', 'magenta', ['食事', '移動', '家事', '風呂'], 'hide'],
        ['趣味', 'green', [], 'auto'],
        ['睡眠', 'violet', ['睡眠', '就寝'], 'hide'],
      ];
      await db.categories.bulkPut(
        seed.map(([name, color, keywords, monthMode], order) => ({
          // どの端末でも同じIDにしておくと、同期したときに二重にならない
          id: `seed-${order}`,
          name,
          color,
          keywords,
          monthMode,
          order,
          // 最初からある種類は「まだ誰も変えていない」扱いにする
          // （ほかの端末で手を加えた種類のほうが、同期で優先されるように）
          updatedAt: 0,
        })),
      );
    }
  });
}
