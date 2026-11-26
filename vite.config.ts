import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// DOTRA build configuration.
// The app is fully client-side: all QR generation, image processing,
// verification and media export happen in the browser.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
