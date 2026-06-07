import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import * as XLSX from '@e965/xlsx'
import AdminLayout from '../../components/AdminLayout'
import SearchableSelect from '../../components/SearchableSelect'
import {
  getAllEvents,
  getAllStudents,
  listEventDonors,
  addEventDonor,
  updateEventDonor,
  deleteEventDonor,
  bulkUpsertEventDonors,
} from '../../lib/supabase'

// ── Excel 模板下載 ──────────────────────────────────────────
function downloadTemplate() {
  // 只有表頭，沒有範例資料（師父反映範例會誤導）
  const ws = XLSX.utils.aoa_to_sheet([
    ['學員編號', '姓名', '功德項目', '座位', '胸花', '供具', '備註'],
  ])
  ws['!cols'] = [
    { wch: 12 }, // 學員編號
    { wch: 10 }, // 姓名
    { wch: 14 }, // 功德項目
    { wch: 10 }, // 座位
    { wch: 12 }, // 胸花
    { wch: 14 }, // 供具
    { wch: 20 }, // 備註
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '功德主名單')
  XLSX.writeFile(wb, '功德主匯入模板.xlsx')
}

// ── 欄位映射：支援多種中文表頭 ─────────────────────────────
const COL_ALIASES = {
  student_id: ['學員編號', '編號', 'student_id', 'StudentID'],
  name:       ['姓名',     'name', 'Name'],
  donor_item: ['功德項目', '項目', 'donor_item'],
  seat:       ['座位',     'seat'],
  corsage:    ['胸花',     'corsage'],
  offering:   ['供具',     'offering'],
  donor_note: ['備註',     '備考', 'donor_note', 'note'],
}

function mapRow(rawRow) {
  const keys = Object.keys(rawRow)
  const row = {}
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    const key = keys.find(k => aliases.includes(k.trim()))
    row[field] = key ? String(rawRow[key] ?? '').trim() : ''
  }
  return row
}

// ── 比對 students：依 student_id 或 姓名（含多筆同名處理）────
function matchToStudents(rows, students) {
  // 建 lookup
  const byId   = new Map() // student_id → student
  const byName = new Map() // name → [student, ...]
  for (const s of students) {
    byId.set(s.student_id, s)
    const arr = byName.get(s.name) ?? []
    arr.push(s)
    byName.set(s.name, arr)
  }

  return rows.map((r, idx) => {
    const sid  = (r.student_id || '').trim()
    const name = (r.name       || '').trim()
    let matchType  = 'guest'        // 'student' | 'guest' | 'ambiguous'
    let resolvedId = null
    let candidates = []

    if (sid && byId.has(sid)) {
      matchType  = 'student'
      resolvedId = sid
    } else if (!sid && name) {
      const list = byName.get(name) ?? []
      if (list.length === 1) {
        matchType  = 'student'
        resolvedId = list[0].student_id
      } else if (list.length > 1) {
        matchType  = 'ambiguous'
        candidates = list
      } else {
        matchType  = 'guest'
      }
    } else if (sid && !byId.has(sid)) {
      // 學員編號填了但找不到 → 標 ambiguous，預設訪客
      matchType  = 'unknown_id'
      candidates = []
    }

    return {
      idx,
      raw: r,
      name,
      student_id_input: sid,
      matchType,
      resolvedStudentId: resolvedId,
      candidates,
      donor_item: r.donor_item || '',
      seat:       r.seat       || '',
      corsage:    r.corsage    || '',
      offering:   r.offering   || '',
      donor_note: r.donor_note || '',
    }
  })
}

