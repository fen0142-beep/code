// ─── 工具函式 ──────────────────────────────────────────────────

export const getMemberName = (member) =>
  member?.registrations?.students?.name ??
  member?.registrations?.answers?.guest_name ??
  '訪客'

export const isGuest = (member) => !member?.registrations?.student_id

// car_members 有 checked_in_at（undefined = regAsMember/其他交通 fallback）
// direction 只對 regAsMember（其他交通）有效：up → checked_in_at；down → checked_in_down_at
export const getMemberCheckedAt = (member, direction = 'up') =>
  member?.checked_in_at !== undefined
    ? member.checked_in_at
    : direction === 'down'
      ? (member?.registrations?.checked_in_down_at ?? null)
      : (member?.registrations?.checked_in_at ?? null)
export const isCheckedIn = (member, direction = 'up') => !!getMemberCheckedAt(member, direction)

// 「其他交通」判定：transport 不歸大車也不歸小車
// 沿用 CarrangementDetailPage 的分類邏輯：大車=含「精舍」，小車=含「自行開車」或「搭學員」
// 訪客空白 → 視為大車（舊資料相容）；學員空白 → 視為其他
export const BIG_CAR_KEYS_OTHER = ['精舍']
export const SMALL_CAR_KEYS_OTHER = ['自行開車', '搭學員']
export function isOtherTransport(reg, dir) {
  const key = dir === 'up' ? 'transport_up' : 'transport_down'
  const t = reg.answers?.[key] ?? ''
  if (!t && !reg.student_id) return false   // 訪客空白 → 大車
  if (BIG_CAR_KEYS_OTHER.some(k => t.includes(k))) return false
  if (SMALL_CAR_KEYS_OTHER.some(k => t.includes(k))) return false
  return true
}
// 把 reg 包成 car_members 格式，沿用既有 getMemberName / formatMemberClasses / handleToggleCheckin
export function regAsMember(reg) {
  return {
    registration_id: reg.registration_id,
    registrations: reg,
  }
}

// 取得班級／組別清單（一個學員可能跨班）
export const getMemberClasses = (member) =>
  member?.registrations?.students?.student_classes ?? []

// 班組顯示字串：「初級日間 第一組／中級夜間 第三組」
export const formatMemberClasses = (member) => {
  const classes = getMemberClasses(member)
  if (classes.length === 0) return ''
  return classes.map(c => c.class_name + (c.group_name ? ' ' + c.group_name : '')).join(' / ')
}

// 排序鍵：依第一筆班級+組別+姓名
export const memberSortKey = (member) => {
  const classes = getMemberClasses(member)
  const first = classes[0] || {}
  return `${first.class_name ?? '￾'}|${first.group_name ?? '￾'}|${getMemberName(member)}`
}

// 報到頁排序：領隊 → 學員（依班+組+姓名），訪客最後
export function sortCheckinMembers(members, leaderRegIds) {
  const leaderSet = new Set(leaderRegIds)
  const isLeader  = m => leaderSet.has(m.registration_id)
  const guestRank = m => isGuest(m) ? 1 : 0
  const roleRank  = m => isLeader(m) ? 0 : 1
  return [...members].sort((a, b) => {
    const ga = guestRank(a), gb = guestRank(b)
    if (ga !== gb) return ga - gb       // 訪客排最後
    const ra = roleRank(a),  rb = roleRank(b)
    if (ra !== rb) return ra - rb       // 領隊排前面
    return memberSortKey(a).localeCompare(memberSortKey(b), 'zh-TW', { numeric: true })
  })
}

export const formatDate = (dateStr) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

// ─── 提前上山自動報到的 sessionStorage 鎖 ──────────────────────
// 問題：load() 在 page mount 時把「提前上山者」自動標記為已報到。
// 領隊若手動取消其報到，重新整理（F5）後又會被自動勾回，造成「上方計數已更新但下方又恢復」的 bug。
// 修法：用 sessionStorage 紀錄「本次 session 已自動勾過的 reg_id」，每位只勾一次。
// 領隊取消後維持取消，直到 sessionStorage 清掉（換瀏覽器 / 隔天 / 清快取）。

