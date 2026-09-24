import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Lokal: /api an den Node-Adapter der API (`pnpm dev:api`, Port 8787) – gleicher Origin wie in prod.
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { sourcemap: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false },
    },
  },
});
