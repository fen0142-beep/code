// 場次共用子欄位編輯器（純 controlled，受 value/onChange 控制）
//
// 從原本 EventSessionFieldsPanel 抽出來，作為共用 UI 元件：
//   - EventSessionFieldsPanel 用它（活動詳情頁，auto-save）
//   - TemplatesPage          用它（模板編輯器，跟 fields 一起按鈕儲存）
//
// 兩種 commit 回呼：
//   onChange(next)  — 編輯中（輸入框 onChange / option label 改字…）。父元件只更新 state，不存。
//   onCommit(next)  — 行為完成、需要存（onBlur / 切類型 / 刪欄位 / 移位 / 切時段…）。
//                     父元件可以接收後立即送出儲存（如 EventSessionFieldsPanel），
//                     也可以單純 setState 等使用者按主按鈕（如 TemplatesPage）。
//
// 若父元件不需要區分 onChange / onCommit，可只傳 onChange。
import { useMemo } from 'react'

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

const DASHBOARD_ROLES = [
  { value: '',             label: '不特化（依預設呈現）' },
  { value: 'lunch_total',  label: '午齋總份數（boolean）' },
  { value: 'parking_kind', label: '停車車種（radio + 選項標記）' },
]

const PARKING_KINDS = [
  { value: '',           label: '—' },
  { value: 'motorcycle', label: '機車' },
  { value: 'car',        label: '汽車' },
  { value: 'none',       label: '不算' },
]

function patchMeta(meta, key, value) {
  const next = { ...(meta || {}) }
  if (value === null || value === undefined || value === '') delete next[key]
  else next[key] = value
  return Object.keys(next).length === 0 ? null : next
}

function renameMetaKey(meta, oldKey, newKey) {
  if (!meta || !(oldKey in meta)) return meta
  const v = meta[oldKey]
  const next = { ...meta }
  delete next[oldKey]
  if (newKey) next[newKey] = v
  return Object.keys(next).length === 0 ? null : next
}

function slugifyLabel(label) {
  const trimmed = (label || '').trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed
    .replace(/[\s／/\-—,，、。.]+/g, '_')
    .replace(/[^a-z0-9_一-龥]+/g, '')
    .slice(0, 32)
}

const EMPTY_FIELD = () => ({
  _key: typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random()),
  field_id: null,
  field_key: '',
  field_label: '',
  field_type: 'radio',
  options: [],
  show_if_period: [],
  required: true,
  dashboard_role: null,
  option_meta: null,
})

/**
 * 把外部傳入的 fields（可能來自 DB / 模板）正規化加上 _key（穩定的 React key）
 * 外部 value 變動時用 useMemo 重算。
 */
function ensureKeys(fields) {
  return (Array.isArray(fields) ? fields : []).map(f => ({
    _key:           f._key || f.field_id || (typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random())),
    field_id:       f.field_id ?? null,
    field_key:      f.field_key ?? '',
    field_label:    f.field_label ?? '',
    field_type:     f.field_type || 'radio',
    options:        Array.isArray(f.options) ? f.options : [],
    show_if_period: Array.isArray(f.show_if_period) ? f.show_if_period : [],
    required:       f.required ?? true,
    dashboard_role: f.dashboard_role || null,
    option_meta:    f.option_meta || null,
  }))
}

