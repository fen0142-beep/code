// vite.config.js
import { defineConfig } from "file:///sessions/adoring-clever-pasteur/mnt/Claude/projects/puyi-signup/code/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/adoring-clever-pasteur/mnt/Claude/projects/puyi-signup/code/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///sessions/adoring-clever-pasteur/mnt/Claude/projects/puyi-signup/code/node_modules/vite-plugin-pwa/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "\u666E\u5B9C\u7CBE\u820D\u5831\u540D\u7CFB\u7D71",
        short_name: "\u7CBE\u820D\u5831\u540D",
        description: "\u666E\u5B9C\u7CBE\u820D\u6D3B\u52D5\u5237\u5361\u5831\u540D",
        theme_color: "#1e40af",
        background_color: "#f8fafc",
        display: "fullscreen",
        orientation: "portrait",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      },
      workbox: {
        // 快取所有靜態資源，讓 PWA 在弱網環境也能運作
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        // 新版 SW 安裝後立刻接管，不等舊頁面關閉
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Supabase API 一律走網路，不快取（確保報名狀態即時）
            urlPattern: ({ url }) => url.hostname.includes("supabase.co"),
            handler: "NetworkOnly"
          }
        ]
      }
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvYWRvcmluZy1jbGV2ZXItcGFzdGV1ci9tbnQvQ2xhdWRlL3Byb2plY3RzL3B1eWktc2lnbnVwL2NvZGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9zZXNzaW9ucy9hZG9yaW5nLWNsZXZlci1wYXN0ZXVyL21udC9DbGF1ZGUvcHJvamVjdHMvcHV5aS1zaWdudXAvY29kZS92aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vc2Vzc2lvbnMvYWRvcmluZy1jbGV2ZXItcGFzdGV1ci9tbnQvQ2xhdWRlL3Byb2plY3RzL3B1eWktc2lnbnVwL2NvZGUvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXB3YSdcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW1xuICAgIHJlYWN0KCksXG4gICAgVml0ZVBXQSh7XG4gICAgICByZWdpc3RlclR5cGU6ICdhdXRvVXBkYXRlJyxcbiAgICAgIGluY2x1ZGVBc3NldHM6IFsnZmF2aWNvbi5pY28nLCAnaWNvbi0xOTIucG5nJywgJ2ljb24tNTEyLnBuZyddLFxuICAgICAgbWFuaWZlc3Q6IHtcbiAgICAgICAgbmFtZTogJ1x1NjY2RVx1NUI5Q1x1N0NCRVx1ODIwRFx1NTgzMVx1NTQwRFx1N0NGQlx1N0Q3MScsXG4gICAgICAgIHNob3J0X25hbWU6ICdcdTdDQkVcdTgyMERcdTU4MzFcdTU0MEQnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1x1NjY2RVx1NUI5Q1x1N0NCRVx1ODIwRFx1NkQzQlx1NTJENVx1NTIzN1x1NTM2MVx1NTgzMVx1NTQwRCcsXG4gICAgICAgIHRoZW1lX2NvbG9yOiAnIzFlNDBhZicsXG4gICAgICAgIGJhY2tncm91bmRfY29sb3I6ICcjZjhmYWZjJyxcbiAgICAgICAgZGlzcGxheTogJ2Z1bGxzY3JlZW4nLFxuICAgICAgICBvcmllbnRhdGlvbjogJ3BvcnRyYWl0JyxcbiAgICAgICAgaWNvbnM6IFtcbiAgICAgICAgICB7IHNyYzogJ2ljb24tMTkyLnBuZycsIHNpemVzOiAnMTkyeDE5MicsIHR5cGU6ICdpbWFnZS9wbmcnIH0sXG4gICAgICAgICAgeyBzcmM6ICdpY29uLTUxMi5wbmcnLCBzaXplczogJzUxMng1MTInLCB0eXBlOiAnaW1hZ2UvcG5nJyB9XG4gICAgICAgIF1cbiAgICAgIH0sXG4gICAgICB3b3JrYm94OiB7XG4gICAgICAgIC8vIFx1NUZFQlx1NTNENlx1NjI0MFx1NjcwOVx1OTc1Q1x1NjE0Qlx1OENDN1x1NkU5MFx1RkYwQ1x1OEI5MyBQV0EgXHU1NzI4XHU1RjMxXHU3REIyXHU3NEIwXHU1ODgzXHU0RTVGXHU4MEZEXHU5MDRCXHU0RjVDXG4gICAgICAgIGdsb2JQYXR0ZXJuczogWycqKi8qLntqcyxjc3MsaHRtbCxpY28scG5nLHN2Z30nXSxcbiAgICAgICAgLy8gXHU2NUIwXHU3MjQ4IFNXIFx1NUI4OVx1ODhERFx1NUY4Q1x1N0FDQlx1NTIzQlx1NjNBNVx1N0JBMVx1RkYwQ1x1NEUwRFx1N0I0OVx1ODIwQVx1OTgwMVx1OTc2Mlx1OTVEQ1x1OTU4OVxuICAgICAgICBza2lwV2FpdGluZzogdHJ1ZSxcbiAgICAgICAgY2xpZW50c0NsYWltOiB0cnVlLFxuICAgICAgICBydW50aW1lQ2FjaGluZzogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIC8vIFN1cGFiYXNlIEFQSSBcdTRFMDBcdTVGOEJcdThENzBcdTdEQjJcdThERUZcdUZGMENcdTRFMERcdTVGRUJcdTUzRDZcdUZGMDhcdTc4QkFcdTRGRERcdTU4MzFcdTU0MERcdTcyQzBcdTYxNEJcdTUzNzNcdTY2NDJcdUZGMDlcbiAgICAgICAgICAgIHVybFBhdHRlcm46ICh7IHVybCB9KSA9PiB1cmwuaG9zdG5hbWUuaW5jbHVkZXMoJ3N1cGFiYXNlLmNvJyksXG4gICAgICAgICAgICBoYW5kbGVyOiAnTmV0d29ya09ubHknLFxuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfVxuICAgIH0pXG4gIF1cbn0pXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQWlZLFNBQVMsb0JBQW9CO0FBQzlaLE9BQU8sV0FBVztBQUNsQixTQUFTLGVBQWU7QUFFeEIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sUUFBUTtBQUFBLE1BQ04sY0FBYztBQUFBLE1BQ2QsZUFBZSxDQUFDLGVBQWUsZ0JBQWdCLGNBQWM7QUFBQSxNQUM3RCxVQUFVO0FBQUEsUUFDUixNQUFNO0FBQUEsUUFDTixZQUFZO0FBQUEsUUFDWixhQUFhO0FBQUEsUUFDYixhQUFhO0FBQUEsUUFDYixrQkFBa0I7QUFBQSxRQUNsQixTQUFTO0FBQUEsUUFDVCxhQUFhO0FBQUEsUUFDYixPQUFPO0FBQUEsVUFDTCxFQUFFLEtBQUssZ0JBQWdCLE9BQU8sV0FBVyxNQUFNLFlBQVk7QUFBQSxVQUMzRCxFQUFFLEtBQUssZ0JBQWdCLE9BQU8sV0FBVyxNQUFNLFlBQVk7QUFBQSxRQUM3RDtBQUFBLE1BQ0Y7QUFBQSxNQUNBLFNBQVM7QUFBQTtBQUFBLFFBRVAsY0FBYyxDQUFDLGdDQUFnQztBQUFBO0FBQUEsUUFFL0MsYUFBYTtBQUFBLFFBQ2IsY0FBYztBQUFBLFFBQ2QsZ0JBQWdCO0FBQUEsVUFDZDtBQUFBO0FBQUEsWUFFRSxZQUFZLENBQUMsRUFBRSxJQUFJLE1BQU0sSUFBSSxTQUFTLFNBQVMsYUFBYTtBQUFBLFlBQzVELFNBQVM7QUFBQSxVQUNYO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
