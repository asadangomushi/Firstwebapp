// 月表示。毎週の授業などは隠し、選んだ「特別な予定」だけを出せる。
import { PenLine, Star } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EventChip } from '../components/EventChip';
import { useData } from '../lib/data';
import { WEEKDAYS, addDays, dayOfWeek, monthGrid, overlapsDays, today } from '../lib/date';
import { fitWeek, layoutWeek } from '../lib/layout';
import { navigate } from '../lib/router';
import { setSettings, useSettings } from '../lib/settings';

export function MonthView({ date }: { date: string }) {
  const data = useData();
  const settings = useSettings();
  const weeks = useMemo(() => monthGrid(date, settings.weekStartsOn), [date, settings.weekStartsOn]);
  const month = date.slice(0, 7);
  const now = today();
  const gridRef = useRef<HTMLDivElement>(null);
  const [maxLanes, setMaxLanes] = useState(3);

  // マスの高さから、何段まで予定を並べられるかを決める
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const row = el.querySelector<HTMLElement>('.mweek');
      if (!row) return;
      const cs = getComputedStyle(el);
      const lane = parseFloat(cs.getPropertyValue('--lane-h')) || 22;
      const head = parseFloat(cs.getPropertyValue('--mday-h')) || 28;
      setMaxLanes(Math.max(1, Math.floor((row.clientHeight - head) / (lane + 2))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);

  const first = weeks[0][0];
  const end = addDays(weeks[weeks.length - 1][6], 1);
  const inRange = useMemo(
    () => data.events.filter((e) => overlapsDays(e, first, end)),
    [data.events, first, end],
  );
  const list = settings.monthSpecialOnly ? inRange.filter((e) => e.special) : inRange;
  const hidden = inRange.length - list.length;
  const heads = weeks[0].map(dayOfWeek);

  return (
    <div className="month">
      {settings.monthSpecialOnly && hidden > 0 && (
        <p className="month-hint">
          <Star size={12} />
          毎週の予定など {hidden} 件を隠しています
          <button type="button" onClick={() => setSettings({ monthSpecialOnly: false })}>
            すべて表示
          </button>
        </p>
      )}
      <div className="month-wd" aria-hidden="true">
        {heads.map((w) => (
          <span key={w} className={w === 0 ? 'sun' : w === 6 ? 'sat' : ''}>
            {WEEKDAYS[w]}
          </span>
        ))}
      </div>
      <div className="month-grid" ref={gridRef} style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((days) => {
          const weekEnd = addDays(days[6], 1);
          const bars = layoutWeek(
            days,
            list.filter((e) => overlapsDays(e, days[0], weekEnd)),
          );
          const { shown, more } = fitWeek(bars, maxLanes);
          return (
            <div className="mweek" key={days[0]}>
              <div className="mweek-cells">
                {days.map((d) => {
                  const w = dayOfWeek(d);
                  const n = Number(d.slice(8));
                  return (
                    <button
                      key={d}
                      type="button"
                      className={[
                        'mcell',
                        d.slice(0, 7) !== month ? 'out' : '',
                        d === now ? 'today' : '',
                        w === 0 ? 'sun' : w === 6 ? 'sat' : '',
                      ].join(' ')}
                      aria-label={`${d} の一日の画面を開く`}
                      onClick={() => navigate({ name: 'day', date: d })}
                    >
                      <span className="mday">{n === 1 ? `${Number(d.slice(5, 7))}月1日` : n}</span>
                      {data.diary.has(d) && (
                        <PenLine size={11} className="mdiary" aria-label="日記あり" />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="mweek-events">
                {shown.map((b) => (
                  <EventChip
                    key={b.item.id}
                    e={b.item}
                    bar={b.bar}
                    contLeft={b.contLeft}
                    contRight={b.contRight}
                    style={{ gridColumn: `${b.col + 1} / span ${b.span}`, gridRow: b.lane + 1 }}
                  />
                ))}
                {more.map((n, c) =>
                  n > 0 ? (
                    <button
                      key={`more-${c}`}
                      type="button"
                      className="chip chip-more"
                      style={{ gridColumn: c + 1, gridRow: maxLanes }}
                      onClick={() => navigate({ name: 'day', date: days[c] })}
                    >
                      他{n}件
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
