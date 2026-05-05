import { useEffect, useState } from 'react'
import AdminLayout from '../../components/AdminLayout'
import FieldRow from '../../components/FieldRow'
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '../../lib/supabase'

const NEW_FIELD = () => ({
  field_key: '',
  field_label: '',
  field_type: 'radio',
  options: [],
  show_if: null,
  required: true,
  placeholder: null,
})

// ── 模板編輯器（內嵌，可展開/收合）───────────────────────────
function TemplateEditor({ template, onSaved, onCancelled, isNew }) {
  const [name, setName] = useState(template.name)
  const [fields, setFields] = useState(
    (template.fields || []).map((f, i) => ({ ...f, _id: i }))
  )
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  function addField() {
    setFields(prev => [...prev, { ...NEW_FIELD(), _id: Date.now() }])
  }

  function updateField(i, updated) {
    setFields(prev => prev.map((f, j) => j === i ? updated : f))
  }

  function removeField(i) {
    setFields(prev => prev.filter((_, j) => j !== i))
  }

  function handleDragStart(i) { setDragIndex(i) }
  function handleDragOver(i) { setDragOverIndex(i) }
  function handleDrop(targetIndex) {
    if (dragIndex === null || dragIndex === targetIndex) return
    const next = [...fields]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(targetIndex, 0, moved)
    setFields(next)
    setDragIndex(null)
    setDragOverIndex(null)
  }

  async function handleSave() {
    if (!name.trim()) { setMsg('請填寫模板名稱'); return }
    setSaving(true)
    setMsg('')
    // 清除內部用的 _id key
    const cleanFields = fields.map(({ _id, ...f }) => f)
    let result
    if (isNew) {
      result = await createTemplate(name.trim(), cleanFields)
      if (result.error) { setMsg(`儲存失敗：${result.error}`); setSaving(false); return }
      onSaved(result.template)
    } else {
      result = await updateTemplate(template.template_id, { name: name.trim(), fields: cleanFields })
      if (result.error) { setMsg(`儲存失敗：${result.error}`); setSaving(false); return }
      onSaved({ ...template, name: name.trim(), fields: cleanFields })
    }
    setSaving(false)
  }

  return (
    <div className="border border-amber-300 rounded-2xl p-5 bg-amber-50 space-y-5">
      {/* 模板名稱 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">模板名稱</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full sm:w-80 border-2 border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          placeholder="例：回山模板"
        />
      </div>

      {/* 欄位列表 */}
      <div className="space-y-3">
        {fields.map((field, i) => (
          <FieldRow
            key={field._id ?? i}
            field={field}
            index={i}
            allFields={fields}
            onChange={updated => updateField(i, updated)}
            onRemove={() => removeField(i)}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragOver={dragOverIndex === i}
          />
        ))}
      </div>

      {/* 操作按鈕列 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={addField}
          className="border border-dashed border-amber-400 text-amber-700 hover:bg-amber-100 text-sm px-4 py-2 rounded-lg transition-colors"
        >
          ＋ 新增欄位
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50 ml-auto"
        >
          {saving ? '儲存中…' : '儲存模板'}
        </button>
        <button
          onClick={onCancelled}
          className="text-gray-500 hover:text-gray-700 text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
        >
          取消
        </button>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  )
}

// ── 主頁面 ─────────────────────────────────────────────────
export default function TemplatesPage() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null) // template_id | 'new' | null
  const [deletingId, setDeletingId] = useState(null)

  async function load() {
    setLoading(true)
    const { templates: t } = await getTemplates()
    setTemplates(t)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(templateId) {
    if (!window.confirm('確定要刪除這個模板嗎？此操作無法還原。')) return
    setDeletingId(templateId)
    await deleteTemplate(templateId)
    setTemplates(prev => prev.filter(t => t.template_id !== templateId))
    setDeletingId(null)
    if (editingId === templateId) setEditingId(null)
  }

  function handleSaved(updated) {
    if (editingId === 'new') {
      setTemplates(prev => [...prev, updated])
    } else {
      setTemplates(prev => prev.map(t => t.template_id === updated.template_id ? updated : t))
    }
    setEditingId(null)
  }

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 頁首 */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">模板管理</h1>
          {editingId !== 'new' && (
            <button
              onClick={() => setEditingId('new')}
              className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              ＋ 新增模板
            </button>
          )}
        </div>

        {/* 新增模板編輯器 */}
        {editingId === 'new' && (
          <TemplateEditor
            isNew
            template={{ name: '', fields: [] }}
            onSaved={handleSaved}
            onCancelled={() => setEditingId(null)}
          />
        )}

        {/* 模板列表 */}
        {loading ? (
          <p className="text-gray-400 text-sm">載入中…</p>
        ) : templates.length === 0 ? (
          <p className="text-gray-400 text-sm">尚無模板，點「新增模板」開始建立。</p>
        ) : (
          <div className="space-y-4">
            {templates.map(t => (
              <div key={t.template_id}>
                {editingId === t.template_id ? (
                  <TemplateEditor
                    template={t}
                    onSaved={handleSaved}
                    onCancelled={() => setEditingId(null)}
                  />
                ) : (
                  <div className="border border-gray-200 rounded-2xl p-4 bg-white flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-gray-800">{t.name}</p>
                      <p className="text-sm text-gray-400 mt-0.5">
                        {(t.fields || []).length} 個欄位
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setEditingId(t.template_id)}
                        className="text-sm text-amber-700 hover:text-amber-900 border border-amber-300 hover:border-amber-500 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleDelete(t.template_id)}
                        disabled={deletingId === t.template_id}
                        className="text-sm text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {deletingId === t.template_id ? '刪除中…' : '刪除'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
