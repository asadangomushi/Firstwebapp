// 端末間の同期で、2つの状態（この端末とGoogleドライブ）を1つにまとめる計算。
// 画面やデータベースには触らない純粋な計算だけを置き、テストで確かめられるようにしている。
//
// まとめ方の決まり
// - 同じものが両方にあれば、updatedAt（最後に変更した時刻）が新しいほうを残す。同じなら手元を残す
// - 消したものは「消した記録」を残す。記録の時刻が、そのものの最後の変更より新しければ消す
//   （消したあとに別の端末で直していたら、直したほうを残す）
// - Googleカレンダーの同じ予定を2台がそれぞれ取り込んで二重になったら、1つにまとめる
// - 同じ名前の予定の種類が二重になったら、1つにまとめる
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
  SyncTable,
} from './types';

/** ファイルの中身（blob）を除いた情報。中身はドライブに別のファイルとして置く。 */
export type FileMeta = Omit<FileRec, 'blob'>;

export interface SyncData {
  events: PlannerEvent[];
  categories: Category[];
  projects: Project[];
  series: SeriesMeta[];
  actuals: Actual[];
  diary: DiaryEntry[];
  files: FileMeta[];
  /** カレンダーの一覧は、知らないものを足すだけ（表示のオン・オフは端末ごと） */
  calendars: CalendarInfo[];
  deleted: Deletion[];
}

/** ドライブに置くファイルの中身 */
export interface Snapshot extends SyncData {
  app: 'techo';
  format: 1;
  savedAt: number;
}

export const TABLES: Exclude<SyncTable, 'files'>[] = [
  'events',
  'categories',
  'projects',
  'series',
  'actuals',
  'diary',
];

/** 消した記録をいつまで残すか。これより長く同期していない端末があると、消したものが戻ることがある。 */
export const KEEP_DELETIONS_MS = 180 * 24 * 60 * 60 * 1000;

type AnyRec = { updatedAt?: number } & Record<string, unknown>;

export function keyOf(table: SyncTable, rec: object): string {
  const r = rec as { id?: string; date?: string };
  return table === 'diary' ? String(r.date) : String(r.id);
}

export function deletionKey(table: SyncTable, id: string): string {
  return `${table}:${id}`;
}

const time = (r: { updatedAt?: number } | undefined) => r?.updatedAt ?? 0;

/** 端末をまたいで送るときは、Googleへの送信待ちの印を外す（送るのは、その変更をした端末の役目） */
export function forUpload(e: PlannerEvent): PlannerEvent {
  const { sync: _sync, syncFields: _fields, ...rest } = e;
  return rest;
}

function mergeDeletions(a: Deletion[], b: Deletion[], now: number): Map<string, Deletion> {
  const out = new Map<string, Deletion>();
  for (const d of [...a, ...b]) {
    if (now - d.at > KEEP_DELETIONS_MS) continue;
    const cur = out.get(d.key);
    if (!cur || d.at > cur.at) out.set(d.key, d);
    // 同じ時刻なら、ドライブから消し終えた（driveIdのない）ほうを残す
    else if (d.at === cur.at && cur.driveId && !d.driveId) out.set(d.key, d);
  }
  return out;
}

function mergeTable<T extends object>(
  table: SyncTable,
  local: T[],
  remote: T[],
  deleted: Map<string, Deletion>,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of local) out.set(keyOf(table, r), r);
  for (const r of remote) {
    const k = keyOf(table, r);
    const cur = out.get(k);
    if (!cur || time(r as AnyRec) > time(cur as AnyRec)) out.set(k, r);
  }
  for (const [k, r] of out) {
    const d = deleted.get(deletionKey(table, k));
    if (d && d.at >= time(r as AnyRec)) out.delete(k);
  }
  return out;
}

