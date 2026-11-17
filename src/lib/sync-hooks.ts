// 端末間の同期のための見張り。データベースへの書き込みをすべて見張り、
// ・変更したものに「最後に変更した時刻（updatedAt）」を付ける
// ・消したものを「消した記録」に残す
// ・変更があったことを知らせる（少し待ってからドライブと同期するため）
// 書き込みの経路が多い（画面の操作、Googleからの取り込み、AIの操作…）ので、
// 一つひとつに書き足すのではなく、データベースの手前で一括して拾う。
import Dexie, { type Transaction } from 'dexie';
import { db } from './db';
import { deletionKey } from './syncmerge';
import type { Deletion, SyncTable } from './types';

/**
 * 書き込みの種類。db.transaction の中で markTransaction() を呼んで付ける。
 * - quiet：同期で受け取った内容を書き戻すときなど。何も記録しない
 * - keepTime：Googleカレンダーからの取り込みなど。変更時刻は動かさない
 *   （各端末がそれぞれGoogleから取り込むので、ほかの端末の書き足しを上書きしないように）
 *   消したものは記録する
 */
export type WriteMode = 'quiet' | 'keepTime';

const modes = new WeakMap<Transaction, WriteMode>();

export function markTransaction(mode: WriteMode): void {
  const t = Dexie.currentTransaction;
  if (t) modes.set(t, mode);
}

function modeOf(t: Transaction | undefined): WriteMode | undefined {
  for (let x = t; x; x = x.parent) {
    const m = modes.get(x);
    if (m) return m;
  }
  return undefined;
}

function rootOf(t: Transaction): Transaction {
  let x = t;
  while (x.parent) x = x.parent;
  return x;
}

// ---- 変更の知らせ ----

const listeners = new Set<() => void>();

/** 利用者の操作でデータが変わったら呼ばれる */
export function onLocalChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

interface Pending {
  deletions: Deletion[];
  notify: boolean;
}

const pending = new WeakMap<Transaction, Pending>();

function note(t: Transaction, notify: boolean, deletion?: Deletion): void {
  const root = rootOf(t);
  let p = pending.get(root);
  if (!p) {
    p = { deletions: [], notify: false };
    pending.set(root, p);
    // 書き込みが確定してから、消した記録を残し、変更を知らせる
    root.on('complete', () => {
      const done = pending.get(root);
      pending.delete(root);
      if (!done) return;
      const after = () => {
        if (done.notify) listeners.forEach((l) => l());
      };
      if (done.deletions.length) void db.deleted.bulkPut(done.deletions).then(after, after);
      else after();
    });
    root.on('abort', () => pending.delete(root));
  }
  if (notify) p.notify = true;
  if (deletion) p.deletions.push(deletion);
}

// ---- 見張りを付ける ----

const WATCHED: SyncTable[] = [
  'events',
  'categories',
  'projects',
  'series',
  'actuals',
  'diary',
  'files',
];

let installed = false;

export function installSyncHooks(): void {
  if (installed) return;
  installed = true;
  for (const name of WATCHED) {
    const table = db.table(name);

    table.hook('creating', (_key, obj: { updatedAt?: number }, trans) => {
      const mode = modeOf(trans);
      if (mode === 'quiet') return;
      if (mode !== 'keepTime' && typeof obj.updatedAt !== 'number') obj.updatedAt = Date.now();
      note(trans, mode !== 'keepTime');
    });

    table.hook('updating', (mods: { updatedAt?: unknown }, _key, _obj, trans) => {
      const mode = modeOf(trans);
      if (mode === 'quiet') return;
      note(trans, mode !== 'keepTime');
      // 呼び出し側が時刻を決めているときは、それを使う
      if (mode === 'keepTime' || typeof mods.updatedAt === 'number') return;
      return { updatedAt: Date.now() };
    });

    table.hook('deleting', (key, obj: { driveId?: string } | undefined, trans) => {
      const mode = modeOf(trans);
      if (mode === 'quiet') return;
      const id = String(key);
      note(trans, true, {
        key: deletionKey(name, id),
        table: name,
        id,
        at: Date.now(),
        ...(name === 'files' && obj?.driveId ? { driveId: obj.driveId } : {}),
      });
    });
  }
}
