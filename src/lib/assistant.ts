// アプリの中でAI（Claude または Gemini）に話しかけて、予定を追加・操作する機能の共通部分。
// ここには「AIが使える道具（ツール）」と「画面に出す会話」を置く。
// どのAIを呼ぶかは設定で選び、呼び出しそのものは claude.ts / gemini.ts が受け持つ。
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import {
  WEEKDAYS,
  addDays,
  addMinutes,
  dayOfWeek,
  diffDays,
  diffMinutes,
  endKey,
  fmtDayShort,
  fmtTime,
  overlapsDays,
  startKey,
  toLocal,
} from './date';
import { db, newId } from './db';
import { linkLabel, normalizeUrl } from './links';
import { resolveEvent, type Lookup, type Resolved } from './resolve';
import { ASSISTANTS, getSettings, type AssistantId } from './settings';
import {
  addActual,
  addStep,
  createEvent,
  deleteEvent,
  linkEvents,
  saveDiary,
  saveProject,
  setEventMeta,
  updateEvent,
} from './store';
import type { PlannerEvent } from './types';

export const SYSTEM = `あなたは「手帳」という個人用の予定管理アプリの中にいるアシスタントです。ユーザーの予定・実績（実際の時間の使い方）・日記を、用意されたツールで読み書きします。

前提
- 日時はすべてユーザーの端末のローカル時刻です。ツールには "YYYY-MM-DD"（終日）か "YYYY-MM-DDTHH:mm"（時間つき）で渡します。
- 「明日」「来週の金曜」などは、ユーザーのメッセージに添えられた「現在の日時」を基準に解釈します。
- ユーザーがいま開いている画面の情報が添えられることがあります。「この予定」「この日」はそれを指します。

進め方
- 既にある予定を変更・削除するときは、先に list_events で対象を特定します。当てはまる候補が複数あってどれか決められないときは、実行せずにユーザーへ確認します。
- 逆算の計画を頼まれたら、締切までの日数と作業量を考えて無理のないステップに分け、add_plan_steps で追加します。締切の当日や過去の日付にはステップを置きません。
- 予定の種類（勉強・バイトなど）は、下の一覧にある名前だけを使います。合うものがなければ指定しません（タイトルから自動で分類されます）。

答え方
- ユーザーが読むのは小さなチャット欄です。終わったら、何をしたかを短い日本語の文章で伝えます。日付には曜日を添えます。
- 見出しや箇条書きの記号、太字などの装飾は使わず、ふつうの文章で書きます。`;

// ---- 画面に出す会話 ----

export interface ChatAction {
  id: string;
  text: string;
  /** 押すと開く予定 */
  eventId?: string;
}

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions: ChatAction[];
  error?: boolean;
}

export interface ChatContext {
  /** いま開いている画面の説明（「予定『数学』のページ」など） */
  viewing: string;
  confirmDelete: (title: string) => Promise<boolean>;
}

interface ChatState {
  items: ChatItem[];
  busy: boolean;
}

let state: ChatState = { items: [], busy: false };
let abort: AbortController | null = null;
/** いまの会話を受け持っているAI。途中で切り替えたら会話を新しく始める。 */
let current: AssistantId | null = null;
const listeners = new Set<() => void>();
/** 会話を始め直すときに、各AIが覚えている履歴を消すための呼び出し先 */
export const resetHooks = new Set<() => void>();

