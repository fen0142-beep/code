#!/usr/bin/env python3
"""V7 patch: Add export/import template features to admin EventsPage.jsx"""

filepath = r'src/pages/admin/EventsPage.jsx'

with open(filepath, 'r', encoding='utf-8') as f:
    src = f.read()

# ── 1. Update import line ────────────────────────────────────────────────────
old_import = "import { getAllEvents, createEvent, getMyEvents } from '../../lib/supabase'"
new_import = "import { supabase, getAllEvents, createEvent, getMyEvents, saveEventFields, saveEventSessionFields } from '../../lib/supabase'"
assert old_import in src, "FAIL: import line not found"
src = src.replace(old_import, new_import, 1)

# ── 2. Add state variables ───────────────────────────────────────────────────
old_state = "  const [formError, setFormError] = useState('')"
new_state = """  const [formError, setFormError] = useState('')
  // V7 export
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportCandidates, setExportCandidates] = useState([])
  const [exporting, setExporting] = useState(false)
  // V7 import
  const [showImportModal, setShowImportModal] = useState(false)
  const [importData, setImportData] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState('')"""
assert old_state in src, "FAIL: state block not found"
src = src.replace(old_state, new_state, 1)

# ── 3. Inject handlers before return ────────────────────────────────────────
old_return = "  return (\n    <AdminLayout>"
new_handlers = """  // ── V7 Export ────────────────────────────────────────────────────────────
  async function openExportModal() {
    setExporting(true)
    const { events: allEvents } = await getAllEvents()
    const activeEvents = (allEvents || []).filter(e => e.status === 'active')
    setExportCandidates(activeEvents.map(e => ({ event_id: e.event_id, name: e.name, checked: true })))
    setExporting(false)
    setShowExportModal(true)
  }

  async function handleConfirmExport() {
    const selected = exportCandidates.filter(c => c.checked)
    if (selected.length === 0) return
    setExporting(true)

    const selectedIds = selected.map(c => c.event_id)

    const { data: eventsData } = await supabase
      .from('events')
      .select('*')
      .in('event_id', selectedIds)

    const { data: allFields } = await supabase
      .from('event_fields')
      .select('*')
      .in('event_id', selectedIds)
      .order('sort_order')

    const { data: allSessionFields } = await supabase
      .from('event_session_fields')
      .select('*')
      .in('event_id', selectedIds)
      .order('sort_order')

    const evMap = {}
    for (const e of (eventsData || [])) evMap[e.event_id] = e

    const templatesArr = selected.map(sel => {
      const ev = evMap[sel.event_id] || {}
      return {
        name: ev.name || sel.name,
        description: ev.description || '',
        location: ev.location || '',
        location_tag: ev.location_tag || 'puyi',
        event_type: ev.event_type || 'temple',
        is_dharma: !!ev.is_dharma,
        multi_session: !!ev.multi_session,
        offline_registration: !!ev.offline_registration,
        cover_image_url: ev.cover_image_url || '',
        related_links: ev.related_links || [],
        fields: (allFields || [])
          .filter(f => f.event_id === sel.event_id)
          .map(f => ({
            field_key: f.field_key, field_label: f.field_label,
            field_type: f.field_type, options: f.options || [],
            show_if: f.show_if || null, sort_order: f.sort_order,
            required: f.required, dashboard_role: f.dashboard_role || null,
            option_meta: f.option_meta || null,
          })),
        session_fields: (allSessionFields || [])
          .filter(f => f.event_id === sel.event_id)
          .map(f => ({
            field_key: f.field_key, field_label: f.field_label,
            field_type: f.field_type, options: f.options || [],
            show_if_period: f.show_if_period || [], sort_order: f.sort_order,
            required: f.required, dashboard_role: f.dashboard_role || null,
            option_meta: f.option_meta || null,
          })),
      }
    })

    const today = new Date().toISOString().slice(0, 10)
    const output = {
      _template_version: '1',
      _source: '普宜精舍',
      _exported_at: today,
      _count: templatesArr.length,
      events: templatesArr,
    }

    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `活動模板_普宜精舍_${today}.json`
    a.click()
    URL.revokeObjectURL(url)

    setExporting(false)
    setShowExportModal(false)
  }

  // ── V7 Import ─────────────────────────────────────────────────────────────
  function handleImportFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const json = JSON.parse(evt.target.result)
        if (!json.events || !Array.isArray(json.events)) {
          alert('檔案格式不正確，請選擇正確的活動模板 JSON 檔')
          return
        }
        setImportData(json)
        setImportResult('')
        setShowImportModal(true)
      } catch {
        alert('無法解析 JSON 檔，請確認檔案內容')
      }
    }
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  async function handleConfirmImport() {
    if (!importData) return
    setImporting(true)
    let successCount = 0

    for (const tmpl of importData.events) {
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

      if (tmpl.fields?.length > 0) {
        await saveEventFields(event.event_id, tmpl.fields)
      }
      if (tmpl.session_fields?.length > 0) {
        await saveEventSessionFields(event.event_id, tmpl.session_fields)
      }
      successCount++
    }

    await load()
    setImporting(false)
    setShowImportModal(false)
    setImportData(null)
    setImportResult(`✅ 已匯入 ${successCount} 個活動，請逐一補填日期與封面圖`)
  }

  return (
    <AdminLayout>"""
