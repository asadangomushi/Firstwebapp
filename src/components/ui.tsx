// どの画面でも使う小さな部品。
import { Check, X } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { PALETTE, fill } from '../lib/colors';

export function IconBtn({
  label,
  children,
  className = '',
  ...rest
}: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 画面中央（スマホでは下から）に出るダイアログ */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    // 開いたら最初の入力欄へ
    const first = ref.current?.querySelector<HTMLElement>(
      '[data-autofocus], input, textarea, select',
    );
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <IconBtn label="閉じる" onClick={onClose}>
            <X size={20} />
          </IconBtn>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** 横に並んだ切り替えボタン（日・週・月など） */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  small = false,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={`seg ${small ? 'seg-small' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'on' : ''}
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="色">
      {PALETTE.map((p) => (
        <button
          key={p.key}
          type="button"
          role="radio"
          aria-checked={p.key === value}
          aria-label={p.name}
          title={p.name}
          className="color-dot"
          style={{ background: fill(p.key) }}
          onClick={() => onChange(p.key)}
        >
          {p.key === value && <Check size={14} color={`var(--on-${p.key})`} strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

/**
 * 入力中は手元で持ち、フォーカスが外れたとき（またはEnter）に確定する入力欄。
 * 1文字ごとに保存や同期が走らないようにするため。
 */
export function CommitInput({
  value,
  onCommit,
  multiline = false,
  autosaveMs,
  ...rest
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  /** 指定すると、入力が止まってからこの時間で自動保存する（日記など長い文章用） */
  autosaveMs?: number;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
  rows?: number;
  disabled?: boolean;
  id?: string;
}) {
  const [text, setText] = useState(value);
  const dirty = useRef(false);
  const latest = useRef(value);
  const saved = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    saved.current = value;
    // 外から値が変わったら（同期など）追従する。入力中は上書きしない。
    if (!dirty.current) {
      latest.current = value;
      setText(value);
    }
  }, [value]);

  const commit = () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    if (latest.current !== saved.current) {
      saved.current = latest.current;
      commitRef.current(latest.current);
    }
  };

  // 画面を離れるときに、書きかけを取りこぼさない
  useEffect(() => commit, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (v: string) => {
    dirty.current = true;
    latest.current = v;
    setText(v);
    if (autosaveMs) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (latest.current !== saved.current) {
          saved.current = latest.current;
          commitRef.current(latest.current);
        }
      }, autosaveMs);
    }
  };

  if (multiline) {
    return (
      <textarea {...rest} value={text} onChange={(e) => change(e.target.value)} onBlur={commit} />
    );
  }
  return (
    <input
      {...rest}
      value={text}
      onChange={(e) => change(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * 日付・時刻の入力欄（端末の日付選択・時刻選択が開く）。
 *
 * Android の時刻選択は、選んだ値を入力欄に直接書き込む。その知らせ方が端末やブラウザで
 * まちまちで、React の onChange だけに頼ると「欄の表示は変わったのに保存されない」ことがある。
 * そこで、欄の値そのものを見張る：知らせ（input / change）が来たとき、欄を離れたとき、
 * そして欄を触っている間は一定間隔で、値が変わっていないかを確かめて onPick を呼ぶ。
 */
export function PickerInput({
  type,
  value,
  onPick,
  ...rest
}: {
  type: 'date' | 'time' | 'datetime-local';
  value: string;
  /** 値が変わったときに呼ばれる（空にされたときは呼ばれない） */
  onPick: (v: string) => void;
  className?: string;
  'aria-label'?: string;
  disabled?: boolean;
  min?: string;
  step?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  /** 最後に「保存済み」とみなした値。これと欄の値が違えば、利用者が変えたということ。 */
  const synced = useRef(value);
  const latest = useRef(value);
  latest.current = value;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  // 保存された値が変わったら（ドラッグでの調整や同期など）、欄の表示を合わせる
  useEffect(() => {
    synced.current = value;
    const el = ref.current;
    if (el && el.value !== value) el.value = value;
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const len = type === 'date' ? 10 : type === 'time' ? 5 : 16;
    let timer: ReturnType<typeof setInterval> | undefined;

    const check = () => {
      const v = el.value.slice(0, len);
      if (!v || v === synced.current) return;
      synced.current = v;
      pickRef.current(v);
    };
    const watch = () => {
      clearInterval(timer);
      timer = setInterval(check, 250);
    };
    const leave = () => {
      check();
      clearInterval(timer);
      // 空にされたり、受け付けられない値だったときは、保存されている値の表示に戻す
      // （受け付けられた値は、保存が終わりしだい上の処理で表示される）
      if (el.value !== latest.current) el.value = latest.current;
    };

    el.addEventListener('input', check);
    el.addEventListener('change', check);
    el.addEventListener('focus', watch);
    el.addEventListener('pointerdown', watch);
    el.addEventListener('blur', leave);
    return () => {
      clearInterval(timer);
      el.removeEventListener('input', check);
      el.removeEventListener('change', check);
      el.removeEventListener('focus', watch);
      el.removeEventListener('pointerdown', watch);
      el.removeEventListener('blur', leave);
    };
  }, [type]);

  // React に値を管理させない（管理させると、保存が終わる前に古い値へ書き戻されてしまう）
  return <input ref={ref} type={type} defaultValue={value} {...rest} />;
}

/** 1行入力して追加するための欄（持ち物・提出物など） */
export function AddRow({
  placeholder,
  onAdd,
  label,
}: {
  placeholder: string;
  onAdd: (text: string) => void;
  label: string;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText('');
  };
  return (
    <form
      className="add-row"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        value={text}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        enterKeyHint="done"
      />
      <button type="submit" className="btn btn-text" disabled={!text.trim()}>
        追加
      </button>
    </form>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
