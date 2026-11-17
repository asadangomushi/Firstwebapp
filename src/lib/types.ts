// 手帳アプリのデータの形。
// 日時は「端末のローカル時刻」の文字列で持つ（タイムゾーンをまたぐ計算をしない）。
//   時間あり: 'YYYY-MM-DDTHH:mm'   終日: 'YYYY-MM-DD'
// end は常に「含まない終わり」（Googleカレンダーと同じ）。

export type ID = string;

/** 予定の型。テストなら試験内容と結果、課題なら逆算計画が前面に出る。 */
export type EventKind = 'normal' | 'exam' | 'task';

export interface LinkItem {
  id: ID;
  label: string;
  url: string;
}

export interface CheckItem {
  id: ID;
  text: string;
  done: boolean;
}

export interface ExamInfo {
  /** 試験内容・範囲 */
  scope: string;
  /** 点数（「82 / 100」など自由記述） */
  score: string;
  /** 結果・振り返り */
  review: string;
}

export interface PlannerEvent {
  id: ID;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** 'local'（この端末だけ）か、GoogleカレンダーのID */
  calendarId: string;
  location: string;
  memo: string;
  kind: EventKind;
  categoryId?: ID;
  projectId?: ID;
  /** 月表示に出すかどうかを個別に上書きする。未設定なら自動判定。 */
  monthVisible?: boolean;
  /** 繰り返し予定のまとまり。Googleの recurringEventId か、手帳内で作った繰り返しのID。 */
  seriesId?: string;

  links: LinkItem[];
  belongings: CheckItem[];
  submissions: CheckItem[];
  exam?: ExamInfo;
  /** つながっている予定（双方向で持つ） */
  relatedIds: ID[];
  /** 逆算計画のステップなら、親の予定のID */
  parentId?: ID;
  /** ステップの完了 */
  done?: boolean;

  googleId?: string;
  /** Googleにまだ送れていない変更 */
  sync?: 'create' | 'update';
  /** 送る必要のある項目（変更した項目だけをGoogleへ送る） */
  syncFields?: SyncField[];
  createdAt: number;
  updatedAt: number;
}

export type SyncField = 'title' | 'time' | 'location' | 'memo';

/** 月表示での扱い。auto は「繰り返しでなければ出す」。 */
export type MonthMode = 'auto' | 'show' | 'hide';

export interface Category {
  id: ID;
  name: string;
  color: string;
  /** タイトルにこの語が含まれる予定を自動でこの種類にする（例: 勉強 ← 数学） */
  keywords: string[];
  monthMode: MonthMode;
  order: number;
  /** 最後に変更した時刻（端末間の同期で、新しいほうを残すのに使う） */
  updatedAt?: number;
}

export interface Project {
  id: ID;
  name: string;
  color: string;
  note: string;
  archived: boolean;
  order: number;
  /** 最後に変更した時刻（端末間の同期で、新しいほうを残すのに使う） */
  updatedAt?: number;
}

export interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  source: 'local' | 'google';
  /** Google側で編集できるか */
  writable: boolean;
  primary?: boolean;
}

/** 繰り返し予定全体に効く設定 */
export interface SeriesMeta {
  id: string;
  categoryId?: ID;
  projectId?: ID;
  monthVisible?: boolean;
  /** 最後に変更した時刻（端末間の同期で、新しいほうを残すのに使う） */
  updatedAt?: number;
}

/** 実際の時間の使い方（実績） */
export interface Actual {
  id: ID;
  start: string;
  end: string;
  title: string;
  categoryId?: ID;
  /** 予定からコピーした場合の元の予定 */
  eventId?: ID;
  memo: string;
  /** 最後に変更した時刻（端末間の同期で、新しいほうを残すのに使う） */
  updatedAt?: number;
}

export interface DiaryEntry {
  /** 'YYYY-MM-DD' */
  date: string;
  text: string;
  mood: string;
  updatedAt: number;
}

export type FileKind = 'material' | 'note';

export interface FileRec {
  id: ID;
  /** 空文字なら受信トレイ（まだどの予定にもつながっていない） */
  eventId: ID;
  kind: FileKind;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
  /** 最後に変更した時刻（端末間の同期で、新しいほうを残すのに使う） */
  updatedAt?: number;
  /** Googleドライブに置いた控えのID（端末間の同期用） */
  driveId?: string;
}

/** Googleから消す予定の控え（オフラインで削除したとき用） */
export interface Tombstone {
  googleId: string;
  calendarId: string;
}

export type RepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly';

export interface RepeatRule {
  freq: RepeatFreq;
  /** 'YYYY-MM-DD' この日まで（含む） */
  until: string;
}

export const KIND_LABEL: Record<EventKind, string> = {
  normal: '予定',
  exam: 'テスト',
  task: '課題・締切',
};

/** 端末間の同期で扱う表 */
export type SyncTable =
  'events' | 'categories' | 'projects' | 'series' | 'actuals' | 'diary' | 'files';

/**
 * 消したものの記録。ほかの端末に「これは消した」と伝えるために残す
 * （記録がないと、ほかの端末に残っている同じものが同期で戻ってきてしまう）。
 */
export interface Deletion {
  /** `表の名前:ID` */
  key: string;
  table: SyncTable;
  id: string;
  /** 消した時刻 */
  at: number;
  /** 二重になったものを1つにまとめて消したときの、残したほうのID（つながりを付け替えるため） */
  into?: string;
  /** ファイルを消したとき、ドライブに置いた控えのID（ドライブからも消すため） */
  driveId?: string;
}
