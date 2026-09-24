import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * SPA (TK 3.1, 4.1): gehashte Dateien unter `assets/<buildId>/` – der `weekly`-Job behält die letzten
 * drei Build-Präfixe (DAT-4, DAT5-6); `index.html` liegt im Wurzelverzeichnis ohne Cache.
 * Lokal: /api an den Node-Adapter der API (`pnpm dev:api`) – gleicher Origin wie in prod.
 */
const buildId = process.env.BUILD_ID ?? 'local';

export default defineConfig({
  base: '/',
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: { sourcemap: true, assetsDir: `assets/${buildId}` },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false },
    },
  },
  preview: { port: 4173, strictPort: true },
});
