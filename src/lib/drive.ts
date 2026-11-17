// Googleドライブを使った端末間の同期。
// ドライブの「このアプリ専用の見えない場所（appDataFolder）」に、手帳の中身を1つのファイルとして置く。
// 同期のたびに、ドライブの中身とこの端末の中身を1つにまとめ（syncmerge.ts）、両方に書き戻す。
// ファイル（PDFなど）の中身は、別のファイルとして同じ場所に置く。
import { db } from './db';
import { AuthError, authFetch } from './google';
import { markTransaction } from './sync-hooks';
import {
  TABLES,
  forUpload,
  keyOf,
  mergeSync,
  sameRecord,
  type FileMeta,
  type Snapshot,
  type SyncData,
} from './syncmerge';
import type { Deletion, FileRec, PlannerEvent } from './types';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SNAPSHOT_NAME = 'techo-sync.json';
const LAST_KEY = 'techo.lastDriveSync';

/** ドライブに置くファイルの大きさの上限。これより大きいファイルは、その端末だけに残す。 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** ドライブの準備ができていない（Google Cloud で Drive API が有効になっていない）とき */
export class DriveSetupError extends Error {}

interface DriveFile {
  id: string;
  modifiedTime?: string;
}

// ---- ドライブのAPI ----

async function check<T>(res: Response): Promise<T> {
  if (res.ok) {
    const text = res.status === 204 ? '' : await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  let message = '';
  let reasons = '';
  try {
    const j = (await res.json()) as {
      error?: { message?: string; errors?: unknown[]; details?: unknown[] };
    };
    message = j.error?.message ?? '';
    reasons = JSON.stringify([j.error?.errors ?? [], j.error?.details ?? []]);
  } catch {
    // 中身が読めなくても、状態コードで伝える
  }
  if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/.test(reasons)) {
    throw new DriveSetupError(
      'Google Drive API が有効になっていません。Google Cloud で「Google Drive API」を有効にしてから、もう一度同期してください。',
    );
  }
  if (res.status === 403 && /insufficientPermissions|SCOPE_INSUFFICIENT/.test(reasons)) {
    throw new AuthError(
      'ドライブを使う許可がありません。もう一度ログインして、ドライブへのアクセスを許可してください。',
    );
  }
  throw new Error(`Googleドライブのエラー (${res.status}) ${message}`.trim());
}

async function findSnapshots(): Promise<DriveFile[]> {
  const url = new URL(`${DRIVE}/files`);
  url.searchParams.set('spaces', 'appDataFolder');
  url.searchParams.set('q', `name='${SNAPSHOT_NAME}' and trashed=false`);
  url.searchParams.set('fields', 'files(id,modifiedTime)');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '10');
  const res = await check<{ files?: DriveFile[] }>(await authFetch(url));
  return res.files ?? [];
}

async function download(id: string): Promise<Response> {
  const res = await authFetch(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`);
  if (!res.ok) await check(res);
  return res;
}

/** このアプリ専用の場所に、ファイルを新しく作る */
async function create(name: string, content: Blob, mime: string): Promise<string> {
  const boundary = `techo${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: mime });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ]);
  const res = await authFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await check<{ id: string }>(res)).id;
}

async function overwrite(id: string, content: Blob, mime: string): Promise<void> {
  const res = await authFetch(
    `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id`,
    { method: 'PATCH', headers: { 'Content-Type': mime }, body: content },
  );
  await check(res);
}

