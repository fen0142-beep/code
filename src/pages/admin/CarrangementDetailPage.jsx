import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import AdminLayout from '../../components/AdminLayout'
import SearchableSelect from '../../components/SearchableSelect'
import {
  getAllEvents,
  getEventRegistrationsDetail,
  getRelationshipGroups,
  getCarArrangement,
  saveCarArrangement,
  getHeadLeader,
  setHeadLeader as saveHeadLeader,
  getSmallCarLeaders,
  setSmallCarLeaders as saveSmallCarLeaders,
  getMonks,
  setRegistrationIsDriver,
  setTransportOverride,
} from '../../lib/supabase'
import {
  getPreceptLevel,
  getPreceptFlags,
  preceptBadgeProps,
  isDriverFromAnswers,
} from '../../lib/registrationHelpers'

import { DIRECTIONS, chNum, genId, dirLabel, getName, getClasses, getGuestNote, findGuestMatch, findGuestHost, fieldKeysFor, isSmallDriver, isSmallPassenger, isSmallCar, isLargeCar, isOtherTransport, computeSmallGroups, sortedMembersForDisplay } from '../../lib/carrangeHelpers'
import autoArrange from '../../lib/autoArrange'
import PersonRow from '../../components/PersonRow'
import StatCard from '../../components/StatCard'


