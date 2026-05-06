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
  getSmallCarLeader,
  setSmallCarLeader as saveSmallCarLeader,
  getMonks,
} from '../../lib/supabase'

// ─── 常數與工具 ───────────────────────────────────────────────

const CHINESE_NUMS = ['一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五']
const chNum = n => CHINESE_NUMS[n - 1] ?? String(n)
const genId = () => `tmp-${Math.random().toString(36).slice(2)}`

const DIRECTIONS = [
  { key: 'down', label: '下山（回家）', emoji: '🚍' },
  { key: 'up',   label: '上山（回山）', emoji: '🚌' },
]
const dirLabel = d => DIRECTIONS.find(x => x.key === d)?.label ?? d

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

// 取得依方向對應的欄位 key
const fieldKeysFor = direction => ({
  transport: direction === 'up' ? 'transport_up' : 'transport_down',
  carpool:   direction === 'up' ? 'carpool_up'   : 'carpool_down',
  plate:     direction === 'up' ? 'plate_up'     : 'plate_down',
})

// 判斷交通方式（依方向動態讀對應欄位）
const isSmallDriver    = (ans, dir) => (ans?.[fieldKeysFor(dir).transport] ?? '').includes('自行開車')
const isSmallPassenger = (ans, dir) => (ans?.[fieldKeysFor(dir).transport] ?? '').includes('搭學員')
const isSmallCar       = (ans, dir) => isSmallDriver(ans, dir) || isSmallPassenger(ans, dir)

// isLargeCar 接受完整 reg 物件；訪客與學員邏輯一致
// - 有選「自行開車」或「搭學員」→ 小車（不管是否訪客）
// - 有選「精舍」→ 大車
// - 未填 → 訪客預設大車；學員算「其他/未填」
const isLargeCar = (r, dir) => {
  if (isSmallDriver(r.answers, dir) || isSmallPassenger(r.answers, dir)) return false
  const t = r.answers?.[fieldKeysFor(dir).transport] ?? ''
  if (r.student_id) return t.includes('精舍')
  return true  // 訪客未填 → 預設大車
}

// ─── 小車配對（純運算，不存 DB）────────────────────────────────
// 回傳 { matchedGroups, orphans }
// matchedGroups：有司機的群組（按順序編為小車 1、2…）
// orphans：找不到司機的乘客（需手動指定搭哪台小車）

