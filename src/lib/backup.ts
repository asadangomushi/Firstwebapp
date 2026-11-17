// バックアップ：端末の中のデータを1つのファイルに書き出す／読み込む。
// データはこのブラウザにしかないので、機種変更や万一のために使う。
import { db } from './db';
import { markTransaction } from './sync-hooks';
import type { FileRec } from './types';

interface StoredFile extends Omit<FileRec, 'blob'> {
  data: string;
}

interface Backup {
  app: 'techo';
  version: 1;
  exportedAt: string;
  events: unknown[];
  categories: unknown[];
  projects: unknown[];
  calendars: unknown[];
  series: unknown[];
  actuals: unknown[];
  diary: unknown[];
  files: StoredFile[];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('ファイルを読めませんでした'));
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

export async function exportBackup(): Promise<Blob> {
  const files = await db.files.toArray();
  const stored: StoredFile[] = [];
  for (const f of files) {
    const { blob, ...rest } = f;
    stored.push({ ...rest, data: await blobToDataUrl(blob) });
  }
  const backup: Backup = {
    app: 'techo',
    version: 1,
    exportedAt: new Date().toISOString(),
    events: await db.events.toArray(),
    categories: await db.categories.toArray(),
    projects: await db.projects.toArray(),
    calendars: await db.calendars.toArray(),
    series: await db.series.toArray(),
    actuals: await db.actuals.toArray(),
    diary: await db.diary.toArray(),
    files: stored,
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** バックアップで今のデータを置き換える */
export async function importBackup(file: Blob): Promise<void> {
  let parsed: Backup;
  try {
    parsed = JSON.parse(await file.text()) as Backup;
  } catch {
    throw new Error('ファイルを読み込めませんでした（手帳のバックアップではないようです）');
  }
  if (parsed.app !== 'techo' || !Array.isArray(parsed.events)) {
    throw new Error('手帳のバックアップファイルではありません');
  }
  const files: FileRec[] = [];
  for (const f of parsed.files ?? []) {
    const { data, ...rest } = f;
    files.push({ ...rest, blob: await dataUrlToBlob(data) });
  }
  const tables = [
    db.events,
    db.categories,
    db.projects,
    db.calendars,
    db.series,
    db.actuals,
    db.diary,
    db.files,
    db.tombstones,
    db.deleted,
  ];
  await db.transaction('rw', tables, async () => {
    // 復元は「消した」操作ではないので、ほかの端末に削除として伝えない
    markTransaction('quiet');
    for (const t of tables) await t.clear();
    // 形はバックアップを作ったときのものをそのまま戻す
    await db.events.bulkPut(parsed.events as never[]);
    await db.categories.bulkPut(parsed.categories as never[]);
    await db.projects.bulkPut(parsed.projects as never[]);
    await db.calendars.bulkPut(parsed.calendars as never[]);
    await db.series.bulkPut((parsed.series ?? []) as never[]);
    await db.actuals.bulkPut((parsed.actuals ?? []) as never[]);
    await db.diary.bulkPut((parsed.diary ?? []) as never[]);
    await db.files.bulkPut(files);
  });
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
