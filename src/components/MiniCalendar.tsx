import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { WEEKDAYS, addMonths, fmtMonthTitle, monthGrid, startOfMonth, today } from '../lib/date';
import { useSettings } from '../lib/settings';
import { IconBtn } from './ui';

/** サイドバーの小さな月カレンダー */
export function MiniCalendar({ date, onPick }: { date: string; onPick: (d: string) => void }) {
  const { weekStartsOn } = useSettings();
  const [month, setMonth] = useState(startOfMonth(date));
  const now = today();

  // 表示中の日付が別の月へ移ったら追いかける
  useEffect(() => setMonth(startOfMonth(date)), [date]);

  const weeks = monthGrid(month, weekStartsOn);
  const heads = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);

  return (
    <div className="mini">
      <div className="mini-head">
        <span className="mini-title">{fmtMonthTitle(month)}</span>
        <IconBtn label="前の月" className="sm" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={18} />
        </IconBtn>
        <IconBtn label="次の月" className="sm" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight size={18} />
        </IconBtn>
      </div>
      <div className="mini-grid">
        {heads.map((w) => (
          <span key={w} className={`mini-wd ${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}`}>
            {WEEKDAYS[w]}
          </span>
        ))}
        {weeks.flat().map((d) => (
          <button
            key={d}
            type="button"
            className={[
              'mini-day',
              d.slice(0, 7) !== month.slice(0, 7) ? 'out' : '',
              d === now ? 'today' : '',
              d === date ? 'sel' : '',
            ].join(' ')}
            aria-label={d}
            aria-current={d === now ? 'date' : undefined}
            onClick={() => onPick(d)}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
}
