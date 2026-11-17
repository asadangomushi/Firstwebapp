// 2台の端末（別々のブラウザ）を、偽のGoogleドライブ・カレンダーでつないで、
// 同期がうまくいくかを確かめる（本物のGoogleには何も送らない）。
const { chromium } = require('playwright');
const assert = (c, m) => {
  if (!c) {
    console.log('FAIL: ' + m);
    process.exitCode = 1;
  } else console.log('ok: ' + m);
};
const BASE = 'http://localhost:5173';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

// ---- 偽のGoogle（2台で共有する） ----
const drive = new Map(); // id → { name, mime, content: Buffer, modifiedTime }
let driveSeq = 0;
const driveCalls = [];
const pad = (n) => String(n).padStart(2, '0');
const day = (off) => {
  const d = new Date();
  d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const G1 = {
  id: 'G1',
  summary: '線形代数の試験',
  start: { dateTime: `${day(3)}T10:00:00+09:00` },
  end: { dateTime: `${day(3)}T11:30:00+09:00` },
};

function parseMultipart(buf, contentType) {
  const boundary = /boundary=([^;]+)/.exec(contentType)[1];
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let idx = buf.indexOf(sep);
  while (idx !== -1) {
    const start = idx + sep.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(sep, start);
    const part = buf.slice(start + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    parts.push({ headers: part.slice(0, headerEnd).toString(), body: part.slice(headerEnd + 4) });
    idx = next;
  }
  return parts;
}

async function fakeGoogle(page) {
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.google = { accounts: { oauth2: {
        initTokenClient: (cfg) => ({ requestAccessToken: () => setTimeout(() =>
          cfg.callback({ access_token: 'tok', expires_in: 3600, scope: cfg.scope }), 20) }),
        revoke: () => {} } } };`,
    }),
  );
  await page.route('https://www.googleapis.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const json = (status, body) =>
      route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const p = url.pathname;

    // カレンダー
    if (p === '/calendar/v3/users/me/calendarList') {
      return json(200, {
        items: [
          {
            id: 'me@example.com',
            summary: 'me',
            backgroundColor: '#039be5',
            accessRole: 'owner',
            primary: true,
          },
        ],
      });
    }
    if (p.startsWith('/calendar/v3/calendars/') && req.method() === 'GET')
      return json(200, { items: [G1] });
    if (p.startsWith('/calendar/v3/')) return json(200, { id: 'x' });

    // ドライブ
    driveCalls.push(`${req.method()} ${p}`);
    if (p === '/drive/v3/files' && req.method() === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const name = /name='([^']+)'/.exec(q)?.[1];
      const files = [...drive.entries()]
        .filter(([, f]) => !name || f.name === name)
        .sort((a, b) => b[1].modifiedTime - a[1].modifiedTime)
        .map(([id, f]) => ({ id, modifiedTime: new Date(f.modifiedTime).toISOString() }));
      return json(200, { files });
    }
    if (p.startsWith('/drive/v3/files/')) {
      const id = decodeURIComponent(p.split('/').pop());
      const f = drive.get(id);
      if (req.method() === 'DELETE') {
        drive.delete(id);
        return route.fulfill({ status: 204, headers: cors });
      }
      if (!f) return json(404, { error: { code: 404, message: 'not found' } });
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': f.mime },
        body: f.content,
      });
    }
    if (p === '/upload/drive/v3/files' && req.method() === 'POST') {
      const [meta, content] = parseMultipart(req.postDataBuffer(), req.headers()['content-type']);
      const m = JSON.parse(meta.body.toString());
      const id = `d${++driveSeq}`;
      drive.set(id, {
        name: m.name,
        mime: m.mimeType,
        content: content.body,
        modifiedTime: Date.now(),
      });
      return json(200, { id });
    }
    if (p.startsWith('/upload/drive/v3/files/') && req.method() === 'PATCH') {
      const id = decodeURIComponent(p.split('/').pop());
      const f = drive.get(id);
      f.content = req.postDataBuffer();
      f.modifiedTime = Date.now();
      return json(200, { id });
    }
    return json(404, { error: { code: 404, message: `no mock for ${req.method()} ${p}` } });
  });
}

const snapshot = () => {
  const f = [...drive.values()].find((x) => x.name === 'techo-sync.json');
  return f ? JSON.parse(f.content.toString()) : null;
};

async function waitFor(fn, what, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout: ${what}`);
}

async function device(browser, name, errors) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`[${name}] ${m.text()}`);
  });
  await fakeGoogle(page);
  await page.goto(`${BASE}/#/settings`);
  await page.waitForFunction(() => window.__techo);
  await page.waitForSelector('.settings');
  return { ctx, page };
}

