# 手帳アプリ — 開発メモ

自分専用の手帳アプリ（Vite + React + TypeScript）。サーバーなし。データは端末内（IndexedDB / Dexie）。
利用者は日本語話者で、主にスマホ（Android）で使う。小さく作って育てていく方針。

## コマンド

- `npm run dev` 開発サーバー / `npm run build` 型チェック＋ビルド
- `npm test` 計算部分のテスト（vitest） / `npm run e2e` 画面操作のテスト（Playwright。API は偽物に差し替え）
- 変更したら `npm run format`、`npm run build`、`npm test`、画面に関わるなら `npm run e2e` を通す

## 決まりごと

- 画面の文言とコードのコメントは日本語。「なぜそうしているか」を書く
- 日時は端末のローカル時刻の文字列で持つ：時間つき `YYYY-MM-DDTHH:mm`、終日 `YYYY-MM-DD`。`end` は含まない終わり。計算は `src/lib/date.ts` を使い、`Date` を直接こねない
- データの書き換えは必ず `src/lib/store.ts` の関数を通す（Google への反映もそこで行う）
- 色は名前（`blue` など）で保存し、実際の色は `tokens.css` の CSS 変数。色は「予定の種類」を表し、帯グラフと同じ意味にそろえる。種類のない予定は淡い色（`plain`）
- 繰り返しの予定は各回を1行ずつ持つ（`seriesId` でまとまる）。種類・プロジェクト・月表示の設定は `series` 表でまとまり全体に効かせる
- Google カレンダーへ送るのは題名・日時・場所・メモだけ。書き足した情報（リンク、持ち物など）は、端末内と、同期をオンにしたときの Google ドライブ（appDataFolder）にだけ置く
- 端末間の同期（`drive.ts` / `syncmerge.ts`）は「変更時刻（updatedAt）が新しいほうを残す」「消したら `deleted` 表に記録して伝える」で成り立っている。時刻の記録と削除の記録は `sync-hooks.ts` がデータベースの手前で自動で行うので、ふつうの書き込みでは何もしなくてよい。ただし、同期で受け取った内容を書き戻すなど記録してはいけない書き込みは `markTransaction('quiet')`、Google カレンダーからの取り込みのように時刻を動かしてはいけない書き込みは `markTransaction('keepTime')` を、その db.transaction の中で呼ぶ
- Google カレンダーから取り込む予定の ID は `googleEventId()` で決める（どの端末でも同じ ID にして、同期で二重にならないようにするため）。新しい表を足したら、同期の対象にするかを決め、`syncmerge.ts` と `sync-hooks.ts` の一覧にも足す
- 外部から来る文字列（Google の説明文、共有されたリンク、Claude の出力）は信用しない。リンクは `links.ts` の `normalizeUrl` を通し、ファイルは `store.ts` の `openFile` で開く
- スマホ幅（390px）で必ず確認する。入力欄は 16px 以上（拡大防止）
- アプリ内の AI は Claude と Gemini を設定で選べる。AI が使う道具（予定の追加など）は `src/lib/assistant.ts` に1つだけ定義し、`claude.ts` / `gemini.ts` は呼び出し方だけを受け持つ。道具を足すときは assistant.ts に足せば両方で使える
- AI の API を触るときは公式 SDK（`@anthropic-ai/sdk`、`@google/genai`）を使い、モデル ID やパラメータは必ず最新の資料か SDK の型定義で確認する。Gemini の返事は受け取った形のまま履歴に戻す（思考の署名を欠かすと次の呼び出しが失敗する）

## 画面の構成

`src/lib/router.ts` が URL の `#/…` で画面を切り替える。画面は `src/views/`、共通部品は `src/components/`。
くわしい案内は README.md の「構成」を参照。
