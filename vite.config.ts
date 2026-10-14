import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // SW-Generierung nur für den Production-Build; im Dev stört der SW den Vite-HMR.
      devOptions: { enabled: false },
      includeAssets: ['logo.png'],
      manifest: {
        name: 'BMA-Lager',
        short_name: 'BMA-Lager',
        description: 'Offline-fähige Lagerverwaltung auf Basis IndexedDB.',
        lang: 'de-DE',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#0b3d91',
        icons: [
          { src: 'logo.png', sizes: '192x192', type: 'image/png' },
          { src: 'logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'logo.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App-Shell precachen.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // config.js wird zur Laufzeit vom Container-Entrypoint generiert
        // (scripts/pwa-entrypoint.sh) und darf NICHT precached werden —
        // sonst liefert der SW eine stale URL aus.
        globIgnores: ['config.js'],
        // Bilder: CacheFirst mit Größenlimit (60 Einträge, 30 Tage).
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'bma-images',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
        // Navigation-Fallback für SPA-Routing im Offline-Modus.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
