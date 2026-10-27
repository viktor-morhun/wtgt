import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/ws': { target: backend, ws: true },
      '/api': backend,
      '/healthz': backend,
    },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 800 },
});
