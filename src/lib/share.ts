// ほかのアプリから「共有」で届いたものを受信トレイに取り込む。
// 受け取り自体はサービスワーカー（public/sw.js）が行い、ここではそれをデータベースへ移す。
import { useSyncExternalStore } from 'react';
import { db, newId } from './db';
import { linkLabel, normalizeUrl } from './links';

const SHARE_CACHE = 'techo-share';
const LINKS_KEY = 'techo.inboxLinks';

export interface InboxLink {
  id: string;
  label: string;
  url: string;
}

const listeners = new Set<() => void>();
let cache: InboxLink[] | null = null;

function read(): InboxLink[] {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(LINKS_KEY) ?? '[]') as InboxLink[];
    cache = Array.isArray(v) ? v : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: InboxLink[]): void {
  cache = next;
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(next));
  } catch {
    // 無視
  }
  listeners.forEach((l) => l());
}

export function useInboxLinks(): InboxLink[] {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, read);
}

export function removeInboxLink(id: string): void {
  write(read().filter((l) => l.id !== id));
}

/** 共有された文章からリンクを取り出す。1行目がURLでなければ、それを名前に使う。 */
export function linksFromText(text: string): Array<{ label: string; url: string }> {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const title = lines.find((l) => !/^https?:\/\//i.test(l));
  const urls = [...new Set(text.match(/https?:\/\/[^\s<>"']+/gi) ?? [])];
  const out: Array<{ label: string; url: string }> = [];
  for (const raw of urls) {
    const url = normalizeUrl(raw);
    if (url)
      out.push({ label: title && urls.length === 1 ? title.slice(0, 80) : linkLabel(url), url });
  }
  return out;
}

/** 預かっている共有物を取り込み、取り込んだ件数を返す */
export async function importShared(): Promise<number> {
  if (!('caches' in window)) return 0;
  let count = 0;
  try {
    const store = await caches.open(SHARE_CACHE);
    for (const req of await store.keys()) {
      const res = await store.match(req);
      if (res) {
        if (res.headers.get('x-kind') === 'text') {
          const links = linksFromText(await res.text());
          if (links.length) {
            write([...read(), ...links.map((l) => ({ ...l, id: newId() }))]);
            count += links.length;
          }
        } else {
          const blob = await res.blob();
          await db.files.add({
            id: newId(),
            eventId: '',
            kind: 'material',
            name: decodeURIComponent(res.headers.get('x-name') ?? '') || 'ファイル',
            mime: blob.type || 'application/octet-stream',
            size: blob.size,
            blob,
            createdAt: Date.now(),
          });
          count++;
        }
      }
      await store.delete(req);
    }
  } catch {
    // 取り込めなくても、アプリは使えるようにする
  }
  return count;
}

/** オフラインでも開けるよう、サービスワーカーを登録する（本番のビルドだけ） */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // いま読み込んだファイルを控えてもらう
        const urls = [
          location.href.split('#')[0],
          ...performance.getEntriesByType('resource').map((r) => r.name),
        ];
        reg.active?.postMessage({ type: 'warm', urls });
      })
      .catch(() => undefined);
  });
}
