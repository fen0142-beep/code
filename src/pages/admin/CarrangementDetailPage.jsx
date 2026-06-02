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

// ─── 常數與工具 ───────────────────────────────────────────────

const CHINESE_NUMS = ['一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五']
const chNum = n => CHINESE_NUMS[n - 1] ?? String(n)
const genId = () => `tmp-${Math.random().toString(36).slice(2)}`

const DIRECTIONS = [
  { key: 'up',   label: '去程', emoji: '🚌' },
  { key: 'down', label: '回程', emoji: '🚍' },
]
const dirLabel = d => DIRECTIONS.find(x => x.key === d)?.label ?? d

// 取得顯示名稱（相容訪客）
const getName    = r => {
  if (r.students?.name) return r.students.name
  const g = r.answers?.guest_name
  if (!g) return '訪客'
  const host = r.answers?.host_name
  return host ? `${g}（${host} 親友）` : g
}
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

// 車號標準化：大寫 + 移除空白與連字號（與 EventDetailPage.computeTempleStats 一致）
// 避免 "ABC-1234" 和 "abc 1234" 被當成兩台
function normalizePlate(s) {
  return String(s || '').trim().toUpperCase().replace(/[\s\-－—]/g, '')
}

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

// 其他交通：不歸大車也不歸小車（每方向獨立判斷）
const isOtherTransport = (r, dir) => {
  if (isLargeCar(r, dir)) return false
  if (isSmallCar(r.answers, dir)) return false
  return true
}

// ─── 小車配對（純運算，不存 DB）────────────────────────────────
// 回傳 { matchedGroups, orphans }
// matchedGroups：有司機的群組（按順序編為小車 1、2…）
//   - 同車號的多位「自行開車」會合併為同一個 group（同一台車）
//   - 主司機判定：恰好一位 is_driver=true → 那位；否則 needsDriverChoice=true（讓師父手動選）
// orphans：找不到司機的乘客（需手動指定搭哪台小車）

