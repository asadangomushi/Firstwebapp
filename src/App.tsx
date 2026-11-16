import { Suspense, lazy, useEffect, useState } from 'react';
import { ConfirmHost, Toast } from './components/Overlays';
import { EventDialog } from './components/EventDialog';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DataProvider, useData } from './lib/data';
import { seedIfEmpty } from './lib/db';
import { initGoogle, syncIfStale } from './lib/google';
import { isCalView, useRoute } from './lib/router';
import { importShared } from './lib/share';
import { UIProvider, useUI } from './lib/ui-state';
import { DayView } from './views/DayView';
import { DiaryPage } from './views/DiaryPage';
import { EventPage } from './views/EventPage';
import { InboxPage } from './views/InboxPage';
import { ProjectPage, ProjectsPage } from './views/ProjectsPage';
import { TimeUseView } from './views/TimeUseView';
import { MonthView } from './views/MonthView';
import { SettingsPage } from './views/SettingsPage';
import { WeekView } from './views/WeekView';
import { weekDays } from './lib/date';
import { useSettings } from './lib/settings';
import { Plus } from 'lucide-react';

// Claudeとの会話は使うときにだけ読み込む（最初の表示を軽くするため）
const ChatPanel = lazy(() => import('./components/ChatPanel').then((m) => ({ default: m.ChatPanel })));

export function App() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    void seedIfEmpty().then(() => {
      setBooted(true);
      initGoogle();
      // ほかのアプリから「共有」で届いたものがあれば受信トレイへ
      void importShared();
    });
  }, []);

  // 別のアプリから戻ってきたとき：共有で届いたものを取り込み、Googleとも合わせ直す
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void importShared();
      syncIfStale();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  if (!booted) return null;
  return (
    <DataProvider>
      <UIProvider>
        <Shell />
      </UIProvider>
    </DataProvider>
  );
}

function Shell() {
  const route = useRoute();
  const ui = useUI();
  const data = useData();
  const settings = useSettings();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // 画面が変わったらスマホのメニューは閉じる
  useEffect(() => {
    ui.setDrawerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  let view;
  switch (route.name) {
    case 'month':
      view = <MonthView date={route.date} />;
      break;
    case 'week':
      view = <WeekView days={weekDays(route.date, settings.weekStartsOn)} />;
      break;
    case 'day':
      view = <DayView date={route.date} />;
      break;
    case 'timeuse':
      view = <TimeUseView date={route.date} />;
      break;
    case 'diary':
      view = <DiaryPage date={route.date} />;
      break;
    case 'projects':
      view = <ProjectsPage />;
      break;
    case 'project':
      view = <ProjectPage id={route.id} />;
      break;
    case 'inbox':
      view = <InboxPage />;
      break;
    case 'event':
      view = <EventPage id={route.id} />;
      break;
    case 'settings':
      view = <SettingsPage />;
      break;
  }

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <Header onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <div className="app-body">
        <Sidebar />
        <main className="main" id="main">
          {data.ready ? view : null}
        </main>
        {ui.chatOpen && (
          <Suspense fallback={<aside className="chat" aria-busy="true" />}>
            <ChatPanel />
          </Suspense>
        )}
      </div>
      {isCalView(route) && (
        <button
          type="button"
          className="fab"
          aria-label="予定を作成"
          onClick={() => ui.openCreate({ start: route.date })}
        >
          <Plus size={28} />
        </button>
      )}
      {ui.createInit && <EventDialog init={ui.createInit} onClose={ui.closeCreate} />}
      <ConfirmHost />
      <Toast />
    </div>
  );
}
