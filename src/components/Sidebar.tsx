import {
  BarChart3,
  BookOpen,
  CalendarDays,
  FolderKanban,
  Inbox,
  Plus,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { fill } from '../lib/colors';
import { useData } from '../lib/data';
import { today } from '../lib/date';
import { isCalView, navigate, useRoute, type Route } from '../lib/router';
import { setCalendarVisible } from '../lib/store';
import { useUI } from '../lib/ui-state';
import { MiniCalendar } from './MiniCalendar';

export function Sidebar() {
  const route = useRoute();
  const ui = useUI();
  const data = useData();
  const date = 'date' in route ? route.date : today();
  const inbox = data.files.filter((f) => !f.eventId).length;

  const pick = (d: string) => {
    if ('date' in route) navigate({ ...route, date: d });
    else navigate({ name: 'day', date: d });
  };

  const link = (to: Route, icon: ReactNode, label: string, active: boolean, badge?: number) => (
    <button
      type="button"
      className={`nav-link ${active ? 'on' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => navigate(to)}
    >
      {icon}
      <span>{label}</span>
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );

  const content = (
    <>
      <button type="button" className="create-btn" onClick={() => ui.openCreate({ start: date })}>
        <Plus size={22} />
        作成
      </button>
      <MiniCalendar date={date} onPick={pick} />
      <nav className="nav" aria-label="メニュー">
        {link({ name: 'month', date }, <CalendarDays size={18} />, 'カレンダー', isCalView(route))}
        {link({ name: 'timeuse', date }, <BarChart3 size={18} />, '時間の使い方', route.name === 'timeuse')}
        {link({ name: 'diary', date }, <BookOpen size={18} />, '日記', route.name === 'diary')}
        {link(
          { name: 'projects' },
          <FolderKanban size={18} />,
          'プロジェクト',
          route.name === 'projects' || route.name === 'project',
        )}
        {(inbox > 0 || route.name === 'inbox') &&
          link({ name: 'inbox' }, <Inbox size={18} />, '受信トレイ', route.name === 'inbox', inbox)}
        {link({ name: 'settings' }, <SettingsIcon size={18} />, '設定', route.name === 'settings')}
      </nav>
      <section className="side-section">
        <h3>カレンダー</h3>
        {data.calendars.map((c) => (
          <label key={c.id} className="cal-check">
            <input
              type="checkbox"
              checked={c.visible}
              onChange={(e) => void setCalendarVisible(c.id, e.target.checked)}
              style={{ accentColor: fill(c.color) }}
            />
            <span>{c.name}</span>
          </label>
        ))}
      </section>
    </>
  );

  return (
    <>
      <aside className="sidebar">{content}</aside>
      {ui.drawerOpen && (
        <div
          className="drawer-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) ui.setDrawerOpen(false);
          }}
        >
          <aside className="drawer" aria-label="メニュー">
            <div className="drawer-title">手帳</div>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
