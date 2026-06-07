import { chNum, genId, getName, getClasses, findGuestHost, getGuestNote } from './carrangeHelpers'
import { getPreceptLevel } from './registrationHelpers'

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

export default autoArrange
