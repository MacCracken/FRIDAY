import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    // LOCAL NETWORK ONLY - Security restriction
    host: '127.0.0.1', // Only localhost by default
    port: 3000,
    strictPort: true,
    // Proxy API requests to the gateway
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:18789',
        ws: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