async function turnOnSync(page) {
  const field = page.locator('label.field', { hasText: 'クライアント ID' }).locator('input');
  await field.fill('1234-test.apps.googleusercontent.com');
  await field.blur();
  await page.getByLabel('ドライブで同期する').click();
  await page.getByRole('button', { name: '同期を始める' }).click();
}

const q = (page, fn, arg) => page.evaluate(fn, arg);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const A = await device(browser, 'A', errors);
  const B = await device(browser, 'B', errors);

  // ---- B：同期を始める前から、Googleの同じ予定を古いやり方（ランダムなID）で取り込んで書き足していた ----
  await q(B.page, async () => {
    const { db } = window.__techo;
    await db.calendars.put({
      id: 'me@example.com',
      name: 'me',
      color: 'blue',
      visible: true,
      source: 'google',
      writable: true,
    });
  });
  await q(
    B.page,
    async (start) => {
      const { db } = window.__techo;
      await db.events.put({
        id: 'legacy-random-id',
        title: '線形代数の試験',
        start,
        end: start.slice(0, 11) + '11:30',
        allDay: false,
        calendarId: 'me@example.com',
        googleId: 'G1',
        location: '',
        memo: '',
        kind: 'normal',
        links: [],
        belongings: [],
        submissions: [{ id: 's1', text: 'レポート', done: false }],
        relatedIds: [],
        createdAt: 1000,
        updatedAt: 2000,
      });
    },
    `${day(3)}T10:00`,
  );

  // ---- A：同期を始めて、いろいろ書く ----
  await turnOnSync(A.page);
  await waitFor(() => snapshot(), 'Aが最初の同期ファイルを作る');
  assert(
    snapshot().events.some((e) => e.id === 'g.me@example.com.G1'),
    'Googleの予定は、どの端末でも同じIDで取り込む',
  );

  const ids = await q(A.page, async () => {
    const { db, store, date } = window.__techo;
    const t = date.today();
    const g1 = 'g.me@example.com.G1';
    await store.updateEvent(g1, {
      links: [{ id: 'l1', label: '範囲', url: 'https://example.com/scope' }],
    });
    const mine = await store.createEvent({
      title: 'Aで作った予定',
      start: `${t}T15:00`,
      end: `${t}T16:00`,
      allDay: false,
    });
    await store.updateEvent(mine.id, { belongings: [{ id: 'b1', text: '電卓', done: false }] });
    await store.addActual({
      start: `${t}T09:00`,
      end: `${t}T10:00`,
      title: '自習',
      memo: '',
      eventId: g1,
    });
    await store.saveDiary(t, { text: 'Aで書いた日記', mood: '🙂' });
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 1, 2, 3]);
    await store.addFiles(g1, 'note', [
      new File([bytes], 'ノート.pdf', { type: 'application/pdf' }),
    ]);
    return { mine: mine.id, g1 };
  });
  await waitFor(
    () => (snapshot()?.files ?? []).some((f) => f.driveId) && snapshot().diary.length === 1,
    '書いた内容が数秒後に自動でドライブへ送られる',
  );
  assert(true, '書いた内容が数秒後に自動でドライブへ送られる');
  assert(
    [...drive.values()].some((f) => f.name.startsWith('file-') && f.content.length === 12),
    'ファイルの中身もドライブに置かれる',
  );
  assert(
    !JSON.stringify(snapshot()).includes('"sync"'),
    'Googleへの送信待ちの印は、ドライブに置かない',
  );

  // ---- B：同期を始める ----
  await turnOnSync(B.page);
  await waitFor(
    () => q(B.page, async () => (await window.__techo.db.files.count()) === 1),
    'Bがファイルの中身まで受け取る',
  );
  const b = await q(B.page, async () => {
    const { db } = window.__techo;
    const events = await db.events.toArray();
    const g = events.filter((e) => e.googleId === 'G1');
    const file = (await db.files.toArray())[0];
    return {
      g1count: g.length,
      g1: g[0],
      hasMine: events.some((e) => e.title === 'Aで作った予定' && e.belongings.length === 1),
      actual: (await db.actuals.toArray())[0],
      diary: (await db.diary.toArray())[0],
      file: file && {
        eventId: file.eventId,
        bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())),
      },
      cats: (await db.categories.toArray()).map((c) => c.name),
    };
  });
  assert(b.g1count === 1, `Googleの同じ予定は1つにまとまる (${b.g1count}件)`);
  assert(
    b.g1.links.length === 1 && b.g1.submissions.length === 1,
    '両方の端末で書き足した情報（Aのリンク、Bの提出物）がどちらも残る',
  );
  assert(b.hasMine, 'Aで作った予定と持ち物が届く');
  assert(
    b.actual && b.actual.eventId === b.g1.id,
    `実績が届き、まとめた予定を指している (${b.actual?.eventId})`,
  );
  assert(b.diary && b.diary.text === 'Aで書いた日記', '日記が届く');
  assert(
    b.file && b.file.eventId === b.g1.id && b.file.bytes.length === 12 && b.file.bytes[0] === 37,
    'ファイルが中身ごと届き、まとめた予定につながっている',
  );
  assert(
    new Set(b.cats).size === b.cats.length && b.cats.length === 7,
    `予定の種類は二重にならない (${b.cats.length}件)`,
  );

  // ---- A：もう一度同期すると、Bでまとめた結果を受け取る ----
  await q(A.page, () => window.__techo.google.syncNow());
  const a = await q(A.page, async () => {
    const { db } = window.__techo;
    const g = (await db.events.toArray()).filter((e) => e.googleId === 'G1');
    return {
      count: g.length,
      g1: g[0],
      actual: (await db.actuals.toArray())[0],
      file: (await db.files.toArray())[0],
    };
  });
  assert(
    a.count === 1 && a.g1.submissions.length === 1 && a.g1.links.length === 1,
    'Aでも1つにまとまり、Bの書き足しが届く',
  );
  assert(
    a.actual.eventId === a.g1.id && a.file.eventId === a.g1.id,
    'Aの実績とファイルも、残したほうの予定を指す',
  );

  // ---- 削除：Bで消すと、Aからも消える ----
  await q(B.page, async (id) => window.__techo.store.deleteEvent(id), ids.mine);
  await waitFor(
    () => (snapshot()?.deleted ?? []).some((d) => d.key === `events:${ids.mine}`),
    'Bで消したことがドライブに伝わる',
  );
  await q(A.page, () => window.__techo.google.syncNow());
  assert(
    !(await q(A.page, async (id) => !!(await window.__techo.db.events.get(id)), ids.mine)),
    'Bで消した予定は、Aからも消える',
  );

  // ---- 同じものを2台で直したら、あとから直したほうが残る ----
  await q(
    A.page,
    async (id) =>
      window.__techo.store.saveDiary(window.__techo.date.today(), { text: 'Aで直した' }),
    null,
  );
  await new Promise((r) => setTimeout(r, 50));
  await q(B.page, async () =>
    window.__techo.store.saveDiary(window.__techo.date.today(), { text: 'Bで直した（あと）' }),
  );
  await q(A.page, () => window.__techo.google.syncNow());
  await q(B.page, () => window.__techo.google.syncNow());
  await q(A.page, () => window.__techo.google.syncNow());
  const diaries = await Promise.all(
    [A, B].map((d) => q(d.page, async () => (await window.__techo.db.diary.toArray())[0].text)),
  );
  assert(
    diaries.every((t) => t === 'Bで直した（あと）'),
    `あとから直したほうが両方に残る (${diaries.join(' / ')})`,
  );

  // ---- ファイルを消すと、ドライブの中身も消える ----
  await q(A.page, async () => {
    const { db, store } = window.__techo;
    await store.removeFile((await db.files.toArray())[0].id);
  });
  await q(A.page, () => window.__techo.google.syncNow());
  assert(
    ![...drive.values()].some((f) => f.name.startsWith('file-')),
    'ファイルを消すと、ドライブの中身も消える',
  );
  await q(B.page, () => window.__techo.google.syncNow());
  assert((await q(B.page, () => window.__techo.db.files.count())) === 0, 'Bからもファイルが消える');

  // ---- 設定画面の表示 ----
  await B.page.reload();
  await B.page.waitForSelector('.settings');
  const status = await B.page.locator('.subsection .status-text').textContent();
  assert(status.startsWith('前回の同期：'), `前回の同期の時刻が出る (${status})`);
  await B.page.locator('.subsection').scrollIntoViewIfNeeded();
  await B.page.screenshot({ path: 'e2e/shots/desk-drive-settings.png' });

  assert(
    [...drive.values()].filter((f) => f.name === 'techo-sync.json').length === 1,
    '同期ファイルは1つだけ',
  );
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no unexpected errors');
  await browser.close();
})().catch((err) => {
  console.log('FAIL: ' + err.message);
  process.exit(1);
});
