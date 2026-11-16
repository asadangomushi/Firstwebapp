// 設定：予定の種類、Googleカレンダー連携、Claude、表示、バックアップ。
import { ArrowDown, ArrowUp, Download, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ColorPicker, CommitInput, IconBtn, Segmented } from '../components/ui';
import { download, exportBackup, importBackup } from '../lib/backup';
import { useData } from '../lib/data';
import { today } from '../lib/date';
import { LOCAL_CALENDAR } from '../lib/db';
import { disconnectGoogle, initGoogle, syncNow, useSyncState } from '../lib/google';
import { applyTheme, setSettings, useSettings, type Settings } from '../lib/settings';
import { deleteCategory, reorderCategories, saveCategory } from '../lib/store';
import type { Category, MonthMode } from '../lib/types';
import { useUI } from '../lib/ui-state';

export function SettingsPage() {
  return (
    <div className="page settings">
      <CategorySettings />
      <GoogleSettings />
      <ClaudeSettings />
      <DisplaySettings />
      <DataSettings />
    </div>
  );
}

// ---- 予定の種類 ----

function CategorySettings() {
  const data = useData();
  const ui = useUI();
  const [name, setName] = useState('');
  const [openColor, setOpenColor] = useState<string | null>(null);

  const move = (i: number, dir: number) => {
    const ids = data.categories.map((c) => c.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void reorderCategories(ids);
  };

  const remove = async (c: Category) => {
    const ok = await ui.confirm({
      title: '種類を削除',
      message: `「${c.name}」を削除します。この種類が付いていた予定は「なし」に戻ります。`,
      actions: [{ label: '削除', value: 'yes', danger: true }],
    });
    if (ok) await deleteCategory(c.id);
  };

  const add = () => {
    const n = name.trim();
    if (!n) return;
    // まだ使っていない色から順に割り当てる
    const used = new Set(data.categories.map((c) => c.color));
    const order = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'];
    void saveCategory({ name: n, color: order.find((k) => !used.has(k)) ?? 'gray' });
    setName('');
  };

  return (
    <section className="card">
      <h2>予定の種類</h2>
      <p className="section-hint">
        勉強・運動・バイトなどの分類です。予定を作るときにここから選びます。「キーワード」に入れた語がタイトルに含まれる予定は、自動でその種類になります（例：勉強 ← 数学）。
      </p>
      <ul className="cat-list">
        {data.categories.map((c, i) => (
          <li key={c.id} className="cat-item">
            <div className="cat-main">
              <button
                type="button"
                className="color-dot"
                style={{ background: `var(--c-${c.color})` }}
                aria-label={`${c.name} の色を変える`}
                aria-expanded={openColor === c.id}
                onClick={() => setOpenColor(openColor === c.id ? null : c.id)}
              />
              <CommitInput
                className="cat-name"
                value={c.name}
                aria-label="種類の名前"
                onCommit={(v) => v.trim() && void saveCategory({ ...c, name: v })}
              />
              <IconBtn label="上へ" className="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={16} />
              </IconBtn>
              <IconBtn
                label="下へ"
                className="sm"
                disabled={i === data.categories.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={16} />
              </IconBtn>
              <IconBtn label={`${c.name} を削除`} className="sm" onClick={() => void remove(c)}>
                <Trash2 size={16} />
              </IconBtn>
            </div>
            {openColor === c.id && (
              <ColorPicker
                value={c.color}
                onChange={(color) => {
                  void saveCategory({ ...c, color });
                  setOpenColor(null);
                }}
              />
            )}
            <div className="cat-sub">
              <label className="field">
                <span>キーワード（、で区切る）</span>
                <CommitInput
                  value={c.keywords.join('、')}
                  placeholder="例：数学、英語、ゼミ"
                  onCommit={(v) =>
                    void saveCategory({
                      ...c,
                      keywords: v
                        .split(/[、,\s]+/)
                        .map((k) => k.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>月表示</span>
                <select
                  value={c.monthMode}
                  onChange={(e) => void saveCategory({ ...c, monthMode: e.target.value as MonthMode })}
                >
                  <option value="auto">自動（繰り返しは隠す）</option>
                  <option value="show">いつも出す</option>
                  <option value="hide">いつも隠す</option>
                </select>
              </label>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={name}
          placeholder="種類を追加（例：通院）"
          aria-label="新しい種類の名前"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn-tonal" disabled={!name.trim()}>
          追加
        </button>
      </form>
    </section>
  );
}

// ---- Googleカレンダー ----

function GoogleSettings() {
  const settings = useSettings();
  const sync = useSyncState();
  const data = useData();
  const origin = location.origin;
  const googleCals = data.calendars.filter((c) => c.source === 'google');
  const writable = data.calendars.filter((c) => c.writable);

  const status =
    sync.status === 'off'
      ? '未設定'
      : sync.status === 'needsAuth'
        ? 'ログインが必要です'
        : sync.status === 'syncing'
          ? '同期中…'
          : sync.status === 'error'
            ? `エラー：${sync.message}`
            : sync.lastSync
              ? `同期済み（${new Date(sync.lastSync).toLocaleString('ja-JP')}）`
              : '接続済み';

  return (
    <section className="card">
      <h2>Googleカレンダー連携</h2>
      <p className="section-hint">
        Googleカレンダーの予定をこの手帳に取り込み、手帳で作った予定もGoogleカレンダーに反映します。リンク・持ち物などの書き足した情報は、この端末の中だけに保存されます。
      </p>
      <details className="guide">
        <summary>はじめての設定手順（最初の1回だけ・約10分）</summary>
        <ol>
          <li>
            <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">
              Google Cloud コンソール
            </a>
            を開き、新しいプロジェクトを作ります（名前は何でもかまいません）。
          </li>
          <li>「APIとサービス」→「ライブラリ」で「Google Calendar API」を検索して有効にします。</li>
          <li>
            「OAuth 同意画面」を設定します。ユーザーの種類は「外部」、テストユーザーに自分のGoogleアカウントを追加します。
          </li>
          <li>
            「認証情報」→「認証情報を作成」→「OAuth クライアント ID」。種類は「ウェブ アプリケーション」を選び、「承認済みの JavaScript 生成元」に次のURLを追加します。
            <code className="code-line">{origin}</code>
          </li>
          <li>できた「クライアント ID」（…apps.googleusercontent.com）を下の欄に貼り付けます。</li>
        </ol>
      </details>
      <label className="field">
        <span>クライアント ID</span>
        <CommitInput
          value={settings.googleClientId}
          placeholder="xxxxxxxx.apps.googleusercontent.com"
          onCommit={(v) => {
            setSettings({ googleClientId: v.trim() });
            initGoogle();
          }}
        />
      </label>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!settings.googleClientId || sync.status === 'syncing'}
          onClick={() => void syncNow(true)}
        >
          {sync.status === 'needsAuth' ? 'Googleにログインして同期' : '今すぐ同期'}
        </button>
        {settings.googleClientId && sync.status !== 'needsAuth' && (
          <button type="button" className="btn btn-text" onClick={disconnectGoogle}>
            ログアウト
          </button>
        )}
        <span className="status-text">{status}</span>
      </div>
      {sync.status === 'needsAuth' && sync.message && <p className="error">{sync.message}</p>}
      {googleCals.length > 0 && (
        <>
          <label className="field">
            <span>新しい予定を入れるカレンダー</span>
            <select
              value={
                writable.some((c) => c.id === settings.defaultCalendarId)
                  ? settings.defaultCalendarId
                  : LOCAL_CALENDAR
              }
              onChange={(e) => setSettings({ defaultCalendarId: e.target.value })}
            >
              {writable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className="section-hint">
            取り込むカレンダーは、メニューの「カレンダー」のチェックで選べます（オフのものは同期しません）。
          </p>
        </>
      )}
      <div className="field-row">
        <label className="field">
          <span>さかのぼって取り込む期間</span>
          <select
            value={settings.syncPastMonths}
            onChange={(e) => setSettings({ syncPastMonths: Number(e.target.value) })}
          >
            {[1, 3, 6, 12].map((n) => (
              <option key={n} value={n}>
                {n}か月前まで
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>先の予定を取り込む期間</span>
          <select
            value={settings.syncFutureMonths}
            onChange={(e) => setSettings({ syncFutureMonths: Number(e.target.value) })}
          >
            {[3, 6, 12, 24].map((n) => (
              <option key={n} value={n}>
                {n}か月先まで
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

// ---- Claude ----

const MODELS: Array<{ id: string; label: string }> = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（おすすめ）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（速くて安い）' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5（いちばん安い）' },
];

function ClaudeSettings() {
  const settings = useSettings();
  return (
    <section className="card">
      <h2>Claude</h2>
      <p className="section-hint">
        アプリの中でClaudeに話しかけて、予定を追加・変更できます（例：「金曜の15時に歯医者を追加して」）。使うにはAnthropicのAPIキーが必要で、使った分だけ料金がかかります。キーはこの端末の中だけに保存され、Anthropic以外には送られません。
      </p>
      <label className="field">
        <span>
          APIキー（
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
            Anthropic Console
          </a>
          で作成）
        </span>
        <CommitInput
          value={settings.claudeApiKey}
          placeholder="sk-ant-…"
          onCommit={(v) => setSettings({ claudeApiKey: v.trim() })}
        />
      </label>
      <label className="field">
        <span>モデル</span>
        <select
          value={settings.claudeModel}
          onChange={(e) => setSettings({ claudeModel: e.target.value })}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

// ---- 表示 ----

function DisplaySettings() {
  const settings = useSettings();
  return (
    <section className="card">
      <h2>表示</h2>
      <div className="setting-line">
        <span>テーマ</span>
        <Segmented<Settings['theme']>
          small
          label="テーマ"
          value={settings.theme}
          onChange={(theme) => {
            setSettings({ theme });
            applyTheme();
          }}
          options={[
            { value: 'auto', label: '自動' },
            { value: 'light', label: 'ライト' },
            { value: 'dark', label: 'ダーク' },
          ]}
        />
      </div>
      <div className="setting-line">
        <span>週の始まり</span>
        <Segmented<'0' | '1'>
          small
          label="週の始まり"
          value={String(settings.weekStartsOn) as '0' | '1'}
          onChange={(v) => setSettings({ weekStartsOn: v === '0' ? 0 : 1 })}
          options={[
            { value: '1', label: '月曜' },
            { value: '0', label: '日曜' },
          ]}
        />
      </div>
    </section>
  );
}

// ---- データ ----

function DataSettings() {
  const ui = useUI();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      download(await exportBackup(), `techo-backup-${today()}.json`);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    const ok = await ui.confirm({
      title: 'バックアップから復元',
      message: '今この端末にある手帳のデータを、選んだバックアップの内容で置き換えます。元には戻せません。',
      actions: [{ label: '置き換える', value: 'yes', danger: true }],
    });
    if (!ok) return;
    setBusy(true);
    try {
      await importBackup(file);
      ui.toast('バックアップから復元しました');
    } catch (err) {
      ui.toast(err instanceof Error ? err.message : '復元できませんでした');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>データ</h2>
      <p className="section-hint">
        手帳のデータは、このブラウザの中だけに保存されています（別の端末には自動で同期されません）。機種変更の前や、ときどきバックアップを取っておくと安心です。
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-tonal" disabled={busy} onClick={() => void doExport()}>
          <Download size={18} />
          バックアップを保存
        </button>
        <button type="button" className="btn btn-tonal" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={18} />
          バックアップから復元
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
        />
      </div>
    </section>
  );
}
