import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import {
  getAllEvents, getRegistrationForCheckin, getGuestRegistrationForCheckin,
  checkIn, uncheckIn, getCheckinStats, getRegistrationsWithStudents, getDonorForRegistration,
  getEventSessions, getSessionCheckinStats, getRegistrationForSessionCheckin,
  checkInSession, uncheckInSession,
  walkinRegister, walkinAddSession, getStudentById,
} from '../../lib/supabase'
import CameraScanner from '../../components/CameraScanner'

const IDLE_SECONDS = 5 // 成功/失敗畫面停留秒數

// ── 多場次 helper（與 EventDetailPage 同步）─────────────────
function timePeriodShort(tp)  { return { morning: '上', afternoon: '下', evening: '晚' }[tp] ?? tp }
function timePeriodLabel(tp)  { return { morning: '上午', afternoon: '下午', evening: '晚上' }[tp] ?? tp }
function formatSessionLabel(s) {
  if (!s?.date) return ''
  const [, mm, dd] = s.date.split('-')
  return `${parseInt(mm)}/${parseInt(dd)} ${timePeriodLabel(s.time_period)}`
}
// 場次選擇 localStorage key（同活動下次自動回到上次選的場次）
const sessionStorageKey = eventId => `puyi-checkin-session-${eventId}`

