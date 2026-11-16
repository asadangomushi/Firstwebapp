// 予定ごとに書き足せる情報：リンク、資料・PDF、ノート、持ち物、提出物、テストの内容と結果。
import {
  Backpack,
  ClipboardCheck,
  ExternalLink,
  FileText,
  FileUp,
  Image as ImageIcon,
  Link2,
  Mail,
  NotebookText,
  Paperclip,
  X,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useData } from '../lib/data';
import { newId } from '../lib/db';
import { linkLabel, normalizeUrl } from '../lib/links';
import type { Resolved } from '../lib/resolve';
import { addFiles, openFile, removeFile } from '../lib/store';
import type { CheckItem, FileKind, FileRec, LinkItem, PlannerEvent } from '../lib/types';
import { AddRow, CommitInput, IconBtn } from './ui';

type Save = (patch: Partial<PlannerEvent>) => void;

export function Section({
  icon,
  title,
  count,
  children,
  hint,
}: {
  icon: ReactNode;
  title: string;
  count?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <section className="card section">
      <h3 className="section-title">
        <span className="section-icon" aria-hidden="true">
          {icon}
        </span>
        {title}
        {count && <span className="section-count">{count}</span>}
      </h3>
      {hint && <p className="section-hint">{hint}</p>}
      {children}
    </section>
  );
}

// ---- テスト ----

export function ExamSection({ e, onSave }: { e: Resolved; onSave: Save }) {
  const exam = e.exam ?? { scope: '', score: '', review: '' };
  const set = (patch: Partial<typeof exam>) => onSave({ exam: { ...exam, ...patch } });
  return (
    <Section icon={<ClipboardCheck size={18} />} title="テスト">
      <label className="field">
        <span>試験内容・範囲</span>
        <CommitInput
          multiline
          rows={3}
          value={exam.scope}
          placeholder="例：教科書 p.40–82、小テスト3回分、記述あり"
          onCommit={(scope) => set({ scope })}
        />
      </label>
      <label className="field">
        <span>結果（点数）</span>
        <CommitInput
          value={exam.score}
          placeholder="例：82 / 100"
          onCommit={(score) => set({ score })}
        />
      </label>
      <label className="field">
        <span>振り返り</span>
        <CommitInput
          multiline
          rows={3}
          value={exam.review}
          placeholder="できたこと・次に直すこと"
          onCommit={(review) => set({ review })}
        />
      </label>
    </Section>
  );
}

// ---- リンク ----

function LinkIcon({ url }: { url: string }) {
  if (url.startsWith('mailto:') || url.includes('mail.google.com')) return <Mail size={18} />;
  if (url.includes('docs.google.com') || url.includes('drive.google.com')) return <FileText size={18} />;
  return <Link2 size={18} />;
}