export default function CarrangementDetailPage() {
  const { eventId } = useParams()
  const navigate    = useNavigate()

  const [loading, setLoading]     = useState(true)
  const [event,   setEvent]       = useState(null)
  const [regs,    setRegs]        = useState([])
  const [relGroups, setRelGroups] = useState([])

  // ── 上下山兩份資料分開存 ──
  // direction: 目前正在編輯的方向（'up' / 'down'）
  // 一般流程：先排上山、再排下山（下山多半延用上山排法）
  const [direction, setDirection] = useState('up')

  // 大車狀態：依方向各一份
  const [carsByDir, setCarsByDir]               = useState({ up: [], down: [] })
  const [carCountByDir, setCarCountByDir]       = useState({ up: 2, down: 2 })
  const [seatsPerCarByDir, setSeatsPerCarByDir] = useState({ up: 20, down: 20 })

  // 小車訪客手動移入 / 孤兒乘客指派：依方向各一份
  const [orphanByDir, setOrphanByDir]         = useState({ up: {}, down: {} })
  const [guestSmallByDir, setGuestSmallByDir] = useState({ up: {}, down: {} })

  // 小車法師指派：{ up: { [groupKey]: monkId[] }, down: ... }
  const [smallCarMonksByDir, setSmallCarMonksByDir] = useState({ up: {}, down: {} })
  // 小車提前出發：{ up: { [groupKey]: true }, down: ... }
  const [smallPreDepartByDir, setSmallPreDepartByDir] = useState({ up: {}, down: {} })
  // 小車延後回程：{ up: { [groupKey]: true }, down: ... }（下山方向用，上山不會勾）
  const [smallLateReturnByDir, setSmallLateReturnByDir] = useState({ up: {}, down: {} })

  // 自動排車警示（每次按 ✨ 自動排車後產出，依方向各一份；手動關閉或重排會清空）
  const [autoArrangeWarningsByDir, setAutoArrangeWarningsByDir] = useState({ up: [], down: [] })

  // 自動排車選項：是否啟用「三皈五戒同車」（依方向各一份）
  const [groupPreceptByDir, setGroupPreceptByDir] = useState({ up: false, down: false })

  // 領隊（上下山共用，不分方向）
  const [headLeaderRegId, setHeadLeaderRegId]   = useState('')
  const [headLeaderToken, setHeadLeaderToken]   = useState('')
  // 小車領隊改成多人：smallCarLeaders = [{ registration_id, access_token }]
  const [smallCarLeaders, setSmallCarLeaders]   = useState([])

  const [allMonks, setAllMonks] = useState([])
  const [saving,  setSaving]    = useState(false)
  const [msg,     setMsg]       = useState('')
  const [copyMsg, setCopyMsg]   = useState('')
  // 小車「指定主司機」按下後，紀錄正在處理的 group key（避免重複按／顯示 disabled）
  const [driverPickerBusy, setDriverPickerBusy] = useState(null)

  // ── 取目前方向的 state（方便讀取）──
  const cars                = carsByDir[direction]
  const carCount            = carCountByDir[direction]
  const seatsPerCar         = seatsPerCarByDir[direction]
  const orphanAssignments   = orphanByDir[direction]
  const guestSmallOverrides = guestSmallByDir[direction]
  const autoArrangeWarnings = autoArrangeWarningsByDir[direction]
  const groupPrecept        = groupPreceptByDir[direction]

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
  const setAutoArrangeWarnings = v => setAutoArrangeWarningsByDir(prev => ({ ...prev, [direction]: v }))
  const setGroupPrecept        = v => setGroupPreceptByDir(prev => ({ ...prev, [direction]: v }))

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
      const matched = findGuestHost(guest, studentRegs)
      map[guest.registration_id] = { note, matchedName: matched ? getName(matched) : null }
    }
    return map
  }, [largePeople])

  // 需詢問的訪客（坐大車但找不到對應學員）
  const guestsNeedFollowup = useMemo(() =>
    largePeople.filter(r => !r.student_id && !guestInfoMap[r.registration_id]?.matchedName),
  [largePeople, guestInfoMap])

  // 其他交通（本方向不歸大車也不歸小車的人）
  const otherTransportRegs = useMemo(() =>
    regs.filter(r => isOtherTransport(r, direction)),
  [regs, direction])

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
      { headLeaders: smallCarLeaderList },
      { monks: monkList },
    ] = await Promise.all([
      getAllEvents(),
      getEventRegistrationsDetail(eventId),
      getRelationshipGroups(),
      getCarArrangement(eventId, 'up'),
      getCarArrangement(eventId, 'down'),
      getHeadLeader(eventId),
      getSmallCarLeaders(eventId),
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
    setSmallCarMonksByDir({ up: up.smallCarMonks, down: down.smallCarMonks })
    setSmallPreDepartByDir({ up: up.smallPreDeparts, down: down.smallPreDeparts })
    setSmallLateReturnByDir({ up: up.smallLateReturns, down: down.smallLateReturns })

    if (headLeader) {
      setHeadLeaderRegId(headLeader.registration_id ?? '')
      setHeadLeaderToken(headLeader.access_token ?? '')
    }
    setSmallCarLeaders(smallCarLeaderList ?? [])
    setLoading(false)
  }

  // ── 同車號小車：師父手動指定主司機 ──
  // 對 group.candidates 全部更新 is_driver（被選位 true、其他 false），重抓 regs
  // 不呼叫整個 load()，避免洗掉尚未儲存的大車排車修改
  async function handleSelectMainDriver(group, newDriverRegId) {
    if (!group?.candidates || group.candidates.length === 0) return
    setDriverPickerBusy(group.key)
    try {
      const results = await Promise.all(
        group.candidates.map(c =>
          setRegistrationIsDriver(c.registration_id, c.registration_id === newDriverRegId)
        )
      )
      const firstErr = results.find(r => !r.success)
      if (firstErr) {
        alert('指定主司機失敗：' + firstErr.error)
        return
      }
      const { registrations } = await getEventRegistrationsDetail(eventId)
      setRegs(registrations)
    } catch (e) {
      alert('指定主司機失敗：' + (e?.message ?? String(e)))
    } finally {
      setDriverPickerBusy(null)
    }
  }

  // 還原單一方向的排車結果（從 DB savedCars + registrations）
  function restoreDirection(savedCars, registrations, dir) {
    const out = { cars: [], carCount: 2, seats: 20, orphans: {}, guests: {}, smallCarMonks: {}, smallPreDeparts: {}, smallLateReturns: {} }
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
        preDepart:    c.pre_depart || false,
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
        // 小車法師
        const savedMonks = (savedCar.car_monks ?? []).map(m => m.monk_id)
        if (savedMonks.length > 0) out.smallCarMonks[groupKey] = savedMonks
        // 小車提前出發
        if (savedCar.pre_depart) out.smallPreDeparts[groupKey] = true
        // 小車延後回程
        if (savedCar.late_return) out.smallLateReturns[groupKey] = true
      }
    }
    return out
  }

  // ── 操作 ──
  function handleAutoArrange() {
    if (largePeople.length === 0) { alert('此方向沒有搭精舍車的學員'); return }
    if (cars.length > 0 && !window.confirm(`自動排車會覆蓋目前「${dirLabel(direction)}」的排法，確定繼續？`)) return
    const { cars: newCars, warnings } = autoArrange(
      largePeople,
      Number(carCount),
      Number(seatsPerCar),
      relGroups,
      { groupPrecept }
    )
    setCars(newCars)
    setAutoArrangeWarnings(warnings)
  }

  // 把目前方向的排法（大車＋座位＋領隊＋法師）複製到另一個方向
  // 規則：只保留「在另一個方向也搭精舍車（大車）」的人，其他人會自動被踢出大車
  // 例如：上山搭精舍車、下山自己開車的學員，複製到下山時會被排除
  function handleCopyToOtherDir() {
    const otherDir = direction === 'up' ? 'down' : 'up'
    const otherCarsExist = carsByDir[otherDir].length > 0
    if (otherCarsExist && !window.confirm(`會覆蓋目前「${dirLabel(otherDir)}」的所有排車結果，確定繼續？`)) return

    // 過濾每台車的成員：只保留另一方向也搭精舍車（isLargeCar）的人
    let removedCount = 0
    const copiedCars = carsByDir[direction].map(c => {
      const keptMembers = c.members.filter(rid => {
        const reg = regMap[rid]
        if (!reg) return false
        const keep = isLargeCar(reg, otherDir)
        if (!keep) removedCount++
        return keep
      })
      return {
        tempId:   genId(),
        car_name: c.car_name,
        seats:    c.seats,
        members:  keptMembers,
        // 領隊只保留還在車上的人
        leaders:  c.leaders.filter(lid => keptMembers.includes(lid)),
        // 法師沒有報名資料，整批保留（可在另一方向 Tab 手動移除）
        monks:    [...(c.monks ?? [])],
        // access_token 不複製，留空，儲存後才產生新的
      }
    })

    setCarsByDir(prev      => ({ ...prev, [otherDir]: copiedCars }))
    setCarCountByDir(prev  => ({ ...prev, [otherDir]: carCountByDir[direction] }))
    setSeatsPerCarByDir(prev => ({ ...prev, [otherDir]: seatsPerCarByDir[direction] }))
    // orphan 與 guest small 依賴對應方向的 carpool 欄位，重新計算最準，不複製
    setOrphanByDir(prev     => ({ ...prev, [otherDir]: {} }))
    setGuestSmallByDir(prev => ({ ...prev, [otherDir]: {} }))
    // 清掉另一方向的舊自動排車警示（複製不是自動排車，避免顯示過時提醒）
    setAutoArrangeWarningsByDir(prev => ({ ...prev, [otherDir]: [] }))

    setDirection(otherDir)
    const fromLabel = dirLabel(direction)
    const toLabel   = dirLabel(otherDir)
    setMsg(
      removedCount > 0
        ? `已從「${fromLabel}」複製到「${toLabel}」（自動排除 ${removedCount} 位另一方向不搭精舍車的人），記得按儲存`
        : `已從「${fromLabel}」複製到「${toLabel}」，記得按儲存`
    )
    setTimeout(() => setMsg(''), 8000)
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
    // 一位法師同方向只能在一台車：點同台 = 取消；點別台 = 從原車移過來
    setCars(prev => {
      const sourceIdx = prev.findIndex(c => (c.monks ?? []).includes(monkId))
      if (sourceIdx === carIdx) {
        // 點同台車 → 取消指派
        return prev.map((c, i) => i === carIdx
          ? { ...c, monks: (c.monks ?? []).filter(id => id !== monkId) }
          : c)
      }
      // 點別台車 → 從原車移除（若有），加到目標車
      return prev.map((c, i) => {
        if (i === sourceIdx) return { ...c, monks: (c.monks ?? []).filter(id => id !== monkId) }
        if (i === carIdx)    return { ...c, monks: [...(c.monks ?? []), monkId] }
        return c
      })
    })
  }

  // 切換小車法師指派（同方向一位法師只能在一個群組）
  function toggleSmallCarMonk(groupKey, monkId) {
    setSmallCarMonksByDir(prev => {
      const dirMonks = { ...prev[direction] }
      // 從所有群組移除這個法師
      for (const k of Object.keys(dirMonks)) {
        dirMonks[k] = dirMonks[k].filter(id => id !== monkId)
        if (dirMonks[k].length === 0) delete dirMonks[k]
      }
      // 若原本就在這個群組 → 取消（已移除）；否則 → 加入
      const wasHere = (prev[direction][groupKey] ?? []).includes(monkId)
      if (!wasHere) {
        dirMonks[groupKey] = [...(dirMonks[groupKey] ?? []), monkId]
      }
      return { ...prev, [direction]: dirMonks }
    })
  }

  // ─── 跨大小車法師指派（同方向唯一性） ─────────────────────
  // 從所有大車 + 所有小車移除這位法師
  function unassignMonkAllCars(monkId) {
    setCars(prev => prev.map(c => ({ ...c, monks: (c.monks ?? []).filter(id => id !== monkId) })))
    setSmallCarMonksByDir(prev => {
      const d = { ...prev[direction] }
      for (const k of Object.keys(d)) {
        d[k] = d[k].filter(id => id !== monkId)
        if (d[k].length === 0) delete d[k]
      }
      return { ...prev, [direction]: d }
    })
  }

  // 指派到大車 ci（自動從其他大車與所有小車移除）
  function assignMonkToLargeCar(ci, monkId) {
    setCars(prev => prev.map((c, i) => {
      const filtered = (c.monks ?? []).filter(id => id !== monkId)
      return { ...c, monks: i === ci ? [...filtered, monkId] : filtered }
    }))
    setSmallCarMonksByDir(prev => {
      const d = { ...prev[direction] }
      let changed = false
      for (const k of Object.keys(d)) {
        const next = d[k].filter(id => id !== monkId)
        if (next.length !== d[k].length) { d[k] = next; changed = true }
        if (d[k].length === 0) delete d[k]
      }
      return changed ? { ...prev, [direction]: d } : prev
    })
  }

  // 指派到小車 groupKey（自動從所有大車與其他小車移除）
  function assignMonkToSmallCar(groupKey, monkId) {
    setCars(prev => {
      const idx = prev.findIndex(c => (c.monks ?? []).includes(monkId))
      if (idx < 0) return prev
      return prev.map((c, i) => i === idx
        ? { ...c, monks: (c.monks ?? []).filter(id => id !== monkId) }
        : c)
    })
    setSmallCarMonksByDir(prev => {
      const d = { ...prev[direction] }
      for (const k of Object.keys(d)) {
        d[k] = d[k].filter(id => id !== monkId)
        if (d[k].length === 0) delete d[k]
      }
      d[groupKey] = [...(d[groupKey] ?? []), monkId]
      return { ...prev, [direction]: d }
    })
  }

  // 切換小車提前出發旗標
  function toggleSmallPreDepart(groupKey) {
    setSmallPreDepartByDir(prev => {
      const d = { ...prev[direction] }
      if (d[groupKey]) delete d[groupKey]
      else d[groupKey] = true
      return { ...prev, [direction]: d }
    })
  }

  // 切換小車延後回程旗標（下山方向用）
  function toggleSmallLateReturn(groupKey) {
    setSmallLateReturnByDir(prev => {
      const d = { ...prev[direction] }
      if (d[groupKey]) delete d[groupKey]
      else d[groupKey] = true
      return { ...prev, [direction]: d }
    })
  }

  // 「其他交通」個人提前/延後 override（即存 DB，不等 handleSave）
  async function handleToggleOverride(reg, field) {
    const current = !!reg[field]
    const next = !current
    // 樂觀更新
    setRegs(prev => prev.map(r =>
      r.registration_id === reg.registration_id ? { ...r, [field]: next } : r
    ))
    const { success, error } = await setTransportOverride(reg.registration_id, field, next)
    if (!success) {
      alert(`設定失敗：${error}`)
      // 回滾
      setRegs(prev => prev.map(r =>
        r.registration_id === reg.registration_id ? { ...r, [field]: current } : r
      ))
    }
  }


  function updateCarName(carIdx, name) {
    setCars(prev => prev.map((c, i) => i === carIdx ? { ...c, car_name: name } : c))
  }

  async function handleSave() {
    // ── 儲存前檢查 ──
    // 1. 人員爆掉：列出所有超額車輛（已含法師人數），強制確認
    const overflowList = []
    for (const dir of ['up', 'down']) {
      for (const car of carsByDir[dir]) {
        const total = car.members.length + (car.monks ?? []).length
        if (total > car.seats) {
          overflowList.push(`${dirLabel(dir)}・${car.car_name}（${total}/${car.seats}，超額 +${total - car.seats}）`)
        }
      }
    }
    if (overflowList.length > 0) {
      const proceed = window.confirm(
        `⚠️ 以下車輛人數超過座位數：\n\n${overflowList.join('\n')}\n\n仍要儲存？`
      )
      if (!proceed) return
    }

    // 2. 法師：整場活動都沒指派任何法師，提醒一次（可繞過）
    const totalMonks =
      carsByDir.up.flatMap(c => c.monks ?? []).length +
      carsByDir.down.flatMap(c => c.monks ?? []).length +
      Object.values(smallCarMonksByDir.up).flat().length +
      Object.values(smallCarMonksByDir.down).flat().length
    const hasAnyCar = carsByDir.up.length > 0 || carsByDir.down.length > 0
    if (hasAnyCar && totalMonks === 0) {
      const proceed = window.confirm('法師尚未排入車次，仍要儲存？')
      if (!proceed) return
    }

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

    const smallCarLeaderRegIds = smallCarLeaders.map(l => l.registration_id).filter(Boolean)
    const [upRes, downRes, hlRes, sclRes] = await Promise.all([
      saveCarArrangement(eventId, carsByDir.up,   upSmall,   'up',   smallCarMonksByDir.up,   smallPreDepartByDir.up,   smallLateReturnByDir.up),
      saveCarArrangement(eventId, carsByDir.down, downSmall, 'down', smallCarMonksByDir.down, smallPreDepartByDir.down, smallLateReturnByDir.down),
      headLeaderRegId
        ? saveHeadLeader(eventId, headLeaderRegId)
        : Promise.resolve({ success: true }),
      saveSmallCarLeaders(eventId, smallCarLeaderRegIds),
    ])

    setSaving(false)
    if (upRes.success && downRes.success && hlRes.success && sclRes.success) {
      setMsg('已儲存（去程＋回程）✓')
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
    // 共用工具：班級／組別字串
    const clsOf = r => getClasses(r).map(c => c.class_name).join('/')
    const grpOf = r => getClasses(r).map(c => c.group_name).filter(Boolean).join('/')
    const idOf  = r => r.answers?.identity ?? (r.student_id ? '' : '訪客')

    // Excel sheet 名稱受限：≤31 字、不能含 : \ / ? * [ ]
    const safeSheetName = name => String(name).replace(/[:\\/?*\[\]]/g, '').slice(0, 31)

    // ── 排序工具 ──────────────────────────────────────
    // 班級層級順序：日間 < 夜間；初級 < 中級 < 高級 < 研經 < 其他 < 空白
    const classRank = name => {
      if (!name) return [9, 9]   // 空白：放最後
      const day = name.includes('日間') ? 0 : name.includes('夜間') ? 1 : 2
      let lv = 5
      if (name.includes('初級')) lv = 1
      else if (name.includes('中級')) lv = 2
      else if (name.includes('高級')) lv = 3
      else if (name.includes('研經')) lv = 4
      return [day, lv]
    }
    const sortByClassGroup = (a, b) => {
      const ca = getClasses(a)[0] || {}
      const cb = getClasses(b)[0] || {}
      const [dA, lA] = classRank(ca.class_name)
      const [dB, lB] = classRank(cb.class_name)
      if (dA !== dB) return dA - dB
      if (lA !== lB) return lA - lB
      return (ca.group_name ?? '').localeCompare(cb.group_name ?? '', 'zh-TW')
    }

    // 同車備註鏈式合併（Union-Find）：A 備註提到 B → A、B 排在一起；B 備註提到 C → 三人一組
    // 排序前先依 sortByClassGroup 排好，再用 Union-Find 把同群組的人聚到一起
    // 簇與簇之間維持原順序（簇的代表 = 第一個成員的位置）
    function clusterByMentions(arr) {
      if (arr.length < 2) return arr
      const parent = arr.map((_, i) => i)
      const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]))
      const union = (i, j) => { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj }

      for (let i = 0; i < arr.length; i++) {
        const note = getGuestNote(arr[i])
        if (!note.trim()) continue
        for (let j = 0; j < arr.length; j++) {
          if (i === j) continue
          const nm = getName(arr[j])
          if (nm && nm.length >= 2 && note.includes(nm)) union(i, j)
        }
      }

      const seen = new Array(arr.length).fill(false)
      const result = []
      for (let i = 0; i < arr.length; i++) {
        if (seen[i]) continue
        const root = find(i)
        for (let j = i; j < arr.length; j++) {
          if (!seen[j] && find(j) === root) {
            result.push(arr[j])
            seen[j] = true
          }
        }
      }
      return result
    }

    // 三皈／五戒備註文字（給匯出備註欄用，法師沒 answers 自動回空字串）
    // 同時報名兩者時用「三皈、五戒」呈現（兩者可並存）
    const preceptText = r => {
      const { refuge, five } = getPreceptFlags(r)
      if (refuge && five) return '三皈、五戒'
      if (five) return '五戒'
      if (refuge) return '三皈'
      return ''
    }

    // 取得某 host 學員所對應的訪客（host_student_id 直接配對，或備註姓名比對相容舊資料）
    const guestsOfHost = (host, pool) => {
      if (!host?.student_id) return []
      const hostName = getName(host)
      return pool.filter(g => {
        if (g.host_student_id && g.host_student_id === host.student_id) return true
        const note = getGuestNote(g)
        if (note && hostName.length >= 2 && note.includes(hostName)) return true
        return false
      })
    }

    // ── 大車 sheet：合併 up + down（依 car_name）───────
    function buildLargeCarSheet(carName, upCar, downCar) {
      const upMembers   = new Set(upCar?.members ?? [])
      const downMembers = new Set(downCar?.members ?? [])
      const upLeaders   = new Set(upCar?.leaders ?? [])
      const downLeaders = new Set(downCar?.leaders ?? [])
      const upMonkIds   = new Set(upCar?.monks ?? [])
      const downMonkIds = new Set(downCar?.monks ?? [])
      const leaderAny   = new Set([...upLeaders, ...downLeaders])

      // 聯集所有 member regId
      const allIds  = [...new Set([...upMembers, ...downMembers])]
      const allRegs = allIds.map(id => regMap[id]).filter(Boolean)

      // 分組：領隊 / 一般學員 / 訪客
      // 領隊保持 car.leaders 的儲存順序（手動選定，照班級排會打亂師父的安排）
      const leaderOrder = [
        ...(upCar?.leaders ?? []),
        ...(downCar?.leaders ?? []).filter(id => !(upCar?.leaders ?? []).includes(id)),
      ]
      const leaderRegs    = leaderOrder.map(id => regMap[id]).filter(Boolean)
      const otherStudents = allRegs.filter(r => r.student_id && !leaderAny.has(r.registration_id))
      const guestPool     = allRegs.filter(r => !r.student_id && !leaderAny.has(r.registration_id))

      // 領隊不重排（保留儲存順序）；其他學員照班級組別 + 同車備註聚簇
      const sortedLeaders  = clusterByMentions(leaderRegs)
      const sortedStudents = clusterByMentions([...otherStudents].sort(sortByClassGroup))

      // 訪客緊跟 host
      const finalRegs = []
      let remaining = [...guestPool]
      const flush = host => {
        const attached = guestsOfHost(host, remaining)
        finalRegs.push(...attached)
        remaining = remaining.filter(g => !attached.includes(g))
      }
      for (const r of sortedLeaders)  { finalRegs.push(r); flush(r) }
      for (const r of sortedStudents) { finalRegs.push(r); flush(r) }
      finalRegs.push(...remaining)  // 找不到 host 的訪客

      // 組 rows
      const headers = ['序號', '車次', '姓名', '班級', '組別', '身份別', '電話', '去程', '回程', '備註']
      const data = []
      let seq = 1

      // 法師（聯集 up/down monks）排最前
      const allMonkIds = [...new Set([...upMonkIds, ...downMonkIds])]
      for (const mid of allMonkIds) {
        const monk = allMonks.find(m => m.id === mid)
        if (!monk) continue
        const up   = upMonkIds.has(mid)   ? 'V' : ''
        const down = downMonkIds.has(mid) ? 'V' : ''
        data.push([seq++, carName, monk.name, '', '', '法師', '', up, down, '法師'])
      }

      // 學員 / 訪客
      for (const r of finalRegs) {
        const isLeader = leaderAny.has(r.registration_id)
        const up   = upMembers.has(r.registration_id)   ? 'V' : ''
        const down = downMembers.has(r.registration_id) ? 'V' : ''
        const origNote = getGuestNote(r)
        const pTxt = preceptText(r)
        const parts = []
        if (pTxt) parts.push(pTxt)
        if (isLeader) parts.push('領隊')
        if (origNote) parts.push(origNote)
        // 訪客電話：guest_phone（Supabase cron 活動結束 7 天後自動清除）
        const phone = r.student_id ? '' : (r.answers?.guest_phone ?? '')
        data.push([seq++, carName, getName(r), clsOf(r), grpOf(r), idOf(r), phone, up, down, parts.join('/')])
      }

      return XLSX.utils.aoa_to_sheet([headers, ...data])
    }

    // ── 小車 sheet：依主司機（anchor regId）合併 up + down ──
    function buildSmallCarSheet() {
      const upSmallRegs   = regs.filter(r => isSmallCar(r.answers, 'up'))
      const downSmallRegs = regs.filter(r => isSmallCar(r.answers, 'down'))
      const upRes   = computeSmallGroups(upSmallRegs,   'up')
      const downRes = computeSmallGroups(downSmallRegs, 'down')

      // 依 anchor (g.key) 合併兩方向群組
      const byDriver = new Map()
      const touch   = (key, plate) => {
        if (!byDriver.has(key)) byDriver.set(key, { plate: '', up: null, down: null })
        if (plate && !byDriver.get(key).plate) byDriver.get(key).plate = plate
      }
      for (const g of upRes.matchedGroups)   { touch(g.key, g.plate); byDriver.get(g.key).up   = g }
      for (const g of downRes.matchedGroups) { touch(g.key, g.plate); byDriver.get(g.key).down = g }

      const upOM   = orphanByDir.up
      const downOM = orphanByDir.down
      const upGM   = guestSmallByDir.up
      const downGM = guestSmallByDir.down

      const headers = ['序號', '車次', '車號', '姓名', '班級', '組別', '身份別', '電話', '去程', '回程', '備註']
      const data = []
      let seq = 1
      let carIdx = 1

      for (const [driverKey, { plate, up, down }] of byDriver) {
        const carName = `小車${carIdx++}`

        // 聯集成員（含 anchor、其他同車號 candidate、共乘者、手動指派的孤兒、從大車搬過來的訪客）
        const upMemberIds = new Set()
        const downMemberIds = new Set()
        if (up)   up.members.forEach(r   => upMemberIds.add(r.registration_id))
        if (down) down.members.forEach(r => downMemberIds.add(r.registration_id))
        upRes.orphans.filter(o => upOM[o.registration_id] === driverKey)
          .forEach(o => upMemberIds.add(o.registration_id))
        downRes.orphans.filter(o => downOM[o.registration_id] === driverKey)
          .forEach(o => downMemberIds.add(o.registration_id))
        regs.filter(r => !r.student_id && upGM[r.registration_id] === driverKey)
          .forEach(r => upMemberIds.add(r.registration_id))
        regs.filter(r => !r.student_id && downGM[r.registration_id] === driverKey)
          .forEach(r => downMemberIds.add(r.registration_id))

        const allIds  = [...new Set([...upMemberIds, ...downMemberIds])]
        const allRegs = allIds.map(id => regMap[id]).filter(Boolean)

        // 排序：主司機在最前，其餘依班組排序
        const driverReg  = allRegs.find(r => r.registration_id === driverKey)
        const others     = allRegs.filter(r => r.registration_id !== driverKey)
        const sortedOthers = [...others].sort(sortByClassGroup)

        const ordered = []
        if (driverReg) ordered.push(driverReg)
        ordered.push(...sortedOthers)

        for (const r of ordered) {
          const isDriver = r.registration_id === driverKey
          const up_   = upMemberIds.has(r.registration_id)   ? 'V' : ''
          const down_ = downMemberIds.has(r.registration_id) ? 'V' : ''
          const origNote = getGuestNote(r)
          const pTxt = preceptText(r)
          const parts = []
          if (pTxt) parts.push(pTxt)
          if (isDriver) parts.push('司機')
          if (origNote) parts.push(origNote)
          // 訪客電話：guest_phone（Supabase cron 活動結束 7 天後自動清除）
          const phone = r.student_id ? '' : (r.answers?.guest_phone ?? '')
          data.push([seq++, carName, plate || '', getName(r), clsOf(r), grpOf(r), idOf(r), phone, up_, down_, parts.join('/')])
        }
      }

      // 未指派的孤兒（沒被指到任何小車的乘客）
      const upUnassigned   = upRes.orphans.filter(o => !upOM[o.registration_id])
      const downUnassigned = downRes.orphans.filter(o => !downOM[o.registration_id])
      const unassignedIds  = [...new Set([
        ...upUnassigned.map(o => o.registration_id),
        ...downUnassigned.map(o => o.registration_id),
      ])]
      for (const id of unassignedIds) {
        const r = regMap[id]
        if (!r) continue
        const upV   = upUnassigned.some(o => o.registration_id === id)   ? 'V' : ''
        const downV = downUnassigned.some(o => o.registration_id === id) ? 'V' : ''
        const origNote   = getGuestNote(r)
        const pTxt = preceptText(r)
        const carpoolUp   = r.answers?.[fieldKeysFor('up').carpool]   ?? ''
        const carpoolDown = r.answers?.[fieldKeysFor('down').carpool] ?? ''
        const carpool = carpoolUp || carpoolDown
        const parts = []
        if (pTxt) parts.push(pTxt)
        if (carpool) parts.push(`→ ${carpool}`)
        if (origNote) parts.push(origNote)
        // 訪客電話：guest_phone（Supabase cron 活動結束 7 天後自動清除）
        const phone = r.student_id ? '' : (r.answers?.guest_phone ?? '')
        data.push([seq++, '小車（未指定）', '', getName(r), clsOf(r), grpOf(r), idOf(r), phone, upV, downV, parts.join('/')])
      }

      return data.length > 0 ? XLSX.utils.aoa_to_sheet([headers, ...data]) : null
    }

    // ── 其他交通 sheet：不歸大車也不歸小車的人 ────────
    // 過濾條件：上山或下山其中一方不是大車也不是小車 → 進「其他」
    // 同一人雙向都是其他，也只列一次
    function buildOtherTransportSheet() {
      const transportUpKey   = fieldKeysFor('up').transport
      const transportDownKey = fieldKeysFor('down').transport
      const otherRegs = regs.filter(r => {
        const upOther   = !isLargeCar(r, 'up')   && !isSmallCar(r.answers, 'up')
        const downOther = !isLargeCar(r, 'down') && !isSmallCar(r.answers, 'down')
        return upOther || downOther
      })
      if (otherRegs.length === 0) return null

      const sortedRegs = [...otherRegs].sort(sortByClassGroup)
      const headers = ['序號', '姓名', '班級', '組別', '身份別', '電話', '去程方式', '回程方式', '備註']
      const data = []
      let seq = 1
      for (const r of sortedRegs) {
        const origNote = getGuestNote(r)
        const pTxt = preceptText(r)
        const parts = []
        if (pTxt) parts.push(pTxt)
        if (origNote) parts.push(origNote)
        // 訪客電話：guest_phone（活動結束 7 天後 cron 自動清除）
        const phone = r.student_id ? '' : (r.answers?.guest_phone ?? '')
        const upT   = r.answers?.[transportUpKey]   ?? ''
        const downT = r.answers?.[transportDownKey] ?? ''
        data.push([seq++, getName(r), clsOf(r), grpOf(r), idOf(r), phone, upT, downT, parts.join('/')])
      }
      return XLSX.utils.aoa_to_sheet([headers, ...data])
    }

    // ── 主流程：建 workbook，每大車一個 sheet + 小車一個 sheet + 其他交通 sheet ──
    const wb = XLSX.utils.book_new()

    // 大車：依 car_name 合併 up/down；保留 up 順序在前，down 獨有的補在後
    const orderedNames = []
    const seenNames = new Set()
    for (const c of carsByDir.up) {
      if (!seenNames.has(c.car_name)) { orderedNames.push(c.car_name); seenNames.add(c.car_name) }
    }
    for (const c of carsByDir.down) {
      if (!seenNames.has(c.car_name)) { orderedNames.push(c.car_name); seenNames.add(c.car_name) }
    }

    for (const carName of orderedNames) {
      const upCar   = carsByDir.up.find(c   => c.car_name === carName)
      const downCar = carsByDir.down.find(c => c.car_name === carName)
      const ws = buildLargeCarSheet(carName, upCar, downCar)
      if (ws) XLSX.utils.book_append_sheet(wb, ws, safeSheetName(carName))
    }

    // 小車
    const smallWs = buildSmallCarSheet()
    if (smallWs) XLSX.utils.book_append_sheet(wb, smallWs, '小車')

    // 其他交通（無大車無小車的人，避免領隊點名漏掉、總人數誤算）
    const otherWs = buildOtherTransportSheet()
    if (otherWs) XLSX.utils.book_append_sheet(wb, otherWs, '其他交通')

    if (wb.SheetNames.length === 0) {
      alert('沒有任何車輛可匯出')
      return
    }

    XLSX.writeFile(wb, `${event?.name ?? '活動'}_分車名單.xlsx`)
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
              {saving ? '儲存中…' : '儲存（去程＋回程）'}
            </button>
          </div>
        </div>

        {/* ── 整場無法師提醒 ── */}
        {(() => {
          const totalMonksAll =
            carsByDir.up.flatMap(c => c.monks ?? []).length +
            carsByDir.down.flatMap(c => c.monks ?? []).length
          const hasAnyCar = carsByDir.up.length > 0 || carsByDir.down.length > 0
          if (!hasAnyCar || totalMonksAll > 0) return null
          return (
            <div className="bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3 text-sm text-yellow-800 flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span>法師尚未排入車次</span>
            </div>
          )
        })()}

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
        {(() => {
          // 大車法師：直接從 cars 的 monks 陣列計算（不是 c.car_monks，那是 DB 結構）
          const statMonkCount = (carsByDir[direction] ?? []).reduce((s, c) => s + (c.monks?.length ?? 0), 0)
          // 小車法師：smallCarMonksByDir[direction] 所有 group 的法師總數
          const smallMonkCount = Object.values(smallCarMonksByDir[direction] ?? {}).flat().length
          return (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label={`搭精舍車（大車）— ${dirLabel(direction)}`}
            value={largePeople.length + statMonkCount}
            color="bg-blue-50 border-blue-200 text-blue-700"
            sub={statMonkCount > 0 ? `含法師 ${statMonkCount} 人` : null}
          />
          <StatCard
            label={`小車（自行/共乘）— ${dirLabel(direction)}`}
            value={smallPeople.length + smallMonkCount}
            color="bg-green-50 border-green-200 text-green-700"
            sub={smallMonkCount > 0 ? `含法師 ${smallMonkCount} 人` : null}
          />
          <StatCard
            label="其他/未填"
            value={regs.length - largePeople.length - smallPeople.length}
            color="bg-gray-50 border-gray-200 text-gray-600"
          />
        </div>
          )
        })()}

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
            <label className="flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-2 self-end cursor-pointer select-none">
              <input
                type="checkbox"
                checked={groupPrecept}
                onChange={e => setGroupPrecept(e.target.checked)}
                className="accent-emerald-600"
              />
              <span>優先將三皈五戒學員及其親友編入同一車</span>
              <span className="text-xs text-emerald-600">（行程獨立，不自動補位）</span>
            </label>
            <button
              onClick={handleAutoArrange}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium self-end"
            >
              ✨ 自動排車
            </button>
            {cars.length > 0 && (
              <>
                <button
                  onClick={handleCopyToOtherDir}
                  className="px-3 py-2 text-sm border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 self-end font-medium"
                  title={`複製目前的排法到「${dirLabel(direction === 'up' ? 'down' : 'up')}」（會依報名資料自動篩選大車人員）`}
                >
                  📋 複製到{direction === 'up' ? '回程' : '去程'}
                </button>
                <button
                  onClick={() => { if (window.confirm(`確定清除「${dirLabel(direction)}」所有排車結果？`)) setCars([]) }}
                  className="px-3 py-2 text-sm border rounded-lg text-gray-500 hover:bg-gray-100 self-end"
                >
                  清除
                </button>
              </>
            )}
          </div>

          {/* 提示 */}
          <div className="text-xs text-gray-500 mb-3 leading-relaxed space-y-1">
            <p>
              <span className="font-semibold text-gray-600">・自動排車邏輯：</span>
              首先將具備關係連結的成員，以及訪客與其邀請學員視為整體進行同車分派。接著，系統以班級為單位進行作業，確保整班成員同車；若班級中已有成員預先配置於某車次，則該班其餘成員將自動歸併至該車。當車位不足以容納完整班級時，系統將自動篩選人數最少的小組，將其整組移撥至其他車次。
            </p>
            <p>
              <span className="font-semibold text-gray-600">・手動微調：</span>
              可透過每位成員右側的下拉選單手動調整車次，並依需求勾選「領隊」方框，完成當車負責人的標記與指派。
            </p>
          </div>

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

          {/* 自動排車警示（B 架構：群組過大或無法整組安置時提示，不自動拆群） */}
          {autoArrangeWarnings.length > 0 && (
            <div className="mb-3 bg-orange-50 border-2 border-orange-400 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-bold text-orange-700">⚠️ 自動排車提醒（{autoArrangeWarnings.length} 項）</span>
                <button
                  onClick={() => setAutoArrangeWarnings([])}
                  className="text-xs text-orange-600 hover:text-orange-900 underline shrink-0"
                >
                  關閉
                </button>
              </div>
              <ul className="text-orange-800 list-disc pl-5 space-y-0.5">
                {autoArrangeWarnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
              <div className="text-xs text-orange-600 mt-1.5">
                說明：自動排車不會自動拆散「同組成員」或「學員與其親友」。若群組過大或所有車已滿，會列在這裡，請手動拖移或加開車次處理。
              </div>
            </div>
          )}

          {/* 即時看板（含超額警示橫條） */}
          {cars.length > 0 && (() => {
            const overflows = cars.map((car, idx) => {
              const total = car.members.length + (car.monks ?? []).length
              return { idx, name: car.car_name, total, seats: car.seats, over: total - car.seats, tempId: car.tempId }
            }).filter(x => x.over > 0)
            const totalPeople = cars.reduce((s, c) => s + c.members.length + (c.monks ?? []).length, 0)
            const totalMonks  = cars.reduce((s, c) => s + (c.monks ?? []).length, 0)
            const totalSeats  = cars.reduce((s, c) => s + c.seats, 0)
            return (
              <div className="sticky top-0 z-20 -mx-4 px-4 py-2 mb-3 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm">
                {/* 合計列 */}
                <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-700">
                    本方向已排 <strong className="text-blue-700">{totalPeople}</strong> 人
                    <span className="text-gray-400">／{totalSeats} 座</span>
                  </span>
                  {totalMonks > 0 && (
                    <span className="bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5">
                      含法師 {totalMonks} 人
                    </span>
                  )}
                </div>
                {/* 超額警示橫條 */}
                {overflows.length > 0 && (
                  <div className="mb-2 bg-red-100 border-2 border-red-500 rounded-lg px-3 py-2 text-sm flex items-center gap-2 animate-pulse">
                    <span className="font-bold text-red-700 shrink-0">⚠️ 超額警示</span>
                    <span className="text-red-700">
                      {overflows.map((o, i) => (
                        <span key={o.tempId}>
                          {i > 0 && '、'}
                          <button
                            onClick={() => document.getElementById(`car-${o.tempId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                            className="underline hover:text-red-900 font-medium"
                          >
                            {o.name}（已排 {o.total} 人／{o.seats}，超額 {o.over} 人）
                          </button>
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {/* 即時看板 grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                  {cars.map((car) => {
                    const monkCount  = (car.monks ?? []).length
                    const totalInCar = car.members.length + monkCount
                    const overflow   = totalInCar - car.seats
                    const remaining  = car.seats - totalInCar
                    const pct        = car.seats > 0 ? (totalInCar / car.seats) * 100 : 0
                    return (
                      <button
                        key={car.tempId}
                        onClick={() => document.getElementById(`car-${car.tempId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                        className={`text-left border rounded-lg p-2.5 text-sm hover:shadow transition-shadow ${
                          overflow > 0
                            ? 'bg-red-50 border-red-400'
                            : remaining === 0
                            ? 'bg-gray-100 border-gray-300'
                            : 'bg-blue-50 border-blue-200'
                        }`}
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span className="truncate text-gray-800">{car.car_name}</span>
                          {overflow > 0 ? (
                            <span className="text-red-600 font-bold whitespace-nowrap">超額 {overflow} 人</span>
                          ) : remaining === 0 ? (
                            <span className="text-gray-500 whitespace-nowrap">已滿</span>
                          ) : (
                            <span className="text-blue-700 whitespace-nowrap">尚餘 {remaining} 人</span>
                          )}
                        </div>
                        <div className="text-gray-700 mt-1 text-xs">
                          已排 <strong className={overflow > 0 ? 'text-red-600' : ''}>{totalInCar}</strong> 人
                          <span className="text-gray-400">／{car.seats}</span>
                          {monkCount > 0 && (
                            <span className="text-purple-600 ml-2">含法師 {monkCount} 人</span>
                          )}
                        </div>
                        <div className="bg-white/80 rounded h-1.5 mt-1.5 overflow-hidden">
                          <div
                            className={`h-full transition-all ${overflow > 0 ? 'bg-red-500' : 'bg-blue-500'}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* 車輛卡片 */}
          {cars.length === 0 ? (
            <div className="text-sm text-gray-400 py-10 text-center border-2 border-dashed rounded-xl">
              尚未排車，請設定車輛數後點「✨ 自動排車」
            </div>
          ) : (
            <div className="space-y-3">
              {cars.map((car, ci) => {
                const monkCount   = (car.monks ?? []).length
                const totalInCar  = car.members.length + monkCount
                const overflow    = totalInCar - car.seats
                return (
                <div key={car.tempId} id={`car-${car.tempId}`} className="bg-white border rounded-xl shadow-sm overflow-hidden scroll-mt-4">
                  {/* 車次標題 */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-amber-100 border-b-2 border-amber-300">
                    <input
                      value={car.car_name}
                      onChange={e => updateCarName(ci, e.target.value)}
                      className="font-semibold text-sm text-amber-900 bg-transparent border-b border-transparent hover:border-amber-400 focus:border-amber-600 focus:outline-none px-1 py-0.5 w-28"
                    />
                    <span className="text-xs text-amber-900/80">
                      座位數：<strong>{car.seats}</strong>
                      <span className="mx-2 text-amber-400">|</span>
                      已排入：<strong className={overflow > 0 ? 'text-red-600' : ''}>{totalInCar}</strong>
                      {monkCount > 0 && (
                        <span className="ml-1 text-purple-700">（含法師 {monkCount}）</span>
                      )}
                    </span>
                    {overflow > 0 && (
                      <span className="text-xs font-bold text-white bg-red-600 rounded-full px-2.5 py-0.5 animate-pulse">
                        ⚠️ 超額 +{overflow}
                      </span>
                    )}
                    {overflow === 0 && totalInCar === car.seats && (
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
                      sortedMembersForDisplay(car.members, regMap).map((regId, mi) => (
                        <PersonRow
                          key={regId}
                          reg={regMap[regId]}
                          carIdx={ci}
                          cars={cars}
                          onMove={movePerson}
                          onToggleLeader={toggleLeader}
                          guestInfo={guestInfoMap[regId]}
                          seq={mi + 1}
                        />
                      ))
                    )}
                  </div>

                  {/* 法師指派（可選，不強制；一位法師同方向只能在一台車 / 一台小車） */}
                  {allMonks.length > 0 && (
                    <div className="px-4 py-3 bg-purple-50 border-t border-purple-100">
                      <div className="text-xs font-medium text-purple-600 mb-2">🏯 搭乘法師（可選）</div>
                      <div className="flex flex-wrap gap-2">
                        {allMonks.map(monk => {
                          // 先查大車
                          const largeIdx       = cars.findIndex(c => (c.monks ?? []).includes(monk.id))
                          // 再查小車（同方向）
                          const smallKey       = Object.keys(smallCarMonksByDir[direction] ?? {}).find(
                            k => (smallCarMonksByDir[direction][k] ?? []).includes(monk.id)
                          )
                          const smallIdx       = smallKey ? finalSmallGroups.findIndex(fg => fg.key === smallKey) : -1
                          const assignedHere   = largeIdx === ci
                          const inOtherLarge   = largeIdx >= 0 && largeIdx !== ci
                          const inSmall        = !!smallKey
                          const elsewhereLabel = inOtherLarge
                            ? cars[largeIdx].car_name
                            : (smallIdx >= 0 ? `小車 ${smallIdx + 1}` : '')
                          const assignedElsewhere = inOtherLarge || inSmall
                          return (
                            <button
                              key={monk.id}
                              onClick={() => {
                                if (assignedHere) unassignMonkAllCars(monk.id)
                                else assignMonkToLargeCar(ci, monk.id)
                              }}
                              title={assignedElsewhere ? `目前在 ${elsewhereLabel}，點選會搬過來` : ''}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                assignedHere
                                  ? 'bg-purple-600 text-white border-purple-600'
                                  : assignedElsewhere
                                  ? 'bg-gray-100 text-gray-400 border-gray-200 line-through hover:bg-purple-50 hover:text-purple-500 hover:border-purple-300 hover:no-underline'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-600'
                              }`}
                            >
                              {assignedHere && '✓ '}
                              {assignedElsewhere && `（${elsewhereLabel}）`}
                              {monk.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
                )
              })}
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
                <div key={g.key} className={`bg-white rounded-xl shadow-sm overflow-hidden border ${g.needsDriverChoice ? 'border-2 border-red-400 ring-2 ring-red-100' : ''}`}>
                  {g.needsDriverChoice && (
                    <div className="px-4 py-2 bg-red-50 text-red-700 text-xs font-medium border-b border-red-200 flex items-center gap-2">
                      <span className="animate-pulse">⚠️</span>
                      <span>同車號有多位填了車號的「自行開車」乘客，請從下方下拉選單指定誰是主司機</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-gray-50 text-sm font-semibold text-gray-700">
                    <span className="text-green-700 bg-green-100 rounded-full px-2 py-0.5 text-xs">
                      小車 {idx + 1}
                    </span>
                    {g.needsDriverChoice ? (
                      <>
                        <span className="text-red-700 bg-red-100 rounded-full px-2 py-0.5 text-xs">⚠️ 司機未指定</span>
                        {g.plate && <span className="text-gray-400 text-xs font-normal">{g.plate}</span>}
                        <select
                          value=""
                          onChange={e => {
                            const rid = e.target.value
                            if (rid) handleSelectMainDriver(g, rid)
                          }}
                          disabled={driverPickerBusy === g.key}
                          className="text-xs border rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
                        >
                          <option value="">請選擇主司機 ▾</option>
                          {g.candidates.map(c => (
                            <option key={c.registration_id} value={c.registration_id}>
                              {getName(c)}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <>
                        <span>司機：{g.driverName}</span>
                        {g.plate && <span className="text-gray-400 text-xs font-normal">{g.plate}</span>}
                      </>
                    )}
                    <span className="text-xs text-gray-400 font-normal ml-auto">{g.allMembers.length} 人</span>
                  </div>
                  <div className="divide-y">
                    {g.allMembers.map((r, mi) => {
                      const cls       = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                      const isAnchor      = r.registration_id === g.key
                      const isOtherDriver = !isAnchor && g.candidateIds?.has(r.registration_id)
                      const carpoolNm = r.answers?.[fieldKeysFor(direction).carpool] ?? ''
                      const isOrphan  = orphans.some(o => o.registration_id === r.registration_id)
                      const memBadges = preceptBadgeProps(r)
                      return (
                        <div key={r.registration_id} className={`flex items-center gap-2 px-4 py-2 text-sm ${isOrphan ? 'bg-orange-50' : ''}`}>
                          <span className="shrink-0 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-mono tabular-nums">
                            {mi + 1}
                          </span>
                          <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium">{getName(r)}</span>
                            {memBadges.map((b, i) => (
                              <span key={i} className={b.className} title={b.title}>
                                {b.children}
                              </span>
                            ))}
                          </span>
                          {cls && <span className="text-xs text-gray-400">{cls}</span>}
                          <span className="text-xs text-gray-300">
                            {isAnchor && !g.needsDriverChoice
                              ? '（司機）'
                              : isOtherDriver
                                ? '（共乘・同車號）'
                                : carpoolNm
                                  ? `→ ${carpoolNm}`
                                  : ''}
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

                  {/* 小車法師選擇 + 提前出發 */}
                  <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center gap-3 flex-wrap">
                    {/* 法師（跨大小車唯一性） */}
                    {allMonks.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-purple-600 font-medium shrink-0">🏯 法師：</span>
                        {allMonks.map(monk => {
                          const isHere = (smallCarMonksByDir[direction][g.key] ?? []).includes(monk.id)
                          // 先查小車
                          const smallKey = Object.keys(smallCarMonksByDir[direction] ?? {}).find(
                            k => (smallCarMonksByDir[direction][k] ?? []).includes(monk.id)
                          )
                          const smallIdx = smallKey ? finalSmallGroups.findIndex(fg => fg.key === smallKey) : -1
                          const inOtherSmall = !!smallKey && smallKey !== g.key
                          // 再查大車
                          const largeIdx = cars.findIndex(c => (c.monks ?? []).includes(monk.id))
                          const inLarge = largeIdx >= 0
                          const assignedElsewhere = inOtherSmall || inLarge
                          const elsewhereLabel = inOtherSmall
                            ? `小車 ${smallIdx + 1}`
                            : (inLarge ? cars[largeIdx].car_name : '')
                          return (
                            <button
                              key={monk.id}
                              onClick={() => {
                                if (isHere) unassignMonkAllCars(monk.id)
                                else assignMonkToSmallCar(g.key, monk.id)
                              }}
                              title={assignedElsewhere ? `目前在 ${elsewhereLabel}，點選搬過來` : ''}
                              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                                isHere
                                  ? 'bg-purple-600 text-white border-purple-600'
                                  : assignedElsewhere
                                  ? 'bg-gray-100 text-gray-400 border-gray-200 line-through hover:bg-purple-50 hover:text-purple-500 hover:border-purple-300 hover:no-underline'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-600'
                              }`}
                            >
                              {isHere && '✓ '}
                              {assignedElsewhere && `（${elsewhereLabel}）`}
                              {monk.name}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {/* 上山方向：提前出發；下山方向：延後回程 */}
                    {direction === 'up' ? (
                      <label className="flex items-center gap-1 cursor-pointer ml-auto" title="勾選後整車視為提前出發，看板應到不計入">
                        <input
                          type="checkbox"
                          checked={!!smallPreDepartByDir[direction][g.key]}
                          onChange={() => toggleSmallPreDepart(g.key)}
                          className="accent-teal-600 w-3.5 h-3.5"
                        />
                        <span className={`text-xs ${smallPreDepartByDir[direction][g.key] ? 'text-teal-700 font-semibold' : 'text-gray-400'}`}>
                          🚀 提前出發
                        </span>
                      </label>
                    ) : (
                      <label className="flex items-center gap-1 cursor-pointer ml-auto" title="勾選後整車視為延後回程，看板應到不計入">
                        <input
                          type="checkbox"
                          checked={!!smallLateReturnByDir[direction][g.key]}
                          onChange={() => toggleSmallLateReturn(g.key)}
                          className="accent-amber-600 w-3.5 h-3.5"
                        />
                        <span className={`text-xs ${smallLateReturnByDir[direction][g.key] ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>
                          🕓 延後回程
                        </span>
                      </label>
                    )}
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
                      const orpBadges = preceptBadgeProps(r)
                      return (
                        <div key={r.registration_id} className="flex items-center gap-2 px-4 py-2 text-sm">
                          <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium">{getName(r)}</span>
                            {orpBadges.map((b, i) => (
                              <span key={i} className={b.className} title={b.title}>
                                {b.children}
                              </span>
                            ))}
                          </span>
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

        {/* ── 其他交通（本方向不歸大車也不歸小車） ── */}
        {otherTransportRegs.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
              🚶 其他交通
              <span className="text-xs font-normal text-gray-400">
                （{direction === 'up' ? '去程' : '回程'}方向不搭精舍車、自行開車、搭學員的人，{otherTransportRegs.length} 人）
              </span>
            </h2>
            <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
              <div className="divide-y divide-slate-200">
                {otherTransportRegs.map(r => {
                  const cls = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                  const transport = r.answers?.[fieldKeysFor(direction).transport] ?? '（未填）'
                  const badges = preceptBadgeProps(r)
                  const overrideField = direction === 'up' ? 'pre_depart_override' : 'late_return_override'
                  const overrideLabel = direction === 'up' ? '🚀 提前出發' : '🕓 延後回程'
                  const isUp = direction === 'up'
                  const checked = !!r[overrideField]
                  return (
                    <div key={r.registration_id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium">{getName(r)}</span>
                        {badges.map((b, i) => (
                          <span key={i} className={b.className} title={b.title}>{b.children}</span>
                        ))}
                        {cls && <span className="text-xs text-gray-400">{cls}</span>}
                        <span className="text-xs text-slate-500">{transport}</span>
                      </span>
                      <label className="flex items-center gap-1 cursor-pointer" title="勾選後此人計入提前/延後，看板應到不計入">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleOverride(r, overrideField)}
                          className={`w-3.5 h-3.5 ${isUp ? 'accent-teal-600' : 'accent-amber-600'}`}
                        />
                        <span className={`text-xs ${checked ? (isUp ? 'text-teal-700 font-semibold' : 'text-amber-700 font-semibold') : 'text-gray-400'}`}>
                          {overrideLabel}
                        </span>
                      </label>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── 小車領隊（上下山共用，可多人） ── */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-3">
            🚗 小車領隊
            <span className="text-xs font-normal text-gray-400 ml-2">（去回程共用、可多人）</span>
          </h2>
          {/* 已選清單 */}
          {smallCarLeaders.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {smallCarLeaders.map(l => {
                const reg  = regMap[l.registration_id]
                const name = reg ? getName(reg) : '(已移除)'
                return (
                  <div key={l.registration_id} className="bg-green-50 border border-green-300 rounded-lg px-2.5 py-1.5 text-sm flex items-center gap-2">
                    <span className="font-medium text-green-800">{name}</span>
                    {l.access_token ? (
                      <button
                        onClick={() => copyLink(l.access_token, `小車領隊・${name}`)}
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        🔗 複製連結
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">（儲存後可複製）</span>
                    )}
                    <button
                      onClick={() => setSmallCarLeaders(prev => prev.filter(x => x.registration_id !== l.registration_id))}
                      className="text-red-400 hover:text-red-600 text-base leading-none"
                      title="移除"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {/* 新增領隊 */}
          <div className="flex items-center gap-3 flex-wrap">
            <SearchableSelect
              value=""
              onChange={rid => {
                if (!rid) return
                if (smallCarLeaders.some(l => l.registration_id === rid)) return
                setSmallCarLeaders(prev => [...prev, { registration_id: rid, access_token: '' }])
              }}
              className="w-full max-w-xs"
              placeholder="＋ 加入小車領隊（可重複加入）"
              options={regs
                .filter(r => r.student_id && !smallCarLeaders.some(l => l.registration_id === r.registration_id))
                .map(r => {
                  const cls = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                  return {
                    value: r.registration_id,
                    label: getName(r),
                    sublabel: cls,
                    searchText: `${getName(r)} ${cls} ${r.student_id ?? ''}`,
                  }
                })}
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">
            小車領隊可查看並操作所有小車成員的報到狀況（含去程與回程）。可設定多位領隊分擔任務，每位都有獨立的連結。<br />
            ⚠️ 每次儲存後連結會更新，請重新複製。
          </p>
        </section>

        {/* ── 總領隊（上下山共用） ── */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-3">
            👑 總領隊
            <span className="text-xs font-normal text-gray-400 ml-2">（去回程共用）</span>
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            <SearchableSelect
              value={headLeaderRegId}
              onChange={setHeadLeaderRegId}
              className="w-full max-w-xs"
              placeholder="（未設定）"
              options={regs.filter(r => r.student_id).map(r => {
                const cls = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                return {
                  value: r.registration_id,
                  label: getName(r),
                  sublabel: cls,
                  searchText: `${getName(r)} ${cls} ${r.student_id ?? ''}`,
                }
              })}
            />
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
            總領隊看板可即時查看所有大車＋小車的報到進度（含去程與回程）。<br />
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

