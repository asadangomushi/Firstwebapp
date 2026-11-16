// 週の画面：一週間分の実際の時間の使い方を、横棒の帯グラフで並べて見る。
import { Table } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Legend, StackedBars, TimelineBars, type BarRow, type TimelineRow } from '../components/Charts';
import { Empty, Segmented } from '../components/ui';
import { useData } from '../lib/data';
import { WEEKDAYS, dayOfWeek, fmtDuration, fmtHours, isLong, today, weekDays } from '../lib/date';
import { navigate } from '../lib/router';
import { setSettings, useSettings, type Settings } from '../lib/settings';
import {
  OTHER_KEY,
  applyFold,
  daySegments,
  foldKeys,
  niceMax,
  sumMinutes,
  totals,
  type Seg,
} from '../lib/stats';
import type { Actual } from '../lib/types';

export function TimeUseView({ date }: { date: string }) {
  const data = useData();
  const settings = useSettings();
  const [showTable, setShowTable] = useState(false);
  const days = useMemo(() => weekDays(date, settings.weekStartsOn), [date, settings.weekStartsOn]);
  const now = today();

  const { actual, plan } = useMemo(() => {
    const catOf = (a: Actual) => (a.categoryId ? data.catById.get(a.categoryId) : undefined);
    const timed = data.events.filter((e) => !isLong(e));
    return {
      actual: days.map((d) => daySegments(d, data.actuals, catOf)),
      plan: days.map((d) => daySegments(d, timed, (e) => e.cat)),
    };
  }, [days, data.actuals, data.events, data.catById]);

  // 色で見分けられる数を超えたら、少ない種類を「その他」にまとめる（週全体で決める）
  const weekRaw = totals(actual.flat(), data.categories);
  const fold = foldKeys(settings.timeUseShowPlan ? totals([...actual.flat(), ...plan.flat()], data.categories) : weekRaw);
  const week = applyFold(weekRaw, fold);
  const dayTotals = (segs: Seg[]) => applyFold(totals(segs, data.categories), fold);
  const foldSeg = (s: Seg): Seg =>
    fold.has(s.key) ? { ...s, key: OTHER_KEY, label: 'その他', color: 'gray' } : s;

  const label = (d: string) => {
    const w = dayOfWeek(d);
    return (
      <span className={`day-label ${d === now ? 'today' : ''} ${w === 0 ? 'sun' : w === 6 ? 'sat' : ''}`}>
        {Number(d.slice(5, 7))}/{Number(d.slice(8))}
        <small>{WEEKDAYS[w]}</small>
      </span>
    );
  };
  const open = (d: string) => () => navigate({ name: 'day', date: d });

  const weekSum = sumMinutes(week);
  const recordedDays = actual.filter((s) => s.length > 0).length;
  const max = niceMax(
    Math.max(
      60,
      ...actual.map((s) => sumMinutes(dayTotals(s))),
      ...(settings.timeUseShowPlan ? plan.map((s) => sumMinutes(dayTotals(s))) : []),
    ),
  );

  const barRows: BarRow[] = [];
  const lineRows: TimelineRow[] = [];
  days.forEach((d, i) => {
    if (settings.timeUseShowPlan) {
      barRows.push({ key: d + 'p', label: <span className="row-kind">予定</span>, totals: dayTotals(plan[i]), thin: true });
      lineRows.push({ key: d + 'p', label: <span className="row-kind">予定</span>, segs: plan[i].map(foldSeg), thin: true });
    }
    barRows.push({ key: d, label: label(d), totals: dayTotals(actual[i]), onClick: open(d) });
    lineRows.push({ key: d, label: label(d), segs: actual[i].map(foldSeg), onClick: open(d) });
  });

  return (
    <div className="page timeuse">
      <section className="card">
        <div className="tu-head">
          <div className="stat">
            <span className="stat-label">この週に記録した時間</span>
            <span className="stat-value">{fmtDuration(weekSum)}</span>
            <span className="stat-sub">
              {recordedDays > 0 ? `${recordedDays}日分・1日あたり ${fmtHours(weekSum / recordedDays)}` : 'まだ記録がありません'}
            </span>
          </div>
        </div>
        <Legend items={week} showShare />
      </section>

      <section className="card">
        <div className="tu-controls">
          <Segmented<Settings['timeUseMode']>
            small
            label="グラフの種類"
            value={settings.timeUseMode}
            onChange={(timeUseMode) => setSettings({ timeUseMode })}
            options={[
              { value: 'timeline', label: '時間帯', title: '何時に何をしていたか（0時〜24時）' },
              { value: 'total', label: '合計', title: '種類ごとの合計時間' },
            ]}
          />
          <label className="check-line">
            <input
              type="checkbox"
              checked={settings.timeUseShowPlan}
              onChange={(e) => setSettings({ timeUseShowPlan: e.target.checked })}
            />
            予定も並べる
          </label>
          <span className="spacer" />
          <button
            type="button"
            className={`btn btn-chip ${showTable ? 'on' : ''}`}
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
          >
            <Table size={15} />
            表で見る
          </button>
        </div>

        {weekSum === 0 && !settings.timeUseShowPlan ? (
          <Empty>
            この週の実績はまだありません。一日の画面で予定の「←」を押すと、実績にコピーできます。
          </Empty>
        ) : settings.timeUseMode === 'timeline' ? (
          <TimelineBars rows={lineRows} />
        ) : (
          <StackedBars rows={barRows} max={max} />
        )}

        {showTable && (
          <div className="table-wrap">
            <table className="data-table">
              <caption>種類ごとの実績（時間）</caption>
              <thead>
                <tr>
                  <th scope="col">種類</th>
                  {days.map((d) => (
                    <th scope="col" key={d}>
                      {Number(d.slice(8))}
                      <small>{WEEKDAYS[dayOfWeek(d)]}</small>
                    </th>
                  ))}
                  <th scope="col">計</th>
                </tr>
              </thead>
              <tbody>
                {week.map((t) => (
                  <tr key={t.key}>
                    <th scope="row">{t.label}</th>
                    {actual.map((segs, i) => {
                      const m = dayTotals(segs).find((x) => x.key === t.key)?.minutes ?? 0;
                      return <td key={days[i]}>{m ? fmtHours(m).replace('h', '') : '–'}</td>;
                    })}
                    <td>{fmtHours(t.minutes).replace('h', '')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">計</th>
                  {actual.map((segs, i) => {
                    const m = sumMinutes(dayTotals(segs));
                    return <td key={days[i]}>{m ? fmtHours(m).replace('h', '') : '–'}</td>;
                  })}
                  <td>{fmtHours(weekSum).replace('h', '')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
