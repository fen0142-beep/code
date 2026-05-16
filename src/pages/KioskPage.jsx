import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  getActiveEvents,
  getStudentById,
  getStudentEventStatuses,
  getFriendRegistrationsByHost,
  submitRegistration,
  updateRegistration,
  deleteRegistration,
  logRegistrationChange,
  submitFriendRegistration,
} from '../lib/supabase'
import DynamicForm from '../components/DynamicForm'
import CameraScanner from '../components/CameraScanner'
import { isDriverFromAnswers } from '../lib/registrationHelpers'

// ── QR 小卡（代報親友報到用）──────────────────────────────
// 把 DOM 中的 <svg> 載成 <img> 物件（內部用，給 canvas drawImage）
function loadSvgAsImage(svgId) {
  return new Promise((resolve, reject) => {
    const svg = document.getElementById(svgId)
    if (!svg) { reject(new Error('SVG not found')); return }
    const xml = new XMLSerializer().serializeToString(svg)
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = new Image()
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = err => { URL.revokeObjectURL(url); reject(err) }
    img.src = url
  })
}

// 格式化活動日期（同一天只顯示一個；跨日顯示「YYYY/MM/DD ～ YYYY/MM/DD」）
function formatEventDateRange(dateStart, dateEnd) {
  if (!dateStart) return ''
  const fmt = d => String(d).replaceAll('-', '/')
  if (!dateEnd || dateEnd === dateStart) return fmt(dateStart)
  return `${fmt(dateStart)} ～ ${fmt(dateEnd)}`
}

// 產出「QR 小卡」PNG Blob（600x800）— 仿後台訪客小卡樣式
// cardData: { svgId, name, eventName, eventDate, location? }
async function generateQRCardBlob({ svgId, name, eventName, eventDate, location }) {
  const W = 600
  const H = 800
  const canvas = document.createElement('canvas')
  canvas.width  = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // 白底
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  // 邊框
  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 3
  ctx.strokeRect(15, 15, W - 30, H - 30)

  ctx.textAlign = 'center'
  const fontFamily = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif'

  // 頂部「普宜精舍」
  ctx.fillStyle = '#9ca3af'
  ctx.font = `600 26px ${fontFamily}`
  ctx.fillText('普 宜 精 舍', W / 2, 70)
  // 副標
  ctx.fillStyle = '#a78bfa'
  ctx.font = `18px ${fontFamily}`
  ctx.fillText('— 親友代報・報到 QR Code —', W / 2, 100)

  // QR 圖
  const qrSize = 380
  const qrX = (W - qrSize) / 2
  const qrY = 130
  try {
    const img = await loadSvgAsImage(svgId)
    ctx.drawImage(img, qrX, qrY, qrSize, qrSize)
  } catch (e) {
    console.warn('[generateQRCardBlob] svg load failed:', e)
    ctx.fillStyle = '#fee2e2'
    ctx.fillRect(qrX, qrY, qrSize, qrSize)
  }

  // 姓名（紫色大字）
  ctx.fillStyle = '#1f2937'
  ctx.font = `bold 40px ${fontFamily}`
  ctx.fillText(name || '訪客', W / 2, 580)

  // 活動名稱
  ctx.fillStyle = '#374151'
  ctx.font = `24px ${fontFamily}`
  ctx.fillText(eventName || '', W / 2, 625)

  // 日期 + 地點
  ctx.fillStyle = '#6b7280'
  ctx.font = `20px ${fontFamily}`
  let metaY = 660
  if (eventDate) { ctx.fillText(eventDate, W / 2, metaY); metaY += 30 }
  if (location)  { ctx.fillText(location, W / 2, metaY) }

  // 底部提示
  ctx.fillStyle = '#9ca3af'
  ctx.font = `16px ${fontFamily}`
  ctx.fillText('當天現場掃此碼即可報到', W / 2, 750)

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('canvas toBlob 失敗'))
    }, 'image/png')
  })
}

// 下載 QR 小卡
async function downloadQRCard(cardData) {
  try {
    const blob = await generateQRCardBlob(cardData)
    const filename = `${cardData.name || 'friend'}_${cardData.eventName || ''}_QR.png`
      .replace(/[<>:"/\\|?*\s]/g, '_').slice(0, 80)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  } catch (e) {
    console.warn('[downloadQRCard]', e)
    alert('下載失敗，請稍後再試')
  }
}

// 分享 QR 小卡（Web Share API；不支援時 fallback 下載）
async function shareQRCard(cardData) {
  try {
    const blob = await generateQRCardBlob(cardData)
    const filename = `${cardData.name || 'friend'}_${cardData.eventName || ''}_QR.png`
      .replace(/[<>:"/\\|?*\s]/g, '_').slice(0, 80)
    const file = new File([blob], filename, { type: 'image/png' })
    const shareText = `${cardData.eventName || ''}・${cardData.name || '親友'} 報到 QR Code`
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `${cardData.name || '親友'} 報到 QR`,
        text: shareText,
      })
      return
    }
    // 不支援 → fallback 下載
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  } catch (e) {
    if (e.name === 'AbortError') return  // 使用者取消分享
    console.warn('[shareQRCard]', e)
    alert('分享失敗，請改用下載')
  }
}

// ── 多場次輔助函式 ───────────────────────────────────────────
// "2026-05-24" → "5/24（六）"
function formatSessionDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const m = d.getMonth() + 1
  const day = d.getDate()
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  return `${m}/${day}（${weekDays[d.getDay()]}）`
}

function timePeriodLabel(tp) {
  if (tp === 'morning')   return '上午'
  if (tp === 'afternoon') return '下午'
  if (tp === 'evening')   return '晚上'
  return tp || ''
}

// 場次短標：「5/24（六）上午」
function formatSessionLabel(session) {
  return `${formatSessionDate(session.date)}${timePeriodLabel(session.time_period)}`
}

// 場次共用子欄位 fallback（DB 沒有設定時用，與遷移前寫死的行為一致）
const FALLBACK_SESSION_FIELDS = [
  { field_key: 'lunch',   field_label: '午齋', field_type: 'radio',
    options: ['需要', '不需要'],            show_if_period: ['morning'], required: true },
  { field_key: 'parking', field_label: '停車', field_type: 'radio',
    options: ['機車', '轎車', '不需要'],    show_if_period: [],          required: true },
]

// 該子欄位是否會在這場顯示
function isFieldVisibleForSession(field, session) {
  const periods = field.show_if_period || []
  if (periods.length === 0) return true
  return periods.includes(session.time_period)
}

// 子欄位的答案是否「已填」
function isAnswerFilled(field, value) {
  if (field.field_type === 'boolean') return typeof value === 'boolean'
  if (value === undefined || value === null) return false
  return String(value).trim() !== ''
}

const OVERVIEW_IDLE_SECONDS = 30   // 總覽畫面閒置幾秒後自動返回
const FORM_IDLE_SECONDS = 120      // 填表畫面閒置幾秒後自動返回（長者填表需要較多時間）
const SUCCESS_SECONDS = 3          // 報名成功提示停留秒數

