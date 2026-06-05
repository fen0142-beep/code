# -*- coding: utf-8 -*-
# 補丁 #2 — 2026-05-22 三度
# 修：延後/提前回程未從「小車應到」排除（漏掉的位置）
#   - mode='head' 小車展開單車的 total/checked/unchecked
#   - mode='small_car' 全部 totalAll/checkedAll + 單車 total/checked

from pathlib import Path

ROOT = Path(__file__).parent
CHECKIN = ROOT / 'src/pages/CarCheckinPage.jsx'


def replace_once(text, old, new, label):
    cnt = text.count(old)
    if cnt == 0:
        print(f'[SKIP] {label}: 找不到 old_string')
        return text
    if cnt > 1:
        raise RuntimeError(f'[ERROR] {label}: old_string 出現 {cnt} 次')
    print(f'[OK]   {label}')
    return text.replace(old, new, 1)


text = CHECKIN.read_text(encoding='utf-8')

# ─── A. 在 getLateReturnInfo 後新增頂層 helper ──
old_a = '''// 判斷是否延後回程（任一答案日期晚於活動結束日）
// 回傳 "X月X日才回程" 字串，或 null
function getLateReturnInfo(answers, eventDateEnd) {
  if (!answers || !eventDateEnd) return null
  const eventDate = eventDateEnd.slice(0, 10)
  for (const val of Object.values(answers)) {
    if (typeof val !== 'string') continue
    const m = val.match(/^(\\d{4}-\\d{2}-\\d{2})/)
    if (!m) continue
    if (m[1] > eventDate) {
      const d = new Date(m[1] + 'T00:00:00')
      return `${d.getMonth() + 1}月${d.getDate()}日才回程`
    }
  }
  return null
}'''

new_a = '''// 判斷是否延後回程（任一答案日期晚於活動結束日）
// 回傳 "X月X日才回程" 字串，或 null
function getLateReturnInfo(answers, eventDateEnd) {
  if (!answers || !eventDateEnd) return null
  const eventDate = eventDateEnd.slice(0, 10)
  for (const val of Object.values(answers)) {
    if (typeof val !== 'string') continue
    const m = val.match(/^(\\d{4}-\\d{2}-\\d{2})/)
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
// 下山：c.late_return 整車延後 OR 個人/同車 effective 延後
function isMemberExcludedFromExpected(m, c, eventDateStart, eventDateEnd) {
  if ((c.direction ?? 'down') === 'down') {
    return !!c.late_return || !!getEffectiveLateReturn(m, c, eventDateEnd)
  }
  return !!c.pre_depart || !!getEffectivePreArrive(m, c, eventDateStart)
}'''

text = replace_once(text, old_a, new_a, 'A: 新增 isMemberExcludedFromExpected 頂層 helper')

# ─── B. mode='head' 內的 isExcludedFromExpected 改用 helper（保留 closure） ──
old_b = '''    // 上山方向：c.pre_depart（整車提前）OR 個人/同車 getEffectivePreArrive
    // 下山方向：c.late_return（整車延後）OR 個人/同車 getEffectiveLateReturn
    const isExcludedFromExpected = (m, c) => {
      if ((c.direction ?? 'down') === 'down') {
        return !!c.late_return || !!getEffectiveLateReturn(m, c, dateEnd)
      }
      return !!c.pre_depart || !!getEffectivePreArrive(m, c, dateStart)
    }'''

new_b = '''    // 上山方向：c.pre_depart（整車提前）OR 個人/同車 getEffectivePreArrive
    // 下山方向：c.late_return（整車延後）OR 個人/同車 getEffectiveLateReturn
    const isExcludedFromExpected = (m, c) => isMemberExcludedFromExpected(m, c, dateStart, dateEnd)'''

text = replace_once(text, old_b, new_b, 'B: mode=head isExcludedFromExpected 改用 helper')

# ─── C. mode='head' 小車展開單車 total/checked/unchecked 套排除 ──
old_c = '''              {expandedCarId === '__small__' && (
                <div className="border-t divide-y">
                  {smallCars.map(c => {
                    const total     = c.car_members?.length ?? 0
                    const checked   = (c.car_members ?? []).filter(isCheckedIn).length
                    const unchecked = total - checked
                    const done      = checked === total && total > 0'''

new_c = '''              {expandedCarId === '__small__' && (
                <div className="border-t divide-y">
                  {smallCars.map(c => {
                    // 排除延後/提前者（與外層摘要一致）
                    const todayMembers = (c.car_members ?? []).filter(m => !isExcludedFromExpected(m, c))
                    const total     = todayMembers.length
                    const checked   = todayMembers.filter(isCheckedIn).length
                    const unchecked = total - checked
                    const done      = checked === total && total > 0'''

text = replace_once(text, old_c, new_c, 'C: mode=head 小車展開單車 total/checked 套排除')

# ─── D. mode='small_car' 頭部 totalAll/checkedAll 套排除 ──
old_d = '''  if (mode === 'small_car') {
    const eventName  = headLeader?.events?.name ?? ''
    const dateStart  = headLeader?.events?.date_start
    const dateEnd    = headLeader?.events?.date_end
    const eventDate  = formatDate(dateStart)
    const totalAll   = allCars.reduce((s, c) => s + (c.car_members?.length ?? 0), 0)
    const checkedAll = allCars.reduce(
      (s, c) => s + (c.car_members?.filter(isCheckedIn).length ?? 0), 0
    )
    const uncheckedAll = totalAll - checkedAll'''

new_d = '''  if (mode === 'small_car') {
    const eventName  = headLeader?.events?.name ?? ''
    const dateStart  = headLeader?.events?.date_start
    const dateEnd    = headLeader?.events?.date_end
    const eventDate  = formatDate(dateStart)
    // 排除延後/提前者（與大車模式 isExcludedFromExpected 邏輯一致）
    const isExcludedHere = (m, c) => isMemberExcludedFromExpected(m, c, dateStart, dateEnd)
    // 整車提前/延後直接整車排除
    const activeCars = allCars.filter(c =>
      (c.direction ?? 'down') === 'down' ? !c.late_return : !c.pre_depart
    )
    const totalAll   = activeCars.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedHere(m, c)).length ?? 0), 0
    )
    const checkedAll = activeCars.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedHere(m, c) && isCheckedIn(m)).length ?? 0), 0
    )
    const uncheckedAll = totalAll - checkedAll'''

text = replace_once(text, old_d, new_d, 'D: mode=small_car 頭部計數套排除')

# ─── E. mode='small_car' 單車 total/checked/unchecked 套排除 ──
old_e = '''        {/* 各小車卡片 */}
        <div className="px-4 pt-3 max-w-lg mx-auto space-y-3">
          {allCars.map(c => {
            const members  = c.car_members ?? []
            const total    = members.length
            const checked  = members.filter(isCheckedIn).length
            const unchecked = total - checked
            const done     = checked === total && total > 0'''

new_e = '''        {/* 各小車卡片 */}
        <div className="px-4 pt-3 max-w-lg mx-auto space-y-3">
          {allCars.map(c => {
            const members  = c.car_members ?? []
            // 排除延後/提前者
            const todayMembers = members.filter(m => !isExcludedHere(m, c))
            const total    = todayMembers.length
            const checked  = todayMembers.filter(isCheckedIn).length
            const unchecked = total - checked
            const done     = checked === total && total > 0'''

text = replace_once(text, old_e, new_e, 'E: mode=small_car 單車 total/checked 套排除')

CHECKIN.write_text(text, encoding='utf-8')
print(f'[WROTE] {CHECKIN} ({len(text)} bytes)')
