import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base を相対パスにして、GitHub Pages のサブパス配信でもそのまま動くようにする
export default defineConfig({
  base: './',
  // いつ作られた版かを設定画面に出す（スマホに新しい版が届いたかを確かめるため）
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [react()],
  server: { host: true },
  preview: { host: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
