// helpers extracted from CarrangementDetailPage.jsx

export const CHINESE_NUMS = ['一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五']
export const chNum = n => CHINESE_NUMS[n - 1] ?? String(n)
export const genId = () => `tmp-${Math.random().toString(36).slice(2)}`

export const DIRECTIONS = [
  { key: 'up',   label: '去程', emoji: '🚌' },
  { key: 'down', label: '回程', emoji: '🚍' },
]
export const dirLabel = d => DIRECTIONS.find(x => x.key === d)?.label ?? d

// 取得顯示名稱（相容訪客）
export const getName    = r => {
  if (r.students?.name) return r.students.name
  const g = r.answers?.guest_name
  if (!g) return '訪客'
  const host = r.answers?.host_name
  return host ? `${g}（${host} 親友）` : g
}
export const getClasses = r => r.students?.student_classes ?? []

// 取得備註欄（相容多種可能的 field_key）
export const getGuestNote = r =>
  r.answers?.['備註'] ?? r.answers?.note ?? r.answers?.memo ?? r.answers?.beizhu ?? ''

// 在學員報名清單中尋找備註提到的姓名
export function findGuestMatch(note, studentRegs) {
  if (!note.trim()) return null
  for (const r of studentRegs) {
    const name = getName(r)
    if (name && name.length >= 2 && note.includes(name)) return r
  }
  return null
}

// 找訪客的 host：優先用 host_student_id（Phase 2 學員代報），fallback 用備註姓名（舊資料）
export function findGuestHost(guest, studentRegs) {
  if (guest.host_student_id) {
    const direct = studentRegs.find(r => r.student_id === guest.host_student_id)
    if (direct) return direct
  }
  return findGuestMatch(getGuestNote(guest), studentRegs)
}

// 取得依方向對應的欄位 key
export const fieldKeysFor = direction => ({
  transport: direction === 'up' ? 'transport_up' : 'transport_down',
  carpool:   direction === 'up' ? 'carpool_up'   : 'carpool_down',
  plate:     direction === 'up' ? 'plate_up'     : 'plate_down',
})

// 判斷交通方式（依方向動態讀對應欄位）
export const isSmallDriver    = (ans, dir) => (ans?.[fieldKeysFor(dir).transport] ?? '').includes('自行開車')
export const isSmallPassenger = (ans, dir) => (ans?.[fieldKeysFor(dir).transport] ?? '').includes('搭學員')
export const isSmallCar       = (ans, dir) => isSmallDriver(ans, dir) || isSmallPassenger(ans, dir)

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
export const isLargeCar = (r, dir) => {
  if (isSmallDriver(r.answers, dir) || isSmallPassenger(r.answers, dir)) return false
  const t = r.answers?.[fieldKeysFor(dir).transport] ?? ''
  if (r.student_id) return t.includes('精舍')
  // 訪客：有填值 → 須含「精舍」才算大車；完全沒填（舊資料）→ 預設大車
  if (t) return t.includes('精舍')
  return true
}

// 其他交通：不歸大車也不歸小車（每方向獨立判斷）
export const isOtherTransport = (r, dir) => {
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

export function computeSmallGroups(regs, dir) {
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

// ─── 車內成員顯示排序 ──────────────────────────────────────────
// 同班同組排在一起，訪客緊接在親友後面

export function sortedMembersForDisplay(memberIds, regMap) {
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