function set(next: Partial<ChatState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function patchLast(fn: (item: ChatItem) => ChatItem): void {
  const items = state.items.slice();
  const last = items[items.length - 1];
  if (!last) return;
  items[items.length - 1] = fn(last);
  set({ items });
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function resetChat(): void {
  abort?.abort();
  resetHooks.forEach((f) => f());
  current = null;
  set({ items: [], busy: false });
}

export function stopChat(): void {
  abort?.abort();
}

// ---- ツールが使う読み出し ----

async function lookup(): Promise<Lookup> {
  const [categories, projects, calendars, series] = await Promise.all([
    db.categories.orderBy('order').toArray(),
    db.projects.toArray(),
    db.calendars.toArray(),
    db.series.toArray(),
  ]);
  return {
    categories,
    catById: new Map(categories.map((c) => [c.id, c])),
    projById: new Map(projects.map((p) => [p.id, p])),
    calById: new Map(calendars.map((c) => [c.id, c])),
    series: new Map(series.map((s) => [s.id, s])),
  };
}

function brief(e: Resolved) {
  return {
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    all_day: e.allDay,
    kind: e.kind,
    category: e.cat?.name ?? null,
    project: e.project?.name ?? null,
    recurring: e.recurring,
    ...(e.parentId ? { step_of: e.parentId, done: !!e.done } : {}),
  };
}

function when(e: { start: string; allDay: boolean }): string {
  return e.allDay ? fmtDayShort(e.start) : `${fmtDayShort(e.start)} ${fmtTime(e.start)}`;
}

const json = (v: unknown) => JSON.stringify(v);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD の形式');
const DATETIME = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, 'YYYY-MM-DD または YYYY-MM-DDTHH:mm の形式');
const KIND = z.enum(['normal', 'exam', 'task']);

async function categoryId(name: string | undefined, lk: Lookup): Promise<string | undefined> {
  if (!name) return undefined;
  const hit = lk.categories.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (!hit) {
    throw new Error(
      `「${name}」という種類はありません。使える種類: ${lk.categories.map((c) => c.name).join('、') || '（なし）'}`,
    );
  }
  return hit.id;
}

/** プロジェクトは名前で探し、なければ作る */
async function projectId(name: string | undefined, lk: Lookup): Promise<string | undefined> {
  if (!name) return undefined;
  const n = name.trim();
  for (const p of lk.projById.values()) if (p.name === n) return p.id;
  return (await saveProject({ name: n })).id;
}

/** 開始と終了をそろえる。終了がなければ、終日は1日、時間つきは1時間にする。 */
function span(start: string, end: string | undefined, allDay?: boolean) {
  const isAllDay = allDay ?? start.length === 10;
  if (isAllDay) {
    const s = start.slice(0, 10);
    const e = end ? end.slice(0, 10) : s;
    // ツールでは終了日を「含む日」で受け取り、保存は翌日（含まない終わり）にする
    return { start: s, end: addDays(e < s ? s : e, 1), allDay: true };
  }
  const s = start.length === 10 ? `${start}T09:00` : start;
  let e = end && end.length > 10 ? end : addMinutes(s, 60);
  if (e <= s) e = addMinutes(s, 60);
  return { start: s, end: e, allDay: false };
}

// ---- 道具（ツール）の形 ----

/** AIが呼べる道具。入力は schema（Zod）で確かめてから run に渡す。 */
export interface AssistantTool {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (input: unknown) => Promise<string>;
}

/** 道具が失敗したときに返す文の先頭（AIに「失敗した」と伝える目印） */
export const ERROR_PREFIX = 'エラー: ';

/** 道具を定義する。run の引数の型を schema から決めるための小さな補助。 */
function tool<S extends z.ZodType>(t: {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<string>;
}): AssistantTool {
  return t as unknown as AssistantTool;
}

/** AIから届いた入力を確かめてから道具を実行する。形が違えば実行せず、その旨を返す。 */
export async function runTool(t: AssistantTool, input: unknown): Promise<string> {
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) {
    return `${ERROR_PREFIX}入力の形が正しくありません。${z.prettifyError(parsed.error)}`;
  }
  return t.run(parsed.data);
}

// ---- ツール ----

