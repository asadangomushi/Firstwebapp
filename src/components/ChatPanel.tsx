// Claudeと話すパネル。「金曜の15時に歯医者を追加して」のように頼める。
import { ArrowUp, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { resetChat, sendChat, stopChat, useChat } from '../lib/claude';
import { useData } from '../lib/data';
import { fmtDay } from '../lib/date';
import { navigate, useRoute, type Route } from '../lib/router';
import { useSettings } from '../lib/settings';
import { useUI } from '../lib/ui-state';
import { IconBtn } from './ui';

const EXAMPLES = [
  '明日の15時に歯医者を追加して',
  '今週の予定を教えて',
  '来週金曜が締切のレポートの計画を立てて',
];

export function ChatPanel() {
  const ui = useUI();
  const chat = useChat();
  const settings = useSettings();
  const data = useData();
  const route = useRoute();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ほかの画面から「Claudeに頼む」で開いたときは、その文を入力欄に入れておく
  useEffect(() => {
    if (ui.chatDraft) {
      setText(ui.chatDraft);
      ui.clearChatDraft();
    }
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.chatDraft]);

  // 新しい発言が出たら一番下へ
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.items]);

  const viewing = (r: Route): string => {
    if (r.name === 'event') {
      const e = data.byId.get(r.id);
      return e ? `予定「${e.title}」のページ（id: ${e.id}）` : '予定のページ';
    }
    if (r.name === 'project') {
      const p = data.projById.get(r.id);
      return p ? `プロジェクト「${p.name}」のページ` : 'プロジェクトのページ';
    }
    if ('date' in r) {
      const label = { month: '月表示', week: '週表示', day: '一日の画面', timeuse: '時間の使い方', diary: '日記' }[r.name];
      return `${label}（${r.date} ${fmtDay(r.date)}）`;
    }
    return { projects: 'プロジェクト一覧', settings: '設定', inbox: '受信トレイ' }[r.name];
  };

  const send = (body: string) => {
    if (!body.trim() || chat.busy) return;
    setText('');
    void sendChat(body, {
      viewing: viewing(route),
      confirmDelete: async (label) =>
        (await ui.confirm({
          title: 'Claudeが予定を削除しようとしています',
          message: `「${label}」を削除してよいですか？`,
          actions: [{ label: '削除する', value: 'yes', danger: true }],
        })) === 'yes',
    });
  };

  return (
    <aside className="chat" aria-label="Claude">
      <header className="chat-head">
        <Sparkles size={20} />
        <h2>Claude</h2>
        <IconBtn label="新しい会話にする" onClick={resetChat} disabled={chat.items.length === 0}>
          <RotateCcw size={18} />
        </IconBtn>
        <IconBtn label="閉じる" onClick={ui.closeChat}>
          <X size={20} />
        </IconBtn>
      </header>

      <div className="chat-list" ref={listRef}>
        {chat.items.length === 0 && (
          <div className="chat-intro">
            <p>予定の追加や変更を、ことばで頼めます。</p>
            {settings.claudeApiKey ? (
              <div className="chat-examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="btn btn-outline" onClick={() => send(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <p className="hint">
                  使うにはAnthropicのAPIキーが必要です（使った分だけ料金がかかります）。
                </p>
                <button
                  type="button"
                  className="btn btn-tonal"
                  onClick={() => {
                    ui.closeChat();
                    navigate({ name: 'settings' });
                  }}
                >
                  設定でAPIキーを登録
                </button>
              </>
            )}
          </div>
        )}
        {chat.items.map((m, i) => {
          const waiting = chat.busy && i === chat.items.length - 1 && m.role === 'assistant';
          return (
            <div key={m.id} className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
              {m.actions.length > 0 && (
                <ul className="msg-actions">
                  {m.actions.map((a) => (
                    <li key={a.id}>
                      {a.eventId ? (
                        <button type="button" onClick={() => navigate({ name: 'event', id: a.eventId! })}>
                          {a.text}
                        </button>
                      ) : (
                        <span>{a.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {m.text && <p className="msg-text">{m.text}</p>}
              {waiting && !m.text && (
                <p className="msg-wait" role="status">
                  <span className="typing" aria-hidden="true" />
                  考えています…
                </p>
              )}
            </div>
          );
        })}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          ref={inputRef}
          rows={2}
          value={text}
          placeholder="例：この日に勉強会を追加して"
          aria-label="Claudeへのメッセージ"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enterで送信（日本語の変換確定のEnterでは送らない）。改行はShift+Enter。
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        {chat.busy ? (
          <button type="button" className="chat-send" aria-label="中止" title="中止" onClick={stopChat}>
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button type="submit" className="chat-send" aria-label="送信" title="送信" disabled={!text.trim()}>
            <ArrowUp size={20} />
          </button>
        )}
      </form>
    </aside>
  );
}
