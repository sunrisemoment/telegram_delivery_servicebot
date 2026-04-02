import { resolve } from 'node:path';

import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

const apiOrigin = process.env.VITE_DEV_API_ORIGIN ?? 'http://127.0.0.1:8000';

export default defineConfig({
  root: resolve(__dirname, 'apps/admin'),
  base: '/admin/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/admin'),
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/admin': apiOrigin,
      '/static': apiOrigin,
      '/admin-legacy': apiOrigin,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
