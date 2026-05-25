import { useState, useEffect, useRef } from 'react'
import SearchableSelect from './SearchableSelect'
import DynamicForm from './DynamicForm'
import {
  getAllStudents,
  checkDuplicate,
  submitRegistration,
  logRegistrationChange,
} from '../lib/supabase'

/**
 * 學員手動報名 Modal — 後台「＋ 新增學員報名」按鈕觸發
 *
 * Props:
 *   open:      boolean，控制顯示
 *   onClose:   關閉 callback
 *   onSuccess: 報名成功後 callback（父層呼叫 load()）
 *   event:     活動物件（用 name）
 *   eventId:   活動 ID
 *   fields:    event_fields 陣列
 */
export default function StudentRegistrationModal({ open, onClose, onSuccess, event, eventId, fields }) {
  const [studentSelectedId, setStudentSelectedId] = useState('')
  const [studentAnswers, setStudentAnswers] = useState({})
  const [studentSaving, setStudentSaving] = useState(false)
  const [studentDuplicate, setStudentDuplicate] = useState(false)
  const [allStudents, setAllStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const loadedRef = useRef(false)

  // 開啟時 reset form；首次開啟時 lazy load 學員清單
  useEffect(() => {
    if (!open) return
    setStudentSelectedId('')
    setStudentAnswers({})
    setStudentDuplicate(false)
    if (!loadedRef.current) {
      loadedRef.current = true
      setStudentsLoading(true)
      getAllStudents().then(({ students }) => {
        setAllStudents((students || []).filter(s => s.active !== false))
        setStudentsLoading(false)
      })
    }
  }, [open])

  const selectedStudent = studentSelectedId
    ? allStudents.find(s => s.student_id === studentSelectedId)
    : null

  async function handleStudentPick(sid) {
    setStudentSelectedId(sid)
    setStudentDuplicate(false)
    if (!sid) return
    const dup = await checkDuplicate(eventId, sid)
    setStudentDuplicate(dup)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!studentSelectedId) { alert('請先選擇學員'); return }
    if (studentDuplicate) { alert('此學員已報名此活動，請改用「編輯」'); return }

    setStudentSaving(true)
    const plateFields = fields.filter(f => f.field_type === 'plate')
    const isDriver = plateFields.some(f => {
      const v = studentAnswers?.[f.field_key]
      return v && String(v).trim() !== ''
    })

    const { success, error } = await submitRegistration(
      eventId,
      studentSelectedId,
      studentAnswers,
      'admin-manual',
      isDriver,
    )
    setStudentSaving(false)
    if (!success) { alert(`新增失敗：${error}`); return }

    await logRegistrationChange({
      registrationId: null,
      eventId,
      eventName: event.name,
      studentName: selectedStudent?.name ?? '',
      changeType: 'created',
      oldAnswers: null,
      newAnswers: studentAnswers,
    })

    onClose?.()
    onSuccess?.()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <form onSubmit={handleSubmit}>
          <h3 className="text-lg font-bold text-gray-800 mb-1">新增學員報名</h3>
          <p className="text-xs text-gray-500 mb-4">從學員清單選人後補填表單（不必刷學員證）</p>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-600 mb-1">
              學員 <span className="text-red-500">*</span>
            </label>
            {studentsLoading ? (
              <p className="text-sm text-gray-400 px-3 py-2">載入學員清單中…</p>
            ) : (
              <SearchableSelect
                value={studentSelectedId}
                onChange={handleStudentPick}
                options={allStudents.map(s => {
                  const cls = s.student_classes?.[0]
                  const classText = cls
                    ? `${cls.class_name ?? ''}${cls.group_name ? `・${cls.group_name}` : ''}`
                    : ''
                  return {
                    value: s.student_id,
                    label: `${s.name}（${s.student_id}）`,
                    sublabel: classText,
                    searchText: `${s.name} ${s.student_id} ${classText}`.toLowerCase(),
                  }
                })}
                placeholder="請選擇學員（可搜尋姓名／編號／班級）"
                searchPlaceholder="輸入姓名／編號／班級…"
              />
            )}
          </div>

          {studentDuplicate && selectedStudent && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              ⚠️ <strong>{selectedStudent.name}</strong> 已報名此活動。請至報名名單點該筆「編輯」修改。
            </div>
          )}

          {studentSelectedId && !studentDuplicate && fields.length > 0 && (
            <div className="mb-4 pt-3 border-t border-gray-100">
              <DynamicForm fields={fields} answers={studentAnswers} onChange={setStudentAnswers} />
            </div>
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
              type="submit"
              disabled={studentSaving || !studentSelectedId || studentDuplicate}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {studentSaving ? '新增中…' : '確認報名'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