const MATCH_BADGE = {
  student:    { label: '學員',          cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  guest:      { label: '訪客',          cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  ambiguous:  { label: '⚠️ 同名待選',    cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  unknown_id: { label: '⚠️ 編號找不到', cls: 'bg-red-100 text-red-700 border-red-200' },
}

// ── 主頁面 ──────────────────────────────────────────────────
export default function DonorManagePage() {
  const { id } = useParams()
  const [eventName, setEventName] = useState('')
  const [donors, setDonors]       = useState([])
  const [students, setStudents]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [msg, setMsg]             = useState('')

  // 匯入流程
  const [parseError, setParseError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewRows, setPreviewRows] = useState([])
  const [importing, setImporting]     = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)

  // 單筆新增 / 編輯
  const [formOpen, setFormOpen]   = useState(false)
  const [editingDonor, setEditingDonor] = useState(null)

  // 篩選
  const [search, setSearch] = useState('')

  // 載入
  const load = useCallback(async () => {
    setLoading(true)
    const [donorsRes, studentsRes, eventsRes] = await Promise.all([
      listEventDonors(id),
      getAllStudents(''),
      getAllEvents(),
    ])
    setDonors(donorsRes.donors || [])
    setStudents(studentsRes.students || [])
    const ev = (eventsRes.events || []).find(e => e.event_id === id)
    setEventName(ev?.name ?? '')
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // 顯示訊息（自動消失）
  function flash(text) {
    setMsg(text)
    setTimeout(() => setMsg(''), 3000)
  }

  // ── 匯入：選檔解析 ─────────────────────────────────────────
  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    setImportResult(null)

    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wb    = XLSX.read(ev.target.result, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const raw   = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        if (raw.length === 0) { setParseError('檔案是空的，請確認格式正確'); return }

        const rows = raw.map(mapRow).filter(r => r.name) // 必須有姓名
        if (rows.length === 0) {
          setParseError('找不到有效資料，請確認有「姓名」欄位（學員編號可空白）')
          return
        }

        const matched = matchToStudents(rows, students)
        setPreviewRows(matched)
        setPreviewOpen(true)
      } catch (err) {
        setParseError(`解析失敗：${err.message}`)
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  // ── 匯入：在 preview 中修改單筆比對結果 ─────────────────────
  function updatePreviewRow(idx, patch) {
    setPreviewRows(rows => rows.map(r => r.idx === idx ? { ...r, ...patch } : r))
  }

  // 「同名待選」項：師父挑哪一位
  function pickCandidate(idx, studentId) {
    updatePreviewRow(idx, {
      resolvedStudentId: studentId || null,
      matchType: studentId ? 'student' : 'guest',
    })
  }

  // 「編號找不到」項：選擇放棄編號改為訪客
  function fallbackToGuest(idx) {
    updatePreviewRow(idx, {
      resolvedStudentId: null,
      student_id_input: '',
      matchType: 'guest',
    })
  }

  // 全部「同名待選」一鍵改為訪客
  function allAmbiguousToGuest() {
    setPreviewRows(rows => rows.map(r =>
      (r.matchType === 'ambiguous' || r.matchType === 'unknown_id')
        ? { ...r, matchType: 'guest', resolvedStudentId: null, student_id_input: '' }
        : r
    ))
  }

  // ── 匯入：執行 ───────────────────────────────────────────
  async function handleConfirmImport() {
    setImporting(true)
    // 把 preview rows 轉成 bulkUpsert 接收的格式
    const payload = previewRows.map(r => ({
      student_id: r.matchType === 'student' ? r.resolvedStudentId : null,
      name:       r.name,
      donor_item: r.donor_item,
      seat:       r.seat,
      corsage:    r.corsage,
      offering:   r.offering,
      donor_note: r.donor_note,
    }))
    const res = await bulkUpsertEventDonors(id, payload)
    setImporting(false)
    setImportResult(res)
    if (res.success) {
      setPreviewOpen(false)
      await load()
      flash(`✅ 匯入完成：新增 ${res.inserted} 筆 / 更新 ${res.updated} 筆`)
    }
  }

  // ── 單筆新增 / 編輯 ─────────────────────────────────────────
  function openCreate() {
    setEditingDonor(null)
    setFormOpen(true)
  }
  function openEdit(donor) {
    setEditingDonor(donor)
    setFormOpen(true)
  }
  async function handleDeleteDonor(donor) {
    if (!confirm(`確定刪除「${donor.name}」的功德主紀錄？`)) return
    const { success, error } = await deleteEventDonor(donor.donor_id)
    if (!success) { flash(`❌ 刪除失敗：${error}`); return }
    await load()
    flash('✅ 已刪除')
  }

  // ── 篩選清單 ────────────────────────────────────────────────
  const filteredDonors = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return donors
    return donors.filter(d => {
      const txt = `${d.name} ${d.student_id ?? ''} ${d.donor_item ?? ''} ${d.donor_note ?? ''}`.toLowerCase()
      return txt.includes(q)
    })
  }, [donors, search])

  // ── students option（給單筆新增的下拉用）─────────────────────
  const studentOptions = useMemo(() => students.map(s => ({
    value: s.student_id,
    label: s.name,
    sublabel: s.student_id + (s.student_classes?.length
      ? '・' + s.student_classes.map(c => c.class_name + (c.group_name ? ' ' + c.group_name : '')).join('／')
      : ''),
  })), [students])

  return (
    <AdminLayout>
      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link to="/admin/events" className="hover:text-purple-700">活動管理</Link>
        <span>/</span>
        <Link to={`/admin/events/${id}`} className="hover:text-purple-700">{eventName || '活動'}</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">🪷 功德主管理</span>
      </div>

      {/* 標題列 */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">🪷 功德主管理</h2>
        <Link
          to={`/admin/events/${id}`}
          className="text-sm text-gray-500 hover:text-purple-700"
        >← 返回活動</Link>
      </div>

      {/* 訊息列 */}
      {msg && (
        <p className="text-sm mb-4 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">{msg}</p>
      )}

      {/* 操作區：模板下載 / 匯入 / 單筆新增 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">📁 名單管理</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border-2 border-purple-300 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors"
          >
            📥 下載 Excel 模板
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            📤 上傳 Excel 匯入
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <span className="text-gray-300">|</span>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border-2 border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            ＋ 單筆新增
          </button>
        </div>
        {parseError && (
          <p className="text-sm text-red-600 mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ❌ {parseError}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-3">
          欄位：學員編號（可空白）、姓名、功德項目、座位、胸花、供具、備註 — 顯示時空白欄位不會出現
        </p>
      </div>

      {/* 功德主清單 */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-3">
          <p className="text-sm font-semibold text-gray-700">
            功德主名單（{filteredDonors.length}/{donors.length} 筆）
          </p>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋姓名／編號／功德項目…"
            className="ml-auto w-64 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <p className="text-center text-gray-400 py-12 text-sm">載入中…</p>
          ) : filteredDonors.length === 0 ? (
            <p className="text-center text-gray-400 py-12 text-sm">
              {donors.length === 0 ? '尚無功德主名單，請匯入或新增' : '無符合的搜尋結果'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">姓名</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">編號</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">功德項目</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">座位</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">胸花</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">供具</th>
                  <th className="text-left px-3 py-2 font-medium">備註</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredDonors.map(d => (
                  <tr key={d.donor_id} className="hover:bg-purple-50/30">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-semibold text-gray-800">{d.name}</span>
                      {!d.student_id && (
                        <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 rounded-full px-1.5 py-0.5">訪客</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 text-xs tabular-nums">
                      {d.student_id || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{d.donor_item || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{d.seat        || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{d.corsage     || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{d.offering    || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-600">{d.donor_note  || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button
                        onClick={() => openEdit(d)}
                        className="text-xs text-purple-600 hover:text-purple-800 mr-2"
                      >編輯</button>
                      <button
                        onClick={() => handleDeleteDonor(d)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >✕ 刪除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 匯入 preview modal */}
      {previewOpen && (
        <ImportPreviewModal
          rows={previewRows}
          students={students}
          importing={importing}
          importResult={importResult}
          onClose={() => { setPreviewOpen(false); setImportResult(null) }}
          onPick={pickCandidate}
          onFallback={fallbackToGuest}
          onAllToGuest={allAmbiguousToGuest}
          onConfirm={handleConfirmImport}
        />
      )}

      {/* 單筆新增 / 編輯 modal */}
      {formOpen && (
        <DonorFormModal
          eventId={id}
          editingDonor={editingDonor}
          studentOptions={studentOptions}
          onClose={() => setFormOpen(false)}
          onSaved={async () => { setFormOpen(false); await load(); flash('✅ 已儲存') }}
        />
      )}
    </AdminLayout>
  )
}


// ── 匯入 preview modal ─────────────────────────────────────
function ImportPreviewModal({ rows, students, importing, importResult, onClose, onPick, onFallback, onAllToGuest, onConfirm }) {
  const stats = useMemo(() => {
    const s = { student: 0, guest: 0, ambiguous: 0, unknown_id: 0 }
    rows.forEach(r => { s[r.matchType] = (s[r.matchType] || 0) + 1 })
    return s
  }, [rows])

  const hasPending = stats.ambiguous > 0 || stats.unknown_id > 0

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-gray-800">📤 匯入功德主名單預覽（{rows.length} 筆）</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
            <span className="px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">學員 {stats.student}</span>
            <span className="px-2 py-0.5 rounded-full border bg-blue-100 text-blue-700 border-blue-200">訪客 {stats.guest}</span>
            {stats.ambiguous > 0 && (
              <span className="px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-300">⚠️ 同名待選 {stats.ambiguous}</span>
            )}
            {stats.unknown_id > 0 && (
              <span className="px-2 py-0.5 rounded-full border bg-red-100 text-red-700 border-red-200">⚠️ 編號找不到 {stats.unknown_id}</span>
            )}
            {hasPending && (
              <button
                onClick={onAllToGuest}
                className="ml-auto text-xs px-2 py-1 rounded-md border border-gray-300 hover:bg-gray-50 text-gray-700"
              >
                把所有「同名待選 / 編號找不到」全部改為訪客
              </button>
            )}
          </div>
          {hasPending && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
              下方有 {stats.ambiguous + stats.unknown_id} 筆無法自動比對學員，請逐筆選擇或一鍵改為訪客
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 sticky top-0">
              <tr>
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">姓名</th>
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">編號（Excel）</th>
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">比對狀態</th>
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">功德項目</th>
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">座位</th>
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">胸花</th>
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">供具</th>
                <th className="text-left px-2 py-2 font-medium">備註</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => {
                const badge = MATCH_BADGE[r.matchType]
                return (
                  <tr key={r.idx} className="align-top">
                    <td className="px-2 py-2 whitespace-nowrap font-semibold text-gray-800">{r.name}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-xs text-gray-600 tabular-nums">{r.student_id_input || '—'}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className={`text-[11px] border rounded-full px-2 py-0.5 ${badge.cls}`}>{badge.label}</span>
                      {r.matchType === 'student' && r.resolvedStudentId && (
                        <span className="ml-2 text-[11px] text-gray-500 tabular-nums">{r.resolvedStudentId}</span>
                      )}
                      {r.matchType === 'ambiguous' && (
                        <div className="mt-1">
                          <select
                            defaultValue=""
                            onChange={e => onPick(r.idx, e.target.value)}
                            className="text-xs border border-amber-300 rounded px-1.5 py-1 bg-white"
                          >
                            <option value="">請選哪一位…</option>
                            {r.candidates.map(c => (
                              <option key={c.student_id} value={c.student_id}>
                                {c.name}（{c.student_id}）
                              </option>
                            ))}
                            <option value="">（都不是 → 視為訪客）</option>
                          </select>
                        </div>
                      )}
                      {r.matchType === 'unknown_id' && (
                        <button
                          onClick={() => onFallback(r.idx)}
                          className="ml-2 text-[11px] underline text-red-600 hover:text-red-800"
                        >改為訪客</button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs">{r.donor_item || '—'}</td>
                    <td className="px-2 py-2 text-xs">{r.seat       || '—'}</td>
                    <td className="px-2 py-2 text-xs">{r.corsage    || '—'}</td>
                    <td className="px-2 py-2 text-xs">{r.offering   || '—'}</td>
                    <td className="px-2 py-2 text-xs">{r.donor_note || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {importResult && !importResult.success && (
          <div className="px-5 py-3 bg-red-50 border-t border-red-200">
            <p className="text-sm text-red-700 font-semibold mb-1">❌ 匯入過程有 {importResult.errors.length} 筆失敗：</p>
            <ul className="text-xs text-red-600 space-y-1 max-h-32 overflow-y-auto">
              {importResult.errors.slice(0, 10).map((e, i) => (
                <li key={i}>{e.row?.name ?? '(無名)'}：{e.message}</li>
              ))}
              {importResult.errors.length > 10 && <li>… 還有 {importResult.errors.length - 10} 筆未列出</li>}
            </ul>
          </div>
        )}

        <div className="px-5 py-3 border-t flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >取消</button>
          <button
            disabled={importing}
            onClick={onConfirm}
            className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
          >
            {importing ? '匯入中…' : `確認匯入 ${rows.length} 筆`}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── 單筆新增 / 編輯 modal ──────────────────────────────────
function DonorFormModal({ eventId, editingDonor, studentOptions, onClose, onSaved }) {
  const isEdit = !!editingDonor
  const [form, setForm] = useState({
    student_id: editingDonor?.student_id ?? '',
    name:       editingDonor?.name       ?? '',
    donor_item: editingDonor?.donor_item ?? '',
    seat:       editingDonor?.seat       ?? '',
    corsage:    editingDonor?.corsage    ?? '',
    offering:   editingDonor?.offering   ?? '',
    donor_note: editingDonor?.donor_note ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // 從學員下拉選 → 自動帶入 student_id 與 name
  function pickStudent(value) {
    if (!value) {
      setForm(f => ({ ...f, student_id: '' }))
      return
    }
    const s = studentOptions.find(o => o.value === value)
    setForm(f => ({
      ...f,
      student_id: value,
      name: s?.label || f.name,
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('姓名不可為空'); return }
    setSaving(true)
    const fn = isEdit
      ? () => updateEventDonor(editingDonor.donor_id, form)
      : () => addEventDonor(eventId, form)
    const { donor, error: err } = await fn()
    setSaving(false)
    if (err) {
      setError(err.includes('uq_event_donors')
        ? '此活動已有同一學員／同名訪客的功德主紀錄'
        : err)
      return
    }
    onSaved(donor)
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="bg-white w-full max-w-lg rounded-2xl shadow-xl"
      >
        <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800">
            {isEdit ? '✏️ 編輯功德主' : '＋ 新增功德主'}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">從學員清單選（選填 → 自動帶入姓名與編號）</label>
            <SearchableSelect
              value={form.student_id}
              onChange={pickStudent}
              options={studentOptions}
              placeholder="（訪客或手動輸入姓名 → 留空即可）"
              searchPlaceholder="搜尋姓名／編號…"
              className="w-full"
              clearable
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">姓名 *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">功德項目（例：如意功德主）</label>
              <input
                value={form.donor_item}
                onChange={e => setForm(f => ({ ...f, donor_item: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">座位</label>
              <input
                value={form.seat}
                onChange={e => setForm(f => ({ ...f, seat: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">胸花</label>
              <input
                value={form.corsage}
                onChange={e => setForm(f => ({ ...f, corsage: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">供具</label>
              <input
                value={form.offering}
                onChange={e => setForm(f => ({ ...f, offering: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">備註</label>
              <textarea
                rows={2}
                value={form.donor_note}
                onChange={e => setForm(f => ({ ...f, donor_note: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 resize-y"
              />
            </div>
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <p className="text-xs text-gray-400">提示：空白欄位不會顯示在報到頁</p>
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >取消</button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
          >{saving ? '儲存中…' : (isEdit ? '儲存修改' : '新增')}</button>
        </div>
      </form>
    </div>
  )
}
