import { useData } from '../lib/data';
import { saveDiary } from '../lib/store';
import { CommitInput } from './ui';

const MOODS: Array<[string, string]> = [
  ['😄', 'とても良い'],
  ['🙂', '良い'],
  ['😐', 'ふつう'],
  ['😪', '疲れた'],
  ['😢', 'つらい'],
];

/** その日の日記を書く欄。書きながら自動で保存される。 */
export function DiaryEditor({ date, rows = 8 }: { date: string; rows?: number }) {
  const data = useData();
  const entry = data.diary.get(date);
  return (
    <div className="diary-editor">
      <div className="moods" role="group" aria-label="今日の気分">
        {MOODS.map(([m, label]) => (
          <button
            key={m}
            type="button"
            className={entry?.mood === m ? 'on' : ''}
            aria-pressed={entry?.mood === m}
            aria-label={label}
            title={label}
            onClick={() => void saveDiary(date, { mood: entry?.mood === m ? '' : m })}
          >
            {m}
          </button>
        ))}
      </div>
      <CommitInput
        // 日付ごとに入力欄を作り直す（別の日の書きかけが混ざらないように）
        key={date}
        multiline
        rows={rows}
        autosaveMs={800}
        value={entry?.text ?? ''}
        placeholder="今日あったこと、考えたこと…"
        aria-label="日記"
        onCommit={(text) => void saveDiary(date, { text })}
      />
    </div>
  );
}