function computeSmallGroups(regs, dir) {
  const keys = fieldKeysFor(dir)
  const drivers    = regs.filter(r => isSmallDriver(r.answers, dir))
  const passengers = regs.filter(r => isSmallPassenger(r.answers, dir))
  const usedIds    = new Set()
  const matchedGroups = []

  for (const driver of drivers) {
    const driverName = getName(driver)
    const plate      = driver.answers?.[keys.plate] ?? ''
    const matched    = passengers.filter(p => {
      if (usedIds.has(p.registration_id)) return false
      const cn = (p.answers?.[keys.carpool] ?? '').trim()
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
    monks: [],
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

  // 剩餘學員依班別＋組別分成小群，整群為單位排入（不拆散）
  const remaining = largePeople.filter(r => r.student_id && !assigned.has(r.registration_id))

  // 按「班別 + 組別」分群
  const groupMap = {}
  for (const r of remaining) {
    const cls = getClasses(r)[0]
    const key = `${cls?.class_name ?? ''}|||${cls?.group_name ?? ''}`
    if (!groupMap[key]) groupMap[key] = { className: cls?.class_name ?? '', groupName: cls?.group_name ?? '', members: [] }
    groupMap[key].members.push(r.registration_id)
  }

  // 排序：先班別、再組別
  const sortedGroups = Object.values(groupMap).sort((a, b) => {
    if (a.className !== b.className) return a.className.localeCompare(b.className, 'zh-TW')
    return a.groupName.localeCompare(b.groupName, 'zh-TW')
  })

  // 逐人排入：嚴格不超過座位數，座位滿了移到下一台車（同班同組盡量同車，但不強制）
  // 所有車都滿時，剩餘的人留在 unassigned 警示區
  let ci = 0
  outer: for (const group of sortedGroups) {
    for (const rid of group.members) {
      // 往後找到有空位的車
      while (ci < carCount && cars[ci].members.length >= cars[ci].seats) ci++
      if (ci >= carCount) break outer  // 全部座位都滿，停止排班
      cars[ci].members.push(rid)
      assigned.add(rid)
    }
  }

  // 處理訪客：有備註且能配對到學員 → 盡量排同車，但不超過座位數
  // 若該車已滿，整組（訪客＋親友）一起搬到有空位的車
  // 沒備註或找不到學員 → 留在未分配警示區
  const studentLarge = largePeople.filter(r => r.student_id)
  for (const guest of largePeople.filter(r => !r.student_id && !assigned.has(r.registration_id))) {
    const note    = getGuestNote(guest)
    const matched = findGuestMatch(note, studentLarge)
    if (matched) {
      const currentCar = cars.find(c => c.members.includes(matched.registration_id))
      if (currentCar) {
        if (currentCar.members.length < currentCar.seats) {
          // 車還有空位，直接把訪客塞進去
          currentCar.members.push(guest.registration_id)
        } else {
          // 車已滿：找可以容納 2 人的車（訪客＋親友一起搬）
          const carsWithRoom = cars.filter(c => c !== currentCar && c.members.length + 2 <= c.seats)
          const targetCar = carsWithRoom.length > 0
            // 優先選剩餘空位剛好夠的車（不浪費空間）
            ? carsWithRoom.reduce((a, b) => (a.seats - a.members.length) <= (b.seats - b.members.length) ? a : b)
            // 所有車都快滿了，選剩餘最多的
            : cars.filter(c => c !== currentCar).reduce((a, b) => (a.seats - a.members.length) >= (b.seats - b.members.length) ? a : b)
          // 把親友從原車移走
          currentCar.members = currentCar.members.filter(id => id !== matched.registration_id)
          currentCar.leaders = (currentCar.leaders ?? []).filter(id => id !== matched.registration_id)
          // 親友＋訪客一起進新車
          targetCar.members.push(matched.registration_id)
          targetCar.members.push(guest.registration_id)
        }
        assigned.add(guest.registration_id)
      }
    }
  }

  return cars
}

// ─── 車內成員顯示排序 ──────────────────────────────────────────
// 同班同組排在一起，訪客緊接在親友後面

function sortedMembersForDisplay(memberIds, regMap) {
  const regs = memberIds.map(id => regMap[id]).filter(Boolean)
  const studentRegsInCar = regs.filter(r => r.student_id)

  // 學員依班別→組別排序
  const sortedStudents = [...regs.filter(r => r.student_id)].sort((a, b) => {
    const ca = getClasses(a)[0], cb = getClasses(b)[0]
    const classA = ca?.class_name ?? '', classB = cb?.class_name ?? ''
    if (classA !== classB) return classA.localeCompare(classB, 'zh-TW')
    return (ca?.group_name ?? '').localeCompare(cb?.group_name ?? '', 'zh-TW')
  })

  // 訪客插在親友後面
  const result = sortedStudents.map(r => r.registration_id)
  for (const guest of regs.filter(r => !r.student_id)) {
    const note    = getGuestNote(guest)
    const matched = findGuestMatch(note, studentRegsInCar)
    const idx     = matched ? result.indexOf(matched.registration_id) : -1
    if (idx >= 0) result.splice(idx + 1, 0, guest.registration_id)
    else result.push(guest.registration_id)
  }
  return result
}

// ─── PersonRow 元件 ───────────────────────────────────────────

function PersonRow({ reg, carIdx, cars, smallGroups, onMove, onToggleLeader, guestInfo }) {
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
        onChange={e => {
          const v = e.target.value
          if (v === '') onMove(reg.registration_id, -1)
          else if (v.startsWith('small:')) onMove(reg.registration_id, v)
          else onMove(reg.registration_id, Number(v))
        }}
        className="text-xs border rounded px-1.5 py-0.5 bg-white shrink-0 focus:outline-none focus:ring-1 focus:ring-amber-400"
      >
        <option value="">未分配</option>
        {cars.map((c, i) => (
          <option key={c.tempId} value={String(i)}>{c.car_name}</option>
        ))}
        {/* 訪客在未分配時，額外顯示小車選項 */}
        {isGuest && carIdx < 0 && (smallGroups ?? []).length > 0 && (
          <>
            <option disabled>──小車──</option>
            {(smallGroups ?? []).map((g, gi) => (
              <option key={g.key} value={`small:${g.key}`}>
                小車 {gi + 1}・{g.driverName}
              </option>
            ))}
          </>
        )}
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

  const [loading, setLoading]     = useState(true)
  const [event,   setEvent]       = useState(null)
  const [regs,    setRegs]        = useState([])
  const [relGroups, setRelGroups] = useState([])

  // ── 上下山兩份資料分開存 ──
  // direction: 目前正在編輯的方向（'up' / 'down'）
  const [direction, setDirection] = useState('down')

  // 大車狀態：依方向各一份
  const [carsByDir, setCarsByDir]               = useState({ up: [], down: [] })
  const [carCountByDir, setCarCountByDir]       = useState({ up: 2, down: 2 })
  const [seatsPerCarByDir, setSeatsPerCarByDir] = useState({ up: 20, down: 20 })

  // 小車訪客手動移入 / 孤兒乘客指派：依方向各一份
  const [orphanByDir, setOrphanByDir]         = useState({ up: {}, down: {} })
  const [guestSmallByDir, setGuestSmallByDir] = useState({ up: {}, down: {} })

  // 領隊（上下山共用一位，不分方向）
  const [headLeaderRegId, setHeadLeaderRegId]         = useState('')
  const [headLeaderToken, setHeadLeaderToken]         = useState('')
  const [smallCarLeaderRegId, setSmallCarLeaderRegId] = useState('')
  const [smallCarLeaderToken, setSmallCarLeaderToken] = useState('')

  const [allMonks, setAllMonks] = useState([])
  const [saving,  setSaving]    = useState(false)
  const [msg,     setMsg]       = useState('')
  const [copyMsg, setCopyMsg]   = useState('')

  // ── 取目前方向的 state（方便讀取）──
  const cars                = carsByDir[direction]
  const carCount            = carCountByDir[direction]
  const seatsPerCar         = seatsPerCarByDir[direction]
  const orphanAssignments   = orphanByDir[direction]
  const guestSmallOverrides = guestSmallByDir[direction]

  // setter helpers（包成只改目前方向）
  const setCars = updater => setCarsByDir(prev => {
    const next = typeof updater === 'function' ? updater(prev[direction]) : updater
    return { ...prev, [direction]: next }
  })
  const setCarCount    = v => setCarCountByDir(prev => ({ ...prev, [direction]: v }))
  const setSeatsPerCar = v => setSeatsPerCarByDir(prev => ({ ...prev, [direction]: v }))
  const setOrphanAssignments = updater => setOrphanByDir(prev => {
    const next = typeof updater === 'function' ? updater(prev[direction]) : updater
    return { ...prev, [direction]: next }
  })
  const setGuestSmallOverrides = updater => setGuestSmallByDir(prev => {
    const next = typeof updater === 'function' ? updater(prev[direction]) : updater
    return { ...prev, [direction]: next }
  })

  // ── 衍生資料（含訪客）──
  const regMap      = useMemo(() => Object.fromEntries(regs.map(r => [r.registration_id, r])), [regs])
  // 已被手動移到小車的訪客，不再出現在大車名單
  const largePeople = useMemo(
    () => regs.filter(r => isLargeCar(r, direction) && !guestSmallOverrides.hasOwnProperty(r.registration_id)),
    [regs, guestSmallOverrides, direction]
  )
  const smallPeople = useMemo(
    () => regs.filter(r => isSmallCar(r.answers, direction)),
    [regs, direction]
  )

  // 小車配對：matchedGroups + orphans
  const { matchedGroups, orphans } = useMemo(
    () => computeSmallGroups(smallPeople, direction),
    [smallPeople, direction]
  )

  // 把已手動指派的孤兒乘客 + 從大車移過來的訪客，併入對應的小車群組
  const finalSmallGroups = useMemo(() =>
    matchedGroups.map(g => ({
      ...g,
      allMembers: [
        ...g.members,
        ...orphans.filter(o => orphanAssignments[o.registration_id] === g.key),
        ...regs.filter(r => !r.student_id && guestSmallOverrides[r.registration_id] === g.key),
      ],
    })),
  [matchedGroups, orphans, orphanAssignments, regs, guestSmallOverrides])

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
    const [
      { events },
      { registrations },
      { groups },
      { cars: savedCarsUp },
      { cars: savedCarsDown },
      { headLeader },
      { headLeader: smallCarLeader },
      { monks: monkList },
    ] = await Promise.all([
      getAllEvents(),
      getEventRegistrationsDetail(eventId),
      getRelationshipGroups(),
      getCarArrangement(eventId, 'up'),
      getCarArrangement(eventId, 'down'),
      getHeadLeader(eventId),
      getSmallCarLeader(eventId),
      getMonks(),
    ])
    setAllMonks(monkList ?? [])
    setEvent(events.find(e => e.event_id === eventId) ?? null)
    setRegs(registrations)
    setRelGroups(groups)

    // 還原兩個方向的排車結果
    const up   = restoreDirection(savedCarsUp,   registrations, 'up')
    const down = restoreDirection(savedCarsDown, registrations, 'down')

    setCarsByDir({ up: up.cars,             down: down.cars             })
    setCarCountByDir({ up: up.carCount,     down: down.carCount         })
    setSeatsPerCarByDir({ up: up.seats,     down: down.seats            })
    setOrphanByDir({ up: up.orphans,        down: down.orphans          })
    setGuestSmallByDir({ up: up.guests,     down: down.guests           })

    if (headLeader) {
      setHeadLeaderRegId(headLeader.registration_id ?? '')
      setHeadLeaderToken(headLeader.access_token ?? '')
    }
    if (smallCarLeader) {
      setSmallCarLeaderRegId(smallCarLeader.registration_id ?? '')
      setSmallCarLeaderToken(smallCarLeader.access_token ?? '')
    }
    setLoading(false)
  }

  // 還原單一方向的排車結果（從 DB savedCars + registrations）
  function restoreDirection(savedCars, registrations, dir) {
    const out = { cars: [], carCount: 2, seats: 20, orphans: {}, guests: {} }
    if (!savedCars || savedCars.length === 0) return out

    const largeSaved = savedCars.filter(c => c.car_type === 'large')
    if (largeSaved.length > 0) {
      out.cars = largeSaved.map(c => ({
        tempId:       c.car_id,
        car_name:     c.car_name,
        seats:        c.seats,
        members:      (c.car_members ?? []).map(m => m.registration_id),
        leaders:      (c.car_leaders ?? []).map(l => l.registration_id),
        access_token: c.access_token ?? '',
        monks:        (c.car_monks ?? []).map(m => m.monk_id),
      }))
      out.carCount = out.cars.length
      out.seats    = out.cars[0]?.seats ?? 20
    }

    const smallSaved = savedCars.filter(c => c.car_type === 'small')
    if (smallSaved.length > 0) {
      const smallRegs = registrations.filter(r => isSmallCar(r.answers, dir))
      const { matchedGroups: freshMatched } = computeSmallGroups(smallRegs, dir)
      for (const savedCar of smallSaved) {
        const groupKey   = savedCar.note   // 司機的 registration_id
        const freshGroup = freshMatched.find(g => g.key === groupKey)
        const originalIds = new Set((freshGroup?.members ?? []).map(m => m.registration_id))
        for (const member of (savedCar.car_members ?? [])) {
          if (!originalIds.has(member.registration_id)) {
            const reg = registrations.find(r => r.registration_id === member.registration_id)
            if (reg && !reg.student_id) out.guests[member.registration_id]   = groupKey
            else                        out.orphans[member.registration_id] = groupKey
          }
        }
      }
    }
    return out
  }

  // ── 操作 ──
  function handleAutoArrange() {
    if (largePeople.length === 0) { alert('此方向沒有搭精舍車的學員'); return }
    if (cars.length > 0 && !window.confirm(`自動排車會覆蓋目前「${dirLabel(direction)}」的排法，確定繼續？`)) return
    setCars(autoArrange(largePeople, Number(carCount), Number(seatsPerCar), relGroups))
  }

  function movePerson(regId, target) {
    // target 可能是大車 index（數字）或 'small:groupKey'（移到小車）或 -1（未分配）
    if (typeof target === 'string' && target.startsWith('small:')) {
      const groupKey = target.slice(6)
      // 從大車中移除
      setCars(prev => prev.map(c => ({
        ...c,
        members: c.members.filter(id => id !== regId),
        leaders: c.leaders.filter(id => id !== regId),
      })))
      // 標記為移到小車
      setGuestSmallOverrides(prev => ({ ...prev, [regId]: groupKey }))
    } else if (target === 'back-to-large') {
      setGuestSmallOverrides(prev => {
        const next = { ...prev }
        delete next[regId]
        return next
      })
    } else {
      const targetCarIdx = typeof target === 'string' ? Number(target) : target
      setGuestSmallOverrides(prev => {
        if (!prev.hasOwnProperty(regId)) return prev
        const next = { ...prev }; delete next[regId]; return next
      })
      setCars(prev => prev.map((c, i) => {
        const without = { ...c, members: c.members.filter(id => id !== regId), leaders: c.leaders.filter(id => id !== regId) }
        if (i === targetCarIdx) return { ...without, members: [...without.members, regId] }
        return without
      }))
    }
  }

  function toggleLeader(carIdx, regId) {
    setCars(prev => prev.map((c, i) => {
      if (i !== carIdx) return c
      const has = c.leaders.includes(regId)
      return { ...c, leaders: has ? c.leaders.filter(id => id !== regId) : [...c.leaders, regId] }
    }))
  }

  function toggleMonk(carIdx, monkId) {
    setCars(prev => prev.map((c, i) => {
      if (i !== carIdx) return c
      const has = (c.monks ?? []).includes(monkId)
      return { ...c, monks: has ? c.monks.filter(id => id !== monkId) : [...(c.monks ?? []), monkId] }
    }))
  }

  function updateCarName(carIdx, name) {
    setCars(prev => prev.map((c, i) => i === carIdx ? { ...c, car_name: name } : c))
  }

  async function handleSave() {
    setSaving(true); setMsg('')

    // 計算兩個方向各自的 finalSmallGroups
    const calcFinalSmall = dir => {
      const smallRegsDir = regs.filter(r => isSmallCar(r.answers, dir))
      const { matchedGroups: m } = computeSmallGroups(smallRegsDir, dir)
      const orphanMap = orphanByDir[dir]
      const guestMap  = guestSmallByDir[dir]
      return m.map(g => ({
        ...g,
        allMembers: [
          ...g.members,
          ...smallRegsDir.filter(o => orphanMap[o.registration_id] === g.key),
          ...regs.filter(r => !r.student_id && guestMap[r.registration_id] === g.key),
        ],
      }))
    }

    const upSmall   = calcFinalSmall('up')
    const downSmall = calcFinalSmall('down')

    const [upRes, downRes, hlRes, sclRes] = await Promise.all([
      saveCarArrangement(eventId, carsByDir.up,   upSmall,   'up'),
      saveCarArrangement(eventId, carsByDir.down, downSmall, 'down'),
      headLeaderRegId
        ? saveHeadLeader(eventId, headLeaderRegId)
        : Promise.resolve({ success: true }),
      smallCarLeaderRegId
        ? saveSmallCarLeader(eventId, smallCarLeaderRegId)
        : Promise.resolve({ success: true }),
    ])

    setSaving(false)
    if (upRes.success && downRes.success && hlRes.success && sclRes.success) {
      setMsg('已儲存（上山＋下山）✓')
      // 儲存後重新讀取 token（每次儲存 token 會更新，連結需重新複製）
      await load()
    } else {
      setMsg(`儲存失敗：${upRes.error || downRes.error || hlRes.error || sclRes.error}`)
    }
    setTimeout(() => setMsg(''), 4000)
  }

  function copyLink(token, label) {
    const url = `${window.location.origin}/car-checkin/${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg(`${label} 連結已複製`)
      setTimeout(() => setCopyMsg(''), 2500)
    })
  }

  function handleExport() {
    const rows = [['方向', '車次', '姓名', '班級', '組別', '身份別', '備註']]

    // 兩個方向各自匯出
    for (const dir of ['down', 'up']) {
      const dirCars      = carsByDir[dir]
      const dirSmallRegs = regs.filter(r => isSmallCar(r.answers, dir))
      const { matchedGroups: dirMatched, orphans: dirOrphans } =
        computeSmallGroups(dirSmallRegs, dir)
      const dirOrphanMap = orphanByDir[dir]
      const dirGuestMap  = guestSmallByDir[dir]
      const dirFinalSmall = dirMatched.map(g => ({
        ...g,
        allMembers: [
          ...g.members,
          ...dirOrphans.filter(o => dirOrphanMap[o.registration_id] === g.key),
          ...regs.filter(r => !r.student_id && dirGuestMap[r.registration_id] === g.key),
        ],
      }))

      const dirText = dir === 'up' ? '上山' : '下山'

      // 大車
      for (const car of dirCars) {
        for (const regId of car.members) {
          const r = regMap[regId]
          if (!r) continue
          const name     = getName(r)
          const classes  = getClasses(r)
          const cls      = classes.map(c => c.class_name).join('/')
          const grp      = classes.map(c => c.group_name).filter(Boolean).join('/')
          const identity = r.answers?.identity ?? ''
          const note     = car.leaders.includes(regId) ? '領隊' : ''
          rows.push([dirText, car.car_name, name, cls, grp, identity, note])
        }
        for (const monkId of (car.monks ?? [])) {
          const monk = allMonks.find(m => m.id === monkId)
          if (monk) rows.push([dirText, car.car_name, monk.name, '', '', '法師', '法師'])
        }
      }

      // 小車
      dirFinalSmall.forEach((g, idx) => {
        for (const r of g.allMembers) {
          const name     = getName(r)
          const classes  = getClasses(r)
          const cls      = classes.map(c => c.class_name).join('/')
          const grp      = classes.map(c => c.group_name).filter(Boolean).join('/')
          const identity = r.answers?.identity ?? ''
          const isDriver = r.registration_id === g.key
          const note     = isDriver ? `司機${g.plate ? `（${g.plate}）` : ''}` : '乘客'
          rows.push([dirText, `小車 ${idx + 1}`, name, cls, grp, identity, note])
        }
      })

      // 未指定小車的孤兒
      const dirUnassignedOrphans = dirOrphans.filter(o => !dirOrphanMap[o.registration_id])
      for (const r of dirUnassignedOrphans) {
        const name     = getName(r)
        const classes  = getClasses(r)
        const cls      = classes.map(c => c.class_name).join('/')
        const grp      = classes.map(c => c.group_name).filter(Boolean).join('/')
        const identity = r.answers?.identity ?? ''
        const carpoolNm = r.answers?.[fieldKeysFor(dir).carpool] ?? ''
        rows.push([dirText, `小車（未指定）`, name, cls, grp, identity, carpoolNm ? `→ ${carpoolNm}` : ''])
      }
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
              disabled={carsByDir.up.length === 0 && carsByDir.down.length === 0}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              📥 匯出分車名單
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors font-medium"
            >
              {saving ? '儲存中…' : '儲存（上山＋下山）'}
            </button>
          </div>
        </div>

        {/* ── 上下山 Tab ── */}
        <div className="flex gap-2 border-b">
          {DIRECTIONS.map(d => {
            const active = direction === d.key
            const carCnt  = carsByDir[d.key].length
            return (
              <button
                key={d.key}
                onClick={() => setDirection(d.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  active
                    ? 'border-amber-500 text-amber-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {d.emoji} {d.label}
                {carCnt > 0 && (
                  <span className="ml-2 text-xs text-gray-400">（{carCnt} 台）</span>
                )}
              </button>
            )
          })}
        </div>

        {/* 統計卡片（依目前方向） */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label={`搭精舍車（大車）— ${dirLabel(direction)}`} value={largePeople.length} color="bg-blue-50 border-blue-200 text-blue-700" />
          <StatCard label={`小車（自行/共乘）— ${dirLabel(direction)}`} value={smallPeople.length} color="bg-green-50 border-green-200 text-green-700" />
          <StatCard
            label="其他/未填"
            value={regs.length - largePeople.length - smallPeople.length}
            color="bg-gray-50 border-gray-200 text-gray-600"
          />
        </div>

        {/* ── 大車排車 ── */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-4">
            🚌 大車排車
            <span className="text-sm font-normal text-gray-500 ml-2">{dirLabel(direction)}</span>
          </h2>

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
                onClick={() => { if (window.confirm(`確定清除「${dirLabel(direction)}」所有排車結果？`)) setCars([]) }}
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
                    <span className="text-xs text-gray-500">
                      座位數：<strong>{car.seats}</strong>
                      <span className="mx-2 text-gray-300">|</span>
                      已排入：<strong className={car.members.length > car.seats ? 'text-red-600' : ''}>{car.members.length}</strong>
                    </span>
                    {car.members.length > car.seats && (
                      <span className="text-xs font-bold text-white bg-red-600 rounded-full px-2.5 py-0.5 animate-pulse">
                        ⚠️ 超額 +{car.members.length - car.seats}
                      </span>
                    )}
                    {car.members.length === car.seats && (
                      <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">已滿</span>
                    )}
                    {car.leaders.length > 0 && (
                      <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                        領隊：{car.leaders.map(lid => regMap[lid] ? getName(regMap[lid]) : '?').join('、')}
                      </span>
                    )}
                    {(car.monks ?? []).length > 0 && (
                      <span className="text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                        法師：{(car.monks ?? []).map(mid => allMonks.find(m => m.id === mid)?.name ?? '').filter(Boolean).join('、')}
                      </span>
                    )}
                    <div className="ml-auto shrink-0">
                      {car.access_token ? (
                        <button
                          onClick={() => copyLink(car.access_token, `${dirLabel(direction)}・${car.car_name}`)}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                          title={`複製 ${car.car_name} 領隊連結`}
                        >
                          🔗 複製連結
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">（儲存後可複製）</span>
                      )}
                    </div>
                  </div>
                  {/* 成員列表 */}
                  <div className="divide-y">
                    {car.members.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-gray-400">（此車目前無人）</div>
                    ) : (
                      sortedMembersForDisplay(car.members, regMap).map(regId => (
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

                  {/* 法師指派（可選，不強制） */}
                  {allMonks.length > 0 && (
                    <div className="px-4 py-3 bg-purple-50 border-t border-purple-100">
                      <div className="text-xs font-medium text-purple-600 mb-2">🏯 搭乘法師（可選）</div>
                      <div className="flex flex-wrap gap-2">
                        {allMonks.map(monk => {
                          const assigned = (car.monks ?? []).includes(monk.id)
                          return (
                            <button
                              key={monk.id}
                              onClick={() => toggleMonk(ci, monk.id)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                assigned
                                  ? 'bg-purple-600 text-white border-purple-600'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-600'
                              }`}
                            >
                              {assigned ? '✓ ' : ''}{monk.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
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
                    smallGroups={finalSmallGroups}
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
            <h2 className="text-base font-bold text-gray-700 mb-2">
              🚗 小車配對
              <span className="text-sm font-normal text-gray-500 ml-2">{dirLabel(direction)}</span>
            </h2>
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
                      const carpoolNm = r.answers?.[fieldKeysFor(direction).carpool] ?? ''
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
                      const carpoolNm = r.answers?.[fieldKeysFor(direction).carpool] ?? ''
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

        {/* ── 小車領隊（上下山共用） ── */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-3">
            🚗 小車領隊
            <span className="text-xs font-normal text-gray-400 ml-2">（上下山共用）</span>
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={smallCarLeaderRegId}
              onChange={e => setSmallCarLeaderRegId(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 w-full max-w-xs"
            >
              <option value="">（未設定）</option>
              {regs.filter(r => r.student_id).map(r => {
                const cls = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                return (
                  <option key={r.registration_id} value={r.registration_id}>
                    {getName(r)}{cls ? `　${cls}` : ''}
                  </option>
                )
              })}
            </select>
            {smallCarLeaderToken ? (
              <button
                onClick={() => copyLink(smallCarLeaderToken, '小車領隊')}
                className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                🔗 複製小車領隊連結
              </button>
            ) : (
              <span className="text-xs text-gray-400">（儲存後可複製連結）</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            小車領隊可查看並操作所有小車成員的報到狀況（含上山與下山）。<br />
            ⚠️ 每次儲存後連結會更新，請重新複製。
          </p>
        </section>

        {/* ── 總領隊（上下山共用） ── */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-3">
            👑 總領隊
            <span className="text-xs font-normal text-gray-400 ml-2">（上下山共用）</span>
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={headLeaderRegId}
              onChange={e => setHeadLeaderRegId(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 w-full max-w-xs"
            >
              <option value="">（未設定）</option>
              {regs.filter(r => r.student_id).map(r => {
                const cls = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                return (
                  <option key={r.registration_id} value={r.registration_id}>
                    {getName(r)}{cls ? `　${cls}` : ''}
                  </option>
                )
              })}
            </select>
            {headLeaderToken ? (
              <button
                onClick={() => copyLink(headLeaderToken, '總領隊')}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                🔗 複製總領隊連結
              </button>
            ) : (
              <span className="text-xs text-gray-400">（儲存後可複製連結）</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            總領隊看板可即時查看所有大車＋小車的報到進度（含上山與下山）。<br />
            ⚠️ 每次儲存排車後 token 會更新，請重新複製連結再傳給領隊。
          </p>
        </section>

        {/* 複製成功提示 */}
        {copyMsg && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg whitespace-nowrap z-50">
            ✓ {copyMsg}
          </div>
        )}

      </div>
    </AdminLayout>
  )
}
