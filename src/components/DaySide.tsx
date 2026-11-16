// 一日の画面の横に出す「この日のメモ」：やること、持ち物・提出物、日記。
import { BookOpen } from 'lucide-react';
import { useData } from '../lib/data';
import type { Resolved } from '../lib/resolve';
import { navigate } from '../lib/router';
import { updateEvent } from '../lib/store';
import type { CheckItem } from '../lib/types';
import { DiaryEditor } from './DiaryEditor';

/** まだ済んでいないものの数（ボタンの数字に使う） */
export function daySideCount(events: Resolved[]): number {
  let n = 0;
  for (const e of events) {
    if (e.parentId && !e.done) n++;
    n += e.belongings.filter((i) => !i.done).length;
    n += e.submissions.filter((i) => !i.done).length;
  }
  return n;
}

export function DaySide({ date, events }: { date: string; events: Resolved[] }) {
  const data = useData();
  const steps = events.filter((e) => e.parentId);
  const withItems = events.filter((e) => e.belongings.length + e.submissions.length > 0);

  const toggle = (e: Resolved, field: 'belongings' | 'submissions', item: CheckItem) =>
    void updateEvent(e.id, {
      [field]: e[field].map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)),
    });

  return (
    <div className="side-stack">
      {steps.length > 0 && (
        <section>
          <h3>今日やること</h3>
          <ul className="side-list">
            {steps.map((s) => (
              <li key={s.id} className={s.done ? 'done' : ''}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!s.done}
                    onChange={(ev) => void updateEvent(s.id, { done: ev.target.checked })}
                  />
                  <span>
                    {s.title}
                    <small>{data.byId.get(s.parentId!)?.title}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {withItems.length > 0 && (
        <section>
          <h3>持ち物・提出物</h3>
          {withItems.map((e) => (
            <div key={e.id} className="side-group">
              <button type="button" className="side-group-title" onClick={() => navigate({ name: 'event', id: e.id })}>
                {e.title}
              </button>
              <ul className="side-list">
                {(['belongings', 'submissions'] as const).flatMap((field) =>
                  e[field].map((it) => (
                    <li key={it.id} className={it.done ? 'done' : ''}>
                      <label>
                        <input type="checkbox" checked={it.done} onChange={() => toggle(e, field, it)} />
                        <span>
                          {it.text}
                          {field === 'submissions' && <small>提出物</small>}
                        </span>
                      </label>
                    </li>
                  )),
                )}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section>
        <h3>
          日記
          <button type="button" className="btn btn-text side-link" onClick={() => navigate({ name: 'diary', date })}>
            <BookOpen size={15} />
            日記を開く
          </button>
        </h3>
        <DiaryEditor date={date} rows={5} />
      </section>
    </div>
  );
}
