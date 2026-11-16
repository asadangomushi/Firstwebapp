// 一日の画面。右に予定、左に実際の時間の使い方（実績）を並べる。
// 予定の「←」を押すと実績にコピーされ、違った部分だけ直せばよい。
import { ArrowLeft, Check, CopyCheck, NotebookPen, Trash2, X } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { StackedBars } from '../components/Charts';
import { DaySide, daySideCount } from '../components/DaySide';
import { EventChip } from '../components/EventChip';
import {
  HOUR,
  HourGutter,
  NowLine,
  boxStyle,
  pxToMinutes,
  rangeLabel,
  useNow,
} from '../components/TimeGrid';
import { CommitInput, IconBtn, Modal } from '../components/ui';
import { chipVars, fill } from '../lib/colors';
import { useData } from '../lib/data';
import {
  MIN_PER_DAY,
  addDays,
  atMinutes,
  clipToDay,
  fmtDuration,
  isLong,
  minutesFrom,
  onDay,
  snap,
} from '../lib/date';
import { MIN_VISUAL, layoutDay, type Box } from '../lib/layout';
import type { Resolved } from '../lib/resolve';
import { daySegments, niceMax, sumMinutes, totals, type Total } from '../lib/stats';
import { addActual, copyToActual, deleteActual, updateActual } from '../lib/store';
import type { Actual } from '../lib/types';
import { useUI } from '../lib/ui-state';
import { EventBlock } from './WeekView';

const SNAP = 5;

