import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import { supabase, getAllEvents, createEvent, getMyEvents, saveEventFields, saveEventSessionFields } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

const STATUS_LABEL = { draft: '草稿', active: '進行中', closed: '已關閉' }
const STATUS_COLOR = {
  draft:  'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
}

export default function EventsPage() {
  const navigate = useNavigate()
  const { isAdmin, user } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', date_start: '', date_end: '', location: '', status: 'draft', event_type: 'mountain', is_dharma: false, multi_session: false, show_on_activities: true })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  // V7 export
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportCandidates, setExportCandidates] = useState([])
  const [exporting, setExporting] = useState(false)
  // V7 import
  const [showImportModal, setShowImportModal] = useState(false)
  const [importData, setImportData] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    if (isAdmin) {
      const { events } = await getAllEvents()
      setEvents(events)
    } else {
      // 義工只能看到師父指定的活動
      const { events } = await getMyEvents(user?.id)
      setEvents(events)
    }
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')
    setSaving(true)

    const { event, error } = await createEvent({
      name: form.name,
      date_start: form.date_start || null,
      date_end: form.date_end || null,
      location: form.location,
      status: form.status,
      event_type: form.event_type,
      is_dharma: form.is_dharma,
      multi_session: form.multi_session,
    })

    setSaving(false)

    if (error) {
      setFormError(error)
      return
    }

    setShowForm(false)
    setForm({ name: '', date_start: '', date_end: '', location: '', status: 'draft', event_type: 'mountain', is_dharma: false, multi_session: false, show_on_activities: true })
    navigate(`/admin/events/${event.event_id}`)
  }

  // ── V7 Export ────────────────────────────────────────────────────────────
  async function openExportModal() {
    setExporting(true)
    const { events: allEvents } = await getAllEvents()
    const activeEvents = (allEvents || []).filter(e => e.status !== 'closed')
    setExportCandidates(activeEvents.map(e => ({ event_id: e.event_id, name: e.name, status: e.status, checked: true })))
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
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">活動管理</h2>
        {isAdmin && (
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
        )}
      </div>

      {/* 新增活動表單 */}
      {showForm && (
        <div className="bg-white border border-amber-200 rounded-xl p-6 mb-6 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4">新增活動</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">活動名稱 *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="例：2026 祖忌法會"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">開始日期</label>
              <input
                type="date"
                value={form.date_start}
                onChange={e => setForm(f => ({ ...f, date_start: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">結束日期</label>
              <input
                type="date"
                value={form.date_end}
                onChange={e => setForm(f => ({ ...f, date_end: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">地點</label>
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="例：普宜精舍大殿"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">活動類型 *</label>
              <select
                value={form.event_type}
                onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="mountain">回山活動（看板顯示交通資訊）</option>
                <option value="temple">精舍活動（看板顯示午齋／停車）</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">狀態</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="draft">草稿</option>
                <option value="active">進行中</option>
                <option value="closed">已關閉</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.is_dharma}
                  onChange={e => setForm(f => ({ ...f, is_dharma: e.target.checked }))}
                  className="w-4 h-4 accent-amber-600"
                />
                此為精舍法會活動（勾選後可設定法會報到時，出現功德主相關資訊）
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.multi_session}
                  onChange={e => setForm(f => ({ ...f, multi_session: e.target.checked }))}
                  className="w-4 h-4 accent-emerald-600"
                />
                <span>
                  多場次報名
                  <span className="text-xs text-gray-500 ml-1">（梁皇寶懺等多日法會用；學員可一次勾選多場）</span>
                </span>
              </label>
            </div>

            {formError && (
              <p className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formError}
              </p>
            )}

            <div className="sm:col-span-2 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? '儲存中…' : '建立活動'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 活動列表 */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">載入中…</p>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          {isAdmin
            ? <p className="text-sm">尚無活動，點上方按鈕新增第一場</p>
            : <p className="text-sm">尚未被指定任何活動，請聯絡師父設定</p>
          }
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(ev => (
            <Link
              key={ev.event_id}
              to={`/admin/events/${ev.event_id}`}
              className="block bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-amber-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800">{ev.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {ev.date_start || '日期未設定'}
                    {ev.date_end && ev.date_end !== ev.date_start ? ` ～ ${ev.date_end}` : ''}
                    {ev.location ? `　${ev.location}` : ''}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[ev.status]}`}>
                  {STATUS_LABEL[ev.status]}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

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
                  {c.status === 'draft' && <span className="text-xs text-gray-400 ml-1">（草稿）</span>}
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
}
