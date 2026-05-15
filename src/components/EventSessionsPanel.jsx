import { useState, useEffect } from 'react'
import { getEventSessions, saveEventSessions } from '../lib/supabase'

const TIME_PERIOD_OPTIONS = [
  { value: 'morning',   label: '上午' },
  { value: 'afternoon', label: '下午' },
  { value: 'evening',   label: '晚上' },
]

const EMPTY_SESSION = () => ({
  _key:        crypto.randomUUID(),   // 前端暫用 key，不送 DB
  date:        '',
  time_period: 'morning',
  dharma_name: '',
  time_start:  '',
  time_end:    '',
})

/**
 * 多場次設定面板
 * Props:
 *   eventId  — 活動 ID
 */
export default function EventSessionsPanel({ eventId, onSaved }) {
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState('')

  // 載入
  useEffect(() => {
    if (!eventId) return
    setLoading(true)
    getEventSessions(eventId).then(({ sessions: data, error }) => {
      if (error) { setMsg(`❌ 載入失敗：${error}`); setLoading(false); return }
      setSessions(data.map(s => ({ ...s, _key: s.session_id })))
      setLoading(false)
    })
  }, [eventId])

  // ── 操作 ────────────────────────────────────────────────

  function addSession() {
    setSessions(prev => [...prev, EMPTY_SESSION()])
  }

  function removeSession(key) {
    setSessions(prev => prev.filter(s => s._key !== key))
  }

  function updateSession(key, field, value) {
    setSessions(prev => prev.map(s =>
      s._key === key ? { ...s, [field]: value } : s
    ))
  }

  function moveUp(idx) {
    if (idx === 0) return
    setSessions(prev => {
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }

  function moveDown(idx) {
    setSessions(prev => {
      if (idx === prev.length - 1) return prev
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }

  // 儲存
  async function handleSave() {
    // 驗證必填
    for (const s of sessions) {
      if (!s.date)        { setMsg('❌ 請填寫所有場次的日期'); return }
      if (!s.time_period) { setMsg('❌ 請填寫所有場次的時段'); return }
    }

    // 軟檢查重複
    const seen = new Set()
    for (const s of sessions) {
      const key = `${s.date}_${s.time_period}`
      if (seen.has(key)) {
        const label = TIME_PERIOD_OPTIONS.find(o => o.value === s.time_period)?.label ?? s.time_period
        setMsg(`⚠️ 日期 ${s.date} 的「${label}」場次重複，請確認後再儲存`)
        return
      }
      seen.add(key)
    }

    setSaving(true)
    const { success, error } = await saveEventSessions(eventId, sessions)
    setSaving(false)
    if (!success) { setMsg(`❌ 儲存失敗：${error}`); return }

    // 重新載入（讓 session_id 補齊）
    const { sessions: fresh } = await getEventSessions(eventId)
    setSessions(fresh.map(s => ({ ...s, _key: s.session_id })))
    setMsg('✅ 場次已儲存')
    setTimeout(() => setMsg(''), 3000)
    onSaved?.(fresh)  // 通知父元件更新 sessions state
  }

  // ── 渲染 ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mt-4 bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm text-gray-400">載入場次中…</p>
      </div>
    )
  }

  return (
    <div className="mt-4 bg-white rounded-xl border border-indigo-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-indigo-800">📅 場次設定</p>
          <p className="text-xs text-gray-500 mt-0.5">
            新增活動的每個場次，前台學員刷卡後可一次勾選要參加的場次。
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm font-medium px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50 shrink-0"
        >
          {saving ? '儲存中…' : '💾 儲存場次'}
        </button>
      </div>

      {msg && (
        <p className={`text-xs mb-3 px-3 py-2 rounded-lg ${
          msg.startsWith('✅') ? 'bg-green-50 text-green-700'
          : msg.startsWith('⚠️') ? 'bg-amber-50 text-amber-700'
          : 'bg-red-50 text-red-700'
        }`}>
          {msg}
        </p>
      )}

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">尚無場次，點下方「＋ 新增場次」開始設定</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-2 w-6">#</th>
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-2">日期 *</th>
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-2">時段 *</th>
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-2">法會名稱</th>
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-2">開始</th>
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-2">結束</th>
                <th className="text-left text-xs font-medium text-gray-500 pb-2 w-20">排序 / 刪</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, idx) => {
                // 重複警告
                const dupKey = `${s.date}_${s.time_period}`
                const isDup  = s.date && sessions.filter(x => `${x.date}_${x.time_period}` === dupKey).length > 1

                return (
                  <tr key={s._key} className={`border-b border-gray-100 ${isDup ? 'bg-amber-50' : ''}`}>
                    <td className="py-1.5 pr-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="date"
                        value={s.date}
                        onChange={e => updateSession(s._key, 'date', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 w-36"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <select
                        value={s.time_period}
                        onChange={e => updateSession(s._key, 'time_period', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      >
                        {TIME_PERIOD_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      {isDup && <span className="ml-1 text-xs text-amber-600">⚠️ 重複</span>}
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="text"
                        value={s.dharma_name}
                        onChange={e => updateSession(s._key, 'dharma_name', e.target.value)}
                        placeholder="例：梁皇寶懺第一卷"
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 w-44"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="time"
                        value={s.time_start}
                        onChange={e => updateSession(s._key, 'time_start', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 w-24"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="time"
                        value={s.time_end}
                        onChange={e => updateSession(s._key, 'time_end', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 w-24"
                      />
                    </td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveUp(idx)}
                          disabled={idx === 0}
                          title="上移"
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20"
                        >▲</button>
                        <button
                          onClick={() => moveDown(idx)}
                          disabled={idx === sessions.length - 1}
                          title="下移"
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20"
                        >▼</button>
                        <button
                          onClick={() => removeSession(s._key)}
                          title="刪除此場次"
                          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                        >✕</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={addSession}
        className="mt-3 text-sm text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
      >
        ＋ 新增場次
      </button>
    </div>
  )
}
ors"
      >
        ＋ 新增場次
      </button>
    </div>
  )
}
