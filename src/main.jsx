import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'

// ── PWA 自動更新 ─────────────────────────────────────────
// vite-plugin-pwa 的 autoUpdate 只會讓新 SW 接管，不會 reload 頁面，
// 結果記憶體裡還是跑舊版 JS（曾踩到 saveEventSessions 換 session_id 的雷）。
// 這裡加雙保險：
//   1. 每 30 分鐘主動向 server 檢查有沒有新版
//   2. SW 接管時（controllerchange）自動 reload 一次，吃下新版 JS
const UPDATE_CHECK_MS = 30 * 60 * 1000

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, r) {
    if (r) setInterval(() => r.update(), UPDATE_CHECK_MS)
  },
})

// 監聽 SW 接管事件 → 自動 reload；首次安裝（原本沒 controller）不 reload
if ('serviceWorker' in navigator) {
  let initialController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!initialController) { initialController = true; return }
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
