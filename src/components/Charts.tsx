// 時間の使い方を表す横棒の帯グラフ。
// ・色は種類ごとに固定（並び順も固定）なので、日が変わっても同じ色は同じ種類を表す。
// ・色だけに頼らないよう、凡例に名前と時間を必ず出し、表でも見られるようにしている。
import { useState, type CSSProperties, type ReactNode } from 'react';
import { fill } from '../lib/colors';
import { MIN_PER_DAY, fmtDuration, fmtHours, minutesToTime } from '../lib/date';
import { sumMinutes, type Seg, type Total } from '../lib/stats';

interface Tip {
  x: number;
  y: number;
  value: string;
  label: string;
}

/** 帯にカーソルを合わせた（またはタップ・フォーカスした）ときの吹き出し */
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const bind = (value: string, label: string) => ({
    tabIndex: 0,
    role: 'img' as const,
    'aria-label': `${label} ${value}`,
    onPointerMove: (e: React.PointerEvent) => setTip({ x: e.clientX, y: e.clientY, value, label }),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ x: r.left + r.width / 2, y: r.top, value, label });
    },
    onBlur: () => setTip(null),
  });
  const node = tip ? (
    <div
      className="chart-tip"
      style={{
        left: Math.min(Math.max(tip.x, 90), window.innerWidth - 90),
        top: tip.y,
      }}
      role="tooltip"
    >
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  ) : null;
  return { bind, node };
}

/** 凡例。種類の名前と時間を並べる（色だけで読ませない）。 */
export function Legend({ items, showShare = false }: { items: Total[]; showShare?: boolean }) {
  const sum = sumMinutes(items);
  if (items.length === 0) return null;
  return (
    <ul className="legend">
      {items.map((t) => (
        <li key={t.key}>
          <span
            className="legend-swatch"
            style={{ background: fill(t.color) }}
            aria-hidden="true"
          />
          <span className="legend-name">{t.label}</span>
          <span className="legend-value">
            {fmtDuration(t.minutes)}
            {showShare && sum > 0 ? `（${Math.round((t.minutes / sum) * 100)}%）` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  totals: Total[];
  /** 細い帯にする（予定を実績の上に添えるときなど） */
  thin?: boolean;
  onClick?: () => void;
}

/** 種類ごとの合計を積み上げた横棒。行同士は同じ目盛りで比べられる。 */
export function StackedBars({ rows, max }: { rows: BarRow[]; max: number }) {
  const { bind, node } = useTip();
  const ticks = [0, max / 2, max];
  return (
    <div className="bars">
      {rows.map((row) => {
        const sum = sumMinutes(row.totals);
        let acc = 0;
        return (
          <div className={`bar-row ${row.thin ? 'thin' : ''}`} key={row.key}>
            <RowLabel row={row} />
            <div className="bar-track">
              {row.totals.map((t, i) => {
                const left = (acc / max) * 100;
                const width = (t.minutes / max) * 100;
                acc += t.minutes;
                const style: CSSProperties = {
                  left: `${left}%`,
                  width: `${width}%`,
                  background: fill(t.color),
                };
                return (
                  <span
                    key={t.key}
                    className={`bar-seg ${i === row.totals.length - 1 ? 'last' : ''}`}
                    style={style}
                    {...bind(fmtDuration(t.minutes), t.label)}
                  />
                );
              })}
              {sum > 0 && (
                <span className="bar-value" style={{ left: `${(sum / max) * 100}%` }}>
                  {fmtHours(sum)}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <div className="bar-row axis" aria-hidden="true">
        <span />
        <div className="bar-axis">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${(t / max) * 100}%` }}>
              {Math.round(t / 60)}時間
            </span>
          ))}
        </div>
      </div>
      {node}
    </div>
  );
}

export interface TimelineRow {
  key: string;
  label: ReactNode;
  segs: Seg[];
  thin?: boolean;
  onClick?: () => void;
}

/** 0時〜24時の帯。何時に何をしていたかが横に並ぶ。 */
export function TimelineBars({ rows }: { rows: TimelineRow[] }) {
  const { bind, node } = useTip();
  const hours = [0, 6, 12, 18, 24];
  return (
    <div className="bars timeline">
      {rows.map((row) => (
        <div className={`bar-row ${row.thin ? 'thin' : ''}`} key={row.key}>
          <RowLabel row={row} />
          <div className="bar-track day-track">
            {row.segs.map((s, i) => (
              <span
                key={i}
                className="bar-seg"
                style={{
                  left: `${(s.start / MIN_PER_DAY) * 100}%`,
                  width: `${((s.end - s.start) / MIN_PER_DAY) * 100}%`,
                  background: fill(s.color),
                }}
                {...bind(
                  `${minutesToTime(s.start)}–${s.end === MIN_PER_DAY ? '24:00' : minutesToTime(s.end)}`,
                  `${s.title}（${s.label}）`,
                )}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="bar-row axis" aria-hidden="true">
        <span />
        <div className="bar-axis">
          {hours.map((h) => (
            <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
              {h}時
            </span>
          ))}
        </div>
      </div>
      {node}
    </div>
  );
}

function RowLabel({ row }: { row: { label: ReactNode; onClick?: () => void } }) {
  if (!row.onClick) return <span className="bar-label">{row.label}</span>;
  return (
    <button type="button" className="bar-label link" onClick={row.onClick}>
      {row.label}
    </button>
  );
}
