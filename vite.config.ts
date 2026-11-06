import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        // Partes estables en archivos propios: una actualización de la app no obliga a re-descargar todo.
        manualChunks(id) {
          if (id.includes('node_modules/leaflet')) return 'map';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler') || id.includes('node_modules/react-router')) return 'react';
          if (id.includes('node_modules/dexie')) return 'dexie';
          if (id.includes('/src/data/')) return 'catalog';
          return undefined;
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'logo.png'],
      manifest: {
        name: 'FIT 20',
        short_name: 'FIT 20',
        description: 'Entrenamiento, running, nutrición y progreso — funciona sin internet.',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#111111',
        shortcuts: [
          { name: 'Entrenar hoy', short_name: 'Entrenar', url: '/entrenar', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Correr con GPS', short_name: 'Correr', url: '/running/en-curso', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Registrar comida', short_name: 'Comida', url: '/nutricion/agregar', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Registrar peso', short_name: 'Peso', url: '/progreso/medir', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell completo precacheado: la app abre sin internet después de la primera carga.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        // Recepción de notificaciones push (public/push-sw.js).
        importScripts: ['/push-sw.js'],
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
