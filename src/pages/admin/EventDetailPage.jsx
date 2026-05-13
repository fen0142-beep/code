import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import AdminLayout from '../../components/AdminLayout'
import DynamicForm from '../../components/DynamicForm'
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
  createGuestRegistration,
  updateRegistration,
  uncheckIn,
  logRegistrationChange,
  getEventChanges,
  recordExportTime,
  getVolunteers,
  getEventVolunteers,
  setEventVolunteers,
  getTemplates,
} from '../../lib/supabase'

const STATUS_LABEL = { draft: '草稿', active: '進行中', closed: '已關閉' }

// ── 欄位值格式化 ────────────────────────────────────────────
function formatFieldValue(field, val) {
  if (val === undefined || val === null || val === '') return '-'
  if (field.field_type === 'boolean') return val === true ? '✓ 是' : '✗ 否'
  if (Array.isArray(val)) return val.join('、')
  if (field.field_type === 'datetime' && typeof val === 'string' && val.includes('T')) {
    const [date, time] = val.split('T')
    return `${date.replaceAll('-', '/')} ${time.slice(0, 5)}`
  }
  if (field.field_type === 'date' && typeof val === 'string') {
    return val.replaceAll('-', '/')
  }
  return val
}

// ── 活動日期格式化 ──────────────────────────────────────────
function formatEventDate(ev) {
  if (!ev?.date_start) return ''
  const fmt = d => d.replaceAll('-', '/')
  if (!ev.date_end || ev.date_end === ev.date_start) return fmt(ev.date_start)
  return `${fmt(ev.date_start)} ～ ${fmt(ev.date_end)}`
}

// ── 顯示名稱（學員或訪客）────────────────────────────────────
function getDisplayName(r) {
  if (r.students?.name) return r.students.name
  if (r.answers?.guest_name) return r.answers.guest_name
  return '-'
}

// ── 可排序表頭欄 ────────────────────────────────────────────
function SortTh({ label, colKey, current, dir, onSort, className = '' }) {
  const active = current === colKey
  return (
    <th
      onClick={() => onSort(colKey)}
      className={`text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:text-amber-700 hover:bg-amber-50/60 transition-colors ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs leading-none ${active ? 'text-amber-600' : 'text-gray-300'}`}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </span>
    </th>
  )
}

