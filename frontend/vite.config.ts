import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `@matchcast/shared` is published as CommonJS (the Node services require it).
 * Rollup cannot statically analyse TypeScript's `__exportStar` re-exports, so
 * the dashboard builds straight from the TypeScript sources instead - same
 * code, but tree-shakeable and free of CJS interop surprises.
 */
const SHARED_SRC = path.resolve(__dirname, '../shared/src/index.ts');

const BACKEND = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 5173),
    strictPort: false,
    // Allow the app to be embedded in preview iframes / served via a proxy host.
    allowedHosts: true,
    cors: true,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/media': { target: BACKEND, changeOrigin: true },
      '/socket.io': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  resolve: {
    alias: { '@matchcast/shared': SHARED_SRC },
    // Keep a single copy of React when the dashboard is served from the repo.
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Split the heavy vendor libs so the app shell stays small.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          player: ['hls.js'],
        },
      },
    },
  },
});
