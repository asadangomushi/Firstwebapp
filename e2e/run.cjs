// 画面を実際に操作して確かめるテストをまとめて実行する。
//   npm run e2e
// Playwright（ブラウザを自動操作する道具）が必要。Claude Code のクラウド環境には最初から入っている。
// GoogleやClaudeのAPIは偽物に差し替えるので、本物には何も送らない。
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });

function waitFor(url) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const ping = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () =>
          ++tries > 100 ? reject(new Error(`${url} が起動しません`)) : setTimeout(ping, 200),
        );
    };
    ping();
  });
}

function run(file) {
  console.log(`\n=== ${file} ===`);
  const r = spawnSync('node', [path.join(__dirname, file)], { cwd: root, stdio: 'inherit' });
  return r.status === 0;
}

(async () => {
  const servers = [];
  const start = (args) => {
    const p = spawn('npx', ['vite', ...args], { cwd: root, stdio: 'ignore' });
    servers.push(p);
    return p;
  };
  let ok = true;
  try {
    start(['--port', '5173', '--strictPort']);
    await waitFor('http://localhost:5173/');
    for (const f of ['day.cjs', 'chat.cjs', 'google.cjs']) ok = run(f) && ok;

    console.log('\n=== 本番ビルド ===');
    const build = spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
    if (build.status !== 0) throw new Error('ビルドに失敗しました');
    start(['preview', '--port', '4173', '--strictPort']);
    await waitFor('http://localhost:4173/');
    ok = run('pwa.cjs') && ok;
  } catch (err) {
    console.error(err.message);
    ok = false;
  } finally {
    for (const p of servers) p.kill();
  }
  console.log(ok ? '\nすべて成功しました' : '\n失敗したテストがあります');
  process.exit(ok ? 0 : 1);
})();
