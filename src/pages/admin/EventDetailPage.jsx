import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import FieldRow from '../../components/FieldRow'
import { useAuth } from '../../lib/auth'
import {
  getAllEvents,
  updateEvent,
  toggleEventLock,
  deleteEvent,
  getEventFields,
  saveEventFields,
  getRegistrationsWithStudents,
  deleteRegistration,
  uncheckIn,
  uncheckInSession,
  logRegistrationChange,
  getEventChanges,
  recordExportTime,
  getVolunteers,
  getEventVolunteers,
  setEventVolunteers,
  getTemplates,
  getEventSessions,
  getEventSessionFields,
  getEventSessionCheckins,
  saveEventSessionFields,
  uploadEventCoverImage,
} from '../../lib/supabase'
import {
  sessionFieldsForPeriod,
  formatSessionAnswer,
  computeMultiSessionStats,
} from '../../lib/registrationHelpers'
import EventSessionsPanel from '../../components/EventSessionsPanel'
import EventSessionFieldsPanel from '../../components/EventSessionFieldsPanel'
import DiffDetailModal from '../../components/DiffDetailModal'
import EditRegistrationModal from '../../components/EditRegistrationModal'
import GuestRegistrationModal from '../../components/GuestRegistrationModal'
import StudentRegistrationModal from '../../components/StudentRegistrationModal'
import QrCodeModal from '../../components/QrCodeModal'
import BatchPrintModal from '../../components/BatchPrintModal'

import {
  STATUS_LABEL, formatFieldValue, getDisplayName,
  timePeriodShort, timePeriodLabel, formatSessionTabLabel,
  SESSION_LEGACY_KEYS, resolveSessionAns, exportSessionCSV,
  SortTh, exportCSV,
  BIG_CAR_KEYS, SMALL_CAR_KEYS, classifyTransport,
  computeTransportStats, computePreceptStats, computeDashboardStats,
  normalizePlate, pickRoleField, parkingKindOf,
  computeTempleStats, computeGenericRadioStats,
} from '../../lib/eventDetailHelpers'
import ImagePositionEditor from '../../components/ImagePositionEditor'
import EventInfoTab from '../../components/EventInfoTab'
import EventRegistrationsTab from '../../components/EventRegistrationsTab'

