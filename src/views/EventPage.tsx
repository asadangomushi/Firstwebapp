// 予定のページ。Googleカレンダーの予定に、手帳らしい情報を書き足す場所。
import {
  AlignLeft,
  CalendarDays,
  Clock,
  CornerLeftUp,
  FolderKanban,
  MapPin,
  Repeat,
  Star,
  Tag,
  Trash2,
} from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  CheckSection,
  ExamSection,
  FilesSection,
  LinksSection,
} from '../components/EventSections';
import { PlanSection, RelatedSection } from '../components/RelationSections';
import { CommitInput, Empty, IconBtn, Segmented } from '../components/ui';
import { chipVars } from '../lib/colors';
import { useData } from '../lib/data';
import { addDays, addMinutes, diffDays, diffMinutes, fmtEventWhen } from '../lib/date';
import { matchCategory, type Resolved } from '../lib/resolve';
import { goBack, navigate } from '../lib/router';
import { deleteEvent, setEventMeta, updateEvent, type Scope } from '../lib/store';
import { KIND_LABEL, type EventKind, type PlannerEvent } from '../lib/types';
import { useUI } from '../lib/ui-state';

export function EventPage({ id }: { id: string }) {
  const data = useData();
  const ui = useUI();
  const e = data.byId.get(id);
  const [scope, setScope] = useState<Scope>('one');

  if (!e) {
    return (
      <div className="page">
        <Empty>この予定は見つかりませんでした（削除されたかもしれません）。</Empty>
        <button type="button" className="btn btn-tonal" onClick={goBack}>
          戻る
        </button>
      </div>
    );
  }

  const parent = e.parentId ? data.byId.get(e.parentId) : undefined;
  const meta = e.seriesId ? data.series.get(e.seriesId) : e;
  const guessed = meta?.categoryId ? undefined : matchCategory(e.title, data.categories);

  const save = (patch: Partial<PlannerEvent>, s: Scope = scope) => {
    void updateEvent(e.id, patch, s).catch((err: unknown) =>
      ui.toast(err instanceof Error ? err.message : '保存できませんでした'),
    );
  };
  // リンクや持ち物など、その回だけの情報
  const saveOwn = (patch: Partial<PlannerEvent>) => save(patch, 'one');

  const remove = async () => {
    const stepCount = data.steps.get(e.id)?.length ?? 0;
    const note = stepCount > 0 ? `計画のステップ ${stepCount} 件も一緒に削除されます。` : '';
    const answer = await ui.confirm(
      e.recurring
        ? {
            title: '繰り返しの予定を削除',
            message: `「${e.title}」を削除します。${note}`,
            actions: [
              { label: 'この予定のみ', value: 'one', danger: true },
              { label: 'すべての回', value: 'all', danger: true },
            ],
          }
        : {
            title: '予定を削除',
            message: `「${e.title}」を削除します。${note}`,
            actions: [{ label: '削除', value: 'one', danger: true }],
          },
    );
    if (!answer) return;
    await deleteEvent(e.id, answer as Scope);
    ui.toast('予定を削除しました');
    goBack();
  };

  return (
    <div className="page event-page" style={chipVars(e.color) as CSSProperties}>
      <div className="ep-head">
        <div className="ep-stripe" aria-hidden="true" />
        <div className="ep-toolbar">
          <Segmented<EventKind>
            small
            label="予定の型"
            value={e.kind}
            onChange={(kind) => saveOwn({ kind })}
            options={(Object.keys(KIND_LABEL) as EventKind[]).map((k) => ({
              value: k,
              label: KIND_LABEL[k],
            }))}
          />
          <span className="spacer" />
          <button
            type="button"
            className={`btn btn-chip ${e.special ? 'on' : ''}`}
            aria-pressed={e.special}
            title="月表示に出す特別な予定にする"
            onClick={() => void setEventMeta(e, { monthVisible: !e.special })}
          >
            <Star size={16} fill={e.special ? 'currentColor' : 'none'} />
            月表示に出す
          </button>
          <IconBtn label="削除" onClick={() => void remove()}>
            <Trash2 size={20} />
          </IconBtn>
        </div>
        {parent && (
          <button
            type="button"
            className="crumb"
            onClick={() => navigate({ name: 'event', id: parent.id })}
          >
            <CornerLeftUp size={14} />
            「{parent.title}」の計画ステップ
          </button>
        )}
        <CommitInput
          className="ep-title"
          value={e.title}
          aria-label="タイトル"
          placeholder="タイトル"
          disabled={!e.editable}
          onCommit={(title) => save({ title: title.trim() || '（タイトルなし）' })}
        />
        <p className="ep-when">{fmtEventWhen(e)}</p>
      </div>

      <section className="card">
        {e.parentId && (
          <label className="check-line step-done">
            <input
              type="checkbox"
              checked={!!e.done}
              onChange={(ev) => saveOwn({ done: ev.target.checked })}
            />
            このステップは完了
          </label>
        )}
        <Row icon={<Clock size={18} />} label="日時">
          <WhenEditor e={e} onChange={save} />
        </Row>
        {e.recurring && (
          <Row icon={<Repeat size={18} />} label="繰り返し">
            <div className="stack">
              <span>繰り返しの予定です。題名・時刻・場所・メモの変更を</span>
              <Segmented<Scope>
                small
                label="変更の適用先"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'one', label: 'この回だけに反映' },
                  { value: 'all', label: 'すべての回に反映' },
                ]}
              />
            </div>
          </Row>
        )}
        <Row icon={<Tag size={18} />} label="種類">
          <select
            value={meta?.categoryId ?? ''}
            aria-label="種類"
            onChange={(ev) => void setEventMeta(e, { categoryId: ev.target.value || null })}
          >
            <option value="">{guessed ? `自動（${guessed.name}）` : 'なし'}</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Row>
        <Row icon={<FolderKanban size={18} />} label="プロジェクト">
          <select
            value={meta?.projectId ?? ''}
            aria-label="プロジェクト"
            onChange={(ev) => void setEventMeta(e, { projectId: ev.target.value || null })}
          >
            <option value="">なし</option>
            {data.projects
              .filter((p) => !p.archived || p.id === meta?.projectId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          {e.project && (
            <button
              type="button"
              className="btn btn-text"
              onClick={() => navigate({ name: 'project', id: e.project!.id })}
            >
              流れを見る
            </button>
          )}
        </Row>
        {e.recurring && (
          <p className="row-note">種類・プロジェクト・月表示の設定は、繰り返しのすべての回に効きます。</p>
        )}
        <Row icon={<CalendarDays size={18} />} label="カレンダー">
          <span>
            {e.calendar?.name ?? '手帳（この端末）'}
            {!e.editable && '（読み取り専用）'}
            {e.sync && <span className="pill">Googleへ未送信</span>}
          </span>
        </Row>
        <Row icon={<MapPin size={18} />} label="場所">
          <CommitInput
            value={e.location}
            placeholder="場所を追加"
            aria-label="場所"
            disabled={!e.editable}
            onCommit={(location) => save({ location })}
          />
        </Row>
        <Row icon={<AlignLeft size={18} />} label="メモ">
          <CommitInput
            multiline
            rows={3}
            value={e.memo}
            placeholder="メモを追加"
            aria-label="メモ"
            disabled={!e.editable}
            onCommit={(memo) => save({ memo })}
          />
        </Row>
      </section>

      {e.kind === 'exam' && <ExamSection e={e} onSave={saveOwn} />}
      {!e.parentId && <PlanSection e={e} />}
      <LinksSection e={e} onSave={saveOwn} />
      <FilesSection e={e} kind="material" />
      <FilesSection e={e} kind="note" />
      <CheckSection e={e} field="belongings" onSave={saveOwn} />
      <CheckSection e={e} field="submissions" onSave={saveOwn} />
      <RelatedSection e={e} />
    </div>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="row-icon" title={label} aria-hidden="true">
        {icon}
      </span>
      <div className="row-body">{children}</div>
    </div>
  );
}