export function getAutoCheckedSet(token) {
  try {
    const raw = sessionStorage.getItem(`autoChecked_${token}`)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

export function markAutoChecked(token, regIds) {
  try {
    const set = getAutoCheckedSet(token)
    regIds.forEach(id => set.add(id))
    sessionStorage.setItem(`autoChecked_${token}`, JSON.stringify([...set]))
  } catch {
    // sessionStorage 不可用就放棄記錄，最差結果是退回舊行為
  }
}

// 小車「同車繼承」preArrive：member 自己沒 preArrive，但同小車有人提前 → 整車視為提前
// 適用：小車（司機載一車人，司機提前=全車提前）；大車不適用（當天接送）
// 優先序：個人 override > 個人 answers 早於 dateStart > 同車有人 override > 同車有人 answers 早於 dateStart
export function getEffectivePreArrive(member, car, eventDateStart) {
  if (member?.registrations?.pre_depart_override) return '已標記提前出發'
  const own = getPreArriveInfo(member?.registrations?.answers, eventDateStart)
  if (own) return own
  if (car?.car_type !== 'small' || !car.car_members) return null
  for (const other of car.car_members) {
    if (other?.registration_id === member?.registration_id) continue
    if (other?.registrations?.pre_depart_override) return '同車已提前出發'
    const info = getPreArriveInfo(other?.registrations?.answers, eventDateStart)
    if (info) return info
  }
  return null
}

// 判斷是否提前上山（任一答案日期早於活動起始日）
// 回傳 "X月X日已上山" 字串，或 null
export function getPreArriveInfo(answers, eventDateStart) {
  if (!answers || !eventDateStart) return null
  const eventDate = eventDateStart.slice(0, 10) // 'YYYY-MM-DD'
  for (const val of Object.values(answers)) {
    if (typeof val !== 'string') continue
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/)
    if (!m) continue
    if (m[1] < eventDate) {
      const d = new Date(m[1] + 'T00:00:00')
      return `${d.getMonth() + 1}月${d.getDate()}日已出發`
    }
  }
  return null
}

// 小車「同車繼承」lateReturn：member 自己沒延後，但同小車有人延後 → 整車視為延後
// 對稱 getEffectivePreArrive（下山方向用）
export function getEffectiveLateReturn(member, car, eventDateEnd) {
  if (member?.registrations?.late_return_override) return '已標記延後回程'
  const own = getLateReturnInfo(member?.registrations?.answers, eventDateEnd)
  if (own) return own
  if (car?.car_type !== 'small' || !car.car_members) return null
  for (const other of car.car_members) {
    if (other?.registration_id === member?.registration_id) continue
    if (other?.registrations?.late_return_override) return '同車已延後回程'
    const info = getLateReturnInfo(other?.registrations?.answers, eventDateEnd)
    if (info) return info
  }
  return null
}

// 判斷是否延後回程（任一答案日期晚於活動結束日）
// 回傳 "X月X日才回程" 字串，或 null
export function getLateReturnInfo(answers, eventDateEnd) {
  if (!answers || !eventDateEnd) return null
  const eventDate = eventDateEnd.slice(0, 10)
  for (const val of Object.values(answers)) {
    if (typeof val !== 'string') continue
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/)
    if (!m) continue
    if (m[1] > eventDate) {
      const d = new Date(m[1] + 'T00:00:00')
      return `${d.getMonth() + 1}月${d.getDate()}日才回程`
    }
  }
  return null
}

// 判斷某成員是否從應到排除（依方向分流，跨 mode 共用）
// 上山：c.pre_depart 整車提前 OR 個人/同車 effective 提前
// 下山：c.late_return 整車延後 OR 個人/同車 effective 延後 OR 義工車（下山方向）
export function isMemberExcludedFromExpected(m, c, eventDateStart, eventDateEnd) {
  if ((c.direction ?? 'down') === 'down') {
    if (isVolunteerSelfReturn(c, eventDateEnd)) return true
    return !!c.late_return || !!getEffectiveLateReturn(m, c, eventDateEnd)
  }
  return !!c.pre_depart || !!getEffectivePreArrive(m, c, eventDateStart)
}

// 義工車自行回程判定：下山方向 + 車內任一義工 + 回程日為法會當日（沒延後）
// 規則：只要小車有任一位義工，整車跟著義工的步調自行回程，不和大車同時下山
//      → 整車從下山應到排除
//      只對小車生效（大車載很多人不適用）
export function isVolunteerSelfReturn(c, eventDateEnd) {
  if ((c.direction ?? 'down') !== 'down') return false
  if (c.car_type !== 'small') return false
  if (c.late_return) return false   // 整車延後另外處理
  for (const m of (c.car_members ?? [])) {
    const identity = m?.registrations?.answers?.identity
    if (identity !== '義工') continue
    // 該義工本人沒延後（回程日為法會當日）才觸發
    const lr = getLateReturnInfo(m?.registrations?.answers, eventDateEnd)
    if (!lr) return true
  }
  return false
}

// 整車是否全員被「個人/同車 effective」觸發（即使沒勾 late_return / pre_depart 整車旗標）
// 用途：自動偵測「全車 5/24 才回程」這類情況，車名旁顯示 badge
export function isCarFullyEffectiveExcluded(c, eventDateStart, eventDateEnd) {
  const members = c.car_members ?? []
  if (members.length === 0) return false
  const isDown = (c.direction ?? 'down') === 'down'
  for (const m of members) {
    const ex = isDown
      ? !!getEffectiveLateReturn(m, c, eventDateEnd)
      : !!getEffectivePreArrive(m, c, eventDateStart)
    if (!ex) return false
  }
  return true
}