// ── 主頁面 ─────────────────────────────────────────────────
export default function EventDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  const [event, setEvent] = useState(null)
  const [fields, setFields] = useState([])
  const [registrations, setRegistrations] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(() => isAdmin ? 'info' : 'registrations')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [form, setForm] = useState({})
  const [locking, setLocking] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 義工存取設定
  const [volunteers, setVolunteers] = useState([])
  const [eventVolunteerIds, setEventVolunteerIds] = useState(new Set())
  // 義工存取設定已整合到頂部「💾 儲存設定」主按鈕，不再需要獨立 state

  // 異動追蹤
  const [changes, setChanges] = useState([])
  const [showCancelled, setShowCancelled] = useState(false)

  // 報名名單排序（時間欄改用 updated_at；最後異動排序最有用）
  const [sortKey, setSortKey] = useState('updated_at')
  const [sortDir, setSortDir] = useState('desc')

  // 多場次
  const [sessions, setSessions] = useState([])
  const [sessionFields, setSessionFields] = useState([])
  const [sessionTab, setSessionTab] = useState('all')

  // 多場次即時看板：詳細統計表格摺疊狀態（預設收起）
  const [showSessionStatsDetail, setShowSessionStatsDetail] = useState(false)

  // 報名名單搜尋
  const [listSearch, setListSearch] = useState('')

  // 欄位顯隱切換
  const [showCheckin, setShowCheckin] = useState(false)
  const [showRegTime, setShowRegTime] = useState(false)
  const [hiddenFieldKeys, setHiddenFieldKeys] = useState(new Set())

  // 身分別欄位（dashboard_role==='identity' 或 field_key==='identity'）
  // 用來判斷「義工相關」欄位、決定固定永遠顯示的欄位
  const identityField = useMemo(
    () =>
      fields.find(f => f.dashboard_role === 'identity') ??
      fields.find(f => f.field_key === 'identity') ??
      null,
    [fields]
  )
  const identityKey = identityField?.field_key ?? null

  // 義工專屬欄位：show_if 條件指向「身分別 = 義工」
  const isVolunteerField = useCallback(
    f => !!identityKey && f?.show_if?.[identityKey] === '義工',
    [identityKey]
  )

  // 上山／下山相關欄位：依 field_label 字串自動偵測（不依寫死的 field_key）
  // 例：「上山交通方式」「上山共乘者」「上山車牌」「預計到達山上時間」→ 上山群組
  //     「下山交通方式」「下山共乘者」「下山車牌」「預計離開山下時間」→ 下山群組
  const isUpField   = useCallback(f => /(?:上山|山上|去程)/.test(f?.field_label || ''), [])
  const isDownField = useCallback(f => /(?:下山|山下|回程)/.test(f?.field_label || ''), [])

  // 固定永遠顯示的欄位 key（不可關閉）：身分別
  // （學員編號、姓名是 hardcoded 欄位，本來就一定顯示，不放在這裡）
  const pinnedFieldKeys = useMemo(() => {
    const s = new Set()
    if (identityKey) s.add(identityKey)
    return s
  }, [identityKey])

  // 切換單一欄位顯隱
  function toggleFieldKey(key) {
    setHiddenFieldKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // 切換一組欄位顯隱：全顯示 ↔ 全隱藏（給「上山交通／下山交通／義工相關」共用）
  function toggleFieldGroup(keys) {
    if (!keys || keys.length === 0) return
    setHiddenFieldKeys(prev => {
      const next = new Set(prev)
      const allHidden = keys.every(k => next.has(k))
      if (allHidden) keys.forEach(k => next.delete(k))
      else           keys.forEach(k => next.add(k))
      return next
    })
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // 欄位拖曳排序
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  // 模板（從 Supabase 動態讀取）
  const [templates, setTemplates] = useState([])

  function handleFieldDrop(toIndex) {
    if (dragIndex === null || dragIndex === toIndex) { setDragIndex(null); return }
    const next = [...fields]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(toIndex, 0, moved)
    setFields(next)
    setDragIndex(null)
    setDragOverIndex(null)
  }

  // 訪客報名 modal
  const [guestModal, setGuestModal] = useState(false)

  // 學員手動報名 modal（後台補登用）
  const [studentModal, setStudentModal] = useState(false)

  // 編輯報名 modal（state + 邏輯都搬到 EditRegistrationModal 元件）
  const [editingReg, setEditingReg] = useState(null) // null | registration

  // 異動明細 modal
  const [diffModal, setDiffModal] = useState(null) // null | registration_changes row

  // 補看 QR code modal（單張）
  const [qrModal, setQrModal] = useState(null) // null | { registrationId, name }

  // 批次列印
  const [selectedGuestIds, setSelectedGuestIds] = useState(new Set())
  const [batchPrintOpen, setBatchPrintOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ events }, { fields: f }, { registrations: r }, { changes: c }, { volunteers: v }, { volunteerIds: va }, { templates: tmpl }, { sessions: s }, { fields: sf }, { checkins: sck }] = await Promise.all([
      getAllEvents(),
      getEventFields(id),
      getRegistrationsWithStudents(id),
      getEventChanges(id),
      getVolunteers(),
      getEventVolunteers(id),
      getTemplates(),
      getEventSessions(id),
      getEventSessionFields(id),
      getEventSessionCheckins(id),
    ])
    const ev = events.find(e => e.event_id === id)
    if (!ev) { navigate('/admin/events'); return }
    setEvent(ev)
    setVolunteers(v || [])
    setEventVolunteerIds(new Set(va || []))
    setForm({
      name: ev.name,
      date_start: ev.date_start ?? '',
      date_end: ev.date_end ?? '',
      location: ev.location ?? '',
      status: ev.status,
      event_type: ev.event_type ?? 'mountain',
      is_dharma: !!ev.is_dharma,
      multi_session: !!ev.multi_session,
      show_transport_to_public: !!ev.show_transport_to_public,
      // 活動介紹頁
      show_on_activities: !!ev.show_on_activities,
      kiosk_open: ev.kiosk_open !== false,  // 預設 true；僅明確設為 false 才關閉刷卡報名
      walkin_mode: !!ev.walkin_mode,
      offline_registration: !!ev.offline_registration,
      location_tag: ev.location_tag ?? 'zhongtai',
      cover_image_url: ev.cover_image_url ?? '',
      cover_image_position: ev.cover_image_position ?? '50% 50%',
      description: ev.description ?? '',
      volunteer_open: !!ev.volunteer_open,
      related_links: ev.related_links ?? [],
    })
    setFields(f)
    // 多場次：把 session_checkins 用 reg_id 分組掛到每筆 registration
    const ckByReg = new Map()
    for (const c of (sck || [])) {
      if (!ckByReg.has(c.reg_id)) ckByReg.set(c.reg_id, [])
      ckByReg.get(c.reg_id).push({ session_id: c.session_id, checked_in_at: c.checked_in_at })
    }
    const regsWithSck = (r || []).map(row => ({
      ...row,
      session_checkins: ckByReg.get(row.registration_id) || [],
    }))
    setRegistrations(regsWithSck)
    setChanges(c)
    setTemplates(tmpl || [])
    const freshSessions = s || []
    setSessions(freshSessions)
    setSessionFields(sf || [])
    if (freshSessions.length > 0) setSessionTab(freshSessions[0].session_id)
    setSelectedGuestIds(new Set()) // 重新載入後清除選取
    setLoading(false)
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  // 搜尋過濾（依姓名／學員編號／班級／答案內容）
  const searchedRegistrations = (() => {
    const q = listSearch.trim().toLowerCase()
    if (!q) return registrations
    return registrations.filter(r => {
      const name = getDisplayName(r)
      const sid  = r.student_id ?? ''
      const cls  = (r.students?.student_classes ?? [])
        .map(c => `${c.class_name ?? ''}${c.group_name ?? ''}`).join(' ')
      // 把 answers 內所有字串值串起來搜尋
      const answers = r.answers ? Object.values(r.answers)
        .map(v => Array.isArray(v) ? v.join(' ') : (typeof v === 'boolean' ? '' : String(v ?? '')))
        .join(' ') : ''
      return `${name} ${sid} ${cls} ${answers}`.toLowerCase().includes(q)
    })
  })()

  // 多場次：依選中場次過濾
  const sessionFilteredRegistrations = (() => {
    if (!event?.multi_session || sessionTab === 'all') return searchedRegistrations
    return searchedRegistrations.filter(r =>
      r.answers?.sessions?.some(ss => ss.session_id === sessionTab)
    )
  })()

  // 有效報到時間：多場次「場次視圖」讀該場次的 session_checkins；其他情況讀 registrations.checked_in_at
  // （多場次活動的 registrations.checked_in_at 永遠 null，要從 session_checkins 取才正確）
  const effectiveCheckinAt = (r) => {
    if (event?.multi_session && sessionTab !== 'all') {
      return r.session_checkins?.find(c => c.session_id === sessionTab)?.checked_in_at || null
    }
    return r.checked_in_at || null
  }

  // 排序後的報名名單
  const sortedRegistrations = [...sessionFilteredRegistrations].sort((a, b) => {
    let aVal = '', bVal = ''
    if (sortKey === 'student_id') {
      aVal = a.student_id ?? '\uFFFF'  // 訪客排最後
      bVal = b.student_id ?? '\uFFFF'
    } else if (sortKey === 'name') {
      aVal = getDisplayName(a)
      bVal = getDisplayName(b)
    } else if (sortKey === 'checked_in_at') {
      aVal = a.checked_in_at ?? ''
      bVal = b.checked_in_at ?? ''
    } else if (sortKey === 'updated_at' || sortKey === 'registered_at') {
      // 統一用 updated_at（registered_at 為舊鍵向後相容）
      aVal = a.updated_at ?? a.registered_at ?? ''
      bVal = b.updated_at ?? b.registered_at ?? ''
    } else if (sortKey.startsWith('field:')) {
      const fKey = sortKey.slice(6)
      let av = a.answers?.[fKey] ?? ''
      let bv = b.answers?.[fKey] ?? ''
      if (typeof av === 'boolean') av = av ? '是' : '否'
      if (typeof bv === 'boolean') bv = bv ? '是' : '否'
      if (Array.isArray(av)) av = av.join('、')
      if (Array.isArray(bv)) bv = bv.join('、')
      aVal = av; bVal = bv
    }
    const cmp = String(aVal).localeCompare(String(bVal), 'zh-TW', { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  })

  // 批次列印相關衍生狀態
  const guestRegistrations = registrations.filter(r => !r.student_id)
  const hasGuests = guestRegistrations.length > 0
  const allGuestsSelected = hasGuests && guestRegistrations.every(r => selectedGuestIds.has(r.registration_id))
  const selectedGuestRegs = guestRegistrations.filter(r => selectedGuestIds.has(r.registration_id))

  function toggleGuestSelect(regId) {
    setSelectedGuestIds(prev => {
      const next = new Set(prev)
      if (next.has(regId)) next.delete(regId)
      else next.add(regId)
      return next
    })
  }

  function toggleSelectAllGuests() {
    if (allGuestsSelected) {
      setSelectedGuestIds(new Set())
    } else {
      setSelectedGuestIds(new Set(guestRegistrations.map(r => r.registration_id)))
    }
  }

  // 儲存活動基本資料 + 義工存取設定（同一顆按鈕一次存）
  async function handleSaveInfo(e) {
    e.preventDefault()
    setSaving(true)
    const [infoRes, volunteerRes] = await Promise.all([
      updateEvent(id, {
        name: form.name,
        date_start: form.date_start || null,
        date_end: form.date_end || null,
        location: form.location,
        status: form.status,
        event_type: form.event_type,
        is_dharma: form.is_dharma,
        multi_session: form.multi_session,
        show_transport_to_public: form.show_transport_to_public,
        // 活動介紹頁
        show_on_activities: form.show_on_activities,
        kiosk_open: form.kiosk_open,
        walkin_mode: form.walkin_mode,
        offline_registration: form.offline_registration,
        location_tag: form.location_tag,
        cover_image_url: form.cover_image_url || null,
        cover_image_position: form.cover_image_position || '50% 50%',
        description: form.description || null,
        volunteer_open: form.volunteer_open,
        related_links: (form.related_links || []).filter(l => l.title && l.url),
      }),
      setEventVolunteers(id, [...eventVolunteerIds]),
    ])
    setSaving(false)
    const okAll = infoRes.success && volunteerRes.success
    if (okAll) {
      setSaveMsg('✅ 已儲存（含義工存取設定）')
      setEvent(ev => ({ ...ev, ...form }))
    } else {
      const errMsg = !infoRes.success ? infoRes.error : volunteerRes.error
      setSaveMsg(`❌ 儲存失敗：${errMsg}`)
    }
    setTimeout(() => setSaveMsg(''), 3000)
  }

  // 儲存動態欄位
  async function handleSaveFields() {
    setSaving(true)
    const { success, error } = await saveEventFields(id, fields)
    setSaving(false)
    const msg = success ? '✅ 欄位已儲存' : `❌ 儲存失敗：${error}`
    setSaveMsg(msg)
    if (success) setTimeout(() => setSaveMsg(''), 3000)
  }

  async function handleDeleteEvent() {
    const regCount = registrations.length
    const msg = regCount > 0
      ? `確定要刪除「${event.name}」嗎？\n\n此活動目前有 ${regCount} 筆報名紀錄，刪除後所有資料將無法復原。\n\n請輸入活動名稱確認刪除：`
      : `確定要刪除「${event.name}」嗎？此動作無法復原。`

    if (regCount > 0) {
      const input = window.prompt(msg)
      if (input !== event.name) {
        if (input !== null) alert('活動名稱不符，已取消刪除。')
        return
      }
    } else {
      if (!window.confirm(msg)) return
    }

    setDeleting(true)
    const { success, error: err } = await deleteEvent(id)
    setDeleting(false)
    if (!success) { alert(`刪除失敗：${err}`); return }
    navigate('/admin/events')
  }

  async function handleUncheckIn(registrationId, studentName) {
    // 多場次「場次視圖」→ 取消該場次的 session_checkin；其他 → 取消 registrations.checked_in_at
    const isSessionView = event?.multi_session && sessionTab !== 'all'
    const label = isSessionView ? '此場次的報到' : '報到'
    if (!window.confirm(`確定要取消「${studentName}」的${label}嗎？`)) return

    if (isSessionView) {
      const { success, error } = await uncheckInSession(registrationId, sessionTab)
      if (!success) { alert(`取消報到失敗：${error}`); return }
      setRegistrations(prev => prev.map(r =>
        r.registration_id === registrationId
          ? { ...r, session_checkins: (r.session_checkins || []).filter(c => c.session_id !== sessionTab) }
          : r
      ))
      return
    }

    const { success, error } = await uncheckIn(registrationId)
    if (!success) { alert(`取消報到失敗：${error}`); return }
    setRegistrations(prev => prev.map(r =>
      r.registration_id === registrationId
        ? { ...r, checked_in_at: null }
        : r
    ))
  }

  async function handleDeleteRegistration(registrationId, studentName) {
    if (!window.confirm(`確定要取消「${studentName}」的報名嗎？此動作無法復原。`)) return
    const reg = registrations.find(r => r.registration_id === registrationId)

    // 記錄取消（刪除前先備份）
    await logRegistrationChange({
      registrationId,
      eventId: id,
      eventName: event.name,
      studentName,
      changeType: 'cancelled',
      oldAnswers: reg?.answers ?? null,
      newAnswers: null,
    })

    const { success, error } = await deleteRegistration(registrationId)
    if (!success) { alert(`取消失敗：${error}`); return }
    setRegistrations(prev => prev.filter(r => r.registration_id !== registrationId))
    setSelectedGuestIds(prev => {
      const next = new Set(prev)
      next.delete(registrationId)
      return next
    })
    // 重新載入異動紀錄
    const { changes: newChanges } = await getEventChanges(id)
    setChanges(newChanges)
  }

  function addField() {
    setFields(prev => [...prev, {
      field_key: '',
      field_label: '',
      field_type: 'radio',
      options: [],
      show_if: null,
      required: true,
      dashboard_role: null,
      option_meta: null,
    }])
  }

  // ── 異動追蹤計算值 ──────────────────────────────────────────
  const lastExported = event?.last_exported_at ? new Date(event.last_exported_at) : null

  // 上次匯出後新增的報名
  const newRegIds = lastExported
    ? new Set(registrations.filter(r => new Date(r.registered_at) > lastExported).map(r => r.registration_id))
    : new Set()

  // 上次匯出後被修改的報名
  const modifiedRegIds = lastExported
    ? new Set(
        changes
          .filter(c => c.change_type === 'modified' && new Date(c.changed_at) > lastExported)
          .map(c => c.registration_id)
          .filter(Boolean)
      )
    : new Set()

  // 所有取消紀錄（不受匯出基準限制，永遠顯示）
  const cancelledChanges = changes.filter(c => c.change_type === 'cancelled')

  // 上次匯出後被取消的（用於橫幅計數）
  const cancelledChangesSince = lastExported
    ? cancelledChanges.filter(c => new Date(c.changed_at) > lastExported)
    : []

  const totalChangeSince = newRegIds.size + modifiedRegIds.size + cancelledChangesSince.length

  if (loading) {
    return (
      <AdminLayout>
        <p className="text-gray-400 text-sm py-16 text-center">載入中…</p>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout>
      {/* ── 批次列印 Modal ── */}
      <BatchPrintModal
        open={batchPrintOpen}
        onClose={() => setBatchPrintOpen(false)}
        event={event}
        selectedGuestRegs={selectedGuestRegs}
      />

      {/* ── 異動明細 Modal ── */}
      <DiffDetailModal
        diffModal={diffModal}
        fields={fields}
        onClose={() => setDiffModal(null)}
      />

      {/* ── 編輯報名 Modal ── */}
      <EditRegistrationModal
        registration={editingReg}
        event={event}
        eventId={id}
        fields={fields}
        sessions={sessions}
        sessionFields={sessionFields}
        onClose={() => setEditingReg(null)}
        onSaved={({ registrationId, newAnswers, newChanges }) => {
          setRegistrations(prev => prev.map(r =>
            r.registration_id === registrationId ? { ...r, answers: newAnswers } : r
          ))
          setChanges(newChanges)
        }}
      />

      {/* ── 補看 QR code Modal（單張）── */}
      <QrCodeModal
        registrationId={qrModal?.registrationId ?? null}
        name={qrModal?.name ?? ''}
        event={event}
        onClose={() => setQrModal(null)}
      />

      {/* ── 訪客報名 Modal ── */}
      <GuestRegistrationModal
        open={guestModal}
        onClose={() => setGuestModal(false)}
        onSuccess={load}
        event={event}
        eventId={id}
        fields={fields}
      />

      {/* ── 學員手動報名 Modal（後台補登）── */}
      <StudentRegistrationModal
        open={studentModal}
        onClose={() => setStudentModal(false)}
        onSuccess={load}
        event={event}
        eventId={id}
        fields={fields}
      />

      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link to="/admin/events" className="hover:text-amber-700">活動管理</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">{event.name}</span>
      </div>

      {/* 標題列 */}
      <div className="flex items-center justify-between mb-5 gap-3">
        <h2 className="text-xl font-bold text-gray-800 min-w-0 truncate">{event.name}</h2>
        <div className="flex items-center gap-2 shrink-0">
          {event?.event_type === 'temple' && event?.is_dharma && isAdmin && (
            <Link
              to={`/admin/events/${id}/donors`}
              className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              🪷 功德主管理
            </Link>
          )}
          <Link
            to={`/admin/events/${id}/checkin`}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            📋 現場報到
          </Link>
        </div>
      </div>

      {/* Tab 切換 */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {[
          { key: 'info',          label: '活動設定',                   adminOnly: true  },
          { key: 'fields',        label: `動態欄位（${fields.length}）`, adminOnly: true  },
          { key: 'registrations', label: `報名名單（${registrations.length}）`, adminOnly: false },
        ].filter(t => !t.adminOnly || isAdmin).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-amber-600 text-amber-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 儲存訊息 */}
      {saveMsg && (
        <p className="text-sm mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">{saveMsg}</p>
      )}

      {/* ── Tab: 活動設定 ── */}
      {tab === 'info' && (
        <EventInfoTab
          saving={saving}
          handleSaveInfo={handleSaveInfo}
          form={form}
          setForm={setForm}
          event={event}
          setEvent={setEvent}
          id={id}
          locking={locking}
          setLocking={setLocking}
          setSaveMsg={setSaveMsg}
          deleting={deleting}
          handleDeleteEvent={handleDeleteEvent}
          registrations={registrations}
          volunteers={volunteers}
          eventVolunteerIds={eventVolunteerIds}
          setEventVolunteerIds={setEventVolunteerIds}
          sessions={sessions}
          setSessions={setSessions}
          setSessionTab={setSessionTab}
        />
      )}

      {/* ── Tab: 動態欄位 ── */}
      {tab === 'fields' && (
        <div className="space-y-4">
          {event?.walkin_mode && (
            <div className="bg-teal-50 border border-teal-300 rounded-xl px-4 py-3 text-sm text-teal-800">
              ℹ️ 此活動已啟用「自由刷卡模式」，學員刷卡後<strong>直接記錄到場，不會顯示任何欄位</strong>。此處的動態欄位設定不會被使用。
            </div>
          )}
          {event?.multi_session && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800">
              ⚠️ 此活動已啟用「多場次報名」，前台刷卡時會<strong>直接進入場次選擇</strong>，不會顯示這裡的動態欄位。<br />
              請改在「活動設定」→「場次設定」→「場次共用子欄位」設定午齋、停車等子問題。
            </div>
          )}
          {fields.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-6">尚無欄位，點下方按鈕新增</p>
          )}
          {fields.map((f, i) => (
            <FieldRow
              key={i}
              index={i}
              field={f}
              allFields={fields.filter((_, j) => j !== i)}
              onChange={updated => setFields(prev => prev.map((x, j) => j === i ? updated : x))}
              onRemove={() => setFields(prev => prev.filter((_, j) => j !== i))}
              onDragStart={setDragIndex}
              onDragOver={setDragOverIndex}
              onDrop={handleFieldDrop}
              isDragOver={dragOverIndex === i}
            />
          ))}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={addField}
              className="border border-dashed border-amber-400 text-amber-700 hover:bg-amber-50 text-sm px-4 py-2 rounded-lg transition-colors"
            >
              ＋ 新增欄位
            </button>
            {templates.map(tmpl => (
              <button
                key={tmpl.template_id}
                onClick={() => {
                  if (fields.length === 0 || window.confirm(`套用「${tmpl.name}」後，目前設定的欄位將全部被取代。確定要繼續嗎？`)) {
                    setFields((tmpl.fields || []).map(f => ({ ...f })))
                  }
                }}
                className="border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 text-sm px-4 py-2 rounded-lg transition-colors"
              >
                📋 套用{tmpl.name}
              </button>
            ))}
            <button
              onClick={handleSaveFields}
              disabled={saving}
              className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50 ml-auto"
            >
              {saving ? '儲存中…' : '儲存欄位'}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: 報名名單 ── */}
      {tab === 'registrations' && (
        <EventRegistrationsTab
          event={event}
          setEvent={setEvent}
          id={id}
          sessions={sessions}
          sessionTab={sessionTab}
          setSessionTab={setSessionTab}
          registrations={registrations}
          sessionFilteredRegistrations={sessionFilteredRegistrations}
          lastExported={lastExported}
          totalChangeSince={totalChangeSince}
          newRegIds={newRegIds}
          modifiedRegIds={modifiedRegIds}
          cancelledChangesSince={cancelledChangesSince}
          sessionFields={sessionFields}
          showSessionStatsDetail={showSessionStatsDetail}
          setShowSessionStatsDetail={setShowSessionStatsDetail}
          fields={fields}
          listSearch={listSearch}
          setListSearch={setListSearch}
          searchedRegistrations={searchedRegistrations}
          sortedRegistrations={sortedRegistrations}
          isAdmin={isAdmin}
          hasGuests={hasGuests}
          selectedGuestIds={selectedGuestIds}
          allGuestsSelected={allGuestsSelected}
          toggleSelectAllGuests={toggleSelectAllGuests}
          toggleGuestSelect={toggleGuestSelect}
          showCheckin={showCheckin}
          setShowCheckin={setShowCheckin}
          showRegTime={showRegTime}
          setShowRegTime={setShowRegTime}
          pinnedFieldKeys={pinnedFieldKeys}
          isVolunteerField={isVolunteerField}
          isUpField={isUpField}
          isDownField={isDownField}
          hiddenFieldKeys={hiddenFieldKeys}
          toggleFieldGroup={toggleFieldGroup}
          toggleFieldKey={toggleFieldKey}
          sortKey={sortKey}
          sortDir={sortDir}
          handleSort={handleSort}
          setBatchPrintOpen={setBatchPrintOpen}
          setStudentModal={setStudentModal}
          setGuestModal={setGuestModal}
          changes={changes}
          setDiffModal={setDiffModal}
          effectiveCheckinAt={effectiveCheckinAt}
          handleUncheckIn={handleUncheckIn}
          setEditingReg={setEditingReg}
          handleDeleteRegistration={handleDeleteRegistration}
          showCancelled={showCancelled}
          setShowCancelled={setShowCancelled}
          cancelledChanges={cancelledChanges}
          setQrModal={setQrModal}
        />
      )}
    </AdminLayout>
  )
}
