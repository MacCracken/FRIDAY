import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const GATEWAY_URL = process.env.VITE_GATEWAY_URL || 'http://127.0.0.1:18789';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    // Bind to all interfaces for external access
    host: process.env.VITE_HOST || '0.0.0.0',
    port: 3000,
    strictPort: true,
    // Proxy API requests to the gateway
    proxy: {
      '/api': {
        target: GATEWAY_URL,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error('[vite proxy /api] error:', err.message);
            if ('writeHead' in res && !res.headersSent) {
              (res as import('http').ServerResponse).writeHead(502, {
                'Content-Type': 'application/json',
              });
              (res as import('http').ServerResponse).end(
                JSON.stringify({ error: `Proxy error: ${err.message}` })
              );
            }
          });
        },
      },
      '/terminal': {
        target: `${GATEWAY_URL}/api/v1/terminal`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/terminal/, ''),
      },
      '/health': {
        target: GATEWAY_URL,
        changeOrigin: true,
      },
      '/metrics': {
        target: GATEWAY_URL,
        changeOrigin: true,
      },
      '/ws': {
        target: GATEWAY_URL.replace('http', 'ws'),
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
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'chart-vendor': ['reactflow', 'recharts'],
        },
      },
    },
  },
});
