import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/home-school-tracker/' : '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@hst/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@hst/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@hst/fixture': fileURLToPath(new URL('../../packages/fixture/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
}));
