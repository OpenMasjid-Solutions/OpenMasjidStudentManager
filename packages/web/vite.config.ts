// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev the UI runs on Vite (5173) and proxies API traffic to the server (8080).
// In production the server serves the built UI itself (same-origin, no proxy).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/trpc': { target: 'http://localhost:8080', changeOrigin: true },
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/fabric': { target: 'http://localhost:8080', changeOrigin: true },
      '/apply': { target: 'http://localhost:8080', changeOrigin: true },
      '/reports': { target: 'http://localhost:8080', changeOrigin: true },
      '/statements': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Group stable, rarely-changing vendors into their own cacheable chunks.
        manualChunks: {
          react: ['react', 'react-dom'],
          motion: ['motion'],
          query: ['@trpc/client', '@trpc/react-query', '@tanstack/react-query'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
