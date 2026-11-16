// 受信トレイ：ほかのアプリ（Samsung Notes・Gmailなど）から「共有」で受け取ったファイルを、
// 予定につなげる場所。
import { FileUp, Link2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { FileRow } from '../components/EventSections';
import { EventPicker } from '../components/RelationSections';
import { Empty, IconBtn } from '../components/ui';
import { useData } from '../lib/data';
import { newId } from '../lib/db';
import { removeInboxLink, useInboxLinks, type InboxLink } from '../lib/share';
import { addFiles, attachFile, removeFile, updateEvent } from '../lib/store';
import type { FileKind, FileRec } from '../lib/types';
import { useUI } from '../lib/ui-state';

export function InboxPage() {
  const data = useData();
  const ui = useUI();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<{ file: FileRec; kind: FileKind } | null>(null);
  const files = data.files.filter((f) => !f.eventId).sort((a, b) => b.createdAt - a.createdAt);
  const links = useInboxLinks();
  const [linkTarget, setLinkTarget] = useState<InboxLink | null>(null);

  return (
    <div className="page">
      <section className="card">
        <h2>受信トレイ</h2>
        <p className="section-hint">
          この手帳をホーム画面に追加しておくと、Samsung
          Notesのノート（PDF）やメールの添付ファイルを「共有」からここへ送れます。届いたファイルは、下のボタンで予定につなげてください。
        </p>
        {links.length > 0 && (
          <ul className="list">
            {links.map((l) => (
              <li key={l.id} className="list-item">
                <span className="list-icon" aria-hidden="true">
                  <Link2 size={18} />
                </span>
                <a className="list-main" href={l.url} target="_blank" rel="noopener noreferrer">
                  <span className="list-name">{l.label}</span>
                  <span className="list-sub">{l.url}</span>
                </a>
                <button type="button" className="btn btn-text" onClick={() => setLinkTarget(l)}>
                  予定につなげる
                </button>
                <IconBtn label="削除" onClick={() => removeInboxLink(l.id)}>
                  <Trash2 size={18} />
                </IconBtn>
              </li>
            ))}
          </ul>
        )}
        {files.length === 0 && links.length === 0 ? (
          <Empty>まだ何も届いていません。</Empty>
        ) : files.length === 0 ? null : (
          <ul className="list">
            {files.map((f) => (
              <FileRow
                key={f.id}
                f={f}
                actions={
                  <>
                    <button
                      type="button"
                      className="btn btn-text"
                      onClick={() => setTarget({ file: f, kind: 'note' })}
                    >
                      ノートとして
                    </button>
                    <button
                      type="button"
                      className="btn btn-text"
                      onClick={() => setTarget({ file: f, kind: 'material' })}
                    >
                      資料として
                    </button>
                    <IconBtn label="削除" onClick={() => void removeFile(f.id)}>
                      <Trash2 size={18} />
                    </IconBtn>
                  </>
                }
              />
            ))}
          </ul>
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            if (list.length) void addFiles('', 'material', list);
            e.target.value = '';
          }}
        />
        <button type="button" className="btn btn-tonal" onClick={() => input.current?.click()}>
          <FileUp size={18} />
          ファイルを入れておく
        </button>
      </section>

      {linkTarget && (
        <EventPicker
          title={`「${linkTarget.label}」をつなげる予定`}
          onClose={() => setLinkTarget(null)}
          onPick={(id) => {
            const e = data.byId.get(id);
            if (e) {
              void updateEvent(id, {
                links: [...e.links, { id: newId(), label: linkTarget.label, url: linkTarget.url }],
              });
              ui.toast(`「${e.title}」にリンクを保存しました`);
            }
            removeInboxLink(linkTarget.id);
            setLinkTarget(null);
          }}
        />
      )}

      {target && (
        <EventPicker
          title={`「${target.file.name}」をつなげる予定`}
          onClose={() => setTarget(null)}
          onPick={(id) => {
            void attachFile(target.file.id, id, target.kind);
            const title = data.byId.get(id)?.title ?? '予定';
            ui.toast(`「${title}」に保存しました`);
            setTarget(null);
          }}
        />
      )}
    </div>
  );
}
