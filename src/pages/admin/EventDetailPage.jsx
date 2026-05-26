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

// ── 封面圖片拖曳定位元件 ────────────────────────────────────
function ImagePositionEditor({ url, position, onChange }) {
  const [isDragging, setIsDragging] = useState(false)
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 })
  const containerRef = useRef(null)

  const parsePos = (pos) => {
    const [x, y] = (pos || '50% 50%').split(' ').map(v => parseFloat(v))
    return { x: isNaN(x) ? 50 : x, y: isNaN(y) ? 50 : y }
  }

  const handleMouseDown = (e) => {
    e.preventDefault()
    setIsDragging(true)
    setLastPos({ x: e.clientX, y: e.clientY })
  }

  const handleMouseMove = (e) => {
    if (!isDragging) return
    const dx = e.clientX - lastPos.x
    const dy = e.clientY - lastPos.y
    setLastPos({ x: e.clientX, y: e.clientY })
    const { x, y } = parsePos(position)
    const sensitivity = 0.2
    const newX = Math.min(100, Math.max(0, x - dx * sensitivity))
    const newY = Math.min(100, Math.max(0, y - dy * sensitivity))
    onChange(`${Math.round(newX)}% ${Math.round(newY)}%`)
  }

  const handleMouseUp = () => setIsDragging(false)
  const handleMouseLeave = () => setIsDragging(false)

  const handleTouchStart = (e) => {
    const t = e.touches[0]
    setIsDragging(true)
    setLastPos({ x: t.clientX, y: t.clientY })
  }

  const handleTouchMove = (e) => {
    if (!isDragging) return
    const t = e.touches[0]
    const dx = t.clientX - lastPos.x
    const dy = t.clientY - lastPos.y
    setLastPos({ x: t.clientX, y: t.clientY })
    const { x, y } = parsePos(position)
    const sensitivity = 0.2
    const newX = Math.min(100, Math.max(0, x - dx * sensitivity))
    const newY = Math.min(100, Math.max(0, y - dy * sensitivity))
    onChange(`${Math.round(newX)}% ${Math.round(newY)}%`)
  }

  return (
    <div className="mt-3">
      <p className="text-xs text-gray-500 mb-1">圖片顯示位置</p>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          aspectRatio: '5 / 2',
          overflow: 'hidden',
          borderRadius: '6px',
          border: '1px solid #d1d5db',
          cursor: isDragging ? 'grabbing' : 'grab',
          position: 'relative',
          userSelect: 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseUp}
      >
        <img
          src={url}
          alt="封面預覽"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: position || '50% 50%',
            pointerEvents: 'none',
            draggable: false,
          }}
        />
        <div style={{
          position: 'absolute',
          bottom: '6px',
          right: '8px',
          backgroundColor: 'rgba(0,0,0,0.5)',
          color: 'white',
          fontSize: '0.65rem',
          padding: '2px 6px',
          borderRadius: '3px',
          pointerEvents: 'none',
        }}>
          拖曳圖片調整顯示位置
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-1">目前：{position || '50% 50%'}</p>
    </div>
  )
}

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
  const isUpField   = useCallback(f => /(?:上山|山上)/.test(f?.field_label || ''), [])
  const isDownField = useCallback(f => /(?:下山|山下)/.test(f?.field_label || ''), [])

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
        <>
        {/* 頂部儲存列（藍色主按鈕，提升優先級） */}
        <div className="sticky top-0 z-10 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3 shadow-sm">
          <div className="text-sm text-blue-800 min-w-0">
            <p className="font-semibold">活動設定</p>
            <p className="text-xs text-blue-600/80 truncate">修改任一欄位後請按右側按鈕儲存</p>
          </div>
          <button
            type="submit"
            form="event-info-form"
            disabled={saving}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50 shadow"
          >
            {saving ? '儲存中…' : '💾 儲存設定'}
          </button>
        </div>

        <form id="event-info-form" onSubmit={handleSaveInfo} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">活動名稱 *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">開始日期</label>
              <input type="date" value={form.date_start}
                onChange={e => setForm(f => ({ ...f, date_start: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">結束日期</label>
              <input type="date" value={form.date_end}
                onChange={e => setForm(f => ({ ...f, date_end: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">地點</label>
              <input value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">活動類型 *</label>
              <select value={form.event_type ?? 'mountain'}
                onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="mountain">回山活動（看板顯示交通資訊）</option>
                <option value="temple">精舍活動（看板顯示午齋／停車）</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">狀態</label>
              <select value={form.status}
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
                  checked={!!form.is_dharma}
                  onChange={e => setForm(f => ({ ...f, is_dharma: e.target.checked }))}
                  className="w-4 h-4 accent-amber-600"
                />
                此為精舍法會活動（勾選後可設定法會報到時，出現功德主相關資訊）
              </label>
            </div>
            {/* 多場次報名 — 精舍活動即可啟用，不須限定法會 */}
            {form.event_type === 'temple' && (
              <div className="sm:col-span-2">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!form.multi_session}
                    onChange={e => setForm(f => ({ ...f, multi_session: e.target.checked }))}
                    className="w-4 h-4 accent-indigo-600"
                  />
                  啟用多場次報名（適用梁皇寶懺等多日法會，學員一次勾選所有場次）
                </label>
              </div>
            )}
            {/* 對外公開排車資訊 — 任何活動皆可開（回山活動最常用，但精舍也可能臨時用） */}
            <div className="sm:col-span-2">
              <label className="inline-flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!form.show_transport_to_public}
                  onChange={e => setForm(f => ({ ...f, show_transport_to_public: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600 mt-0.5"
                />
                <span>
                  對外公開排車資訊（勾選後，學員在前台刷卡可看到自己的車次）
                  <span className="block text-xs text-gray-500 mt-0.5">
                    排車作業中請保持關閉；確認排車定案後再開啟
                  </span>
                </span>
              </label>
            </div>

            {/* ── 活動介紹頁設定 ─────────────────────────────── */}
            <div className="sm:col-span-2 mt-2">
              <div className="border border-emerald-200 rounded-xl p-4 bg-emerald-50 space-y-4">
                <p className="text-sm font-semibold text-emerald-800">🌐 活動介紹頁設定（/activities）</p>

                {/* 顯示開關 */}
                <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!form.show_on_activities}
                    onChange={e => setForm(f => ({ ...f, show_on_activities: e.target.checked }))}
                    className="w-4 h-4 accent-emerald-600 mt-0.5"
                  />
                  <span>
                    顯示在活動介紹頁
                    <span className="block text-xs text-gray-500 mt-0.5">
                      勾選後學員可在 /activities 看到此活動；取消勾選可隱藏（明年複用時只需改日期再勾回）
                    </span>
                  </span>
                </label>

                {/* 報名截止 */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.status === 'closed'}
                    onChange={e => setForm(f => ({
                      ...f,
                      status: e.target.checked ? 'closed' : 'draft'
                    }))}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">報名已截止（介紹頁顯示玫瑰紅按鈕）</span>
                </label>

                {/* 離線報名 */}
                <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!form.offline_registration}
                    onChange={e => setForm(f => ({ ...f, offline_registration: e.target.checked }))}
                    className="w-4 h-4 accent-gray-500 mt-0.5"
                  />
                  <span>
                    僅供現場／電話報名（按鈕改顯示「報名請洽精舍」）
                    <span className="block text-xs text-gray-500 mt-0.5">
                      勾選後介紹頁按鈕變灰色，不提供線上報名連結
                    </span>
                  </span>
                </label>

                {/* 地點標籤 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">地點標籤</label>
                  <select
                    value={form.location_tag ?? 'zhongtai'}
                    onChange={e => setForm(f => ({ ...f, location_tag: e.target.value }))}
                    className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  >
                    <option value="zhongtai">📍 中台禪寺</option>
                    <option value="tianxiang">📍 天祥寶塔禪寺</option>
                    <option value="puyi">📍 普宜精舍</option>
                    <option value="other">📍 其他（以「地點」欄文字為主）</option>
                  </select>
                </div>

                {/* 活動說明 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">活動說明</label>
                  <textarea
                    value={form.description ?? ''}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={5}
                    placeholder="介紹活動緣起、流程、注意事項等，學員在介紹頁可閱讀此內容"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-y"
                  />
                </div>

                {/* 封面圖片 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">活動封面圖片</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 2 * 1024 * 1024) {
                        alert('圖片請小於 2MB')
                        return
                      }
                      const { url, error } = await uploadEventCoverImage(event.event_id, file)
                      if (error) { alert('上傳失敗：' + error); return }
                      setForm(f => ({ ...f, cover_image_url: url }))
                    }}
                    className="text-sm text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-emerald-100 file:text-emerald-700 hover:file:bg-emerald-200 cursor-pointer"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    建議尺寸 1200×675（16:9），檔案大小 2MB 以內。上傳後請點「儲存設定」。
                  </p>
                  {form.cover_image_url && (
                    <ImagePositionEditor
                      url={form.cover_image_url}
                      position={form.cover_image_position}
                      onChange={val => setForm(f => ({ ...f, cover_image_position: val }))}
                    />
                  )}
                </div>
              </div>

              {/* 相關連結 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  相關連結
                  <span className="text-xs text-gray-400 ml-2">（前台顯示標題，不顯示網址）</span>
                </label>
                {(form.related_links || []).map((link, i) => (
                  <div key={i} className="flex gap-2 mb-2 items-center">
                    <input
                      type="text"
                      placeholder="顯示標題，例：開山祖師開示：開悟三帖藥"
                      value={link.title}
                      onChange={e => { const ls=[...(form.related_links||[])]; ls[i]={...ls[i],title:e.target.value}; setForm(f=>({...f,related_links:ls})) }}
                      className="flex-1 border rounded px-3 py-1.5 text-sm"
                    />
                    <input
                      type="url"
                      placeholder="網址"
                      value={link.url}
                      onChange={e => { const ls=[...(form.related_links||[])]; ls[i]={...ls[i],url:e.target.value}; setForm(f=>({...f,related_links:ls})) }}
                      className="flex-1 border rounded px-3 py-1.5 text-sm"
                    />
                    <button type="button"
                      onClick={() => setForm(f=>({...f,related_links:(f.related_links||[]).filter((_,idx)=>idx!==i)}))}
                      className="text-red-500 hover:text-red-700 text-sm px-2">✕</button>
                  </div>
                ))}
                <button type="button"
                  onClick={() => setForm(f=>({...f,related_links:[...(f.related_links||[]),{title:'',url:''}]}))}
                  className="text-sm text-blue-600 hover:underline mt-1">
                  ＋ 新增連結
                </button>
              </div>
            </div>
          </div>
          {/* （原本底部的儲存按鈕已移至頁面頂部 sticky bar） */}
        </form>

        {/* 多場次場次設定 */}
        {form.multi_session && event?.event_id && (
          <>
            <EventSessionFieldsPanel eventId={event.event_id} />
            <EventSessionsPanel eventId={event.event_id} onSaved={fresh => { setSessions(fresh || []); if (fresh?.length > 0) setSessionTab(fresh[0].session_id) }} />
          </>
        )}

        {/* 停止異動區塊 */}
        <div className={`mt-4 rounded-xl border-2 p-5 flex items-start gap-4 ${
          event.locked
            ? 'border-red-300 bg-red-50'
            : 'border-gray-200 bg-white'
        }`}>
          <div className="flex-1">
            <p className={`text-sm font-semibold ${event.locked ? 'text-red-700' : 'text-gray-700'}`}>
              {event.locked ? '🔒 報名已鎖定（停止異動中）' : '🔓 報名開放中'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {event.locked
                ? '前台學員只能查看報名資料，無法新增、修改或取消。如需調整請在此解鎖。'
                : '按下「停止異動」後，前台將顯示「如需異動請聯絡精舍」，學員無法自行新增或取消報名。'}
            </p>
          </div>
          <button
            disabled={locking}
            onClick={async () => {
              setLocking(true)
              const newLocked = !event.locked
              const { success, error: err } = await toggleEventLock(id, newLocked)
              setLocking(false)
              if (!success) { setSaveMsg(`❌ 操作失敗：${err}`); return }
              setEvent(ev => ({ ...ev, locked: newLocked }))
              if (!newLocked) setForm(f => ({ ...f, volunteer_open: false }))
              setSaveMsg(newLocked ? '🔒 已停止異動' : '🔓 已開放異動')
              setTimeout(() => setSaveMsg(''), 3000)
            }}
            className={`shrink-0 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${
              event.locked
                ? 'bg-white border-2 border-red-400 text-red-700 hover:bg-red-100'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {locking ? '處理中…' : event.locked ? '🔓 解除鎖定' : '🔒 停止異動'}
          </button>
        </div>

        {/* 義工開放模式（鎖定時才顯示，隨儲存設定一起送出） */}
        {event.locked && (
          <div style={{
            marginTop: '8px',
            marginLeft: '28px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}>
            <input
              type="checkbox"
              id="volunteer_open"
              checked={!!form.volunteer_open}
              onChange={e => setForm(f => ({ ...f, volunteer_open: e.target.checked }))}
              style={{ marginTop: '3px', accentColor: '#16a34a' }}
            />
            <label htmlFor="volunteer_open" style={{ fontSize: '0.85rem', color: '#374151', cursor: 'pointer' }}>
              開放義工繼續報名
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginTop: '2px' }}>
                勾選後，刷卡頁仍可報名，但身分別固定為「義工」。勾選後請按頂部「💾 儲存設定」。
              </span>
            </label>
          </div>
        )}

        {/* 義工存取設定（勾選後請按頂部「💾 儲存設定」一併儲存） */}
        <div className="mt-4 bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-1">👤 義工存取設定</p>
          <p className="text-xs text-gray-500 mb-3">
            勾選的義工帳號登入後台後，即可看到此活動的報名名單。
            <span className="text-amber-600">修改後請按頂部「💾 儲存設定」一併儲存。</span>
          </p>
          {volunteers.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">
              尚無義工帳號紀錄。義工以義工帳號登入後台一次後，即會自動出現在此。
            </p>
          ) : (
            <div className="space-y-1">
              {volunteers.map(v => (
                <label key={v.id} className="flex items-center gap-3 cursor-pointer select-none px-2 py-2 rounded-lg hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={eventVolunteerIds.has(v.id)}
                    onChange={e => {
                      setEventVolunteerIds(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(v.id)
                        else next.delete(v.id)
                        return next
                      })
                    }}
                    className="w-4 h-4 accent-amber-600 shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-gray-700">
                      {v.display_name && v.display_name !== v.email ? v.display_name : ''}
                    </span>
                    <span className="text-xs text-gray-500 ml-1">{v.email}</span>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 刪除活動（移至最下方，降權為灰色） */}
        <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-4 flex items-start gap-3">
          <div className="flex-1 text-xs text-gray-500">
            <p className="font-medium text-gray-600">刪除活動</p>
            <p className="mt-0.5">
              刪除後，活動設定、動態欄位與所有報名紀錄將永久移除，無法復原。
              {registrations.length > 0 && (
                <span className="text-red-500"> 目前有 {registrations.length} 筆報名紀錄。</span>
              )}
            </p>
          </div>
          <button
            disabled={deleting}
            onClick={handleDeleteEvent}
            className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-500 bg-white hover:bg-gray-100 hover:text-red-600 hover:border-red-300 transition-colors disabled:opacity-50"
          >
            {deleting ? '刪除中…' : '🗑 刪除活動'}
          </button>
        </div>
        </>
      )}

      {/* ── Tab: 動態欄位 ── */}
      {tab === 'fields' && (
        <div className="space-y-4">
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
        <div>
          {/* 多場次：場次切換 tabs */}
          {event?.multi_session && sessions.length > 0 && (
            <div className="flex gap-1.5 mb-4 flex-wrap items-center border-b border-gray-100 pb-3">
              {sessions.map(s => {
                const cnt = registrations.filter(r =>
                  r.answers?.sessions?.some(ss => ss.session_id === s.session_id)
                ).length
                return (
                  <button
                    key={s.session_id}
                    onClick={() => setSessionTab(s.session_id)}
                    title={s.dharma_name ?? ''}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                      sessionTab === s.session_id
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {formatSessionTabLabel(s)}（{cnt}）
                  </button>
                )
              })}
            </div>
          )}

          {/* 當前場次資訊 banner */}
          {event?.multi_session && sessionTab !== 'all' && (() => {
            const curS = sessions.find(s => s.session_id === sessionTab)
            if (!curS) return null
            return (
              <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
                <span className="text-amber-500 text-lg">🪷</span>
                <div className="text-sm">
                  <span className="font-semibold text-amber-800">{curS.dharma_name ?? formatSessionTabLabel(curS)}</span>
                  <span className="text-amber-600 ml-2">
                    {curS.date?.replaceAll('-', '/')} {timePeriodLabel(curS.time_period)}
                    {curS.time_start && curS.time_end && ` ${curS.time_start.slice(0,5)}–${curS.time_end.slice(0,5)}`}
                  </span>
                </div>
                <span className="ml-auto text-xs text-amber-600 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                  {sessionFilteredRegistrations.length} 人
                </span>
              </div>
            )
          })()}

          {/* 異動橫幅 */}
          {lastExported && totalChangeSince > 0 && (
            <div className="mb-4 px-4 py-3 bg-orange-50 border border-orange-300 rounded-xl flex items-center gap-2">
              <span className="text-lg">🔔</span>
              <div className="text-sm text-orange-700">
                <span className="font-semibold">
                  上次匯出（{new Date(event.last_exported_at).toLocaleString('zh-TW', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}）後有 {totalChangeSince} 筆異動：
                </span>
                {newRegIds.size > 0 && <span className="ml-1 text-green-700 font-medium">新增 {newRegIds.size} 筆</span>}
                {modifiedRegIds.size > 0 && <span className="ml-1 text-amber-700 font-medium">修改 {modifiedRegIds.size} 筆</span>}
                {cancelledChangesSince.length > 0 && <span className="ml-1 text-red-600 font-medium">取消 {cancelledChangesSince.length} 筆</span>}
              </div>
            </div>
          )}

          {/* 即時看板（精舍・多場次版）— 取代單場版 */}
          {registrations.length > 0 && event?.event_type === 'temple' && event?.multi_session && sessions.length > 0 && (() => {
            const { uniquePeople, totalAttendance, bySession, byDate } =
              computeMultiSessionStats(registrations, sessions, sessionFields)

            // 至少要有人或有場次才顯示
            if (uniquePeople === 0) return null

            const dayEntries = Array.from(byDate.entries())  // [[date, sessionList], ...]

            // 動態欄位：把 sessionFields 攤平成「表格欄」清單
            // - radio:   每個 option 一欄（parking_kind 角色時帶上車種 meta）
            // - boolean: 一欄（顯示 true 計數）
            // - text:    一欄（顯示有填的人數）
            // 每欄記 applicablePeriods（空陣列 = 所有時段適用）
            const sortedFields = [...sessionFields].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            const cols = []
            for (const f of sortedFields) {
              const periods = Array.isArray(f.show_if_period) ? f.show_if_period : []
              const isParkingKind = f.dashboard_role === 'parking_kind'
              const meta = f.option_meta || {}
              if (f.field_type === 'radio') {
                for (const opt of (f.options || [])) {
                  // 車種優先讀 option_meta；沒設則 fallback 到字串「機車/轎車/汽車」
                  const kindRaw = isParkingKind
                    ? (meta[opt] || parkingKindOf(opt, null))
                    : null
                  cols.push({
                    key: `${f.field_key}::${opt}`,
                    label: opt,
                    fieldKey: f.field_key,
                    kind: 'option',
                    option: opt,
                    applicablePeriods: periods,
                    parkingKind: kindRaw,   // 'motorcycle' | 'car' | 'none' | null
                  })
                }
              } else if (f.field_type === 'boolean') {
                cols.push({
                  key: f.field_key,
                  label: f.field_label,
                  fieldKey: f.field_key,
                  kind: 'boolean',
                  applicablePeriods: periods,
                })
              } else if (f.field_type === 'text') {
                cols.push({
                  key: f.field_key,
                  label: `${f.field_label}（有填）`,
                  fieldKey: f.field_key,
                  kind: 'text',
                  applicablePeriods: periods,
                })
              }
            }

            const isColApplicable = (s, col) =>
              col.applicablePeriods.length === 0 || col.applicablePeriods.includes(s.time_period)

            const cellValueFor = (s, col, b) => {
              if (!isColApplicable(s, col)) return null
              const stat = b?.stats?.[col.fieldKey] || {}
              if (col.kind === 'option')  return stat[col.option] || 0
              if (col.kind === 'boolean') return stat.true || 0
              if (col.kind === 'text')    return stat.filled || 0
              return 0
            }

            // 合計列：對每欄加總「適用場次」的值；若該欄無任何適用場次顯示「—」
            // 同時依 option_meta 把 parking_kind 欄位的選項彙總成「機車人次 / 汽車人次」
            let sumCount = 0
            const sumByCol = new Map(cols.map(c => [c.key, { sum: 0, anyApplicable: false }]))
            const parkingTotals = { motorcycle: 0, car: 0, hasAny: false }
            for (const s of sessions) {
              const b = bySession.get(s.session_id) ?? { count: 0, stats: {} }
              sumCount += b.count
              for (const col of cols) {
                if (!isColApplicable(s, col)) continue
                const agg = sumByCol.get(col.key)
                agg.anyApplicable = true
                const v = cellValueFor(s, col, b) || 0
                agg.sum += v
                if (col.kind === 'option' && col.parkingKind) {
                  parkingTotals.hasAny = true
                  if (col.parkingKind === 'motorcycle') parkingTotals.motorcycle += v
                  else if (col.parkingKind === 'car')   parkingTotals.car        += v
                }
              }
            }

            // 日期顯示：5/24
            const fmtMd = d => {
              if (!d) return ''
              const [, mm, dd] = d.split('-')
              return `${parseInt(mm)}/${parseInt(dd)}`
            }
            // 加星期（依星期幾顯示）
            const fmtDow = d => {
              if (!d) return ''
              const dow = new Date(d + 'T00:00:00').getDay()
              return ['日','一','二','三','四','五','六'][dow]
            }

            return (
              <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-[11px] font-semibold text-emerald-500 uppercase tracking-widest">即時看板（精舍・多場次）</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-600">報名</span>
                    <span className="font-bold text-emerald-700 text-lg leading-none">{uniquePeople}</span>
                    <span className="text-xs text-gray-500">人（不重複）</span>
                    <span className="text-gray-300">│</span>
                    <span className="text-gray-600">合計</span>
                    <span className="font-bold text-emerald-700 text-lg leading-none">{totalAttendance}</span>
                    <span className="text-xs text-gray-500">人次</span>
                  </div>
                </div>

                {/* 車輛人次摘要（schema-driven：依 option_meta 把 parking_kind 欄位彙總） */}
                {parkingTotals.hasAny && (
                  <div className="inline-flex items-center gap-2 text-xs bg-white border border-emerald-200 rounded-lg px-3 py-1.5">
                    <span className="text-gray-500">車輛人次</span>
                    <span className="text-emerald-700 font-semibold">機車 {parkingTotals.motorcycle}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-emerald-700 font-semibold">汽車 {parkingTotals.car}</span>
                    <span className="text-gray-400 ml-1">（人次，跨場次同人會重複計）</span>
                  </div>
                )}

                {/* 每日卡片橫向排列 */}
                <div className="flex flex-wrap gap-2">
                  {dayEntries.map(([date, sessList]) => (
                    <div key={date} className="bg-white border border-emerald-200 rounded-lg px-3 py-2 shadow-sm min-w-[120px]">
                      <div className="text-xs font-semibold text-gray-700 mb-1">
                        {fmtMd(date)}（{fmtDow(date)}）
                      </div>
                      <div className="space-y-0.5">
                        {sessList.map(s => {
                          const b = bySession.get(s.session_id) ?? { count: 0 }
                          return (
                            <div key={s.session_id} className="flex items-baseline justify-between gap-2 text-xs">
                              <span className="text-gray-500">{timePeriodLabel(s.time_period)}</span>
                              <span>
                                <span className="font-bold text-emerald-700 text-sm">{b.count}</span>
                                <span className="text-gray-400 ml-0.5">人</span>
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 詳細統計表格（可摺疊，欄位依 event_session_fields 動態渲染） */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowSessionStatsDetail(v => !v)}
                    className="text-xs text-emerald-700 hover:text-emerald-900 font-medium inline-flex items-center gap-1"
                  >
                    <span>{showSessionStatsDetail ? '▾' : '▸'}</span>
                    詳細統計
                  </button>
                  {showSessionStatsDetail && (
                    <div className="mt-2 bg-white border border-emerald-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-emerald-100/60 text-emerald-900">
                          <tr>
                            <th className="text-left  px-3 py-1.5 font-medium whitespace-nowrap">場次</th>
                            <th className="text-right px-3 py-1.5 font-medium whitespace-nowrap">報名</th>
                            {cols.map(col => (
                              <th key={col.key} className="text-right px-3 py-1.5 font-medium whitespace-nowrap">
                                {col.label}
                                {col.parkingKind === 'motorcycle' && (
                                  <span className="ml-1 text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded px-1 font-normal align-middle">機車</span>
                                )}
                                {col.parkingKind === 'car' && (
                                  <span className="ml-1 text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded px-1 font-normal align-middle">汽車</span>
                                )}
                                {col.parkingKind === 'none' && (
                                  <span className="ml-1 text-[10px] bg-gray-100 text-gray-500 border border-gray-200 rounded px-1 font-normal align-middle">不算</span>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sessions.map(s => {
                            const b = bySession.get(s.session_id) ?? { count: 0, stats: {} }
                            return (
                              <tr key={s.session_id} className="border-t border-emerald-100">
                                <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                                  {fmtMd(s.date)} {timePeriodLabel(s.time_period)}
                                  {s.dharma_name && <span className="text-gray-400 ml-1">· {s.dharma_name}</span>}
                                </td>
                                <td className="px-3 py-1.5 text-right font-medium text-emerald-700">{b.count}</td>
                                {cols.map(col => {
                                  const v = cellValueFor(s, col, b)
                                  return (
                                    <td key={col.key} className="px-3 py-1.5 text-right text-gray-700">
                                      {v === null ? <span className="text-gray-300">—</span> : v}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                          <tr className="border-t-2 border-emerald-300 bg-emerald-50/50 font-semibold">
                            <td className="px-3 py-1.5 text-gray-700">合計</td>
                            <td className="px-3 py-1.5 text-right text-emerald-700">{sumCount}</td>
                            {cols.map(col => {
                              const agg = sumByCol.get(col.key)
                              return (
                                <td key={col.key} className="px-3 py-1.5 text-right text-gray-700">
                                  {agg?.anyApplicable ? agg.sum : <span className="text-gray-300">—</span>}
                                </td>
                              )
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* 即時看板（精舍版・單場） */}
          {registrations.length > 0 && event?.event_type === 'temple' && !event?.multi_session && (() => {
            const { identityField, identityCounts, hasLunch, lunchCount, hasParking, motorcycle, car, specializedKeys } =
              computeTempleStats(registrations, fields)
            const hasIdentity = !!identityField && Object.keys(identityCounts).length > 0
            // 未被特化的 radio/boolean 欄位 → generic chip 區
            const genericStats = computeGenericRadioStats(registrations, fields, specializedKeys)
            if (!hasIdentity && !hasLunch && !hasParking && genericStats.length === 0) return null

            const identityOptions = identityField?.options ?? []
            const sortedIdentities = [
              ...identityOptions.filter(o => identityCounts[o] !== undefined),
              ...Object.keys(identityCounts).filter(k => !identityOptions.includes(k)),
            ]

            return (
              <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 space-y-2.5">
                <p className="text-[11px] font-semibold text-emerald-500 uppercase tracking-widest">即時看板（精舍）</p>

                {/* 身份別人數 */}
                {hasIdentity && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 shrink-0 w-14">身份</span>
                    <div className="flex flex-wrap gap-2">
                      {sortedIdentities.map(val => (
                        <span key={val} className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm">
                          <span className="text-xs text-gray-600">{val}</span>
                          <span className="text-sm font-bold text-emerald-700 leading-none">{identityCounts[val]}</span>
                          <span className="text-xs text-gray-400">人</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 午齋 */}
                {hasLunch && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 shrink-0 w-14">午齋</span>
                    <span className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm">
                      <span className="text-xs text-gray-500">需要</span>
                      <span className="text-sm font-bold text-amber-600 leading-none">{lunchCount}</span>
                      <span className="text-xs text-gray-400">份</span>
                    </span>
                  </div>
                )}

                {/* 停車（機車、轎車） */}
                {hasParking && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 shrink-0 w-14">停車</span>
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm">
                        <span className="text-xs text-gray-500">機車</span>
                        <span className="text-sm font-bold text-blue-700 leading-none">{motorcycle}</span>
                        <span className="text-xs text-gray-400">輛</span>
                      </span>
                      <span className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm">
                        <span className="text-xs text-gray-500">轎車</span>
                        <span className="text-sm font-bold text-indigo-700 leading-none">{car}</span>
                        <span className="text-xs text-gray-400">輛</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* Generic：其他 radio / boolean 欄位的選項分佈（未被特化的全部自動列出） */}
                {genericStats.map(({ field: gf, counts }) => {
                  const ordered = [
                    ...(gf.options || []).filter(o => counts[o] !== undefined),
                    ...Object.keys(counts).filter(k => !(gf.options || []).includes(k)),
                  ]
                  return (
                    <div key={gf.field_key} className="flex items-start gap-2 flex-wrap">
                      <span
                        className="text-xs text-gray-500 shrink-0 w-14 mt-1.5 truncate"
                        title={gf.field_label}
                      >
                        {gf.field_label}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {ordered.map(val => (
                          <span key={val} className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm">
                            <span className="text-xs text-gray-600">{val}</span>
                            <span className="text-sm font-bold text-emerald-700 leading-none">{counts[val]}</span>
                            <span className="text-xs text-gray-400">人</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* 即時看板（回山版） */}
          {registrations.length > 0 && event?.event_type !== 'temple' && (() => {
            const { identityField, identityCounts, upStats, downStats, hasUp, hasDown, preceptStats } =
              computeDashboardStats(registrations, fields)
            const hasIdentity = !!identityField && Object.keys(identityCounts).length > 0
            const hasPrecept  = preceptStats.total > 0
            if (!hasIdentity && !hasUp && !hasDown && !hasPrecept) return null

            // 身份選項依後台定義排序
            const identityOptions = identityField?.options ?? []
            const sortedIdentities = [
              ...identityOptions.filter(o => identityCounts[o] !== undefined),
              ...Object.keys(identityCounts).filter(k => !identityOptions.includes(k)),
            ]

            // 渲染單一方向交通列（上山 or 下山）
            function TransportRow({ label, stats }) {
              const hasData = Object.values(stats.total).some(v => v > 0)
              if (!hasData) return null

              // 依身份排序的 byIdentity 列表
              const identityKeys = sortedIdentities.filter(id => stats.byIdentity[id])
              const useByIdentity = identityField && identityKeys.length > 0

              return (
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-xs text-gray-500 shrink-0 mt-1 w-20">{label}</span>
                  <div className="flex flex-wrap gap-2">
                    {useByIdentity ? (
                      identityKeys.map(id => {
                        const t = stats.byIdentity[id]
                        const big = t.大車, small = t.小車, other = t.其他
                        return (
                          <div key={id} className="flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1 shadow-sm">
                            <span className="text-xs text-gray-500 mr-1">{id}</span>
                            {big > 0   && <><span className="text-xs text-gray-500">大車</span><span className="text-xs font-bold text-amber-600 ml-0.5">{big}</span></>}
                            {small > 0 && <><span className={`text-xs text-gray-500 ${big > 0 ? 'ml-1.5' : ''}`}>小車</span><span className="text-xs font-bold text-green-700 ml-0.5">{small}</span></>}
                            {other > 0 && <><span className={`text-xs text-gray-500 ${(big+small) > 0 ? 'ml-1.5' : ''}`}>其他</span><span className="text-xs font-bold text-gray-500 ml-0.5">{other}</span></>}
                          </div>
                        )
                      })
                    ) : (
                      <>
                        {stats.total.大車 > 0 && <span className="inline-flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1 shadow-sm"><span className="text-xs text-gray-500">大車</span><span className="text-xs font-bold text-amber-600">{stats.total.大車}</span><span className="text-xs text-gray-400">人</span></span>}
                        {stats.total.小車 > 0 && <span className="inline-flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1 shadow-sm"><span className="text-xs text-gray-500">小車</span><span className="text-xs font-bold text-green-700">{stats.total.小車}</span><span className="text-xs text-gray-400">人</span></span>}
                        {stats.total.其他 > 0 && <span className="inline-flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1 shadow-sm"><span className="text-xs text-gray-500">其他</span><span className="text-xs font-bold text-gray-500">{stats.total.其他}</span><span className="text-xs text-gray-400">人</span></span>}
                      </>
                    )}
                  </div>
                </div>
              )
            }

            return (
              <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 space-y-2.5">
                <p className="text-[11px] font-semibold text-blue-400 uppercase tracking-widest">即時看板</p>

                {/* 身份別人數 */}
                {hasIdentity && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 shrink-0 w-20">身份</span>
                    <div className="flex flex-wrap gap-2">
                      {sortedIdentities.map(val => (
                        <span key={val} className="inline-flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1 shadow-sm">
                          <span className="text-xs text-gray-600">{val}</span>
                          <span className="text-sm font-bold text-blue-700 leading-none">{identityCounts[val]}</span>
                          <span className="text-xs text-gray-400">人</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 三皈五戒（三個數字互斥；活動有相關欄位且 total>0 才出現） */}
                {hasPrecept && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 shrink-0 w-20">三皈五戒</span>
                    <div className="flex flex-wrap gap-2">
                      {preceptStats.refugeOnly > 0 && (
                        <span
                          title="只受三皈（未同時受五戒）"
                          className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm"
                        >
                          <span className="text-xs text-emerald-700">三皈</span>
                          <span className="text-sm font-bold text-emerald-700 leading-none">{preceptStats.refugeOnly}</span>
                          <span className="text-xs text-gray-400">人</span>
                        </span>
                      )}
                      {preceptStats.fiveOnly > 0 && (
                        <span
                          title="只受五戒（未同時受三皈）"
                          className="inline-flex items-center gap-1 bg-white border border-purple-200 rounded-lg px-2.5 py-1 shadow-sm"
                        >
                          <span className="text-xs text-purple-700">五戒</span>
                          <span className="text-sm font-bold text-purple-700 leading-none">{preceptStats.fiveOnly}</span>
                          <span className="text-xs text-gray-400">人</span>
                        </span>
                      )}
                      {preceptStats.both > 0 && (
                        <span
                          title="同時受三皈與五戒"
                          className="inline-flex items-center gap-1 bg-white border border-indigo-200 rounded-lg px-2.5 py-1 shadow-sm"
                        >
                          <span className="text-xs text-emerald-700">三皈</span>
                          <span className="text-xs text-gray-400">、</span>
                          <span className="text-xs text-purple-700">五戒</span>
                          <span className="text-xs text-indigo-700">同受</span>
                          <span className="text-sm font-bold text-indigo-700 leading-none ml-0.5">{preceptStats.both}</span>
                          <span className="text-xs text-gray-400">人</span>
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* 交通（上山 / 下山） */}
                {hasUp   && <TransportRow label="上山" stats={upStats}   />}
                {hasDown && <TransportRow label="下山" stats={downStats} />}
              </div>
            )
          })()}

          {/* 搜尋列 */}
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <input
                value={listSearch}
                onChange={e => setListSearch(e.target.value)}
                placeholder="🔍 搜尋姓名、學員編號、班級或答案…"
                className="w-full pl-3 pr-9 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              {listSearch && (
                <button
                  onClick={() => setListSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-base leading-none w-5 h-5 flex items-center justify-center"
                  title="清除"
                >×</button>
              )}
            </div>
            {listSearch && (
              <span className="text-xs text-gray-500">
                找到 {searchedRegistrations.length} 筆
              </span>
            )}
          </div>

          {/* 工具列 */}
          <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-gray-500">
                共 {registrations.length} 筆報名
                {event?.multi_session && sessionTab !== 'all' && (
                  <span className="text-amber-700">（本場次：{sessionFilteredRegistrations.length}）</span>
                )}
                {listSearch && <span className="text-amber-700">（搜尋中：{sortedRegistrations.length}）</span>}
              </p>
              {hasGuests && selectedGuestIds.size > 0 && (
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  已選 {selectedGuestIds.size} 位訪客
                </span>
              )}
              {/* 欄位顯隱切換 */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-400">顯示欄位：</span>
                {[
                  { key: 'checkin', label: '報到', val: showCheckin, set: setShowCheckin },
                  { key: 'regtime', label: '更新時間', val: showRegTime, set: setShowRegTime },
                ].map(col => (
                  <button
                    key={col.key}
                    onClick={() => col.set(v => !v)}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      col.val
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {col.val ? '✓ ' : ''}{col.label}
                  </button>
                ))}
                {/* 動態欄位 toggle（多場次模式下表格內容是場次而非 event_fields，不顯示） */}
                {!event?.multi_session && (() => {
                  // 動態欄位分類（互斥，依序判斷）：
                  //   - pinned：身分別（固定顯示、不在切換清單）
                  //   - volunteer：show_if 指向身分別=義工（合併成「義工相關」鈕）
                  //   - up：label 含「上山／山上」（合併成「上山交通」鈕）
                  //   - down：label 含「下山／山下」（合併成「下山交通」鈕）
                  //   - generic：其他（每欄一顆獨立鈕）
                  const nonPinned       = fields.filter(f => !pinnedFieldKeys.has(f.field_key))
                  const volunteerFields = nonPinned.filter(isVolunteerField)
                  const upFields        = nonPinned.filter(f => !isVolunteerField(f) && isUpField(f))
                  const downFields      = nonPinned.filter(f => !isVolunteerField(f) && !isUpField(f) && isDownField(f))
                  const genericFields   = nonPinned.filter(f => !isVolunteerField(f) && !isUpField(f) && !isDownField(f))

                  const renderGroup = (groupFields, label, color) => {
                    if (groupFields.length === 0) return null
                    const keys = groupFields.map(f => f.field_key)
                    const allHidden = keys.every(k => hiddenFieldKeys.has(k))
                    const palettes = {
                      purple: ['bg-purple-100 text-purple-800 border-purple-300'],
                      blue:   ['bg-blue-100 text-blue-800 border-blue-300'],
                      teal:   ['bg-teal-100 text-teal-800 border-teal-300'],
                    }
                    const onCls = palettes[color]?.[0] ?? 'bg-amber-100 text-amber-800 border-amber-300'
                    return (
                      <button
                        onClick={() => toggleFieldGroup(keys)}
                        title={`${label}：${groupFields.map(f => f.field_label).join('、')}`}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                          !allHidden ? onCls : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {!allHidden ? '✓ ' : ''}{label}
                      </button>
                    )
                  }

                  return (
                    <>
                      {renderGroup(volunteerFields, '義工相關', 'purple')}
                      {renderGroup(upFields,       '上山交通', 'blue')}
                      {renderGroup(downFields,     '下山交通', 'teal')}
                      {genericFields.map(f => {
                        const hidden = hiddenFieldKeys.has(f.field_key)
                        return (
                          <button
                            key={f.field_key}
                            onClick={() => toggleFieldKey(f.field_key)}
                            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                              !hidden
                                ? 'bg-amber-100 text-amber-800 border-amber-300'
                                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            {!hidden ? '✓ ' : ''}{f.field_label}
                          </button>
                        )
                      })}
                    </>
                  )
                })()}
              </div>
            </div>
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                {/* 批次列印按鈕（有選取時才顯示）*/}
                {selectedGuestIds.size > 0 && (
                  <button
                    onClick={() => setBatchPrintOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    🖨️ 批次列印（{selectedGuestIds.size}）
                  </button>
                )}
                <button
                  onClick={() => setStudentModal(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  title="從學員清單選人補登報名（不必刷學員證）"
                >
                  ＋ 新增學員報名
                </button>
                <button
                  onClick={() => setGuestModal(true)}
                  className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  ＋ 新增訪客
                </button>
                {/* 多場次：場次視圖 → 場次 CSV */}
                {event?.multi_session && sessionTab !== 'all' && sessionFilteredRegistrations.length > 0 && (() => {
                  const curS = sessions.find(s => s.session_id === sessionTab)
                  return (
                    <button
                      onClick={() => exportSessionCSV(sortedRegistrations, curS, event, sessionFields)}
                      className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      ⬇️ 匯出本場次 CSV
                    </button>
                  )
                })()}
                {/* 全部 CSV（非多場次，或多場次全部視圖）*/}
                {(!event?.multi_session || sessionTab === 'all') && registrations.length > 0 && (
                  <button
                    onClick={async () => {
                      exportCSV(registrations, fields, event)
                      await recordExportTime(id)
                      const now = new Date().toISOString()
                      setEvent(ev => ({ ...ev, last_exported_at: now }))
                    }}
                    className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    ⬇️ 匯出 CSV
                  </button>
                )}
              </div>
            )}
          </div>

          {registrations.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-12">尚無報名紀錄</p>
          ) : (
            <div className="w-full bg-white rounded-xl border border-gray-200 overflow-auto max-h-[calc(100vh-300px)]">
              <table className="w-full min-w-max text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {/* 訪客 checkbox 欄（有訪客且是管理員才顯示） */}
                    {isAdmin && hasGuests && (
                      <th className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={allGuestsSelected}
                          onChange={toggleSelectAllGuests}
                          title="全選訪客"
                          className="accent-amber-600 cursor-pointer w-4 h-4"
                        />
                      </th>
                    )}
                    <SortTh label="學員編號" colKey="student_id" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh
                      label="姓名"
                      colKey="name"
                      current={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                      className="sticky left-0 z-20 bg-gray-50 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.08)]"
                    />
                    {/* 一般動態欄位（非多場次）*/}
                    {!event?.multi_session && fields.filter(f => !hiddenFieldKeys.has(f.field_key)).map(f => (
                      <SortTh
                        key={f.field_id ?? f.field_key}
                        label={f.field_label}
                        colKey={`field:${f.field_key}`}
                        current={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                      />
                    ))}
                    {/* 多場次：全部視圖 → 場次欄；場次視圖 → 午齋/停車 */}
                    {event?.multi_session && sessionTab === 'all' && (
                      <th className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">參加場次</th>
                    )}
                    {event?.multi_session && sessionTab !== 'all' && (() => {
                      const curS = sessions.find(s => s.session_id === sessionTab)
                      if (!curS) return null
                      const fieldsHere = sessionFieldsForPeriod(sessionFields, curS.time_period)
                      return <>
                        {fieldsHere.map(f => (
                          <th key={f.field_key} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                            {f.field_label}
                          </th>
                        ))}
                      </>
                    })()}
                    {showCheckin && <SortTh label="報到" colKey="checked_in_at" current={sortKey} dir={sortDir} onSort={handleSort} />}
                    {showRegTime && <SortTh label="更新時間" colKey="updated_at" current={sortKey} dir={sortDir} onSort={handleSort} />}
                    <th className="sticky right-0 z-20 bg-gray-50 px-3 py-2 shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.08)]" />
                  </tr>
                </thead>
                <tbody>
                  {sortedRegistrations.map(r => {
                    const isGuest = !r.student_id
                    const isSelected = isGuest && selectedGuestIds.has(r.registration_id)
                    return (
                      <tr
                        key={r.registration_id}
                        className={`border-b border-gray-50 transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-amber-50/30'
                        }`}
                      >
                        {/* Checkbox（有訪客且是管理員才顯示此欄） */}
                        {isAdmin && hasGuests && (
                          <td className="px-3 py-1.5 text-center">
                            {isGuest && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleGuestSelect(r.registration_id)}
                                className="accent-amber-600 cursor-pointer w-4 h-4"
                              />
                            )}
                          </td>
                        )}
                        <td className="px-3 py-1.5 font-mono text-xs text-gray-500">
                          {r.student_id ?? (
                            <button
                              onClick={() => setQrModal({ registrationId: r.registration_id, name: getDisplayName(r) })}
                              className="text-amber-600 font-sans hover:text-amber-800 hover:underline"
                              title="點擊查看 QR code"
                            >
                              訪客 🔍
                            </button>
                          )}
                        </td>
                        <td className={`px-3 py-1.5 font-medium sticky left-0 z-[1] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)] ${isSelected ? 'bg-blue-50' : 'bg-white'}`}>
                          <span className="flex items-center gap-1.5 flex-wrap">
                            {getDisplayName(r)}
                            {r.source === 'walkin' && (
                              <span
                                className="text-xs bg-rose-100 text-rose-700 border border-rose-300 px-1.5 py-0.5 rounded-full font-normal leading-none"
                                title="刷卡時不在名單上，於報到頁現場補報"
                              >現場</span>
                            )}
                            {newRegIds.has(r.registration_id) && (
                              <span className="text-xs bg-green-100 text-green-700 border border-green-300 px-1.5 py-0.5 rounded-full font-normal leading-none">新</span>
                            )}
                            {modifiedRegIds.has(r.registration_id) && (
                              <button
                                onClick={() => {
                                  const latest = changes.find(c =>
                                    c.registration_id === r.registration_id && c.change_type === 'modified'
                                  )
                                  if (latest) setDiffModal(latest)
                                }}
                                className="text-xs bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded-full font-normal leading-none hover:bg-amber-200 cursor-pointer"
                                title="點擊查看修改明細"
                              >
                                改 🔍
                              </button>
                            )}
                          </span>
                        </td>
                        {/* 一般動態欄位（非多場次）*/}
                        {!event?.multi_session && fields.filter(f => !hiddenFieldKeys.has(f.field_key)).map(f => (
                          <td key={f.field_id} className="px-3 py-1.5 text-gray-700">
                            {formatFieldValue(f, r.answers?.[f.field_key])}
                          </td>
                        ))}
                        {/* 多場次：全部視圖 → 場次 badge 列 */}
                        {event?.multi_session && sessionTab === 'all' && (
                          <td className="px-3 py-1.5">
                            <div className="flex flex-wrap gap-1">
                              {(r.answers?.sessions ?? []).map(ss => {
                                const s = sessions.find(x => x.session_id === ss.session_id)
                                if (!s) return null
                                return (
                                  <span
                                    key={ss.session_id}
                                    title={s.dharma_name ?? ''}
                                    className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                  >
                                    {formatSessionTabLabel(s)}
                                  </span>
                                )
                              })}
                            </div>
                          </td>
                        )}
                        {/* 多場次：場次視圖 → 該場次子欄位（依 event_session_fields 動態渲染） */}
                        {event?.multi_session && sessionTab !== 'all' && (() => {
                          const curS = sessions.find(s => s.session_id === sessionTab)
                          if (!curS) return null
                          const fieldsHere = sessionFieldsForPeriod(sessionFields, curS.time_period)
                          const ssAns = r.answers?.sessions?.find(ss => ss.session_id === sessionTab) ?? {}
                          return <>
                            {fieldsHere.map(f => (
                              <td key={f.field_key} className="px-3 py-1.5 text-sm text-gray-700">
                                {formatSessionAnswer(f, resolveSessionAns(f, ssAns))}
                              </td>
                            ))}
                          </>
                        })()}
                        {showCheckin && (() => {
                          const chk = effectiveCheckinAt(r)
                          return (
                            <td className="px-3 py-1.5">
                              {chk ? (
                                <span className="text-green-600 text-xs font-medium" title={new Date(chk).toLocaleString('zh-TW', { hour12: false })}>
                                  ✓ {new Date(chk).toLocaleTimeString('zh-TW', { hour12: false }).slice(0, 5)}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>
                          )
                        })()}
                        {showRegTime && (
                          <td className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap">
                            {(r.updated_at ?? r.registered_at)
                              ? new Date(r.updated_at ?? r.registered_at).toLocaleString('zh-TW', { hour12: false })
                              : '-'}
                          </td>
                        )}
                        <td className={`px-3 py-1.5 text-right sticky right-0 z-[1] shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.06)] ${isSelected ? 'bg-blue-50' : 'bg-white'}`}>
                          {isAdmin && (
                            <div className="flex gap-2 justify-end">
                              {effectiveCheckinAt(r) && (
                                <button
                                  onClick={() => handleUncheckIn(r.registration_id, getDisplayName(r))}
                                  className="text-xs text-orange-500 hover:text-orange-700 border border-orange-200 hover:border-orange-400 px-2 py-1 rounded transition-colors"
                                >
                                  取消報到
                                </button>
                              )}
                              <button
                                onClick={() => setEditingReg(r)}
                                className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-2 py-1 rounded transition-colors"
                              >
                                ✏️ 編輯
                              </button>
                              <button
                                onClick={() => handleDeleteRegistration(r.registration_id, getDisplayName(r))}
                                className="text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-2 py-1 rounded transition-colors"
                              >
                                取消報名
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 已取消區塊（永遠顯示，不受匯出基準限制） */}
          {cancelledChanges.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowCancelled(v => !v)}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <span>{showCancelled ? '▼' : '▶'}</span>
                <span>已取消（共 {cancelledChanges.length} 筆）</span>
              </button>
              {showCancelled && (
                <div className="mt-2 bg-gray-50 rounded-xl border border-gray-200 overflow-auto">
                  <table className="w-full min-w-max text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-100">
                        <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">姓名</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">取消時間</th>                        {fields.map(f => (
                          <th key={f.field_id ?? f.field_key} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">
                            {f.field_label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cancelledChanges.map(c => (
                        <tr key={c.id} className="border-b border-gray-100 text-gray-400">
                          <td className="px-3 py-1.5 line-through whitespace-nowrap">{c.student_name}</td>
                          <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                            {new Date(c.changed_at).toLocaleString('zh-TW', { hour12: false })}
                          </td>
                          {fields.map(f => (
                            <td key={f.field_id ?? f.field_key} className="px-3 py-1.5">
                              {formatFieldValue(f, c.old_answers?.[f.field_key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  )
}
