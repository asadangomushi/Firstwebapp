// 画面をまたぐ表示状態（作成ダイアログ・AIのパネル・確認ダイアログ・お知らせ）。
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { EventInput } from './store';

export interface AskAction {
  label: string;
  value: string;
  danger?: boolean;
  primary?: boolean;
}

export interface AskOptions {
  title: string;
  message?: string;
  actions: AskAction[];
}

interface UI {
  createInit: Partial<EventInput> | null;
  openCreate: (init?: Partial<EventInput>) => void;
  closeCreate: () => void;

  chatOpen: boolean;
  chatDraft: string;
  openChat: (draft?: string) => void;
  closeChat: () => void;
  clearChatDraft: () => void;

  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;

  ask: AskOptions | null;
  /** 確認ダイアログを出し、押されたボタンの value を返す（閉じたら null） */
  confirm: (o: AskOptions) => Promise<string | null>;
  answer: (v: string | null) => void;

  toastText: string;
  toast: (text: string) => void;
}

const Ctx = createContext<UI | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [createInit, setCreateInit] = useState<Partial<EventInput> | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ask, setAsk] = useState<AskOptions | null>(null);
  const [toastText, setToastText] = useState('');
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const confirm = useCallback((o: AskOptions) => {
    resolver.current?.(null);
    setAsk(o);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = useCallback((v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setAsk(null);
  }, []);

  const toast = useCallback((text: string) => {
    setToastText(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(''), 3500);
  }, []);

  const value = useMemo<UI>(
    () => ({
      createInit,
      openCreate: (init = {}) => setCreateInit(init),
      closeCreate: () => setCreateInit(null),
      chatOpen,
      chatDraft,
      openChat: (draft = '') => {
        setChatDraft(draft);
        setChatOpen(true);
        setDrawerOpen(false);
      },
      closeChat: () => setChatOpen(false),
      clearChatDraft: () => setChatDraft(''),
      drawerOpen,
      setDrawerOpen,
      ask,
      confirm,
      answer,
      toastText,
      toast,
    }),
    [createInit, chatOpen, chatDraft, drawerOpen, ask, confirm, answer, toastText, toast],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUI(): UI {
  const v = useContext(Ctx);
  if (!v) throw new Error('UIProvider の外で useUI が呼ばれました');
  return v;
}
