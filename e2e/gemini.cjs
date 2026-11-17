// Geminiとの会話を、APIを差し替えて確かめる（本物のAPIは呼ばない）
const { chromium } = require('playwright');
const assert = (c, m) => {
  if (!c) {
    console.log('FAIL: ' + m);
    process.exitCode = 1;
  } else console.log('ok: ' + m);
};
const reply = (parts, finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts }, finishReason, index: 0 }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
});

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

  const calls = [];
  let script = [];
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  };
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const json = (status, body) =>
      route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    if (req.method() === 'GET' && url.pathname.endsWith('/models')) {
      return json(200, {
        models: [
          { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.8-flash-lite', supportedGenerationMethods: ['generateContent'] },
          {
            name: 'models/gemini-3.8-flash-image',
            supportedGenerationMethods: ['generateContent'],
          },
          { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
        ],
      });
    }
    calls.push({ path: url.pathname, headers: req.headers(), body: req.postDataJSON() });
    const next = script.shift();
    if (!next) return json(500, { error: { code: 500, message: 'no script', status: 'INTERNAL' } });
    if (next.status) return json(next.status, next.body);
    return json(200, next);
  });

  await page.goto('http://localhost:5173/#/month');
  await page.waitForFunction(() => window.__techo);
  await page.waitForSelector('.month-grid');
  await page.evaluate(() =>
    localStorage.setItem(
      'techo.settings',
      JSON.stringify({ aiProvider: 'gemini', geminiApiKey: 'AIza-test-key' }),
    ),
  );
  await page.reload();
  await page.waitForFunction(() => window.__techo);
  const tomorrow = await page.evaluate(() =>
    window.__techo.date.addDays(window.__techo.date.today(), 1),
  );
  const said = (text) =>
    page.waitForFunction(
      (t) =>
        [...document.querySelectorAll('.msg.assistant .msg-text')].some((n) =>
          n.textContent.includes(t),
        ),
      text,
    );

  // 1) 予定を追加
  script = [
    reply([
      {
        functionCall: {
          id: 'fc_1',
          name: 'create_event',
          args: { title: '歯医者', start: `${tomorrow}T15:00`, end: `${tomorrow}T15:45` },
        },
        thoughtSignature: 'c2lnbmF0dXJlLTE=',
      },
    ]),
    reply([{ text: '明日の15時に「歯医者」を追加しました。' }]),
  ];
  await page.getByRole('button', { name: 'Geminiに頼む' }).click();
  await page.locator('.chat-form textarea').fill('明日の15時に歯医者を追加して');
  await page.locator('.chat-form textarea').press('Enter');
  await said('追加しました');
  const made = await page.evaluate(async () =>
    (await window.__techo.db.events.toArray())
      .filter((e) => e.title === '歯医者')
      .map((e) => [e.start, e.end]),
  );
  assert(
    made.some(([s, e]) => s === `${tomorrow}T15:00` && e === `${tomorrow}T15:45`),
    '予定が作られる',
  );
  assert(
    (await page.locator('.chat-head h2').textContent()) === 'Gemini',
    '会話の画面はGeminiの名前になる',
  );
  assert((await page.locator('.msg-actions li').count()) === 1, 'やったことがチャットに出る');
  assert(calls.length === 2, `APIを2回呼ぶ (${calls.length})`);
  const c0 = calls[0];
  assert(
    c0.path.endsWith('/models/gemini-3.8-flash:generateContent') &&
      c0.headers['x-goog-api-key'] === 'AIza-test-key',
    `モデルとAPIキー (${c0.path})`,
  );
  const decls = c0.body.tools[0].functionDeclarations;
  assert(decls.length === 11, `道具11個 (${decls.length})`);
  const ce = decls.find((d) => d.name === 'create_event').parametersJsonSchema;
  const flat = JSON.stringify(ce);
  assert(
    ce.type === 'object' &&
      ce.required.includes('title') &&
      ce.properties.repeat.properties.freq.enum.length === 3 &&
      !/\$schema|pattern|minLength|additionalProperties/.test(flat),
    '道具の入力の形は素朴なJSON Schemaにして渡す',
  );
  assert(
    JSON.stringify(c0.body.systemInstruction).includes('手帳') &&
      c0.body.contents.at(-1).parts.some((p) => p.text.includes('現在の日時')),
    '前提と現在の日時を渡す',
  );
  const back = calls[1].body.contents;
  const modelTurn = back.at(-2);
  const fr = back.at(-1).parts[0].functionResponse;
  assert(
    modelTurn.role === 'model' && modelTurn.parts[0].thoughtSignature === 'c2lnbmF0dXJlLTE=',
    'Geminiの返事は署名ごとそのまま戻す',
  );
  assert(
    fr.id === 'fc_1' && fr.name === 'create_event' && fr.response.output.ok === true,
    '道具の結果を、呼び出しのidを付けて返す',
  );

  // 2) 削除は確認を出す（キャンセルしたら消さない）
  const id = await page.evaluate(
    async (tm) =>
      (await window.__techo.db.events.toArray()).find(
        (e) => e.title === '歯医者' && e.start.startsWith(tm),
      ).id,
    tomorrow,
  );
  script = [
    reply([{ functionCall: { name: 'delete_event', args: { id } } }]),
    reply([{ text: '削除は取りやめました。' }]),
  ];
  await page.locator('.chat-form textarea').fill('やっぱり消して');
  await page.locator('.chat-form textarea').press('Enter');
  await page.waitForSelector('.modal');
  assert(
    (await page.locator('.modal h2').textContent()).startsWith('Geminiが予定を削除'),
    '削除の前に確認が出る',
  );
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await said('取りやめました');
  assert(
    await page.evaluate(async (i) => !!(await window.__techo.db.events.get(i)), id),
    'キャンセルしたら消えない',
  );
  const fr2 = calls[3].body.contents.at(-1).parts[0].functionResponse;
  assert(
    !('id' in fr2) && JSON.stringify(fr2.response).includes('取りやめ'),
    'キャンセルしたことがGeminiに伝わる（idが無い呼び出しにはidを付けない）',
  );
  assert(
    calls[2].body.contents.length === 5,
    `会話の履歴を引き継ぐ (${calls[2].body.contents.length})`,
  );

  // 3) 入力が正しくない呼び出しは実行しない
  script = [
    reply([
      { functionCall: { id: 'fc_3', name: 'create_event', args: { title: '', start: 'あした' } } },
    ]),
    reply([{ text: '日時を確認させてください。' }]),
  ];
  const before = await page.evaluate(() => window.__techo.db.events.count());
  await page.locator('.chat-form textarea').fill('なにか追加');
  await page.locator('.chat-form textarea').press('Enter');
  await said('確認させて');
  assert(
    (await page.evaluate(() => window.__techo.db.events.count())) === before,
    '不正な入力では予定を作らない',
  );
  assert(
    typeof calls[5].body.contents.at(-1).parts[0].functionResponse.response.error === 'string',
    '検証エラーとして返る',
  );

  // 4) 無料枠の上限に達したとき
  script = [
    {
      status: 429,
      body: {
        error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED' },
      },
    },
  ];
  await page.locator('.chat-form textarea').fill('今日の予定は？');
  await page.locator('.chat-form textarea').press('Enter');
  await page.waitForSelector('.msg.error');
  const errText = await page.locator('.msg.error .msg-text').last().textContent();
  assert(errText.includes('上限'), `回数の上限を分かる言葉で伝える (${errText})`);
  await page.screenshot({ path: 'e2e/shots/desk-gemini-chat.png' });

  // 5) 設定画面：モデルの一覧を取得して選べる
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.goto('http://localhost:5173/#/settings');
  await page.getByRole('button', { name: 'モデルの一覧を取得' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('select[aria-label="Geminiのモデル"] option').length >= 2,
  );
  const opts = await page.locator('select[aria-label="Geminiのモデル"] option').allTextContents();
  assert(
    opts.join() === 'gemini-3.8-flash-lite,gemini-3.8-flash',
    `文章用のモデルだけが選択肢に出る (${opts.join()})`,
  );
  await page.locator('select[aria-label="Geminiのモデル"]').selectOption('gemini-3.8-flash-lite');
  assert(
    (await page.evaluate(() => JSON.parse(localStorage.getItem('techo.settings')).geminiModel)) ===
      'gemini-3.8-flash-lite',
    '選んだモデルが保存される',
  );
  await page.locator('.settings').evaluate((el) => {
    el.scrollTop =
      document.querySelector('select[aria-label="Geminiのモデル"]').closest('.card').offsetTop - 16;
  });
  await page.screenshot({ path: 'e2e/shots/desk-gemini-settings.png' });

  // 6) Claudeに切り替えると、表示もClaudeに戻る
  await page.getByRole('group', { name: '使うAI' }).getByRole('button', { name: 'Claude' }).click();
  assert(
    (await page.getByRole('button', { name: 'Claudeに頼む' }).count()) === 1,
    'Claudeに切り替えられる',
  );

  const unexpected = errors.filter((e) => !e.includes('429') && !e.includes('500'));
  console.log(
    unexpected.length ? 'ERRORS:\n' + unexpected.join('\n') : 'no unexpected console errors',
  );
  await browser.close();
})();
