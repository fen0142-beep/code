import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  getActiveEvents,
  getStudentById,
  getStudentEventStatuses,
  submitRegistration,
  updateRegistration,
  deleteRegistration,
  logRegistrationChange,
  submitFriendRegistration,
} from '../lib/supabase'
import DynamicForm from '../components/DynamicForm'
import CameraScanner from '../components/CameraScanner'
import { isDriverFromAnswers } from '../lib/registrationHelpers'

// ── QR Code 下載 ─────────────────────────────────────────────
// 把 <svg id> 轉成 PNG，給「下載個人 QR Card」按鈕用
function downloadQRPng(svgId, filename) {
  const svg = document.getElementById(svgId)
  if (!svg) return
  const xml = new XMLSerializer().serializeToString(svg)
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  const img = new Image()
  img.onload = () => {
    const size = 600
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, 0, 0, size, size)
    URL.revokeObjectURL(url)
    canvas.toBlob(blob => {
      if (!blob) return
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    }, 'image/png')
  }
  img.src = url
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

    // 學員資料與報名狀態並行查詢（code === student_id），減少等待時間
    const [studentResult, statusResult] = await Promise.all([
      getStudentById(code),
      getStudentEventStatuses(code, eventIds),
    ])

    const { student, classes, error } = studentResult
    if (error === 'NOT_FOUND') { setPhase('not_found'); scheduleAutoReset(4); return }
    if (error) { setPhase('error'); setErrorMsg(error); scheduleAutoReset(5); return }

    const { map: statusMap, error: statusErr } = statusResult

    setStudent(student)
    setClasses(classes)
    setStatuses(statusMap)
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
    setAnswers(reg?.answers || {})
    setErrorMsg('')
    setPhase('form')
    startFormTimer()
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
    setFriendAnswers({})
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
  student, classes, eventItems, statuses, showSuccess, successEventName,
  cancellingEventId, errorMsg, onSelectEvent, onRequestCancel, onConfirmCancel,
  onStartFriendFlow, onDone,
}) {
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

        {/* 個人 QR Code Accordion（學員證遺失時可下載備用） */}
        {student?.student_id && (
          <details className="mt-3 group">
            <summary className="cursor-pointer text-kiosk-sm text-blue-700 hover:text-blue-900 select-none list-none flex items-center gap-1">
              <span className="inline-block transition-transform group-open:rotate-90">▶</span>
              我的學員證 QR Code
            </summary>
            <div className="mt-3 flex flex-col sm:flex-row items-center gap-4 bg-gray-50 rounded-xl p-4">
              <QRCodeSVG
                id="kiosk-student-qr"
                value={String(student.student_id)}
                size={144}
                level="M"
                includeMargin
              />
              <div className="flex-1 min-w-0 text-center sm:text-left">
                <p className="text-kiosk-sm text-gray-500">學員編號</p>
                <p className="font-mono text-kiosk-base text-gray-800 break-all">{student.student_id}</p>
                <button
                  onClick={() => downloadQRPng('kiosk-student-qr', `${student.name || 'qr'}_${student.student_id}.png`)}
                  className="mt-3 inline-flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-xl text-kiosk-sm font-medium active:scale-95 transition-transform"
                >
                  📥 下載 QR Code（PNG）
                </button>
              </div>
            </div>
          </details>
        )}
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
          .map(({ event, fields }) => {
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
                  {/* 已報名則顯示報名資料摘要（依後台欄位順序） */}
                  {registered && !confirming && reg.answers && (() => {
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
                      <details className="mt-3 group" open>
                        <summary className="cursor-pointer text-kiosk-sm text-blue-700 hover:text-blue-900 select-none list-none flex items-center gap-1 mb-1">
                          <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                          <span>報名資料（共 {items.length} 項）</span>
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
                          onClick={() => onSelectEvent({ event, fields })}
                          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-kiosk-sm font-bold shadow active:scale-95 transition-transform"
                        >
                          立即報名
                        </button>
                      )}
                      {registered && !confirming && (
                        <button
                          onClick={() => onSelectEvent({ event, fields })}
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

      {/* 為親友代報區塊 */}
      {(() => {
        const hasOpenEvent = eventItems.some(({ event }) => !event.locked)
        if (!hasOpenEvent) return null
        return (
          <div className="bg-purple-50 border-2 border-purple-200 rounded-2xl p-4 mb-5">
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

// ── 親友代報：送出成功，連續代報入口 ────────────────────────
function FriendSuccessScreen({ studentName, friendName, eventName, onContinue, onDone }) {
  return (
    <div className="w-full max-w-lg">
      <div className="bg-green-50 border-2 border-green-400 rounded-2xl px-6 py-8 mb-5 text-center">
        <div className="text-6xl mb-3">✅</div>
        <p className="text-kiosk-xl font-bold text-green-800 mb-2">代報完成</p>
        <p className="text-kiosk-base text-gray-700">
          已成功為 <span className="font-bold text-purple-700">{friendName}</span> 報名
        </p>
        {eventName && (
          <p className="text-kiosk-sm text-gray-500 mt-1">{eventName}</p>
        )}
      </div>

      <div className="bg-purple-50 border-2 border-purple-200 rounded-2xl p-4 mb-4">
        <p className="text-kiosk-sm text-purple-700 leading-snug">
          {studentName} 師兄您好，要繼續為下一位親友代報嗎？
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onDone}
          className="flex-1 py-4 border-2 border-gray-300 rounded-2xl text-kiosk-base text-gray-600 font-medium active:scale-95 transition-transform"
        >
          ✓ 完成返回
        </button>
        <button
          onClick={onContinue}
          className="flex-grow-[2] py-4 bg-purple-600 text-white rounded-2xl text-kiosk-base font-bold shadow-md active:scale-95 transition-transform"
        >
          ＋ 再代報一位
        </button>
      </div>
    </div>
  )
}
