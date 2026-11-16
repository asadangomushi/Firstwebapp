import { CircleCheck, Circle, ClipboardCheck, Flag } from 'lucide-react';
import type { CSSProperties } from 'react';
import { chipVars } from '../lib/colors';
import { fmtTime } from '../lib/date';
import type { Resolved } from '../lib/resolve';
import { navigate } from '../lib/router';

/** 予定の型を表す小さなアイコン（ステップ・テスト・締切） */
export function KindIcon({ e, size = 12 }: { e: Resolved; size?: number }) {
  if (e.parentId) return e.done ? <CircleCheck size={size} /> : <Circle size={size} />;
  if (e.kind === 'exam') return <ClipboardCheck size={size} />;
  if (e.kind === 'task') return <Flag size={size} />;
  return null;
}

/** 月表示や終日欄に置く1行の予定。bar=true は塗りの帯、false は「●10:00 題名」の形。 */
export function EventChip({
  e,
  bar,
  contLeft = false,
  contRight = false,
  style,
}: {
  e: Resolved;
  bar: boolean;
  contLeft?: boolean;
  contRight?: boolean;
  style?: CSSProperties;
}) {
  const cls = [
    'chip',
    bar ? 'chip-bar' : 'chip-dot',
    contLeft ? 'cont-l' : '',
    contRight ? 'cont-r' : '',
    e.done ? 'done' : '',
  ].join(' ');
  return (
    <button
      type="button"
      className={cls}
      style={{ ...chipVars(e.color), ...style } as CSSProperties}
      title={e.title}
      onClick={(ev) => {
        ev.stopPropagation();
        navigate({ name: 'event', id: e.id });
      }}
    >
      {!bar && <span className="chip-mark" aria-hidden="true" />}
      <KindIcon e={e} />
      {!bar && <span className="chip-time">{fmtTime(e.start)}</span>}
      <span className="chip-title">{e.title}</span>
    </button>
  );
}
