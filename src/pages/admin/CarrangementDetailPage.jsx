import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import {
  getAllEvents,
  getEventRegistrationsDetail,
  getRelationshipGroups,
  getCarArrangement,
  saveCarArrangement,
  getHeadLeader,
  setHeadLeader as saveHeadLeader,
} from '../../lib/supabase'

// ─── 常數與工具 ───────────────────────────────────────────────

const CHINESE_NUMS = ['一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五']
const chNum = n => CHINESE_NUMS[n - 1] ?? String(n)
const genId = () => `tmp-${Math.random().toString(36).slice(2)}`

// 取得顯示名稱（相容訪客）
const getName    = r => r.students?.name ?? r.answers?.guest_name ?? '訪客'
const getClasses = r => r.students?.student_classes ?? []

// 取得備註欄（相容多種可能的 field_key）
const getGuestNote = r =>
  r.answers?.['備註'] ?? r.answers?.note ?? r.answers?.memo ?? r.answers?.beizhu ?? ''

// 在學員報名清單中尋找備註提到的姓名
function findGuestMatch(note, studentRegs) {
  if (!note.trim()) return null
  for (const r of studentRegs) {
    const name = getName(r)
    if (name && name.length >= 2 && note.includes(name)) return r
  }
  return null
}

// 判斷交通方式
// isLargeCar 接受完整 reg 物件（需判斷是否為訪客）
const isLargeCar = r => {
  const t = r.answers?.transport_up ?? ''
  if (r.student_id) return t.includes('精舍')
  // 訪客：沒有明確選「自行開車」或「搭學員」的，視為搭大車
  return !t.includes('自行開車') && !t.includes('搭學員')
}
const isSmallDriver   = ans => (ans?.transport_up ?? '').includes('自行開車')
const isSmallPassenger= ans => (ans?.transport_up ?? '').includes('搭學員')
const isSmallCar      = ans => isSmallDriver(ans) || isSmallPassenger(ans)

// ─── 小車配對（純運算，不存 DB）────────────────────────────────
// 回傳 { matchedGroups, orphans }
// matchedGroups：有司機的群組（按順序編為小車 1、2…）
// orphans：找不到司機的乘客（需手動指定搭哪台小車）

function computeSmallGroups(regs) {
  const drivers    = regs.filter(r => isSmallDriver(r.answers))
  const passengers = regs.filter(r => isSmallPassenger(r.answers))
  const usedIds    = new Set()
  const matchedGroups = []

  for (const driver of drivers) {
    const driverName = getName(driver)
    const plate      = driver.answers?.plate_up ?? ''
    const matched    = passengers.filter(p => {
      if (usedIds.has(p.registration_id)) return false
      const cn = (p.answers?.carpool_up ?? '').trim()
      if (!cn) return false
      return driverName.includes(cn) || cn.includes(driverName)
    })
    matched.forEach(p => usedIds.add(p.registration_id))
    matchedGroups.push({ key: driver.registration_id, driverName, plate, members: [driver, ...matched] })
  }

  // 找不到司機的乘客（整批回傳，讓使用者手動指定）
  const orphans = passengers.filter(p => !usedIds.has(p.registration_id))

  return { matchedGroups, orphans }
}

// ─── 自動排車演算法 ────────────────────────────────────────────

