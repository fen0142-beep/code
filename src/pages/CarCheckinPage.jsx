import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import CameraScanner from '../components/CameraScanner'
import {
  getCarByToken,
  getHeadLeaderByToken,
  getAllCarsProgress,
  getAllSmallCarsProgress,
  checkIn,
  checkInAllCar,
  uncheckIn,
  checkInMonk,
  uncheckInMonk,
} from '../lib/supabase'

// ─── 工具 ──────────────────────────────────────────────────

const getMemberName = (member) =>
  member?.registrations?.students?.name ??
  member?.registrations?.answers?.guest_name ??
  '訪客'

const isGuest = (member) => !member?.registrations?.student_id

const isCheckedIn = (member) => !!member?.registrations?.checked_in_at

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

// 判斷是否提前上山（任一答案日期早於活動起始日）
// 回傳 "X月X日已上山" 字串，或 null
function getPreArriveInfo(answers, eventDateStart) {
  if (!answers || !eventDateStart) return null
  const eventDate = eventDateStart.slice(0, 10) // 'YYYY-MM-DD'
  for (const val of Object.values(answers)) {
    if (typeof val !== 'string') continue
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/)
    if (!m) continue
    if (m[1] < eventDate) {
      const d = new Date(m[1] + 'T00:00:00')
      return `${d.getMonth() + 1}月${d.getDate()}日已上山`
    }
  }
  return null
}

// ─── 共用：掃描訊息 ──────────────────────────────────────────