export default function SessionFieldsEditor({
  value,
  onChange,
  onCommit,                  // 若未提供則 fallback 用 onChange
  heading = '📋 場次共用子欄位',
  description = '學員勾選任一場次時，下方會出現的子問題（例：午齋、停車…）。可指定只在特定時段顯示。',
  emptyHint = '尚無子欄位，點下方「＋ 新增子欄位」開始設定',
  statusSlot = null,         // 父元件想顯示 saving 狀態時塞進這個位置（右上角）
}) {
  const fields = useMemo(() => ensureKeys(value), [value])
  const commit = onCommit || onChange

  function update(next)   { onChange(next) }
  function emit(next)     { commit(next) }

  function updateField(key, patch) {
    const next = fields.map(f => f._key === key ? { ...f, ...patch } : f)
    update(next)
  }
  function commitField(key, patch) {
    const next = fields.map(f => f._key === key ? { ...f, ...patch } : f)
    emit(next)
  }

  function addField() {
    emit([...fields, EMPTY_FIELD()])
  }
  function removeField(key) {
    emit(fields.filter(f => f._key !== key))
  }
  function moveUp(idx) {
    if (idx === 0) return
    const next = [...fields]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    emit(next)
  }
  function moveDown(idx) {
    if (idx === fields.length - 1) return
    const next = [...fields]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    emit(next)
  }

  function setOption(key, i, val) {
    const f = fields.find(x => x._key === key)
    if (!f) return
    const prev = (f.options || [])[i]
    const opts = [...(f.options || [])]
    opts[i] = val
    const newMeta = prev !== val ? renameMetaKey(f.option_meta, prev, val) : f.option_meta
    updateField(key, { options: opts, option_meta: newMeta })
  }
  function addOption(key) {
    const f = fields.find(x => x._key === key)
    if (!f) return
    updateField(key, { options: [...(f.options || []), ''] })
  }
  function removeOption(key, i) {
    const f = fields.find(x => x._key === key)
    if (!f) return
    const removed = (f.options || [])[i]
    const next = (f.options || []).filter((_, j) => j !== i)
    const newMeta = renameMetaKey(f.option_meta, removed, '')
    commitField(key, { options: next, option_meta: newMeta })
  }
  function setOptionKind(key, opt, kind) {
    const f = fields.find(x => x._key === key)
    if (!f) return
    commitField(key, { option_meta: patchMeta(f.option_meta, opt, kind) })
  }
  function setDashboardRole(key, role) {
    commitField(key, { dashboard_role: role || null })
  }
  function togglePeriod(key, period) {
    const f = fields.find(x => x._key === key)
    if (!f) return
    const cur = f.show_if_period || []
    const next = cur.includes(period) ? cur.filter(p => p !== period) : [...cur, period]
    commitField(key, { show_if_period: next })
  }

  return (
    <div className="mt-4 bg-emerald-50 rounded-xl border border-emerald-200 p-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-800">{heading}</p>
          {description && <p className="text-xs text-gray-600 mt-0.5">{description}</p>}
        </div>
        {statusSlot}
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4 bg-white rounded-lg border border-dashed border-emerald-200">
          {emptyHint}
        </p>
      ) : (
        <div className="space-y-2">
          {fields.map((f, idx) => {
            const periods = f.show_if_period || []
            const allPeriods = periods.length === 0
            const showParkingMeta =
              f.dashboard_role === 'parking_kind' && f.field_type === 'radio'
            return (
              <div key={f._key} className="bg-white border border-emerald-200 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">顯示名稱</label>
                    <input
                      value={f.field_label}
                      onChange={e => {
                        const label = e.target.value
                        const patch = { field_label: label }
                        if (!f.field_id && (!f.field_key || f.field_key === slugifyLabel(f.field_label))) {
                          patch.field_key = slugifyLabel(label)
                        }
                        updateField(f._key, patch)
                      }}
                      onBlur={() => emit(fields)}
                      placeholder="例：午齋"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">程式識別碼</label>
                    <input
                      value={f.field_key}
                      onChange={e => updateField(f._key, { field_key: e.target.value })}
                      onBlur={() => emit(fields)}
                      placeholder="自動填入"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">類型</label>
                    <select
                      value={f.field_type}
                      onChange={e => commitField(f._key, { field_type: e.target.value })}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    >
                      {FIELD_TYPE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
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
                  <div className="sm:col-span-1 flex sm:flex-col items-center sm:items-end gap-1 pt-4 sm:pt-1">
                    <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={f.required ?? true}
                        onChange={e => commitField(f._key, { required: e.target.checked })}
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

                {f.field_type === 'radio' && (
                  <div className="pl-2 border-l-2 border-emerald-200">
                    <div className="text-[10px] font-medium text-gray-500 mb-1">
                      選項
                      {showParkingMeta && (
                        <span className="text-emerald-600 font-normal ml-1">
                          （右側下拉設定車種）
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {(f.options || []).map((opt, i) => (
                        <div key={i} className="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                          <input
                            value={opt}
                            onChange={e => setOption(f._key, i, e.target.value)}
                            onBlur={() => emit(fields)}
                            placeholder={`選項 ${i + 1}`}
                            className="bg-transparent text-xs w-20 focus:outline-none"
                          />
                          {showParkingMeta && (
                            <select
                              value={f.option_meta?.[opt] || ''}
                              onChange={e => setOptionKind(f._key, opt, e.target.value)}
                              className="bg-white border border-emerald-300 text-emerald-800 rounded text-[10px] py-0.5 px-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                              title="此選項代表哪種車輛"
                            >
                              {PARKING_KINDS.map(k => (
                                <option key={k.value} value={k.value}>{k.label}</option>
                              ))}
                            </select>
                          )}
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

                <div className="pt-2 border-t border-emerald-100 flex items-center gap-2 flex-wrap">
                  <label className="text-[10px] font-medium text-gray-500 shrink-0">
                    看板角色
                    <span className="text-gray-400 font-normal ml-1">（不確定就留「不特化」）</span>
                  </label>
                  <select
                    value={f.dashboard_role || ''}
                    onChange={e => setDashboardRole(f._key, e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400"
                  >
                    {DASHBOARD_ROLES.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
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

/**
 * 儲存前清洗工具：把 _key 拿掉、選項 trim 並去空白。
 * EventSessionFieldsPanel 與 TemplatesPage 儲存前都用。
 */
export function cleanSessionFieldsForSave(list) {
  return (list || []).map(({ _key, field_id, ...f }) => ({
    field_id, // 留著讓 update 端可辨識
    ...f,
    options: (f.options || []).map(o => (o || '').trim()).filter(Boolean),
  }))
}

/**
 * 儲存前驗證（共用）。回傳 { ok: true } 或 { ok: false, msg }。
 */
export function validateSessionFields(list) {
  for (const f of list || []) {
    if (!f.field_label?.trim()) return { ok: false, msg: '⚠️ 請填寫所有「顯示名稱」' }
    if (!f.field_key?.trim())    return { ok: false, msg: '⚠️ 請填寫所有「程式識別碼」' }
  }
  const badRadio = (list || []).find(
    f => f.field_type === 'radio' && (f.options || []).filter(o => o?.trim()).length === 0
  )
  if (badRadio) return { ok: false, msg: '⚠️ 「' + badRadio.field_label + '」是單選，請至少設定一個選項' }
  const seen = new Set()
  for (const f of (list || [])) {
    if (seen.has(f.field_key)) return { ok: false, msg: '⚠️ 程式識別碼「' + f.field_key + '」重複，請修正' }
    seen.add(f.field_key)
  }
  return { ok: true }
}
