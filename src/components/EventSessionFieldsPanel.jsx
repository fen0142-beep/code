import { useState, useEffect, useRef } from 'react'
import { getEventSessionFields, saveEventSessionFields } from '../lib/supabase'

const PERIOD_OPTIONS = [
  { value: 'morning',   label: '上午' },
  { value: 'afternoon', label: '下午' },
  { value: 'evening',   label: '晚上' },
]

const FIELD_TYPE_OPTIONS = [
  { value: 'radio',   label: 'radio（單選按鈕）' },
  { value: 'boolean', label: 'boolean（單一勾選）' },
  { value: 'text',    label: 'text（文字輸入）' },
]

// 把顯示名稱轉成簡單的 key（給 field_key 自動帶入用）
function slugifyLabel(label) {
  const trimmed = (label || '').trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed
    .replace(/[\s／/\-—,，、。.]+/g, '_')
    .replace(/[^a-z0-9_一-龥]+/g, '')
    .slice(0, 32)
}

const EMPTY_FIELD = () => ({
  _key: crypto.randomUUID(),
  field_id: null,
  field_key: '',
  field_label: '',
  field_type: 'radio',
  options: [],
  show_if_period: [],   // 空陣列 = 所有時段都顯示
  required: true,
})

export default function EventSessionFieldsPanel({ eventId }) {
  const [fields,  setFields]  = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState('')
  const fieldsRef = useRef(fields)

  useEffect(() => {
    if (!eventId) return
    setLoading(true)
    getEventSessionFields(eventId).then(({ fields: data, error }) => {
      if (error) { setMsg('❌ 載入失敗：' + error); setLoading(false); return }
      const mapped = (data || []).map(f => ({
        _key:           f.field_id || crypto.randomUUID(),
        field_id:       f.field_id,
        field_key:      f.field_key,
        field_label:    f.field_label,
        field_type:     f.field_type || 'radio',
        options:        Array.isArray(f.options) ? f.options : [],
        show_if_period: Array.isArray(f.show_if_period) ? f.show_if_period : [],
        required:       f.required ?? true,
      }))
      setFields(mapped)
      fieldsRef.current = mapped
      setLoading(false)
    })
  }, [eventId])

  async function doSave(list) {
    // 寬鬆驗證：有空白 label 就靜默跳過（讓使用者繼續打字）
    if (list.some(f => !f.field_label?.trim())) return
    if (list.some(f => !f.field_key?.trim()))    return

    // 嚴格驗證：radio 必須有選項
    const badRadio = list.find(f => f.field_type === 'radio' && (f.options || []).filter(o => o?.trim()).length === 0)
    if (badRadio) {
      setMsg('⚠️ 「' + badRadio.field_label + '」是單選，請至少設定一個選項')
      return
    }

    // 重複 field_key
    const seen = new Set()
    for (const f of list) {
      if (seen.has(f.field_key)) {
        setMsg('⚠️ 程式識別碼「' + f.field_key + '」重複，請修正')
        return
      }
      seen.add(f.field_key)
    }

    setSaving(true)
    setMsg('')
    // 存之前把空字串選項過濾掉
    const cleaned = list.map(f => ({
      ...f,
      options: (f.options || []).map(o => (o || '').trim()).filter(Boolean),
    }))
    const { success, error } = await saveEventSessionFields(eventId, cleaned)
    setSaving(false)
    if (!success) { setMsg('❌ 儲存失敗：' + error); return }
    setMsg('✅ 已儲存')
    setTimeout(() => setMsg(''), 2000)
  }

  function updateField(key, patch) {
    setFields(prev => {
      const next = prev.map(f => f._key === key ? { ...f, ...patch } : f)
      fieldsRef.current = next
      return next
    })
  }

  function updateAndSave(key, patch) {
    const next = fields.map(f => f._key === key ? { ...f, ...patch } : f)
    setFields(next)
    fieldsRef.current = next
    doSave(next)
  }

  function handleBlur() {
    doSave(fieldsRef.current)
  }

  function addField() {
    const next = [...fields, EMPTY_FIELD()]
    setFields(next)
    fieldsRef.current = next
  }

  function removeField(key) {
    const next = fields.filter(f => f._key !== key)
    setFields(next)
    fieldsRef.current = next
    doSave(next)
  }

  function moveUp(idx) {
    if (idx === 0) return
    const next = [...fields]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setFields(next)
    fieldsRef.current = next
    doSave(next)
  }

  function moveDown(idx) {
    if (idx === fields.length - 1) return
    const next = [...fields]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setFields(next)
    fieldsRef.current = next
    doSave(next)
  }

  function setOption(key, i, val) {
    const f = fields.find(x => x._key === key)
    if (!f) return
    const opts = [...(f.options || [])]
    opts[i] = val
    updateField(key, { options: opts })
  }

  function addOption(key) {
    const f = fields.find(x => x._key === key)
    if (!f) return
    updateField(key, { options: [...(f.options || []), ''] })
  }

  function removeOption(key, i) {
    const f = fields.find(x => x._key === key)
    if (!f) return
    const next = (f.options || []).filter((_, j) => j !== i)
    updateAndSave(key, { options: next })
  }

  function togglePeriod(key, period) {
    const f = fields.find(x => x._key === key)
    if (!f) return
    const cur = f.show_if_period || []
    const next = cur.includes(period) ? cur.filter(p => p !== period) : [...cur, period]
    updateAndSave(key, { show_if_period: next })
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

  return (
    <div className="mt-4 bg-emerald-50 rounded-xl border border-emerald-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-emerald-800">📋 場次共用子欄位</p>
          <p className="text-xs text-gray-600 mt-0.5">
            學員勾選任一場次時，下方會出現的子問題（例：午齋、停車…）。
            可指定只在特定時段顯示。新增、修改、刪除皆自動儲存。
          </p>
        </div>
        <span className={'text-xs px-3 py-1.5 rounded-lg shrink-0 transition-opacity ' + statusClass}>
          {saving ? '儲存中…' : msg}
        </span>
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4 bg-white rounded-lg border border-dashed border-emerald-200">
          尚無子欄位，點下方「＋ 新增子欄位」開始設定（不設定的話前台會以「午齋／停車」預設運作）
        </p>
      ) : (
        <div className="space-y-2">
          {fields.map((f, idx) => {
            const periods = f.show_if_period || []
            const allPeriods = periods.length === 0
            return (
              <div key={f._key} className="bg-white border border-emerald-200 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                  {/* 顯示名稱 */}
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">顯示名稱</label>
                    <input
                      value={f.field_label}
                      onChange={e => {
                        const label = e.target.value
                        const patch = { field_label: label }
                        // 自動帶 field_key（若使用者未自訂過）
                        if (!f.field_id && (!f.field_key || f.field_key === slugifyLabel(f.field_label))) {
                          patch.field_key = slugifyLabel(label)
                        }
                        updateField(f._key, patch)
                      }}
                      onBlur={handleBlur}
                      placeholder="例：午齋"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </div>
                  {/* field_key（程式識別碼） */}
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">程式識別碼</label>
                    <input
                      value={f.field_key}
                      onChange={e => updateField(f._key, { field_key: e.target.value })}
                      onBlur={handleBlur}
                      placeholder="自動填入"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </div>
                  {/* 類型 */}
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">類型</label>
                    <select
                      value={f.field_type}
                      onChange={e => updateAndSave(f._key, { field_type: e.target.value })}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    >
                      {FIELD_TYPE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  {/* 顯示時段 */}
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">
                      顯示時段 <span className="text-gray-400">（不勾＝全部）</span>
                    </label>
                    <div className="flex gap-1 flex-wrap">
                      {PERIOD_OPTIONS.map(p => {
                        const on = periods.includes(p.value)
                        return (
                          <button
                            key={p.value}
                            type="button"
                            onClick={() => togglePeriod(f._key, p.value)}
                            className={'text-xs px-2 py-1 rounded border transition-colors ' + (
                              on
                                ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                                : allPeriods
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                  : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-50'
                            )}
                          >
                            {p.label}{on ? ' ✓' : ''}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {/* 必填 + 排序 + 刪除 */}
                  <div className="sm:col-span-1 flex sm:flex-col items-center sm:items-end gap-1 pt-4 sm:pt-1">
                    <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={f.required ?? true}
                        onChange={e => updateAndSave(f._key, { required: e.target.checked })}
                        className="accent-emerald-600"
                      />
                      必填
                    </label>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => moveUp(idx)} disabled={idx === 0} title="上移"
                        className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs">▲</button>
                      <button onClick={() => moveDown(idx)} disabled={idx === fields.length - 1} title="下移"
                        className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20 text-xs">▼</button>
                      <button onClick={() => removeField(f._key)} title="刪除此欄位"
                        className="p-0.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 text-xs">✕</button>
                    </div>
                  </div>
                </div>

                {/* radio 選項 */}
                {f.field_type === 'radio' && (
                  <div className="pl-2 border-l-2 border-emerald-200">
                    <div className="text-[10px] font-medium text-gray-500 mb-1">選項</div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {(f.options || []).map((opt, i) => (
                        <div key={i} className="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                          <input
                            value={opt}
                            onChange={e => setOption(f._key, i, e.target.value)}
                            onBlur={handleBlur}
                            placeholder={`選項 ${i + 1}`}
                            className="bg-transparent text-xs w-20 focus:outline-none"
                          />
                          <button
                            onClick={() => removeOption(f._key, i)}
                            className="text-gray-300 hover:text-red-400 text-sm leading-none"
                            title="刪除選項"
                          >×</button>
                        </div>
                      ))}
                      <button
                        onClick={() => addOption(f._key)}
                        className="text-xs text-emerald-700 hover:text-emerald-900 border border-dashed border-emerald-300 hover:border-emerald-500 px-2 py-0.5 rounded"
                      >
                        ＋ 選項
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <button
        onClick={addField}
        className="mt-3 text-sm text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
      >
        ＋ 新增子欄位
      </button>
    </div>
  )
}
