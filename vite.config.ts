import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base を相対パスにして、GitHub Pages のサブパス配信でもそのまま動くようにする
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
  preview: { host: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
