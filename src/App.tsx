import { useEffect, useState } from 'react';
import { ConfirmHost, Toast } from './components/Overlays';
import { EventDialog } from './components/EventDialog';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DataProvider, useData } from './lib/data';
import { seedIfEmpty } from './lib/db';
import { initGoogle } from './lib/google';
import { isCalView, useRoute } from './lib/router';
import { UIProvider, useUI } from './lib/ui-state';
import { EventPage } from './views/EventPage';
import { MonthView } from './views/MonthView';
import { SettingsPage } from './views/SettingsPage';
import { WeekView } from './views/WeekView';
import { weekDays } from './lib/date';
import { useSettings } from './lib/settings';
import { Plus } from 'lucide-react';

export function App() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    void seedIfEmpty().then(() => {
      setBooted(true);
      initGoogle();
    });
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
      view = <WeekView days={[route.date]} />;
      break;
    case 'event':
      view = <EventPage id={route.id} />;
      break;
    case 'settings':
      view = <SettingsPage />;
      break;
    default:
      view = <MonthView date={'date' in route ? route.date : ''} />;
  }

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <Header onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <div className="app-body">
        <Sidebar />
        <main className="main" id="main">
          {data.ready ? view : null}
        </main>
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