function computeSmallGroups(regs, dir) {
  const keys = fieldKeysFor(dir)
  const drivers    = regs.filter(r => isSmallDriver(r.answers, dir))
  const passengers = regs.filter(r => isSmallPassenger(r.answers, dir))

  // Step 1: 依標準化車號分組（空車號 → 各自獨立 key）
  const plateGroups = new Map()
  for (const driver of drivers) {
    const norm = normalizePlate(driver.answers?.[keys.plate] ?? '')
    const groupKey = norm ? `PLATE:${norm}` : `EMPTY:${driver.registration_id}`
    if (!plateGroups.has(groupKey)) plateGroups.set(groupKey, [])
    plateGroups.get(groupKey).push(driver)
  }

  const usedIds       = new Set()
  const matchedGroups = []

  for (const [plateKey, candidates] of plateGroups) {
    // 決定 anchor（主司機）
    let anchor = candidates[0]
    let needsDriverChoice = false
    if (candidates.length > 1) {
      const confirmed = candidates.filter(c => c.is_driver === true)
      if (confirmed.length === 1) {
        anchor = confirmed[0]
      } else {
        // 0 位（皆未確認）或 ≥2 位（衝突）→ 都視為「未指定」
        needsDriverChoice = true
        anchor = candidates[0]
      }
    }

    // 比對共乘者：對 group 內任一 candidate 的名字命中即算
    const candidateNames = candidates.map(c => getName(c)).filter(n => n && n.length >= 2)
    const matched = passengers.filter(p => {
      if (usedIds.has(p.registration_id)) return false
      const cn = (p.answers?.[keys.carpool] ?? '').trim()
      if (!cn) return false
      return candidateNames.some(name => name.includes(cn) || cn.includes(name))
    })
    matched.forEach(p => usedIds.add(p.registration_id))

    // members：anchor 第一 → 其他 candidate（共乘者性質）→ 比對到的共乘者
    const otherCandidates = candidates.filter(c => c.registration_id !== anchor.registration_id)
    const members = [anchor, ...otherCandidates, ...matched]

    matchedGroups.push({
      key: anchor.registration_id,
      driverName: getName(anchor),
      plate: anchor.answers?.[keys.plate] ?? '',
      members,
      candidates,                                                // 同車號司機（≥1 位）
      candidateIds: new Set(candidates.map(c => c.registration_id)),
      needsDriverChoice,
      normalizedPlate: plateKey.startsWith('EMPTY:') ? '' : plateKey.slice(6),
    })
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

  // ── Step 1.5: 學員備註同車（ad-hoc 同車要求） ────────────────
  // 設計：學員 A 在備註欄寫「和 B 同車」，且 B 也是大車學員 → 視為同車單位
  // - Union-Find 處理鏈式關係（A→B、B→C 自動合成 [A,B,C]）
  // - 已被 Step 0（皈戒車）／Step 1（rel group）固定的人，整組往該車併
  // - 找不到任何被提及的學員，但備註含「同車」字眼 → 警示讓師父人工處理
  // - 完全沒同車意圖的備註（如過敏、不便等）→ 不警示，避免誤報
  {
    const COTRAVEL_HINTS = ['同車', '一車', '一起坐', '一起去程', '一起回程', '一起上山', '一起下山', '一起搭', '一起回', '坐同']

    // Union-Find（簡易版）
    const parent = {}
    studentLarge.forEach(r => { parent[r.registration_id] = r.registration_id })
    const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]))
    const union = (a, b) => {
      const ra = find(a), rb = find(b)
      if (ra !== rb) parent[ra] = rb
    }

    // 掃描每位學員的備註欄
    for (const r of studentLarge) {
      const note = getGuestNote(r)
      if (!note.trim()) continue

      const myName = getName(r)
      const mentioned = []
      for (const other of studentLarge) {
        if (other.registration_id === r.registration_id) continue
        const nm = getName(other)
        if (nm && nm.length >= 2 && note.includes(nm)) {
          mentioned.push(other)
        }
      }

      if (mentioned.length > 0) {
        for (const m of mentioned) union(r.registration_id, m.registration_id)
      } else if (COTRAVEL_HINTS.some(h => note.includes(h))) {
        // 有同車意圖但找不到對應學員
        warnings.push({
          kind: 'note_unmatched',
          regIds: [r.registration_id],
          size: 1,
          message: `${myName} 備註「${note.slice(0, 15)}${note.length > 15 ? '…' : ''}」提到同車但找不到對應學員（可能對方未報名／姓名拼錯）`,
        })
      }
    }

    // 收集 size ≥ 2 的群組
    const noteGroupMap = {}
    for (const r of studentLarge) {
      const root = find(r.registration_id)
      if (!noteGroupMap[root]) noteGroupMap[root] = []
      noteGroupMap[root].push(r.registration_id)
    }
    const noteGroups = Object.values(noteGroupMap).filter(g => g.length >= 2)

    // 依群組人數遞減（大群組先處理，避免被小群組擠掉）
    noteGroups.sort((a, b) => b.length - a.length)

    for (const group of noteGroups) {
      // (1) 任一人已被 Step 0 放進皈戒車 → 整組塞同台皈戒車
      const preceptCar = cars.find(c => c.isPreceptCar && group.some(rid => c.members.includes(rid)))
      if (preceptCar) {
        const remaining = group.filter(rid => !placed.has(rid))
        const seatLeft  = preceptCar.seats - preceptCar.members.length
        const fits      = remaining.slice(0, seatLeft)
        const overflow  = remaining.slice(seatLeft)
        // 皈戒車的 avail() 回 0，這裡刻意繞過 avail() 直接 push（同 Step 0 做法）
        for (const rid of fits) { preceptCar.members.push(rid); placed.add(rid) }
        if (overflow.length > 0) {
          warnings.push({
            kind: 'note_precept_overflow',
            regIds: overflow,
            size: overflow.length,
            message: `備註同車群組共 ${group.length} 人需與皈戒車「${preceptCar.car_name}」同行，但車位不足 ${overflow.length} 位`,
          })
        }
        continue
      }

      // (2) 任一人已被 Step 1 (rel group) 放好 → 整組塞那台車
      const pinnedCar = cars.find(c => !c.isPreceptCar && group.some(rid => c.members.includes(rid)))
      if (pinnedCar) {
        const remaining = group.filter(rid => !placed.has(rid))
        if (remaining.length === 0) {
          // 全員都已被放（rel group 拆到不同車）→ 檢查是否真同車
          const carIds = new Set()
          for (const rid of group) {
            const c = cars.find(x => x.members.includes(rid))
            if (c) carIds.add(c.tempId)
          }
          if (carIds.size > 1) {
            const groupNames = group.map(rid => getName(regLookup[rid])).filter(Boolean).join('、')
            warnings.push({
              kind: 'note_group_split',
              regIds: group,
              size: group.length,
              message: `備註同車群組「${groupNames}」共 ${group.length} 人因既有 rel group 設定被拆到 ${carIds.size} 台車，請手動調整`,
            })
          }
        } else if (avail(pinnedCar) >= remaining.length) {
          placeRegIds(pinnedCar, remaining)
        } else {
          warnings.push({
            kind: 'note_pinned_overflow',
            regIds: remaining,
            size: remaining.length,
            message: `備註同車群組共 ${group.length} 人被既有分派鎖在「${pinnedCar.car_name}」，剩餘 ${remaining.length} 位但僅 ${avail(pinnedCar)} 位空位`,
          })
        }
        continue
      }

      // (3) 都未放 → tightest fit
      const fits = cars.filter(c => avail(c) >= group.length)
      if (fits.length > 0) {
        const target = fits.reduce((a, b) => avail(a) <= avail(b) ? a : b)
        placeRegIds(target, group)
      } else {
        warnings.push({
          kind: 'note_group_no_seat',
          regIds: group,
          size: group.length,
          message: `備註同車群組共 ${group.length} 人，沒有車位可整組安置（最大空位 ${avail(maxAvailCar())} 位）`,
        })
      }
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
  const preceptBadges = preceptBadgeProps(reg)

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
          {preceptBadges.map((b, i) => (
            <span key={i} className={b.className} title={b.title}>
              {b.children}
            </span>
          ))}
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

function StatCard({ label, value, color, sub }) {
  return (
    <div className={`border rounded-xl p-4 ${color}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-xs mt-1">{label}</div>
      {sub && <div className="text-xs mt-0.5 text-purple-600">{sub}</div>}
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