function autoArrange(largePeople, carCount, seats, relGroups) {
  const cars = Array.from({ length: carCount }, (_, i) => ({
    tempId: genId(),
    car_name: `第${chNum(i + 1)}車`,
    seats: Number(seats),
    members: [],
    leaders: [],
  }))

  const assigned    = new Set()
  const studentToId = Object.fromEntries(largePeople.map(r => [r.student_id, r.registration_id]))

  // 關係群組中有 2 人以上搭大車的，視為需要安排在同車
  const regGroups = relGroups
    .map(rg => ({
      name: rg.name,
      ids: (rg.relationship_members ?? [])
        .map(m => studentToId[m.student_id])
        .filter(Boolean),
    }))
    .filter(rg => rg.ids.length >= 2)
    .sort((a, b) => b.ids.length - a.ids.length)

  const avail   = car => car.seats - car.members.length
  const bestCar = size => {
    const fits = cars.filter(c => avail(c) >= size)
    if (fits.length > 0) return fits.reduce((a, b) => avail(a) <= avail(b) ? a : b) // 最接近剛好滿的
    return cars.reduce((a, b) => avail(a) >= avail(b) ? a : b) // 剩餘最多座位的
  }

  // 優先安排關係群組
  for (const rg of regGroups) {
    const todo = rg.ids.filter(id => !assigned.has(id))
    if (!todo.length) continue
    const car = bestCar(todo.length)
    for (const id of todo) {
      if (car.members.length < car.seats) { car.members.push(id); assigned.add(id) }
    }
  }

  // 剩餘依班級、組別排序後依序填入（只排學員，訪客另外處理）
  const remaining = largePeople
    .filter(r => r.student_id && !assigned.has(r.registration_id))
    .sort((a, b) => {
      const ac = getClasses(a)[0]?.class_name ?? ''
      const bc = getClasses(b)[0]?.class_name ?? ''
      if (ac !== bc) return ac.localeCompare(bc, 'zh-TW')
      const ag = getClasses(a)[0]?.group_name ?? ''
      const bg = getClasses(b)[0]?.group_name ?? ''
      return ag.localeCompare(bg, 'zh-TW')
    })

  // 班級同學儘量塞同一台車（不先輪換車次）
  let ci = 0
  for (const p of remaining) {
    while (ci < carCount && cars[ci].members.length >= cars[ci].seats) ci++
    if (ci >= carCount) break
    cars[ci].members.push(p.registration_id)
    assigned.add(p.registration_id)
    if (cars[ci].members.length >= cars[ci].seats) ci++
  }

  // 處理訪客：有備註且能配對到學員 → 強制排同車（超過座位也排）
  // 沒備註或找不到學員 → 留在未分配警示區
  const studentLarge = largePeople.filter(r => r.student_id)
  for (const guest of largePeople.filter(r => !r.student_id && !assigned.has(r.registration_id))) {
    const note    = getGuestNote(guest)
    const matched = findGuestMatch(note, studentLarge)
    if (matched) {
      const targetCar = cars.find(c => c.members.includes(matched.registration_id))
      if (targetCar) {
        // 強制插入，確保親友同車（不受座位限制）
        targetCar.members.push(guest.registration_id)
        assigned.add(guest.registration_id)
      }
    }
  }

  return cars
}

// ─── PersonRow 元件 ───────────────────────────────────────────

