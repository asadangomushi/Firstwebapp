// 色は「名前（スロット）」で持ち、実際の色はCSS変数で決める。
// こうしておくとライト／ダークで同じ予定が自動で適切な色になる。
// 並び順は色覚特性があっても隣同士が区別できる順（帯グラフで隣り合うため）。

export interface Swatch {
  key: string;
  name: string;
}

export const PALETTE: Swatch[] = [
  { key: 'blue', name: 'ブルー' },
  { key: 'orange', name: 'オレンジ' },
  { key: 'aqua', name: 'ミント' },
  { key: 'yellow', name: 'イエロー' },
  { key: 'magenta', name: 'ピンク' },
  { key: 'green', name: 'グリーン' },
  { key: 'violet', name: 'パープル' },
  { key: 'red', name: 'レッド' },
  { key: 'gray', name: 'グレー' },
];

const KEYS = new Set(PALETTE.map((p) => p.key));

/** ライトモードでの実色（Googleカレンダーの色を近いスロットへ寄せるときに使う） */
const LIGHT_HEX: Record<string, string> = {
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
  yellow: '#eda100',
  magenta: '#e87ba4',
  green: '#008300',
  violet: '#6250d6',
  red: '#e34948',
  gray: '#7b7d82',
};

export const DEFAULT_COLOR = 'blue';

function norm(color: string | undefined): string {
  return color && KEYS.has(color) ? color : DEFAULT_COLOR;
}

/** 塗りの色（CSSの値） */
export function fill(color: string | undefined): string {
  return `var(--c-${norm(color)})`;
}

/** その塗りの上に置く文字の色 */
export function onFill(color: string | undefined): string {
  return `var(--on-${norm(color)})`;
}

/** 予定チップなどに渡す style。塗るか点にするかはCSS側で決める。 */
export function chipVars(color: string | undefined): Record<string, string> {
  return { '--chip': fill(color), '--on-chip': onFill(color) };
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 任意の16進色を、いちばん近いパレットの色名にする */
export function nearestSwatch(hex: string | undefined): string {
  const c = hex ? rgb(hex) : null;
  if (!c) return DEFAULT_COLOR;
  let best = DEFAULT_COLOR;
  let bestD = Infinity;
  for (const [key, h] of Object.entries(LIGHT_HEX)) {
    const p = rgb(h)!;
    // 人の目は緑に敏感なので少し重みをつける
    const d = 2 * (c[0] - p[0]) ** 2 + 4 * (c[1] - p[1]) ** 2 + 3 * (c[2] - p[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = key;
    }
  }
  return best;
}