export function buildTools(
  ctx: ChatContext,
  act: (a: Omit<ChatAction, 'id'>) => void,
): AssistantTool[] {
  /** 失敗はエラー文として返し、AIが言い直せるようにする */
  const safe =
    <T>(fn: (input: T) => Promise<string>) =>
    async (input: T): Promise<string> => {
      try {
        return await fn(input);
      } catch (err) {
        return `${ERROR_PREFIX}${err instanceof Error ? err.message : String(err)}`;
      }
    };

  const getEvent = async (id: string): Promise<{ e: PlannerEvent; r: Resolved; lk: Lookup }> => {
    const e = await db.events.get(id);
    if (!e) throw new Error(`id "${id}" の予定は見つかりません。list_events で確認してください。`);
    const lk = await lookup();
    return { e, r: resolveEvent(e, lk), lk };
  };

  return [
    tool({
      name: 'list_events',
      description:
        '期間内の予定の一覧を返す。予定を変更・削除・参照する前に、対象のidを調べるために呼ぶ。繰り返しの予定は各回が1件ずつ返る。',
      schema: z.object({
        start_date: DATE.describe('期間の最初の日'),
        end_date: DATE.describe('期間の最後の日（この日を含む）'),
        query: z.string().optional().describe('タイトルに含まれる語で絞り込む'),
      }),
      run: safe(async ({ start_date, end_date, query }) => {
        const lk = await lookup();
        const to = addDays(end_date < start_date ? start_date : end_date, 1);
        const q = query?.trim().toLowerCase();
        const list = (await db.events.toArray())
          .filter((e) => overlapsDays(e, start_date, to))
          .filter((e) => !q || e.title.toLowerCase().includes(q))
          .sort((a, b) => startKey(a).localeCompare(startKey(b)))
          .map((e) => brief(resolveEvent(e, lk)));
        return json({
          count: list.length,
          events: list.slice(0, 120),
          truncated: list.length > 120,
        });
      }),
    }),

    tool({
      name: 'get_event',
      description:
        '予定1件のくわしい内容（メモ、リンク、持ち物、提出物、試験内容、関連する予定、計画ステップ）を返す。',
      schema: z.object({ id: z.string() }),
      run: safe(async ({ id }) => {
        const { r, lk } = await getEvent(id);
        const all = await db.events.toArray();
        const steps = all
          .filter((x) => x.parentId === id)
          .sort((a, b) => a.start.localeCompare(b.start))
          .map((x) => ({ id: x.id, title: x.title, date: x.start, done: !!x.done }));
        const related = all
          .filter((x) => r.relatedIds.includes(x.id))
          .map((x) => brief(resolveEvent(x, lk)));
        return json({
          ...brief(r),
          location: r.location,
          memo: r.memo,
          links: r.links.map((l) => ({ label: l.label, url: l.url })),
          belongings: r.belongings.map((i) => ({ text: i.text, done: i.done })),
          submissions: r.submissions.map((i) => ({ text: i.text, done: i.done })),
          exam: r.exam ?? null,
          plan_steps: steps,
          related_events: related,
        });
      }),
    }),

    tool({
      name: 'create_event',
      description:
        '予定を新しく作る。ユーザーが予定の追加を頼んだときに呼ぶ。テストは kind="exam"、課題や締切は kind="task"。',
      schema: z.object({
        title: z.string().min(1),
        start: DATETIME.describe('開始。終日なら日付だけ'),
        end: DATETIME.optional().describe(
          '終了。終日の場合は最後の日（その日を含む）。省略すると1時間（終日は1日）',
        ),
        all_day: z.boolean().optional(),
        kind: KIND.optional().describe('normal=ふつうの予定 / exam=テスト / task=課題・締切'),
        category: z.string().optional().describe('予定の種類の名前（一覧にあるもの）'),
        project: z.string().optional().describe('プロジェクトの名前。なければ新しく作られる'),
        location: z.string().optional(),
        memo: z.string().optional(),
        repeat: z
          .object({
            freq: z.enum(['daily', 'weekly', 'monthly']),
            until: DATE.describe('繰り返しの最後の日'),
          })
          .optional()
          .describe('繰り返す場合だけ指定する'),
      }),
      run: safe(async (input) => {
        const lk = await lookup();
        const s = span(input.start, input.end, input.all_day);
        const made = await createEvent(
          {
            title: input.title,
            ...s,
            kind: input.kind,
            location: input.location,
            memo: input.memo,
            categoryId: await categoryId(input.category, lk),
            projectId: await projectId(input.project, lk),
            calendarId: getSettings().defaultCalendarId,
          },
          input.repeat,
        );
        act({
          text: `予定を追加：${made.title}（${when(made)}${input.repeat ? '・繰り返し' : ''}）`,
          eventId: made.id,
        });
        return json({ ok: true, id: made.id, start: made.start, end: made.end });
      }),
    }),

    tool({
      name: 'update_event',
      description:
        '既にある予定を変更する。変えたい項目だけ渡す。繰り返しの予定で全部の回を変えたいときは apply_to_series を true にする。',
      schema: z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        start: DATETIME.optional(),
        end: DATETIME.optional().describe('終日の場合は最後の日（その日を含む）'),
        all_day: z.boolean().optional(),
        kind: KIND.optional(),
        category: z.string().optional(),
        project: z.string().optional(),
        location: z.string().optional(),
        memo: z.string().optional(),
        done: z.boolean().optional().describe('計画ステップの完了・未完了'),
        show_in_month: z.boolean().optional().describe('月表示に出す特別な予定にするか'),
        apply_to_series: z.boolean().optional(),
      }),
      run: safe(async (input) => {
        const { e, lk } = await getEvent(input.id);
        const patch: Partial<PlannerEvent> = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.location !== undefined) patch.location = input.location;
        if (input.memo !== undefined) patch.memo = input.memo;
        if (input.kind !== undefined) patch.kind = input.kind;
        if (input.done !== undefined) patch.done = input.done;
        if (input.start !== undefined || input.end !== undefined || input.all_day !== undefined) {
          const allDay = input.all_day ?? (input.start ? input.start.length === 10 : e.allDay);
          // 開始だけ動かすときは、もとの長さを保つ
          const start = input.start ?? (allDay ? e.start.slice(0, 10) : startKey(e));
          let end = input.end;
          if (!end) {
            if (allDay) {
              const days = e.allDay ? Math.max(1, diffDays(e.start, e.end)) : 1;
              end = addDays(start.slice(0, 10), days - 1);
            } else {
              const mins = e.allDay ? 60 : diffMinutes(startKey(e), endKey(e));
              end = addMinutes(start.length === 10 ? `${start}T09:00` : start, mins);
            }
          }
          Object.assign(patch, span(start, end, allDay));
        }
        if (Object.keys(patch).length) {
          await updateEvent(e.id, patch, input.apply_to_series ? 'all' : 'one');
        }
        const meta: Parameters<typeof setEventMeta>[1] = {};
        if (input.category !== undefined)
          meta.categoryId = (await categoryId(input.category, lk)) ?? null;
        if (input.project !== undefined)
          meta.projectId = (await projectId(input.project, lk)) ?? null;
        if (input.show_in_month !== undefined) meta.monthVisible = input.show_in_month;
        if (Object.keys(meta).length) await setEventMeta(e, meta);
        const after = (await db.events.get(e.id)) ?? e;
        act({ text: `予定を変更：${after.title}（${when(after)}）`, eventId: e.id });
        return json({ ok: true, id: e.id, start: after.start, end: after.end });
      }),
    }),

    tool({
      name: 'delete_event',
      description:
        '予定を削除する。ユーザーがはっきり削除を頼んだときだけ呼ぶ。実行前にアプリがユーザーへ確認を出す。',
      schema: z.object({
        id: z.string(),
        whole_series: z
          .boolean()
          .optional()
          .describe('繰り返しの予定をすべての回まとめて消すなら true'),
      }),
      run: safe(async ({ id, whole_series }) => {
        const { e } = await getEvent(id);
        const label = `${e.title}（${when(e)}${whole_series && e.seriesId ? '・繰り返しすべて' : ''}）`;
        if (!(await ctx.confirmDelete(label))) {
          return 'ユーザーが削除を取りやめました。削除はしていません。';
        }
        await deleteEvent(id, whole_series ? 'all' : 'one');
        act({ text: `予定を削除：${label}` });
        return json({ ok: true });
      }),
    }),

    tool({
      name: 'add_checklist_items',
      description: '予定に持ち物（belongings）や提出物（submissions）を追加する。',
      schema: z.object({
        event_id: z.string(),
        list: z.enum(['belongings', 'submissions']),
        items: z.array(z.string().min(1)).min(1),
      }),
      run: safe(async ({ event_id, list, items }) => {
        const { e } = await getEvent(event_id);
        await updateEvent(e.id, {
          [list]: [...e[list], ...items.map((text) => ({ id: newId(), text, done: false }))],
        });
        act({
          text: `${list === 'belongings' ? '持ち物' : '提出物'}を追加：${items.join('、')}（${e.title}）`,
          eventId: e.id,
        });
        return json({ ok: true });
      }),
    }),

    tool({
      name: 'add_link',
      description: '予定にリンク（Googleドキュメント、メール、Webページなど）を保存する。',
      schema: z.object({
        event_id: z.string(),
        url: z.string(),
        label: z.string().optional().describe('リンクの名前'),
      }),
      run: safe(async ({ event_id, url, label }) => {
        const { e } = await getEvent(event_id);
        const href = normalizeUrl(url);
        if (!href) throw new Error('URLの形になっていません（http(s) のリンクを渡してください）');
        const name = label?.trim() || linkLabel(href);
        await updateEvent(e.id, { links: [...e.links, { id: newId(), label: name, url: href }] });
        act({ text: `リンクを追加：${name}（${e.title}）`, eventId: e.id });
        return json({ ok: true });
      }),
    }),

    tool({
      name: 'add_plan_steps',
      description:
        '締切やテストまでの逆算計画（いつまでに何をやるか）のステップを、予定に追加する。ステップは同じカレンダーに終日の項目として並ぶ。',
      schema: z.object({
        event_id: z.string().describe('締切やテストの予定のid'),
        steps: z
          .array(
            z.object({ title: z.string().min(1), date: DATE.describe('そのステップをやる日') }),
          )
          .min(1),
      }),
      run: safe(async ({ event_id, steps }) => {
        const { r } = await getEvent(event_id);
        for (const s of steps) {
          await addStep(
            { id: r.id, categoryId: r.cat?.id, projectId: r.project?.id },
            s.title,
            s.date,
          );
        }
        act({ text: `計画ステップを${steps.length}件追加（${r.title}）`, eventId: r.id });
        return json({ ok: true, added: steps.length });
      }),
    }),

    tool({
      name: 'link_events',
      description:
        '2つの予定をつなげる（例：試験と出願日・入金期限）。つなげると、互いのページからすぐ開ける。',
      schema: z.object({ event_id: z.string(), related_event_id: z.string() }),
      run: safe(async ({ event_id, related_event_id }) => {
        const a = await getEvent(event_id);
        const b = await getEvent(related_event_id);
        await linkEvents(a.e.id, b.e.id);
        act({ text: `予定をつなげた：${a.e.title} ↔ ${b.e.title}`, eventId: a.e.id });
        return json({ ok: true });
      }),
    }),

    tool({
      name: 'log_actual',
      description:
        '実績（実際にその時間に何をしていたか）を記録する。「さっき2時間勉強した」のような報告を受けたときに呼ぶ。',
      schema: z.object({
        title: z.string().min(1),
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:mm の形式'),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:mm の形式'),
        category: z.string().optional(),
      }),
      run: safe(async ({ title, start, end, category }) => {
        if (end <= start) throw new Error('終了は開始より後にしてください');
        const lk = await lookup();
        await addActual({
          title,
          start,
          end,
          categoryId: await categoryId(category, lk),
          memo: '',
        });
        act({
          text: `実績を記録：${title}（${fmtDayShort(start)} ${fmtTime(start)}–${fmtTime(end)}）`,
        });
        return json({ ok: true });
      }),
    }),

    tool({
      name: 'write_diary',
      description: '日記を書く。mode="append" は今ある日記の後ろに足し、"replace" は書き換える。',
      schema: z.object({
        date: DATE,
        text: z.string().min(1),
        mode: z.enum(['append', 'replace']),
      }),
      run: safe(async ({ date, text, mode }) => {
        const cur = await db.diary.get(date);
        const next = mode === 'append' && cur?.text ? `${cur.text}\n${text}` : text;
        await saveDiary(date, { text: next });
        act({ text: `日記を書いた：${fmtDayShort(date)}` });
        return json({ ok: true });
      }),
    }),
  ];
}

