// 本番ビルドで、オフライン動作と「共有」の受け取りを確かめる
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) { console.log('FAIL: ' + m); process.exitCode = 1; } else console.log('ok: ' + m); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('.month-grid');
  assert(await page.evaluate(() => !window.__techo), '本番ビルドには開発用の道具が入っていない');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);
  const cached = await page.evaluate(async () => (await (await caches.open('techo-app-v1')).keys()).map((r) => new URL(r.url).pathname));
  assert(cached.some((p) => p.endsWith('.js')) && cached.some((p) => p.endsWith('.css')), `アプリ本体を控えている (${cached.length}件)`);

  // 共有（PDF＋リンク）を受け取る
  const redirected = await page.evaluate(async () => {
    const fd = new FormData();
    fd.append('files', new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], '数学ノート 第5回.pdf', { type: 'application/pdf' }));
    fd.append('title', '課題の案内');
    fd.append('url', 'https://docs.google.com/document/d/abc123/edit');
    const res = await fetch('./share-target', { method: 'POST', body: fd });
    return res.url;
  });
  assert(redirected.endsWith('/'), `共有のあとアプリへ戻る (${redirected})`);
  await page.goto('http://localhost:4173/#/inbox');
  await page.reload();
  await page.waitForSelector('.page');
  await page.waitForFunction(() => document.querySelectorAll('.list-item').length >= 2);
  const names = await page.locator('.list-name').allTextContents();
  assert(names.includes('数学ノート 第5回.pdf'), `受信トレイにファイルが届く (${names.join(' / ')})`);
  assert(names.includes('課題の案内'), 'リンクも届く（共有の題名が名前になる）');
  await page.screenshot({ path: 'e2e/shots/mob-inbox.png' });

  // オフラインでも開ける
  await ctx.setOffline(true);
  await page.goto('http://localhost:4173/#/month');
  await page.reload();
  await page.waitForSelector('.month-grid', { timeout: 8000 });
  assert(true, 'オフラインで再読み込みしても開ける');
  await ctx.setOffline(false);
  console.log(errors.length ? errors.join('\n') : 'no page errors');
  await browser.close();
})();