/** 「まとめて消した」記録から、消したID → 残したID の対応を作る（何段もまとめた場合もたどる） */
function mergedInto(deleted: Map<string, Deletion>, table: SyncTable): Map<string, string> {
  const direct = new Map<string, string>();
  for (const d of deleted.values()) if (d.table === table && d.into) direct.set(d.id, d.into);
  const out = new Map<string, string>();
  for (const id of direct.keys()) {
    let to = direct.get(id)!;
    const seen = new Set([id]);
    while (direct.has(to) && !seen.has(to)) {
      seen.add(to);
      to = direct.get(to)!;
    }
    out.set(id, to);
  }
  return out;
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

function unionById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const ids = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !ids.has(x.id))];
}

/** 二重になった予定の、書き足した情報を1つに合わせる */
function combineEvents(keep: PlannerEvent, drop: PlannerEvent, at: number): PlannerEvent {
  return {
    ...keep,
    kind: keep.kind !== 'normal' ? keep.kind : drop.kind,
    categoryId: keep.categoryId ?? drop.categoryId,
    projectId: keep.projectId ?? drop.projectId,
    monthVisible: keep.monthVisible ?? drop.monthVisible,
    parentId: keep.parentId ?? drop.parentId,
    done: keep.done || drop.done || undefined,
    exam: keep.exam ?? drop.exam,
    links: unionById(keep.links, drop.links),
    belongings: unionById(keep.belongings, drop.belongings),
    submissions: unionById(keep.submissions, drop.submissions),
    relatedIds: unique([...keep.relatedIds, ...drop.relatedIds]),
    // まとめた結果をほかの端末にも行き渡らせるため、元のどちらよりも新しくする
    updatedAt: at,
  };
}

/** どの端末で計算しても同じ側を残すよう、作られた時刻とIDで決める */
function earlier(a: PlannerEvent, b: PlannerEvent): boolean {
  return a.createdAt !== b.createdAt ? a.createdAt < b.createdAt : a.id < b.id;
}

/** Googleカレンダーの同じ予定が二重になっていたら、1つにまとめる */
function dedupeGoogleEvents(
  events: Map<string, PlannerEvent>,
  deleted: Map<string, Deletion>,
  now: number,
) {
  const byGoogle = new Map<string, PlannerEvent>();
  // 並び順で結果が変わらないよう、IDの順に見ていく
  for (const e of [...events.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!e.googleId) continue;
    const k = `${e.calendarId}\u0000${e.googleId}`;
    const other = byGoogle.get(k);
    if (!other) {
      byGoogle.set(k, e);
      continue;
    }
    const [keep, drop] = earlier(other, e) ? [other, e] : [e, other];
    // まとめた時刻は「いま」以降にする（古い記録として、すぐ捨てられないように）
    const at = Math.max(now, time(keep) + 1, time(drop) + 1);
    const merged = combineEvents(keep, drop, at);
    events.set(keep.id, merged);
    events.delete(drop.id);
    byGoogle.set(k, merged);
    deleted.set(deletionKey('events', drop.id), {
      key: deletionKey('events', drop.id),
      table: 'events',
      id: drop.id,
      at,
      into: keep.id,
    });
  }
}

