# 手帳アプリ — 開発メモ

自分専用の手帳アプリ（Vite + React + TypeScript）。サーバーなし。データは端末内（IndexedDB / Dexie）。
利用者は日本語話者で、主にスマホ（Android）で使う。小さく作って育てていく方針。

## コマンド

- `npm run dev` 開発サーバー / `npm run build` 型チェック＋ビルド
- `npm test` 計算部分のテスト（vitest） / `npm run e2e` 画面操作のテスト（Playwright。API は偽物に差し替え）
- 変更したら `npm run build` と `npm test`、画面に関わるなら `npm run e2e` を通す

## 決まりごと

- 画面の文言とコードのコメントは日本語。「なぜそうしているか」を書く
- 日時は端末のローカル時刻の文字列で持つ：時間つき `YYYY-MM-DDTHH:mm`、終日 `YYYY-MM-DD`。`end` は含まない終わり。計算は `src/lib/date.ts` を使い、`Date` を直接こねない
- データの書き換えは必ず `src/lib/store.ts` の関数を通す（Google への反映もそこで行う）
- 色は名前（`blue` など）で保存し、実際の色は `tokens.css` の CSS 変数。色は「予定の種類」を表し、帯グラフと同じ意味にそろえる。種類のない予定は淡い色（`plain`）
- 繰り返しの予定は各回を1行ずつ持つ（`seriesId` でまとまる）。種類・プロジェクト・月表示の設定は `series` 表でまとまり全体に効かせる
- Google へ送るのは題名・日時・場所・メモだけ。書き足した情報（リンク、持ち物など）は端末内だけ
- 外部から来る文字列（Google の説明文、共有されたリンク、Claude の出力）は信用しない。リンクは `links.ts` の `normalizeUrl` を通し、ファイルは `store.ts` の `openFile` で開く
- スマホ幅（390px）で必ず確認する。入力欄は 16px 以上（拡大防止）
- Claude API を触るときは公式 SDK（`@anthropic-ai/sdk`）を使い、モデル ID やパラメータは必ず最新の資料で確認する

## 画面の構成

`src/lib/router.ts` が URL の `#/…` で画面を切り替える。画面は `src/views/`、共通部品は `src/components/`。
くわしい案内は README.md の「構成」を参照。
