// デモ用のデータを入れる（ページ内で実行する関数）
module.exports = async function seed(page) {
  await page.waitForFunction(() => window.__techo);
  await page.evaluate(async () => {
    const { db, store, date } = window.__techo;
    if ((await db.events.count()) > 0) return;
    const cats = await db.categories.toArray();
    const cat = (n) => cats.find((c) => c.name === n)?.id;
    const t = date.today();
    const mon = date.startOfWeek(t, 1);
    const d = (n) => date.addDays(mon, n);
    const until = date.addMonths(t, 2);
    const back = date.addDays(mon, -28);
    const bd = (n) => date.addDays(back, n);
    // 毎週の授業
    const classes = [
      [0, '09:00', '10:30', '数学'], [0, '13:00', '14:30', '英語'],
      [1, '10:40', '12:10', '物理'], [2, '09:00', '10:30', '数学演習'],
      [2, '14:40', '16:10', 'ゼミ'], [3, '10:40', '12:10', '英語'],
      [4, '09:00', '10:30', '情報'],
    ];
    for (const [off, s, e, title] of classes) {
      await store.createEvent({ title, start: `${bd(off)}T${s}`, end: `${bd(off)}T${e}`, allDay: false },
        { freq: 'weekly', until });
    }
    await store.createEvent({ title: 'バイト', start: `${bd(1)}T17:00`, end: `${bd(1)}T21:00`, allDay: false }, { freq: 'weekly', until });
    await store.createEvent({ title: 'バイト', start: `${bd(5)}T10:00`, end: `${bd(5)}T16:00`, allDay: false }, { freq: 'weekly', until });
    await store.createEvent({ title: 'ジム', start: `${bd(3)}T18:30`, end: `${bd(3)}T19:30`, allDay: false }, { freq: 'weekly', until });
    // 特別な予定
    await store.createEvent({ title: '友達と映画', start: `${d(5)}T18:00`, end: `${d(5)}T21:00`, allDay: false, categoryId: cat('遊び') });
    await store.createEvent({ title: '京都旅行', start: d(11), end: d(14), allDay: true, categoryId: cat('遊び') });
    await store.createEvent({ title: '歯医者', start: `${d(3)}T15:00`, end: `${d(3)}T15:45`, allDay: false });
    const proj = await store.saveProject({ name: '英語検定', color: 'violet' });
    const exam = await store.createEvent({ title: '英語検定 一次試験', start: `${d(19)}T10:00`, end: `${d(19)}T12:30`, allDay: false, kind: 'exam', categoryId: cat('勉強'), projectId: proj.id });
    const apply = await store.createEvent({ title: '出願日', start: d(-6), end: d(-5), allDay: true, projectId: proj.id });
    const pay = await store.createEvent({ title: '受験料の入金期限', start: d(1), end: d(2), allDay: true, kind: 'task', projectId: proj.id });
    await store.linkEvents(exam.id, apply.id);
    await store.linkEvents(exam.id, pay.id);
    await store.updateEvent(exam.id, {
      links: [
        { id: 'l1', label: '受験票（Googleドキュメント）', url: 'https://docs.google.com/document/d/example' },
        { id: 'l2', label: '申込完了メール', url: 'https://mail.google.com/mail/u/0/#inbox/example' },
      ],
      belongings: [
        { id: 'b1', text: '受験票', done: true }, { id: 'b2', text: '鉛筆・消しゴム', done: false }, { id: 'b3', text: '腕時計', done: false },
      ],
      exam: { scope: 'リーディング・リスニング・英作文（過去問 2024-1〜3）', score: '', review: '' },
      location: '第2キャンパス 3号館',
    });
    const report = await store.createEvent({ title: '物理レポート提出', start: `${d(9)}T23:59`, end: `${d(10)}T00:00`, allDay: false, kind: 'task', categoryId: cat('勉強') });
    await store.updateEvent(report.id, { end: `${d(9)}T23:59`, submissions: [{ id: 's1', text: 'レポート本体（PDF）', done: false }, { id: 's2', text: '実験データ', done: true }] });
    const rs = { id: report.id, categoryId: cat('勉強') };
    const s1 = await store.addStep(rs, '実験データを整理する', d(2));
    await store.updateEvent(s1.id, { done: true });
    await store.addStep(rs, 'グラフを作る', d(4));
    await store.addStep(rs, '考察を書く', d(6));
    await store.addStep(rs, '見直して提出', d(8));
    for (let i = 1; i <= 3; i++) await store.addStep({ id: exam.id, categoryId: cat('勉強'), projectId: proj.id }, `過去問 2024-${i} を解く`, d(4 + i * 4));
    // 実績（今週の月〜今日）
    const log = async (day, s, e, title, c) => store.addActual({ start: `${day}T${s}`, end: `${day}T${e}`, title, categoryId: cat(c), memo: '' });
    for (let i = -7; i < 7; i++) {
      const day = d(i);
      if (day >= t) break;
      await store.addActual({ start: `${date.addDays(day, -1)}T23:30`, end: `${day}T07:00`, title: '睡眠', categoryId: cat('睡眠'), memo: '' });
      await log(day, '07:00', '08:30', '朝食・移動', '生活');
      const wd = ((i % 7) + 7) % 7;
      if (wd < 5) { await log(day, '09:00', '12:10', '授業', '勉強'); await log(day, '12:10', '13:00', '昼食', '生活'); await log(day, '13:00', wd % 2 ? '16:10' : '14:30', '授業', '勉強'); }
      else { await log(day, '10:00', '16:00', 'バイト', 'バイト'); }
      if (wd === 1) await log(day, '17:00', '21:00', 'バイト', 'バイト');
      if (wd === 3) await log(day, '18:30', '19:30', 'ジム', '運動');
      if (wd % 2 === 0) await log(day, '19:00', '21:00', 'レポート', '勉強');
      await log(day, '21:30', '23:00', 'ゲーム・動画', '趣味');
    }
    await store.saveDiary(t, { text: '数学の小テストは思ったより解けた。\nレポートのグラフは明日に回す。', mood: '🙂' });
    await store.saveDiary(date.addDays(t, -1), { text: 'バイトが忙しかった。帰ってすぐ寝た。', mood: '😪' });
  });
};
