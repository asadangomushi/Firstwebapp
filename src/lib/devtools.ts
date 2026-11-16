// 開発中だけ使う道具。ブラウザのコンソールや自動テストからデータを直接さわれるようにする。
// 本番のビルドには含まれない。
import * as date from './date';
import { db } from './db';
import * as google from './google';
import * as store from './store';

export function install(): void {
  Object.assign(window, { __techo: { db, store, date, google } });
}
