// データを書き換える操作はすべてここを通す。
// 端末に保存 → 必要ならGoogleカレンダーへ送る、の順。
import { addDays, addMinutes, addMonths, diffDays, diffMinutes, endKey, startKey } from './date';
import { LOCAL_CALENDAR, db, newId } from './db';
import {
  createRecurringOnGoogle,
  deleteGoogleSeries,
  removeRemote,
  schedulePush,
  updateGoogleSeries,
} from './google';
import type {
  Actual,
  Category,
  DiaryEntry,
  EventKind,
  FileKind,
  FileRec,
  PlannerEvent,
  Project,
  RepeatRule,
  SeriesMeta,
  SyncField,
} from './types';

export interface EventInput {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarId?: string;
  location?: string;
  memo?: string;
  kind?: EventKind;
  categoryId?: string;
  projectId?: string;
  monthVisible?: boolean;
  parentId?: string;
}

export type Scope = 'one' | 'all';

/** 繰り返しで作れる回数の上限（作りすぎ防止） */
const MAX_OCCURRENCES = 400;

async function isGoogleCalendar(calendarId: string): Promise<boolean> {
  if (calendarId === LOCAL_CALENDAR) return false;
  const cal = await db.calendars.get(calendarId);
  return !!cal && cal.source === 'google' && cal.writable;
}

