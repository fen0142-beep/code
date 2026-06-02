import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import { supabase, getAllEvents, createEvent, getMyEvents, saveEventFields, saveEventSessionFields } from '../../lib/supabase'
import { DEFAULT_TEMPLATES } from '../../lib/defaultEventTemplates'
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
  const [form, setForm] = useState({ name: '', date_start: '', date_end: '', location: '', status: 'active', event_type: 'mountain', is_dharma: false, multi_session: false, show_on_activities: true })
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
  const [importSelected, setImportSelected] = useState([]) // indices of selected events
  const [importResult, setImportResult] = useState('')
  // V7b built-in templates
  const [showBuiltinModal, setShowBuiltinModal] = useState(false)
  const [builtinSelected, setBuiltinSelected] = useState([]) // indices of selected templates
  const [importingBuiltin, setImportingBuiltin] = useState(false)
  // 篩選 tab（主頁籤：地點；子頁籤：時間）
  const [activeTab, setActiveTab] = useState('zhongtai')
  const [activeTimeTab, setActiveTimeTab] = useState('ongoing')
  // 定期活動批次刪除
  const [selectedRecurring, setSelectedRecurring] = useState(new Set())
  const [deletingRecurring, setDeletingRecurring] = useState(false)

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

  async function handleDeleteRecurring() {
    if (selectedRecurring.size === 0) return
    if (!window.confirm(`確定要刪除選取的 ${selectedRecurring.size} 筆定期活動嗎？此動作無法復原。`)) return
    setDeletingRecurring(true)
    const ids = [...selectedRecurring]
    const { error } = await supabase.from('events').delete().in('event_id', ids)
    setDeletingRecurring(false)
    if (error) { alert('刪除失敗：' + error.message); return }
    setSelectedRecurring(new Set())
    load()
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
      _source: import.meta.env.VITE_TEMPLE_NAME,
      _exported_at: today,
      _count: templatesArr.length,
      events: templatesArr,
    }

    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `活動模板_${import.meta.env.VITE_TEMPLE_NAME}_${today}.json`
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
        setImportSelected(json.events.map((_, i) => i))
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

    const selectedEvents = importData.events.filter((_, i) => importSelected.includes(i))
    for (const tmpl of selectedEvents) {
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
    setImportSelected([])
    setImportResult(`✅ 已匯入 ${successCount} 個活動，請逐一補填日期與封面圖`)
  }

  // ── V7b Built-in templates ───────────────────────────────────────────────
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
            <button
              onClick={() => { setBuiltinSelected(DEFAULT_TEMPLATES.map((_, i) => i)); setShowBuiltinModal(true) }}
              className="bg-white border border-gray-300 hover:border-amber-400 text-gray-600 hover:text-gray-800 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              📋 內建模板
            </button>
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
                <option value="mountain">外出活動（看板顯示交通資訊）</option>
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

      {/* 主頁籤：地點分類 */}
      {!loading && (() => {
        const today = new Date().toISOString().slice(0, 10)
        const nonRecurring = events.filter(e => !e.is_recurring)
        const byTab = {
          zhongtai: nonRecurring.filter(e => e.location_tag === 'zhongtai'),
          puyi:     nonRecurring.filter(e => e.location_tag === 'puyi'),
          recurring: events.filter(e => e.is_recurring),
          other:    nonRecurring.filter(e => !e.location_tag || (e.location_tag !== 'zhongtai' && e.location_tag !== 'puyi')),
        }
        return (
          <div className="flex gap-1 mb-0 border-b border-gray-200">
            {[
              { key: 'zhongtai', label: '中台', color: 'text-blue-700' },
              { key: 'puyi',     label: '精舍', color: 'text-amber-700' },
              { key: 'recurring',label: '定期', color: 'text-teal-700' },
              { key: 'other',    label: '其他', color: 'text-gray-600' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSelectedRecurring(new Set()) }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? `border-amber-600 ${tab.color}`
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5">
                  {byTab[tab.key].length}
                </span>
              </button>
            ))}
          </div>
        )
      })()}

      {/* 子頁籤：時間分類（定期除外） */}
      {!loading && activeTab !== 'recurring' && (
        <div className="flex gap-1 mb-4 bg-gray-50 px-3 pt-2 pb-0 border-b border-gray-200">
          {[
            { key: 'ongoing', label: '進行中' },
            { key: 'ended',   label: '已結束' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTimeTab(t.key)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                activeTimeTab === t.key
                  ? 'border-amber-500 text-amber-700'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
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
      ) : (() => {
        // 定期活動 tab：獨立 UI，支援批次刪除
        if (activeTab === 'recurring') {
          const recurringEvents = events
            .filter(e => e.is_recurring)
            .slice()
            .sort((a, b) => (b.date_start || '').localeCompare(a.date_start || '')) // 新的在上
          if (recurringEvents.length === 0) return (
            <p className="text-center text-sm text-gray-400 py-12">尚無定期活動（系統每周五中午自動建立）</p>
          )
          const allSelected = recurringEvents.every(e => selectedRecurring.has(e.event_id))
          return (
            <div>
              {/* 批次操作列 */}
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={e => {
                      if (e.target.checked) setSelectedRecurring(new Set(recurringEvents.map(e => e.event_id)))
                      else setSelectedRecurring(new Set())
                    }}
                    className="w-4 h-4 accent-teal-600"
                  />
                  全選（{recurringEvents.length} 筆）
                </label>
                {selectedRecurring.size > 0 && (
                  <button
                    onClick={handleDeleteRecurring}
                    disabled={deletingRecurring}
                    className="px-4 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {deletingRecurring ? '刪除中…' : `刪除選取（${selectedRecurring.size}）`}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {recurringEvents.map(ev => (
                  <div key={ev.event_id} className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-teal-300 transition-all">
                    <input
                      type="checkbox"
                      checked={selectedRecurring.has(ev.event_id)}
                      onChange={e => {
                        const s = new Set(selectedRecurring)
                        e.target.checked ? s.add(ev.event_id) : s.delete(ev.event_id)
                        setSelectedRecurring(s)
                      }}
                      className="w-4 h-4 accent-teal-600 shrink-0"
                    />
                    <Link
                      to={`/admin/events/${ev.event_id}`}
                      className="flex-1 flex items-center justify-between min-w-0"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 truncate">{ev.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{ev.date_start || '日期未設定'}</p>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ml-3 ${STATUS_COLOR[ev.status]}`}>
                        {STATUS_LABEL[ev.status]}
                      </span>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )
        }

        // 一般 tab：依地點 + 時間過濾
        const today = new Date().toISOString().slice(0, 10)
        const nonRecurring = events.filter(e => !e.is_recurring)
        const byLocation = activeTab === 'zhongtai' ? nonRecurring.filter(e => e.location_tag === 'zhongtai')
          : activeTab === 'puyi' ? nonRecurring.filter(e => e.location_tag === 'puyi')
          : nonRecurring.filter(e => !e.location_tag || (e.location_tag !== 'zhongtai' && e.location_tag !== 'puyi'))
        const filtered = byLocation
          .filter(e => activeTimeTab === 'ongoing'
            ? (!e.date_end || e.date_end >= today)
            : (e.date_end && e.date_end < today)
          )
          .slice()
          .sort((a, b) => {
            if (activeTimeTab === 'ended') return (b.date_start || '').localeCompare(a.date_start || '') // 已結束：新的在上
            if (!a.date_start && !b.date_start) return 0
            if (!a.date_start) return 1
            if (!b.date_start) return -1
            return a.date_start.localeCompare(b.date_start)
          })
        return filtered.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-12">此分類目前沒有活動</p>
        ) : (
          <div className="space-y-3">
            {filtered.map(ev => (
              <Link
                key={ev.event_id}
                to={`/admin/events/${ev.event_id}`}
                className={`block rounded-xl border px-5 py-4 hover:shadow-sm transition-all ${activeTimeTab === 'ended' ? 'bg-gray-50 border-gray-100 hover:border-gray-300 opacity-75' : 'bg-white border-gray-200 hover:border-amber-300'}`}
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
        )
      })()}

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
              <label className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 rounded px-2 py-1 mb-2 border-b pb-2">
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
              </ul>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-700 space-y-1">
                <p>⚠️ 所有活動日期未設定，匯入後請逐一補填</p>
                <p>⚠️ 封面圖需重新上傳</p>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-2">
              <button
                onClick={() => { setShowImportModal(false); setImportData(null); setImportSelected([]) }}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
              >
                取消
              </button>
              <span className="text-xs text-gray-400 mr-2">已選 {importSelected.length} 個</span>
              <button
                onClick={handleConfirmImport}
                disabled={importing || importSelected.length === 0}
                className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {importing ? '匯入中…' : '確認匯入'}
              </button>
            </div>
          </div>
        </div>
      )}

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
}