/** 同じ名前の予定の種類が二重になっていたら、1つにまとめる（各端末で最初に作られる種類など） */
function dedupeCategories(
  cats: Map<string, Category>,
  deleted: Map<string, Deletion>,
  now: number,
) {
  const byName = new Map<string, Category>();
  for (const c of [...cats.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const k = c.name.trim();
    const other = byName.get(k);
    if (!other) {
      byName.set(k, c);
      continue;
    }
    // 手を加えたほう（変更が新しいほう）を残す。同じならIDの小さいほう
    const keepOther = time(other) !== time(c) ? time(other) > time(c) : other.id < c.id;
    const [keep, drop] = keepOther ? [other, c] : [c, other];
    cats.delete(drop.id);
    byName.set(k, keep);
    const at = Math.max(now, time(drop) + 1);
    deleted.set(deletionKey('categories', drop.id), {
      key: deletionKey('categories', drop.id),
      table: 'categories',
      id: drop.id,
      at,
      into: keep.id,
    });
  }
}

/** まとめて消したもの（予定・種類）を指しているところを、残したほうへ付け替える */
function remap(
  merged: {
    events: Map<string, PlannerEvent>;
    series: Map<string, SeriesMeta>;
    actuals: Map<string, Actual>;
    files: Map<string, FileMeta>;
  },
  deleted: Map<string, Deletion>,
) {
  const ev = mergedInto(deleted, 'events');
  const cat = mergedInto(deleted, 'categories');
  if (ev.size === 0 && cat.size === 0) return;
  const e2 = (id: string | undefined) => (id && ev.get(id)) || id;
  const c2 = (id: string | undefined) => (id && cat.get(id)) || id;

  // 付け替えはどの端末でも同じように行うので、変更時刻は動かさない
  for (const [k, e] of merged.events) {
    const relatedIds = unique(e.relatedIds.map((id) => e2(id)!)).filter((id) => id !== e.id);
    const parentId = e2(e.parentId);
    const categoryId = c2(e.categoryId);
    if (
      parentId !== e.parentId ||
      categoryId !== e.categoryId ||
      relatedIds.length !== e.relatedIds.length ||
      relatedIds.some((id, i) => id !== e.relatedIds[i])
    ) {
      merged.events.set(k, { ...e, relatedIds, parentId, categoryId });
    }
  }
  for (const [k, s] of merged.series) {
    const categoryId = c2(s.categoryId);
    if (categoryId !== s.categoryId) merged.series.set(k, { ...s, categoryId });
  }
  for (const [k, a] of merged.actuals) {
    const eventId = e2(a.eventId);
    const categoryId = c2(a.categoryId);
    if (eventId !== a.eventId || categoryId !== a.categoryId) {
      merged.actuals.set(k, { ...a, eventId, categoryId });
    }
  }
  for (const [k, f] of merged.files) {
    const eventId = f.eventId ? e2(f.eventId)! : f.eventId;
    if (eventId !== f.eventId) merged.files.set(k, { ...f, eventId });
  }
}

/** この端末の状態とドライブの状態を、1つにまとめる */
export function mergeSync(local: SyncData, remote: SyncData | null, now: number): SyncData {
  const r: SyncData = remote ?? {
    events: [],
    categories: [],
    projects: [],
    series: [],
    actuals: [],
    diary: [],
    files: [],
    calendars: [],
    deleted: [],
  };
  const deleted = mergeDeletions(local.deleted, r.deleted, now);
  const events = mergeTable('events', local.events, r.events, deleted);
  const categories = mergeTable('categories', local.categories, r.categories, deleted);
  const projects = mergeTable('projects', local.projects, r.projects, deleted);
  const series = mergeTable('series', local.series, r.series, deleted);
  const actuals = mergeTable('actuals', local.actuals, r.actuals, deleted);
  const diary = mergeTable('diary', local.diary, r.diary, deleted);
  const files = mergeTable('files', local.files, r.files, deleted);

  dedupeGoogleEvents(events, deleted, now);
  dedupeCategories(categories, deleted, now);
  remap({ events, series, actuals, files }, deleted);

  const calendars = new Map(r.calendars.map((c) => [c.id, c]));
  for (const c of local.calendars) calendars.set(c.id, c);

  return {
    events: [...events.values()],
    categories: [...categories.values()],
    projects: [...projects.values()],
    series: [...series.values()],
    actuals: [...actuals.values()],
    diary: [...diary.values()],
    files: [...files.values()],
    calendars: [...calendars.values()],
    deleted: [...deleted.values()],
  };
}

/** 項目の並び順に左右されない文字列にする */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** 2つの記録が同じ中身か（変わったものだけをデータベースに書き戻すため） */
export function sameRecord(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