async function remove(id: string): Promise<void> {
  const res = await authFetch(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  // すでに消えているものは、消せたものとみなす
  if (res.status === 404 || res.status === 410) return;
  await check(res);
}

// ---- 中身の読み書き ----

const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** 予定の形をそろえる（古い版で保存された項目の欠けを埋める） */
function normalizeEvent(e: PlannerEvent): PlannerEvent {
  return {
    ...e,
    links: list(e.links),
    belongings: list(e.belongings),
    submissions: list(e.submissions),
    relatedIds: list(e.relatedIds),
    location: e.location ?? '',
    memo: e.memo ?? '',
    kind: e.kind ?? 'normal',
  };
}

/** ドライブから読んだ中身を確かめる */
export function parseSnapshot(v: unknown): SyncData {
  const s = (v ?? {}) as Partial<Snapshot>;
  if (s.app !== 'techo')
    throw new Error('ドライブの同期ファイルが読めませんでした（手帳のファイルではありません）');
  if (s.format !== 1) {
    // 新しい版の手帳で保存された内容を、古い版で上書きして壊さないようにする
    throw new Error(
      'ドライブの同期ファイルは、新しい版の手帳で保存されています。この端末の手帳を開き直して、最新の版にしてください。',
    );
  }
  const hasId = (r: { id?: unknown }) => typeof r?.id === 'string';
  return {
    events: list<PlannerEvent>(s.events).filter(hasId).map(normalizeEvent),
    categories: list<SyncData['categories'][number]>(s.categories).filter(hasId),
    projects: list<SyncData['projects'][number]>(s.projects).filter(hasId),
    series: list<SyncData['series'][number]>(s.series).filter(hasId),
    actuals: list<SyncData['actuals'][number]>(s.actuals).filter(hasId),
    diary: list<SyncData['diary'][number]>(s.diary).filter((d) => typeof d?.date === 'string'),
    files: list<FileMeta>(s.files).filter(hasId),
    calendars: list<SyncData['calendars'][number]>(s.calendars).filter(hasId),
    deleted: list<Deletion>(s.deleted).filter((d) => typeof d?.key === 'string'),
  };
}

function withoutBlob(f: FileRec): FileMeta {
  const { blob: _blob, ...meta } = f;
  return meta;
}

/**
 * まとめた結果をこの端末に書き戻す。変わったものだけを書く。
 * ファイルは、中身をまだ受け取っていないものは書かない（あとで中身ごと受け取る）。
 */
async function applyLocally(remote: SyncData | null, now: number): Promise<SyncData> {
  const tables = [
    db.events,
    db.categories,
    db.projects,
    db.series,
    db.actuals,
    db.diary,
    db.files,
    db.calendars,
    db.deleted,
  ];
  return db.transaction('rw', tables, async () => {
    // ここで書くのは同期で受け取った内容なので、変更や削除として記録しない
    markTransaction('quiet');
    const local: SyncData = {
      events: await db.events.toArray(),
      categories: await db.categories.toArray(),
      projects: await db.projects.toArray(),
      series: await db.series.toArray(),
      actuals: await db.actuals.toArray(),
      diary: await db.diary.toArray(),
      files: (await db.files.toArray()).map(withoutBlob),
      calendars: await db.calendars.toArray(),
      deleted: await db.deleted.toArray(),
    };
    const merged = mergeSync(local, remote, now);

    for (const name of TABLES) {
      const table = db.table(name);
      const before = new Map((local[name] as object[]).map((r) => [keyOf(name, r), r]));
      const after = merged[name] as object[];
      const keep = new Set(after.map((r) => keyOf(name, r)));
      const puts = after.filter((r) => {
        const old = before.get(keyOf(name, r));
        return !old || !sameRecord(old, r);
      });
      const gone = [...before.keys()].filter((k) => !keep.has(k));
      if (puts.length) await table.bulkPut(puts);
      if (gone.length) await table.bulkDelete(gone);
    }

    // ファイル：情報だけが変わったもの（つなげる予定など）は書き戻し、消えたものは消す
    const files = new Map((await db.files.toArray()).map((f) => [f.id, f]));
    const keepFiles = new Set(merged.files.map((f) => f.id));
    for (const meta of merged.files) {
      const cur = files.get(meta.id);
      if (cur && !sameRecord(withoutBlob(cur), meta)) await db.files.put({ ...cur, ...meta });
    }
    const goneFiles = [...files.keys()].filter((id) => !keepFiles.has(id));
    if (goneFiles.length) await db.files.bulkDelete(goneFiles);

    // カレンダーは、この端末が知らないものだけ足す
    const knownCals = new Set(local.calendars.map((c) => c.id));
    const newCals = merged.calendars.filter((c) => !knownCals.has(c.id));
    if (newCals.length) await db.calendars.bulkPut(newCals);

    await db.deleted.clear();
    await db.deleted.bulkPut(merged.deleted);
    return merged;
  });
}

/** まだドライブに置いていないファイルの中身を置く */
async function uploadFiles(): Promise<void> {
  const pending = (await db.files.toArray()).filter((f) => !f.driveId && f.size <= MAX_FILE_BYTES);
  for (const f of pending) {
    const driveId = await create(`file-${f.id}`, f.blob, f.mime || 'application/octet-stream');
    await db.transaction('rw', db.files, async () => {
      markTransaction('quiet');
      const cur = await db.files.get(f.id);
      // 置いている間に消された場合は、置いた控えも片付ける
      if (!cur) {
        await remove(driveId).catch(() => undefined);
        return;
      }
      await db.files.update(f.id, { driveId, updatedAt: Date.now() });
    });
  }
}

/** ほかの端末で足されたファイルの中身を受け取る */
async function downloadFiles(files: FileMeta[]): Promise<void> {
  const have = new Set((await db.files.toArray()).map((f) => f.id));
  for (const meta of files) {
    if (have.has(meta.id) || !meta.driveId) continue;
    try {
      const blob = await (await download(meta.driveId)).blob();
      await db.transaction('rw', db.files, db.deleted, async () => {
        markTransaction('quiet');
        // 受け取っている間に消された場合は、足さない
        if (await db.deleted.get(`files:${meta.id}`)) return;
        await db.files.put({
          ...meta,
          blob: blob.type ? blob : new Blob([blob], { type: meta.mime }),
        });
      });
    } catch (err) {
      if (err instanceof AuthError || err instanceof DriveSetupError) throw err;
      // 1つ受け取れなくても、ほかは続ける（次の同期でもう一度試す）
    }
  }
}

/** 消したファイルの中身を、ドライブからも消す */
async function removeDeletedFiles(deleted: Deletion[]): Promise<Deletion[]> {
  const out: Deletion[] = [];
  let changed = false;
  for (const d of deleted) {
    if (d.table === 'files' && d.driveId) {
      try {
        await remove(d.driveId);
        const { driveId: _done, ...rest } = d;
        out.push(rest);
        changed = true;
        continue;
      } catch (err) {
        if (err instanceof AuthError || err instanceof DriveSetupError) throw err;
      }
    }
    out.push(d);
  }
  if (changed) {
    await db.transaction('rw', db.deleted, async () => {
      markTransaction('quiet');
      await db.deleted.bulkPut(out);
    });
  }
  return out;
}

// ---- 同期の流れ ----

export function lastDriveSync(): number {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * ドライブと同期する。
 * 1. ドライブの中身を読む  2. 新しいファイルの中身を置く  3. まとめてこの端末に書き戻す
 * 4. まとめた結果をドライブに置く  5. ほかの端末のファイルの中身を受け取る
 */
export async function driveSync(): Promise<void> {
  const now = Date.now();

  // 2台が同時に初めて同期すると、同期ファイルが2つできることがある。そのときは全部まとめる
  const found = await findSnapshots();
  let remote: SyncData | null = null;
  for (const f of found) {
    const data = parseSnapshot(await (await download(f.id)).json());
    remote = remote ? mergeSync(remote, data, now) : data;
  }

  await uploadFiles();
  const merged = await applyLocally(remote, now);
  const deleted = await removeDeletedFiles(merged.deleted);

  const snapshot: Snapshot = {
    app: 'techo',
    format: 1,
    savedAt: now,
    ...merged,
    events: merged.events.map(forUpload),
    deleted,
  };
  const body = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
  if (found.length) {
    await overwrite(found[0].id, body, 'application/json');
    for (const extra of found.slice(1)) await remove(extra.id);
  } else {
    await create(SNAPSHOT_NAME, body, 'application/json');
  }

  await downloadFiles(merged.files);
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch {
    // 無視
  }
}
