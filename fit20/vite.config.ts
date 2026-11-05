import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'offline.html'],
      manifest: {
        name: 'FIT 20',
        short_name: 'FIT 20',
        description: 'Entrenamiento, running, nutrición y progreso — funciona sin internet.',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#111111',
        theme_color: '#111111',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell completo precacheado: la app abre sin internet después de la primera carga.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\//],
        runtimeCaching: [
          {
            // Nunca cachear llamadas a la API de Supabase: los datos viven en IndexedDB.
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
          {
            // Tiles de mapa (OpenStreetMap) para recorridos ya vistos.
            urlPattern: ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    // El núcleo (tests/core) corre con node:test vía `npm run test:core`; Vitest cubre UI e integración con IndexedDB.
    include: ['tests/ui/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    setupFiles: ['tests/setup.ts'],
  },
});