// ── CSV 匯出 ───────────────────────────────────────────────
function exportCSV(registrations, fields, event) {
  const answerHeaders = fields.map(f => f.field_label)
  const header = ['學員編號', '姓名', '更新時間', '報到時間', ...answerHeaders]

  const rows = registrations.map(r => {
    const name = getDisplayName(r)
    // 名單時間以最後更新為準（INSERT 與後續編輯都會推進 updated_at）
    const stamp = r.updated_at ?? r.registered_at
    const regAt = stamp ? new Date(stamp).toLocaleString('zh-TW') : ''
    const checkinAt = r.checked_in_at ? new Date(r.checked_in_at).toLocaleString('zh-TW') : ''
    const answerCols = fields.map(f => {
      const val = r.answers?.[f.field_key]
      const formatted = formatFieldValue(f, val)
      return formatted === '-' ? '' : formatted
    })
    return [r.student_id ?? '訪客', name, regAt, checkinAt, ...answerCols]
  })

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  // 組合檔名：民國年 + 活動名稱（去掉開頭西元年）+ 學員報名資料 + MMDD
  const eventName = (event?.name ?? '活動').replace(/^\d{4}\s*/, '')
  const dateBase = event?.date_start ?? new Date().toISOString().slice(0, 10)
  const rocYear = parseInt(dateBase.slice(0, 4)) - 1911
  const mmdd = dateBase.replace(/-/g, '').slice(4) // "20260428" → "0428"
  const filename = `${rocYear}年${eventName}學員報名資料${mmdd}.csv`

  const bom = '\uFEFF'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── 即時看板統計 ──────────────────────────────────────────────
// 大車：包含「精舍」字樣（搭精舍車、精舍搭車 等）
const BIG_CAR_KEYS = ['精舍']
const SMALL_CAR_KEYS = ['自行開車', '搭學員']

function classifyTransport(val) {
  if (!val) return null
  if (BIG_CAR_KEYS.some(k => val.includes(k))) return '大車'
  if (SMALL_CAR_KEYS.some(k => val.includes(k))) return '小車'
  return '其他'
}

// 統計單一交通欄位，回傳 { byIdentity, total }
function computeTransportStats(regs, field, identityField) {
  const byIdentity = {}
  const total = { 大車: 0, 小車: 0, 其他: 0 }
  if (!field) return { byIdentity, total }
  for (const r of regs) {
    const category = classifyTransport(r.answers?.[field.field_key])
    if (!category) continue
    total[category]++
    if (identityField) {
      const identity = r.answers?.[identityField.field_key] ?? '未填'
      if (!byIdentity[identity]) byIdentity[identity] = { 大車: 0, 小車: 0, 其他: 0 }
      byIdentity[identity][category]++
    }
  }
  return { byIdentity, total }
}

function computeDashboardStats(regs, fields) {
  const identityField = fields.find(f => f.field_key === 'identity')
  const upField   = fields.find(f => f.field_key === 'transport_up')
                 ?? fields.find(f => f.field_key === 'transport')
  const downField = fields.find(f => f.field_key === 'transport_down')

  // 身份別總人數
  const identityCounts = {}
  if (identityField) {
    for (const r of regs) {
      const val = r.answers?.[identityField.field_key]
      if (val) identityCounts[val] = (identityCounts[val] || 0) + 1
    }
  }

  return {
    identityField,
    identityCounts,
    upStats:   computeTransportStats(regs, upField,   identityField),
    downStats: computeTransportStats(regs, downField, identityField),
    hasUp:   !!upField,
    hasDown: !!downField,
  }
}

// 精舍活動：午齋 / 停車（機車、轎車）統計
//
// 停車輛數的計算方式（車號去重模式）：
// - 若欄位定義中有 plate 型別欄位、且名單中有任何人填了車號
//   → 進入「車號去重」模式：以車號為單位 group by，每個獨特車號算 1 台
//   → 同車號的其他人視為共乘者（不重複計）
// - 沒填車號但選了機車／轎車的人 → 視為各自一台（向下相容、避免漏算）
// - 完全沒 plate 欄位（舊活動）→ 退回單純計人頭模式
//
// 車號標準化：大寫 + 移除空白與連字號（避免 "ABC-1234" 和 "abc 1234" 算成兩台）
function normalizePlate(s) {
  return String(s || '').trim().toUpperCase().replace(/[\s\-－—]/g, '')
}

function computeTempleStats(regs, fields) {
  const identityField = fields.find(f => f.field_key === 'identity')
  const lunchField    = fields.find(f => f.field_key === 'need_lunch')
  const parkingField  = fields.find(f => f.field_key === 'parking_type')
  const plateFields   = fields.filter(f => f.field_type === 'plate')

  const identityCounts = {}
  if (identityField) {
    for (const r of regs) {
      const val = r.answers?.[identityField.field_key]
      if (val) identityCounts[val] = (identityCounts[val] || 0) + 1
    }
  }

  // 偵測是否啟用車號去重模式
  const platesEnabled = plateFields.length > 0 && regs.some(r =>
    plateFields.some(pf => {
      const v = r.answers?.[pf.field_key]
      return v && String(v).trim() !== ''
    })
  )

  let lunchCount = 0
  let motorcycle = 0
  let car = 0
  const seenPlates = new Set()   // 已計入的標準化車號

  for (const r of regs) {
    if (lunchField && r.answers?.[lunchField.field_key] === true) lunchCount++
    if (!parkingField) continue

    const val = r.answers?.[parkingField.field_key]
    if (val !== '機車' && val !== '轎車') continue   // 「跟 OOO 同車」或未填都跳過

    if (platesEnabled) {
      // 找第一個非空的車號欄位
      let plate = ''
      for (const pf of plateFields) {
        const v = r.answers?.[pf.field_key]
        if (v && String(v).trim()) { plate = normalizePlate(v); break }
      }
      if (plate) {
        if (seenPlates.has(plate)) continue   // 同車號已計入 → 共乘者，跳過
        seenPlates.add(plate)
      }
      // plate 空（沒填車號）→ 維持「視為一台」的舊行為
    }

    if (val === '機車') motorcycle++
    else if (val === '轎車') car++
  }

  return {
    identityField, identityCounts,
    hasLunch: !!lunchField, lunchCount,
    hasParking: !!parkingField, motorcycle, car,
    plateDedup: platesEnabled,
  }
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

  // 報名名單搜尋
  const [listSearch, setListSearch] = useState('')

  // 欄位顯隱切換
  const [showCheckin, setShowCheckin] = useState(false)
  const [showRegTime, setShowRegTime] = useState(false)
  const [hiddenFieldKeys, setHiddenFieldKeys] = useState(new Set())

  // 交通相關欄位群組
  const FIELD_GROUPS = [
    { key: 'time',   label: '時間',    keys: ['arrive_time', 'leave_time'] },
    { key: 'up',     label: '上山交通', keys: ['transport_up', 'carpool_up', 'plate_up'] },
    { key: 'down',   label: '下山交通', keys: ['transport_down', 'carpool_down', 'plate_down'] },
  ]

  function toggleFieldGroup(keys) {
    setHiddenFieldKeys(prev => {
      const next = new Set(prev)
      // 若群組內任一欄位已顯示 → 全部隱藏；若全部已隱藏 → 全部顯示
      const allHidden = keys.every(k => next.has(k))
      if (allHidden) { keys.forEach(k => next.delete(k)) }
      else           { keys.forEach(k => next.add(k)) }
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
  const [guestName, setGuestName] = useState('')
  const [guestAnswers, setGuestAnswers] = useState({})
  const [guestSaving, setGuestSaving] = useState(false)
  const [guestRegId, setGuestRegId] = useState(null)

  // 編輯報名 modal
  const [editModal, setEditModal] = useState(null) // null | { registration, isGuest }
  const [editAnswers, setEditAnswers] = useState({})
  const [editGuestName, setEditGuestName] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  function openEditModal(r) {
    setEditModal({ registration: r, isGuest: !r.student_id })
    setEditAnswers(r.answers ? { ...r.answers } : {})
    setEditGuestName(r.answers?.guest_name ?? '')
  }

  function closeEditModal() {
    setEditModal(null)
    setEditSaving(false)
  }

  async function handleEditSave() {
    if (!editModal) return
    setEditSaving(true)
    const { registration, isGuest } = editModal
    const oldAnswers = { ...registration.answers }
    const newAnswers = isGuest
      ? { ...editAnswers, guest_name: editGuestName.trim() }
      : { ...editAnswers }

    // 記錄異動（不阻斷主流程）
    await logRegistrationChange({
      registrationId: registration.registration_id,
      eventId: id,
      eventName: event.name,
      studentName: getDisplayName(registration),
      changeType: 'modified',
      oldAnswers,
      newAnswers,
    })

    const { success, error } = await updateRegistration(registration.registration_id, newAnswers)
    setEditSaving(false)
    if (!success) { alert(`儲存失敗：${error}`); return }
    setRegistrations(prev => prev.map(r =>
      r.registration_id === registration.registration_id
        ? { ...r, answers: newAnswers }
        : r
    ))
    // 重新載入異動紀錄，更新視覺標示
    const { changes: newChanges } = await getEventChanges(id)
    setChanges(newChanges)
    closeEditModal()
  }

  // 異動明細 modal
  const [diffModal, setDiffModal] = useState(null) // null | registration_changes row

  // 補看 QR code modal（單張）
  const [qrModal, setQrModal] = useState(null) // null | { registrationId, name }

  // 批次列印
  const [selectedGuestIds, setSelectedGuestIds] = useState(new Set())
  const [batchPrintOpen, setBatchPrintOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ events }, { fields: f }, { registrations: r }, { changes: c }, { volunteers: v }, { volunteerIds: va }, { templates: tmpl }] = await Promise.all([
      getAllEvents(),
      getEventFields(id),
      getRegistrationsWithStudents(id),
      getEventChanges(id),
      getVolunteers(),
      getEventVolunteers(id),
      getTemplates(),
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
    })
    setFields(f)
    setRegistrations(r)
    setChanges(c)
    setTemplates(tmpl || [])
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

  // 排序後的報名名單
  const sortedRegistrations = [...searchedRegistrations].sort((a, b) => {
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

  function openGuestModal() {
    setGuestName('')
    setGuestAnswers({})
    setGuestRegId(null)
    setGuestModal(true)
  }

  function closeGuestModal() {
    setGuestModal(false)
    setGuestRegId(null)
  }

  async function handleGuestSubmit(e) {
    e.preventDefault()
    if (!guestName.trim()) return
    setGuestSaving(true)
    const { registrationId, error } = await createGuestRegistration(id, guestName.trim(), guestAnswers)
    setGuestSaving(false)
    if (error) { alert(`新增失敗：${error}`); return }
    setGuestRegId(registrationId)

    // 記錄訪客新增
    await logRegistrationChange({
      registrationId,
      eventId: id,
      eventName: event.name,
      studentName: guestName.trim(),
      changeType: 'created',
      oldAnswers: null,
      newAnswers: { guest_name: guestName.trim(), ...guestAnswers },
    })

    await load()
  }

  async function handleUncheckIn(registrationId, studentName) {
    if (!window.confirm(`確定要取消「${studentName}」的報到嗎？`)) return
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
      {batchPrintOpen && (
        <>
          <style>{`
            @page { size: A4 portrait; margin: 2mm; }
            @media print {
              body * { visibility: hidden !important; }
              .batch-print-cards, .batch-print-cards * { visibility: visible !important; }
              .batch-print-overlay {
                position: static !important;
                background: transparent !important;
                overflow: visible !important;
                display: block !important;
                height: auto !important;
              }
              .batch-print-toolbar { display: none !important; }
              .batch-print-preview {
                overflow: visible !important;
                padding: 0 !important;
                flex: none !important;
              }
              .batch-print-cards {
                display: grid !important;
                grid-template-columns: repeat(4, 1fr) !important;
                gap: 2mm !important;
                max-width: none !important;
                margin: 0 !important;
                width: 100% !important;
              }
              .batch-print-card {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
              }
            }
          `}</style>
          <div className="batch-print-overlay fixed inset-0 z-50 flex flex-col bg-gray-100">
            {/* 頂部工具列 */}
            <div className="batch-print-toolbar bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 shrink-0 shadow-sm">
              <div>
                <h3 className="text-base font-bold text-gray-800">批次列印訪客通行證</h3>
                <p className="text-xs text-gray-400">共 {selectedGuestRegs.length} 張・一列 4 張・列印後沿虛線剪開，每人一張</p>
              </div>
              <div className="ml-auto flex gap-3">
                <button
                  onClick={() => window.print()}
                  className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                >
                  🖨️ 列印
                </button>
                <button
                  onClick={() => setBatchPrintOpen(false)}
                  className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                >
                  關閉
                </button>
              </div>
            </div>

            {/* 卡片預覽區 */}
            <div className="batch-print-preview flex-1 overflow-auto p-3">
              <div
                className="batch-print-cards"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', maxWidth: '880px', margin: '0 auto' }}
              >
                {selectedGuestRegs.map(r => (
                  <div
                    key={r.registration_id}
                    className="batch-print-card"
                    style={{
                      border: '1px dashed #d1d5db',
                      borderRadius: '6px',
                      padding: '8px 8px',
                      textAlign: 'center',
                      background: 'white',
                      breakInside: 'avoid',
                      pageBreakInside: 'avoid',
                    }}
                  >
                    <p style={{ fontSize: '8px', color: '#9ca3af', letterSpacing: '2px', marginBottom: '4px', fontWeight: '600' }}>
                      普宜精舍
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '5px' }}>
                      <QRCodeSVG value={r.registration_id} size={110} />
                    </div>
                    <p style={{ fontSize: '13px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 2px' }}>
                      {getDisplayName(r)}
                    </p>
                    <p style={{ fontSize: '10px', color: '#4b5563', margin: '0 0 1px' }}>{event.name}</p>
                    {event.date_start && (
                      <p style={{ fontSize: '9px', color: '#6b7280', margin: 0 }}>{formatEventDate(event)}</p>
                    )}
                    <p style={{ fontSize: '7px', color: '#d1d5db', marginTop: '4px' }}>
                      掃描此 QR code 即可報到
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── 異動明細 Modal ── */}
      {diffModal && (() => {
        const old = diffModal.old_answers ?? {}
        const next = diffModal.new_answers ?? {}
        // 取所有出現過的 key（union）
        const allKeys = Array.from(new Set([...Object.keys(old), ...Object.keys(next)]))
        // 依欄位定義順序排序（沒有定義的放最後）
        const sortedKeys = [
          ...fields.map(f => f.field_key).filter(k => allKeys.includes(k)),
          ...allKeys.filter(k => !fields.find(f => f.field_key === k)),
        ]
        const changedKeys = sortedKeys.filter(k => {
          const ov = old[k]; const nv = next[k]
          return JSON.stringify(ov) !== JSON.stringify(nv)
        })
        const unchangedKeys = sortedKeys.filter(k => !changedKeys.includes(k))

        function fmtVal(key, val) {
          if (val === undefined || val === null || val === '') return <span className="text-gray-300 italic">（空）</span>
          const fieldDef = fields.find(f => f.field_key === key)
          if (!fieldDef) return String(val)
          return formatFieldValue(fieldDef, val)
        }

        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-gray-100 px-6 pt-5 pb-4 rounded-t-2xl">
                <h3 className="text-lg font-bold text-gray-800">異動明細</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  <span className="font-medium">{diffModal.student_name}</span>
                  　{new Date(diffModal.changed_at).toLocaleString('zh-TW', { hour12: false })}
                </p>
              </div>
              <div className="px-6 py-4 space-y-4">
                {changedKeys.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">找不到差異資料</p>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">已修改的欄位（{changedKeys.length} 項）</p>
                    {changedKeys.map(key => {
                      const fieldDef = fields.find(f => f.field_key === key)
                      const label = fieldDef?.field_label ?? key
                      return (
                        <div key={key} className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                          <p className="text-xs font-semibold text-amber-800 mb-2">{label}</p>
                          <div className="flex items-start gap-2 text-sm">
                            <div className="flex-1 bg-red-50 border border-red-200 rounded-lg px-3 py-2 line-through text-red-700">
                              {fmtVal(key, old[key])}
                            </div>
                            <span className="text-gray-400 mt-2">→</span>
                            <div className="flex-1 bg-green-50 border border-green-300 rounded-lg px-3 py-2 font-medium text-green-800">
                              {fmtVal(key, next[key])}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
                {unchangedKeys.filter(k => k !== 'guest_name').length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-gray-400 cursor-pointer select-none hover:text-gray-600">
                      未修改的欄位（{unchangedKeys.filter(k => k !== 'guest_name').length} 項）
                    </summary>
                    <div className="mt-2 space-y-1">
                      {unchangedKeys.filter(k => k !== 'guest_name').map(key => {
                        const fieldDef = fields.find(f => f.field_key === key)
                        const label = fieldDef?.field_label ?? key
                        return (
                          <div key={key} className="flex items-center gap-2 text-xs text-gray-400 px-1">
                            <span className="w-28 shrink-0">{label}</span>
                            <span>{fmtVal(key, next[key])}</span>
                          </div>
                        )
                      })}
                    </div>
                  </details>
                )}
              </div>
              <div className="px-6 pb-5">
                <button
                  onClick={() => setDiffModal(null)}
                  className="w-full border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
                >
                  關閉
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 編輯報名 Modal ── */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-1">編輯報名內容</h3>
            <p className="text-sm text-gray-500 mb-4">
              {editModal.isGuest
                ? `訪客：${editModal.registration.answers?.guest_name ?? '-'}`
                : `學員：${editModal.registration.students?.name ?? '-'}（${editModal.registration.student_id}）`}
            </p>

            {/* 訪客才顯示姓名欄 */}
            {editModal.isGuest && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  姓名 <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  value={editGuestName}
                  onChange={e => setEditGuestName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            )}

            {fields.length > 0 && (
              <div className="mb-4">
                <DynamicForm fields={fields} answers={editAnswers} onChange={setEditAnswers} />
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={closeEditModal}
                className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                disabled={editSaving || (editModal.isGuest && !editGuestName.trim())}
                onClick={handleEditSave}
                className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50"
              >
                {editSaving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 補看 QR code Modal（單張）── */}
      {qrModal && (
        <>
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .qr-print-card, .qr-print-card * { visibility: visible; }
              .qr-print-card {
                position: fixed;
                top: 50%; left: 50%;
                transform: translate(-50%, -50%);
              }
            }
          `}</style>
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <p className="text-sm text-gray-400 mb-4">截圖或列印後交給訪客，報到時掃描即可</p>
              <div className="qr-print-card border-2 border-gray-200 rounded-xl p-5 mb-4 bg-white">
                <p className="text-sm font-semibold text-gray-400 tracking-widest mb-3">普宜精舍</p>
                <div className="flex justify-center mb-4">
                  <QRCodeSVG value={qrModal.registrationId} size={160} />
                </div>
                <p className="text-2xl font-bold text-gray-800 mb-1">{qrModal.name}</p>
                <p className="text-sm text-gray-600">{event.name}</p>
                {event.date_start && (
                  <p className="text-sm text-gray-500 mt-0.5">{formatEventDate(event)}</p>
                )}
                <p className="text-xs text-gray-300 mt-3">掃描此 QR code 即可報到</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => window.print()}
                  className="flex-1 border-2 border-amber-400 text-amber-700 hover:bg-amber-50 font-medium py-2.5 rounded-xl transition-colors"
                >
                  🖨️ 列印
                </button>
                <button
                  onClick={() => setQrModal(null)}
                  className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors"
                >
                  關閉
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── 訪客報名 Modal ── */}
      {guestModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            {guestRegId ? (
              <>
                <style>{`
                  @media print {
                    body * { visibility: hidden; }
                    .qr-print-card, .qr-print-card * { visibility: visible; }
                    .qr-print-card {
                      position: fixed;
                      top: 50%; left: 50%;
                      transform: translate(-50%, -50%);
                    }
                  }
                `}</style>
                <div className="text-center">
                  <div className="text-3xl mb-2">✅</div>
                  <p className="text-sm text-gray-400 mb-4">截圖或列印後交給訪客，報到時掃描即可</p>
                  <div className="qr-print-card border-2 border-gray-200 rounded-xl p-5 mb-4 bg-white">
                    <p className="text-sm font-semibold text-gray-400 tracking-widest mb-3">普宜精舍</p>
                    <div className="flex justify-center mb-4">
                      <QRCodeSVG value={guestRegId} size={160} />
                    </div>
                    <p className="text-2xl font-bold text-gray-800 mb-1">{guestName}</p>
                    <p className="text-sm text-gray-600">{event.name}</p>
                    {event.date_start && (
                      <p className="text-sm text-gray-500 mt-0.5">{formatEventDate(event)}</p>
                    )}
                    <p className="text-xs text-gray-300 mt-3">掃描此 QR code 即可報到</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => window.print()}
                      className="flex-1 border-2 border-amber-400 text-amber-700 hover:bg-amber-50 font-medium py-2.5 rounded-xl transition-colors"
                    >
                      🖨️ 列印
                    </button>
                    <button
                      onClick={closeGuestModal}
                      className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors"
                    >
                      關閉
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <form onSubmit={handleGuestSubmit}>
                <h3 className="text-lg font-bold text-gray-800 mb-4">新增訪客報名</h3>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-600 mb-1">
                    姓名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    value={guestName}
                    onChange={e => setGuestName(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="請輸入姓名"
                  />
                </div>
                {fields.length > 0 && (
                  <div className="mb-4">
                    <DynamicForm fields={fields} answers={guestAnswers} onChange={setGuestAnswers} />
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeGuestModal}
                    className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={guestSaving}
                    className="flex-1 bg-amber-700 hover:bg-amber-800 text-white font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {guestSaving ? '新增中…' : '確認報名'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 麵包屑 */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link to="/admin/events" className="hover:text-amber-700">活動管理</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">{event.name}</span>
      </div>

      {/* 標題列 */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800">{event.name}</h2>
        <Link
          to={`/admin/events/${id}/checkin`}
          className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          📋 現場報到
        </Link>
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
          </div>
          {/* （原本底部的儲存按鈕已移至頁面頂部 sticky bar） */}
        </form>

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
                  if (
                    fields.length === 0 ||
                    window.confirm(`套用「${tmpl.name}」後，目前設定的欄位將全部被取代。確定要繼續嗎？`)
                  ) {
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

          {/* 即時看板（精舍版） */}
          {registrations.length > 0 && event?.event_type === 'temple' && (() => {
            const { identityField, identityCounts, hasLunch, lunchCount, hasParking, motorcycle, car } =
              computeTempleStats(registrations, fields)
            const hasIdentity = !!identityField && Object.keys(identityCounts).length > 0
            if (!hasIdentity && !hasLunch && !hasParking) return null

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
              </div>
            )
          })()}

          {/* 即時看板（回山版） */}
          {registrations.length > 0 && event?.event_type !== 'temple' && (() => {
            const { identityField, identityCounts, upStats, downStats, hasUp, hasDown } =
              computeDashboardStats(registrations, fields)
            const hasIdentity = !!identityField && Object.keys(identityCounts).length > 0
            if (!hasIdentity && !hasUp && !hasDown) return null

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
                  <span className="text-xs text-gray-500 shrink-0 mt-1 w-14">{label}</span>
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
                    <span className="text-xs text-gray-500 shrink-0 w-14">身份</span>
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
                {listSearch && <span className="text-amber-700">（搜尋中：{searchedRegistrations.length}）</span>}
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
                {/* 交通欄位群組切換（有對應欄位才顯示） */}
                {FIELD_GROUPS.map(group => {
                  const exists = group.keys.some(k => fields.find(f => f.field_key === k))
                  if (!exists) return null
                  const allHidden = group.keys.every(k => hiddenFieldKeys.has(k))
                  return (
                    <button
                      key={group.key}
                      onClick={() => toggleFieldGroup(group.keys)}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                        !allHidden
                          ? 'bg-amber-100 text-amber-800 border-amber-300'
                          : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {!allHidden ? '✓ ' : ''}{group.label}
                    </button>
                  )
                })}
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
                  onClick={openGuestModal}
                  className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  ＋ 新增訪客
                </button>
                {registrations.length > 0 && (
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
                    {fields.filter(f => !hiddenFieldKeys.has(f.field_key)).map(f => (
                      <SortTh
                        key={f.field_id ?? f.field_key}
                        label={f.field_label}
                        colKey={`field:${f.field_key}`}
                        current={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                      />
                    ))}
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
                        {fields.filter(f => !hiddenFieldKeys.has(f.field_key)).map(f => (
                          <td key={f.field_id} className="px-3 py-1.5 text-gray-700">
                            {formatFieldValue(f, r.answers?.[f.field_key])}
                          </td>
                        ))}
                        {showCheckin && (
                          <td className="px-3 py-1.5">
                            {r.checked_in_at
                              ? <span className="text-green-600 text-xs font-medium">✓ 已報到</span>
                              : <span className="text-gray-300 text-xs">—</span>
                            }
                          </td>
                        )}
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
                              {r.checked_in_at && (
                                <button
                                  onClick={() => handleUncheckIn(r.registration_id, getDisplayName(r))}
                                  className="text-xs text-orange-500 hover:text-orange-700 border border-orange-200 hover:border-orange-400 px-2 py-1 rounded transition-colors"
                                >
                                  取消報到
                                </button>
                              )}
                              <button
                                onClick={() => openEditModal(r)}
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
                        <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">取消時間</th>
                        {fields.map(f => (
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
