// 保存してある予定に、表示に必要な情報（種類・色・月表示に出すか）を足す。
import { LOCAL_CALENDAR } from './db';
import type { CalendarInfo, Category, PlannerEvent, Project, SeriesMeta } from './types';

export interface Lookup {
  categories: Category[];
  catById: Map<string, Category>;
  projById: Map<string, Project>;
  calById: Map<string, CalendarInfo>;
  series: Map<string, SeriesMeta>;
}

export interface Resolved extends PlannerEvent {
  /** 実際に効いている種類（個別指定 → 繰り返し全体 → キーワード自動判定） */
  cat?: Category;
  project?: Project;
  calendar?: CalendarInfo;
  color: string;
  recurring: boolean;
  /** 月表示に出す「特別な予定」か */
  special: boolean;
  /** カレンダーが表示オンか */
  shown: boolean;
  /** 時刻や題名を編集できるか（読み取り専用のGoogleカレンダーは不可） */
  editable: boolean;
}

/** タイトルに含まれるキーワードから種類を推測する */
export function matchCategory(title: string, categories: Category[]): Category | undefined {
  const t = title.toLowerCase();
  if (!t) return undefined;
  let best: Category | undefined;
  let bestLen = 0;
  for (const c of categories) {
    for (const k of c.keywords) {
      const kw = k.trim().toLowerCase();
      // いちばん長く一致した語を優先（「数学演習」は「数学」より強い）
      if (kw && kw.length > bestLen && t.includes(kw)) {
        best = c;
        bestLen = kw.length;
      }
    }
  }
  return best;
}

/** 繰り返し予定は、種類・プロジェクト・月表示の設定をまとまり全体で共有する */
export function metaOf(
  e: PlannerEvent,
  series: Map<string, SeriesMeta>,
): { categoryId?: string; projectId?: string; monthVisible?: boolean } {
  if (!e.seriesId) return e;
  return series.get(e.seriesId) ?? {};
}

export function isSpecial(
  e: PlannerEvent,
  cat: Category | undefined,
  monthVisible: boolean | undefined,
): boolean {
  if (monthVisible !== undefined) return monthVisible;
  // テストや締切は大事なので必ず出す
  if (e.kind !== 'normal') return true;
  if (cat?.monthMode === 'show') return true;
  if (cat?.monthMode === 'hide') return false;
  // 毎週の授業などの繰り返しは隠す
  return !e.seriesId;
}

export function resolveEvent(e: PlannerEvent, lk: Lookup): Resolved {
  const meta = metaOf(e, lk.series);
  const calendar = lk.calById.get(e.calendarId);
  // 個別に選んだ種類が最優先。なければタイトル（とGoogleカレンダーの名前）から推測する。
  const hint = calendar?.source === 'google' ? `${e.title} ${calendar.name}` : e.title;
  const cat =
    (meta.categoryId ? lk.catById.get(meta.categoryId) : undefined) ??
    matchCategory(hint, lk.categories);
  return {
    ...e,
    cat,
    project: meta.projectId ? lk.projById.get(meta.projectId) : undefined,
    calendar,
    // 色は種類で決める（帯グラフの色と同じ意味にするため）。種類なしはグレー。
    color: cat?.color ?? 'gray',
    recurring: !!e.seriesId,
    special: isSpecial(e, cat, meta.monthVisible),
    shown: calendar ? calendar.visible : true,
    editable: e.calendarId === LOCAL_CALENDAR || !calendar || calendar.writable,
  };
}

/** 詳細（手帳で書き足した情報）を持っているか。Google側で消えても残すかの判断に使う。 */
export function hasDetails(e: PlannerEvent): boolean {
  return (
    e.links.length > 0 ||
    e.belongings.length > 0 ||
    e.submissions.length > 0 ||
    e.relatedIds.length > 0 ||
    !!e.exam ||
    !!e.parentId ||
    e.kind !== 'normal'
  );
}
