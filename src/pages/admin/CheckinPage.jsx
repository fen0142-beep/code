import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import { getAllEvents, getRegistrationForCheckin, getGuestRegistrationForCheckin, checkIn, uncheckIn, getCheckinStats, getRegistrationsWithStudents, getDonorForRegistration } from '../../lib/supabase'
import CameraScanner from '../../components/CameraScanner'

const IDLE_SECONDS = 5 // 成功/失敗畫面停留秒數

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
  const [eventName, setEventName] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | success | already | not_found | error
  const [result, setResult] = useState(null) // { name, checkedInAt, registrationId }
  const [donor, setDonor]   = useState(null) // 功德主紀錄（紫色卡片）
  const [countdown, setCountdown] = useState(IDLE_SECONDS)
  const [todayCount, setTodayCount] = useState(0)

  const [cameraOpen, setCameraOpen] = useState(false)
  const [stats, setStats] = useState({ total: 0, checkedIn: 0 })

  // 手動搜尋報到
  const [manualOpen, setManualOpen]     = useState(false)
  const [manualQuery, setManualQuery]   = useState('')
  const [allRegs, setAllRegs]           = useState([])

  const inputRef = useRef('')
  const countdownRef = useRef(null)

  // 取得活動名稱
  useEffect(() => {
    getAllEvents().then(({ events }) => {
      const ev = events.find(e => e.event_id === id)
      if (ev) setEventName(ev.name)
    })
  }, [id])

  // 取得報到統計（並在 id 改變時重新取）
  async function refreshStats() {
    const s = await getCheckinStats(id)
    setStats({ total: s.total, checkedIn: s.checkedIn })
    // 同步刷新手動搜尋清單，反映最新報到狀態
    const { registrations } = await getRegistrationsWithStudents(id)
    setAllRegs(registrations || [])
  }

  useEffect(() => { refreshStats() }, [id]) // eslint-disable-line

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
      setStatus('not_found')
      setResult(null)
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

  async function handleUncheck() {
    if (!result?.registrationId) return
    await uncheckIn(result.registrationId)
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
                共 {filteredRegs.length} 筆 / 已報到 {filteredRegs.filter(r => r.checked_in_at).length} 筆
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
                  const checked = !!r.checked_in_at
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

      {/* 頂列 */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/admin/events/${id}`}
          className="text-sm text-gray-500 hover:text-amber-700 transition-colors"
        >
          ← 返回活動
        </Link>
        <span className="text-gray-300">|</span>
        <h2 className="text-lg font-bold text-gray-800">{eventName || '現場報到'}</h2>
        <span className="ml-auto text-sm text-gray-500 flex items-center gap-1">
          已報到
          <strong className="text-amber-700 text-base">{stats.checkedIn}</strong>
          <span className="text-gray-400">/</span>
          <strong className="text-gray-700 text-base">{stats.total}</strong>
          人
        </span>
      </div>

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
            <div className="text-8xl mb-6">❓</div>
            <p className="text-2xl font-bold text-gray-500 mb-2">找不到此學員</p>
            <p className="text-gray-400">此學員尚未報名本活動</p>
            <p className="text-sm text-gray-400 mt-4">{countdown} 秒後自動重置</p>
            <button onClick={resetToIdle} className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline">立即重置</button>
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