// 功德主紫色卡片：空白欄位不顯示
function DonorCard({ donor }) {
  if (!donor) return null
  const fields = [
    { label: '功德項目', value: donor.donor_item },
    { label: '座位',     value: donor.seat },
    { label: '胸花',     value: donor.corsage },
    { label: '供具',     value: donor.offering },
    { label: '備註',     value: donor.donor_note },
  ].filter(f => f.value && String(f.value).trim())
  if (fields.length === 0) return null
  return (
    <div className="mt-6 mx-auto max-w-md bg-purple-50 border-2 border-purple-300 rounded-2xl p-5 text-left shadow-sm">
      <p className="text-base font-bold text-purple-800 mb-3 flex items-center gap-2">
        🪷 法會功德主
      </p>
      <dl className="space-y-2 text-base">
        {fields.map(f => (
          <div key={f.label} className="grid grid-cols-[5.5rem,1fr] gap-2">
            <dt className="text-purple-600/80 font-medium">{f.label}</dt>
            <dd className="text-gray-800 font-semibold break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default function CheckinPage() {
  const { id } = useParams()
  const [event, setEvent]           = useState(null) // 活動完整資訊（含 multi_session）
  const [sessions, setSessions]     = useState([])   // 多場次：場次清單
  const [currentSessionId, setCurrentSessionId] = useState(null) // 多場次：當前報到場次
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
  const [status, setStatus] = useState('idle') // idle | loading | success | already | not_found | not_in_session | error
  const [result, setResult] = useState(null) // { name, checkedInAt, registrationId, regId }
  const [donor, setDonor]   = useState(null) // 功德主紀錄（紫色卡片）
  const [countdown, setCountdown] = useState(IDLE_SECONDS)
  const [todayCount, setTodayCount] = useState(0)

  const [cameraOpen, setCameraOpen] = useState(false)
  const [stats, setStats] = useState({ total: 0, checkedIn: 0, walkinCount: 0 })

  // 手動搜尋報到
  const [manualOpen, setManualOpen]     = useState(false)
  const [manualQuery, setManualQuery]   = useState('')
  const [allRegs, setAllRegs]           = useState([])

  const inputRef = useRef('')
  const countdownRef = useRef(null)

  const isMulti = !!event?.multi_session
  const currentSession = useMemo(
    () => sessions.find(s => s.session_id === currentSessionId) || null,
    [sessions, currentSessionId]
  )

  // 取得活動完整資訊 + 多場次場次清單
  useEffect(() => {
    getAllEvents().then(({ events }) => {
      const ev = events.find(e => e.event_id === id)
      if (ev) setEvent(ev)
    })
    // 多場次：載入場次清單（單場次活動取回空陣列也無妨）
    getEventSessions(id).then(({ sessions: ss }) => {
      const list = ss || []
      setSessions(list)
      // 預設場次：localStorage > 第一筆
      const saved = localStorage.getItem(sessionStorageKey(id))
      const valid = saved && list.some(s => s.session_id === saved)
      if (list.length > 0) {
        setCurrentSessionId(valid ? saved : list[0].session_id)
      }
    })
  }, [id])

  // 切換場次時記到 localStorage（下次回到同活動自動帶）
  useEffect(() => {
    if (currentSessionId) localStorage.setItem(sessionStorageKey(id), currentSessionId)
  }, [id, currentSessionId])

  // 取得報到統計（多場次依場次、單場次依活動）
  const refreshStats = useCallback(async () => {
    if (isMulti && currentSessionId) {
      const s = await getSessionCheckinStats(id, currentSessionId)
      setStats({ total: s.total, checkedIn: s.checkedIn, walkinCount: s.walkinCount || 0 })
    } else if (!isMulti) {
      const s = await getCheckinStats(id)
      setStats({ total: s.total, checkedIn: s.checkedIn, walkinCount: s.walkinCount || 0 })
    }
    // 同步刷新手動搜尋清單，反映最新報到狀態
    const { registrations } = await getRegistrationsWithStudents(id)
    setAllRegs(registrations || [])
  }, [id, isMulti, currentSessionId])

  useEffect(() => { refreshStats() }, [refreshStats])

  // 載入完整報名清單（給手動搜尋用）
  const loadAllRegs = useCallback(async () => {
    const { registrations } = await getRegistrationsWithStudents(id)
    setAllRegs(registrations || [])
  }, [id])

  useEffect(() => { loadAllRegs() }, [loadAllRegs])

  // 篩選清單
  const filteredRegs = useMemo(() => {
    const q = manualQuery.trim().toLowerCase()
    if (!q) return allRegs
    return allRegs.filter(r => {
      const name = r.students?.name ?? r.answers?.guest_name ?? ''
      const sid  = r.student_id ?? ''
      const cls  = (r.students?.student_classes ?? []).map(c => `${c.class_name}${c.group_name ?? ''}`).join(' ')
      return `${name} ${sid} ${cls}`.toLowerCase().includes(q)
    })
  }, [allRegs, manualQuery])

  function pickManual(reg) {
    setManualOpen(false)
    setManualQuery('')
    // 學員用 student_id 走原流程，訪客用 registration_id（會落到 guest 分支）
    handleScan(reg.student_id ?? reg.registration_id)
  }

  // 監聽鍵盤輸入（掃描機模擬鍵盤）
  useEffect(() => {
    function onKey(e) {
      if (status === 'loading') return
      if (e.key === 'Enter') {
        const val = inputRef.current.trim()
        inputRef.current = ''
        if (val) handleScan(val)
      } else if (e.key.length === 1) {
        inputRef.current += e.key
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status]) // eslint-disable-line

  const resetToIdle = useCallback(() => {
    clearInterval(countdownRef.current)
    setStatus('idle')
    setResult(null)
    setDonor(null)
    setCountdown(IDLE_SECONDS)
  }, [])

  function startCountdown() {
    setCountdown(IDLE_SECONDS)
    clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current)
          resetToIdle()
          return IDLE_SECONDS
        }
        return prev - 1
      })
    }, 1000)
  }

  async function handleScan(scanned) {
    setStatus('loading')
    clearInterval(countdownRef.current)

    // ── 多場次活動：走 getRegistrationForSessionCheckin（三狀態 + 強制報到）──
    if (isMulti) {
      if (!currentSessionId) {
        setStatus('error')
        setResult(null)
        startCountdown()
        return
      }
      const res = await getRegistrationForSessionCheckin(id, scanned, currentSessionId)

      if (res.state === 'error') {
        setStatus('error')
        setResult(null)
        startCountdown()
        return
      }
      if (res.state === 'not_registered') {
        // 自由刷卡模式：直接自動記錄，不顯示紅卡
        if (event?.walkin_mode) {
          const stu = await getStudentById(scanned).catch(() => null)
          const name = stu?.student?.name || scanned
          const { success } = await walkinRegister(id, scanned, { isMulti: true, sessionId: currentSessionId, terminal: 'admin-checkin' })
          if (success) {
            setTodayCount(c => c + 1)
            refreshStats()
            setStatus('success')
            setResult({ name })
          } else {
            setStatus('error')
            setResult(null)
          }
          startCountdown()
          return
        }
        // 多場活動完全沒報過 → 共用 not_found UI，但補學員資料給「現場報名」按鈕用
        setStatus('not_found')
        const stu = await getStudentById(scanned).catch(() => null)
        setResult(stu?.student ? {
          name: stu.student.name,
          studentId: scanned,
        } : null)
        startCountdown()
        return
      }

      // 查功德主紀錄（多場次活動目前不一定有，但保留邏輯）
      const { donor: donorRec } = await getDonorForRegistration(
        id,
        res.isGuest ? null : res.registration.student_id,
        res.isGuest ? res.name : null,
      )
      setDonor(donorRec || null)

      if (res.state === 'already') {
        setStatus('already')
        setResult({
          name: res.name,
          checkedInAt: res.checkedInAt,
          regId: res.registration.registration_id,
        })
        startCountdown()
        return
      }
      if (res.state === 'not_in_session') {
        // 紅卡：已報活動但未勾此場次，提供「現場補報此場次」按鈕（補報名 + 自動打卡）
        setStatus('not_in_session')
        setResult({
          name: res.name,
          regId: res.registration.registration_id,
          currentAnswers: res.registration.answers || {},
        })
        startCountdown()
        return
      }
      // state === 'success' → 立即寫入 session_checkin
      const { success } = await checkInSession(res.registration.registration_id, currentSessionId)
      if (success) {
        setTodayCount(c => c + 1)
        refreshStats()
        setStatus('success')
        setResult({ name: res.name, regId: res.registration.registration_id })
        startCountdown()
      } else {
        setStatus('error')
        setResult(null)
        startCountdown()
      }
      return
    }

    // ── 單場次活動：原邏輯 ──
    // 先用學員編號查
    let { registration, error } = await getRegistrationForCheckin(id, scanned)
    let isGuest = false

    // 找不到學員報名 → 再試當訪客報名 ID 查
    if (error === 'NOT_REGISTERED') {
      const guestResult = await getGuestRegistrationForCheckin(id, scanned)
      registration = guestResult.registration
      error = guestResult.error
      isGuest = true
    }

    if (error === 'NOT_REGISTERED') {
      // 自由刷卡模式：直接自動記錄，不顯示紅卡
      if (event?.walkin_mode) {
        const stu = await getStudentById(scanned).catch(() => null)
        const name = stu?.student?.name || scanned
        const { success } = await walkinRegister(id, scanned, { terminal: 'admin-checkin' })
        if (success) {
          setTodayCount(c => c + 1)
          refreshStats()
          setStatus('success')
          setResult({ name })
        } else {
          setStatus('error')
          setResult(null)
        }
        startCountdown()
        return
      }
      // 單場活動沒報過 → 補學員資料給「現場報名」按鈕用
      setStatus('not_found')
      const stu = await getStudentById(scanned).catch(() => null)
      setResult(stu?.student ? {
        name: stu.student.name,
        studentId: scanned,
      } : null)
      startCountdown()
      return
    }
    if (error) {
      setStatus('error')
      setResult(null)
      startCountdown()
      return
    }

    const name = isGuest
      ? (registration.answers?.host_name
          ? `${registration.answers?.guest_name ?? '訪客'}（${registration.answers.host_name} 親友）`
          : (registration.answers?.guest_name ?? '訪客'))
      : (registration.students?.name ?? scanned)

    // 查功德主紀錄（學員型用 student_id、訪客型用 name；查不到回 null）
    const { donor: donorRec } = await getDonorForRegistration(
      id,
      isGuest ? null : registration.student_id,
      isGuest ? name : null,
    )
    setDonor(donorRec || null)

    if (registration.checked_in_at) {
      setStatus('already')
      setResult({ name, checkedInAt: registration.checked_in_at, registrationId: registration.registration_id })
      startCountdown()
      return
    }

    const { success } = await checkIn(registration.registration_id)
    if (success) {
      setTodayCount(c => c + 1)
      refreshStats()
      setStatus('success')
      setResult({ name, registrationId: registration.registration_id })
      startCountdown()
    } else {
      setStatus('error')
      setResult(null)
      startCountdown()
    }
  }

  // 現場補報此場次（多場次紅卡 not_in_session）：
  // 把 sessionId push 進 answers.sessions + 同時打卡，一步完成。取代舊「強制報到」按鈕。
  async function handleWalkinAddSession() {
    if (!result?.regId || !currentSessionId) return
    setStatus('loading')
    const { success, error } = await walkinAddSession(
      result.regId,
      currentSessionId,
      result.currentAnswers || {}
    )
    if (success) {
      setTodayCount(c => c + 1)
      refreshStats()
      setStatus('success')
      // result.name 沿用
      startCountdown()
    } else {
      console.error('[walkinAddSession]', error)
      setStatus('error')
      setResult(null)
      startCountdown()
    }
  }

  // 現場報名（單場 not_found / 多場 not_registered 紅卡）：
  // 寫新 registration（source='walkin'）+ 自動打卡
  async function handleWalkinRegister() {
    if (!result?.studentId) return
    setStatus('loading')
    const { success, error } = await walkinRegister(id, result.studentId, {
      isMulti,
      sessionId: isMulti ? currentSessionId : undefined,
    })
    if (success) {
      setTodayCount(c => c + 1)
      refreshStats()
      setStatus('success')
      // result.name 沿用
      startCountdown()
    } else {
      console.error('[walkinRegister]', error)
      setStatus('error')
      setResult(null)
      startCountdown()
    }
  }

  async function handleUncheck() {
    if (isMulti) {
      if (!result?.regId || !currentSessionId) return
      await uncheckInSession(result.regId, currentSessionId)
    } else {
      if (!result?.registrationId) return
      await uncheckIn(result.registrationId)
    }
    refreshStats()
    resetToIdle()
  }

  function handleCameraScan(code) {
    setCameraOpen(false)
    handleScan(code)
  }

  return (
    <AdminLayout>
      {/* 相機掃描覆蓋層 */}
      {cameraOpen && (
        <CameraScanner
          onScan={handleCameraScan}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* 手動搜尋報到 modal */}
      {manualOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
            <div className="px-5 pt-5 pb-3 border-b">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-lg font-bold text-gray-800">🔍 手動搜尋報到</h3>
                <button
                  onClick={() => { setManualOpen(false); setManualQuery('') }}
                  className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
                >×</button>
              </div>
              <input
                autoFocus
                value={manualQuery}
                onChange={e => setManualQuery(e.target.value)}
                placeholder="輸入姓名、學員編號或班級…"
                className="w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              <div className="text-xs text-gray-400 mt-2">
                共 {filteredRegs.length} 筆
                {!isMulti && <> / 已報到 {filteredRegs.filter(r => r.checked_in_at).length} 筆</>}
                {isMulti && <span className="ml-2 text-amber-600">（多場次：請刷卡確認此場次狀態）</span>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y">
              {filteredRegs.length === 0 ? (
                <div className="text-center text-gray-400 py-12 text-sm">無符合的報名紀錄</div>
              ) : (
                filteredRegs.map(r => {
                  const guestNameLabel = r.answers?.host_name
                    ? `${r.answers?.guest_name ?? '訪客'}（${r.answers.host_name} 親友）`
                    : (r.answers?.guest_name ?? '訪客')
                  const name  = r.students?.name ?? guestNameLabel
                  const sid   = r.student_id ?? ''
                  const cls   = (r.students?.student_classes ?? [])
                    .map(c => c.class_name + (c.group_name ? ' ' + c.group_name : ''))
                    .join(' / ')
                  const isGuestReg = !r.student_id
                  // 單場次：依 checked_in_at；多場次：不顯示 badge（需逐場確認，刷卡後自然分流）
                  const checked = !isMulti && !!r.checked_in_at
                  return (
                    <button
                      key={r.registration_id}
                      onClick={() => pickManual(r)}
                      className={`w-full text-left px-4 py-3 hover:bg-amber-50 active:bg-amber-100 transition-colors ${checked ? 'bg-green-50/50' : ''}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800">{name}</span>
                        {isGuestReg && <span className="text-xs bg-blue-100 text-blue-600 rounded-full px-1.5">訪客</span>}
                        {checked && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">已報到</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-2">
                        {sid && <span>編號：{sid}</span>}
                        {cls && <span>{cls}</span>}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* 場次選擇 modal（多場次活動才有）*/}
      {sessionPickerOpen && isMulti && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-start sm:items-center justify-center p-3 sm:p-6">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl">
            <div className="px-5 pt-5 pb-3 border-b flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">切換報到場次</h3>
              <button onClick={() => setSessionPickerOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto divide-y">
              {sessions.length === 0 ? (
                <div className="text-center text-gray-400 py-12 text-sm">此活動尚無場次</div>
              ) : (
                sessions.map(s => {
                  const on = s.session_id === currentSessionId
                  return (
                    <button
                      key={s.session_id}
                      onClick={() => { setCurrentSessionId(s.session_id); setSessionPickerOpen(false); resetToIdle() }}
                      className={`w-full text-left px-5 py-3 transition-colors ${on ? 'bg-green-50' : 'hover:bg-amber-50 active:bg-amber-100'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800">{formatSessionLabel(s)}</span>
                        {on && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">目前</span>}
                      </div>
                      {s.dharma_name && <p className="text-xs text-gray-500 mt-0.5">{s.dharma_name}</p>}
                      {s.time_start && s.time_end && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {s.time_start.slice(0,5)}–{s.time_end.slice(0,5)}
                        </p>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* 頂列 */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/admin/events/${id}`}
          className="text-sm text-gray-500 hover:text-amber-700 transition-colors"
        >
          ← 返回活動
        </Link>
        <span className="text-gray-300">|</span>
        <h2 className="text-lg font-bold text-gray-800">{event?.name || '現場報到'}</h2>
        <span className="ml-auto text-sm text-gray-500 flex items-center gap-2 flex-wrap justify-end">
          <span className="flex items-center gap-1">
            {isMulti && currentSessionId ? '本場次 ' : ''}已報到
            <strong className="text-amber-700 text-base">{stats.checkedIn}</strong>
            <span className="text-gray-400">/</span>
            <strong className="text-gray-700 text-base">{stats.total}</strong>
            人
          </span>
          {stats.walkinCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700"
              title="刷卡時不在名單上、現場補報名的人數"
            >
              現場 <strong>{stats.walkinCount}</strong>
            </span>
          )}
        </span>
      </div>

      {/* 多場次：場次切換 banner */}
      {isMulti && (
        <div className="mb-5 px-4 py-3 bg-green-50 border-2 border-green-300 rounded-xl flex items-center gap-3 sticky top-0 z-20 shadow-sm">
          <span className="text-2xl">🟢</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-green-700 font-medium">目前報到場次</p>
            <p className="text-base font-bold text-green-900 truncate">
              {currentSession
                ? formatSessionLabel(currentSession) + (currentSession.dharma_name ? ` ・ ${currentSession.dharma_name}` : '')
                : '尚未選擇場次'}
            </p>
          </div>
          <button
            onClick={() => setSessionPickerOpen(true)}
            className="text-sm font-medium px-3 py-1.5 bg-white border border-green-400 text-green-700 hover:bg-green-100 rounded-lg shrink-0"
          >
            切換場次 ▾
          </button>
        </div>
      )}

      {/* 主顯示區 */}
      <div className="flex flex-col items-center justify-center min-h-[60vh]">

        {status === 'idle' && (
          <div className="text-center">
            <div className="text-8xl mb-6 animate-pulse">📷</div>
            <p className="text-2xl font-bold text-gray-700">請刷學員證</p>
            <p className="text-sm text-gray-400 mt-3 mb-8">掃描機刷卡後自動報到</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => setCameraOpen(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white border-2 border-amber-400 text-amber-700 rounded-xl text-base font-semibold shadow-sm active:scale-95 transition-transform"
              >
                <span className="text-xl">📱</span>
                用手機相機掃描
              </button>
              <button
                onClick={() => { setManualQuery(''); setManualOpen(true) }}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-xl text-base font-semibold shadow-sm active:scale-95 transition-transform"
              >
                <span className="text-xl">🔍</span>
                手動搜尋報到
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-3">忘記帶學員證可直接搜尋姓名</p>
          </div>
        )}

        {status === 'loading' && (
          <div className="text-center">
            <div className="text-6xl mb-4 animate-spin">⏳</div>
            <p className="text-xl text-gray-500">確認中…</p>
          </div>
        )}

        {status === 'success' && result && (
          <div className="text-center">
            <div className="text-8xl mb-6">✅</div>
            <p className="text-4xl font-bold text-green-700 mb-2">{result.name}</p>
            <p className="text-xl text-green-600">報到成功！</p>
            <DonorCard donor={donor} />
            <p className="text-sm text-gray-400 mt-4">{countdown} 秒後自動重置</p>
            <button
              onClick={resetToIdle}
              className="mt-4 text-xs text-gray-400 hover:text-gray-600 underline"
            >
              立即重置
            </button>
          </div>
        )}

        {status === 'already' && result && (
          <div className="text-center">
            <div className="text-8xl mb-6">⚠️</div>
            <p className="text-4xl font-bold text-amber-700 mb-2">{result.name}</p>
            <p className="text-xl text-amber-600">已於 {new Date(result.checkedInAt).toLocaleTimeString('zh-TW', { hour12: false })} 報到過</p>
            <DonorCard donor={donor} />
            <div className="flex gap-3 justify-center mt-5">
              <button
                onClick={handleUncheck}
                className="text-sm text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-4 py-2 rounded-lg transition-colors"
              >
                取消報到
              </button>
              <button
                onClick={resetToIdle}
                className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-4 py-2 rounded-lg transition-colors"
              >
                返回（{countdown}s）
              </button>
            </div>
          </div>
        )}

        {status === 'not_found' && (
          <div className="text-center">
            {result?.studentId ? (
              <>
                {/* 找到學員，但尚未報名本活動 → 提供「現場報名」按鈕 */}
                <div className="text-8xl mb-6">📝</div>
                <p className="text-4xl font-bold text-rose-700 mb-2">{result.name}</p>
                <p className="text-lg text-rose-600">尚未報名本活動</p>
                {isMulti && (
                  <p className="text-sm text-gray-500 mt-1">
                    （將補報此場次：{currentSession ? formatSessionLabel(currentSession) : '—'}）
                  </p>
                )}
                <div className="flex gap-3 justify-center mt-5 flex-wrap">
                  <button
                    onClick={handleWalkinRegister}
                    className="text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 px-5 py-2.5 rounded-lg transition-colors shadow-sm"
                  >
                    📝 現場報名{isMulti ? '此場次' : ''}（自動報到）
                  </button>
                  <button
                    onClick={resetToIdle}
                    className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-4 py-2 rounded-lg transition-colors"
                  >
                    返回（{countdown}s）
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* 完全找不到學員（編號不存在 / 不在籍）→ 維持原本警示，避免亂掃外人卡也能補報 */}
                <div className="text-8xl mb-6">❓</div>
                <p className="text-2xl font-bold text-gray-500 mb-2">找不到此學員</p>
                <p className="text-gray-400">此學員編號未在學員資料庫</p>
                <p className="text-sm text-gray-400 mt-4">{countdown} 秒後自動重置</p>
                <button onClick={resetToIdle} className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline">立即重置</button>
              </>
            )}
          </div>
        )}

        {status === 'not_in_session' && result && (
          <div className="text-center">
            <div className="text-8xl mb-6">⛔</div>
            <p className="text-4xl font-bold text-red-700 mb-2">{result.name}</p>
            <p className="text-lg text-red-600">⚠️ 該學員未報名此場次</p>
            <p className="text-sm text-gray-500 mt-1">
              （目前場次：{currentSession ? formatSessionLabel(currentSession) : '—'}）
            </p>
            <div className="flex gap-3 justify-center mt-5 flex-wrap">
              <button
                onClick={handleWalkinAddSession}
                className="text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 px-5 py-2.5 rounded-lg transition-colors shadow-sm"
              >
                📝 現場補報此場次（自動報到）
              </button>
              <button
                onClick={resetToIdle}
                className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-4 py-2 rounded-lg transition-colors"
              >
                返回（{countdown}s）
              </button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="text-8xl mb-6">🔴</div>
            <p className="text-2xl font-bold text-red-500 mb-2">發生錯誤</p>
            <p className="text-sm text-gray-400 mt-4">{countdown} 秒後自動重置</p>
            <button onClick={resetToIdle} className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline">立即重置</button>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
