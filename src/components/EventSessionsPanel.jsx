import { useState, useEffect, useRef } from 'react'
import { getEventSessions, saveEventSessions } from '../lib/supabase'

const TIME_PERIOD_OPTIONS = [
  { value: 'morning',   label: '上午' },
  { value: 'afternoon', label: '下午' },
  { value: 'evening',   label: '晚上' },
]

const EMPTY_SESSION = () => ({
  _key:        crypto.randomUUID(),
  date:        '',
  time_period: 'morning',
  dharma_name: '',
  time_start:  '',
  time_end:    '',
})

export default function EventSessionsPanel({ eventId, onSaved }) {
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState('')

  const sessionsRef = useRef(sessions)

  useEffect(() => {
    if (!eventId) return
    setLoading(true)
    getEventSessions(eventId).then(({ sessions: data, error }) => {
      if (error) { setMsg('❌ 載入失敗：' + error); setLoading(false); return }
      const mapped = data.map(s => ({ ...s, _key: s.session_id }))
      setSessions(mapped)
      sessionsRef.current = mapped
      setLoading(false)
    })
  }, [eventId])

  async function doSave(list) {
    if (list.some(s => !s.date)) return

    if (list.some(s => !s.dharma_name?.trim())) {
      setMsg('⚠️ 場次設定內，不可有空白欄位，請確認各欄位是否皆已填寫')
      return
    }

    const seen = new Set()
    for (const s of list) {
      const key = s.date + '_' + s.time_period
      if (seen.has(key)) {
        const label = TIME_PERIOD_OPTIONS.find(o => o.value === s.time_period)?.label ?? s.time_period
        setMsg('⚠️ 日期 ' + s.date + ' 的「' + label + '」場次重複，請修正')
        return
      }
      seen.add(key)
    }

    setSaving(true)
    setMsg('')
    const { success, error } = await saveEventSessions(eventId, list)
    setSaving(false)
    if (!success) { setMsg('❌ 儲存失敗：' + error); return }

    const { sessions: fresh } = await getEventSessions(eventId)
    const mapped = fresh.map(s => ({ ...s, _key: s.session_id }))
    setSessions(mapped)
    sessionsRef.current = mapped
    setMsg('✅ 已儲存')
    setTimeout(() => setMsg(''), 2000)
    onSaved?.(fresh)
  }

  function updateSession(key, field, value) {
    setSessions(prev => {
      const next = prev.map(s => s._key === key ? { ...s, [field]: value } : s)
      sessionsRef.current = next
      return next
    })
  }

  function updateAndSave(key, field, value) {
    const next = sessions.map(s => s._key === key ? { ...s, [field]: value } : s)
    setSessions(next)
    sessionsRef.current = next
    doSave(next)
  }

  function handleBlur() {
    doSave(sessionsRef.current)
  }

  function addSession() {
    const next = [...sessions, EMPTY_SESSION()]
    setSessions(next)
    sessionsRef.current = next
  }

  function removeSession(key) {
    const next = sessions.filter(s => s._key !== key)
    setSessions(next)
    sessionsRef.current = next
    doSave(next)
  }

  function moveUp(idx) {
    if (idx === 0) return
    const next = [...sessions]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setSessions(next)
    sessionsRef.current = next
    doSave(next)
  }

  function moveDown(idx) {
    if (idx === sessions.length - 1) return
    const next = [...sessions]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setSessions(next)
    sessionsRef.current = next
    doSave(next)
  }

  if (loading) {
    return (
      <div className="mt-4 bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm text-gray-400">載入場次中…</p>
      </div>
    )
  }

  const statusClass = saving
    ? 'bg-gray-100 text-gray-500 opacity-100'
    : msg.startsWith('✅')
      ? 'bg-green-50 text-green-700 opacity-100'
      : msg.startsWith('⚠')
        ? 'bg-amber-50 text-amber-700 opacity-100'
        : msg.startsWith('❌')
          ? 'bg-red-50 text-red-700 opacity-100'
          : 'opacity-0 pointer-events-none'

  return (
    <div className="mt-4 bg-white rounded-xl border border-indigo-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-indigo-800">📅 場次設定</p>
          <p className="text-xs text-gray-500 mt-0.5">
            填完日期後系統自動儲存；刪除、移動場次亦即時生效。
          </p>
        </div>
        <span className={'text-xs px-3 py-1.5 rounded-lg shrink-0 transition-opacity ' + statusClass}>
          {saving ? '儲存中…' : msg}
        </span>
      </div>

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
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-2">法會名稱 *</th>
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-2">開始</th>
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-2">結束</th>
                <th className="text-left text-xs font-medium text-gray-500 pb-2 w-20">排序 / 刪</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, idx) => {
                const dupKey = s.date + '_' + s.time_period
                const isDup  = s.date && sessions.filter(x => (x.date + '_' + x.time_period) === dupKey).length > 1

                return (
                  <tr key={s._key} className={'border-b border-gray-100 ' + (isDup ? 'bg-amber-50' : '')}>
                    <td className="py-1.5 pr-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-1.5 pr-2">
                      <input type="date" value={s.date}
                        onChange={e => updateSession(s._key, 'date', e.target.value)}
                        onBlur={handleBlur}
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 w-36" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <select value={s.time_period}
                        onChange={e => updateAndSave(s._key, 'time_period', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400">
                        {TIME_PERIOD_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      {isDup && <span className="ml-1 text-xs text-amber-600">⚠️ 重複</span>}
                    </td>
                    <td className="py-1.5 pr-2">
                      <input type="text" value={s.dharma_name}
                        onChange={e => updateSession(s._key, 'dharma_name', e.target.value)}
                        onBlur={handleBlur}
                        placeholder="例：梁皇寶懺第一卷"
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 w-44" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input type="time" value={s.time_start}
                        onChange={e => updateSession(s._key, 'time_start', e.target.value)}
                        onBlur={handleBlur}
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 w-24" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input type="time" value={s.time_end}
                        onChange={e => updateSession(s._key, 'time_end', e.target.value)}
                        onBlur={handleBlur}
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 w-24" />
                    </td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => moveUp(idx)} disabled={idx === 0} title="上移"
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20">▲</button>
                        <button onClick={() => moveDown(idx)} disabled={idx === sessions.length - 1} title="下移"
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20">▼</button>
                        <button onClick={() => removeSession(s._key)} title="刪除此場次"
                          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">✕</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <button onClick={addSession}
        className="mt-3 text-sm text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors">
        ＋ 新增場次
      </button>
    </div>
  )
}
