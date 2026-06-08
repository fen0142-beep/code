import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: (process.env.VITE_TEMPLE_NAME || '精舍') + '報名系統',
        short_name: '精舍報名',
        description: (process.env.VITE_TEMPLE_NAME || '精舍') + '活動刷卡報名',
        theme_color: '#1e40af',
        background_color: '#f8fafc',
        display: 'fullscreen',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        // 快取所有靜態資源，讓 PWA 在弱網環境也能運作
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // 新版 SW 安裝後立刻接管，不等舊頁面關閉
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Supabase API 一律走網路，不快取（確保報名狀態即時）
            urlPattern: ({ url }) => url.hostname.includes('supabase.co'),
            handler: 'NetworkOnly',
          }
        ]
      }
    })
  ]
})
