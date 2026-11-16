// Claudeとの会話を、APIを差し替えて確かめる（本物のAPIは呼ばない）
const { chromium } = require('playwright');
const seed = require('./seed.cjs');
const assert = (c, m) => {
  if (!c) {
    console.log('FAIL: ' + m);
    process.exitCode = 1;
  } else console.log('ok: ' + m);
};
const sse = (events) =>
  events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const start = (id) => ({
  type: 'message_start',
  message: {
    id,
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 1 },
  },
});
const toolTurn = (id, name, input) =>
  sse([
    start('msg_' + id),
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_' + id, name, input: {} },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 20 },
    },
    { type: 'message_stop' },
  ]);
const textTurn = (id, text) =>
  sse([
    start('msg_' + id),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...text.match(/.{1,6}/gs).map((t) => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: t },
    })),
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 20 },
    },
    { type: 'message_stop' },
  ]);

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
  await seed(page);
  const t = await page.evaluate(() => window.__techo.date.today());
  const tomorrow = await page.evaluate(() =>
    window.__techo.date.addDays(window.__techo.date.today(), 1),
  );
  await page.evaluate(() =>
    localStorage.setItem('techo.settings', JSON.stringify({ claudeApiKey: 'sk-ant-test-key' })),
  );
  await page.reload();
  await page.waitForFunction(() => window.__techo);

  const bodies = [];
  const headers = [];
  let script = [];
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  };
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    bodies.push(req.postDataJSON());
    headers.push(req.headers());
    const next = script.shift();
    if (!next) return route.fulfill({ status: 500, headers: cors, body: '{}' });
    if (next.status)
      return route.fulfill({
        status: next.status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(next.body),
      });
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'text/event-stream' },
      body: next,
    });
  });

  // 1) 予定を追加
  script = [
    toolTurn('1', 'create_event', {
      title: '歯医者',
      start: `${tomorrow}T15:00`,
      end: `${tomorrow}T15:45`,
    }),
    textTurn('2', '明日の15時に「歯医者」を追加しました。'),
  ];
  await page.getByRole('button', { name: 'Claudeに頼む' }).click();
  await page.locator('.chat-form textarea').fill('明日の15時に歯医者を追加して');
  await page.locator('.chat-form textarea').press('Enter');
  await page.waitForFunction(() =>
    document.querySelector('.msg.assistant .msg-text')?.textContent.includes('追加しました'),
  );
  const made = await page.evaluate(async () =>
    (await window.__techo.db.events.toArray())
      .filter((e) => e.title === '歯医者')
      .map((e) => [e.start, e.end]),
  );
  assert(
    made.some(([s, e]) => s === `${tomorrow}T15:00` && e === `${tomorrow}T15:45`),
    '予定が作られる',
  );
  assert((await page.locator('.msg-actions li').count()) === 1, 'やったことがチャットに出る');
  assert(bodies.length === 2, 'APIを2回呼ぶ（ツール実行のあと続きを聞く）');
  const b0 = bodies[0];
  assert(
    b0.model === 'claude-opus-5-5' && b0.stream === true,
    `モデルとストリーミング (${b0.model})`,
  );
  assert(
    b0.tools.length === 11 &&
      b0.tools.every((x) => x.input_schema && x.eager_input_streaming === true),
    `ツール11個 (${b0.tools.length})`,
  );
  assert(
    b0.fallbacks === 'default' &&
      /server-side-fallback-2026-07-01/.test(headers[0]['anthropic-beta'] || ''),
    'フォールバックの指定',
  );
  assert(
    b0.output_config?.effort === 'medium' && !('thinking' in b0) && !('temperature' in b0),
    'effortのみ指定（thinking/temperatureは送らない）',
  );
  assert(
    headers[0]['authorization'] === 'Bearer sk-ant-test-key' &&
      !/message-threads/.test(headers[0]['anthropic-beta']),
    'APIキーを付けて送る（会話はサーバーに預けない）',
  );
  const lastUser = b0.messages[b0.messages.length - 1];
  assert(
    lastUser.content.some((c) => c.text.includes('現在の日時') && c.text.includes(t)),
    '現在の日時を添える',
  );
  const tr = bodies[1].messages[bodies[1].messages.length - 1];
  assert(
    tr.role === 'user' &&
      tr.content[0].type === 'tool_result' &&
      tr.content[0].tool_use_id === 'toolu_1',
    'ツールの結果を返す',
  );
  assert(JSON.parse(tr.content[0].content).ok === true, 'ツールの結果は成功');

  // 2) 続けて、削除（確認ダイアログでキャンセル）
  const id = await page.evaluate(
    async (tm) =>
      (await window.__techo.db.events.toArray()).find(
        (e) => e.title === '歯医者' && e.start.startsWith(tm),
      ).id,
    tomorrow,
  );
  script = [toolTurn('3', 'delete_event', { id }), textTurn('4', '削除は取りやめました。')];
  await page.locator('.chat-form textarea').fill('やっぱりさっきの歯医者を消して');
  await page.locator('.chat-form textarea').press('Enter');
  await page.waitForSelector('.modal');
  await page.screenshot({ path: 'e2e/shots/desk-chat-confirm.png' });
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.msg.assistant .msg-text')].some((n) =>
      n.textContent.includes('取りやめました'),
    ),
  );
  assert(
    await page.evaluate(async (i) => !!(await window.__techo.db.events.get(i)), id),
    'キャンセルしたら消えない',
  );
  const tr2 = bodies[3].messages[bodies[3].messages.length - 1];
  assert(tr2.content[0].content.includes('取りやめ'), 'キャンセルしたことがClaudeに伝わる');
  assert(bodies[2].messages.length === 5, `会話の履歴を引き継ぐ (${bodies[2].messages.length})`);

  // 3) 入力が正しくないツール呼び出しは実行されない
  script = [
    toolTurn('5', 'create_event', { title: '', start: 'あした' }),
    textTurn('6', 'すみません、日時を確認させてください。'),
  ];
  const before = await page.evaluate(() => window.__techo.db.events.count());
  await page.locator('.chat-form textarea').fill('なにか追加');
  await page.locator('.chat-form textarea').press('Enter');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.msg.assistant .msg-text')].some((n) =>
      n.textContent.includes('確認させて'),
    ),
  );
  assert(
    (await page.evaluate(() => window.__techo.db.events.count())) === before,
    '不正な入力では予定を作らない',
  );
  const tr3 = bodies[5].messages[bodies[5].messages.length - 1];
  assert(
    tr3.content[0].is_error === true,
    `検証エラーとして返る (${String(tr3.content[0].content).slice(0, 60)})`,
  );

  // 4) APIキーが違うとき
  script = [
    {
      status: 401,
      body: {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      },
    },
  ];
  await page.locator('.chat-form textarea').fill('今日の予定は？');
  await page.locator('.chat-form textarea').press('Enter');
  await page.waitForSelector('.msg.error');
  const errText = await page.locator('.msg.error .msg-text').last().textContent();
  assert(errText.includes('APIキー'), `キーの誤りを分かる言葉で伝える (${errText})`);
  await page.screenshot({ path: 'e2e/shots/desk-chat.png' });

  console.log(
    errors.filter((e) => !e.includes('401')).length
      ? 'ERRORS:\n' + errors.join('\n')
      : 'no unexpected console errors',
  );
  await browser.close();
})();