// ---- AIに渡す前提 ----

export async function dynamicSystem(): Promise<string> {
  const [categories, projects] = await Promise.all([
    db.categories.orderBy('order').toArray(),
    db.projects.toArray(),
  ]);
  return [
    `予定の種類: ${categories.map((c) => c.name).join('、') || '（未設定）'}`,
    `プロジェクト: ${
      projects
        .filter((p) => !p.archived)
        .map((p) => p.name)
        .join('、') || '（なし）'
    }`,
  ].join('\n');
}

export function nowLine(viewing: string): string {
  const now = toLocal(new Date());
  return `（現在の日時: ${now} ${WEEKDAYS[dayOfWeek(now)]}曜日／開いている画面: ${viewing}）`;
}

// ---- 送信 ----

/** 途中で止めるときに使う（利用者にそのまま見せる文を持たせる） */
export class Stopped extends Error {}

/** 1回の送信で、AIの呼び出し側（claude.ts / gemini.ts）に渡すもの */
export interface ProviderRun {
  body: string;
  viewing: string;
  tools: AssistantTool[];
  signal: AbortSignal;
  /** 返事の文章が届いたら呼ぶ（少しずつでも、まとめてでもよい） */
  onText: (delta: string) => void;
  /** 道具を使ったあと、続きの文章との間に区切りを入れる */
  onToolsUsed: () => void;
  /** まだ何も画面に出していないか */
  isEmpty: () => boolean;
}

