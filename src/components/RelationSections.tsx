// 予定同士のつながりと、締切までの逆算計画。
import { ListChecks, Network, Plus, Sparkles, Unlink, X } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { chipVars } from '../lib/colors';
import { useData } from '../lib/data';
import {
  addDays,
  diffDays,
  fmtDayShort,
  fmtEventWhen,
  fmtRelative,
  startKey,
  today,
} from '../lib/date';
import type { Resolved } from '../lib/resolve';
import { navigate } from '../lib/router';
import {
  addStep,
  createEvent,
  deleteEvent,
  linkEvents,
  unlinkEvents,
  updateEvent,
} from '../lib/store';
import { useUI } from '../lib/ui-state';
import { Section } from './EventSections';
import { CommitInput, Empty, IconBtn, Modal } from './ui';

// ---- 逆算計画 ----

/** 締切から見て何日前か */
function beforeLabel(deadline: string, date: string): string {
  const n = diffDays(date, deadline);
  if (n === 0) return '当日';
  return n > 0 ? `${n}日前` : `${-n}日後`;
}

export function PlanSection({ e }: { e: Resolved }) {
  const data = useData();
  const ui = useUI();
  const steps = data.steps.get(e.id) ?? [];
  const deadline = e.start.slice(0, 10);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => {
    const d = addDays(deadline, -1);
    return d < today() ? today() : d;
  });
  const done = steps.filter((s) => s.done).length;

  const add = () => {
    const t = title.trim();
    if (!t) return;
    void addStep({ id: e.id, categoryId: e.cat?.id, projectId: e.project?.id }, t, date);
    setTitle('');
  };

  return (
    <Section
      icon={<ListChecks size={18} />}
      title="計画（いつまでに何をやるか）"
      count={steps.length ? `${done} / ${steps.length}` : undefined}
      hint="ステップは同じカレンダーに並びます。締切から逆算して日付を置いてください。"
    >
      {steps.length > 0 && (
        <div
          className="progress"
          role="progressbar"
          aria-label="計画の進み具合"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
        >
          <span style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      )}
      <ul className="list">
        {steps.map((s) => (
          <li key={s.id} className={`list-item step-item ${s.done ? 'done' : ''}`}>
            <input
              type="checkbox"
              checked={!!s.done}
              aria-label={`${s.title} を完了にする`}
              onChange={(ev) => void updateEvent(s.id, { done: ev.target.checked })}
            />
            <div className="list-main">
              <CommitInput
                className="plain-input"
                value={s.title}
                aria-label="ステップの内容"
                onCommit={(t) => t.trim() && void updateEvent(s.id, { title: t.trim() })}
              />
              <span className="list-sub">
                締切の{beforeLabel(deadline, s.start)}・{fmtRelative(s.start)}
              </span>
            </div>
            <input
              type="date"
              className="step-date"
              value={s.start.slice(0, 10)}
              aria-label="ステップの日付"
              onChange={(ev) => {
                const v = ev.target.value;
                if (v) void updateEvent(s.id, { start: v, end: addDays(v, 1), allDay: true });
              }}
            />
            <IconBtn label="ステップを削除" onClick={() => void deleteEvent(s.id)}>
              <X size={18} />
            </IconBtn>
          </li>
        ))}
      </ul>
      <form
        className="add-row"
        onSubmit={(ev) => {
          ev.preventDefault();
          add();
        }}
      >
        <input
          value={title}
          placeholder="ステップを追加（例：資料を集める）"
          aria-label="ステップの内容"
          onChange={(ev) => setTitle(ev.target.value)}
        />
        <input
          type="date"
          value={date}
          aria-label="ステップの日付"
          onChange={(ev) => ev.target.value && setDate(ev.target.value)}
        />
        <button type="submit" className="btn btn-text" disabled={!title.trim()}>
          追加
        </button>
      </form>
      <button
        type="button"
        className="btn btn-tonal"
        onClick={() =>
          ui.openChat(
            `「${e.title}」（${fmtEventWhen(e)}）までの逆算計画を立てて、計画ステップとして追加して。`,
          )
        }
      >
        <Sparkles size={18} />
        Claudeに計画を立ててもらう
      </button>
    </Section>
  );
}

// ---- 関連する予定 ----

