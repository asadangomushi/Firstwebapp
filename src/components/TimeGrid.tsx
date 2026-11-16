// 時間の枠（週・日の画面）で共通に使う部品。
import { useEffect, useState, type CSSProperties } from 'react';
import { MIN_PER_DAY, minutesToTime, today } from '../lib/date';
import type { Box } from '../lib/layout';
import { MIN_VISUAL } from '../lib/layout';

/** 1時間の高さ（px）。tokens.css の --hour と同じ値にすること。 */
export const HOUR = 48;

export function HourGutter() {
  return (
    <div className="tg-gutter" aria-hidden="true">
      {Array.from({ length: 23 }, (_, i) => (
        <span key={i} style={{ top: (i + 1) * HOUR }}>
          {i + 1}:00
        </span>
      ))}
    </div>
  );
}

/** 1分ごとに更新される「今」 */
export function useNow(): { day: string; minutes: number } {
  const read = () => {
    const d = new Date();
    return { day: today(), minutes: d.getHours() * 60 + d.getMinutes() };
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const t = setInterval(() => setNow(read()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function NowLine({ minutes }: { minutes: number }) {
  return <div className="now-line" style={{ top: (minutes / 60) * HOUR }} aria-hidden="true" />;
}

/** 重なりを考えた位置と大きさ */
export function boxStyle<T>(b: Box<T>): CSSProperties {
  const dur = Math.max(b.end - b.start, MIN_VISUAL);
  return {
    top: (b.start / 60) * HOUR,
    height: (dur / 60) * HOUR - 2,
    left: `${(b.col / b.cols) * 100}%`,
    width: `calc(${100 / b.cols}% - 2px)`,
  };
}

/** 縦位置（px）→ 0時からの分 */
export function pxToMinutes(px: number): number {
  return Math.max(0, Math.min(MIN_PER_DAY, (px / HOUR) * 60));
}

export function rangeLabel(start: number, end: number): string {
  return `${minutesToTime(start).replace(/^0/, '')}–${minutesToTime(end).replace(/^0/, '')}`;
}
