// 予定の作成ダイアログ。くわしい情報は保存後に予定のページで書き足す。
import { useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { addDays, addMinutes, addMonths, toLocal, today } from '../lib/date';
import { LOCAL_CALENDAR } from '../lib/db';
import { matchCategory } from '../lib/resolve';
import { navigate } from '../lib/router';
import { useSettings } from '../lib/settings';
import { createEvent, type EventInput } from '../lib/store';
import { KIND_LABEL, type EventKind, type RepeatFreq } from '../lib/types';
import { useUI } from '../lib/ui-state';
import { Modal, PickerInput, Segmented } from './ui';

/** 開始時刻の初期値：今日なら次の正時、それ以外は9時 */
function defaultStart(day: string): string {
  if (day !== today()) return `${day}T09:00`;
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  // 23時台に開いても日付が翌日へずれないようにする
  return d.getDate() === new Date().getDate() ? toLocal(d) : `${day}T23:00`;
}

export function EventDialog({ init, onClose }: { init: Partial<EventInput>; onClose: () => void }) {
  const data = useData();
  const settings = useSettings();
  const ui = useUI();

  const initStart = init.start ?? today();
  const startDt = initStart.length > 10 ? initStart : defaultStart(initStart);
  const endDt = init.end && init.end.length > 10 ? init.end : addMinutes(startDt, 60);

  const [title, setTitle] = useState(init.title ?? '');
  const [kind, setKind] = useState<EventKind>(init.kind ?? 'normal');
  const [allDay, setAllDay] = useState(init.allDay ?? false);
  const [date, setDate] = useState(startDt.slice(0, 10));
  const [endDate, setEndDate] = useState(
    init.allDay && init.end ? addDays(init.end, -1) : startDt.slice(0, 10),
  );
  const [startTime, setStartTime] = useState(startDt.slice(11));
  const [endTime, setEndTime] = useState(endDt.slice(11));
  const [freq, setFreq] = useState<RepeatFreq>('none');
  const [until, setUntil] = useState(addMonths(startDt.slice(0, 10), 3));
  const [categoryId, setCategoryId] = useState(init.categoryId ?? '');
  const [projectId, setProjectId] = useState(init.projectId ?? '');
  const writable = data.calendars.filter((c) => c.writable);
  const [calendarId, setCalendarId] = useState(() => {
    const want = init.calendarId ?? settings.defaultCalendarId;
    return writable.some((c) => c.id === want) ? want : LOCAL_CALENDAR;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const guessed = useMemo(
    () => (categoryId ? undefined : matchCategory(title, data.categories)),
    [categoryId, title, data.categories],
  );
  const overnight = !allDay && endTime <= startTime;

  const save = async (openDetail: boolean) => {
    if (busy) return;
    setError('');
    let start: string;
    let end: string;
    if (allDay) {
      start = date;
      end = addDays(endDate < date ? date : endDate, 1);
    } else {
      start = `${date}T${startTime}`;
      // 終了が開始より前なら翌日まで続く予定（夜勤や睡眠）として扱う
      end = `${overnight ? addDays(date, 1) : date}T${endTime}`;
    }
    if (freq !== 'none' && until < date) {
      setError('繰り返しの終了日は開始日より後にしてください');
      return;
    }
    setBusy(true);
    try {
      const made = await createEvent(
        {
          title,
          start,
          end,
          allDay,
          kind,
          calendarId,
          categoryId: categoryId || undefined,
          projectId: projectId || undefined,
          parentId: init.parentId,
        },
        freq === 'none' ? undefined : { freq, until },
      );
      onClose();
      if (openDetail) navigate({ name: 'event', id: made.id });
      else ui.toast('予定を保存しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存できませんでした');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="予定を作成"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-text"
            disabled={busy}
            onClick={() => void save(true)}
          >
            詳細を書く
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void save(false)}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <input
          className="title-input"
          data-autofocus
          value={title}
          placeholder="タイトルを追加"
          aria-label="タイトル"
          onChange={(e) => setTitle(e.target.value)}
        />

        <Segmented<EventKind>
          label="予定の型"
          value={kind}
          onChange={setKind}
          options={(Object.keys(KIND_LABEL) as EventKind[]).map((k) => ({
            value: k,
            label: KIND_LABEL[k],
          }))}
        />

        <div className="field-row">
          <PickerInput
            type="date"
            value={date}
            aria-label="日付"
            onPick={(v) => {
              setDate(v);
              if (endDate < v) setEndDate(v);
            }}
          />
          {allDay ? (
            <>
              <span className="sep">–</span>
              <PickerInput
                type="date"
                value={endDate}
                min={date}
                aria-label="終了日"
                onPick={setEndDate}
              />
            </>
          ) : (
            <div className="time-pair">
              <PickerInput
                type="time"
                value={startTime}
                step={300}
                aria-label="開始時刻"
                onPick={setStartTime}
              />
              <span className="sep">–</span>
              <PickerInput
                type="time"
                value={endTime}
                step={300}
                aria-label="終了時刻"
                onPick={setEndTime}
              />
              {overnight && <span className="hint">翌日</span>}
            </div>
          )}
        </div>

        <label className="check-line">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          終日
        </label>

        <div className="field-row">
          <label className="field">
            <span>繰り返し</span>
            <select value={freq} onChange={(e) => setFreq(e.target.value as RepeatFreq)}>
              <option value="none">繰り返さない</option>
              <option value="daily">毎日</option>
              <option value="weekly">毎週</option>
              <option value="monthly">毎月</option>
            </select>
          </label>
          {freq !== 'none' && (
            <label className="field">
              <span>いつまで</span>
              <PickerInput type="date" value={until} min={date} onPick={setUntil} />
            </label>
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span>種類</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{guessed ? `自動（${guessed.name}）` : '自動 / なし'}</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {data.projects.length > 0 && (
            <label className="field">
              <span>プロジェクト</span>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">なし</option>
                {data.projects
                  .filter((p) => !p.archived || p.id === projectId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>

        {writable.length > 1 && (
          <label className="field">
            <span>カレンダー</span>
            <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {writable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="error">{error}</p>}
        {/* Enterキーで保存できるようにするための送信ボタン（見えない） */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