export interface Provider {
  run: (r: ProviderRun) => Promise<void>;
  /** エラーを、利用者に見せる日本語にする */
  describe: (err: unknown) => string;
}

async function loadProvider(id: AssistantId): Promise<Provider> {
  // 使うほうのSDKだけを読み込む
  return id === 'gemini' ? import('./gemini') : import('./claude');
}

export async function sendChat(text: string, ctx: ChatContext): Promise<void> {
  const settings = getSettings();
  const body = text.trim();
  if (!body || state.busy) return;

  const id = settings.aiProvider;
  const info = ASSISTANTS[id];
  // 途中でAIを切り替えたら、前のAIとの会話は引き継げないので新しく始める
  if (current && current !== id) resetChat();
  current = id;

  set({
    busy: true,
    items: [
      ...state.items,
      { id: newId(), role: 'user', text: body, actions: [] },
      { id: newId(), role: 'assistant', text: '', actions: [] },
    ],
  });

  if (!settings[info.keyField]) {
    patchLast((m) => ({
      ...m,
      error: true,
      text: `${info.name}を使うにはAPIキーが必要です。設定の「AIアシスタント」で登録してください。`,
    }));
    set({ busy: false });
    return;
  }

  const controller = new AbortController();
  abort = controller;
  let provider: Provider | undefined;

  try {
    provider = await loadProvider(id);
    await provider.run({
      body,
      viewing: ctx.viewing,
      tools: buildTools(ctx, (a) =>
        patchLast((m) => ({ ...m, actions: [...m.actions, { ...a, id: newId() }] })),
      ),
      signal: controller.signal,
      onText: (delta) => patchLast((m) => ({ ...m, text: m.text + delta })),
      onToolsUsed: () => patchLast((m) => (m.text ? { ...m, text: `${m.text.trimEnd()}\n\n` } : m)),
      isEmpty: () => state.items[state.items.length - 1]?.text === '',
    });
    patchLast((m) => ({
      ...m,
      text: m.text.trim() || (m.actions.length ? '完了しました。' : '（返事がありませんでした）'),
    }));
  } catch (err) {
    if (controller.signal.aborted) {
      patchLast((m) => ({ ...m, text: `${m.text.trim()}\n（中止しました）`.trim() }));
    } else {
      const msg =
        err instanceof Stopped
          ? err.message
          : provider
            ? provider.describe(err)
            : 'AIの部品を読み込めませんでした。ネットワークを確認してください。';
      patchLast((m) => ({
        ...m,
        error: true,
        text: m.text.trim() ? `${m.text.trim()}\n\n${msg}` : msg,
      }));
    }
  } finally {
    abort = null;
    set({ busy: false });
  }
}