export default function KioskPage() {
  // 所有進行中活動（含欄位）
  const [eventItems, setEventItems] = useState([]) // [{event, fields}, ...]

  // 刷卡後狀態
  // phase: idle | loading | overview | form | submitting | not_found | error | no_event
  //        | friend_event_choose | friend_form | friend_submitting
  const [phase, setPhase] = useState('idle')
  const [student, setStudent] = useState(null)
  const [classes, setClasses] = useState([])
  const [statuses, setStatuses] = useState({}) // { eventId: registration|null }

  // 填表狀態（選擇某場活動後）
  const [selectedItem, setSelectedItem] = useState(null) // { event, fields }
  const [answers, setAnswers] = useState({})
  const [isUpdate, setIsUpdate] = useState(false)
  const [currentReg, setCurrentReg] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [successEventName, setSuccessEventName] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)

  // 親友代報狀態
  const [friendMode, setFriendMode] = useState(null) // null | 'friend'（只代親友，不再有「本人+親友」綁定模式）
  const [friendName, setFriendName] = useState('')
  const [friendAnswers, setFriendAnswers] = useState({})
  // 上次代報成功的 registration_id 與活動 metadata（給 success 畫面產 QR 小卡用）
  const [lastFriendRegId, setLastFriendRegId] = useState('')
  const [lastFriendEventName, setLastFriendEventName] = useState('')
  const [lastFriendEventDate, setLastFriendEventDate] = useState('')
  const [lastFriendEventLocation, setLastFriendEventLocation] = useState('')
  // 該學員代報過的所有親友清單（OverviewScreen 顯示用）
  const [friendRegistrations, setFriendRegistrations] = useState([])

  // 多場次報名狀態
  const [sessionItems, setSessionItems] = useState([])       // event_sessions 陣列
  const [sessionFields, setSessionFieldsState] = useState([]) // event_session_fields 陣列（動態子欄位 schema）
  const [sessionSelections, setSessionSelections] = useState({}) // { session_id: bool }
  const [sessionSubAnswers, setSessionSubAnswers] = useState({}) // { session_id: { [field_key]: value } }

  const [cameraOpen, setCameraOpen] = useState(false)
  const [cancellingEventId, setCancellingEventId] = useState(null) // 正在確認取消的活動 ID

  const scanBufferRef = useRef('')
  const scanTimerRef = useRef(null)
  const idleTimerRef = useRef(null)

  // ── 初始載入活動 ──────────────────────────────────────────
  useEffect(() => { loadEvents() }, [])

  // ── 閒置時定期重載（確保程式碼與資料保持最新）──────────────
  useEffect(() => {
    const timer = setInterval(() => {
      if (phase === 'idle') window.location.reload()
    }, 10 * 60 * 1000) // 閒置 10 分鐘自動重載
    return () => clearInterval(timer)
  }, [phase])

  async function loadEvents() {
    const { events, error } = await getActiveEvents()
    if (error) { setPhase('error'); setErrorMsg(error); return }
    if (!events.length) { setPhase('no_event'); return }
    setEventItems(events)
    setPhase('idle')
  }

  // ── 鍵盤監聽（掃描機）────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (phase !== 'idle') return
    if (e.key === 'Enter') {
      const code = scanBufferRef.current.trim()
      scanBufferRef.current = ''
      clearTimeout(scanTimerRef.current)
      if (code.length > 0) handleScan(code)
    } else if (e.key.length === 1) {
      scanBufferRef.current += e.key
      clearTimeout(scanTimerRef.current)
      scanTimerRef.current = setTimeout(() => {
        const code = scanBufferRef.current.trim()
        scanBufferRef.current = ''
        if (code.length >= 6) handleScan(code)
      }, 300)
    }
  }, [phase]) // eslint-disable-line

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── 相機掃描回呼 ─────────────────────────────────────────
  function handleCameraScan(code) {
    setCameraOpen(false)
    handleScan(code)
  }

  // ── 刷卡後查詢 ────────────────────────────────────────────
  async function handleScan(code) {
    setPhase('loading')
    const eventIds = eventItems.map(i => i.event.event_id)

    // 學員資料、報名狀態、代報親友三項並行查詢，減少等待時間
    const [studentResult, statusResult, friendResult] = await Promise.all([
      getStudentById(code),
      getStudentEventStatuses(code, eventIds),
      getFriendRegistrationsByHost(code, eventIds),
    ])

    const { student, classes, error } = studentResult
    if (error === 'NOT_FOUND') { setPhase('not_found'); scheduleAutoReset(4); return }
    if (error) { setPhase('error'); setErrorMsg(error); scheduleAutoReset(5); return }

    const { map: statusMap, error: statusErr } = statusResult
    const { registrations: friendRegs } = friendResult

    setStudent(student)
    setClasses(classes)
    setStatuses(statusMap)
    setFriendRegistrations(friendRegs || [])
    if (statusErr) setErrorMsg(`報名狀態查詢失敗：${statusErr}`)
    else setErrorMsg('')
    setPhase('overview')
    startIdleTimer()
  }

  // ── 選擇某場活動（填表）──────────────────────────────────
  function handleSelectEvent(item) {
    clearTimeout(idleTimerRef.current)
    const reg = statuses[item.event.event_id]
    setSelectedItem(item)
    setCurrentReg(reg)
    setIsUpdate(!!reg)
    setErrorMsg('')

    if (item.event.multi_session) {
      // 多場次模式：初始化場次 selections（若已報名則預填）
      const sessions = item.sessions || []
      const schema = (item.sessionFields && item.sessionFields.length > 0)
        ? item.sessionFields
        : FALLBACK_SESSION_FIELDS
      const existingSessions = reg?.answers?.sessions || []
      const initSelections = {}
      const initSubAnswers = {}
      for (const s of sessions) {
        const found = existingSessions.find(e => e.session_id === s.session_id)
        initSelections[s.session_id] = !!found
        if (found) {
          // 把已存的所有 schema key 撈出來（往後新增子欄位也安全）
          const sub = {}
          for (const f of schema) {
            if (f.field_key in found) sub[f.field_key] = found[f.field_key]
          }
          initSubAnswers[s.session_id] = sub
        } else {
          initSubAnswers[s.session_id] = {}
        }
      }
      setSessionItems(sessions)
      setSessionFieldsState(schema)
      setSessionSelections(initSelections)
      setSessionSubAnswers(initSubAnswers)
      setPhase('session_select')
    } else {
      // 一般模式
      setAnswers(reg?.answers || {})
      setPhase('form')
    }
    startFormTimer()
  }

  // ── 多場次：切換單一場次勾選 ─────────────────────────────
  function handleToggleSession(sessionId, checked) {
    clearTimeout(idleTimerRef.current)
    startFormTimer()
    setSessionSelections(prev => ({ ...prev, [sessionId]: checked }))
    if (checked) {
      // 從已勾選的第一場複製答案過來（預填）
      const firstSelectedId = sessionItems.find(s => sessionSelections[s.session_id])?.session_id
      if (firstSelectedId) {
        const firstSub = sessionSubAnswers[firstSelectedId] || {}
        const targetSession = sessionItems.find(s => s.session_id === sessionId)
        // 只複製對此場「可見」的子欄位答案
        const filtered = {}
        for (const f of sessionFields) {
          if (targetSession && isFieldVisibleForSession(f, targetSession) && f.field_key in firstSub) {
            filtered[f.field_key] = firstSub[f.field_key]
          }
        }
        setSessionSubAnswers(prev => ({
          ...prev,
          [sessionId]: filtered,
        }))
      }
    }
  }

  // ── 多場次：修改某場的子答案（午齋 / 停車）──────────────
  function handleChangeSubAnswer(sessionId, key, value) {
    clearTimeout(idleTimerRef.current)
    startFormTimer()
    setSessionSubAnswers(prev => ({
      ...prev,
      [sessionId]: { ...(prev[sessionId] || {}), [key]: value },
    }))
  }

  // ── 多場次：全選 / 取消全選 ──────────────────────────────
  function handleSelectAll(checked) {
    clearTimeout(idleTimerRef.current)
    startFormTimer()
    const newSelections = {}
    for (const s of sessionItems) newSelections[s.session_id] = checked

    if (checked) {
      // 找第一場「有填過任一子欄位」的答案，複製到所有尚無答案的場次
      const firstFilledSub = sessionItems.reduce((found, s) => {
        if (found) return found
        const sub = sessionSubAnswers[s.session_id]
        if (!sub) return null
        const hasAny = sessionFields.some(f => isAnswerFilled(f, sub[f.field_key]))
        return hasAny ? sub : null
      }, null)
      if (firstFilledSub) {
        const newSubAnswers = { ...sessionSubAnswers }
        for (const s of sessionItems) {
          const sub = newSubAnswers[s.session_id] || {}
          const hasAny = sessionFields.some(f => isAnswerFilled(f, sub[f.field_key]))
          if (!hasAny) {
            // 只複製對此場可見的欄位
            const filtered = {}
            for (const f of sessionFields) {
              if (isFieldVisibleForSession(f, s) && f.field_key in firstFilledSub) {
                filtered[f.field_key] = firstFilledSub[f.field_key]
              }
            }
            newSubAnswers[s.session_id] = filtered
          }
        }
        setSessionSubAnswers(newSubAnswers)
      }
    }
    setSessionSelections(newSelections)
  }

  // ── 多場次：送出 ─────────────────────────────────────────
  async function handleSubmitSessions() {
    const { event } = selectedItem
    const selectedIds = sessionItems
      .filter(s => sessionSelections[s.session_id])
      .map(s => s.session_id)

    if (selectedIds.length === 0) {
      setErrorMsg('請至少選擇一個場次')
      return
    }

    // 驗證每場的必填子欄位（動態 schema 驅動）
    const missingList = []
    for (const sId of selectedIds) {
      const s = sessionItems.find(x => x.session_id === sId)
      const sub = sessionSubAnswers[sId] || {}
      for (const f of sessionFields) {
        if (!isFieldVisibleForSession(f, s)) continue
        if (!(f.required ?? true)) continue
        if (!isAnswerFilled(f, sub[f.field_key])) {
          missingList.push(`${formatSessionLabel(s)}：請填寫「${f.field_label}」`)
        }
      }
    }
    if (missingList.length > 0) {
      setErrorMsg(missingList[0])
      return
    }

    setErrorMsg('')
    clearTimeout(idleTimerRef.current)
    setPhase('session_submitting')

    // 組合 answers.sessions：每場只寫入對該場可見的子欄位
    const sessions = sessionItems
      .filter(s => sessionSelections[s.session_id])
      .map(s => {
        const sub = sessionSubAnswers[s.session_id] || {}
        const row = { session_id: s.session_id }
        for (const f of sessionFields) {
          if (!isFieldVisibleForSession(f, s)) continue
          if (f.field_key in sub) row[f.field_key] = sub[f.field_key]
        }
        return row
      })
    const sessionsAnswer = { sessions }

    let success, error
    if (isUpdate && currentReg) {
      const oldAnswers = { ...currentReg.answers }
      ;({ success, error } = await updateRegistration(currentReg.registration_id, sessionsAnswer, false))
      if (success) {
        await logRegistrationChange({
          registrationId: currentReg.registration_id,
          eventId: event.event_id, eventName: event.name,
          studentName: student.name,
          changeType: 'modified', oldAnswers, newAnswers: sessionsAnswer,
        })
      }
    } else {
      ;({ success, error } = await submitRegistration(event.event_id, student.student_id, sessionsAnswer, 'tablet-01', false))
      if (success) {
        await logRegistrationChange({
          registrationId: null,
          eventId: event.event_id, eventName: event.name,
          studentName: student.name,
          changeType: 'created', oldAnswers: null, newAnswers: sessionsAnswer,
        })
      }
    }

    if (!success) {
      setPhase('session_select')
      setErrorMsg(error)
      startFormTimer()
      return
    }

    const newReg = {
      registration_id: currentReg?.registration_id || 'new',
      event_id: event.event_id,
      answers: sessionsAnswer,
    }
    setStatuses(prev => ({ ...prev, [event.event_id]: newReg }))
    setSuccessEventName(event.name)
    setShowSuccess(true)
    setTimeout(() => setShowSuccess(false), SUCCESS_SECONDS * 1000)
    setPhase('overview')
    startIdleTimer()
  }

  // ── 親友代報：進入「選活動」階段 ────────────────────────────
  function handleStartFriendFlow() {
    clearTimeout(idleTimerRef.current)
    setFriendMode('friend')   // 統一單一模式（不再區分本人+親友 / 只報親友）
    setSelectedItem(null)
    setFriendName('')
    setFriendAnswers({})
    setErrorMsg('')
    setPhase('friend_event_choose')
    startIdleTimer()
  }

  // ── 親友代報：選好活動 → 進親友 form ─────────────────────
  // 簡化：拿掉「本人+親友」綁定模式，學員本人報名走本人流程，
  // 代報親友純粹只填親友，兩條線完全獨立。
  function handleFriendPickEvent(item) {
    clearTimeout(idleTimerRef.current)
    setSelectedItem(item)
    setErrorMsg('')
    setFriendName('')
    setFriendAnswers({})
    setPhase('friend_form')
    startFormTimer()
  }

  // ── 親友代報：送出 ───────────────────────────────────────────
  async function handleSubmitFriend() {
    const { event, fields } = selectedItem
    const name = friendName.trim()
    if (!name) {
      setErrorMsg('請填寫親友姓名')
      return
    }
    // 驗證必填（含 show_if）
    const visibleRequired = fields.filter(f => {
      if (!f.required) return false
      if (!f.show_if) return true
      return Object.entries(f.show_if).every(([k, v]) => friendAnswers[k] === v)
    })
    const missing = visibleRequired.filter(f => {
      const val = friendAnswers[f.field_key]
      return val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)
    })
    if (missing.length > 0) {
      setErrorMsg(`請填寫：${missing.map(f => f.field_label).join('、')}`)
      return
    }
    setErrorMsg('')
    clearTimeout(idleTimerRef.current)
    setPhase('friend_submitting')

    const friendIsDriver = isDriverFromAnswers({ answers: friendAnswers }, fields)
    const { registrationId, error } = await submitFriendRegistration(
      event.event_id, student.student_id, student.name, name, friendAnswers,
      'tablet-01', friendIsDriver,
    )
    if (!registrationId) {
      setPhase('friend_form'); setErrorMsg(error || '送出失敗'); startFormTimer(); return
    }
    await logRegistrationChange({
      registrationId, eventId: event.event_id, eventName: event.name,
      studentName: `${name}（${student.name} 親友）`,
      changeType: 'created', oldAnswers: null,
      newAnswers: { guest_name: name, 備註: `${student.name} 親友`, ...friendAnswers },
    })

    // 報名成功 → 進入「再代報一位 / 完成返回」選擇畫面
    // friendName 留著給 success 畫面顯示，由下一步動作清空
    setSuccessEventName(`${event.name}（${name} 親友）`)
    setLastFriendRegId(registrationId)
    setLastFriendEventName(event.name)
    setLastFriendEventDate(formatEventDateRange(event.date_start, event.date_end))
    setLastFriendEventLocation(event.location || '')
    setFriendAnswers({})
    // 即時更新「您代報的親友」清單（不必重新查 DB）
    setFriendRegistrations(prev => [
      {
        registration_id: registrationId,
        event_id: event.event_id,
        answers: { guest_name: name, 備註: `${student.name} 親友`, ...friendAnswers },
        registered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      ...prev,
    ])
    setPhase('friend_success')
    startIdleTimer()
  }

  // 連續代報：再代報一位（保留 friendMode，回去重新選活動）
  function handleContinueFriend() {
    clearTimeout(idleTimerRef.current)
    setFriendName('')
    setFriendAnswers({})
    setSelectedItem(null)
    setErrorMsg('')
    setPhase('friend_event_choose')
    startFormTimer()
  }

  // 完成代報，回總覽
  function handleDoneFriend() {
    clearTimeout(idleTimerRef.current)
    setFriendMode(null)
    setFriendName('')
    setFriendAnswers({})
    setSelectedItem(null)
    setPhase('overview')
    startIdleTimer()
  }

  // ── 取消報名 ──────────────────────────────────────────────
  async function handleCancelRegistration(eventId) {
    const reg = statuses[eventId]
    if (!reg) return
    const eventItem = eventItems.find(i => i.event.event_id === eventId)
    // 記錄取消（刪除前先備份）
    await logRegistrationChange({
      registrationId: reg.registration_id,
      eventId,
      eventName: eventItem?.event.name ?? '',
      studentName: student?.name ?? '',
      changeType: 'cancelled',
      oldAnswers: reg.answers ?? null,
      newAnswers: null,
    })
    const { success } = await deleteRegistration(reg.registration_id)
    if (!success) return
    setStatuses(prev => ({ ...prev, [eventId]: null }))
    setCancellingEventId(null)
    startIdleTimer()
  }

  // ── 送出表單 ──────────────────────────────────────────────
  async function handleSubmit() {
    const { event, fields } = selectedItem
    // 驗證必填
    const visibleRequired = fields.filter(f => {
      if (!f.required) return false
      if (!f.show_if) return true
      return Object.entries(f.show_if).every(([k, v]) => answers[k] === v)
    })
    const missing = visibleRequired.filter(f => {
      const val = answers[f.field_key]
      return val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)
    })
    if (missing.length > 0) {
      setErrorMsg(`請填寫：${missing.map(f => f.field_label).join('、')}`)
      return
    }
    setErrorMsg('')
    clearTimeout(idleTimerRef.current)
    setPhase('submitting')

    let success, error
    const isDriver = isDriverFromAnswers({ answers }, fields)
    if (isUpdate && currentReg) {
      const oldAnswers = { ...currentReg.answers }
      ;({ success, error } = await updateRegistration(currentReg.registration_id, answers, isDriver))
      if (success) {
        await logRegistrationChange({
          registrationId: currentReg.registration_id,
          eventId: event.event_id,
          eventName: event.name,
          studentName: student.name,
          changeType: 'modified',
          oldAnswers,
          newAnswers: answers,
        })
      }
    } else {
      ;({ success, error } = await submitRegistration(event.event_id, student.student_id, answers, 'tablet-01', isDriver))
      if (success) {
        await logRegistrationChange({
          registrationId: null,
          eventId: event.event_id,
          eventName: event.name,
          studentName: student.name,
          changeType: 'created',
          oldAnswers: null,
          newAnswers: answers,
        })
      }
    }

    if (!success) { setPhase('form'); setErrorMsg(error); startFormTimer(); return }

    // 更新本地狀態
    const newReg = { registration_id: currentReg?.registration_id || 'new', event_id: event.event_id, answers }
    setStatuses(prev => ({ ...prev, [event.event_id]: newReg }))
    setSuccessEventName(event.name)
    setShowSuccess(true)
    setTimeout(() => setShowSuccess(false), SUCCESS_SECONDS * 1000)

    // 回到總覽（不再有「本人+親友」的自動接續邏輯）
    setPhase('overview')
    startIdleTimer()
  }

  // ── 計時 ──────────────────────────────────────────────────
  function scheduleAutoReset(sec) {
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => reset(), sec * 1000)
  }

  function startIdleTimer() {
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => reset(), OVERVIEW_IDLE_SECONDS * 1000)
  }

  function startFormTimer() {
    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => reset(), FORM_IDLE_SECONDS * 1000)
  }

  function reset() {
    clearTimeout(idleTimerRef.current)
    clearTimeout(scanTimerRef.current)
    scanBufferRef.current = ''
    setStudent(null)
    setClasses([])
    setStatuses({})
    setSelectedItem(null)
    setAnswers({})
    setIsUpdate(false)
    setCurrentReg(null)
    setErrorMsg('')
    setShowSuccess(false)
    setCancellingEventId(null)
    setFriendMode(null)
    setFriendName('')
    setFriendAnswers({})
    setLastFriendRegId('')
    setLastFriendEventName('')
    setLastFriendEventDate('')
    setLastFriendEventLocation('')
    setFriendRegistrations([])
    setSessionItems([])
    setSessionFieldsState([])
    setSessionSelections({})
    setSessionSubAnswers({})
    setPhase(eventItems.length ? 'idle' : 'no_event')
  }

  // 從 friend_event_choose 回到總覽
  function handleCancelFriendFlow() {
    clearTimeout(idleTimerRef.current)
    setFriendMode(null)
    setSelectedItem(null)
    setFriendName('')
    setFriendAnswers({})
    setErrorMsg('')
    setPhase('overview')
    startIdleTimer()
  }

  // ── 渲染 ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 相機掃描覆蓋層 */}
      {cameraOpen && (
        <CameraScanner
          onScan={handleCameraScan}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* Header */}
      <header className="bg-blue-700 text-white px-6 py-4 shadow-md">
        <p className="text-kiosk-sm opacity-80">普宜精舍</p>
        <h1 className="text-kiosk-lg font-bold leading-tight">活動報名</h1>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        {phase === 'idle' && <IdleScreen onOpenCamera={() => setCameraOpen(true)} />}
        {phase === 'loading' && <LoadingScreen />}
        {phase === 'no_event' && <NoEventScreen onRefresh={loadEvents} />}
        {phase === 'not_found' && <NotFoundScreen onReset={reset} />}
        {phase === 'error' && <ErrorScreen message={errorMsg} onReset={reset} />}

        {phase === 'overview' && (
          <OverviewScreen
            student={student}
            classes={classes}
            eventItems={eventItems}
            statuses={statuses}
            friendRegistrations={friendRegistrations}
            showSuccess={showSuccess}
            successEventName={successEventName}
            cancellingEventId={cancellingEventId}
            errorMsg={errorMsg}
            onSelectEvent={handleSelectEvent}
            onRequestCancel={setCancellingEventId}
            onConfirmCancel={handleCancelRegistration}
            onStartFriendFlow={handleStartFriendFlow}
            onDone={reset}
          />
        )}

        {(phase === 'form' || phase === 'submitting') && selectedItem && (
          <FormScreen
            student={student}
            classes={classes}
            event={selectedItem.event}
            fields={selectedItem.fields}
            answers={answers}
            isUpdate={isUpdate}
            errorMsg={errorMsg}
            submitting={phase === 'submitting'}
            onChange={setAnswers}
            onSubmit={handleSubmit}
            onBack={() => {
              clearTimeout(idleTimerRef.current)
              setPhase('overview'); startIdleTimer()
            }}
          />
        )}

        {(phase === 'session_select' || phase === 'session_submitting') && selectedItem && (
          <SessionSelectScreen
            student={student}
            classes={classes}
            event={selectedItem.event}
            sessionItems={sessionItems}
            sessionFields={sessionFields}
            sessionSelections={sessionSelections}
            sessionSubAnswers={sessionSubAnswers}
            isUpdate={isUpdate}
            errorMsg={errorMsg}
            submitting={phase === 'session_submitting'}
            onToggleSession={handleToggleSession}
            onChangeSubAnswer={handleChangeSubAnswer}
            onSelectAll={handleSelectAll}
            onSubmit={handleSubmitSessions}
            onBack={() => {
              clearTimeout(idleTimerRef.current)
              setPhase('overview'); startIdleTimer()
            }}
          />
        )}

        {phase === 'friend_event_choose' && (
          <FriendEventChooseScreen
            student={student}
            eventItems={eventItems}
            statuses={statuses}
            onPick={handleFriendPickEvent}
            onCancel={handleCancelFriendFlow}
          />
        )}

        {(phase === 'friend_form' || phase === 'friend_submitting') && selectedItem && (
          <FriendFormScreen
            student={student}
            event={selectedItem.event}
            fields={selectedItem.fields}
            friendName={friendName}
            answers={friendAnswers}
            errorMsg={errorMsg}
            submitting={phase === 'friend_submitting'}
            onChangeName={setFriendName}
            onChangeAnswers={setFriendAnswers}
            onSubmit={handleSubmitFriend}
            onBack={handleCancelFriendFlow}
          />
        )}

        {phase === 'friend_success' && (
          <FriendSuccessScreen
            studentName={student?.name ?? ''}
            friendName={friendName}
            eventName={successEventName}
            friendRegId={lastFriendRegId}
            friendEventName={lastFriendEventName}
            friendEventDate={lastFriendEventDate}
            friendEventLocation={lastFriendEventLocation}
            onContinue={handleContinueFriend}
            onDone={handleDoneFriend}
          />
        )}
      </main>
    </div>
  )
}

