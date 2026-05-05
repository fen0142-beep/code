/**
 * FieldRow — 動態欄位編輯列（EventDetailPage 與 TemplatesPage 共用）
 */
import { FIELD_TYPES, FIELD_TYPE_LABEL } from '../lib/fieldTypes'

export default function FieldRow({
  field, onChange, onRemove, allFields, index,
  onDragStart, onDragOver, onDrop, isDragOver,
}) {
  const options = field.options || []

  function handleLabelChange(label) {
    onChange({ ...field, field_label: label })
  }

  function handleLabelBlur(label) {
    if (!field.field_key && label) {
      onChange({ ...field, field_label: label, field_key: label })
    }
  }

  function setOption(i, val) {
    const next = [...options]
    next[i] = val
    onChange({ ...field, options: next })
  }

  function addOption() {
    onChange({ ...field, options: [...options, ''] })
  }

  function removeOption(i) {
    onChange({ ...field, options: options.filter((_, j) => j !== i) })
  }

  const showIfKey = field.show_if ? Object.keys(field.show_if)[0] ?? '' : ''
  const showIfVal = field.show_if ? Object.values(field.show_if)[0] ?? '' : ''
  const parentField = allFields.find(f => f.field_key === showIfKey)
  const parentOptions = parentField?.options || []

  function updateShowIf(key, val) {
    if (!key) {
      onChange({ ...field, show_if: null })
    } else {
      onChange({ ...field, show_if: { [key]: val } })
    }
  }

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={e => { e.preventDefault(); onDragOver(index) }}
      onDrop={() => onDrop(index)}
      onDragEnd={() => onDragOver(null)}
      className={`border rounded-xl p-4 bg-gray-50 space-y-3 transition-all ${
        isDragOver ? 'border-amber-400 bg-amber-50 scale-[1.01]' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center gap-2 -mb-1">
        <span
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none text-base leading-none px-0.5"
          title="拖曳調整順序"
        >
          ⠿
        </span>
        <span className="text-xs text-gray-400">拖曳調整順序</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">顯示名稱</label>
          <input
            value={field.field_label}
            onChange={e => handleLabelChange(e.target.value)}
            onBlur={e => handleLabelBlur(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder="身分別"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            程式識別碼
            <span className="text-gray-400 font-normal ml-1">（自動填入，通常不需更改）</span>
          </label>
          <input
            value={field.field_key}
            onChange={e => onChange({ ...field, field_key: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder="自動填入"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">欄位類型</label>
          <select
            value={field.field_type}
            onChange={e => onChange({ ...field, field_type: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            {FIELD_TYPES.map(t => <option key={t} value={t}>{FIELD_TYPE_LABEL[t] ?? t}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer mb-1">
            <input
              type="checkbox"
              checked={field.required ?? true}
              onChange={e => onChange({ ...field, required: e.target.checked })}
              className="accent-amber-600"
            />
            必填
          </label>
          <button
            onClick={onRemove}
            className="ml-auto text-red-400 hover:text-red-600 text-sm px-2 py-1 rounded transition-colors"
          >
            刪除
          </button>
        </div>
      </div>

      {(field.field_type === 'radio' || field.field_type === 'checkbox') && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">選項</label>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-4 text-right">{i + 1}.</span>
                <input
                  value={opt}
                  onChange={e => setOption(i, e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder={`選項 ${i + 1}`}
                />
                <button
                  onClick={() => removeOption(i)}
                  className="text-gray-300 hover:text-red-400 text-lg leading-none px-1 transition-colors"
                  title="刪除此選項"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={addOption}
              className="text-sm text-amber-700 hover:text-amber-900 border border-dashed border-amber-300 hover:border-amber-500 px-3 py-1 rounded transition-colors"
            >
              ＋ 新增選項
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          條件顯示（當某欄位選了特定值才出現；不需要請選「不設條件」）
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">當</span>
          <select
            value={showIfKey}
            onChange={e => updateShowIf(e.target.value, '')}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            <option value="">不設條件</option>
            {allFields.filter(f => f.field_label).map((f, i) => (
              <option key={f.field_key || i} value={f.field_key}>
                {f.field_label}
              </option>
            ))}
          </select>
          {showIfKey && (
            <>
              <span className="text-xs text-gray-400">選了</span>
              {parentOptions.length > 0 ? (
                <select
                  value={String(showIfVal)}
                  onChange={e => updateShowIf(showIfKey, e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  <option value="">請選擇</option>
                  {parentOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={String(showIfVal)}
                  onChange={e => updateShowIf(showIfKey, e.target.value)}
                  className="w-28 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder="輸入值"
                />
              )}
              <span className="text-xs text-gray-400">時顯示</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
