// 週表示（Googleカレンダーと同じ時間の枠）。days が1日だけなら1日表示になる。
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EventChip, KindIcon } from '../components/EventChip';
import { HOUR, HourGutter, NowLine, boxStyle, pxToMinutes, rangeLabel, useNow } from '../components/TimeGrid';
import { chipVars } from '../lib/colors';
import { useData } from '../lib/data';
import {
  WEEKDAYS,
  addDays,
  atMinutes,
  clipToDay,
  dayOfWeek,
  isLong,
  onDay,
  overlapsDays,
  snap,
} from '../lib/date';
import { fitWeek, layoutDay, layoutWeek, type Box } from '../lib/layout';
import type { Resolved } from '../lib/resolve';
import { navigate } from '../lib/router';
import { useUI } from '../lib/ui-state';

const COLLAPSED_LANES = 3;

export function WeekView({ days }: { days: string[] }) {
  const data = useData();
  const ui = useUI();
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  const from = days[0];
  const to = addDays(days[days.length - 1], 1);
  const inRange = useMemo(
    () => data.events.filter((e) => overlapsDays(e, from, to)),
    [data.events, from, to],
  );
  const bars = useMemo(() => layoutWeek(days, inRange.filter(isLong)), [days, inRange]);
  const laneTotal = bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
  const maxLanes = expanded ? Math.max(laneTotal, 1) : COLLAPSED_LANES;
  const { shown, more } = fitWeek(bars, maxLanes, days.length);
  const lanes = Math.min(laneTotal, maxLanes);
  const hasToday = days.includes(now.day);

  // 開いたとき、今の時刻（今日以外は朝7時）のあたりが見えるようにする
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = hasToday ? Math.max(0, now.minutes - 120) : 7 * 60;
    el.scrollTop = (target / 60) * HOUR;
    // 日付が変わったときだけ動かす（1分ごとの更新では動かさない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, days.length]);

  const cols = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` } as CSSProperties;

  return (
    <div className="tg">
      <div className="tg-head">
        <div className="tg-corner" />
        <div className="tg-days" style={cols}>
          {days.map((d) => {
            const w = dayOfWeek(d);
            return (
              <button
                key={d}
                type="button"
                className={`tg-day ${d === now.day ? 'today' : ''} ${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}`}
                onClick={() => navigate({ name: 'day', date: d })}
                aria-label={`${d} の一日の画面を開く`}
              >
                <span className="tg-wd">{WEEKDAYS[w]}</span>
                <span className="tg-num">{Number(d.slice(8))}</span>
              </button>
            );
          })}
        </div>
      </div>

      {laneTotal > 0 && (
        <div className="tg-allday">
          <div className="tg-corner">
            {laneTotal > COLLAPSED_LANES && (
              <button
                type="button"
                className="icon-btn sm"
                aria-label={expanded ? '終日の予定をたたむ' : '終日の予定をすべて表示'}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
          </div>
          <div className="tg-allday-grid" style={{ ...cols, gridTemplateRows: `repeat(${lanes}, var(--lane-h))` }}>
            {shown.map((b) => (
              <EventChip
                key={b.item.id}
                e={b.item}
                bar
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
                  onClick={() => setExpanded(true)}
                >
                  他{n}件
                </button>
              ) : null,
            )}
          </div>
        </div>
      )}

      <div className="tg-scroll" ref={scroller}>
        <div className="tg-body" style={{ height: 24 * HOUR }}>
          <HourGutter />
          <div className="tg-cols" style={cols}>
            {days.map((d) => (
              <DayColumn
                key={d}
                day={d}
                events={inRange}
                nowMinutes={d === now.day ? now.minutes : null}
                onCreate={(m) =>
                  ui.openCreate({ start: atMinutes(d, m), end: atMinutes(d, m + 60) })
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  events,
  nowMinutes,
  onCreate,
}: {
  day: string;
  events: Resolved[];
  nowMinutes: number | null;
  onCreate: (minutes: number) => void;
}) {
  const boxes = useMemo(
    () =>
      layoutDay(
        events
          .filter((e) => !isLong(e) && onDay(e, day))
          .map((e) => {
            const [start, end] = clipToDay(e, day);
            return { item: e, start, end };
          }),
      ),
    [events, day],
  );

  return (
    <div
      className="tg-col"
      onClick={(ev) => {
        const rect = ev.currentTarget.getBoundingClientRect();
        const m = snap(pxToMinutes(ev.clientY - rect.top) - 15, 30);
        onCreate(Math.max(0, Math.min(23 * 60, m)));
      }}
    >
      {boxes.map((b) => (
        <EventBlock key={b.item.id} box={b} />
      ))}
      {nowMinutes !== null && <NowLine minutes={nowMinutes} />}
    </div>
  );
}

/** 時間の枠に置く予定のブロック */
export function EventBlock({ box, children }: { box: Box<Resolved>; children?: React.ReactNode }) {
  const e = box.item;
  const short = box.end - box.start < 45;
  return (
    <div
      className={`block ${short ? 'short' : ''} ${e.done ? 'done' : ''}`}
      style={{ ...boxStyle(box), ...chipVars(e.color) } as CSSProperties}
    >
      <button
        type="button"
        className="block-main"
        title={`${e.title} ${rangeLabel(box.start, box.end)}`}
        onClick={(ev) => {
          ev.stopPropagation();
          navigate({ name: 'event', id: e.id });
        }}
      >
        <span className="block-title">
          <KindIcon e={e} />
          {e.title}
        </span>
        <span className="block-time">{rangeLabel(box.start, box.end)}</span>
      </button>
      {children}
    </div>
  );
}
