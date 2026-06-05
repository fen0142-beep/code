#!/usr/bin/env python3
"""Patch: add per-event checkboxes to the import modal"""

filepath = r'src/pages/admin/EventsPage.jsx'

with open(filepath, 'r', encoding='utf-8') as f:
    src = f.read()

# ── 1. Add importSelected state ──────────────────────────────────────────────
old_state = "  const [importing, setImporting] = useState(false)"
new_state = """  const [importing, setImporting] = useState(false)
  const [importSelected, setImportSelected] = useState([]) // indices of selected events"""
assert old_state in src, "FAIL: state not found"
src = src.replace(old_state, new_state, 1)

# ── 2. Set importSelected when file is parsed ────────────────────────────────
old_parse = """        setImportData(json)
        setImportResult('')
        setShowImportModal(true)"""
new_parse = """        setImportData(json)
        setImportSelected(json.events.map((_, i) => i))
        setImportResult('')
        setShowImportModal(true)"""
assert old_parse in src, "FAIL: parse block not found"
src = src.replace(old_parse, new_parse, 1)

# ── 3. Update handleConfirmImport to only iterate selected ───────────────────
old_loop = "    for (const tmpl of importData.events) {"
new_loop = "    const selectedEvents = importData.events.filter((_, i) => importSelected.includes(i))\n    for (const tmpl of selectedEvents) {"
assert old_loop in src, "FAIL: loop not found"
src = src.replace(old_loop, new_loop, 1)

# ── 4. Reset importSelected on close ────────────────────────────────────────
old_close_modal = "    setShowImportModal(false)\n    setImportData(null)"
new_close_modal = "    setShowImportModal(false)\n    setImportData(null)\n    setImportSelected([])"
assert old_close_modal in src, "FAIL: close modal not found"
src = src.replace(old_close_modal, new_close_modal, 1)

# ── 5. Replace import modal list with checkboxes ────────────────────────────
old_list = """              <ul className="space-y-1.5 mb-4">
                {importData.events.map((ev, i) => (
                  <li key={i} className="text-sm text-gray-700 flex gap-1.5">
                    <span className="text-gray-400 flex-shrink-0">•</span>
                    <span>{ev.name}（{ev.location || '地點未填'}，{ev.fields?.length ?? 0} 個欄位）</span>
                  </li>
                ))}
              </ul>"""
new_list = """              <label className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 mb-2 border-b pb-2">
                <input
                  type="checkbox"
                  checked={importSelected.length === importData.events.length}
                  onChange={e => setImportSelected(e.target.checked ? importData.events.map((_, i) => i) : [])}
                  className="w-4 h-4 accent-amber-600 flex-shrink-0"
                />
                <span className="text-sm font-medium text-gray-700">全選 / 全不選</span>
              </label>
              <ul className="space-y-1 mb-4">
                {importData.events.map((ev, i) => (
                  <li key={i}>
                    <label className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 rounded px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={importSelected.includes(i)}
                        onChange={e => setImportSelected(prev =>
                          e.target.checked ? [...prev, i] : prev.filter(x => x !== i)
                        )}
                        className="w-4 h-4 accent-amber-600 flex-shrink-0"
                      />
                      <span className="text-sm text-gray-700">
                        {ev.name}
                        <span className="text-gray-400 ml-1">（{ev.location || '地點未填'}，{ev.fields?.length ?? 0} 個欄位）</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>"""
assert old_list in src, "FAIL: list not found"
src = src.replace(old_list, new_list, 1)

# ── 6. Update footer: show selected count + disable if none ─────────────────
old_footer = """              <button
                onClick={handleConfirmImport}
                disabled={importing}
                className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {importing ? '匯入中…' : '確認匯入全部'}
              </button>"""
new_footer = """              <span className="text-xs text-gray-400 mr-2">已選 {importSelected.length} 個</span>
              <button
                onClick={handleConfirmImport}
                disabled={importing || importSelected.length === 0}
                className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {importing ? '匯入中…' : '確認匯入'}
              </button>"""
assert old_footer in src, "FAIL: footer button not found"
src = src.replace(old_footer, new_footer, 1)

# ── 7. Update cancel button to also reset importSelected ────────────────────
old_cancel = "                onClick={() => { setShowImportModal(false); setImportData(null) }}"
new_cancel = "                onClick={() => { setShowImportModal(false); setImportData(null); setImportSelected([]) }}"
assert old_cancel in src, "FAIL: cancel button not found"
src = src.replace(old_cancel, new_cancel, 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(src)

print(f"✅ Done. Lines: {src.count(chr(10))}")
for kw in ['importSelected', '全選 / 全不選', 'selectedEvents']:
    assert kw in src, f"MISSING: {kw}"
    print(f"  ✓ {kw}")
