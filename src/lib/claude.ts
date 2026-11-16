// アプリの中でClaudeに話しかけて、予定を追加・操作する機能。
// ブラウザからAnthropicのAPIを直接呼び、Claudeが選んだ道具（ツール）をこの端末で実行する。
// APIキーはこの端末の設定にだけ保存される。
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
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
import { getSettings } from './settings';
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

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** サーバー側のフォールバック（安全判定で断られたとき別のモデルで続ける機能）に対応するモデル */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const SYSTEM = `あなたは「手帳」という個人用の予定管理アプリの中にいるアシスタントです。ユーザーの予定・実績（実際の時間の使い方）・日記を、用意されたツールで読み書きします。

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
let history: MessageParam[] = [];
let abort: AbortController | null = null;
const listeners = new Set<() => void>();

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
  history = [];
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

// ---- ツール ----

function buildTools(ctx: ChatContext, act: (a: Omit<ChatAction, 'id'>) => void) {
  /** 失敗はエラー文として返し、Claudeが言い直せるようにする */
  const safe =
    <T>(fn: (input: T) => Promise<string>) =>
    async (input: T): Promise<string> => {
      try {
        return await fn(input);
      } catch (err) {
        return `エラー: ${err instanceof Error ? err.message : String(err)}`;
      }
    };

  const getEvent = async (id: string): Promise<{ e: PlannerEvent; r: Resolved; lk: Lookup }> => {
    const e = await db.events.get(id);
    if (!e) throw new Error(`id "${id}" の予定は見つかりません。list_events で確認してください。`);
    const lk = await lookup();
    return { e, r: resolveEvent(e, lk), lk };
  };

  // ストリーミング中もツールの入力を逐次受け取る（入力はZodで検証してから実行される）
  const eager = { eager_input_streaming: true } as const;

  return [
    betaZodTool({
      ...eager,
      name: 'list_events',
      description:
        '期間内の予定の一覧を返す。予定を変更・削除・参照する前に、対象のidを調べるために呼ぶ。繰り返しの予定は各回が1件ずつ返る。',
      inputSchema: z.object({
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

    betaZodTool({
      ...eager,
      name: 'get_event',
      description:
        '予定1件のくわしい内容（メモ、リンク、持ち物、提出物、試験内容、関連する予定、計画ステップ）を返す。',
      inputSchema: z.object({ id: z.string() }),
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

    betaZodTool({
      ...eager,
      name: 'create_event',
      description:
        '予定を新しく作る。ユーザーが予定の追加を頼んだときに呼ぶ。テストは kind="exam"、課題や締切は kind="task"。',
      inputSchema: z.object({
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

    betaZodTool({
      ...eager,
      name: 'update_event',
      description:
        '既にある予定を変更する。変えたい項目だけ渡す。繰り返しの予定で全部の回を変えたいときは apply_to_series を true にする。',
      inputSchema: z.object({
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

    betaZodTool({
      ...eager,
      name: 'delete_event',
      description:
        '予定を削除する。ユーザーがはっきり削除を頼んだときだけ呼ぶ。実行前にアプリがユーザーへ確認を出す。',
      inputSchema: z.object({
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

    betaZodTool({
      ...eager,
      name: 'add_checklist_items',
      description: '予定に持ち物（belongings）や提出物（submissions）を追加する。',
      inputSchema: z.object({
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

    betaZodTool({
      ...eager,
      name: 'add_link',
      description: '予定にリンク（Googleドキュメント、メール、Webページなど）を保存する。',
      inputSchema: z.object({
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

    betaZodTool({
      ...eager,
      name: 'add_plan_steps',
      description:
        '締切やテストまでの逆算計画（いつまでに何をやるか）のステップを、予定に追加する。ステップは同じカレンダーに終日の項目として並ぶ。',
      inputSchema: z.object({
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

    betaZodTool({
      ...eager,
      name: 'link_events',
      description:
        '2つの予定をつなげる（例：試験と出願日・入金期限）。つなげると、互いのページからすぐ開ける。',
      inputSchema: z.object({ event_id: z.string(), related_event_id: z.string() }),
      run: safe(async ({ event_id, related_event_id }) => {
        const a = await getEvent(event_id);
        const b = await getEvent(related_event_id);
        await linkEvents(a.e.id, b.e.id);
        act({ text: `予定をつなげた：${a.e.title} ↔ ${b.e.title}`, eventId: a.e.id });
        return json({ ok: true });
      }),
    }),

    betaZodTool({
      ...eager,
      name: 'log_actual',
      description:
        '実績（実際にその時間に何をしていたか）を記録する。「さっき2時間勉強した」のような報告を受けたときに呼ぶ。',
      inputSchema: z.object({
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

    betaZodTool({
      ...eager,
      name: 'write_diary',
      description: '日記を書く。mode="append" は今ある日記の後ろに足し、"replace" は書き換える。',
      inputSchema: z.object({
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

// ---- 送信 ----

async function dynamicSystem(): Promise<string> {
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

function nowLine(viewing: string): string {
  const now = toLocal(new Date());
  return `（現在の日時: ${now} ${WEEKDAYS[dayOfWeek(now)]}曜日／開いている画面: ${viewing}）`;
}

function describe(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'APIキーが正しくないようです。設定の「Claude」でキーを確認してください。';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'このAPIキーでは、選んだモデルを使う権限がありません。設定でモデルを変えてみてください。';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'いま混み合っています。少し待ってからもう一度送ってください。';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Claudeにつながりませんでした。ネットワークを確認してください。';
  }
  if (err instanceof Anthropic.APIError) {
    return `Claudeからエラーが返りました（${err.status ?? '不明'}）：${err.message}`;
  }
  return err instanceof Error ? err.message : '送信に失敗しました。';
}

class Stopped extends Error {}

export async function sendChat(text: string, ctx: ChatContext): Promise<void> {
  const settings = getSettings();
  const body = text.trim();
  if (!body || state.busy) return;

  set({
    busy: true,
    items: [
      ...state.items,
      { id: newId(), role: 'user', text: body, actions: [] },
      { id: newId(), role: 'assistant', text: '', actions: [] },
    ],
  });

  if (!settings.claudeApiKey) {
    patchLast((m) => ({
      ...m,
      error: true,
      text: 'Claudeを使うにはAPIキーが必要です。設定の「Claude」で登録してください。',
    }));
    set({ busy: false });
    return;
  }

  // 個人の端末で自分のキーを使う前提なので、ブラウザから直接呼ぶ
  const client = new Anthropic({ apiKey: settings.claudeApiKey, dangerouslyAllowBrowser: true });
  const controller = new AbortController();
  abort = controller;

  const tools = buildTools(ctx, (a) =>
    patchLast((m) => ({ ...m, actions: [...m.actions, { ...a, id: newId() }] })),
  );
  const messages: MessageParam[] = [
    ...history,
    {
      role: 'user',
      content: [
        { type: 'text', text: body },
        { type: 'text', text: nowLine(ctx.viewing) },
      ],
    },
  ];

  const model = settings.claudeModel;
  const run = async (withFallback: boolean): Promise<void> => {
    let runner = client.beta.messages.toolRunner(
      {
        model,
        max_tokens: 64000,
        stream: true,
        max_iterations: 16,
        // 会話は短いので、サーバー側に会話を預ける機能（スレッド）は使わず、毎回こちらから全文を送る
        thread: false,
        // 予定の読み書きが中心なので、考える深さは中くらいにする
        output_config: { effort: 'medium' },
        // 会話が長くなっても、前のやり取りはキャッシュから読ませる
        cache_control: { type: 'ephemeral' },
        system: [
          { type: 'text', text: SYSTEM },
          { type: 'text', text: await dynamicSystem() },
        ],
        tools,
        messages,
        ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      },
      { signal: controller.signal },
    );

    let final: Anthropic.Beta.Messages.BetaMessage | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const stream of runner) {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              const delta = event.delta.text;
              patchLast((m) => ({ ...m, text: m.text + delta }));
            }
          }
          const message = await stream.finalMessage();
          final = message;
          attempt = 0;
          const hasToolUse = message.content.some((b) => b.type === 'tool_use');
          // 途中で切れた入力や、断られた回のツールは実行しない
          if (message.stop_reason === 'max_tokens' && hasToolUse) {
            throw new Stopped(
              '返事が長くなりすぎて途中で切れました。もう少し小さく分けて頼んでみてください。',
            );
          }
          if (message.stop_reason === 'refusal') {
            throw new Stopped(
              'この内容にはお答えできませんでした。言い方を変えて試してみてください。',
            );
          }
          // 次の文章との間に区切りを入れる（ツールを使ったあとに続きを話すとき）
          if (hasToolUse)
            patchLast((m) => (m.text ? { ...m, text: `${m.text.trimEnd()}\n\n` } : m));
        }
        break;
      } catch (err) {
        if (err instanceof Anthropic.APIError || err instanceof Stopped || attempt >= 2) throw err;
        if (controller.signal.aborted) throw err;
        // ツールの入力が壊れて届いたときだけ、同じ回をやり直す
        runner = client.beta.messages.toolRunner(
          { ...runner.params },
          { signal: controller.signal },
        );
      }
    }

    // 次の発言のために会話を覚えておく
    const next = [...runner.params.messages];
    if (final && next[next.length - 1]?.role !== 'assistant') {
      next.push({ role: 'assistant', content: final.content });
    }
    history = next;
  };

  try {
    const fallback = FALLBACK_MODELS.has(model);
    try {
      await run(fallback);
    } catch (err) {
      // フォールバックの指定を受け付けない環境では、指定なしでもう一度だけ試す
      const nothingYet = state.items[state.items.length - 1]?.text === '';
      if (fallback && nothingYet && err instanceof Anthropic.BadRequestError) await run(false);
      else throw err;
    }
    patchLast((m) => ({
      ...m,
      text: m.text.trim() || (m.actions.length ? '完了しました。' : '（返事がありませんでした）'),
    }));
  } catch (err) {
    if (controller.signal.aborted) {
      patchLast((m) => ({ ...m, text: `${m.text.trim()}\n（中止しました）`.trim() }));
    } else {
      const msg = err instanceof Stopped ? err.message : describe(err);
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