function ScanToast({ msg }) {
  if (!msg) return null
  const isOk = msg.startsWith('✓')
  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg border whitespace-nowrap ${
        isOk
          ? 'bg-green-100 text-green-800 border-green-300'
          : 'bg-red-100 text-red-700 border-red-300'
      }`}
    >
      {msg}
    </div>
  )
}

// ─── 主頁面 ───────────────────────────────────────────────

export default function CarCheckinPage() {
  const { token } = useParams()

  const [loading, setLoading]     = useState(true)
  const [mode, setMode]           = useState(null)   // 'car' | 'head' | 'small_car' | 'invalid'

  // car mode
  const [car, setCar]             = useState(null)

  // head mode
  const [headLeader, setHeadLeader] = useState(null)
  const [allCars, setAllCars]     = useState([])
  const [expandedCarId, setExpandedCarId] = useState(null)
  const [expandedSmallCarId, setExpandedSmallCarId] = useState(null)

  // 共用
  const [scanMsg, setScanMsg]     = useState('')
  const [showCamera, setShowCamera] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // 硬體掃描機
  const scanBufRef  = useRef('')
  const scanTimerRef = useRef(null)

  // ── 載入 ──
  useEffect(() => { load() }, [token])

  async function load() {
    setLoading(true)
    const [carRes, hlRes] = await Promise.all([
      getCarByToken(token),
      getHeadLeaderByToken(token),
    ])

    if (carRes.car) {
      setMode('car')
      // 提前上山者自動標記為已報到（靜默執行）
      const dateStart = carRes.car.events?.date_start
      const toAutoCheck = (carRes.car.car_members ?? []).filter(m =>
        !m.registrations?.checked_in_at &&
        getPreArriveInfo(m.registrations?.answers, dateStart)
      )
      if (toAutoCheck.length > 0) {
        await Promise.all(toAutoCheck.map(m => checkIn(m.registration_id)))
        const { car: fresh } = await getCarByToken(token)
        setCar(fresh ?? carRes.car)
      } else {
        setCar(carRes.car)
      }
    } else if (hlRes.headLeader) {
      const leaderType = hlRes.headLeader.type ?? 'all'
      setMode(leaderType === 'small_car' ? 'small_car' : 'head')
      setHeadLeader(hlRes.headLeader)
      const eventId = hlRes.headLeader.events?.event_id ?? hlRes.headLeader.event_id
      const { cars } = leaderType === 'small_car'
        ? await getAllSmallCarsProgress(eventId)
        : await getAllCarsProgress(eventId)
      // 提前上山者自動標記為已報到（靜默執行）
      const dateStart = hlRes.headLeader.events?.date_start
      const toAutoCheck = (cars ?? []).flatMap(c => c.car_members ?? []).filter(m =>
        !m.registrations?.checked_in_at &&
        getPreArriveInfo(m.registrations?.answers, dateStart)
      )
      if (toAutoCheck.length > 0) {
        await Promise.all(toAutoCheck.map(m => checkIn(m.registration_id)))
        const { cars: fresh } = leaderType === 'small_car'
          ? await getAllSmallCarsProgress(eventId)
          : await getAllCarsProgress(eventId)
        setAllCars(fresh ?? cars)
      } else {
        setAllCars(cars)
      }
    } else {
      setMode('invalid')
    }
    setLoading(false)
  }

  // ── 重新整理 ──
  const refresh = useCallback(async () => {
    setRefreshing(true)
    if (mode === 'car') {
      const { car: updated } = await getCarByToken(token)
      if (updated) setCar(updated)
    } else if (mode === 'head') {
      const eventId = headLeader?.events?.event_id ?? headLeader?.event_id
      const { cars } = await getAllCarsProgress(eventId)
      setAllCars(cars)
    } else if (mode === 'small_car') {
      const eventId = headLeader?.events?.event_id ?? headLeader?.event_id
      const { cars } = await getAllSmallCarsProgress(eventId)
      setAllCars(cars)
    }
    setRefreshing(false)
  }, [mode, token, headLeader])

  // ── 自動每 30 秒重新整理 ──
  useEffect(() => {
    if (!mode || mode === 'invalid' || mode === 'loading') return
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [mode, refresh])

  // ── 硬體掃描機監聽 ──
  useEffect(() => {
    function handleKeyPress(e) {
      if (showCamera) return
      if (e.key === 'Enter') {
        const code = scanBufRef.current.trim()
        scanBufRef.current = ''
        clearTimeout(scanTimerRef.current)
        if (code) handleScanCode(code)
      } else if (e.key.length === 1) {
        scanBufRef.current += e.key
        clearTimeout(scanTimerRef.current)
        scanTimerRef.current = setTimeout(() => { scanBufRef.current = '' }, 300)
      }
    }
    window.addEventListener('keypress', handleKeyPress)
    return () => window.removeEventListener('keypress', handleKeyPress)
  }, [mode, car, allCars, showCamera])

  // ── 掃描處理 ──
  async function handleScanCode(code) {
    let found = null
    let foundCar = null

    if (mode === 'car' && car) {
      found = (car.car_members ?? []).find(
        m => m.registrations?.student_id === code || m.registration_id === code
      )
      if (found) foundCar = car
    } else if (mode === 'head' || mode === 'small_car') {
      for (const c of allCars) {
        found = (c.car_members ?? []).find(
          m => m.registrations?.student_id === code || m.registration_id === code
        )
        if (found) { foundCar = c; break }
      }
    }

    if (!found) {
      showMsg('找不到此學員（不在本車名單內）')
      return
    }

    const name = getMemberName(found)
    await checkIn(found.registration_id)
    showMsg(`✓ ${name} 報到完成`)
    await refresh()
  }

  function showMsg(text, ms = 3000) {
    setScanMsg(text)
    setTimeout(() => setScanMsg(''), ms)
  }

  // ── 手動點選報到 ──
  async function handleToggleCheckin(registrationId, checkedAt) {
    if (checkedAt) {
      await uncheckIn(registrationId)
    } else {
      await checkIn(registrationId)
    }
    await refresh()
  }

  // ── 法師手動點選報到（無 QR code） ──
  async function handleToggleMonkCheckin(carMonkId, checkedAt) {
    if (checkedAt) {
      await uncheckInMonk(carMonkId)
    } else {
      await checkInMonk(carMonkId)
    }
    await refresh()
  }

  // ── 畫面 ──

  if (loading) return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center">
      <div className="text-amber-700 text-xl animate-pulse">載入中…</div>
    </div>
  )

  if (mode === 'invalid') return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center p-8">
      <div className="text-center">
        <div className="text-5xl mb-4">🔒</div>
        <div className="text-xl font-semibold text-gray-700 mb-2">連結無效或已過期</div>
        <div className="text-gray-500 text-sm">請向師父索取正確的報到連結</div>
      </div>
    </div>
  )

  // ════════════════════════════════════════
  //  大車領隊模式
  // ════════════════════════════════════════

  if (mode === 'car' && car) {
    const members       = car.car_members ?? []
    const monks         = car.car_monks ?? []
    const dateStart     = car.events?.date_start
    const memberCheckedIn = members.filter(isCheckedIn).length
    const monkCheckedIn   = monks.filter(m => !!m.checked_in_at).length
    const checkedIn     = memberCheckedIn + monkCheckedIn
    const total         = members.length + monks.length
    const eventName     = car.events?.name ?? ''
    const eventDate     = formatDate(dateStart)
    const pct           = total > 0 ? Math.round((checkedIn / total) * 100) : 0

    // 未報到在前、已報到在後
    const sorted = [...members].sort((a, b) => {
      const ai = isCheckedIn(a) ? 1 : 0
      const bi = isCheckedIn(b) ? 1 : 0
      return ai - bi
    })

    return (
      <div className="min-h-screen bg-amber-50 pb-24">
        <ScanToast msg={scanMsg} />

        {/* Header */}
        <div className="bg-amber-700 text-white px-4 py-5 shadow-md">
          <div className="max-w-lg mx-auto">
            <div className="text-xs opacity-75 mb-0.5">{eventName}　{eventDate}</div>
            <div className="text-xl font-bold">{car.car_name} 報到</div>
            <div className="flex items-end gap-2 mt-3">
              <span className="text-4xl font-bold leading-none">{checkedIn}</span>
              <span className="text-base opacity-75 pb-0.5">/ {total} 人　{pct}%</span>
            </div>
            <div className="mt-2 bg-white/30 rounded-full h-2.5">
              <div
                className="bg-white rounded-full h-2.5 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* 掃描按鈕 */}
        <div className="px-4 pt-4 max-w-lg mx-auto">
          <button
            onClick={() => setShowCamera(true)}
            className="w-full py-3 bg-white border-2 border-amber-400 rounded-xl text-amber-700 font-semibold text-sm hover:bg-amber-50 active:bg-amber-100 transition-colors shadow-sm"
          >
            📷 用相機掃描學員證
          </button>
          <p className="text-center text-xs text-gray-400 mt-1.5">
            硬體掃描機直接對著螢幕掃即可
          </p>
        </div>

        {/* 成員清單 */}
        <div className="px-4 pt-3 max-w-lg mx-auto space-y-2">
          {sorted.map(member => {
            const name       = getMemberName(member)
            const guest      = isGuest(member)
            const checked    = isCheckedIn(member)
            const isLeader   = (car.car_leaders ?? []).some(
              l => l.registration_id === member.registration_id
            )

            return (
              <div
                key={member.registration_id}
                className={`flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-sm border transition-opacity ${
                  checked ? 'border-green-200 opacity-60' : 'border-gray-200'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`font-medium truncate ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {name}
                    </span>
                    {isLeader && (
                      <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">
                        領隊
                      </span>
                    )}
                    {guest && (
                      <span className="text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 shrink-0">
                        訪客
                      </span>
                    )}
                    {getPreArriveInfo(member.registrations?.answers, dateStart) && (
                      <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">
                        {getPreArriveInfo(member.registrations?.answers, dateStart)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                  className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    checked
                      ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500'
                      : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                  }`}
                >
                  {checked ? '已到' : '報到'}
                </button>
              </div>
            )
          })}

          {members.length === 0 && monks.length === 0 && (
            <div className="text-center text-gray-400 py-12 text-sm">此車目前無成員</div>
          )}

          {/* 法師列表（無 QR code，手動點選） */}
          {monks.length > 0 && (
            <div className="mt-2">
              <div className="text-xs text-purple-400 px-1 mb-1.5">法師（手動點選報到）</div>
              {monks.map(cm => {
                const chk = !!cm.checked_in_at
                return (
                  <div
                    key={cm.id}
                    className={`flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-sm border mb-2 transition-opacity ${
                      chk ? 'border-green-200 opacity-60' : 'border-purple-200'
                    }`}
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className={`font-medium ${chk ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {cm.temple_monks?.name ?? '（未知）'}
                      </span>
                      <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-1.5 shrink-0">法師</span>
                    </div>
                    <button
                      onClick={() => handleToggleMonkCheckin(cm.id, cm.checked_in_at)}
                      className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                        chk
                          ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500'
                          : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                      }`}
                    >
                      {chk ? '已到' : '報到'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 重新整理按鈕 */}
        <button
          onClick={refresh}
          disabled={refreshing}
          className="fixed bottom-6 right-4 w-12 h-12 bg-white border shadow-lg rounded-full flex items-center justify-center text-lg text-gray-500 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 transition-all"
          title="重新整理"
        >
          {refreshing ? '…' : '🔄'}
        </button>

        {/* 相機 */}
        {showCamera && (
          <CameraScanner
            onScan={code => { setShowCamera(false); handleScanCode(code) }}
            onClose={() => setShowCamera(false)}
          />
        )}
      </div>
    )
  }

  // ════════════════════════════════════════
  //  小車領隊模式
  // ════════════════════════════════════════

  if (mode === 'small_car') {
    const eventName  = headLeader?.events?.name ?? ''
    const dateStart  = headLeader?.events?.date_start
    const eventDate  = formatDate(dateStart)
    const totalAll   = allCars.reduce((s, c) => s + (c.car_members?.length ?? 0), 0)
    const checkedAll = allCars.reduce(
      (s, c) => s + (c.car_members?.filter(isCheckedIn).length ?? 0), 0
    )
    const uncheckedAll = totalAll - checkedAll

    async function handleCheckInAllCar(carId) {
      await checkInAllCar(carId)
      await refresh()
    }

    return (
      <div className="min-h-screen bg-green-50 pb-24">
        <ScanToast msg={scanMsg} />

        {/* Header */}
        <div className="bg-green-700 text-white px-4 py-5 shadow-md">
          <div className="max-w-lg mx-auto">
            <div className="text-xs opacity-75 mb-0.5">{eventName}　{eventDate}</div>
            <div className="text-xl font-bold">🚗 小車領隊看板</div>
            <div className="flex gap-5 mt-3 text-sm">
              <span>應到 <strong className="text-xl">{totalAll}</strong></span>
              <span>已到 <strong className="text-xl">{checkedAll}</strong></span>
              <span>未到 <strong className="text-xl">{uncheckedAll}</strong></span>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-3 px-4">
          確認每台小車都出發後，按「全車確認出發」即可
        </p>

        {/* 各小車卡片 */}
        <div className="px-4 pt-3 max-w-lg mx-auto space-y-3">
          {allCars.map(c => {
            const members  = c.car_members ?? []
            const total    = members.length
            const checked  = members.filter(isCheckedIn).length
            const unchecked = total - checked
            const done     = checked === total && total > 0

            return (
              <div key={c.car_id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${done ? 'border-green-300' : 'border-gray-200'}`}>
                {/* 車次標題 */}
                <div className={`px-4 py-3 flex items-center gap-3 ${done ? 'bg-green-50' : 'bg-gray-50'} border-b`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{c.car_name}</span>
                      {done && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員出發 ✓</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      應到 {total}　已到 {checked}　未到 {unchecked}
                    </div>
                  </div>
                  {!done && (
                    <button
                      onClick={() => handleCheckInAllCar(c.car_id)}
                      className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 active:bg-green-800 transition-colors"
                    >
                      ✅ 全車確認出發
                    </button>
                  )}
                </div>

                {/* 成員清單（常駐顯示，不需展開） */}
                <div className="divide-y">
                  {members.map(member => {
                    const name   = getMemberName(member)
                    const guest  = isGuest(member)
                    const chk    = isCheckedIn(member)
                    const preArr = getPreArriveInfo(member.registrations?.answers, dateStart)
                    return (
                      <div key={member.registration_id} className={`flex items-center gap-3 px-4 py-2.5 ${chk ? 'opacity-50' : ''}`}>
                        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                          <span className={`text-sm ${chk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>{name}</span>
                          {guest  && <span className="text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 shrink-0">訪客</span>}
                          {preArr && <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">{preArr}</span>}
                        </div>
                        <button
                          onClick={() => handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                          className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {chk ? '已到' : '報到'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {allCars.length === 0 && (
            <div className="text-center text-gray-400 py-12 text-sm">尚無小車排班資料，請師父先完成排車並儲存</div>
          )}
        </div>

        {/* 重新整理 */}
        <button
          onClick={refresh}
          disabled={refreshing}
          className="fixed bottom-6 right-4 w-12 h-12 bg-white border shadow-lg rounded-full flex items-center justify-center text-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-all"
        >
          {refreshing ? '…' : '🔄'}
        </button>
      </div>
    )
  }

  // ════════════════════════════════════════
  //  總領隊模式
  // ════════════════════════════════════════

  if (mode === 'head') {
    const eventName  = headLeader?.events?.name ?? ''
    const dateStart  = headLeader?.events?.date_start
    const eventDate  = formatDate(dateStart)

    const largeCars = allCars.filter(c => c.car_type === 'large')
    const smallCars = allCars.filter(c => c.car_type === 'small')

    const monkTotalAll   = allCars.reduce((s, c) => s + (c.car_monks?.length ?? 0), 0)
    const monkCheckedAll = allCars.reduce((s, c) => s + (c.car_monks?.filter(m => !!m.checked_in_at).length ?? 0), 0)

    // 應到 = 當天搭車出發的人（排除提前上山），法師一律算
    const isPreArrived = (m) => !!getPreArriveInfo(m.registrations?.answers, dateStart)
    const todayMembers  = allCars.flatMap(c => c.car_members ?? []).filter(m => !isPreArrived(m))
    const totalAll      = todayMembers.length + monkTotalAll
    const checkedAll    = todayMembers.filter(isCheckedIn).length + monkCheckedAll
    const uncheckedAll  = totalAll - checkedAll

    const smallTotal   = smallCars.reduce((s, c) => s + (c.car_members?.length ?? 0), 0)
    const smallChecked = smallCars.reduce((s, c) => s + (c.car_members?.filter(isCheckedIn).length ?? 0), 0)

    // 實際回山總人數（含提前上山）— 按身份統計全部人
    const identityCounts = {}
    for (const c of allCars) {
      for (const m of (c.car_members ?? [])) {
        const id = m.registrations?.answers?.identity ?? '未填'
        identityCounts[id] = (identityCounts[id] ?? 0) + 1
      }
      for (const cm of (c.car_monks ?? [])) {
        identityCounts['法師'] = (identityCounts['法師'] ?? 0) + 1
      }
    }
    const IDENTITY_ORDER = ['法師', '義工', '信眾']
    const identityStats = [
      ...IDENTITY_ORDER.filter(k => identityCounts[k]).map(k => [k, identityCounts[k]]),
      ...Object.entries(identityCounts).filter(([k]) => !IDENTITY_ORDER.includes(k)),
    ]

    return (
      <div className="min-h-screen bg-amber-50 pb-24">
        <ScanToast msg={scanMsg} />

        {/* Header */}
        <div className="bg-amber-800 text-white px-4 py-5 shadow-md">
          <div className="max-w-lg mx-auto">
            <div className="text-xs opacity-75 mb-0.5">{eventName}　{eventDate}</div>
            <div className="text-xl font-bold">👑 總領隊看板</div>
            <div className="flex gap-5 mt-3 text-sm">
              <span>應到 <strong className="text-xl">{totalAll}</strong></span>
              <span>已到 <strong className="text-xl">{checkedAll}</strong></span>
              <span>未到 <strong className="text-xl">{uncheckedAll}</strong></span>
            </div>
            {identityStats.length > 0 && (
              <div className="flex gap-4 mt-1.5 text-sm flex-wrap opacity-80">
                {identityStats.map(([label, count]) => (
                  <span key={label}>{label} <strong>{count}</strong></span>
                ))}
                <span className="text-xs opacity-60 self-center">（實際回山總數）</span>
              </div>
            )}
          </div>
        </div>

        {/* 全域掃描按鈕 */}
        <div className="px-4 pt-4 max-w-lg mx-auto">
          <button
            onClick={() => setShowCamera(true)}
            className="w-full py-3 bg-white border-2 border-amber-400 rounded-xl text-amber-700 font-semibold text-sm hover:bg-amber-50 active:bg-amber-100 transition-colors shadow-sm"
          >
            📷 掃描報到（全車通用）
          </button>
          <p className="text-center text-xs text-gray-400 mt-1.5">掃任何車的學員，系統自動找到並報到</p>
        </div>

        <div className="px-4 pt-4 max-w-lg mx-auto space-y-3">

          {/* ── 大車（各台獨立） ── */}
          {largeCars.map(c => {
            const carToday  = (c.car_members ?? []).filter(m => !isPreArrived(m))
            const total     = carToday.length + (c.car_monks?.length ?? 0)
            const checked   = carToday.filter(isCheckedIn).length + (c.car_monks ?? []).filter(m => !!m.checked_in_at).length
            const unchecked = total - checked
            const done      = total > 0 && unchecked === 0
            const expanded  = expandedCarId === c.car_id

            const leaderNames = (c.car_leaders ?? []).map(l => {
              const m = (c.car_members ?? []).find(m => m.registration_id === l.registration_id)
              return getMemberName(m)
            }).filter(Boolean)

            const sorted = [...(c.car_members ?? [])].sort((a, b) =>
              (isCheckedIn(a) ? 1 : 0) - (isCheckedIn(b) ? 1 : 0)
            )

            return (
              <div key={c.car_id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setExpandedCarId(expanded ? null : c.car_id)}
                  className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{c.car_name}</span>
                      {done && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員到齊 ✓</span>}
                    </div>
                    {leaderNames.length > 0 && (
                      <div className="text-xs text-amber-600 mt-0.5">領隊：{leaderNames.join('、')}</div>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                      應到 {total}　已到 {checked}　未到 {unchecked}
                    </div>
                  </div>
                  <span className="text-gray-300 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
                </button>

                {expanded && (
                  <div className="border-t divide-y">
                    {sorted.map(member => {
                      const name     = getMemberName(member)
                      const guest    = isGuest(member)
                      const chk      = isCheckedIn(member)
                      const isLeader = (c.car_leaders ?? []).some(l => l.registration_id === member.registration_id)
                      return (
                        <div key={member.registration_id} className={`flex items-center gap-3 px-4 py-2.5 ${chk ? 'opacity-55' : ''}`}>
                          <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                            <span className={`text-sm truncate ${chk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>{name}</span>
                            {isLeader && <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-1.5 shrink-0">領隊</span>}
                            {guest    && <span className="text-xs bg-blue-100  text-blue-600  rounded-full px-1.5 shrink-0">訪客</span>}
                            {getPreArriveInfo(member.registrations?.answers, dateStart) && (
                              <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">
                                {getPreArriveInfo(member.registrations?.answers, dateStart)}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                            className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                          >
                            {chk ? '已到' : '報到'}
                          </button>
                        </div>
                      )
                    })}
                    {/* 法師（手動點選） */}
                    {(c.car_monks ?? []).map(cm => {
                      const chk = !!cm.checked_in_at
                      return (
                        <div key={cm.id} className={`flex items-center gap-3 px-4 py-2.5 ${chk ? 'opacity-55' : ''}`}>
                          <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                            <span className={`text-sm truncate ${chk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>
                              {cm.temple_monks?.name ?? '（未知）'}
                            </span>
                            <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-1.5 shrink-0">法師</span>
                          </div>
                          <button
                            onClick={() => handleToggleMonkCheckin(cm.id, cm.checked_in_at)}
                            className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                          >
                            {chk ? '已到' : '報到'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* ── 小車（摘要 + 可展開各台） ── */}
          {smallCars.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* 小車總摘要列（點擊展開/收合所有小車） */}
              <button
                onClick={() => setExpandedCarId(expandedCarId === '__small__' ? null : '__small__')}
                className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800">🚗 小車（共 {smallCars.length} 台）</span>
                    {smallChecked === smallTotal && smallTotal > 0 && (
                      <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員出發 ✓</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    應到 {smallTotal}　已到 {smallChecked}　未到 {smallTotal - smallChecked}
                  </div>
                </div>
                <span className="text-gray-300 text-xs shrink-0">
                  {expandedCarId === '__small__' ? '▲' : '▼'}
                </span>
              </button>

              {/* 展開：各台小車（用獨立 expandedSmallCarId 管內層） */}
              {expandedCarId === '__small__' && (
                <div className="border-t divide-y">
                  {smallCars.map(c => {
                    const total     = c.car_members?.length ?? 0
                    const checked   = (c.car_members ?? []).filter(isCheckedIn).length
                    const unchecked = total - checked
                    const done      = checked === total && total > 0
                    const innerExp  = expandedSmallCarId === c.car_id

                    const sorted = [...(c.car_members ?? [])].sort((a, b) =>
                      (isCheckedIn(a) ? 1 : 0) - (isCheckedIn(b) ? 1 : 0)
                    )

                    return (
                      <div key={c.car_id} className="bg-gray-50">
                        <button
                          onClick={() => setExpandedSmallCarId(innerExp ? null : c.car_id)}
                          className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-gray-700">{c.car_name}</span>
                              {done && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員出發 ✓</span>}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              應到 {total}　已到 {checked}　未到 {unchecked}
                            </div>
                          </div>
                          <span className="text-gray-300 text-xs shrink-0">{innerExp ? '▲' : '▼'}</span>
                        </button>

                        {innerExp && (
                          <div className="bg-white border-t divide-y">
                            {sorted.map(member => {
                              const name  = getMemberName(member)
                              const guest = isGuest(member)
                              const chk   = isCheckedIn(member)
                              const preArr = getPreArriveInfo(member.registrations?.answers, dateStart)
                              return (
                                <div key={member.registration_id} className={`flex items-center gap-3 px-5 py-2.5 ${chk ? 'opacity-55' : ''}`}>
                                  <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-sm truncate ${chk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>{name}</span>
                                    {guest  && <span className="text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 shrink-0">訪客</span>}
                                    {preArr && <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">{preArr}</span>}
                                  </div>
                                  <button
                                    onClick={() => handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                                    className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                      chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                                    }`}
                                  >
                                    {chk ? '已到' : '報到'}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {allCars.length === 0 && (
            <div className="text-center text-gray-400 py-12 text-sm">尚無排車資料，請師父先完成排車並儲存</div>
          )}
        </div>

        {/* 重新整理 */}
        <button
          onClick={refresh}
          disabled={refreshing}
          className="fixed bottom-6 right-4 w-12 h-12 bg-white border shadow-lg rounded-full flex items-center justify-center text-lg text-gray-500 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 transition-all"
        >
          {refreshing ? '…' : '🔄'}
        </button>

        {showCamera && (
          <CameraScanner
            onScan={code => { setShowCamera(false); handleScanCode(code) }}
            onClose={() => setShowCamera(false)}
          />
        )}
      </div>
    )
  }

  return null
}
