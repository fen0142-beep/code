import { useState, useEffect } from 'react'
import DynamicForm from './DynamicForm'
import {
  updateRegistration,
  logRegistrationChange,
  getEventChanges,
} from '../lib/supabase'
import { sessionFieldsForPeriod } from '../lib/registrationHelpers'
import { formatSessionTabLabel, getDisplayName } from '../lib/eventDetailHelpers'

/**
 * 編輯報名 Modal — 後台名單列「✏️ 編輯」按鈕觸發
 *
 * Props:
 *   registration:   null | 報名物件（含 student_id, answers, students 關聯）。null 時不渲染
 *   event:          活動物件（用 multi_session、name）
 *   eventId:        活動 ID（用於 logRegistrationChange / getEventChanges）
 *   fields:         event_fields 陣列（單場次活動用）
 *   sessions:       event_sessions 陣列（多場次活動用）
 *   sessionFields:  event_session_fields 陣列（多場次活動用）
 *   onClose:        關閉 modal callback
 *   onSaved:        儲存成功 callback({ registrationId, newAnswers, newChanges })
 *
 * 從 EventDetailPage 抽出（2026-05-21）；內部維護 answers / guestName / saving，
 * 父層只需保留「目前正在編輯哪筆」的 registration state。
 */
export default function EditRegistrationModal({
  registration,
  event,
  eventId,
  fields,
  sessions,
  sessionFields,
  onClose,
  onSaved,
}) {
  const [answers, setAnswers] = useState({})
  const [guestName, setGuestName] = useState('')
  const [saving, setSaving] = useState(false)

  const isGuest = !!(registration && !registration.student_id)

  // 切換 registration（含 null → 物件、物件 → 物件）時 reset state
  useEffect(() => {
    if (registration) {
      setAnswers(registration.answers ? { ...registration.answers } : {})
      setGuestName(registration.answers?.guest_name ?? '')
      setSaving(false)
    }
  }, [registration?.registration_id])

  if (!registration) return null

  async function handleSave() {
    setSaving(true)
    const oldAnswers = { ...registration.answers }
    const newAnswers = isGuest
      ? { ...answers, guest_name: guestName.trim() }
      : { ...answers }

    // 記錄異動（不阻斷主流程）
    await logRegistrationChange({
      registrationId: registration.registration_id,
      eventId,
      eventName: event?.name,
      studentName: getDisplayName(registration),
      changeType: 'modified',
      oldAnswers,
      newAnswers,
    })

    const { success, error } = await updateRegistration(registration.registration_id, newAnswers)
    setSaving(false)
    if (!success) { alert(`儲存失敗：${error}`); return }

    // 重新載入異動紀錄，父層拿來更新視覺標示
    const { changes: newChanges } = await getEventChanges(eventId)
    onSaved?.({ registrationId: registration.registration_id, newAnswers, newChanges })
    onClose?.()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-1">編輯報名內容</h3>
        <p className="text-sm text-gray-500 mb-4">
          {isGuest
            ? `訪客：${registration.answers?.guest_name ?? '-'}`
            : `學員：${registration.students?.name ?? '-'}（${registration.student_id}）`}
        </p>

        {/* 訪客才顯示姓名欄 */}
        {isGuest && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-600 mb-1">
              姓名 <span className="text-red-500">*</span>
            </label>
            <input
              required
              value={guestName}
              onChange={e => setGuestName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        )}

        {/* 多場次活動：依場次渲染子欄位編輯 */}
        {event?.multi_session && Array.isArray(answers?.sessions) && answers.sessions.length > 0 ? (
          <div className="mb-4 space-y-3">
            <p className="text-xs text-gray-500">已參加 {answers.sessions.length} 場（如需新增或移除場次，請取消後重新報名）</p>
            {answers.sessions.map((ssAns, idx) => {
              const s = sessions.find(x => x.session_id === ssAns.session_id)
              if (!s) return null
              const fieldsHere = sessionFieldsForPeriod(sessionFields, s.time_period)
              return (
                <div key={ssAns.session_id} className="border border-gray-200 rounded-xl p-3 bg-gray-50/40">
                  <p className="text-sm font-semibold text-gray-700 mb-2">
                    {formatSessionTabLabel(s)}
                    {s.dharma_name && <span className="text-gray-500 font-normal ml-2">{s.dharma_name}</span>}
                  </p>
                  {fieldsHere.length === 0 ? (
                    <p className="text-xs text-gray-400">此場次無可編輯子欄位</p>
                  ) : (
                    <DynamicForm
                      fields={fieldsHere}
                      answers={ssAns}
                      onChange={newSsAns => {
                        const updated = answers.sessions.map((x, i) =>
                          i === idx ? { ...newSsAns, session_id: ssAns.session_id } : x
                        )
                        setAnswers({ ...answers, sessions: updated })
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          fields.length > 0 && (
            <div className="mb-4">
              <DynamicForm fields={fields} answers={answers} onChange={setAnswers} />
            </div>
          )
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving || (isGuest && !guestName.trim())}
            onClick={handleSave}
            className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