export function LinksSection({ e, onSave }: { e: Resolved; onSave: Save }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const add = () => {
    const href = normalizeUrl(url);
    if (!href) {
      setError('URLの形になっていません（https://… または メールアドレスのリンク）');
      return;
    }
    const item: LinkItem = { id: newId(), label: linkLabel(href), url: href };
    onSave({ links: [...e.links, item] });
    setUrl('');
    setError('');
  };

  return (
    <Section
      icon={<Link2 size={18} />}
      title="リンク"
      count={e.links.length ? String(e.links.length) : undefined}
      hint="Googleドキュメントやメールのリンクを貼ると、この予定からすぐ開けます。"
    >
      <ul className="list">
        {e.links.map((l) => (
          <li key={l.id} className="list-item">
            <span className="list-icon" aria-hidden="true">
              <LinkIcon url={l.url} />
            </span>
            <div className="list-main">
              <CommitInput
                className="plain-input"
                value={l.label}
                aria-label="リンクの名前"
                onCommit={(label) =>
                  onSave({
                    links: e.links.map((x) => (x.id === l.id ? { ...x, label: label || linkLabel(x.url) } : x)),
                  })
                }
              />
              <span className="list-sub">{l.url}</span>
            </div>
            <a className="icon-btn" href={l.url} target="_blank" rel="noopener noreferrer" aria-label={`${l.label} を開く`} title="開く">
              <ExternalLink size={18} />
            </a>
            <IconBtn label="リンクを外す" onClick={() => onSave({ links: e.links.filter((x) => x.id !== l.id) })}>
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
          value={url}
          placeholder="リンクを貼り付け"
          aria-label="リンクのURL"
          inputMode="url"
          onChange={(ev) => {
            setUrl(ev.target.value);
            setError('');
          }}
        />
        <button type="submit" className="btn btn-text" disabled={!url.trim()}>
          追加
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </Section>
  );
}

// ---- 資料・PDF／ノート ----

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileRow({ f, actions }: { f: FileRec; actions?: ReactNode }) {
  return (
    <li className="list-item">
      <span className="list-icon" aria-hidden="true">
        {f.mime.startsWith('image/') ? <ImageIcon size={18} /> : <FileText size={18} />}
      </span>
      <button type="button" className="list-main list-open" onClick={() => openFile(f)} title="開く">
        <span className="list-name">{f.name}</span>
        <span className="list-sub">{fmtSize(f.size)}</span>
      </button>
      {actions}
    </li>
  );
}

const FILE_TEXT: Record<FileKind, { title: string; hint: string; add: string }> = {
  material: {
    title: '資料・PDF',
    hint: '配布資料やメールの添付ファイルを、この予定に保存しておけます（この端末の中に保存されます）。',
    add: 'ファイルを追加',
  },
  note: {
    title: 'ノート',
    hint: 'Samsung Notesで「共有」→「PDFファイル」を選んで書き出したノートを、授業ごとに保存できます。',
    add: 'ノートを追加',
  },
};

export function FilesSection({ e, kind }: { e: Resolved; kind: FileKind }) {
  const data = useData();
  const input = useRef<HTMLInputElement>(null);
  const files = data.files
    .filter((f) => f.eventId === e.id && f.kind === kind)
    .sort((a, b) => a.createdAt - b.createdAt);
  const text = FILE_TEXT[kind];

  return (
    <Section
      icon={kind === 'note' ? <NotebookText size={18} /> : <Paperclip size={18} />}
      title={text.title}
      count={files.length ? String(files.length) : undefined}
      hint={text.hint}
    >
      <ul className="list">
        {files.map((f) => (
          <FileRow
            key={f.id}
            f={f}
            actions={
              <IconBtn label="ファイルを削除" onClick={() => void removeFile(f.id)}>
                <X size={18} />
              </IconBtn>
            }
          />
        ))}
      </ul>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={kind === 'note' ? 'application/pdf,image/*,.sdocx,.txt,.docx' : undefined}
        onChange={(ev) => {
          const list = Array.from(ev.target.files ?? []);
          if (list.length) void addFiles(e.id, kind, list);
          ev.target.value = '';
        }}
      />
      <button type="button" className="btn btn-tonal" onClick={() => input.current?.click()}>
        <FileUp size={18} />
        {text.add}
      </button>
    </Section>
  );
}

// ---- 持ち物・提出物 ----

const CHECK_TEXT = {
  belongings: { title: '持ち物', placeholder: '持ち物を追加（例：電卓）', icon: <Backpack size={18} /> },
  submissions: { title: '提出物', placeholder: '提出物を追加（例：レポート）', icon: <FileUp size={18} /> },
} as const;

export function CheckSection({
  e,
  field,
  onSave,
}: {
  e: Resolved;
  field: 'belongings' | 'submissions';
  onSave: Save;
}) {
  const items = e[field];
  const text = CHECK_TEXT[field];
  const done = items.filter((i) => i.done).length;
  const set = (next: CheckItem[]) => onSave({ [field]: next });

  return (
    <Section
      icon={text.icon}
      title={text.title}
      count={items.length ? `${done} / ${items.length}` : undefined}
    >
      <ul className="list">
        {items.map((it) => (
          <li key={it.id} className={`list-item check-item ${it.done ? 'done' : ''}`}>
            <input
              type="checkbox"
              checked={it.done}
              aria-label={it.text}
              onChange={(ev) =>
                set(items.map((x) => (x.id === it.id ? { ...x, done: ev.target.checked } : x)))
              }
            />
            <CommitInput
              className="plain-input list-main"
              value={it.text}
              aria-label={`${text.title}の内容`}
              onCommit={(t) =>
                set(
                  t.trim()
                    ? items.map((x) => (x.id === it.id ? { ...x, text: t.trim() } : x))
                    : items.filter((x) => x.id !== it.id),
                )
              }
            />
            <IconBtn label="削除" onClick={() => set(items.filter((x) => x.id !== it.id))}>
              <X size={18} />
            </IconBtn>
          </li>
        ))}
      </ul>
      <AddRow
        label={text.placeholder}
        placeholder={text.placeholder}
        onAdd={(t) => set([...items, { id: newId(), text: t, done: false }])}
      />
    </Section>
  );
}
