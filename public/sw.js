// サービスワーカー。
// 1) オフラインでも開けるように、アプリ本体を端末に控えておく。
// 2) ほかのアプリ（Samsung Notes・Gmailなど）からの「共有」を受け取る。
const APP_CACHE = 'techo-app-v1';
const SHARE_CACHE = 'techo-share';
// 同じ場所から配っているファイルなので、ヘッダーの違いは気にせずURLだけで照合する
const MATCH = { ignoreVary: true };

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('techo-app-') && k !== APP_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// 最初に開いたときに読み込んだファイルを控えておく（次からオフラインでも開ける）
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'warm' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      await Promise.all(
        data.urls
          .filter((u) => typeof u === 'string' && new URL(u, self.location.href).origin === self.location.origin)
          .map((u) => cache.add(u).catch(() => undefined)),
      );
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // GoogleやAnthropicへの通信には手を出さない
  if (url.origin !== self.location.origin) return;

  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    // 画面そのものは、つながるときは最新を取りにいき、だめなら控えを使う
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_CACHE);
        try {
          const fresh = await fetch(request);
          if (fresh.ok) cache.put(self.registration.scope, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(self.registration.scope, MATCH)) || Response.error();
        }
      })(),
    );
    return;
  }

  // それ以外（スクリプトや画像）は控えを優先し、なければ取りにいって控える
  event.respondWith(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      const hit = await cache.match(request, MATCH);
      if (hit) return hit;
      const fresh = await fetch(request);
      if (fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone());
      return fresh;
    })(),
  );
});

/** 共有されたファイルや文章をいったん預かり、アプリの「受信トレイ」へ案内する */
async function receiveShare(request) {
  const scope = self.registration.scope;
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const stamp = Date.now();
    let i = 0;
    for (const file of form.getAll('files')) {
      if (!(file instanceof File)) continue;
      await cache.put(
        new Request(`${scope}__shared/${stamp}-${i++}`),
        new Response(file, {
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-kind': 'file',
            'x-name': encodeURIComponent(file.name || 'ファイル'),
          },
        }),
      );
    }
    const text = ['title', 'text', 'url']
      .map((k) => form.get(k))
      .filter((v) => typeof v === 'string' && v.trim())
      .join('\n');
    if (text) {
      await cache.put(
        new Request(`${scope}__shared/${stamp}-text`),
        new Response(text, {
          headers: { 'content-type': 'text/plain; charset=utf-8', 'x-kind': 'text' },
        }),
      );
    }
  } catch {
    // 受け取りに失敗しても、アプリは開く
  }
  return Response.redirect(`${scope}#/inbox`, 303);
}