// ── 等待刷卡 ────────────────────────────────────────────────
function IdleScreen({ onOpenCamera }) {
  return (
    <div className="text-center select-none">
      <div className="text-9xl mb-8 animate-pulse">📛</div>
      <p className="text-kiosk-2xl font-bold text-gray-700 mb-4">請刷學員證</p>
      <p className="text-kiosk-base text-gray-500 mb-8">將學員證條碼對準掃描機</p>
      <button
        onClick={onOpenCamera}
        className="inline-flex items-center gap-3 px-8 py-4 bg-white border-2 border-blue-400 text-blue-700 rounded-2xl text-kiosk-base font-semibold shadow-sm active:scale-95 transition-transform"
      >
        <span className="text-2xl">📷</span>
        用手機相機掃描
      </button>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="text-center">
      <div className="w-20 h-20 border-8 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
      <p className="text-kiosk-lg text-gray-600">查詢中…</p>
    </div>
  )
}

function NoEventScreen({ onRefresh }) {
  return (
    <div className="text-center">
      <div className="text-8xl mb-6">📅</div>
      <p className="text-kiosk-xl font-bold text-gray-700 mb-3">目前沒有進行中的活動</p>
      <p className="text-kiosk-base text-gray-500 mb-8">請師父在後台將活動設為「進行中」</p>
      <button onClick={onRefresh} className="px-8 py-4 bg-blue-600 text-white rounded-2xl text-kiosk-base font-semibold">
        重新整理
      </button>
    </div>
  )
}

