import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
} from '../../lib/supabase'
import {
  getPreceptLevel,
  preceptBadgeProps,
  isDriverFromAnswers,
} from '../../lib/registrationHelpers'

// ─── 常數與工具 ───────────────────────────────────────────────

const CHINESE_NUMS = ['一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五']
const chNum = n => CHINESE_NUMS[n - 1] ?? String(n)
const genId = () => `tmp-${Math.random().toString(36).slice(2)}`

const DIRECTIONS = [
  { key: 'up',   label: '上山（回山）', emoji: '🚌' },
  { key: 'down', label: '下山（回家）', emoji: '🚍' },
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

// 找訪客的 host：優先用 host_student_id（Phase 2 學員代報），fallback 用備註姓名（舊資料）
function findGuestHost(guest, studentRegs) {
  if (guest.host_student_id) {
    const direct = studentRegs.find(r => r.student_id === guest.host_student_id)
    if (direct) return direct
  }
  return findGuestMatch(getGuestNote(guest), studentRegs)
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
// - 訪客有填值但不含「精舍」（如「自行」）→ 不算大車（避免誤排上不該搭精舍車的訪客）
// - 完全沒填 → 訪客預設大車；學員算「其他/未填」
const isLargeCar = (r, dir) => {
  if (isSmallDriver(r.answers, dir) || isSmallPassenger(r.answers, dir)) return false
  const t = r.answers?.[fieldKeysFor(dir).transport] ?? ''
  if (r.student_id) return t.includes('精舍')
  // 訪客：有填值 → 須含「精舍」才算大車；完全沒填（舊資料）→ 預設大車
  if (t) return t.includes('精舍')
  return true
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

// ─── 自動排車演算法（B 架構：班級優先 + 三層 fallback） ────────
//
// 設計（2026-05-08 重寫，原架構「先放訪客親友群、後依班整合」會把整班拆散）：
//   Step 0  ★（可選）三皈五戒群組獨佔車：把所有皈/戒學員 + 其親友 + 同 rel group
//           的學員打包，獨佔最前面 N 台車（依人數動態決定）。被佔的車後續步驟不
//           會再被選為目標（avail() 對 isPreceptCar 回 0），確保「行程獨立性」。
//   Step 1  關係連結群組（跨班）優先放置 — 大群組先、tightest fit
//   Step 2  建立 host+guest bundle（每位 host 學員與其所有訪客為原子單位）
//   Step 3  班級聚合：每班所有 bundle 一起決定主車，整班可塞 → 全進；
//           塞不下 → 從最小 bundle 開始整批往 spillover 搬（不切 bundle）
//   Step 4  碎片整理（三層 fallback）：
//             (a) 同班已有成員的車 + 空位足夠
//             (b) max-avail 車
//             (c) 都塞不下 → 警示，不自動拆 bundle（交由師父手動處理）
//   Step 5  孤兒訪客（findGuestHost 找不到 host）放任一空位車
//   Step 6  Integrity Check：每個 bundle 與 rel group 都應整組同車
//
// 回傳 { cars, warnings }，warnings = [{ kind, message, regIds, size, ... }]

function autoArrange(largePeople, carCount, seats, relGroups, options = {}) {
  const cars = Array.from({ length: carCount }, (_, i) => ({
    tempId: genId(),
    car_name: `第${chNum(i + 1)}車`,
    seats: Number(seats),
    members: [],
    leaders: [],
    monks: [],
    isPreceptCar: false,   // 三皈五戒專車（不接受一般學員自動補位）
  }))
  const warnings = []

  const studentLarge = largePeople.filter(r => r.student_id)
  const guestLarge   = largePeople.filter(r => !r.student_id)
  const studentToReg = Object.fromEntries(studentLarge.map(r => [r.student_id, r]))
  const regLookup    = Object.fromEntries(largePeople.map(r => [r.registration_id, r]))

  const placed       = new Set()
  // 三皈五戒專車對自動補位回 0 空位（鎖死）；Step 0 自己用 push 直接放，不經 avail
  const avail        = car => car.isPreceptCar ? 0 : car.seats - car.members.length
  const maxAvailCar  = () => {
    const free = cars.filter(c => !c.isPreceptCar)
    if (free.length === 0) return cars[0]
    return free.reduce((a, b) => avail(a) >= avail(b) ? a : b)
  }
  const placeRegIds  = (car, regIds) => {
    for (const rid of regIds) { car.members.push(rid); placed.add(rid) }
  }

  // ── Step 0: 三皈五戒群組獨佔車 ────────────────────────────────
  if (options.groupPrecept) {
    const preceptRegIds = new Set()
    // 1) 直接是 precept 的學員
    for (const r of studentLarge) {
      if (getPreceptLevel(r)) preceptRegIds.add(r.registration_id)
    }
    // 2) 同 rel group 連動：rel group 內任一人是 precept → 整組打包
    for (const rg of relGroups) {
      const memberRegs = (rg.relationship_members ?? [])
        .map(m => studentToReg[m.student_id])
        .filter(Boolean)
      const hasPrecept = memberRegs.some(r => preceptRegIds.has(r.registration_id))
      if (hasPrecept) {
        for (const r of memberRegs) preceptRegIds.add(r.registration_id)
      }
    }
    // 3) 親友：host 是 precept → 訪客打包
    for (const guest of guestLarge) {
      const host = findGuestHost(guest, studentLarge)
      if (host && preceptRegIds.has(host.registration_id)) {
        preceptRegIds.add(guest.registration_id)
      }
    }

    if (preceptRegIds.size > 0) {
      const seatPerCar = Number(seats)
      const carsNeeded = Math.max(1, Math.ceil(preceptRegIds.size / seatPerCar))
      const dedicated  = Math.min(carsNeeded, cars.length)

      let remaining = [...preceptRegIds]
      for (let i = 0; i < dedicated; i++) {
        const car = cars[i]
        car.isPreceptCar = true
        car.car_name     = `${car.car_name}（皈戒專車）`
        const take = remaining.slice(0, car.seats)
        remaining  = remaining.slice(car.seats)
        for (const rid of take) { car.members.push(rid); placed.add(rid) }
      }

      if (remaining.length > 0) {
        warnings.push({
          kind: 'precept_overflow',
          regIds: remaining,
          size: remaining.length,
          message: `三皈五戒群組共 ${preceptRegIds.size} 人，目前 ${cars.length} 台車獨佔仍有 ${remaining.length} 人塞不下（請加開車次，或關閉皈戒同車選項）`,
        })
      } else if (carsNeeded > cars.length) {
        // 理論上不會走到（remaining 為 0 表示已塞完）
      }
    }
  }

  // ── Step 1: 關係連結群組（跨班，最高優先） ─────────────────
  // 注意：rel groups 只含學員（不含訪客）；其訪客在 Step 2 跟著 host 跑
  const relUnits = []
  for (const rg of relGroups) {
    const memberRegs = (rg.relationship_members ?? [])
      .map(m => studentToReg[m.student_id])
      .filter(Boolean)
    if (memberRegs.length >= 2) {
      relUnits.push({ name: rg.name, regIds: memberRegs.map(r => r.registration_id) })
    }
  }
  relUnits.sort((a, b) => b.regIds.length - a.regIds.length)

  for (const unit of relUnits) {
    // tightest fit：找剩餘空位最接近 unit.size 的車（避免浪費大車空間）
    const fits = cars.filter(c => avail(c) >= unit.regIds.length)
    if (fits.length > 0) {
      const target = fits.reduce((a, b) => avail(a) <= avail(b) ? a : b)
      placeRegIds(target, unit.regIds)
    } else {
      // 沒有任何一台車裝得下整組 → 警示，不自動拆
      warnings.push({
        kind: 'rel_group_no_seat',
        regIds: unit.regIds,
        size: unit.regIds.length,
        message: `關係群組「${unit.name}」共 ${unit.regIds.length} 人，沒有車位可整組安置（最大空位 ${avail(maxAvailCar())} 位）`,
      })
    }
  }

  // ── Step 2: 建 host+guest bundle ─────────────────────────
  // 對每位學員找其訪客（host_student_id 優先 → 備註比對 fallback）
  const bundles = []  // { hostRegId, regIds[host+guests], size, className, groupName, pinnedCar }
  for (const student of studentLarge) {
    const sRegId = student.registration_id
    const myGuests = guestLarge.filter(g => {
      const matched = findGuestHost(g, studentLarge)
      return matched && matched.registration_id === sRegId
    })
    const cls       = getClasses(student)[0]
    const className = cls?.class_name ?? ''
    const groupName = cls?.group_name ?? ''

    // 若 host 已被 Step 1 放到某車，bundle 就 pinned 在那台
    const pinnedCar = placed.has(sRegId) ? cars.find(c => c.members.includes(sRegId)) : null

    bundles.push({
      hostRegId: sRegId,
      regIds: [sRegId, ...myGuests.map(g => g.registration_id)],
      size: 1 + myGuests.length,
      className,
      groupName,
      pinnedCar,
    })
  }

  // pinned bundle 的訪客直接跟到 host 的車（rel 學員的親友連坐）
  for (const b of bundles.filter(x => x.pinnedCar)) {
    const guestRegIds = b.regIds.slice(1)
    if (guestRegIds.length === 0) continue
    if (avail(b.pinnedCar) >= guestRegIds.length) {
      placeRegIds(b.pinnedCar, guestRegIds)
    } else {
      // pinned 車塞不下訪客 → 不切 bundle（訪客留 unassigned，發警示讓師父手動處理）
      warnings.push({
        kind: 'pinned_guest_overflow',
        regIds: guestRegIds,
        size: guestRegIds.length,
        message: `${guestRegIds.length} 位親友因主人車「${b.pinnedCar.car_name}」已滿無法跟隨同車（手動拖移即可）`,
      })
    }
  }

  // ── Step 3: 班級聚合 ─────────────────────────────────────
  const freeBundles = bundles.filter(b => !b.pinnedCar)
  const classBundleMap = {}
  for (const b of freeBundles) {
    if (!classBundleMap[b.className]) classBundleMap[b.className] = []
    classBundleMap[b.className].push(b)
  }

  // 大班優先（佔位多的先處理）；同大小依班別字典序
  const classEntries = Object.entries(classBundleMap)
    .map(([className, units]) => ({
      className,
      units,
      total: units.reduce((s, u) => s + u.size, 0),
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      return a.className.localeCompare(b.className, 'zh-TW')
    })

  const carHasClassMember = (car, className) => car.members.some(rid => {
    const r = regLookup[rid]
    if (!r?.student_id) return false
    return (getClasses(r)[0]?.class_name ?? '') === className
  })

  // 主車決策：優先有同班學員的車中剩餘空位最多者 → 退而求其次 max-avail
  const findMainCar = (className) => {
    const candidates = cars.filter(c => carHasClassMember(c, className) && avail(c) > 0)
    if (candidates.length > 0) {
      return candidates.reduce((a, b) => avail(a) >= avail(b) ? a : b)
    }
    return maxAvailCar()
  }

  const spilloverUnits = []  // { unit, originClass }

  for (const cls of classEntries) {
    const mainCar = findMainCar(cls.className)
    if (avail(mainCar) <= 0) {
      cls.units.forEach(u => spilloverUnits.push({ unit: u, originClass: cls.className }))
      continue
    }

    if (cls.total <= avail(mainCar)) {
      // 整班可塞主車 → 全部塞入（依組別字典序，同組相鄰）
      const sorted = [...cls.units].sort((a, b) => a.groupName.localeCompare(b.groupName, 'zh-TW'))
      for (const u of sorted) placeRegIds(mainCar, u.regIds)
      continue
    }

    // 整班塞不下：從最小 bundle 開始整批搬出，直到剩下能塞主車（不切 bundle）
    let stayUnits = [...cls.units].sort((a, b) => a.size - b.size)
    let stayTotal = cls.total

    while (stayTotal > avail(mainCar) && stayUnits.length > 1) {
      const smallest = stayUnits[0]
      stayUnits = stayUnits.slice(1)
      stayTotal -= smallest.size
      spilloverUnits.push({ unit: smallest, originClass: cls.className })
    }

    if (stayTotal > avail(mainCar)) {
      // 只剩一個 bundle 且仍超出 → 整批送 spillover 由碎片整理找其他車（不切 bundle）
      spilloverUnits.push({ unit: stayUnits[0], originClass: cls.className })
    } else {
      const sorted = [...stayUnits].sort((a, b) => a.groupName.localeCompare(b.groupName, 'zh-TW'))
      for (const u of sorted) placeRegIds(mainCar, u.regIds)
    }
  }

  // ── Step 4: 碎片整理（三層 fallback） ───────────────────────
  // 大 unit 優先（先處理難塞的）
  spilloverUnits.sort((a, b) => b.unit.size - a.unit.size)

  for (const { unit, originClass } of spilloverUnits) {
    // (a) 同班已有成員 + 空位足夠
    const sameClassCar = cars.find(c =>
      avail(c) >= unit.size && carHasClassMember(c, originClass)
    )
    if (sameClassCar) { placeRegIds(sameClassCar, unit.regIds); continue }

    // (b) max-avail 車
    const target = maxAvailCar()
    if (avail(target) >= unit.size) { placeRegIds(target, unit.regIds); continue }

    // (c) 警示，不切 bundle
    warnings.push({
      kind: 'unit_no_seat',
      regIds: unit.regIds,
      size: unit.size,
      className: originClass,
      message: `${originClass || '(無班別)'}群組（${unit.size} 人）無車位可整組安置（最大空位 ${avail(target)} 位），請手動處理或加開車次`,
    })
  }

  // ── Step 5: 孤兒訪客（findGuestHost 找不到 host） ────────────
  for (const guest of guestLarge) {
    if (placed.has(guest.registration_id)) continue
    const target = cars.find(c => avail(c) > 0)
    if (target) {
      placeRegIds(target, [guest.registration_id])
    } else {
      warnings.push({
        kind: 'orphan_guest_no_seat',
        regIds: [guest.registration_id],
        size: 1,
        message: `訪客「${getName(guest)}」無車位可安置`,
      })
    }
  }

  // ── Step 6: Integrity Check（防退化） ──────────────────────
  for (const b of bundles) {
    const carIds = new Set()
    for (const rid of b.regIds) {
      const c = cars.find(cc => cc.members.includes(rid))
      if (c) carIds.add(c.tempId)
    }
    if (carIds.size > 1) {
      warnings.push({
        kind: 'integrity_violation',
        regIds: b.regIds,
        size: b.size,
        message: `學員與其親友被拆到不同車（${b.regIds.length} 人）— 排車邏輯異常，請通報開發`,
      })
    }
  }
  for (const u of relUnits) {
    const carIds = new Set()
    for (const rid of u.regIds) {
      const c = cars.find(cc => cc.members.includes(rid))
      if (c) carIds.add(c.tempId)
    }
    if (carIds.size > 1) {
      warnings.push({
        kind: 'integrity_violation',
        regIds: u.regIds,
        size: u.regIds.length,
        message: `關係群組「${u.name}」被拆到不同車 — 排車邏輯異常`,
      })
    }
  }

  return { cars, warnings }
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
    const matched = findGuestHost(guest, studentRegsInCar)
    const idx     = matched ? result.indexOf(matched.registration_id) : -1
    if (idx >= 0) result.splice(idx + 1, 0, guest.registration_id)
    else result.push(guest.registration_id)
  }
  return result
}

// ─── PersonRow 元件 ───────────────────────────────────────────

function PersonRow({ reg, carIdx, cars, smallGroups, onMove, onToggleLeader, guestInfo, seq }) {
  const name     = getName(reg)
  const cls      = getClasses(reg).map(c => [c.class_name, c.group_name].filter(Boolean).join(' ')).join('／')
  const isLeader = carIdx >= 0 && (cars[carIdx]?.leaders.includes(reg.registration_id) ?? false)
  const isGuest  = !reg.student_id
  const preceptBadge = preceptBadgeProps(reg)

  return (
    <div className={`flex items-center gap-2 px-4 py-2 text-sm ${isGuest ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-amber-50'}`}>
      {seq != null && (
        <span className="shrink-0 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-mono tabular-nums">
          {seq}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium truncate">{name}</span>
          {preceptBadge && (
            <span className={preceptBadge.className} title={preceptBadge.title}>
              {preceptBadge.children}
            </span>
          )}
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
  // 一般流程：先排上山、再排下山（下山多半延用上山排法）
  const [direction, setDirection] = useState('up')

  // 大車狀態：依方向各一份
  const [carsByDir, setCarsByDir]               = useState({ up: [], down: [] })
  const [carCountByDir, setCarCountByDir]       = useState({ up: 2, down: 2 })
  const [seatsPerCarByDir, setSeatsPerCarByDir] = useState({ up: 20, down: 20 })

  // 小車訪客手動移入 / 孤兒乘客指派：依方向各一份
  const [orphanByDir, setOrphanByDir]         = useState({ up: {}, down: {} })
  const [guestSmallByDir, setGuestSmallByDir] = useState({ up: {}, down: {} })

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

    if (headLeader) {
      setHeadLeaderRegId(headLeader.registration_id ?? '')
      setHeadLeaderToken(headLeader.access_token ?? '')
    }
    setSmallCarLeaders(smallCarLeaderList ?? [])
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
      carsByDir.down.flatMap(c => c.monks ?? []).length
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
      saveCarArrangement(eventId, carsByDir.up,   upSmall,   'up'),
      saveCarArrangement(eventId, carsByDir.down, downSmall, 'down'),
      headLeaderRegId
        ? saveHeadLeader(eventId, headLeaderRegId)
        : Promise.resolve({ success: true }),
      saveSmallCarLeaders(eventId, smallCarLeaderRegIds),
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
                  📋 複製到{direction === 'up' ? '下山' : '上山'}
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
            return (
              <div className="sticky top-0 z-20 -mx-4 px-4 py-2 mb-3 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm">
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

                  {/* 法師指派（可選，不強制；一位法師同方向只能在一台車） */}
                  {allMonks.length > 0 && (
                    <div className="px-4 py-3 bg-purple-50 border-t border-purple-100">
                      <div className="text-xs font-medium text-purple-600 mb-2">🏯 搭乘法師（可選）</div>
                      <div className="flex flex-wrap gap-2">
                        {allMonks.map(monk => {
                          const assignedCarIdx    = cars.findIndex(c => (c.monks ?? []).includes(monk.id))
                          const assignedHere      = assignedCarIdx === ci
                          const assignedElsewhere = assignedCarIdx >= 0 && assignedCarIdx !== ci
                          return (
                            <button
                              key={monk.id}
                              onClick={() => toggleMonk(ci, monk.id)}
                              title={assignedElsewhere ? `目前在 ${cars[assignedCarIdx].car_name}，點選會搬過來` : ''}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                assignedHere
                                  ? 'bg-purple-600 text-white border-purple-600'
                                  : assignedElsewhere
                                  ? 'bg-gray-100 text-gray-400 border-gray-200 line-through hover:bg-purple-50 hover:text-purple-500 hover:border-purple-300 hover:no-underline'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-600'
                              }`}
                            >
                              {assignedHere && '✓ '}
                              {assignedElsewhere && `（${cars[assignedCarIdx].car_name}）`}
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
                    {g.allMembers.map((r, mi) => {
                      const cls       = (r.students?.student_classes ?? []).map(c => c.class_name).join('/')
                      const isDriver  = r.registration_id === g.key
                      const carpoolNm = r.answers?.[fieldKeysFor(direction).carpool] ?? ''
                      const isOrphan  = orphans.some(o => o.registration_id === r.registration_id)
                      return (
                        <div key={r.registration_id} className={`flex items-center gap-2 px-4 py-2 text-sm ${isOrphan ? 'bg-orange-50' : ''}`}>
                          <span className="shrink-0 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-mono tabular-nums">
                            {mi + 1}
                          </span>
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

        {/* ── 小車領隊（上下山共用，可多人） ── */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-3">
            🚗 小車領隊
            <span className="text-xs font-normal text-gray-400 ml-2">（上下山共用、可多人）</span>
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
            小車領隊可查看並操作所有小車成員的報到狀況（含上山與下山）。可設定多位領隊分擔任務，每位都有獨立的連結。<br />
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