function PersonRow({ reg, carIdx, cars, onMove, onToggleLeader, guestInfo }) {
  const name     = getName(reg)
  const cls      = getClasses(reg).map(c => [c.class_name, c.group_name].filter(Boolean).join(' ')).join('／')
  const isLeader = carIdx >= 0 && (cars[carIdx]?.leaders.includes(reg.registration_id) ?? false)
  const isGuest  = !reg.student_id

  return (
    <div className={`flex items-center gap-2 px-4 py-2 text-sm ${isGuest ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-amber-50'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium truncate">{name}</span>
          {isGuest && (
            <span className="text-xs text-blue-500 bg-blue-100 rounded px-1 shrink-0">訪客</span>
          )}
          {/* 訪客備註配對狀態 */}
          {isGuest && guestInfo?.matchedName && (
            <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded px-1.5 shrink-0">
              親友：{guestInfo.matchedName}
            </span>
          )}
          {isGuest && !guestInfo?.matchedName && guestInfo?.note && (
            <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 shrink-0" title={guestInfo.note}>
              ⚠️ 備註：{guestInfo.note.slice(0, 10)}{guestInfo.note.length > 10 ? '…' : ''}
            </span>
          )}
          {isGuest && !guestInfo?.matchedName && !guestInfo?.note && (
            <span className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-1.5 shrink-0">
              ❗ 未填親友
            </span>
          )}
        </div>
        {cls && <div className="text-xs text-gray-400 mt-0.5">{cls}</div>}
      </div>
      {carIdx >= 0 && (
        <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer shrink-0 select-none">
          <input
            type="checkbox"
            checked={isLeader}
            onChange={() => onToggleLeader(carIdx, reg.registration_id)}
            className="accent-amber-600"
          />
          領隊
        </label>
      )}
      <select
        value={carIdx >= 0 ? String(carIdx) : ''}
        onChange={e => onMove(reg.registration_id, e.target.value === '' ? -1 : Number(e.target.value))}
        className="text-xs border rounded px-1.5 py-0.5 bg-white shrink-0 focus:outline-none focus:ring-1 focus:ring-amber-400"
      >
        <option value="">未分配</option>
        {cars.map((c, i) => (
          <option key={c.tempId} value={String(i)}>{c.car_name}</option>
        ))}
      </select>
    </div>
  )
}

// ─── StatCard 元件 ────────────────────────────────────────────

function StatCard({ label, value, color }) {
  return (
    <div className={`border rounded-xl p-4 ${color}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-xs mt-1">{label}</div>
    </div>
  )
}

// ─── 主頁面 ───────────────────────────────────────────────────

export default function CarrangementDetailPage() {
  const { eventId } = useParams()
  const navigate    = useNavigate()

  const [loading, setLoading]               = useState(true)
  const [event,   setEvent]                 = useState(null)
  const [regs,    setRegs]                  = useState([])
  const [relGroups, setRelGroups]           = useState([])
  const [cars,    setCars]                  = useState([])
  const [carCount, setCarCount]             = useState(2)
  const [seatsPerCar, setSeatsPerCar]       = useState(20)
  const [headLeaderRegId, setHeadLeaderRegId] = useState('')
  const [saving,  setSaving]                = useState(false)
  const [msg,     setMsg]                   = useState('')
  // orphanAssignments: { [registrationId]: groupKey(小車 key) }
  const [orphanAssignments, setOrphanAssignments] = useState({})

  // ── 衍生資料（含訪客）──
  const regMap      = useMemo(() => Object.fromEntries(regs.map(r => [r.registration_id, r])), [regs])
  const largePeople = useMemo(() => regs.filter(r => isLargeCar(r)), [regs])
  const smallPeople = useMemo(() => regs.filter(r => isSmallCar(r.answers)), [regs])

  // 小車配對：matchedGroups + orphans
  const { matchedGroups, orphans } = useMemo(() => computeSmallGroups(smallPeople), [smallPeople])

  // 把已手動指派的孤兒乘客併入對應的小車群組
  const finalSmallGroups = useMemo(() =>
    matchedGroups.map(g => ({
      ...g,
      allMembers: [
        ...g.members,
        ...orphans.filter(o => orphanAssignments[o.registration_id] === g.key),
      ],
    })),
  [matchedGroups, orphans, orphanAssignments])

  // 尚未指定小車的孤兒
  const unassignedOrphans = useMemo(() =>
    orphans.filter(o => !orphanAssignments[o.registration_id]),
  [orphans, orphanAssignments])

  const assignedSet = useMemo(() => new Set(cars.flatMap(c => c.members)), [cars])
  const unassigned  = useMemo(() => largePeople.filter(r => !assignedSet.has(r.registration_id)), [largePeople, assignedSet])

  // 訪客備註比對：{ regId: { note, matchedName } }
  const guestInfoMap = useMemo(() => {
    const map = {}
    const studentRegs = largePeople.filter(r => r.student_id)
    for (const guest of largePeople.filter(r => !r.student_id)) {
      const note    = getGuestNote(guest)
      const matched = findGuestMatch(note, studentRegs)
      map[guest.registration_id] = { note, matchedName: matched ? getName(matched) : null }
    }
    return map
  }, [largePeople])

  // 需詢問的訪客（坐大車但找不到對應學員）
  const guestsNeedFollowup = useMemo(() =>
    largePeople.filter(r => !r.student_id && !guestInfoMap[r.registration_id]?.matchedName),
  [largePeople, guestInfoMap])

  // ── 載入 ──
  useEffect(() => { load() }, [eventId])

  async function load() {
    setLoading(true)
    const [{ events }, { registrations }, { groups }, { cars: savedCars }, { headLeader }] = await Promise.all([
      getAllEvents(),
      getEventRegistrationsDetail(eventId),
      getRelationshipGroups(),
      getCarArrangement(eventId),
      getHeadLeader(eventId),
    ])

    setEvent(events.find(e => e.event_id === eventId) ?? null)
    setRegs(registrations)
    setRelGroups(groups)

    if (savedCars.length > 0) {
      // 大車
      const largeSaved = savedCars.filter(c => c.car_type === 'large')
      if (largeSaved.length > 0) {
        const mapped = largeSaved.map(c => ({
          tempId:   c.car_id,
          car_name: c.car_name,
          seats:    c.seats,
          members:  (c.car_members ?? []).map(m => m.registration_id),
          leaders:  (c.car_leaders ?? []).map(l => l.registration_id),
        }))
        setCars(mapped)
        setCarCount(mapped.length)
        setSeatsPerCar(mapped[0]?.seats ?? 20)
      }

      // 小車：從已存的成員列表還原孤兒指派
      const smallSaved = savedCars.filter(c => c.car_type === 'small')
      if (smallSaved.length > 0) {
        const smallRegs = registrations.filter(r => isSmallCar(r.answers))
        const { matchedGroups: freshMatched } = computeSmallGroups(smallRegs)
        const restored = {}
        for (const savedCar of smallSaved) {
          const groupKey = savedCar.note   // 司機的 registration_id
          const freshGroup = freshMatched.find(g => g.key === groupKey)
          const originalIds = new Set((freshGroup?.members ?? []).map(m => m.registration_id))
          for (const member of (savedCar.car_members ?? [])) {
            if (!originalIds.has(member.registration_id)) {
              restored[member.registration_id] = groupKey
            }
          }
        }
        setOrphanAssignments(restored)
      }
    }

    if (headLeader) setHeadLeaderRegId(headLeader.registration_id ?? '')
    setLoading(false)
  }

  // ── 操作 ──
  function handleAutoArrange() {
    if (largePeople.length === 0) { alert('此活動沒有搭精舍車的學員'); return }
    if (cars.length > 0 && !window.confirm('自動排車會覆蓋現有排法，確定繼續？')) return
    setCars(autoArrange(largePeople, Number(carCount), Number(seatsPerCar), relGroups))
  }

  function movePerson(regId, targetCarIdx) {
    setCars(prev => prev.map((c, i) => {
      const without = { ...c, members: c.members.filter(id => id !== regId), leaders: c.leaders.filter(id => id !== regId) }
      if (i === targetCarIdx) return { ...without, members: [...without.members, regId] }
      return without
    }))
  }

  function toggleLeader(carIdx, regId) {
    setCars(prev => prev.map((c, i) => {
      if (i !== carIdx) return c
      const has = c.leaders.includes(regId)
      return { ...c, leaders: has ? c.leaders.filter(id => id !== regId) : [...c.leaders, regId] }
    }))
  }

  function updateCarName(carIdx, name) {
    setCars(prev => prev.map((c, i) => i === carIdx ? { ...c, car_name: name } : c))
  }

  async function handleSave() {
    setSaving(true); setMsg('')
    const [carRes, hlRes] = await Promise.all([
      saveCarArrangement(eventId, cars, finalSmallGroups),
      headLeaderRegId
        ? saveHeadLeader(eventId, headLeaderRegId)
        : Promise.resolve({ success: true }),
    ])
    setSaving(false)
    setMsg(carRes.success && hlRes.success ? '已儲存 ✓' : `儲存失敗：${carRes.error || hlRes.error}`)
    setTimeout(() => setMsg(''), 4000)
  }

  function handleExport() {
    const rows = [['車次', '姓名', '班級', '組別', '身份別', '備註']]

    // 大車
    for (const car of cars) {
      for (const regId of car.members) {
        const r = regMap[regId]
        if (!r) continue
        const name     = getName(r)
        const classes  = getClasses(r)
        const cls      = classes.map(c => c.class_name).join('/')
        const grp      = classes.map(c => c.group_name).filter(Boolean).join('/')
        const identity = r.answers?.identity ?? ''
        const note     = car.leaders.includes(regId) ? '領隊' : ''
        rows.push([car.car_name, name, cls, grp, identity, note])
      }
    }

    // 小車（有配對的群組）
    finalSmallGroups.forEach((g, idx) => {
      for (const r of g.allMembers) {
        const name     = getName(r)
        const classes  = getClasses(r)
        const cls      = classes.map(c => c.class_name).join('/')
        const grp      = classes.map(c => c.group_name).filter(Boolean).join('/')
        const identity = r.answers?.identity ?? ''
        const isDriver = r.registration_id === g.key
        const note     = isDriver ? `司機${g.plate ? `（${g.plate}）` : ''}` : '乘客'
        rows.push([`小車 ${idx + 1}`, name, cls, grp, identity, note])
      }
    })

    // 未指定小車的孤兒
    for (const r of unassignedOrphans) {
      const name     = getName(r)
      const classes  = getClasses(r)
      const cls      = classes.map(c => c.class_name).join('/')
      const grp      = classes.map(c => c.group_name).filter(Boolean).join('/')
      const identity = r.answers?.identity ?? ''
      const carpoolNm = r.answers?.carpool_up ?? ''
      rows.push([`小車（未指定）`, name, cls, grp, identity, carpoolNm ? `→ ${carpoolNm}` : ''])
    }

    const csv  = '﻿' + rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `${event?.name ?? '活動'}_分車名單.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  // ── 渲染 ──
  if (loading) return <AdminLayout><div className="text-center py-20 text-gray-400">載入中…</div></AdminLayout>

  return (
    <AdminLayout>
      <div className="space-y-6 pb-24">

        {/* 頁首 */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <button
              onClick={() => navigate('/admin/carrangement')}
              className="text-sm text-amber-700 hover:underline mb-1 block"
            >
              ← 返回活動列表
            </button>
            <h1 className="text-xl font-bold text-gray-800">{event?.name ?? '載入中…'}</h1>
            <p className="text-sm text-gray-400">排車系統</p>
          </div>
          <div className="flex items-center gap-2">
            {msg && (
              <span className={`text-sm font-medium ${msg.includes('失敗') ? 'text-red-500' : 'text-green-600'}`}>
                {msg}
              </span>
            )}
            <button
              onClick={handleExport}
              disabled={cars.length === 0}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              📥 匯出分車名單
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors font-medium"
            >
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="搭精舍車（大車）" value={largePeople.length} color="bg-blue-50 border-blue-200 text-blue-700" />
          <StatCard label="小車（自行/共乘）" value={smallPeople.length} color="bg-green-50 border-green-200 text-green-700" />
          <StatCard
            label="其他/未填"
            value={regs.length - largePeople.length - smallPeople.length}
            color="bg-gray-50 border-gray-200 text-gray-600"
          />
        </div>

        {/* ── 大車排班 ── */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-4">🚌 大車排班</h2>

          {/* 設定列 */}
          <div className="flex items-end gap-3 mb-4 flex-wrap">
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              車輛數
              <input
                type="number" min="1" max="15"
                value={carCount}
                onChange={e => setCarCount(e.target.value)}
                className="w-20 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              每車座位
              <input
                type="number" min="1" max="60"
                value={seatsPerCar}
                onChange={e => setSeatsPerCar(e.target.value)}
                className="w-20 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </label>
            <button
              onClick={handleAutoArrange}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium self-end"
            >
              ✨ 自動排車
            </button>
            {cars.length > 0 && (
              <button
                onClick={() => { if (window.confirm('確定清除所有排車結果？')) setCars([]) }}
                className="px-3 py-2 text-sm border rounded-lg text-gray-500 hover:bg-gray-100 self-end"
              >
                清除
              </button>
            )}
          </div>

          {/* 提示 */}
          <p className="text-xs text-gray-400 mb-3">
            自動排車邏輯：優先將「關係連結」中的成員安排同車 → 備註有寫親友姓名的訪客排同車 → 再依班級分配剩餘座位。<br />
            排好後可用每人右側的下拉選單手動調整車次，並勾選「領隊」標記當車領隊。
          </p>

          {/* 需詢問訪客警示 */}
          {guestsNeedFollowup.length > 0 && (
            <div className="mb-4 bg-red-50 border border-red-300 rounded-xl px-4 py-3">
              <div className="font-semibold text-red-700 text-sm mb-2">
                ❗ 以下訪客坐大車，備註欄未填或找不到對應學員，排車前請先確認
              </div>
              <ul className="space-y-1">
                {guestsNeedFollowup.map(r => {
                  const info = guestInfoMap[r.registration_id]
                  return (
                    <li key={r.registration_id} className="flex items-center gap-2 text-sm text-red-800">
                      <span className="font-medium">・{getName(r)}</span>
                      {info?.note
                        ? <span className="text-orange-600">備註：「{info.note}」（找不到對應學員）</span>
                        : <span className="text-red-500">（未填備註，不知道跟誰同車）</span>
                      }
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* 車輛卡片 */}
          {cars.length === 0 ? (
            <div className="text-sm text-gray-400 py-10 text-center border-2 border-dashed rounded-xl">
              尚未排車，請設定車輛數後點「✨ 自動排車」
            </div>
          ) : (
            <div className="space-y-3">
              {cars.map((car, ci) => (
                <div key={car.tempId} className="bg-white border rounded-xl shadow-sm overflow-hidden">
                  {/* 車次標題 */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b">
                    <input
                      value={car.car_name}
                      onChange={e => updateCarName(ci, e.target.value)}
                      className="font-semibold text-sm bg-transparent border-b border-transparent hover:border-gray-300 focus:border-amber-400 focus:outline-none px-1 py-0.5 w-28"
                    />
                    <span className="text-xs text-gray-400">{car.members.length} / {car.seats} 人</span>
                    {car.leaders.length > 0 && (
                      <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                        領隊：{car.leaders.map(lid => regMap[lid] ? getName(regMap[lid]) : '?').join('、')}
                      </span>
                    )}
                    {car.members.length >= car.seats && (
                      <span className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">已滿</span>
                    )}
                  </div>
                  {/* 成員列表 */}
                  <div className="divide-y">
                    {car.members.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-gray-400">（此車目前無人）</div>
                    ) : (
                      car.members.map(regId => (
                        <PersonRow
                          key={regId}
                          reg={regMap[regId]}
                          carIdx={ci}
                          cars={cars}
                          onMove={movePerson}
                          onToggleLeader={toggleLeader}
                          guestInfo={guestInfoMap[regId]}
                        />
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 未分配 */}
          {unassigned.length > 0 && (
            <div className="mt-3 bg-yellow-50 border border-yellow-300 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-yellow-100 border-b border-yellow-200">
                <span className="font-semibold text-yellow-800 text-sm">⚠️ 未分配（{unassigned.length} 人）</span>
                <span className="text-xs text-yellow-600 ml-2">— 座位已滿，無法分配</span>
              </div>
              <div className="divide-y">
                {unassigned.map(r => (
                  <PersonRow
                    key={r.registration_id}
                    reg={r}
                    carIdx={-1}
                    cars={cars}
                    onMove={movePerson}
                    onToggleLeader={() => {}}
                    guestInfo={guestInfoMap[r.registration_id]}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── 小車配對 ── */}
        {smallPeople.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-gray-700 mb-2">🚗 小車配對</h2>
            <p className="text-xs text-gray-400 mb-4">
              依報名填寫的「共乘者姓名」自動配對司機與乘客。找不到司機的乘客可用下拉選單手動指定搭哪台小車。
            </p>
            <div className="space-y-2">
              {/* 有配對的小車群組 */}
              {finalSmallGroups.map((g, idx) => (
                <div key={g.key} className="bg-white border rounded-xl shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-gray-50 text-sm font-semibold text-gray-700">
                    <span className="text-green-700 bg-green-100 rounded-full px-2 py-0.5 text-xs">
                      小車 {idx + 1}
                    </span>
                    <span>司機：{g.driverName}</span>
                    {g.plate && <span className="text-gray-400 text-xs font-normal">{g.plate}</span>}
                    <span className="text-xs text-gray-400 font-normal ml-auto">{g.allMembers.length} 人</span>
                  </div>
                  <div className="divide-y">
                    {g.allMembers.map(r => {
                      const cls       = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                      const isDriver  = r.registration_id === g.key
                      const carpoolNm = r.answers?.carpool_up ?? ''
                      const isOrphan  = orphans.some(o => o.registration_id === r.registration_id)
                      return (
                        <div key={r.registration_id} className={`flex items-center gap-2 px-4 py-2 text-sm ${isOrphan ? 'bg-orange-50' : ''}`}>
                          <span className="flex-1 font-medium">{getName(r)}</span>
                          {cls && <span className="text-xs text-gray-400">{cls}</span>}
                          <span className="text-xs text-gray-300">
                            {isDriver ? '（司機）' : carpoolNm ? `→ ${carpoolNm}` : ''}
                          </span>
                          {/* 孤兒乘客可改指定到其他小車 */}
                          {isOrphan && (
                            <select
                              value={g.key}
                              onChange={e => setOrphanAssignments(prev => ({
                                ...prev,
                                [r.registration_id]: e.target.value || undefined,
                              }))}
                              className="text-xs border rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                            >
                              {finalSmallGroups.map((fg, fi) => (
                                <option key={fg.key} value={fg.key}>小車 {fi + 1}・{fg.driverName}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              {/* 找不到司機、尚未指定小車的乘客 */}
              {unassignedOrphans.length > 0 && (
                <div className="bg-orange-50 border border-orange-300 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-orange-100 border-b border-orange-200 text-sm font-semibold text-orange-800">
                    ⚠️ 找不到司機（{unassignedOrphans.length} 人）— 請手動指定搭哪台小車
                  </div>
                  <div className="divide-y">
                    {unassignedOrphans.map(r => {
                      const cls       = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                      const carpoolNm = r.answers?.carpool_up ?? ''
                      return (
                        <div key={r.registration_id} className="flex items-center gap-2 px-4 py-2 text-sm">
                          <span className="flex-1 font-medium">{getName(r)}</span>
                          {cls && <span className="text-xs text-gray-400">{cls}</span>}
                          {carpoolNm && <span className="text-xs text-gray-400">→ {carpoolNm}</span>}
                          <select
                            value={orphanAssignments[r.registration_id] ?? ''}
                            onChange={e => setOrphanAssignments(prev => ({
                              ...prev,
                              [r.registration_id]: e.target.value || undefined,
                            }))}
                            className="text-xs border rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                          >
                            <option value="">（未指定）</option>
                            {finalSmallGroups.map((g, gi) => (
                              <option key={g.key} value={g.key}>小車 {gi + 1}・{g.driverName}</option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 沒有任何小車資料 */}
              {finalSmallGroups.length === 0 && unassignedOrphans.length === 0 && (
                <div className="text-sm text-gray-400 py-6 text-center border rounded-xl">沒有小車報名資料</div>
              )}
            </div>
          </section>
        )}

        {/* ── 總領隊 ── */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-3">👑 總領隊</h2>
          <select
            value={headLeaderRegId}
            onChange={e => setHeadLeaderRegId(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 w-full max-w-xs"
          >
            <option value="">（未設定）</option>
            {regs.map(r => {
              const cls = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
              return (
                <option key={r.registration_id} value={r.registration_id}>
                  {getName(r)}{cls ? `　${cls}` : ''}
                </option>
              )
            })}
          </select>
          <p className="text-xs text-gray-400 mt-2">
            總領隊可查看所有車的報到狀況。領隊報到頁（含連結與身份驗證）將於下一批次建立。
          </p>
        </section>

      </div>
    </AdminLayout>
  )
}
