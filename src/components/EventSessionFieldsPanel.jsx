// 活動詳情頁的「場次共用子欄位」面板（auto-save wrapper）
//
// 2026-05-19 重構：把 UI 抽到 SessionFieldsEditor，本檔只負責：
//   1. 從 DB 載入此活動的 event_session_fields
//   2. 提供 SessionFieldsEditor 的 value / onChange / onCommit 介面
//      - onChange: 編輯中，只 setState
//      - onCommit: 行為完成，setState 後立刻 saveEventSessionFields
//
// 行為跟先前版本一致：blur / 切類型 / 移位 / 刪欄位 / 切時段 / 切看板角色都會即時存。
import { useState, useEffect, useRef } from 'react'
import { getEventSessionFields, saveEventSessionFields } from '../lib/supabase'
import SessionFieldsEditor, { cleanSessionFieldsForSave, validateSessionFields } from './SessionFieldsEditor'

export default function EventSessionFieldsPanel({ eventId }) {
  const [fields,  setFields]  = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState('')
  const lastSavedRef = useRef(null) // 用來避免重複送（serialize 比對）

  useEffect(() => {
    if (!eventId) return
    setLoading(true)
    getEventSessionFields(eventId).then(({ fields: data, error }) => {
      if (error) { setMsg('❌ 載入失敗：' + error); setLoading(false); return }
      setFields(data || [])
      lastSavedRef.current = JSON.stringify(data || [])
      setLoading(false)
    })
  }, [eventId])

  async function doSave(list) {
    const cleaned = cleanSessionFieldsForSave(list)
    const v = validateSessionFields(cleaned)
    if (!v.ok) { setMsg(v.msg); return }

    // 避免重複送同一份
    const sig = JSON.stringify(cleaned)
    if (sig === lastSavedRef.current) return

    setSaving(true)
    setMsg('')
    const { success, error } = await saveEventSessionFields(eventId, cleaned)
    setSaving(false)
    if (!success) { setMsg('❌ 儲存失敗：' + error); return }
    lastSavedRef.current = sig
    setMsg('✅ 已儲存')
    setTimeout(() => setMsg(''), 2000)
  }

  if (loading) {
    return (
      <div className="mt-4 bg-emerald-50 rounded-xl border border-emerald-200 p-5">
        <p className="text-sm text-gray-400">載入場次共用子欄位中…</p>
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

  const statusSlot = (
    <span className={'text-xs px-3 py-1.5 rounded-lg shrink-0 transition-opacity ' + statusClass}>
      {saving ? '儲存中…' : msg}
    </span>
  )

  return (
    <SessionFieldsEditor
      value={fields}
      onChange={next => setFields(next)}
      onCommit={next => { setFields(next); doSave(next) }}
      description="學員勾選任一場次時，下方會出現的子問題（例：午齋、停車…）。可指定只在特定時段顯示。新增、修改、刪除皆自動儲存。"
      emptyHint="尚無子欄位，點下方「＋ 新增子欄位」開始設定（不設定的話前台會以「午齋／停車」預設運作）"
      statusSlot={statusSlot}
    />
  )
}
