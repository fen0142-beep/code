#!/usr/bin/env python3
"""V7b patch: Add built-in template selection to EventsPage.jsx"""

filepath = r'src/pages/admin/EventsPage.jsx'

with open(filepath, 'r', encoding='utf-8') as f:
    src = f.read()

# ── 1. Add import for DEFAULT_TEMPLATES ──────────────────────────────────────
old_import = "import { supabase, getAllEvents, createEvent, getMyEvents, saveEventFields, saveEventSessionFields } from '../../lib/supabase'"
new_import = """import { supabase, getAllEvents, createEvent, getMyEvents, saveEventFields, saveEventSessionFields } from '../../lib/supabase'
import { DEFAULT_TEMPLATES } from '../../lib/defaultEventTemplates'"""
assert old_import in src, "FAIL: import line not found"
src = src.replace(old_import, new_import, 1)

# ── 2. Add state for built-in template modal ─────────────────────────────────
old_state = "  const [importResult, setImportResult] = useState('')"
new_state = """  const [importResult, setImportResult] = useState('')
  // V7b built-in templates
  const [showBuiltinModal, setShowBuiltinModal] = useState(false)
  const [builtinSelected, setBuiltinSelected] = useState([]) // indices of selected templates
  const [importingBuiltin, setImportingBuiltin] = useState(false)"""
assert old_state in src, "FAIL: state block not found"
src = src.replace(old_state, new_state, 1)

# ── 3. Add handler for built-in import ───────────────────────────────────────
old_return_marker = "  return (\n    <AdminLayout>"
new_handler = """  // ── V7b Built-in templates ───────────────────────────────────────────────
  async function handleConfirmBuiltinImport() {
    const selected = DEFAULT_TEMPLATES.filter((_, i) => builtinSelected.includes(i))
    if (selected.length === 0) return
    setImportingBuiltin(true)
    let successCount = 0

    for (const tmpl of selected) {
      const { event, error: evErr } = await createEvent({
        name: tmpl.name,
        description: tmpl.description,
        location: tmpl.location,
        location_tag: tmpl.location_tag,
        event_type: tmpl.event_type,
        is_dharma: tmpl.is_dharma,
        multi_session: tmpl.multi_session,
        offline_registration: tmpl.offline_registration,
        related_links: tmpl.related_links || [],
        status: 'draft',
      })
      if (evErr || !event) continue
      if (tmpl.fields?.length > 0) await saveEventFields(event.event_id, tmpl.fields)
      if (tmpl.session_fields?.length > 0) await saveEventSessionFields(event.event_id, tmpl.session_fields)
      successCount++
    }

    await load()
    setImportingBuiltin(false)
    setShowBuiltinModal(false)
    setBuiltinSelected([])
    setImportResult(`✅ 已匯入 ${successCount} 個活動，請逐一補填日期與封面圖`)
  }

  return (
    <AdminLayout>"""
assert old_return_marker in src, "FAIL: return marker not found"
src = src.replace(old_return_marker, new_handler, 1)

# ── 4. Add 📋 內建模板 button ─────────────────────────────────────────────────
old_btn_end = """            <label className="bg-white border border-gray-300 hover:border-amber-400 text-gray-600 hover:text-gray-800 text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer">
              📥 匯入模板
              <input type="file" accept=".json" className="hidden" onChange={handleImportFileSelect} />
            </label>
          </div>
        )}"""
new_btn_end = """            <label className="bg-white border border-gray-300 hover:border-amber-400 text-gray-600 hover:text-gray-800 text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer">
              📥 匯入模板
              <input type="file" accept=".json" className="hidden" onChange={handleImportFileSelect} />
            </label>
            <button
              onClick={() => { setBuiltinSelected(DEFAULT_TEMPLATES.map((_, i) => i)); setShowBuiltinModal(true) }}
              className="bg-white border border-gray-300 hover:border-amber-400 text-gray-600 hover:text-gray-800 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              📋 內建模板
            </button>
          </div>
        )}"""
assert old_btn_end in src, "FAIL: button end not found"
src = src.replace(old_btn_end, new_btn_end, 1)

# ── 5. Add built-in modal before closing </AdminLayout> ──────────────────────
old_close = "    </AdminLayout>\n  )\n}"
new_close = """
      {/* 內建模板 Modal */}
      {showBuiltinModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-800">📋 選擇內建活動模板</h3>
              <p className="text-xs text-gray-400 mt-1">來源：普宜精舍（共 {DEFAULT_TEMPLATES.length} 個通用活動）</p>
            </div>
            <div className="px-6 py-4 max-h-96 overflow-y-auto space-y-1">
              <label className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 rounded px-2 py-1.5 mb-2 border-b pb-2">
                <input
                  type="checkbox"
                  checked={builtinSelected.length === DEFAULT_TEMPLATES.length}
                  onChange={e => setBuiltinSelected(e.target.checked ? DEFAULT_TEMPLATES.map((_, i) => i) : [])}
                  className="w-4 h-4 accent-amber-600 flex-shrink-0"
                />
                <span className="text-sm font-medium text-gray-700">全選 / 全不選</span>
              </label>
              {DEFAULT_TEMPLATES.map((tmpl, i) => (
                <label key={i} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 rounded px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={builtinSelected.includes(i)}
                    onChange={e => setBuiltinSelected(prev =>
                      e.target.checked ? [...prev, i] : prev.filter(x => x !== i)
                    )}
                    className="w-4 h-4 accent-amber-600 flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="text-sm text-gray-700">{tmpl.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{tmpl.fields?.length ?? 0} 個欄位</span>
                  </div>
                </label>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-gray-100 bg-amber-50 rounded-b-2xl">
              <p className="text-xs text-amber-700 mb-2">⚠️ 匯入後為草稿狀態，請逐一補填日期與封面圖</p>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">已選 {builtinSelected.length} 個活動</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowBuiltinModal(false); setBuiltinSelected([]) }}
                    className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
                  >取消</button>
                  <button
                    onClick={handleConfirmBuiltinImport}
                    disabled={importingBuiltin || builtinSelected.length === 0}
                    className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {importingBuiltin ? '匯入中…' : '確認匯入'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}"""
assert old_close in src, "FAIL: closing AdminLayout not found"
src = src.replace(old_close, new_close, 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(src)

lines = src.count('\n')
print(f"✅ Done. Lines: {lines}")
for kw in ['DEFAULT_TEMPLATES', 'showBuiltinModal', 'handleConfirmBuiltinImport', 'builtinSelected', '內建模板']:
    assert kw in src, f"MISSING: {kw}"
    print(f"  ✓ {kw}")
