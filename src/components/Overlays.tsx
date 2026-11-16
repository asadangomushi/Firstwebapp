import { useUI } from '../lib/ui-state';
import { Modal } from './ui';

/** 確認ダイアログ（削除など）。どのボタンが押されたかを呼び出し元に返す。 */
export function ConfirmHost() {
  const { ask, answer } = useUI();
  if (!ask) return null;
  return (
    <Modal
      title={ask.title}
      onClose={() => answer(null)}
      footer={
        <>
          <button type="button" className="btn btn-text" onClick={() => answer(null)}>
            キャンセル
          </button>
          {ask.actions.map((a) => (
            <button
              key={a.value}
              type="button"
              className={`btn ${a.danger ? 'btn-danger' : a.primary ? 'btn-primary' : 'btn-tonal'}`}
              onClick={() => answer(a.value)}
            >
              {a.label}
            </button>
          ))}
        </>
      }
    >
      {ask.message && <p className="confirm-text">{ask.message}</p>}
    </Modal>
  );
}

export function Toast() {
  const { toastText } = useUI();
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toastText && <div className="toast">{toastText}</div>}
    </div>
  );
}
