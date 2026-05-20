import { formatFieldValue } from '../lib/eventDetailHelpers'

/**
 * 異動明細 Modal — 顯示某筆 audit_log 對應的 answers diff
 *
 * Props:
 *   diffModal: { old_answers, new_answers, student_name, changed_at } | null
 *   fields:    活動的 event_fields 陣列（用於 label / formatFieldValue）
 *   onClose:   關閉 callback
 *
 * 從 EventDetailPage 抽出（2026-05-20 六度），純呈現，無內部 state。
 */
export default function DiffDetailModal({ diffModal, fields, onClose }) {
  if (!diffModal) return null

  const old = diffModal.old_answers ?? {}
  const next = diffModal.new_answers ?? {}
  // 取所有出現過的 key（union）
  const allKeys = Array.from(new Set([...Object.keys(old), ...Object.keys(next)]))
  // 依欄位定義順序排序（沒有定義的放最後）
  const sortedKeys = [
    ...fields.map(f => f.field_key).filter(k => allKeys.includes(k)),
    ...allKeys.filter(k => !fields.find(f => f.field_key === k)),
  ]
  const changedKeys = sortedKeys.filter(k => {
    const ov = old[k]; const nv = next[k]
    return JSON.stringify(ov) !== JSON.stringify(nv)
  })
  const unchangedKeys = sortedKeys.filter(k => !changedKeys.includes(k))

  function fmtVal(key, val) {
    if (val === undefined || val === null || val === '') return <span className="text-gray-300 italic">（空）</span>
    const fieldDef = fields.find(f => f.field_key === key)
    if (!fieldDef) return String(val)
    return formatFieldValue(fieldDef, val)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 pt-5 pb-4 rounded-t-2xl">
          <h3 className="text-lg font-bold text-gray-800">異動明細</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="font-medium">{diffModal.student_name}</span>
            　{new Date(diffModal.changed_at).toLocaleString('zh-TW', { hour12: false })}
          </p>
        </div>
        <div className="px-6 py-4 space-y-4">
          {changedKeys.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">找不到差異資料</p>
          ) : (
            <>
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">已修改的欄位（{changedKeys.length} 項）</p>
              {changedKeys.map(key => {
                const fieldDef = fields.find(f => f.field_key === key)
                const label = fieldDef?.field_label ?? key
                return (
                  <div key={key} className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-800 mb-2">{label}</p>
                    <div className="flex items-start gap-2 text-sm">
                      <div className="flex-1 bg-red-50 border border-red-200 rounded-lg px-3 py-2 line-through text-red-700">
                        {fmtVal(key, old[key])}
                      </div>
                      <span className="text-gray-400 mt-2">→</span>
                      <div className="flex-1 bg-green-50 border border-green-300 rounded-lg px-3 py-2 font-medium text-green-800">
                        {fmtVal(key, next[key])}
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}
          {unchangedKeys.filter(k => !['guest_name','host_name','guest_phone'].includes(k)).length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-gray-400 cursor-pointer select-none hover:text-gray-600">
                未修改的欄位（{unchangedKeys.filter(k => !['guest_name','host_name','guest_phone'].includes(k)).length} 項）
              </summary>
              <div className="mt-2 space-y-1">
                {unchangedKeys.filter(k => !['guest_name','host_name','guest_phone'].includes(k)).map(key => {
                  const fieldDef = fields.find(f => f.field_key === key)
                  const label = fieldDef?.field_label ?? key
                  return (
                    <div key={key} className="flex items-center gap-2 text-xs text-gray-400 px-1">
                      <span className="w-28 shrink-0">{label}</span>
                      <span>{fmtVal(key, next[key])}</span>
                    </div>
                  )
                })}
              </div>
            </details>
          )}
        </div>
        <div className="px-6 pb-5">
          <button
            onClick={onClose}
            className="w-full border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