function build(input: EventInput, calendarId: string): PlannerEvent {
  const now = Date.now();
  return {
    id: newId(),
    title: input.title.trim() || '（タイトルなし）',
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    calendarId,
    location: input.location ?? '',
    memo: input.memo ?? '',
    kind: input.kind ?? 'normal',
    categoryId: input.categoryId,
    projectId: input.projectId,
    monthVisible: input.monthVisible,
    parentId: input.parentId,
    links: [],
    belongings: [],
    submissions: [],
    relatedIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 繰り返しの各回の開始日（最初の回を含む） */
export function occurrenceDates(start: string, rule: RepeatRule): string[] {
  const first = start.slice(0, 10);
  if (rule.freq === 'none') return [first];
  const out: string[] = [];
  for (let i = 0; out.length < MAX_OCCURRENCES; i++) {
    const d =
      rule.freq === 'daily'
        ? addDays(first, i)
        : rule.freq === 'weekly'
          ? addDays(first, i * 7)
          : addMonths(first, i);
    if (d > rule.until) break;
    out.push(d);
  }
  return out.length ? out : [first];
}

/** 予定を作る。繰り返しなら各回をまとめて作り、最初の回を返す。 */
export async function createEvent(input: EventInput, repeat?: RepeatRule): Promise<PlannerEvent> {
  const wanted = input.calendarId ?? LOCAL_CALENDAR;
  const google = await isGoogleCalendar(wanted);
  const calendarId = google ? wanted : LOCAL_CALENDAR;
  const base = build(input, calendarId);

  if (!repeat || repeat.freq === 'none') {
    if (google) base.sync = 'create';
    await db.events.add(base);
    if (google) schedulePush();
    return base;
  }

  const meta: SeriesMeta = {
    id: '',
    categoryId: input.categoryId,
    projectId: input.projectId,
    monthVisible: input.monthVisible,
  };

  if (google) {
    // Googleの「繰り返し予定」として作り、できた各回を取り込む
    const made = await createRecurringOnGoogle(calendarId, base, repeat);
    await db.series.put({ ...meta, id: made.seriesId });
    const first = made.firstId ? await db.events.get(made.firstId) : undefined;
    if (!first) throw new Error('繰り返し予定を作れませんでした');
    return first;
  }

  const seriesId = newId();
  const shiftDays = (dt: string, n: number) =>
    dt.length === 10 ? addDays(dt, n) : addDays(dt, n) + dt.slice(10);
  const firstDay = base.start.slice(0, 10);
  const rows = occurrenceDates(base.start, repeat).map((day) => {
    const n = diffDays(firstDay, day);
    return {
      ...base,
      id: newId(),
      start: shiftDays(base.start, n),
      end: shiftDays(base.end, n),
      seriesId,
      // 種類などは繰り返し全体の設定として持つ
      categoryId: undefined,
      projectId: undefined,
      monthVisible: undefined,
    };
  });
  await db.transaction('rw', db.events, db.series, async () => {
    await db.series.put({ ...meta, id: seriesId });
    await db.events.bulkAdd(rows);
  });
  return rows[0];
}

const CORE_FIELDS: Array<[keyof PlannerEvent, SyncField]> = [
  ['title', 'title'],
  ['start', 'time'],
  ['end', 'time'],
  ['allDay', 'time'],
  ['location', 'location'],
  ['memo', 'memo'],
];

function changedSyncFields(e: PlannerEvent, patch: Partial<PlannerEvent>): SyncField[] {
  const out = new Set<SyncField>();
  for (const [key, field] of CORE_FIELDS) {
    if (key in patch && patch[key] !== e[key]) out.add(field);
  }
  return [...out];
}

/**
 * 予定を更新する。
 * scope='all' は繰り返し全体（題名・場所・メモと、時刻のずらし）に適用する。
 */
export async function updateEvent(
  id: string,
  patch: Partial<PlannerEvent>,
  scope: Scope = 'one',
): Promise<void> {
  const e = await db.events.get(id);
  if (!e) return;
  const fields = changedSyncFields(e, patch);
  const google = !!e.googleId || (await isGoogleCalendar(e.calendarId));

  // 終日⇔時間つきの切り替えは回ごとに意味が違うので、その回だけに適用する
  if (scope === 'all' && e.seriesId && fields.length > 0 && patch.allDay === undefined) {
    await updateSeries(e, patch, google);
    // 繰り返し全体に関係しない項目（リンクなど）はこの回だけに保存する
    const rest = { ...patch };
    for (const [key] of CORE_FIELDS) delete rest[key];
    if (Object.keys(rest).length) await db.events.update(id, { ...rest, updatedAt: Date.now() });
    return;
  }

  const next: Partial<PlannerEvent> = { ...patch, updatedAt: Date.now() };
  if (google && fields.length > 0 && e.calendarId !== LOCAL_CALENDAR) {
    next.sync = e.sync === 'create' || !e.googleId ? 'create' : 'update';
    next.syncFields = [...new Set([...(e.syncFields ?? []), ...fields])];
  }
  await db.events.update(id, next);
  if (next.sync) schedulePush();
}

async function updateSeries(
  e: PlannerEvent,
  patch: Partial<PlannerEvent>,
  google: boolean,
): Promise<void> {
  const newStart = patch.start ?? e.start;
  const newEnd = patch.end ?? e.end;
  const timed = !e.allDay && !(patch.allDay ?? false);
  const shiftMin = timed ? diffMinutes(e.start, newStart) : 0;
  const durationMin = timed ? diffMinutes(newStart, newEnd) : undefined;
  const timeChanged = timed && (newStart !== e.start || newEnd !== e.end);

  if (google && e.calendarId !== LOCAL_CALENDAR) {
    await updateGoogleSeries(e, {
      title: patch.title,
      location: patch.location,
      memo: patch.memo,
      ...(timeChanged ? { shiftMin, durationMin } : {}),
    });
    return;
  }

  const rows = await db.events.where('seriesId').equals(e.seriesId!).toArray();
  const now = Date.now();
  await db.events.bulkPut(
    rows.map((r) => {
      const next = { ...r, updatedAt: now };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.location !== undefined) next.location = patch.location;
      if (patch.memo !== undefined) next.memo = patch.memo;
      if (timeChanged && !r.allDay) {
        next.start = addMinutes(r.start, shiftMin);
        next.end = addMinutes(next.start, durationMin!);
      }
      return next;
    }),
  );
}

/** 種類・プロジェクト・月表示の設定。繰り返し予定はまとまり全体に効かせる。 */
export async function setEventMeta(
  e: PlannerEvent,
  patch: { categoryId?: string | null; projectId?: string | null; monthVisible?: boolean | null },
): Promise<void> {
  const clean: Record<string, string | boolean | undefined> = {};
  for (const [k, v] of Object.entries(patch)) clean[k] = v === null ? undefined : v;
  if (e.seriesId) {
    const cur = (await db.series.get(e.seriesId)) ?? { id: e.seriesId };
    await db.series.put({ ...cur, ...clean });
    // 画面を更新させるため、予定側の更新時刻も進める
    await db.events.update(e.id, { updatedAt: Date.now() });
  } else {
    await db.events.update(e.id, { ...clean, updatedAt: Date.now() });
  }
}

async function removeRows(rows: PlannerEvent[]): Promise<void> {
  const ids = new Set(rows.map((r) => r.id));
  await db.transaction('rw', db.events, db.files, async () => {
    // 逆算計画のステップは親と一緒に消す
    const children = await db.events
      .where('parentId')
      .anyOf([...ids])
      .toArray();
    for (const c of children) ids.add(c.id);
    // つながりを相手側からも外す
    const all = await db.events.toArray();
    for (const other of all) {
      if (ids.has(other.id)) continue;
      if (other.relatedIds.some((r) => ids.has(r))) {
        await db.events.update(other.id, {
          relatedIds: other.relatedIds.filter((r) => !ids.has(r)),
        });
      }
    }
    await db.files
      .where('eventId')
      .anyOf([...ids])
      .delete();
    await db.events.bulkDelete([...ids]);
  });
}

export async function deleteEvent(id: string, scope: Scope = 'one'): Promise<void> {
  const e = await db.events.get(id);
  if (!e) return;
  if (scope === 'all' && e.seriesId) {
    const rows = await db.events.where('seriesId').equals(e.seriesId).toArray();
    await removeRows(rows);
    await db.series.delete(e.seriesId);
    if (e.calendarId !== LOCAL_CALENDAR && rows.some((r) => r.googleId)) {
      await deleteGoogleSeries(e.calendarId, e.seriesId);
    }
    return;
  }
  await removeRows([e]);
  if (e.googleId && e.calendarId !== LOCAL_CALENDAR) await removeRemote(e.calendarId, e.googleId);
}

// ---- 予定同士のつながり ----

export async function linkEvents(a: string, b: string): Promise<void> {
  if (a === b) return;
  await db.transaction('rw', db.events, async () => {
    const [ea, eb] = await Promise.all([db.events.get(a), db.events.get(b)]);
    if (!ea || !eb) return;
    const now = Date.now();
    if (!ea.relatedIds.includes(b)) {
      await db.events.update(a, { relatedIds: [...ea.relatedIds, b], updatedAt: now });
    }
    if (!eb.relatedIds.includes(a)) {
      await db.events.update(b, { relatedIds: [...eb.relatedIds, a], updatedAt: now });
    }
  });
}

export async function unlinkEvents(a: string, b: string): Promise<void> {
  await db.transaction('rw', db.events, async () => {
    const [ea, eb] = await Promise.all([db.events.get(a), db.events.get(b)]);
    const now = Date.now();
    if (ea) {
      await db.events.update(a, {
        relatedIds: ea.relatedIds.filter((x) => x !== b),
        updatedAt: now,
      });
    }
    if (eb) {
      await db.events.update(b, {
        relatedIds: eb.relatedIds.filter((x) => x !== a),
        updatedAt: now,
      });
    }
  });
}

/** 逆算計画のステップ（いつまでに何をやるか）を足す。カレンダーにも出る。 */
export async function addStep(
  parent: { id: string; categoryId?: string; projectId?: string },
  title: string,
  date: string,
): Promise<PlannerEvent> {
  return createEvent({
    title,
    start: date,
    end: addDays(date, 1),
    allDay: true,
    calendarId: LOCAL_CALENDAR,
    parentId: parent.id,
    categoryId: parent.categoryId,
    projectId: parent.projectId,
  });
}

// ---- 実績（実際の時間の使い方） ----

export async function addActual(a: Omit<Actual, 'id'>): Promise<Actual> {
  const row = { ...a, id: newId() };
  await db.actuals.add(row);
  return row;
}

export async function updateActual(id: string, patch: Partial<Actual>): Promise<void> {
  await db.actuals.update(id, patch);
}

export async function deleteActual(id: string): Promise<void> {
  await db.actuals.delete(id);
}

/** 予定を実績にコピーする（同じ時刻・題名・種類）。あとで違う部分だけ直す。 */
export async function copyToActual(e: {
  id: string;
  title: string;
  start: string;
  end: string;
  categoryId?: string;
}): Promise<Actual> {
  return addActual({
    start: startKey(e),
    end: endKey(e),
    title: e.title,
    categoryId: e.categoryId,
    eventId: e.id,
    memo: '',
  });
}

// ---- 日記 ----

export async function saveDiary(date: string, patch: Partial<DiaryEntry>): Promise<void> {
  const cur = (await db.diary.get(date)) ?? { date, text: '', mood: '', updatedAt: 0 };
  const next = { ...cur, ...patch, date, updatedAt: Date.now() };
  if (!next.text.trim() && !next.mood) await db.diary.delete(date);
  else await db.diary.put(next);
}

// ---- 種類・プロジェクト・カレンダー ----

export async function saveCategory(c: Partial<Category> & { name: string }): Promise<Category> {
  const count = await db.categories.count();
  const row: Category = {
    id: c.id ?? newId(),
    name: c.name.trim() || '名前なし',
    color: c.color ?? 'blue',
    keywords: c.keywords ?? [],
    monthMode: c.monthMode ?? 'auto',
    order: c.order ?? count,
  };
  await db.categories.put(row);
  return row;
}

export async function deleteCategory(id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.events, db.series, db.actuals, async () => {
    await db.categories.delete(id);
    await db.events.filter((e) => e.categoryId === id).modify({ categoryId: undefined });
    await db.series.filter((s) => s.categoryId === id).modify({ categoryId: undefined });
    await db.actuals.filter((a) => a.categoryId === id).modify({ categoryId: undefined });
  });
}

