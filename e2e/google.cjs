// Googleカレンダー連携を、Google側を差し替えて確かめる（本物のGoogleには触れない）
const { chromium } = require('playwright');
const assert = (c, m) => {
  if (!c) {
    console.log('FAIL: ' + m);
    process.exitCode = 1;
  } else console.log('ok: ' + m);
};
const pad = (n) => String(n).padStart(2, '0');
const until = async (page, fn, arg) => {
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(fn, arg)) return;
    await page.waitForTimeout(100);
  }
  throw new Error('timeout: ' + fn);
};
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.google = { accounts: { oauth2: {
      initTokenClient: (cfg) => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'tok-1', expires_in: 3600 }), 20) }),
      revoke: () => {} } } };`,
    }),
  );

  // Google側のデータ（テスト用）
  const now = new Date();
  const day = (off) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const iso = (off, hm) => `${day(off)}T${hm}:00+09:00`;
  let remote = [
    ...[-7, 0, 7, 14].map((off) => ({
      id: `cls_${day(off).replace(/-/g, '')}`,
      recurringEventId: 'cls',
      summary: '線形代数',
      start: { dateTime: iso(off, '10:40') },
      end: { dateTime: iso(off, '12:10') },
    })),
    {
      id: 'single1',
      summary: '歓迎会',
      location: '駅前',
      description: '<b>会費</b> 3000円<br>19時集合',
      start: { dateTime: iso(2, '19:00') },
      end: { dateTime: iso(2, '21:00') },
      attachments: [
        { fileUrl: 'https://drive.google.com/file/d/xyz/view', title: 'お店の地図.pdf' },
      ],
    },
    { id: 'allday1', summary: '文化祭', start: { date: day(5) }, end: { date: day(7) } },
    {
      id: 'gone1',
      summary: 'あとで消える予定',
      start: { dateTime: iso(3, '09:00') },
      end: { dateTime: iso(3, '10:00') },
    },
    {
      id: 'gone2',
      summary: '消えるが詳細あり',
      start: { dateTime: iso(4, '09:00') },
      end: { dateTime: iso(4, '10:00') },
    },
  ];
  const calls = [];
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  };
  await page.route('https://www.googleapis.com/calendar/v3/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const path = decodeURIComponent(url.pathname.replace('/calendar/v3', ''));
    const body = req.postData() ? req.postDataJSON() : undefined;
    calls.push({
      method: req.method(),
      path,
      body,
      auth: req.headers()['authorization'],
      query: Object.fromEntries(url.searchParams),
    });
    const ok = (data) =>
      route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
    if (path === '/users/me/calendarList') {
      return ok({
        items: [
          {
            id: 'me@example.com',
            summary: 'me@example.com',
            summaryOverride: 'マイカレンダー',
            backgroundColor: '#039be5',
            accessRole: 'owner',
            primary: true,
            selected: true,
          },
          {
            id: 'ja.japanese#holiday@group.v.calendar.google.com',
            summary: '日本の祝日',
            backgroundColor: '#0b8043',
            accessRole: 'reader',
            selected: true,
          },
        ],
      });
    }
    if (req.method() === 'GET' && path === '/calendars/me@example.com/events')
      return ok({ items: remote });
    if (req.method() === 'GET' && path.endsWith('/events'))
      return ok({
        items: [
          { id: 'hol1', summary: '勤労感謝の日', start: { date: day(7) }, end: { date: day(8) } },
        ],
      });
    if (req.method() === 'POST' && path === '/calendars/me@example.com/events') {
      if (body.recurrence) {
        const made = { id: 'newseries', ...body };
        remote.push(
          ...[0, 7, 14].map((off) => ({
            id: `newseries_${off}`,
            recurringEventId: 'newseries',
            summary: body.summary,
            start: { dateTime: iso(1 + off, '08:00') },
            end: { dateTime: iso(1 + off, '08:30') },
          })),
        );
        return ok(made);
      }
      const made = { id: 'created1', ...body };
      remote.push(made);
      return ok(made);
    }
    if (req.method() === 'GET' && path === '/calendars/me@example.com/events/newseries/instances')
      return ok({ items: remote.filter((e) => e.recurringEventId === 'newseries') });
    if (req.method() === 'PATCH') {
      const id = path.split('/').pop();
      remote = remote.map((e) => (e.id === id ? { ...e, ...body } : e));
      return ok({ id, ...body });
    }
    if (req.method() === 'DELETE') {
      remote = remote.filter((e) => e.id !== path.split('/').pop());
      return route.fulfill({ status: 204, headers: cors });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });

  await page.goto('http://localhost:5173/#/settings');
  await page.waitForFunction(() => window.__techo);
  const field = page.locator('label.field', { hasText: 'クライアント ID' }).locator('input');
  await field.fill('1234-test.apps.googleusercontent.com');
  await field.blur();
  await page.getByRole('button', { name: 'Googleにログインして同期' }).click();
  await until(page, async () => (await window.__techo.db.events.count()) >= 9);
  const evs = () => page.evaluate(() => window.__techo.db.events.toArray());
  let all = await evs();
  assert(
    calls.every((c) => c.auth === 'Bearer tok-1'),
    'ログインして得た鍵を付けて呼ぶ',
  );
  const cls = all.filter((e) => e.seriesId === 'cls');
  assert(
    cls.length === 4 &&
      cls.every((e) => e.title === '線形代数' && e.start.endsWith('T10:40') && !e.allDay),
    '繰り返しの授業が各回ごとに入る（時刻は端末の時刻）',
  );
  const party = all.find((e) => e.googleId === 'single1');
  assert(
    party.location === '駅前' && party.memo === '会費 3000円\n19時集合',
    `説明文はふつうの文章になる (${JSON.stringify(party.memo)})`,
  );
  assert(
    party.links.length === 1 && party.links[0].url.includes('drive.google.com'),
    'Googleで添付したファイルがリンクとして入る',
  );
  const fes = all.find((e) => e.googleId === 'allday1');
  assert(fes.allDay && fes.start === day(5) && fes.end === day(7), '終日の予定');
  const cals = await page.evaluate(() => window.__techo.db.calendars.toArray());
  assert(
    cals.find((c) => c.id === 'me@example.com').writable &&
      !cals.find((c) => c.id.includes('holiday')).writable,
    'カレンダーの書き込み可否',
  );
  const q = calls.find((c) => c.path === '/calendars/me@example.com/events').query;
  assert(q.singleEvents === 'true' && q.timeMin && q.timeMax, '期間を区切って取り込む');

  // 月表示：毎週の授業は隠れ、特別な予定だけが出る
  await page.goto('http://localhost:5173/#/month');
  await page.waitForSelector('.mweek-events .chip');
  const chips = await page.locator('.mweek-events .chip .chip-title').allTextContents();
  assert(
    !chips.includes('線形代数') && chips.includes('歓迎会') && chips.includes('文化祭'),
    `月表示は特別な予定のみ (${[...new Set(chips)].join('、')})`,
  );

  // 詳細を書き足す → Googleへは送らない
  await page.evaluate(async () => {
    const { db, store } = window.__techo;
    const e = (await db.events.toArray()).find((x) => x.googleId === 'gone2');
    await store.updateEvent(e.id, { belongings: [{ id: 'b', text: '学生証', done: false }] });
  });
  const n0 = calls.length;
  await page.waitForTimeout(1800);
  assert(calls.length === n0, '持ち物などの書き足しはGoogleへ送らない');

  // 題名を変える → 変えた項目だけ送る
  await page.evaluate(async () => {
    const { db, store } = window.__techo;
    const e = (await db.events.toArray()).find((x) => x.googleId === 'single1');
    await store.updateEvent(e.id, { title: '歓迎会（新入生）' });
  });
  await page.waitForTimeout(1800);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert(
    patch &&
      patch.path.endsWith('/events/single1') &&
      JSON.stringify(patch.body) === JSON.stringify({ summary: '歓迎会（新入生）' }),
    `変えた項目だけ送る (${JSON.stringify(patch?.body)})`,
  );

  // 手帳で作る → Googleにも作られる
  await page.evaluate(async (d) => {
    const { store } = window.__techo;
    await store.createEvent({
      title: '図書館で自習',
      start: `${d}T14:00`,
      end: `${d}T16:00`,
      allDay: false,
      calendarId: 'me@example.com',
    });
  }, day(1));
  await page.waitForTimeout(1800);
  const post = calls.find((c) => c.method === 'POST' && !c.body.recurrence);
  assert(
    post &&
      post.body.summary === '図書館で自習' &&
      post.body.start.dateTime.startsWith(
        new Date(`${day(1)}T14:00:00+09:00`).toISOString().slice(0, 16),
      ) &&
      post.body.start.timeZone === 'Asia/Tokyo',
    `Googleに作られる (${post?.body.start.dateTime})`,
  );
  all = await evs();
  const mine = all.find((e) => e.title === '図書館で自習');
  assert(mine.googleId === 'created1' && !mine.sync, '作った予定にGoogleのIDが付く');

  // 繰り返しの予定を作る
  const made = await page.evaluate(async (d) => {
    const { store } = window.__techo;
    const e = await store.createEvent(
      {
        title: '朝の英単語',
        start: `${d}T08:00`,
        end: `${d}T08:30`,
        allDay: false,
        calendarId: 'me@example.com',
        categoryId: undefined,
      },
      { freq: 'weekly', until: '2099-01-01' },
    );
    return e;
  }, day(1));
  const rpost = calls.find((c) => c.method === 'POST' && c.body.recurrence);
  assert(
    rpost && /^RRULE:FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z$/.test(rpost.body.recurrence[0]),
    `繰り返しはGoogleの繰り返し予定として作る (${rpost?.body.recurrence})`,
  );
  all = await evs();
  assert(
    all.filter((e) => e.seriesId === 'newseries').length === 3 && made.seriesId === 'newseries',
    '各回が手帳に入る',
  );

  // 削除 → Googleからも消える
  await page.evaluate(async (id) => window.__techo.store.deleteEvent(id), mine.id);
  await page.waitForTimeout(1800);
  assert(
    calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/events/created1')),
    '手帳で消すとGoogleからも消す',
  );

  // Google側で消えた予定：詳細がなければ消え、あれば手帳に残る
  remote = remote.filter((e) => e.id !== 'gone1' && e.id !== 'gone2');
  await page.getByRole('button', { name: /Googleカレンダーと同期/ }).click();
  await until(
    page,
    async () => !(await window.__techo.db.events.toArray()).some((e) => e.googleId === 'gone1'),
  );
  all = await evs();
  const kept = all.find((e) => e.title === '消えるが詳細あり');
  assert(
    kept && kept.calendarId === 'local' && !kept.googleId && kept.belongings.length === 1,
    '書き足した情報のある予定は、手帳に残す',
  );
  assert(
    all.find((e) => e.googleId === 'single1').title === '歓迎会（新入生）',
    '同期しても手元の変更は保たれる',
  );

  await page.goto('http://localhost:5173/#/week');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/shots/desk-google-week.png' });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
})();