export function DayView({ date }: { date: string }) {
  const data = useData();
  const ui = useUI();
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);

  const dayEvents = useMemo(() => data.events.filter((e) => onDay(e, date)), [data.events, date]);
  const longEvents = dayEvents.filter(isLong);
  const timed = useMemo(() => dayEvents.filter((e) => !isLong(e)), [dayEvents]);
  const dayActuals = useMemo(() => data.actuals.filter((a) => onDay(a, date)), [data.actuals, date]);
  const copied = new Set(dayActuals.map((a) => a.eventId).filter(Boolean));

  const planBoxes = useMemo(
    () =>
      layoutDay(
        timed.map((e) => {
          const [start, end] = clipToDay(e, date);
          return { item: e, start, end };
        }),
      ),
    [timed, date],
  );
  const actualBoxes = useMemo(
    () =>
      layoutDay(
        dayActuals.map((a) => {
          const [start, end] = clipToDay(a, date);
          return { item: a, start, end };
        }),
      ),
    [dayActuals, date],
  );

  const catOf = (a: Actual) => (a.categoryId ? data.catById.get(a.categoryId) : undefined);
  const planTotals = totals(daySegments(date, timed, (e) => e.cat), data.categories);
  const actualTotals = totals(daySegments(date, dayActuals, catOf), data.categories);
  const max = niceMax(Math.max(sumMinutes(planTotals), sumMinutes(actualTotals), 60));

  const selectedActual = selected ? dayActuals.find((a) => a.id === selected) : undefined;

  // 日付を変えたら選択を外し、今の時刻（今日以外は朝7時）のあたりを見せる
  useLayoutEffect(() => {
    setSelected(null);
    const el = scroller.current;
    if (!el) return;
    const target = date === now.day ? Math.max(0, now.minutes - 150) : 7 * 60;
    el.scrollTop = (target / 60) * HOUR;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const copy = async (e: Resolved) => {
    const made = await copyToActual({ ...e, categoryId: e.cat?.id });
    setSelected(made.id);
  };

  const copyAll = async () => {
    const rest = timed.filter((e) => !copied.has(e.id));
    for (const e of rest) await copyToActual({ ...e, categoryId: e.cat?.id });
    ui.toast(rest.length ? `${rest.length}件の予定を実績にコピーしました` : 'コピーする予定がありません');
  };

  const createActual = async (minutes: number) => {
    const start = Math.min(Math.floor(minutes / 15) * 15, MIN_PER_DAY - 15);
    // 次の実績にぶつからない長さにする（最大1時間）
    const nextStart = actualBoxes
      .map((b) => b.start)
      .filter((s) => s > start)
      .sort((a, b) => a - b)[0];
    const end = Math.min(start + 60, nextStart ?? MIN_PER_DAY, MIN_PER_DAY);
    const made = await addActual({
      start: atMinutes(date, start),
      end: atMinutes(date, Math.max(end, start + 15)),
      title: '',
      memo: '',
    });
    setSelected(made.id);
  };

  const sideCount = daySideCount(dayEvents);
  const uncopied = timed.filter((e) => !copied.has(e.id)).length;

  return (
    <div className="day">
      <div className="day-main">
        <div className="day-summary">
          <StackedBars
            max={max}
            rows={[
              { key: 'plan', label: '予定', totals: planTotals },
              { key: 'actual', label: '実績', totals: actualTotals },
            ]}
          />
          <DayLegend plan={planTotals} actual={actualTotals} />
        </div>

        <div className="day-cols-head">
          <div className="tg-corner" />
          <div className="day-col-title">
            <span>実績</span>
            <span className="day-col-sub">実際の時間の使い方</span>
          </div>
          <div className="day-col-title">
            <span>予定</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-chip"
              disabled={uncopied === 0}
              title="この日の予定をすべて実績にコピー"
              onClick={() => void copyAll()}
            >
              <CopyCheck size={15} />
              全部コピー
            </button>
          </div>
        </div>

        {longEvents.length > 0 && (
          <div className="day-allday">
            <div className="tg-corner">終日</div>
            <div className="day-allday-list">
              {longEvents.map((e) => (
                <EventChip key={e.id} e={e} bar />
              ))}
            </div>
          </div>
        )}

        <div className="tg-scroll" ref={scroller}>
          <div className="tg-body" style={{ height: 24 * HOUR }}>
            <HourGutter />
            <div className="tg-cols day-cols">
              <div
                className="tg-col actual-col"
                aria-label="実績"
                onClick={(ev) => {
                  if (selected) {
                    setSelected(null);
                    return;
                  }
                  const rect = ev.currentTarget.getBoundingClientRect();
                  void createActual(pxToMinutes(ev.clientY - rect.top));
                }}
              >
                {actualBoxes.length === 0 && (
                  <p className="col-empty">
                    予定の「←」を押すと、ここにコピーされます。空いているところを押すと、実績を直接書けます。
                  </p>
                )}
                {actualBoxes.map((b) => (
                  <ActualBlock
                    key={b.item.id}
                    box={b}
                    day={date}
                    color={catOf(b.item)?.color ?? 'gray'}
                    selected={selected === b.item.id}
                    onSelect={() => setSelected(b.item.id)}
                  />
                ))}
                {date === now.day && <NowLine minutes={now.minutes} />}
              </div>
              <div
                className="tg-col plan-col"
                aria-label="予定"
                onClick={(ev) => {
                  const rect = ev.currentTarget.getBoundingClientRect();
                  const m = snap(pxToMinutes(ev.clientY - rect.top) - 15, 30);
                  const start = Math.max(0, Math.min(23 * 60, m));
                  ui.openCreate({ start: atMinutes(date, start), end: atMinutes(date, start + 60) });
                }}
              >
                {planBoxes.map((b) => {
                  const done = copied.has(b.item.id);
                  return (
                    <EventBlock key={b.item.id} box={b}>
                      <button
                        type="button"
                        className={`copy-btn ${done ? 'done' : ''}`}
                        aria-label={
                          done ? `${b.item.title} は実績にコピー済み` : `${b.item.title} を実績にコピー`
                        }
                        title={done ? '実績にコピー済み' : '実績にコピー'}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (done) {
                            const a = dayActuals.find((x) => x.eventId === b.item.id);
                            if (a) setSelected(a.id);
                          } else {
                            void copy(b.item);
                          }
                        }}
                      >
                        {done ? <Check size={16} /> : <ArrowLeft size={16} />}
                      </button>
                    </EventBlock>
                  );
                })}
                {date === now.day && <NowLine minutes={now.minutes} />}
              </div>
            </div>
          </div>
        </div>

        {selectedActual ? (
          <ActualEditor a={selectedActual} onClose={() => setSelected(null)} />
        ) : (
          <button type="button" className="day-side-btn" onClick={() => setSideOpen(true)}>
            <NotebookPen size={18} />
            持ち物・やること・日記
            {sideCount > 0 && <span className="badge">{sideCount}</span>}
          </button>
        )}
      </div>

      <aside className="day-side" aria-label="この日のメモ">
        <DaySide date={date} events={dayEvents} />
      </aside>

      {sideOpen && (
        <Modal title="この日のメモ" onClose={() => setSideOpen(false)}>
          <DaySide date={date} events={dayEvents} />
        </Modal>
      )}
    </div>
  );
}

