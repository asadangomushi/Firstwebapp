// 日記。1日1ページ。その日の予定と時間の使い方も一緒に振り返れる。
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { Legend, TimelineBars } from '../components/Charts';
import { DiaryEditor } from '../components/DiaryEditor';
import { EventChip } from '../components/EventChip';
import { Empty, IconBtn } from '../components/ui';
import { useData } from '../lib/data';
import { addMonths, fmtDay, fmtDayShort, fmtMonthTitle, onDay, startKey } from '../lib/date';
import { navigate } from '../lib/router';
import { daySegments, totals } from '../lib/stats';
import type { Actual } from '../lib/types';

export function DiaryPage({ date }: { date: string }) {
  const data = useData();
  const month = date.slice(0, 7);

  const entries = useMemo(
    () =>
      [...data.diary.values()]
        .filter((d) => d.date.startsWith(month))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.diary, month],
  );
  const events = useMemo(
    () =>
      data.events
        .filter((e) => onDay(e, date))
        .sort((a, b) => startKey(a).localeCompare(startKey(b))),
    [data.events, date],
  );
  const segs = useMemo(() => {
    const catOf = (a: Actual) => (a.categoryId ? data.catById.get(a.categoryId) : undefined);
    return daySegments(date, data.actuals, catOf);
  }, [data.actuals, data.catById, date]);

  return (
    <div className="page diary">
      <section className="card">
        <h2>{fmtDay(date, true)}</h2>
        <DiaryEditor date={date} rows={10} />
      </section>

      {(events.length > 0 || segs.length > 0) && (
        <section className="card">
          <h3 className="section-title">この日のこと</h3>
          {events.length > 0 && (
            <div className="diary-events">
              {events.map((e) => (
                <EventChip key={e.id} e={e} bar={e.allDay} />
              ))}
            </div>
          )}
          {segs.length > 0 && (
            <>
              <TimelineBars rows={[{ key: 'a', label: '実績', segs }]} />
              <Legend items={totals(segs, data.categories)} />
            </>
          )}
          <button type="button" className="btn btn-text" onClick={() => navigate({ name: 'day', date })}>
            一日の画面を開く
          </button>
        </section>
      )}

      <section className="card">
        <div className="diary-date">
          <IconBtn label="前の月" onClick={() => navigate({ name: 'diary', date: addMonths(month + '-01', -1) })}>
            <ChevronLeft size={20} />
          </IconBtn>
          <h3 className="section-title">{fmtMonthTitle(date)}の日記</h3>
          <IconBtn label="次の月" onClick={() => navigate({ name: 'diary', date: addMonths(month + '-01', 1) })}>
            <ChevronRight size={20} />
          </IconBtn>
        </div>
        {entries.length === 0 ? (
          <Empty>この月の日記はまだありません。</Empty>
        ) : (
          <ul className="list">
            {entries.map((d) => (
              <li key={d.date}>
                <button
                  type="button"
                  className={`list-item list-open diary-item ${d.date === date ? 'on' : ''}`}
                  onClick={() => navigate({ name: 'diary', date: d.date })}
                >
                  <span className="diary-item-date">
                    {fmtDayShort(d.date)}
                    {d.mood && <span aria-hidden="true">{d.mood}</span>}
                  </span>
                  <span className="diary-item-text">{d.text || '（気分だけ記録）'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
