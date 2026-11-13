import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // When this build was made -- shown on the page so a phone still running an
  // older copy can be told apart from the latest at a glance.
  define: {
    __APP_BUILD__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered in src/pwaUpdate.ts, which also reloads onto a new version.
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Kumar Signals Pro',
        short_name: 'Signals Pro',
        description: 'Premium MCX commodity options signals: crude oil & natural gas buy/sell calls',
        theme_color: '#2563EB',
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,mp3}'],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
