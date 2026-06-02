import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import CameraScanner from '../components/CameraScanner'
import { findLeaderByStudentId } from '../lib/supabase'

// ─── 角色標籤 ─────────────────────────────────────────────

function roleLabel(role) {
  if (role.type === 'car') {
    const dir = role.direction === 'up' ? '🚌 去程' : '🚍 回程'
    return `${dir}・${role.carName} 領隊`
  }
  if (role.type === 'small_car') return '小車領隊'
  if (role.type === 'all')       return '總領隊'
  return '領隊'
}

function roleColor(type) {
  if (type === 'car')       return 'bg-amber-100 text-amber-800 border-amber-300'
  if (type === 'small_car') return 'bg-green-100 text-green-800 border-green-300'
  if (type === 'all')       return 'bg-blue-100 text-blue-800 border-blue-300'
  return 'bg-gray-100 text-gray-700 border-gray-300'
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function LeaderScanPage() {
  const navigate = useNavigate()

  // state: 'idle' | 'loading' | 'select' | 'notfound' | 'error'
  const [state, setState]       = useState('idle')
  const [roles, setRoles]       = useState([])
  const [showCamera, setShowCamera] = useState(false)

  const scanBufRef  = useRef('')
  const scanTimerRef = useRef(null)

  // ── 硬體掃描機 ──
  useEffect(() => {
    function handleKeyPress(e) {
      if (showCamera) return
      if (state === 'loading') return
      if (e.key === 'Enter') {
        const code = scanBufRef.current.trim()
        scanBufRef.current = ''
        clearTimeout(scanTimerRef.current)
        if (code) handleScan(code)
      } else if (e.key.length === 1) {
        scanBufRef.current += e.key
        clearTimeout(scanTimerRef.current)
        scanTimerRef.current = setTimeout(() => { scanBufRef.current = '' }, 300)
      }
    }
    window.addEventListener('keypress', handleKeyPress)
    return () => window.removeEventListener('keypress', handleKeyPress)
  }, [showCamera, state])

  // ── 掃描處理 ──
  async function handleScan(studentId) {
    setState('loading')
    const { roles: found } = await findLeaderByStudentId(studentId)

    if (!found || found.length === 0) {
      setState('notfound')
      setTimeout(() => setState('idle'), 3000)
      return
    }

    if (found.length === 1) {
      navigate(`/car-checkin/${found[0].token}`)
      return
    }

    // 多個角色（多場活動）→ 顯示選擇
    setRoles(found)
    setState('select')
  }

  // ── 待機 / 查詢中 ──
  if (state === 'idle' || state === 'loading') {
    return (
      <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-center p-8">
        <div className="text-6xl mb-5">🚌</div>
        <h1 className="text-2xl font-bold text-amber-800 mb-1">領隊報到入口</h1>
        <p className="text-gray-500 text-sm text-center mb-8">
          刷學員證 QR code，系統自動帶你進入報到頁面
        </p>

        {state === 'loading' ? (
          <div className="text-amber-700 text-base animate-pulse">查詢中…</div>
        ) : (
          <>
            <button
              onClick={() => setShowCamera(true)}
              className="w-full max-w-xs py-3.5 bg-amber-600 text-white rounded-xl font-semibold text-base hover:bg-amber-700 active:bg-amber-800 transition-colors shadow-sm"
            >
              📷 用相機掃描學員證
            </button>
            <p className="text-xs text-gray-400 mt-3 text-center">
              硬體掃描機直接掃即可，無需點按鈕
            </p>
          </>
        )}

        {showCamera && (
          <CameraScanner
            onScan={code => { setShowCamera(false); handleScan(code) }}
            onClose={() => setShowCamera(false)}
          />
        )}
      </div>
    )
  }

  // ── 找不到領隊角色 ──
  if (state === 'notfound') {
    return (
      <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-center p-8">
        <div className="text-5xl mb-4">🔍</div>
        <div className="text-lg font-semibold text-gray-700 mb-2">找不到領隊資料</div>
        <div className="text-gray-500 text-sm text-center">
          你不是本次活動的領隊，或尚未完成排車設定。<br />
          請聯絡師父確認。
        </div>
      </div>
    )
  }

  // ── 選擇活動（多場活動） ──
  if (state === 'select') {
    return (
      <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-center p-8">
        <div className="text-5xl mb-4">📋</div>
        <h2 className="text-xl font-bold text-amber-800 mb-1">請選擇你要進入的活動</h2>
        <p className="text-gray-500 text-sm mb-6">偵測到你在多場活動擔任領隊</p>

        <div className="w-full max-w-sm space-y-3">
          {roles.map(role => (
            <button
              key={role.token}
              onClick={() => navigate(`/car-checkin/${role.token}`)}
              className="w-full bg-white border border-gray-200 rounded-xl px-5 py-4 text-left hover:bg-amber-50 hover:border-amber-300 active:bg-amber-100 transition-colors shadow-sm"
            >
              <div className="font-semibold text-gray-800 mb-1.5">{role.eventName}</div>
              <span className={`text-xs border rounded-full px-2.5 py-0.5 font-medium ${roleColor(role.type)}`}>
                {roleLabel(role)}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={() => setState('idle')}
          className="mt-6 text-sm text-gray-400 hover:text-gray-600 underline"
        >
          重新掃描
        </button>
      </div>
    )
  }

  return null
}