/** 日時の編集。同じ日（または翌朝まで）の予定は「日付＋開始＋終了」で手早く直せる。 */
function WhenEditor({ e, onChange }: { e: Resolved; onChange: (p: Partial<PlannerEvent>) => void }) {
  const disabled = !e.editable;

  if (e.allDay) {
    const last = addDays(e.end, -1);
    return (
      <div className="when">
        <input
          type="date"
          value={e.start}
          aria-label="開始日"
          disabled={disabled}
          onChange={(ev) => {
            const v = ev.target.value;
            if (!v) return;
            onChange({ start: v, end: addDays(e.end, diffDays(e.start, v)) });
          }}
        />
        <span className="sep">–</span>
        <input
          type="date"
          value={last}
          min={e.start}
          aria-label="終了日"
          disabled={disabled}
          onChange={(ev) => {
            const v = ev.target.value;
            if (v) onChange({ end: addDays(v < e.start ? e.start : v, 1) });
          }}
        />
        <AllDayToggle e={e} onChange={onChange} />
      </div>
    );
  }

  const day = e.start.slice(0, 10);
  const dur = diffMinutes(e.start, e.end);
  const compact = dur < 24 * 60;

  return (
    <div className="when">
      {compact ? (
        <>
          <input
            type="date"
            value={day}
            aria-label="日付"
            disabled={disabled}
            onChange={(ev) => {
              const v = ev.target.value;
              if (!v) return;
              const start = v + e.start.slice(10);
              onChange({ start, end: addMinutes(start, dur) });
            }}
          />
          <input
            type="time"
            step={300}
            value={e.start.slice(11)}
            aria-label="開始時刻"
            disabled={disabled}
            onChange={(ev) => {
              const v = ev.target.value;
              if (!v) return;
              // 開始を動かしたら長さはそのままにする
              const start = `${day}T${v}`;
              onChange({ start, end: addMinutes(start, dur) });
            }}
          />
          <span className="sep">–</span>
          <input
            type="time"
            step={300}
            value={e.end.slice(11)}
            aria-label="終了時刻"
            disabled={disabled}
            onChange={(ev) => {
              const v = ev.target.value;
              if (!v) return;
              const endDay = v <= e.start.slice(11) ? addDays(day, 1) : day;
              onChange({ end: `${endDay}T${v}` });
            }}
          />
          {e.end.slice(0, 10) !== day && <span className="hint">翌日</span>}
        </>
      ) : (
        <>
          <input
            type="datetime-local"
            value={e.start}
            aria-label="開始"
            disabled={disabled}
            onChange={(ev) => {
              const v = ev.target.value.slice(0, 16);
              if (v) onChange({ start: v, end: addMinutes(v, dur) });
            }}
          />
          <span className="sep">–</span>
          <input
            type="datetime-local"
            value={e.end}
            min={e.start}
            aria-label="終了"
            disabled={disabled}
            onChange={(ev) => {
              const v = ev.target.value.slice(0, 16);
              if (v && v > e.start) onChange({ end: v });
            }}
          />
        </>
      )}
      <AllDayToggle e={e} onChange={onChange} />
    </div>
  );
}

function AllDayToggle({ e, onChange }: { e: Resolved; onChange: (p: Partial<PlannerEvent>) => void }) {
  return (
    <label className="check-line">
      <input
        type="checkbox"
        checked={e.allDay}
        disabled={!e.editable}
        onChange={(ev) => {
          const day = e.start.slice(0, 10);
          if (ev.target.checked) onChange({ allDay: true, start: day, end: addDays(day, 1) });
          else onChange({ allDay: false, start: `${day}T09:00`, end: `${day}T10:00` });
        }}
      />
      終日
    </label>
  );
}