/** 予定と実績の時間を、種類ごとに並べて見せる凡例 */
function DayLegend({ plan, actual }: { plan: Total[]; actual: Total[] }) {
  const keys = new Map<string, Total>();
  for (const t of [...plan, ...actual]) if (!keys.has(t.key)) keys.set(t.key, t);
  const p = new Map(plan.map((t) => [t.key, t.minutes]));
  const a = new Map(actual.map((t) => [t.key, t.minutes]));
  if (keys.size === 0) return null;
  return (
    <ul className="legend">
      {[...keys.values()].map((t) => (
        <li key={t.key}>
          <span className="legend-swatch" style={{ background: fill(t.color) }} aria-hidden="true" />
          <span className="legend-name">{t.label}</span>
          <span className="legend-value">
            予 {p.has(t.key) ? fmtDuration(p.get(t.key)!) : '–'}／実{' '}
            {a.has(t.key) ? fmtDuration(a.get(t.key)!) : '–'}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Drag {
  mode: 'move' | 'top' | 'bottom';
  startY: number;
  s: number;
  e: number;
}

/** 実績のブロック。選んでから、上下の端をつまんで長さを、真ん中をつまんで位置を変えられる。 */
function ActualBlock({
  box,
  day,
  color,
  selected,
  onSelect,
}: {
  box: Box<Actual>;
  day: string;
  color: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const a = box.item;
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // その日の0時からの分。前日から続く実績は負の値、翌日へ続く実績は1440を超える。
  const s0 = minutesFrom(day, a.start);
  const e0 = minutesFrom(day, a.end);
  const canTop = s0 >= 0;
  const canBottom = e0 <= MIN_PER_DAY;
  const start = drag ? drag.s : s0;
  const end = drag ? drag.e : e0;
  const visStart = Math.max(0, start);
  const visEnd = Math.min(MIN_PER_DAY, end);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const begin = (mode: Drag['mode']) => (ev: ReactPointerEvent) => {
    if (!selected) return;
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setDrag({ mode, startY: ev.clientY, s: s0, e: e0 });
  };

  const move = (ev: ReactPointerEvent) => {
    if (!drag) return;
    const delta = snap(((ev.clientY - drag.startY) / HOUR) * 60, SNAP);
    let s = s0;
    let e = e0;
    if (drag.mode === 'move') {
      const d = Math.max(-s0, Math.min(MIN_PER_DAY - e0, delta));
      s += d;
      e += d;
    } else if (drag.mode === 'top') {
      s = Math.max(0, Math.min(e0 - SNAP, s0 + delta));
    } else {
      e = Math.min(MIN_PER_DAY, Math.max(s0 + SNAP, e0 + delta));
    }
    setDrag({ ...drag, s, e });
  };

  const finish = () => {
    if (!drag) return;
    if (drag.s !== s0 || drag.e !== e0) {
      void updateActual(a.id, { start: atMinutes(day, drag.s), end: atMinutes(day, drag.e) });
    }
    setDrag(null);
  };

  const style: CSSProperties = {
    ...boxStyle({ ...box, start: visStart, end: visEnd }),
    ...chipVars(color),
  } as CSSProperties;
  const short = visEnd - visStart < 45;

  return (
    <div
      ref={ref}
      className={`block actual ${selected ? 'sel' : ''} ${drag ? 'dragging' : ''} ${short ? 'short' : ''}`}
      style={style}
      onClick={(ev) => {
        ev.stopPropagation();
        onSelect();
      }}
      onPointerDown={selected && canTop && canBottom ? begin('move') : undefined}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <button
        type="button"
        className="block-main"
        aria-label={`${a.title || '（無題）'} ${rangeLabel(visStart, visEnd)} を編集`}
        aria-pressed={selected}
      >
        <span className="block-title">{a.title || '（無題）'}</span>
        <span className="block-time">
          {rangeLabel(visStart, visEnd)}
          {Math.max(visEnd - visStart, 0) >= MIN_VISUAL && !short
            ? `・${fmtDuration(end - start)}`
            : ''}
        </span>
      </button>
      {selected && canTop && (
        <span className="handle top" onPointerDown={begin('top')} aria-hidden="true" />
      )}
      {selected && canBottom && (
        <span className="handle bottom" onPointerDown={begin('bottom')} aria-hidden="true" />
      )}
    </div>
  );
}

/** 選んだ実績の編集欄（画面の下に出る）。時刻は入力でも直せる。 */
function ActualEditor({ a, onClose }: { a: Actual; onClose: () => void }) {
  const data = useData();
  const startDay = a.start.slice(0, 10);
  const startTime = a.start.slice(11);

  return (
    <div className="actual-editor" role="region" aria-label="実績の編集">
      <div className="ae-row">
        <CommitInput
          className="ae-title"
          value={a.title}
          placeholder="何をしていた？"
          aria-label="実績の内容"
          onCommit={(title) => void updateActual(a.id, { title })}
        />
        <IconBtn
          label="この実績を削除"
          onClick={() => {
            void deleteActual(a.id);
            onClose();
          }}
        >
          <Trash2 size={20} />
        </IconBtn>
        <IconBtn label="編集を終える" onClick={onClose}>
          <X size={20} />
        </IconBtn>
      </div>
      <div className="ae-row">
        <input
          type="time"
          step={300}
          value={startTime}
          aria-label="開始時刻"
          onChange={(ev) => {
            const v = ev.target.value;
            if (!v) return;
            const start = `${startDay}T${v}`;
            // 開始だけを動かす（終了はそのまま）。追い越したら15分の長さにする。
            const end = start < a.end ? a.end : atMinutes(startDay, minutesFrom(startDay, start) + 15);
            void updateActual(a.id, { start, end });
          }}
        />
        <span className="sep">–</span>
        <input
          type="time"
          step={300}
          value={a.end.slice(11)}
          aria-label="終了時刻"
          onChange={(ev) => {
            const v = ev.target.value;
            if (!v) return;
            const endDay = v <= startTime ? addDays(startDay, 1) : startDay;
            void updateActual(a.id, { end: `${endDay}T${v}` });
          }}
        />
        <select
          value={a.categoryId ?? ''}
          aria-label="種類"
          onChange={(ev) => void updateActual(a.id, { categoryId: ev.target.value || undefined })}
        >
          <option value="">種類なし</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