export async function reorderCategories(ids: string[]): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    for (const [order, id] of ids.entries()) await db.categories.update(id, { order });
  });
}

export async function saveProject(p: Partial<Project> & { name: string }): Promise<Project> {
  const count = await db.projects.count();
  const row: Project = {
    id: p.id ?? newId(),
    name: p.name.trim() || '名前なし',
    color: p.color ?? 'violet',
    note: p.note ?? '',
    archived: p.archived ?? false,
    order: p.order ?? count,
  };
  await db.projects.put(row);
  return row;
}

export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', db.projects, db.events, db.series, async () => {
    await db.projects.delete(id);
    await db.events.filter((e) => e.projectId === id).modify({ projectId: undefined });
    await db.series.filter((s) => s.projectId === id).modify({ projectId: undefined });
  });
}

export async function setCalendarVisible(id: string, visible: boolean): Promise<void> {
  await db.calendars.update(id, { visible });
}

// ---- ファイル（資料・PDF・ノート） ----

export async function addFiles(eventId: string, kind: FileKind, files: File[]): Promise<void> {
  const now = Date.now();
  await db.files.bulkAdd(
    files.map((f, i) => ({
      id: newId(),
      eventId,
      kind,
      name: f.name || 'ファイル',
      mime: f.type || 'application/octet-stream',
      size: f.size,
      blob: f,
      createdAt: now + i,
    })),
  );
}

