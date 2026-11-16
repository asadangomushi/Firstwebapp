// プロジェクト：予定をまとめ、プロジェクトごとの予定の流れを確認する。
import { Archive, ArchiveRestore, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { KindIcon } from '../components/EventChip';
import { ColorPicker, CommitInput, Empty, IconBtn } from '../components/ui';
import { chipVars, fill } from '../lib/colors';
import { useData } from '../lib/data';
import { fmtDayShort, fmtMonthTitle, fmtRelative, fmtTime, lastDay, startKey, today } from '../lib/date';
import type { Resolved } from '../lib/resolve';
import { goBack, navigate } from '../lib/router';
import { deleteProject, saveProject, updateEvent } from '../lib/store';
import { KIND_LABEL, type Project } from '../lib/types';
import { useUI } from '../lib/ui-state';

/** 繰り返しの予定は数が多いので、流れの中では「これからの次の1回」だけを出す */
function flowEvents(events: Resolved[], projectId: string): Resolved[] {
  const now = today();
  const mine = events
    .filter((e) => e.project?.id === projectId)
    .sort((a, b) => startKey(a).localeCompare(startKey(b)));
  const seen = new Set<string>();
  const out: Resolved[] = [];
  for (const e of mine) {
    if (!e.seriesId) {
      out.push(e);
      continue;
    }
    if (lastDay(e) < now || seen.has(e.seriesId)) continue;
    seen.add(e.seriesId);
    out.push(e);
  }
  return out;
}

export function ProjectsPage() {
  const data = useData();
  const [name, setName] = useState('');
  const now = today();

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const used = new Set(data.projects.map((p) => p.color));
    const order = ['violet', 'aqua', 'orange', 'blue', 'magenta', 'green', 'yellow', 'red'];
    const p = await saveProject({ name: n, color: order.find((k) => !used.has(k)) ?? 'violet' });
    setName('');
    navigate({ name: 'project', id: p.id });
  };

  const active = data.projects.filter((p) => !p.archived);
  const archived = data.projects.filter((p) => p.archived);

  const card = (p: Project) => {
    const list = flowEvents(data.all, p.id);
    const next = list.find((e) => lastDay(e) >= now);
    const steps = list.filter((e) => e.parentId);
    const done = steps.filter((e) => e.done).length;
    return (
      <li key={p.id}>
        <button
          type="button"
          className="proj-card"
          style={{ '--chip': fill(p.color) } as CSSProperties}
          onClick={() => navigate({ name: 'project', id: p.id })}
        >
          <span className="proj-mark" aria-hidden="true" />
          <span className="proj-body">
            <span className="proj-name">{p.name}</span>
            <span className="list-sub">
              予定 {list.length} 件
              {steps.length > 0 ? `・ステップ ${done} / ${steps.length}` : ''}
            </span>
            <span className="list-sub">
              {next ? `次：${fmtDayShort(next.start)} ${next.title}（${fmtRelative(next.start)}）` : 'これからの予定はありません'}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="page">
      <section className="card">
        <h2>プロジェクト</h2>
        <p className="section-hint">
          試験・就活・旅行など、ひとまとまりの予定をプロジェクトに分けておくと、予定の流れを一目で確認できます。
        </p>
        {active.length === 0 ? (
          <Empty>まだプロジェクトがありません。</Empty>
        ) : (
          <ul className="proj-list">{active.map(card)}</ul>
        )}
        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            value={name}
            placeholder="プロジェクトを追加（例：英語検定）"
            aria-label="新しいプロジェクトの名前"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn btn-tonal" disabled={!name.trim()}>
            追加
          </button>
        </form>
      </section>
      {archived.length > 0 && (
        <section className="card">
          <h3 className="section-title">終わったプロジェクト</h3>
          <ul className="proj-list">{archived.map(card)}</ul>
        </section>
      )}
    </div>
  );
}

export function ProjectPage({ id }: { id: string }) {
  const data = useData();
  const ui = useUI();
  const p = data.projById.get(id);
  const [pickColor, setPickColor] = useState(false);
  const now = today();
  const list = useMemo(() => flowEvents(data.all, id), [data.all, id]);

  if (!p) {
    return (
      <div className="page">
        <Empty>このプロジェクトは見つかりませんでした。</Empty>
      </div>
    );
  }

  const remove = async () => {
    const ok = await ui.confirm({
      title: 'プロジェクトを削除',
      message: `「${p.name}」を削除します。予定そのものは消えず、プロジェクトの分類だけが外れます。`,
      actions: [{ label: '削除', value: 'yes', danger: true }],
    });
    if (!ok) return;
    await deleteProject(p.id);
    goBack();
  };

  // 月ごとに区切り、今日の位置に印を入れる
  const firstFuture = list.findIndex((e) => lastDay(e) >= now);
  const rows: Array<{ month?: string; today?: boolean; e?: Resolved }> = [];
  let month = '';
  list.forEach((e, i) => {
    if (i === firstFuture && firstFuture > 0) rows.push({ today: true });
    const m = e.start.slice(0, 7);
    if (m !== month) {
      month = m;
      rows.push({ month: fmtMonthTitle(e.start) });
    }
    rows.push({ e });
  });
  if (firstFuture === -1 && list.length > 0) rows.push({ today: true });

  return (
    <div className="page">
      <section className="card">
        <div className="proj-head">
          <button
            type="button"
            className="color-dot"
            style={{ background: fill(p.color) }}
            aria-label="色を変える"
            aria-expanded={pickColor}
            onClick={() => setPickColor((v) => !v)}
          />
          <CommitInput
            className="ep-title"
            value={p.name}
            aria-label="プロジェクトの名前"
            onCommit={(v) => v.trim() && void saveProject({ ...p, name: v })}
          />
          <IconBtn
            label={p.archived ? '進行中に戻す' : '終わったプロジェクトにする'}
            onClick={() => void saveProject({ ...p, archived: !p.archived })}
          >
            {p.archived ? <ArchiveRestore size={20} /> : <Archive size={20} />}
          </IconBtn>
          <IconBtn label="プロジェクトを削除" onClick={() => void remove()}>
            <Trash2 size={20} />
          </IconBtn>
        </div>
        {pickColor && (
          <ColorPicker
            value={p.color}
            onChange={(color) => {
              void saveProject({ ...p, color });
              setPickColor(false);
            }}
          />
        )}
        <CommitInput
          multiline
          rows={2}
          autosaveMs={800}
          value={p.note}
          placeholder="メモ（目標、決めたことなど）"
          aria-label="プロジェクトのメモ"
          onCommit={(note) => void saveProject({ ...p, note })}
        />
      </section>

      <section className="card">
        <h3 className="section-title">
          予定の流れ
          <span className="section-count">{list.length}</span>
        </h3>
        {list.length === 0 ? (
          <Empty>
            まだ予定がありません。予定のページで「プロジェクト」にこのプロジェクトを選ぶと、ここに並びます。
          </Empty>
        ) : (
          <ol className="flow">
            {rows.map((r, i) =>
              r.month ? (
                <li key={`m${i}`} className="flow-month">
                  {r.month}
                </li>
              ) : r.today ? (
                <li key={`t${i}`} className="flow-today">
                  <span>今日</span>
                </li>
              ) : (
                <FlowItem key={r.e!.id} e={r.e!} past={lastDay(r.e!) < now} />
              ),
            )}
          </ol>
        )}
        <button
          type="button"
          className="btn btn-tonal"
          onClick={() => ui.openCreate({ projectId: p.id, start: now })}
        >
          <Plus size={18} />
          このプロジェクトに予定を追加
        </button>
      </section>
    </div>
  );
}

function FlowItem({ e, past }: { e: Resolved; past: boolean }) {
  return (
    <li
      className={`flow-item ${past ? 'past' : ''} ${e.done ? 'done' : ''}`}
      style={chipVars(e.color) as CSSProperties}
    >
      <span className="flow-node" aria-hidden="true" />
      <span className="flow-date">
        {fmtDayShort(e.start)}
        {!e.allDay && <small>{fmtTime(e.start)}</small>}
      </span>
      {e.parentId && (
        <input
          type="checkbox"
          checked={!!e.done}
          aria-label={`${e.title} を完了にする`}
          onChange={(ev) => void updateEvent(e.id, { done: ev.target.checked })}
        />
      )}
      <button type="button" className="flow-main" onClick={() => navigate({ name: 'event', id: e.id })}>
        <span className="flow-title">
          {!e.parentId && <KindIcon e={e} size={14} />}
          {e.title}
        </span>
        <span className="list-sub">
          {[
            e.kind !== 'normal' ? KIND_LABEL[e.kind] : '',
            e.parentId ? 'ステップ' : '',
            e.recurring ? '繰り返し（次の回）' : '',
            e.cat?.name ?? '',
            past ? '' : fmtRelative(e.start),
          ]
            .filter(Boolean)
            .join('・')}
        </span>
      </button>
    </li>
  );
}