export function RelatedSection({ e }: { e: Resolved }) {
  const data = useData();
  const [picking, setPicking] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(e.start.slice(0, 10));

  const related = e.relatedIds
    .map((id) => data.byId.get(id))
    .filter((x): x is Resolved => !!x)
    .sort((a, b) => startKey(a).localeCompare(startKey(b)));

  const createLinked = async () => {
    const t = title.trim();
    if (!t) return;
    const made = await createEvent({
      title: t,
      start: date,
      end: addDays(date, 1),
      allDay: true,
      categoryId: e.cat?.id,
      projectId: e.project?.id,
    });
    await linkEvents(e.id, made.id);
    setTitle('');
  };

  return (
    <Section
      icon={<Network size={18} />}
      title="関連する予定"
      count={related.length ? String(related.length) : undefined}
      hint="試験に出願日や入金期限をつなげておくと、ここからすぐ飛べます。"
    >
      <ul className="list">
        {related.map((r) => (
          <li key={r.id} className="list-item">
            <button
              type="button"
              className="list-main list-open rel-item"
              style={chipVars(r.color) as CSSProperties}
              onClick={() => navigate({ name: 'event', id: r.id })}
            >
              <span className="rel-mark" aria-hidden="true" />
              <span>
                <span className="list-name">{r.title}</span>
                <span className="list-sub">
                  {fmtEventWhen(r)}・{fmtRelative(r.start)}
                </span>
              </span>
            </button>
            <IconBtn label="つながりを外す" onClick={() => void unlinkEvents(e.id, r.id)}>
              <Unlink size={18} />
            </IconBtn>
          </li>
        ))}
      </ul>
      <form
        className="add-row"
        onSubmit={(ev) => {
          ev.preventDefault();
          void createLinked();
        }}
      >
        <input
          value={title}
          placeholder="新しく作ってつなげる（例：出願日）"
          aria-label="新しい関連予定の名前"
          onChange={(ev) => setTitle(ev.target.value)}
        />
        <input
          type="date"
          value={date}
          aria-label="新しい関連予定の日付"
          onChange={(ev) => ev.target.value && setDate(ev.target.value)}
        />
        <button type="submit" className="btn btn-text" disabled={!title.trim()}>
          追加
        </button>
      </form>
      <button type="button" className="btn btn-tonal" onClick={() => setPicking(true)}>
        <Plus size={18} />
        すでにある予定をつなげる
      </button>
      {picking && (
        <EventPicker
          title="つなげる予定を選ぶ"
          exclude={[e.id, ...e.relatedIds]}
          onPick={(id) => {
            void linkEvents(e.id, id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Section>
  );
}

// ---- 予定を選ぶダイアログ ----

export function EventPicker({
  title,
  exclude = [],
  onPick,
  onClose,
}: {
  title: string;
  exclude?: string[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const data = useData();
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const skip = new Set(exclude);
    const now = today();
    const text = q.trim().toLowerCase();
    return data.all
      .filter((e) => !skip.has(e.id) && (!text || e.title.toLowerCase().includes(text)))
      .sort((a, b) => {
        // これからの予定を近い順に、そのあと過ぎた予定を新しい順に
        const fa = a.start.slice(0, 10) >= now;
        const fb = b.start.slice(0, 10) >= now;
        if (fa !== fb) return fa ? -1 : 1;
        return fa ? startKey(a).localeCompare(startKey(b)) : startKey(b).localeCompare(startKey(a));
      })
      .slice(0, 60);
  }, [data.all, exclude, q]);

  return (
    <Modal title={title} onClose={onClose}>
      <input
        className="search-input"
        data-autofocus
        value={q}
        placeholder="予定の名前でさがす"
        aria-label="予定をさがす"
        onChange={(ev) => setQ(ev.target.value)}
      />
      {list.length === 0 ? (
        <Empty>当てはまる予定がありません。</Empty>
      ) : (
        <ul className="list picker-list">
          {list.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="list-item list-open rel-item"
                style={chipVars(e.color) as CSSProperties}
                onClick={() => onPick(e.id)}
              >
                <span className="rel-mark" aria-hidden="true" />
                <span className="list-main">
                  <span className="list-name">{e.title}</span>
                  <span className="list-sub">
                    {fmtDayShort(e.start)}
                    {e.recurring ? '・繰り返し' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
