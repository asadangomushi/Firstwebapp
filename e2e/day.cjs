// 一日の画面の操作を確かめる
const { chromium } = require('playwright');
const assert = (c, m) => {
  if (!c) {
    console.log('FAIL: ' + m);
    process.exitCode = 1;
  } else console.log('ok: ' + m);
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
  await page.goto('http://localhost:5173/#/month');
  await page.waitForFunction(() => window.__techo);
  // 何曜日に走らせても同じになるよう、今日の予定をここで用意する
  const t = await page.evaluate(async () => {
    const { store, date } = window.__techo;
    const d = date.today();
    await store.createEvent({
      title: '数学',
      start: `${d}T09:00`,
      end: `${d}T10:30`,
      allDay: false,
    });
    await store.createEvent({
      title: '英語',
      start: `${d}T13:00`,
      end: `${d}T14:30`,
      allDay: false,
    });
    return d;
  });
  await page.goto(`http://localhost:5173/#/day/${t}`);
  await page.waitForSelector('.plan-col .block');
  await page.evaluate(() => {
    document.querySelector('.tg-scroll').scrollTop = 8 * 48;
  });
  const actualCount = () => page.locator('.actual-col .block').count();
  assert((await actualCount()) === 0, '最初は実績なし');

  // 予定「数学」を実績にコピー
  await page.locator('.plan-col .block', { hasText: '数学' }).locator('.copy-btn').click();
  await page.waitForSelector('.actual-col .block.sel');
  assert((await actualCount()) === 1, 'コピーで実績が1件できる');
  const a1 = await page.evaluate(
    async () =>
      (await window.__techo.db.actuals.toArray()).filter((a) =>
        a.start.startsWith(window.__techo.date.today()),
      )[0],
  );
  assert(
    a1.title === '数学' && a1.start.endsWith('T09:00') && a1.end.endsWith('T10:30'),
    `時刻と題名が同じ (${a1.start}–${a1.end})`,
  );
  assert(!!a1.categoryId, '種類（勉強）も引き継ぐ');
  assert(
    (await page.locator('.plan-col .copy-btn.done').count()) === 1,
    '予定側はコピー済みの印になる',
  );

  // 下の端をつまんで30分延ばす
  const h = page.locator('.actual-col .block.sel .handle.bottom');
  const hb = await h.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + 24, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const a2 = await page.evaluate(
    async () =>
      (await window.__techo.db.actuals.toArray()).filter((a) =>
        a.start.startsWith(window.__techo.date.today()),
      )[0],
  );
  assert(
    a2.end.endsWith('T11:00') && a2.start.endsWith('T09:00'),
    `下端ドラッグで終了が30分延びる (${a2.end})`,
  );

  // 真ん中をつまんで15分遅らせる
  const b = await page.locator('.actual-col .block.sel').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 12, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const a3 = await page.evaluate(
    async () =>
      (await window.__techo.db.actuals.toArray()).filter((a) =>
        a.start.startsWith(window.__techo.date.today()),
      )[0],
  );
  assert(
    a3.start.endsWith('T09:15') && a3.end.endsWith('T11:15'),
    `移動で開始・終了が15分ずれる (${a3.start}–${a3.end})`,
  );

  // 編集欄で題名と終了時刻を直す
  await page.locator('.actual-editor .ae-title').fill('数学（自習）');
  await page.locator('.actual-editor .ae-title').blur();
  await page.locator('.actual-editor input[aria-label="終了時刻"]').fill('10:45');
  await page.waitForTimeout(200);
  const a4 = await page.evaluate(
    async () =>
      (await window.__techo.db.actuals.toArray()).filter((a) =>
        a.start.startsWith(window.__techo.date.today()),
      )[0],
  );
  assert(
    a4.title === '数学（自習）' && a4.end.endsWith('T10:45'),
    `編集欄で直せる (${a4.title} ${a4.end})`,
  );
  await page.locator('.actual-editor button[aria-label="編集を終える"]').click();

  // 空いているところを押して実績を直接つくる
  const col = await page.locator('.actual-col').boundingBox();
  await page.mouse.click(col.x + col.width / 2, col.y + 12.5 * 48); // 12:30付近
  await page.waitForSelector('.actual-editor');
  assert((await actualCount()) === 2, '空いたところを押すと実績ができる');
  const a5 = await page.evaluate(
    async () =>
      (await window.__techo.db.actuals.orderBy('start').toArray()).filter((a) =>
        a.start.startsWith(window.__techo.date.today()),
      )[1],
  );
  assert(
    a5.start.endsWith('T12:30') && a5.end.endsWith('T13:30'),
    `押した位置の時刻になる (${a5.start}–${a5.end})`,
  );
  await page.locator('.actual-editor .ae-title').fill('昼食');
  await page.locator('.actual-editor select').selectOption({ label: '生活' });
  await page.waitForTimeout(200);

  // 全部コピー
  await page.locator('.actual-editor button[aria-label="編集を終える"]').click();
  await page.getByRole('button', { name: /全部コピー/ }).click();
  await page.waitForTimeout(300);
  assert((await actualCount()) === 3, '残りの予定（英語）もコピーされる');
  await page.screenshot({ path: 'e2e/shots/desk-day-today.png' });

  // 予定の列の空きを押すと作成ダイアログ
  const pc = await page.locator('.plan-col').boundingBox();
  await page.mouse.click(pc.x + pc.width / 2, pc.y + 16.2 * 48);
  await page.waitForSelector('.modal');
  const st = await page.locator('.modal input[aria-label="開始時刻"]').inputValue();
  assert(st === '16:00', `作成ダイアログに押した時刻が入る (${st})`);
  await page.locator('.modal .title-input').fill('英語の予習');
  await page.screenshot({ path: 'e2e/shots/desk-create.png' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForTimeout(300);
  const made = await page.evaluate(async () =>
    (await window.__techo.db.events.toArray()).find((e) => e.title === '英語の予習'),
  );
  assert(made && made.start.endsWith('T16:00') && made.end.endsWith('T17:00'), '予定が保存される');
  assert(
    (await page.locator('.plan-col .block', { hasText: '英語の予習' }).count()) === 1,
    '保存した予定が画面に出る（キーワードで勉強に分類）',
  );

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
})();
