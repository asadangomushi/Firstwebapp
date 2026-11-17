// 実績をCSVで書き出すダイアログ。期間と中身を選んで、ファイルとして保存する。
import { Download } from 'lucide-react';
import { useState } from 'react';
import { download } from '../lib/backup';
import { actualsIn, detailCsv, summaryCsv } from '../lib/csv';
import { useData } from '../lib/data';
import { addDays, addMonths, startOfMonth } from '../lib/date';
import { useUI } from '../lib/ui-state';
import { Modal, PickerInput, Segmented } from './ui';

type Period = 'week' | 'month' | 'custom';
type Kind = 'detail' | 'summary';

export function ExportDialog({ days, onClose }: { days: string[]; onClose: () => void }) {
  const data = useData();
  const ui = useUI();
  const [period, setPeriod] = useState<Period>('week');
  const [kind, setKind] = useState<Kind>('detail');
  const [from, setFrom] = useState(days[0]);
  const [to, setTo] = useState(days[days.length - 1]);

  // 「この月」は、いま見ている週の初日がある月にする
  const month = startOfMonth(days[0]);
  const range: [string, string] =
    period === 'week'
      ? [days[0], days[days.length - 1]]
      : period === 'month'
        ? [month, addDays(addMonths(month, 1), -1)]
        : from <= to
          ? [from, to]
          : [to, from];
  const count = actualsIn(data.actuals, range[0], range[1]).length;

  const save = () => {
    const input = {
      actuals: data.actuals,
      categories: data.categories,
      eventTitle: (id: string) => data.byId.get(id)?.title,
      from: range[0],
      to: range[1],
    };
    const text = kind === 'detail' ? detailCsv(input) : summaryCsv(input);
    // ファイル名は英数字だけにする（日本語を含むと、ブラウザによっては「download」という名前になり、
    // スマホで開けなくなるため）
    const name = `techo-${kind === 'detail' ? 'actuals' : 'daily-totals'}_${range[0]}_${range[1]}.csv`;
    download(new Blob([text], { type: 'text/csv;charset=utf-8' }), name);
    ui.toast(`「${name}」を保存しました`);
    onClose();
  };

  return (
    <Modal
      title="実績を書き出す（CSV）"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-text" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="btn btn-primary" disabled={count === 0} onClick={save}>
            <Download size={18} />
            書き出す
          </button>
        </>
      }
    >
      <div className="form">
        <div className="field">
          <span>期間</span>
          <Segmented<Period>
            small
            label="期間"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'week', label: 'この週' },
              { value: 'month', label: 'この月' },
              { value: 'custom', label: '期間を指定' },
            ]}
          />
        </div>
        {period === 'custom' && (
          <div className="field-row">
            <PickerInput type="date" value={from} aria-label="最初の日" onPick={setFrom} />
            <span className="sep">–</span>
            <PickerInput type="date" value={to} aria-label="最後の日" onPick={setTo} />
          </div>
        )}
        <div className="field">
          <span>中身</span>
          <Segmented<Kind>
            small
            label="中身"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'detail', label: '1件ずつ' },
              { value: 'summary', label: '日ごとの合計' },
            ]}
          />
          <p className="section-hint">
            {kind === 'detail'
              ? '実績1件を1行にします（開始・終了・時間・内容・種類・元の予定・メモ）。'
              : '1日を1行にして、種類ごとの時間を並べます。日をまたぐ実績は、それぞれの日に分けて数えます。'}
          </p>
        </div>
        <p className="status-text">
          {range[0]} 〜 {range[1]}：実績 {count} 件{count === 0 && '（書き出すものがありません）'}
        </p>
        <p className="section-hint">Excel や Google スプレッドシートで開けます。</p>
      </div>
    </Modal>
  );
}
