// Googleカレンダーとの連携。
// サーバーを持たないので、ブラウザから直接Googleにログインして予定を読み書きする。
// 手帳で書き足した情報（リンク・持ち物など）は端末の中だけに置き、Googleへは送らない。
import { useSyncExternalStore } from 'react';
import { nearestSwatch } from './colors';
import { addDays, addMonths, endKey, parse, startKey, toLocal, today } from './date';
import { LOCAL_CALENDAR, db, newId } from './db';
import { hasDetails } from './resolve';
import { getSettings } from './settings';
import type { CalendarInfo, PlannerEvent, RepeatRule, SyncField } from './types';

const SCOPES =
  'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const API = 'https://www.googleapis.com/calendar/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'techo.gtoken';
const LAST_SYNC_KEY = 'techo.lastSync';

// ---- Google APIの形（使う部分だけ） ----

interface GTime {
  date?: string | null;
  dateTime?: string | null;
  timeZone?: string | null;
}

export interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GTime;
  end?: GTime;
  recurringEventId?: string;
  recurrence?: string[];
  attachments?: Array<{ fileUrl?: string; title?: string }>;
}

interface GCalendar {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
}

interface GList<T> {
  items?: T[];
  nextPageToken?: string;
}

// ---- 状態（ヘッダーの同期ボタンに出す） ----

export interface SyncState {
  /** off=未設定 / needsAuth=ログインが必要 / idle=同期済み / syncing=同期中 / error=失敗 */
  status: 'off' | 'needsAuth' | 'idle' | 'syncing' | 'error';
  message: string;
  lastSync: number;
}

let state: SyncState = { status: 'off', message: '', lastSync: 0 };
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

// ---- ログイン ----

interface Token {
  value: string;
  /** 期限（ミリ秒） */
  exp: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

let token: Token | null = null;
let gisLoading: Promise<void> | null = null;

function loadToken(): Token | null {
  if (token) return token;
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as Token | null;
    if (t && typeof t.value === 'string' && typeof t.exp === 'number') token = t;
  } catch {
    // 無視
  }
  return token;
}

function saveToken(t: Token | null): void {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 無視
  }
}

function validToken(): string | null {
  const t = loadToken();
  // 期限の1分前には切れた扱いにする
  return t && t.exp - 60_000 > Date.now() ? t.value : null;
}

export function isConfigured(): boolean {
  return getSettings().googleClientId.trim() !== '';
}