function NotFoundScreen({ onReset }) {
  return (
    <div className="text-center">
      <div className="text-8xl mb-6">🔍</div>
      <p className="text-kiosk-xl font-bold text-red-600 mb-3">找不到學員資料</p>
      <p className="text-kiosk-base text-gray-500 mb-8">請確認學員證是否正確，或洽現場師兄協助</p>
      <button onClick={onReset} className="px-8 py-4 border-2 border-gray-400 rounded-2xl text-kiosk-base text-gray-600">
        返回
      </button>
    </div>
  )
}

function ErrorScreen({ message, onReset }) {
  return (
    <div className="text-center">
      <div className="text-8xl mb-6">⚠️</div>
      <p className="text-kiosk-xl font-bold text-red-600 mb-3">發生問題</p>
      <p className="text-kiosk-sm text-gray-500 mb-8 max-w-sm mx-auto">{message}</p>
      <button onClick={onReset} className="px-8 py-4 bg-red-100 border-2 border-red-400 rounded-2xl text-kiosk-base text-red-700">
        返回首頁
      </button>
    </div>
  )
}

// ── 總覽畫面：所有活動報名狀態 ────────────────────────────
function OverviewScreen({
  student, classes, eventItems, statuses, friendRegistrations = [],
  showSuccess, successEventName,
  cancellingEventId, errorMsg, onSelectEvent, onRequestCancel, onConfirmCancel,
  onStartFriendFlow, onDone,
}) {
  // 把代報親友依活動分組（同一場活動的親友列在一起）
  const friendsByEvent = friendRegistrations.reduce((acc, fr) => {
    if (!acc[fr.event_id]) acc[fr.event_id] = []
    acc[fr.event_id].push(fr)
    return acc
  }, {})
  const eventNameMap   = Object.fromEntries(eventItems.map(({ event }) => [event.event_id, event.name]))
  const eventFieldsMap = Object.fromEntries(eventItems.map(({ event, fields }) => [event.event_id, fields]))
  const eventInfoMap   = Object.fromEntries(eventItems.map(({ event }) => [event.event_id, {
    name:     event.name,
    dateStart: event.date_start,
    dateEnd:   event.date_end,
    location:  event.location,
  }]))

  // 開啟 QR Modal 的親友資料（null = 關閉）
  const [viewingFriend, setViewingFriend] = useState(null)
  const openFriendQR = (fr) => {
    const ev = eventInfoMap[fr.event_id] || {}
    setViewingFriend({
      registration_id: fr.registration_id,
      name:      fr.answers?.guest_name || '訪客',
      eventName: ev.name || '',
      eventDate: formatEventDateRange(ev.dateStart, ev.dateEnd),
      location:  ev.location || '',
    })
  }
  return (
    <div className="w-full max-w-lg">
      {/* 報名狀態查詢失敗提示 */}
      {errorMsg && (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl px-5 py-3 mb-4 text-center">
          <p className="text-red-700 text-kiosk-sm">⚠ {errorMsg}</p>
        </div>
      )}
      {/* 學員資訊卡（含個人 QR Code 下載） */}
      <div className="bg-white rounded-2xl shadow-md p-5 mb-5 border-l-8 border-blue-600">
        {/* 手機：兩行；電腦（sm 以上）：一行 */}
        <p className="text-kiosk-xl font-bold text-gray-800 hidden sm:block">
          {student?.name} 師兄，您好 🙏
        </p>
        <p className="text-kiosk-xl font-bold text-gray-800 sm:hidden">
          {student?.name} 師兄<br />您好 🙏
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {classes.map((c, i) => (
            <span key={i} className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-kiosk-sm">
              {c.class_name}{c.group_name ? `・${c.group_name}` : ''}
            </span>
          ))}
        </div>

      </div>

      {/* 報名成功提示 */}
      {showSuccess && (
        <div className="bg-green-50 border-2 border-green-400 rounded-2xl px-5 py-3 mb-4 text-center">
          <p className="text-green-700 font-bold text-kiosk-base">✅ {successEventName} 報名完成！</p>
        </div>
      )}

      {/* 活動列表：未報名排前，已報名排後 */}
      <div className="space-y-3 mb-5">
        {[...eventItems]
          .sort((a, b) => {
            const aReg = statuses[a.event.event_id] ? 1 : 0
            const bReg = statuses[b.event.event_id] ? 1 : 0
            return aReg - bReg
          })
          .map(({ event, fields, sessions = [] }) => {
          const reg = statuses[event.event_id]
          const registered = !!reg
          const confirming = cancellingEventId === event.event_id

          return (
            <div
              key={event.event_id}
              className={`bg-white rounded-2xl shadow-sm border-2 p-5 transition-all ${
                confirming ? 'border-red-300 bg-red-50' : registered ? 'border-green-300' : 'border-gray-200'
              }`}
            >
              {/* 上方：活動資訊 + 主要按鈕 */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-kiosk-base font-bold text-gray-800">{event.name}</p>
                  <p className="text-kiosk-sm text-gray-500 mt-0.5">
                    {event.date_start || ''}
                    {event.date_end && event.date_end !== event.date_start ? ` ～ ${event.date_end}` : ''}
                    {event.location ? `　${event.location}` : ''}
                  </p>
                  {/* 已報名則顯示報名資料摘要 */}
                  {registered && !confirming && reg.answers && (() => {
                    // 多場次模式：顯示場次 badge 清單
                    if (event.multi_session && Array.isArray(reg.answers.sessions)) {
                      const regSessions = reg.answers.sessions
                      if (regSessions.length === 0) return null
                      return (
                        <details className="mt-3 group">
                          <summary className="cursor-pointer text-kiosk-sm text-blue-700 select-none list-none flex items-center gap-1 mb-2">
                            <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                            <span>已選 {regSessions.length} 個場次</span>
                          </summary>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {regSessions.map(rs => {
                              const s = sessions.find(x => x.session_id === rs.session_id)
                              return (
                                <span
                                  key={rs.session_id}
                                  className="bg-blue-100 text-blue-800 px-2.5 py-1 rounded-lg text-kiosk-sm font-medium"
                                >
                                  {s ? formatSessionLabel(s) : rs.session_id.slice(0, 8)}
                                  {rs.parking && rs.parking !== '不停車' && `・${rs.parking}`}
                                  {rs.lunch && `・午齋${rs.lunch}`}
                                </span>
                              )
                            })}
                          </div>
                        </details>
                      )
                    }
                    // 一般欄位模式
                    const items = fields.reduce((acc, f) => {
                      const v = reg.answers[f.field_key]
                      if (v === undefined || v === null || v === '') return acc
                      let display
                      if (f.field_type === 'boolean') {
                        display = v === true ? '是' : v === false ? '否' : ''
                      } else if (f.field_type === 'datetime' && typeof v === 'string') {
                        display = v.replace('T', ' ')
                      } else if (Array.isArray(v)) {
                        display = v.join('、')
                      } else {
                        display = v
                      }
                      if (!display && display !== 0) return acc
                      acc.push({ key: f.field_key, label: f.field_label, display })
                      return acc
                    }, [])
                    if (items.length === 0) return null
                    return (
                      <details className="mt-3 group">
                        <summary className="cursor-pointer text-kiosk-sm text-blue-700 hover:text-blue-900 select-none list-none flex items-center gap-1 mb-1">
                          <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                          <span>查看報名資料（{items.length} 項）</span>
                        </summary>
                        <div className="space-y-2 pt-1">
                          {items.map((item, idx) => (
                            <div key={item.key} className="flex items-start gap-2">
                              <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5 leading-none">
                                {idx + 1}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-kiosk-sm text-blue-600 leading-tight">{item.label}</span>
                                <span className="block text-kiosk-sm text-gray-800 font-medium leading-snug">{item.display}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )
                  })()}
                  {/* 取消確認提示 */}
                  {confirming && (
                    <p className="mt-2 text-kiosk-sm text-red-600 font-medium">確定要取消此活動的報名嗎？</p>
                  )}
                </div>

                <div className="flex-shrink-0">
                  {/* 活動鎖定：只顯示狀態，不提供任何操作 */}
                  {event.locked ? (
                    registered ? (
                      <span className="px-4 py-2 border-2 border-green-400 text-green-700 rounded-xl text-kiosk-sm font-medium bg-green-50 inline-block text-center">
                        ✓ 已報名
                      </span>
                    ) : (
                      <span className="px-4 py-2 border-2 border-gray-200 text-gray-400 rounded-xl text-kiosk-sm inline-block text-center">
                        未報名
                      </span>
                    )
                  ) : (
                    <>
                      {!registered && (
                        <button
                          onClick={() => onSelectEvent({ event, fields, sessions })}
                          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-kiosk-sm font-bold shadow active:scale-95 transition-transform"
                        >
                          立即報名
                        </button>
                      )}
                      {registered && !confirming && (
                        <button
                          onClick={() => onSelectEvent({ event, fields, sessions })}
                          className="px-4 py-2 border-2 border-green-400 text-green-700 rounded-xl text-kiosk-sm font-medium bg-green-50 active:scale-95 transition-transform"
                        >
                          ✓ 已報名<br/>
                          <span className="text-xs font-normal">點此修改</span>
                        </button>
                      )}
                      {confirming && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => onRequestCancel(null)}
                            className="px-4 py-2 border-2 border-gray-300 text-gray-600 rounded-xl text-kiosk-sm active:scale-95 transition-transform"
                          >
                            不了
                          </button>
                          <button
                            onClick={() => onConfirmCancel(event.event_id)}
                            className="px-4 py-2 bg-red-500 text-white rounded-xl text-kiosk-sm font-bold active:scale-95 transition-transform"
                          >
                            確認取消
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 鎖定提示（取代取消報名按鈕） */}
              {event.locked ? (
                <div className="mt-3 pt-3 border-t border-gray-100 text-center">
                  <p className="text-kiosk-base font-semibold text-amber-700 text-center leading-relaxed">
                    如需新增或異動報名<br/>請聯絡精舍
                  </p>
                </div>
              ) : (
                /* 下方：取消報名按鈕（已報名且非確認中才顯示） */
                registered && !confirming && (
                  <div className="mt-3 pt-3 border-t border-gray-100 text-right">
                    <button
                      onClick={() => onRequestCancel(event.event_id)}
                      className="text-kiosk-sm text-red-400 border border-red-200 px-4 py-1.5 rounded-xl active:scale-95 transition-transform"
                    >
                      取消報名
                    </button>
                  </div>
                )
              )}
            </div>
          )
        })}
      </div>

      {/* 為親友代報區塊：入口按鈕 + 已代報親友清單 */}
      {(() => {
        const hasOpenEvent  = eventItems.some(({ event }) => !event.locked)
        const hasFriends    = friendRegistrations.length > 0
        if (!hasOpenEvent && !hasFriends) return null
        return (
          <div className="bg-purple-50 border-2 border-purple-200 rounded-2xl p-4 mb-5">
            {hasOpenEvent && (
              <>
                <button
                  onClick={() => onStartFriendFlow()}
                  className="w-full py-4 px-4 bg-white border-2 border-purple-400 text-purple-700 rounded-xl text-kiosk-base font-bold active:scale-95 transition-transform shadow-sm"
                >
                  ＋ 代為幫親友報名
                </button>
                <p className="text-kiosk-sm text-purple-500 mt-3 leading-snug">
                  可幫尚未到場的家人或朋友報名（不影響您自己的報名）。
                  後台會自動標註「{student?.name ?? '您'} 親友」並安排同車。
                </p>
              </>
            )}

            {/* 已代報的親友清單 — 預設摺疊，避免畫面太長 */}
            {hasFriends && (
              <details className={`group ${hasOpenEvent ? 'mt-4 pt-3 border-t border-purple-200' : ''}`}>
                <summary className="cursor-pointer text-kiosk-sm font-bold text-purple-700 select-none list-none flex items-center gap-1.5">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  您代報的親友（共 {friendRegistrations.length} 筆）
                </summary>
                <div className="mt-3 space-y-2">
                  {Object.entries(friendsByEvent).map(([eventId, friends]) => {
                    const evName = eventNameMap[eventId] || '（未知活動）'
                    const evFields = eventFieldsMap[eventId] || []
                    return (
                      <div key={eventId} className="bg-white border border-purple-200 rounded-xl p-3">
                        <p className="text-kiosk-sm font-semibold text-gray-700 mb-2">📅 {evName}</p>
                        <div className="space-y-2">
                          {friends.map(fr => {
                            const guestName = fr.answers?.guest_name || '訪客'
                            const items = evFields.reduce((acc, f) => {
                              const v = fr.answers?.[f.field_key]
                              if (v === undefined || v === null || v === '') return acc
                              let display
                              if (f.field_type === 'boolean') {
                                display = v === true ? '是' : v === false ? '否' : ''
                              } else if (Array.isArray(v)) {
                                display = v.join('、')
                              } else {
                                display = v
                              }
                              if (!display && display !== 0) return acc
                              acc.push({ key: f.field_key, label: f.field_label, display })
                              return acc
                            }, [])
                            return (
                              <div key={fr.registration_id} className="bg-purple-50 rounded-lg px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-kiosk-sm font-bold text-purple-800 truncate">{guestName}</p>
                                  <button
                                    onClick={() => openFriendQR(fr)}
                                    className="shrink-0 inline-flex items-center gap-1 text-kiosk-sm bg-purple-600 text-white px-2.5 py-1 rounded-lg font-bold active:scale-95 transition-transform"
                                  >
                                    🎫 報到 QR
                                  </button>
                                </div>
                                {items.length > 0 && (
                                  <details className="mt-1 group/inner">
                                    <summary className="cursor-pointer text-kiosk-sm text-purple-600 select-none list-none flex items-center gap-1">
                                      <span className="inline-block transition-transform group-open/inner:rotate-90">▶</span>
                                      <span>查看資料（{items.length} 項）</span>
                                    </summary>
                                    <div className="mt-1.5 space-y-1 pl-3">
                                      {items.map(item => (
                                        <div key={item.key} className="text-kiosk-sm">
                                          <span className="text-purple-600">{item.label}：</span>
                                          <span className="text-gray-800 font-medium">{item.display}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </details>
            )}
          </div>
        )
      })()}

      {/* 完成按鈕 */}
      <button
        onClick={onDone}
        className="w-full py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium"
      >
        完成，返回首頁
      </button>
      <p className="text-center text-kiosk-sm text-gray-400 mt-3">{OVERVIEW_IDLE_SECONDS} 秒無操作自動返回</p>

      {/* 代報親友 QR 小卡 Modal */}
      <FriendQRModal friend={viewingFriend} onClose={() => setViewingFriend(null)} />
    </div>
  )
}

// ── 填表畫面 ─────────────────────────────────────────────
function FormScreen({ student, classes, event, fields, answers, isUpdate, errorMsg, submitting, onChange, onSubmit, onBack }) {
  return (
    <div className="w-full max-w-lg">
      {/* 學員資訊卡 */}
      <div className="bg-white rounded-2xl shadow-md p-5 mb-4 border-l-8 border-blue-600">
        <p className="text-kiosk-xl font-bold text-gray-800">{student?.name} 師兄</p>
        <p className="text-kiosk-base text-blue-700 font-medium mt-1">{event.name}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {classes.map((c, i) => (
            <span key={i} className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-kiosk-sm">
              {c.class_name}{c.group_name ? `・${c.group_name}` : ''}
            </span>
          ))}
        </div>
      </div>

      {/* 動態表單 */}
      {fields.length > 0 && (
        <div className="bg-white rounded-2xl shadow-md p-5 mb-4">
          <DynamicForm fields={fields} answers={answers} onChange={onChange} />
        </div>
      )}

      {/* 錯誤提示 */}
      {errorMsg && (
        <p className="text-red-600 text-kiosk-sm bg-red-50 border border-red-300 rounded-xl px-4 py-3 mb-4">
          ⚠ {errorMsg}
        </p>
      )}

      {/* 按鈕 */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium disabled:opacity-50"
        >
          ← 返回
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="flex-grow-[2] py-4 bg-blue-600 text-white rounded-2xl text-kiosk-base font-bold shadow-md disabled:opacity-50 active:scale-95 transition-transform"
        >
          {submitting ? '送出中…' : isUpdate ? '確認修改' : '確認報名'}
        </button>
      </div>
    </div>
  )
}

// ── 親友代報：選活動畫面（簡化版：只報親友，與本人報名無關）─
function FriendEventChooseScreen({ student, eventItems, onPick, onCancel }) {
  return (
    <div className="w-full max-w-lg">
      <div className="bg-purple-50 border-2 border-purple-200 rounded-2xl p-5 mb-4">
        <p className="text-kiosk-sm text-purple-600 mb-1">代報者：{student?.name} 師兄</p>
        <p className="text-kiosk-xl font-bold text-purple-800">代為親友報名</p>
        <p className="text-kiosk-sm text-purple-600 mt-2 leading-snug">
          請選擇要為親友報名的活動。
        </p>
      </div>

      <p className="text-kiosk-base font-bold text-gray-700 mb-3">選擇活動</p>
      <div className="space-y-3 mb-5">
        {eventItems.map(({ event, fields }) => {
          const locked = !!event.locked

          return (
            <button
              key={event.event_id}
              onClick={() => !locked && onPick({ event, fields })}
              disabled={locked}
              className={`w-full text-left bg-white rounded-2xl border-2 p-4 transition-all ${
                locked ? 'border-gray-200 opacity-60 cursor-not-allowed' : 'border-purple-300 hover:bg-purple-50 active:scale-[0.99]'
              }`}
            >
              <p className="text-kiosk-base font-bold text-gray-800">{event.name}</p>
              <p className="text-kiosk-sm text-gray-500 mt-0.5">
                {event.date_start || ''}
                {event.date_end && event.date_end !== event.date_start ? ` ～ ${event.date_end}` : ''}
                {event.location ? `　${event.location}` : ''}
              </p>
              {locked && (
                <p className="text-kiosk-sm text-amber-700 mt-1">已停止異動</p>
              )}
            </button>
          )
        })}
      </div>

      <button
        onClick={onCancel}
        className="w-full py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium"
      >
        ← 返回
      </button>
    </div>
  )
}

// ── 親友代報：填寫畫面 ───────────────────────────────────
function FriendFormScreen({
  student, event, fields, friendName, answers, errorMsg, submitting,
  onChangeName, onChangeAnswers, onSubmit, onBack,
}) {
  // 精舍活動：parking_type radio 動態加「跟 OOO 同車（不另計）」選項
  const isTemple = event.event_type === 'temple'
  const hasParkingField = fields.some(f => f.field_key === 'parking_type')
  const carpoolOption = `跟 ${student?.name ?? '代報者'} 同車（不另計）`
  const fieldExtraOptions = (isTemple && hasParkingField)
    ? { parking_type: [carpoolOption] }
    : {}

  return (
    <div className="w-full max-w-lg">
      <div className="bg-purple-100 border-2 border-purple-300 rounded-xl px-4 py-2 mb-3 text-center">
        <p className="text-kiosk-sm font-bold text-purple-700">親友代報</p>
        <p className="text-kiosk-sm text-purple-600">代報者：{student?.name} 師兄</p>
      </div>

      <div className="bg-white rounded-2xl shadow-md p-5 mb-4 border-l-8 border-purple-600">
        <p className="text-kiosk-xl font-bold text-gray-800">為親友報名</p>
        <p className="text-kiosk-base text-purple-700 font-medium mt-1">{event.name}</p>
      </div>

      {/* 親友姓名 */}
      <div className="bg-white rounded-2xl shadow-md p-5 mb-4">
        <p className="text-kiosk-base font-semibold text-purple-700 mb-3 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-600 text-white text-sm font-bold">★</span>
          親友姓名
          <span className="text-red-500 ml-1">*</span>
        </p>
        <input
          type="text"
          value={friendName}
          onChange={e => onChangeName(e.target.value)}
          placeholder="請輸入親友姓名"
          className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-kiosk-base focus:outline-none focus:border-purple-500"
        />
      </div>

      {/* 動態欄位（套用本人活動欄位 + 親友額外選項） */}
      {fields.length > 0 && (
        <div className="bg-white rounded-2xl shadow-md p-5 mb-4">
          <DynamicForm
            fields={fields}
            answers={answers}
            onChange={onChangeAnswers}
            fieldExtraOptions={fieldExtraOptions}
          />
        </div>
      )}

      {errorMsg && (
        <p className="text-red-600 text-kiosk-sm bg-red-50 border border-red-300 rounded-xl px-4 py-3 mb-4">
          ⚠ {errorMsg}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium disabled:opacity-50"
        >
          ← 返回
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="flex-grow-[2] py-4 bg-purple-600 text-white rounded-2xl text-kiosk-base font-bold shadow-md disabled:opacity-50 active:scale-95 transition-transform"
        >
          {submitting ? '送出中…' : '確認代報'}
        </button>
      </div>
    </div>
  )
}

// ── 多場次：場次選擇畫面 ────────────────────────────────────
function SessionSelectScreen({
  student, classes, event,
  sessionItems, sessionFields, sessionSelections, sessionSubAnswers,
  isUpdate, errorMsg, submitting,
  onToggleSession, onChangeSubAnswer, onSelectAll,
  onSubmit, onBack,
}) {
  const allSelected = sessionItems.length > 0 && sessionItems.every(s => sessionSelections[s.session_id])
  const fields = (sessionFields && sessionFields.length > 0) ? sessionFields : FALLBACK_SESSION_FIELDS

  return (
    <div className="w-full max-w-lg">
      {/* 學員資訊卡 */}
      <div className="bg-white rounded-2xl shadow-md p-5 mb-4 border-l-8 border-amber-500">
        <p className="text-kiosk-xl font-bold text-gray-800">{student?.name} 師兄</p>
        <p className="text-kiosk-base text-amber-700 font-medium mt-1">{event.name}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {classes.map((c, i) => (
            <span key={i} className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-kiosk-sm">
              {c.class_name}{c.group_name ? `・${c.group_name}` : ''}
            </span>
          ))}
        </div>
      </div>

      {/* 場次選擇區 */}
      <div className="bg-white rounded-2xl shadow-md p-5 mb-4">
        {/* 標題 + 全選 */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-kiosk-base font-bold text-gray-800">您將參加哪些場次？</p>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={e => onSelectAll(e.target.checked)}
              className="w-5 h-5 accent-amber-600"
            />
            <span className="text-kiosk-sm text-amber-700 font-medium">全部參加</span>
          </label>
        </div>

        {/* 場次卡片 */}
        <div className="space-y-3">
          {sessionItems.map(s => {
            const checked = !!sessionSelections[s.session_id]
            const sub = sessionSubAnswers[s.session_id] || {}
            return (
              <div
                key={s.session_id}
                className={`border-2 rounded-xl p-4 transition-colors ${
                  checked ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-gray-50'
                }`}
              >
                {/* 場次標題列 */}
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => onToggleSession(s.session_id, e.target.checked)}
                    className="w-6 h-6 accent-amber-600 mt-0.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-kiosk-base font-semibold text-gray-800 leading-snug">
                      {formatSessionDate(s.date)}{timePeriodLabel(s.time_period) ? `（${timePeriodLabel(s.time_period)}）` : ''}
                      {s.time_start && s.time_end && (
                        <span className="text-kiosk-sm text-gray-500 font-normal ml-2">
                          {s.time_start.slice(0, 5)}–{s.time_end.slice(0, 5)}
                        </span>
                      )}
                    </p>
                    {s.dharma_name && (
                      <p className="text-kiosk-sm text-amber-700 mt-0.5">{s.dharma_name}</p>
                    )}
                  </div>
                </label>

                {/* 子欄位（勾選後展開，依 schema 動態渲染）*/}
                {checked && (
                  <div className="mt-3 ml-9 space-y-2.5">
                    {fields.filter(f => isFieldVisibleForSession(f, s)).map(f => {
                      const val = sub[f.field_key]
                      if (f.field_type === 'radio') {
                        const opts = f.options || []
                        return (
                          <div key={f.field_key}>
                            <p className="text-kiosk-sm text-gray-600 mb-1.5">{f.field_label}</p>
                            <div className="flex gap-2 flex-wrap">
                              {opts.map(opt => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => onChangeSubAnswer(s.session_id, f.field_key, opt)}
                                  className={`flex-1 min-w-[5rem] py-2 px-3 rounded-xl text-kiosk-sm font-medium border-2 transition-colors ${
                                    val === opt
                                      ? 'border-amber-500 bg-amber-100 text-amber-800'
                                      : 'border-gray-200 bg-white text-gray-600'
                                  }`}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      }
                      if (f.field_type === 'boolean') {
                        return (
                          <div key={f.field_key}>
                            <label className="flex items-center gap-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={val === true}
                                onChange={e => onChangeSubAnswer(s.session_id, f.field_key, e.target.checked)}
                                className="w-5 h-5 accent-amber-600"
                              />
                              <span className="text-kiosk-sm text-gray-700">{f.field_label}</span>
                            </label>
                          </div>
                        )
                      }
                      if (f.field_type === 'text') {
                        return (
                          <div key={f.field_key}>
                            <p className="text-kiosk-sm text-gray-600 mb-1.5">{f.field_label}</p>
                            <input
                              type="text"
                              value={val || ''}
                              onChange={e => onChangeSubAnswer(s.session_id, f.field_key, e.target.value)}
                              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-kiosk-sm focus:outline-none focus:border-amber-400"
                              placeholder=""
                            />
                          </div>
                        )
                      }
                      return null
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {errorMsg && (
        <p className="text-red-600 text-kiosk-sm bg-red-50 border border-red-300 rounded-xl px-4 py-3 mb-4">
          ⚠ {errorMsg}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium disabled:opacity-50"
        >
          ← 返回
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="flex-grow-[2] py-4 bg-amber-600 text-white rounded-2xl text-kiosk-base font-bold shadow-md disabled:opacity-50 active:scale-95 transition-transform"
        >
          {submitting ? '送出中…' : isUpdate ? '確認修改' : '確認報名'}
        </button>
      </div>
    </div>
  )
}

// ── 親友代報成功畫面 ────────────────────────────────────────
function FriendSuccessScreen({
  studentName, friendName, eventName,
  friendRegId, friendEventName, friendEventDate, friendEventLocation,
  onContinue, onDone,
}) {
  return (
    <div className="w-full max-w-lg text-center">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="text-kiosk-2xl font-bold text-gray-800 mb-2">代報完成！</h2>
      <p className="text-kiosk-base text-gray-600 mb-6">
        已為 <span className="font-bold text-purple-700">{friendName}</span> 完成報名
      </p>

      <div className="bg-white rounded-2xl shadow-md p-5 mb-6 text-left space-y-2">
        <p className="text-kiosk-sm text-gray-500">活動</p>
        <p className="text-kiosk-base font-semibold text-gray-800">{friendEventName || eventName}</p>
        {friendEventDate && (
          <p className="text-kiosk-sm text-gray-500">{friendEventDate}</p>
        )}
        {friendEventLocation && (
          <p className="text-kiosk-sm text-gray-500">{friendEventLocation}</p>
        )}
        <p className="text-kiosk-sm text-gray-400 mt-2">代報者：{studentName} 師兄</p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={onContinue}
          className="w-full py-4 bg-purple-600 text-white rounded-2xl text-kiosk-base font-bold shadow-md active:scale-95 transition-transform"
        >
          ＋ 再代報一位
        </button>
        <button
          onClick={onDone}
          className="w-full py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium"
        >
          完成，返回總覽
        </button>
      </div>
    </div>
  )
}
                            </label>
                          </div>
                        )
                      }
                      if (f.field_type === 'text') {
                        return (
                          <div key={f.field_key}>
                            <p className="text-kiosk-sm text-gray-600 mb-1.5">{f.field_label}</p>
                            <input
                              type="text"
                              value={val || ''}
                              onChange={e => onChangeSubAnswer(s.session_id, f.field_key, e.target.value)}
                              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-kiosk-sm focus:outline-none focus:border-amber-400"
                            />
                          </div>
                        )
                      }
                      return null
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {errorMsg && (
        <p className="text-red-600 text-kiosk-sm bg-red-50 border border-red-300 rounded-xl px-4 py-3 mb-4">
          ⚠ {errorMsg}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium disabled:opacity-50"
        >
          ← 返回
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="flex-grow-[2] py-4 bg-amber-600 text-white rounded-2xl text-kiosk-base font-bold shadow-md disabled:opacity-50 active:scale-95 transition-transform"
        >
          {submitting ? '送出中…' : isUpdate ? '確認修改' : '確認報名'}
        </button>
      </div>
    </div>
  )
}

// ── 親友代報成功畫面 ────────────────────────────────────────
function FriendSuccessScreen({
  studentName, friendName, eventName,
  friendRegId, friendEventName, friendEventDate, friendEventLocation,
  onContinue, onDone,
}) {
  return (
    <div className="w-full max-w-lg text-center">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="text-kiosk-2xl font-bold text-gray-800 mb-2">代報完成！</h2>
      <p className="text-kiosk-base text-gray-600 mb-6">
        已為 <span className="font-bold text-purple-700">{friendName}</span> 完成報名
      </p>

      <div className="bg-white rounded-2xl shadow-md p-5 mb-6 text-left space-y-2">
        <p className="text-kiosk-sm text-gray-500">活動</p>
        <p className="text-kiosk-base font-semibold text-gray-800">{friendEventName || eventName}</p>
        {friendEventDate && (
          <p className="text-kiosk-sm text-gray-500">{friendEventDate}</p>
        )}
        {friendEventLocation && (
          <p className="text-kiosk-sm text-gray-500">{friendEventLocation}</p>
        )}
        <p className="text-kiosk-sm text-gray-400 mt-2">代報者：{studentName} 師兄</p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={onContinue}
          className="w-full py-4 bg-purple-600 text-white rounded-2xl text-kiosk-base font-bold shadow-md active:scale-95 transition-transform"
        >
          ＋ 再代報一位
        </button>
        <button
          onClick={onDone}
          className="w-full py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium"
        >
          完成，返回總覽
        </button>
      </div>
    </div>
  )
}
 </div>
      </div>
    </div>
  )
}