export async function removeFile(id: string): Promise<void> {
  await db.files.delete(id);
}

export async function attachFile(id: string, eventId: string, kind: FileKind): Promise<void> {
  await db.files.update(id, { eventId, kind });
}

/** ブラウザの中でそのまま表示しても安全な種類（HTMLやSVGは中のスクリプトが動くので含めない） */
const INLINE_SAFE = /^(application\/pdf|text\/plain|image\/(png|jpeg|gif|webp|bmp|heic|heif))$/;

/**
 * ファイルを開く。PDF・画像・テキストは新しいタブで表示し、それ以外は端末に保存する。
 * メールの添付などには何が入っているか分からないので、アプリと同じ場所で
 * プログラムとして動いてしまう種類（HTMLなど）は決して表示しない。
 */
export function openFile(f: FileRec): void {
  const pdfInline =
    (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false;
  const inline = INLINE_SAFE.test(f.mime) && (f.mime !== 'application/pdf' || pdfInline);
  const save = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
  };
  if (inline) {
    const url = URL.createObjectURL(f.blob);
    // ポップアップが止められたら保存にする
    if (!window.open(url, '_blank', 'noopener')) save(url);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } else {
    // 中身を実行できない種類として渡す
    const url = URL.createObjectURL(new Blob([f.blob], { type: 'application/octet-stream' }));
    save(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