/** Googleのログイン部品を読み込む。ボタンを押す前に済ませておくとポップアップが止められにくい。 */
export function prepareGoogle(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new Error('Googleのログイン部品を読み込めませんでした（オフラインかもしれません）'));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/** ログイン画面を出してアクセス権をもらう。ボタンを押した直後に呼ぶこと。 */
async function requestToken(): Promise<string> {
  const clientId = getSettings().googleClientId.trim();
  if (!clientId) throw new Error('GoogleのクライアントIDが未設定です');
  await prepareGoogle();
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new Error('Googleのログイン部品を読み込めませんでした');
  return new Promise<string>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(new Error(r.error_description || r.error || 'ログインできませんでした'));
          return;
        }
        const sec = Number(r.expires_in) || 3600;
        saveToken({ value: r.access_token, exp: Date.now() + sec * 1000 });
        resolve(r.access_token);
      },
      error_callback: (e) => {
        reject(
          new Error(
            e.type === 'popup_failed_to_open'
              ? 'ログイン画面を開けませんでした。もう一度押してください'
              : e.type === 'popup_closed'
                ? 'ログインがキャンセルされました'
                : e.message || 'ログインできませんでした',
          ),
        );
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export function disconnectGoogle(): void {
  const t = loadToken();
  if (t) window.google?.accounts?.oauth2.revoke(t.value);
  saveToken(null);
  setState({ status: isConfigured() ? 'needsAuth' : 'off', message: '' });
}

// ---- API呼び出し ----

class AuthError extends Error {}

async function api<T>(
  method: string,
  path: string,
  opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
): Promise<T> {
  const tk = validToken();
  if (!tk) throw new AuthError('Googleへのログインが必要です');
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${tk}`,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    saveToken(null);
    throw new AuthError('Googleへのログインが切れました');
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    // すでに消えている予定を消そうとした場合は成功扱い
    if (method === 'DELETE' && (res.status === 404 || res.status === 410)) return undefined as T;
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j.error?.message ?? '';
    } catch {
      // 無視
    }
    throw new Error(`Googleカレンダーのエラー (${res.status}) ${detail}`.trim());
  }
  return (await res.json()) as T;
}

async function listAll<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const page: GList<T> = await api<GList<T>>('GET', path, { query: { ...query, pageToken } });
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

const enc = encodeURIComponent;

// ---- 形の変換 ----

/** Googleの説明文はHTMLのことがあるので、手帳ではただの文章にする */
function plainText(html: string): string {
  if (!/[<&]/.test(html)) return html;
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

type Core = Pick<PlannerEvent, 'title' | 'start' | 'end' | 'allDay' | 'location' | 'memo'>;

/** Googleの予定 → 手帳の基本項目。時刻のない予定は null。 */
export function fromGoogle(g: GEvent, toText: (s: string) => string = plainText): Core | null {
  const title = g.summary?.trim() || '（タイトルなし）';
  const location = g.location ?? '';
  const memo = g.description ? toText(g.description) : '';
  if (g.start?.date && g.end?.date) {
    return { title, start: g.start.date, end: g.end.date, allDay: true, location, memo };
  }
  if (g.start?.dateTime && g.end?.dateTime) {
    return {
      title,
      start: toLocal(new Date(g.start.dateTime)),
      end: toLocal(new Date(g.end.dateTime)),
      allDay: false,
      location,
      memo,
    };
  }
  return null;
}

function gTime(value: string, allDay: boolean): GTime {
  if (allDay) return { date: value.slice(0, 10), dateTime: null, timeZone: null };
  return {
    dateTime: parse(value).toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    date: null,
  };
}

/** 手帳の予定 → Googleへ送る形。fields を渡すと変更した項目だけにする。 */
export function toGoogle(e: Core, fields?: SyncField[]): Record<string, unknown> {
  const want = (f: SyncField) => !fields || fields.includes(f);
  const body: Record<string, unknown> = {};
  if (want('title')) body.summary = e.title;
  if (want('location')) body.location = e.location;
  if (want('memo')) body.description = e.memo;
  if (want('time')) {
    body.start = gTime(e.start, e.allDay);
    body.end = gTime(e.end, e.allDay);
  }
  return body;
}

/** 繰り返しルール → Googleの RRULE */
export function toRRule(rule: RepeatRule, allDay: boolean): string {
  const freq = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', none: '' }[rule.freq];
  const day = rule.until.replace(/-/g, '');
  if (allDay) return `RRULE:FREQ=${freq};UNTIL=${day}`;
  // 時間つきの予定は、その日の終わりをUTCで指定する
  const end = parse(rule.until + 'T23:59');
  const utc = end.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  return `RRULE:FREQ=${freq};UNTIL=${utc}`;
}

function blank(calendarId: string, core: Core, g: GEvent): PlannerEvent {
  const now = Date.now();
  return {
    id: newId(),
    ...core,
    calendarId,
    kind: 'normal',
    seriesId: g.recurringEventId,
    // Googleで予定に添付したファイルは、最初からリンクとして見えるようにする
    links: (g.attachments ?? [])
      .filter((a) => a.fileUrl)
      .map((a) => ({ id: newId(), label: a.title ?? 'Googleドライブ', url: a.fileUrl! })),
    belongings: [],
    submissions: [],
    relatedIds: [],
    googleId: g.id,
    createdAt: now,
    updatedAt: now,
  };
}

function window_(): { from: string; to: string; timeMin: string; timeMax: string } {
  const s = getSettings();
  const from = addMonths(today(), -s.syncPastMonths);
  const to = addMonths(today(), s.syncFutureMonths);
  return { from, to, timeMin: parse(from).toISOString(), timeMax: parse(to).toISOString() };
}

// ---- 取り込み（Google → 手帳） ----

async function pullCalendars(): Promise<CalendarInfo[]> {
  const remote = await listAll<GCalendar>('/users/me/calendarList', { maxResults: 250 });
  const local = await db.calendars.toArray();
  const known = new Map(local.map((c) => [c.id, c]));
  const next: CalendarInfo[] = remote.map((g) => {
    const prev = known.get(g.id);
    return {
      id: g.id,
      name: g.summaryOverride || g.summary || g.id,
      color: nearestSwatch(g.backgroundColor),
      // 表示のオン・オフは手帳側の設定を優先し、初回はGoogleでの表示設定に合わせる
      visible: prev ? prev.visible : g.selected !== false,
      source: 'google',
      writable: g.accessRole === 'owner' || g.accessRole === 'writer',
      primary: !!g.primary,
    };
  });
  const remoteIds = new Set(next.map((c) => c.id));
  const gone = local.filter((c) => c.source === 'google' && !remoteIds.has(c.id));
  await db.transaction('rw', db.calendars, db.events, db.files, async () => {
    await db.calendars.bulkPut(next);
    for (const c of gone) {
      await detachOrDelete(await db.events.where('calendarId').equals(c.id).toArray());
      await db.calendars.delete(c.id);
    }
  });
  return next;
}

/** Google側で消えた予定。手帳で書き足した情報があれば、この端末の予定として残す。 */
async function detachOrDelete(events: PlannerEvent[]): Promise<void> {
  const del: string[] = [];
  for (const e of events) {
    if (hasDetails(e) || (await db.files.where('eventId').equals(e.id).count()) > 0) {
      await db.events.update(e.id, {
        calendarId: LOCAL_CALENDAR,
        googleId: undefined,
        sync: undefined,
        syncFields: undefined,
        updatedAt: Date.now(),
      });
    } else {
      del.push(e.id);
    }
  }
  if (del.length) await db.events.bulkDelete(del);
}

async function pullEvents(cal: CalendarInfo): Promise<void> {
  const w = window_();
  const remote = await listAll<GEvent>(`/calendars/${enc(cal.id)}/events`, {
    singleEvents: true,
    showDeleted: false,
    maxResults: 2500,
    timeMin: w.timeMin,
    timeMax: w.timeMax,
  });
  await mergeEvents(cal.id, remote, w.from, w.to);
}

/** 取り込んだ予定を端末のデータに合わせる。from〜to の範囲で、Googleにないものは消えたとみなす。 */
export async function mergeEvents(
  calendarId: string,
  remote: GEvent[],
  from?: string,
  to?: string,
): Promise<void> {
  await db.transaction('rw', db.events, db.files, async () => {
    const local = await db.events.where('calendarId').equals(calendarId).toArray();
    const byGoogle = new Map<string, PlannerEvent>();
    for (const e of local) if (e.googleId) byGoogle.set(e.googleId, e);
    const seen = new Set<string>();
    const puts: PlannerEvent[] = [];

    for (const g of remote) {
      if (g.status === 'cancelled') continue;
      const core = fromGoogle(g);
      if (!core) continue;
      seen.add(g.id);
      const cur = byGoogle.get(g.id);
      if (!cur) {
        puts.push(blank(calendarId, core, g));
        continue;
      }
      // まだ送れていない変更がある予定は、手帳側を正とする
      if (cur.sync) continue;
      const changed =
        cur.title !== core.title ||
        cur.start !== core.start ||
        cur.end !== core.end ||
        cur.allDay !== core.allDay ||
        cur.location !== core.location ||
        cur.memo !== core.memo ||
        cur.seriesId !== g.recurringEventId;
      if (changed) {
        puts.push({ ...cur, ...core, seriesId: g.recurringEventId, updatedAt: Date.now() });
      }
    }
    if (puts.length) await db.events.bulkPut(puts);

    if (from && to) {
      const gone = local.filter(
        (e) =>
          e.googleId &&
          !e.sync &&
          !seen.has(e.googleId) &&
          startKey(e) < to + 'T00:00' &&
          endKey(e) > from + 'T00:00',
      );
      await detachOrDelete(gone);
    }
  });
}

// ---- 送り出し（手帳 → Google） ----

async function pushOne(e: PlannerEvent): Promise<void> {
  const cal = await db.calendars.get(e.calendarId);
  if (!cal || cal.source !== 'google' || !cal.writable) {
    await db.events.update(e.id, { sync: undefined, syncFields: undefined });
    return;
  }
  let googleId = e.googleId;
  if (!googleId) {
    const made = await api<GEvent>('POST', `/calendars/${enc(cal.id)}/events`, {
      body: toGoogle(e),
    });
    googleId = made.id;
  } else {
    await api<GEvent>('PATCH', `/calendars/${enc(cal.id)}/events/${enc(googleId)}`, {
      body: toGoogle(e, e.syncFields),
    });
  }
  await db.transaction('rw', db.events, db.tombstones, async () => {
    const cur = await db.events.get(e.id);
    if (!cur) {
      // 送っている間に手帳側で消された
      await db.tombstones.put({ googleId: googleId!, calendarId: cal.id });
      return;
    }
    // 送っている間にさらに編集されていたら、次の同期でもう一度送る
    const stale = cur.updatedAt !== e.updatedAt;
    await db.events.update(e.id, {
      googleId,
      sync: stale ? 'update' : undefined,
      syncFields: stale ? cur.syncFields : undefined,
    });
  });
}

async function pushPending(): Promise<void> {
  for (const t of await db.tombstones.toArray()) {
    await api<void>('DELETE', `/calendars/${enc(t.calendarId)}/events/${enc(t.googleId)}`);
    await db.tombstones.delete(t.googleId);
  }
  const pending = await db.events.where('sync').anyOf('create', 'update').toArray();
  for (const e of pending) await pushOne(e);
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;

function fail(err: unknown): void {
  if (err instanceof AuthError) {
    setState({ status: 'needsAuth', message: err.message });
  } else {
    setState({
      status: 'error',
      message: err instanceof Error ? err.message : '同期に失敗しました',
    });
  }
}

async function exclusive(job: () => Promise<void>): Promise<void> {
  // 同期が重ならないよう順番に実行する
  while (running) await running.catch(() => undefined);
  running = job();
  try {
    await running;
  } finally {
    running = null;
  }
}

/** 予定を変更したあとに呼ぶ。少し待ってまとめてGoogleへ送る。 */
export function schedulePush(): void {
  if (!isConfigured()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (!validToken()) {
      setState({ status: 'needsAuth', message: 'Googleにまだ送れていない変更があります' });
      return;
    }
    void exclusive(async () => {
      try {
        await pushPending();
        if (state.status !== 'syncing') setState({ status: 'idle', message: '' });
      } catch (err) {
        fail(err);
      }
    });
  }, 1200);
}

/**
 * 同期する。interactive=true はボタンを押したとき用で、必要ならログイン画面を出す。
 */
export async function syncNow(interactive = false): Promise<void> {
  if (!isConfigured()) {
    setState({ status: 'off', message: '' });
    return;
  }
  if (!validToken()) {
    if (!interactive) {
      setState({ status: 'needsAuth', message: '' });
      return;
    }
    try {
      await requestToken();
    } catch (err) {
      setState({
        status: 'needsAuth',
        message: err instanceof Error ? err.message : 'ログインできませんでした',
      });
      return;
    }
  }
  await exclusive(async () => {
    setState({ status: 'syncing', message: '' });
    try {
      await pushPending();
      const cals = await pullCalendars();
      for (const c of cals) if (c.visible) await pullEvents(c);
      const now = Date.now();
      try {
        localStorage.setItem(LAST_SYNC_KEY, String(now));
      } catch {
        // 無視
      }
      setState({ status: 'idle', message: '', lastSync: now });
    } catch (err) {
      fail(err);
    }
  });
}

/** 起動時：設定済みで、ログインがまだ有効なら自動で同期する */
export function initGoogle(): void {
  if (!isConfigured()) {
    setState({ status: 'off' });
    return;
  }
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_SYNC_KEY)) || 0;
  } catch {
    // 無視
  }
  setState({ status: validToken() ? 'idle' : 'needsAuth', lastSync: last });
  void prepareGoogle().catch(() => undefined);
  if (validToken()) void syncNow();
}

/** アプリに戻ってきたとき、前回の同期から時間がたっていれば取り込み直す */
export function syncIfStale(maxAgeMs = 10 * 60_000): void {
  if (!isConfigured() || state.status === 'syncing' || !validToken()) return;
  if (Date.now() - state.lastSync > maxAgeMs) void syncNow();
}

// ---- 削除・繰り返し ----

/** Google側の予定を消す。今すぐ送れなければ控えに残して次の同期で送る。 */
export async function removeRemote(calendarId: string, googleId: string): Promise<void> {
  await db.tombstones.put({ googleId, calendarId });
  schedulePush();
}

/** 繰り返し予定をGoogleカレンダーに作り、できた各回を手帳に取り込む。最初の回のIDを返す。 */
export async function createRecurringOnGoogle(
  calendarId: string,
  core: Core,
  rule: RepeatRule,
): Promise<{ seriesId: string; firstId?: string }> {
  if (!validToken()) await requestToken();
  const made = await api<GEvent>('POST', `/calendars/${enc(calendarId)}/events`, {
    body: { ...toGoogle(core), recurrence: [toRRule(rule, core.allDay)] },
  });
  await pullSeries(calendarId, made.id);
  const rows = await db.events.where('seriesId').equals(made.id).sortBy('start');
  return { seriesId: made.id, firstId: rows[0]?.id };
}

async function pullSeries(calendarId: string, seriesId: string): Promise<void> {
  const w = window_();
  const items = await listAll<GEvent>(
    `/calendars/${enc(calendarId)}/events/${enc(seriesId)}/instances`,
    { maxResults: 2500, timeMin: w.timeMin, timeMax: addDaysIso(w.to) },
  );
  await db.transaction('rw', db.events, db.files, async () => {
    const local = await db.events.where('seriesId').equals(seriesId).toArray();
    const byGoogle = new Map<string, PlannerEvent>();
    const byDay = new Map<string, PlannerEvent>();
    for (const e of local) {
      if (e.googleId) byGoogle.set(e.googleId, e);
      byDay.set(e.start.slice(0, 10), e);
    }
    const used = new Set<string>();
    const puts: PlannerEvent[] = [];
    const now = Date.now();
    for (const g of items) {
      if (g.status === 'cancelled') continue;
      const core = fromGoogle(g);
      if (!core) continue;
      // 時刻をずらすとGoogle側のIDが変わるので、同じ日の回を同じ予定として引き継ぐ
      // （書き足したリンクや持ち物を失わないため）
      const cur = byGoogle.get(g.id) ?? byDay.get(core.start.slice(0, 10));
      if (cur && !used.has(cur.id)) {
        used.add(cur.id);
        puts.push({
          ...cur,
          ...core,
          googleId: g.id,
          seriesId,
          sync: undefined,
          syncFields: undefined,
          updatedAt: now,
        });
      } else {
        puts.push(blank(calendarId, core, { ...g, recurringEventId: seriesId }));
      }
    }
    if (puts.length) await db.events.bulkPut(puts);
    const gone = local.filter(
      (e) => !used.has(e.id) && startKey(e) < w.to + 'T00:00' && endKey(e) > w.from + 'T00:00',
    );
    await detachOrDelete(gone);
  });
}

function addDaysIso(day: string): string {
  return parse(addDays(day, 1)).toISOString();
}

/** 繰り返し予定の「すべて」を変更する（題名・場所・メモ・時刻のずらし） */
export async function updateGoogleSeries(
  e: PlannerEvent,
  patch: {
    title?: string;
    location?: string;
    memo?: string;
    shiftMin?: number;
    durationMin?: number;
  },
): Promise<void> {
  if (!e.seriesId) return;
  if (!validToken()) await requestToken();
  const path = `/calendars/${enc(e.calendarId)}/events/${enc(e.seriesId)}`;
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.memo !== undefined) body.description = patch.memo;
  if (patch.shiftMin !== undefined || patch.durationMin !== undefined) {
    const master = await api<GEvent>('GET', path);
    const core = fromGoogle(master, (s) => s);
    if (core && !core.allDay) {
      const start = parse(core.start);
      start.setMinutes(start.getMinutes() + (patch.shiftMin ?? 0));
      const dur =
        patch.durationMin ?? (parse(core.end).getTime() - parse(core.start).getTime()) / 60000;
      const end = new Date(start.getTime() + dur * 60000);
      body.start = gTime(toLocal(start), false);
      body.end = gTime(toLocal(end), false);
    }
  }
  await api<GEvent>('PATCH', path, { body });
  // 各回の内容が変わるので取り込み直す
  await pullSeries(e.calendarId, e.seriesId);
}

export async function deleteGoogleSeries(calendarId: string, seriesId: string): Promise<void> {
  await removeRemote(calendarId, seriesId);
}