assert old_return in src, "FAIL: return statement not found"
src = src.replace(old_return, new_handlers, 1)

# ── 4. Replace button area ───────────────────────────────────────────────────
old_btn = """        {isAdmin && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            ＋ 新增活動
          </button>
        )}"""
new_btn = """        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setShowForm(v => !v)}
              className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              ＋ 新增活動
            </button>
            <button
              onClick={openExportModal}
              className="bg-white border border-gray-300 hover:border-amber-400 text-gray-600 hover:text-gray-800 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              📤 匯出模板
            </button>
            <label className="bg-white border border-gray-300 hover:border-amber-400 text-gray-600 hover:text-gray-800 text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer">
              📥 匯入模板
              <input type="file" accept=".json" className="hidden" onChange={handleImportFileSelect} />
            </label>
          </div>
        )}"""
assert old_btn in src, "FAIL: button area not found"
src = src.replace(old_btn, new_btn, 1)

# ── 5. Add modals + banner before closing tag ────────────────────────────────
old_close = "    </AdminLayout>\n  )\n}"
new_close = """
      {/* 匯入成功提示 */}
      {importResult && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex items-center justify-between">
          <span>{importResult}</span>
          <button onClick={() => setImportResult('')} className="text-green-500 hover:text-green-700 ml-4 text-base">✕</button>
        </div>
      )}

      {/* 匯出選擇 Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-800">📤 選擇要匯出的活動模板</h3>
            </div>
            <div className="px-6 py-4 max-h-80 overflow-y-auto space-y-1">
              {exporting ? (
                <p className="text-sm text-gray-400 text-center py-6">載入中…</p>
              ) : exportCandidates.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">目前沒有進行中的活動</p>
              ) : exportCandidates.map(c => (
                <label key={c.event_id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 rounded px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={c.checked}
                    onChange={ev => setExportCandidates(prev =>
                      prev.map(x => x.event_id === c.event_id ? { ...x, checked: ev.target.checked } : x)
                    )}
                    className="w-4 h-4 accent-amber-600 flex-shrink-0"
                  />
                  <span className="text-sm text-gray-700">{c.name}</span>
                </label>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex items-center justify-between">
              <span className="text-xs text-gray-500">
                已選 {exportCandidates.filter(c => c.checked).length} 個活動
              </span>
              <div className="flex gap-2">
                <button onClick={() => setShowExportModal(false)} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">取消</button>
                <button
                  onClick={handleConfirmExport}
                  disabled={exporting || exportCandidates.filter(c => c.checked).length === 0}
                  className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {exporting ? '匯出中…' : '確認匯出'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 匯入預覽 Modal */}
      {showImportModal && importData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-800">📥 匯入活動模板</h3>
            </div>
            <div className="px-6 py-4 max-h-72 overflow-y-auto">
              <p className="text-xs text-gray-500 mb-3">
                來源：{importData._source}（{importData._exported_at} 匯出）
                ，共 {importData._count ?? importData.events.length} 個活動：
              </p>
              <ul className="space-y-1.5 mb-4">
                {importData.events.map((ev, i) => (
                  <li key={i} className="text-sm text-gray-700 flex gap-1.5">
                    <span className="text-gray-400 flex-shrink-0">•</span>
                    <span>{ev.name}（{ev.location || '地點未填'}，{ev.fields?.length ?? 0} 個欄位）</span>
                  </li>
                ))}
              </ul>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-700 space-y-1">
                <p>⚠️ 所有活動日期未設定，匯入後請逐一補填</p>
                <p>⚠️ 封面圖需重新上傳</p>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-2">
              <button
                onClick={() => { setShowImportModal(false); setImportData(null) }}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
              >
                取消
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={importing}
                className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {importing ? '匯入中…' : '確認匯入全部'}
              </button>
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
# Quick sanity checks
for kw in ['openExportModal', 'handleConfirmExport', 'handleImportFileSelect', 'handleConfirmImport',
           'showExportModal', 'showImportModal', 'saveEventFields', 'saveEventSessionFields']:
    assert kw in src, f"MISSING: {kw}"
    print(f"  ✓ {kw}")
