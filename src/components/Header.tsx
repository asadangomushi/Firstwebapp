import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CloudAlert,
  CloudCheck,
  CloudOff,
  Menu,
  NotebookPen,
  RefreshCw,
  Sparkles,
  Star,
} from 'lucide-react';
import {
  addDays,
  addMonths,
  fmtDay,
  fmtMonthTitle,
  fmtWeekTitle,
  startOfMonth,
  today,
  weekDays,
} from '../lib/date';
import { syncNow, useSyncState } from '../lib/google';
import { goBack, isCalView, navigate, useRoute, type CalView, type Route } from '../lib/router';
import { setSettings, useSettings } from '../lib/settings';
import { useUI } from '../lib/ui-state';
import { IconBtn, Segmented } from './ui';

const TITLES: Partial<Record<Route['name'], string>> = {
  event: '予定',
  projects: 'プロジェクト',
  project: 'プロジェクト',
  settings: '設定',
  inbox: '受信トレイ',
};

export function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const route = useRoute();
  const ui = useUI();
  const settings = useSettings();
  const dated = 'date' in route;

  const step = (dir: number) => {
    if (!dated) return;
    const d = route.date;
    const next =
      route.name === 'month'
        ? addMonths(startOfMonth(d), dir)
        : route.name === 'week' || route.name === 'timeuse'
          ? addDays(d, 7 * dir)
          : addDays(d, dir);
    navigate({ ...route, date: next });
  };

  let title = TITLES[route.name] ?? '';
  if (dated) {
    title =
      route.name === 'month'
        ? fmtMonthTitle(route.date)
        : route.name === 'week' || route.name === 'timeuse'
          ? fmtWeekTitle(weekDays(route.date, settings.weekStartsOn))
          : fmtDay(route.date, true);
  }

  const menu = () => {
    // 狭い画面ではメニューを上にかぶせ、広い画面では横の欄を開閉する
    if (window.matchMedia('(max-width: 900px)').matches) ui.setDrawerOpen(true);
    else onToggleSidebar();
  };

  const deep = route.name === 'event' || route.name === 'project';

  return (
    <header className="header">
      <div className="header-row header-main">
        {deep ? (
          <IconBtn label="戻る" className="h-menu" onClick={goBack}>
            <ArrowLeft size={22} />
          </IconBtn>
        ) : (
          <IconBtn label="メニュー" className="h-menu" onClick={menu}>
            <Menu size={22} />
          </IconBtn>
        )}
        <div className="brand" aria-hidden="true">
          <NotebookPen size={24} />
          <span>手帳</span>
        </div>
        <h1 className="header-title">
          {route.name === 'timeuse' && <span className="header-kicker">時間の使い方</span>}
          {route.name === 'diary' && <span className="header-kicker">日記</span>}
          <span className="header-title-text">{title}</span>
        </h1>
        <div className="h-tools">
          <IconBtn
            label="Claudeに頼む"
            className="chat-btn"
            aria-pressed={ui.chatOpen}
            onClick={() => (ui.chatOpen ? ui.closeChat() : ui.openChat())}
          >
            <Sparkles size={20} />
          </IconBtn>
          <SyncButton />
        </div>
        {dated && (
          <button
            type="button"
            className="btn btn-outline today-btn"
            onClick={() => navigate({ ...route, date: today() })}
          >
            今日
          </button>
        )}
      </div>
      {dated && (
        <div className="header-row header-sub">
          <div className="header-nav">
            <IconBtn label="前へ" onClick={() => step(-1)}>
              <ChevronLeft size={22} />
            </IconBtn>
            <IconBtn label="次へ" onClick={() => step(1)}>
              <ChevronRight size={22} />
            </IconBtn>
          </div>
          <div className="h-view">
            {route.name === 'month' && (
              <button
                type="button"
                className={`btn btn-chip ${settings.monthSpecialOnly ? 'on' : ''}`}
                aria-pressed={settings.monthSpecialOnly}
                title="毎週の授業やバイトを隠して、特別な予定だけを表示します"
                onClick={() => setSettings({ monthSpecialOnly: !settings.monthSpecialOnly })}
              >
                <Star size={15} fill={settings.monthSpecialOnly ? 'currentColor' : 'none'} />
                特別な予定のみ
              </button>
            )}
            {isCalView(route) && (
              <Segmented<CalView>
                label="表示の切り替え"
                value={route.name}
                onChange={(v) => navigate({ name: v, date: route.date })}
                options={[
                  { value: 'day', label: '日' },
                  { value: 'week', label: '週' },
                  { value: 'month', label: '月' },
                ]}
              />
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function SyncButton() {
  const s = useSyncState();
  const ui = useUI();
  if (s.status === 'off') return null;

  const last = s.lastSync
    ? new Date(s.lastSync).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : '';
  const label =
    s.status === 'syncing'
      ? 'Googleカレンダーと同期中'
      : s.status === 'needsAuth'
        ? s.message || 'Googleカレンダーにログインして同期'
        : s.status === 'error'
          ? `同期に失敗しました：${s.message}`
          : `Googleカレンダーと同期（前回 ${last}）`;

  const onClick = async () => {
    await syncNow(true);
  };

  return (
    <IconBtn
      label={label}
      className={s.status === 'needsAuth' || s.status === 'error' ? 'warn' : ''}
      onClick={() => {
        void onClick().catch((e: unknown) =>
          ui.toast(e instanceof Error ? e.message : '同期に失敗しました'),
        );
      }}
      disabled={s.status === 'syncing'}
    >
      {s.status === 'syncing' ? (
        <RefreshCw size={20} className="spin" />
      ) : s.status === 'needsAuth' ? (
        <CloudOff size={20} />
      ) : s.status === 'error' ? (
        <CloudAlert size={20} />
      ) : (
        <CloudCheck size={20} />
      )}
    </IconBtn>
  );
}
