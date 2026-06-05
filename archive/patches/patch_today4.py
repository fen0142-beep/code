# -*- coding: utf-8 -*-
# 補丁 #4 — 2026-05-22 四度
#
# 修：
#   1. 整車 effective 延後/提前 → 車名旁加 amber/teal badge + 整車背景強調
#      + 對 excluded 的人，視覺強制「未到」（覆蓋 DB 殘留 checked_in_at）
#   2. 義工車自行回程：下山方向 + 車內任一義工 + 回程日為法會當日
#      → 整車從應到排除 + 車名旁顯示「義工車・自行回程」badge + toggle 鎖死

from pathlib import Path

ROOT = Path(__file__).parent
CH = ROOT / 'src/pages/CarCheckinPage.jsx'


def replace_once(text, old, new, label):
    cnt = text.count(old)
    if cnt == 0:
        print(f'[SKIP] {label}: 找不到 old_string')
        return text
    if cnt > 1:
        raise RuntimeError(f'[ERROR] {label}: old_string 出現 {cnt} 次')
    print(f'[OK]   {label}')
    return text.replace(old, new, 1)


ch = CH.read_text(encoding='utf-8')

# ─── A. 在 isMemberExcludedFromExpected 之後加 isVolunteerSelfReturn + isCarExcluded helpers ──
old_a = '''// 判斷某成員是否從應到排除（依方向分流，跨 mode 共用）
// 上山：c.pre_depart 整車提前 OR 個人/同車 effective 提前
// 下山：c.late_return 整車延後 OR 個人/同車 effective 延後
function isMemberExcludedFromExpected(m, c, eventDateStart, eventDateEnd) {
  if ((c.direction ?? 'down') === 'down') {
    return !!c.late_return || !!getEffectiveLateReturn(m, c, eventDateEnd)
  }
  return !!c.pre_depart || !!getEffectivePreArrive(m, c, eventDateStart)
}'''

new_a = '''// 判斷某成員是否從應到排除（依方向分流，跨 mode 共用）
// 上山：c.pre_depart 整車提前 OR 個人/同車 effective 提前
// 下山：c.late_return 整車延後 OR 個人/同車 effective 延後 OR 義工車（下山方向）
function isMemberExcludedFromExpected(m, c, eventDateStart, eventDateEnd) {
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
function isVolunteerSelfReturn(c, eventDateEnd) {
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
function isCarFullyEffectiveExcluded(c, eventDateStart, eventDateEnd) {
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
}'''

ch = replace_once(ch, old_a, new_a, 'A: 新增 isVolunteerSelfReturn + isCarFullyEffectiveExcluded')

# ─── B. mode='head' smallCarsToday filter + reduce 加義工車條件 ──
old_b = '''    // 小車計數：排除整車提前（上山 pre_depart）/ 延後（下山 late_return）
    //         + 個人/同車 effective 提前/延後
    const smallCarsToday = smallCars.filter(c =>
      headDirection === 'down' ? !c.late_return : !c.pre_depart
    )'''

new_b = '''    // 小車計數：排除整車提前（上山 pre_depart）/ 延後（下山 late_return）
    //         + 個人/同車 effective 提前/延後 + 義工車自行回程（下山）
    const smallCarsToday = smallCars.filter(c => {
      if (headDirection === 'down') {
        if (c.late_return) return false
        if (isVolunteerSelfReturn(c, dateEnd)) return false
        return true
      }
      return !c.pre_depart
    })'''

ch = replace_once(ch, old_b, new_b, 'B: mode=head smallCarsToday filter 加義工車')

# ─── C. mode='small_car' activeCars filter 加義工車條件 ──
old_c = '''    // 整車提前/延後直接整車排除
    const activeCars = allCars.filter(c =>
      (c.direction ?? 'down') === 'down' ? !c.late_return : !c.pre_depart
    )'''

new_c = '''    // 整車提前/延後/義工車直接整車排除
    const activeCars = allCars.filter(c => {
      if ((c.direction ?? 'down') === 'down') {
        if (c.late_return) return false
        if (isVolunteerSelfReturn(c, dateEnd)) return false
        return true
      }
      return !c.pre_depart
    })'''

ch = replace_once(ch, old_c, new_c, 'C: mode=small_car activeCars filter 加義工車')

# ─── D. mode='head' 小車展開區：車名旁加 effective/義工 badge + 整車 amber 背景 + 文案 ──
old_d = '''                    return (
                      <div key={c.car_id} className={innerExp ? 'bg-emerald-50 border-l-4 border-emerald-500' : 'bg-gray-50'}>
                        <button
                          onClick={() => setExpandedSmallCarId(innerExp ? null : c.car_id)}
                          className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-gray-700">{c.car_name}</span>
                              <DirectionBadge direction={c.direction} />
                              {headDirection === 'up' && c.pre_depart && (
                                <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">🚀 提前出發</span>
                              )}
                              {headDirection === 'down' && c.late_return && (
                                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">🕓 延後回程</span>
                              )}
                              {done && !c.pre_depart && !c.late_return && (
                                <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員出發 ✓</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {c.pre_depart ? '（已提前出發，不列入今日應到）'
                                : c.late_return ? '（已延後回程，不列入今日應到）'
                                : `應到 ${total}　已到 ${checked}　未到 ${unchecked}`}
                            </div>
                          </div>
                          <span className="text-gray-300 text-xs shrink-0">{innerExp ? '▲' : '▼'}</span>
                        </button>'''

new_d = '''                    // 偵測整車狀態
                    const fullyEffectiveLate = headDirection === 'down' && isCarFullyEffectiveExcluded(c, dateStart, dateEnd)
                    const fullyEffectivePre  = headDirection === 'up'   && isCarFullyEffectiveExcluded(c, dateStart, dateEnd)
                    const volSelfReturn      = headDirection === 'down' && isVolunteerSelfReturn(c, dateEnd)
                    const integratedExcluded = c.late_return || c.pre_depart || volSelfReturn || fullyEffectiveLate || fullyEffectivePre
                    const cardBg = integratedExcluded
                      ? (headDirection === 'down' ? 'bg-amber-50' : 'bg-teal-50')
                      : (innerExp ? 'bg-emerald-50 border-l-4 border-emerald-500' : 'bg-gray-50')
                    return (
                      <div key={c.car_id} className={cardBg}>
                        <button
                          onClick={() => setExpandedSmallCarId(innerExp ? null : c.car_id)}
                          className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-gray-700">{c.car_name}</span>
                              <DirectionBadge direction={c.direction} />
                              {headDirection === 'up' && (c.pre_depart || fullyEffectivePre) && (
                                <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">🚀 提前出發</span>
                              )}
                              {headDirection === 'down' && (c.late_return || fullyEffectiveLate) && (
                                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">🕓 延後回程</span>
                              )}
                              {volSelfReturn && (
                                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">🛠 義工車・自行回程</span>
                              )}
                              {done && !integratedExcluded && (
                                <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員出發 ✓</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {integratedExcluded
                                ? (volSelfReturn ? '（義工車自行回程，不列入今日應到）'
                                  : headDirection === 'down' ? '（已延後回程，不列入今日應到）'
                                  : '（已提前出發，不列入今日應到）')
                                : `應到 ${total}　已到 ${checked}　未到 ${unchecked}`}
                            </div>
                          </div>
                          <span className="text-gray-300 text-xs shrink-0">{innerExp ? '▲' : '▼'}</span>
                        </button>'''

ch = replace_once(ch, old_d, new_d, 'D: mode=head 小車展開區整車 badge + 背景 + 文案')

# ─── E. mode='small_car' 單車卡片：車名旁加 badge + 整車 amber 背景 ──
old_e = '''            return (
              <div key={c.car_id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${done ? 'border-green-300' : 'border-gray-200'}`}>
                {/* 車次標題 */}
                <div className={`px-4 py-3 flex items-center gap-3 ${done ? 'bg-green-50' : 'bg-gray-50'} border-b`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{c.car_name}</span>
                      <DirectionBadge direction={c.direction} />
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
                </div>'''

new_e = '''            // 偵測整車狀態
            const dir = c.direction ?? 'down'
            const fullyEffectiveLate = dir === 'down' && isCarFullyEffectiveExcluded(c, dateStart, dateEnd)
            const fullyEffectivePre  = dir === 'up'   && isCarFullyEffectiveExcluded(c, dateStart, dateEnd)
            const volSelfReturn      = dir === 'down' && isVolunteerSelfReturn(c, dateEnd)
            const integratedExcluded = c.late_return || c.pre_depart || volSelfReturn || fullyEffectiveLate || fullyEffectivePre
            const cardBgWrap = integratedExcluded
              ? (dir === 'down' ? 'border-amber-300' : 'border-teal-300')
              : (done ? 'border-green-300' : 'border-gray-200')
            const headerBg = integratedExcluded
              ? (dir === 'down' ? 'bg-amber-50' : 'bg-teal-50')
              : (done ? 'bg-green-50' : 'bg-gray-50')
            return (
              <div key={c.car_id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${cardBgWrap}`}>
                {/* 車次標題 */}
                <div className={`px-4 py-3 flex items-center gap-3 ${headerBg} border-b`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{c.car_name}</span>
                      <DirectionBadge direction={c.direction} />
                      {dir === 'up' && (c.pre_depart || fullyEffectivePre) && (
                        <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">🚀 提前出發</span>
                      )}
                      {dir === 'down' && (c.late_return || fullyEffectiveLate) && (
                        <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">🕓 延後回程</span>
                      )}
                      {volSelfReturn && (
                        <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">🛠 義工車・自行回程</span>
                      )}
                      {done && !integratedExcluded && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員出發 ✓</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {integratedExcluded
                        ? (volSelfReturn ? '（義工車自行回程，不列入今日應到）'
                          : dir === 'down' ? '（已延後回程，不列入今日應到）'
                          : '（已提前出發，不列入今日應到）')
                        : `應到 ${total}　已到 ${checked}　未到 ${unchecked}`}
                    </div>
                  </div>
                  {!done && !integratedExcluded && (
                    <button
                      onClick={() => handleCheckInAllCar(c.car_id)}
                      className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 active:bg-green-800 transition-colors"
                    >
                      ✅ 全車確認出發
                    </button>
                  )}
                </div>'''

ch = replace_once(ch, old_e, new_e, 'E: mode=small_car 單車整車 badge + 背景')

# ─── F. mode='small_car' 成員 chk 視覺強制未到（excluded 時） ──
# 上一輪 patch_today.py 已把 button disabled，這次只要把 row 的 opacity-50 也對應條件 + chk line-through 蓋掉
# 但實際上目前的 row 用 chk 判斷 line-through / opacity。我們需要：
#   excluded 時 → 視覺上強制顯示為「未到」（蓋掉 chk 的 line-through）
# 直接重寫整個 row map 比較乾淨。但小車 row map 涵蓋 chk 邏輯。
# 簡化：找到 preArr 與 chk 用一起的地方，加 visualChk = chk && !preArr
old_f = '''                  {sortCheckinMembers(members, (c.car_leaders ?? []).map(l => l.registration_id)).map(member => {
                    const name   = getMemberName(member)
                    const guest  = isGuest(member)
                    const chk    = isCheckedIn(member)
                    const dir    = c.direction ?? 'down'
                    const preArr = dir === 'down'
                      ? getEffectiveLateReturn(member, c, dateEnd)
                      : getEffectivePreArrive(member, c, dateStart)
                    const preArrCls = dir === 'down'
                      ? 'bg-amber-100 text-amber-700 border-amber-200'
                      : 'bg-teal-100 text-teal-700 border-teal-200'
                    const isLeader = (c.car_leaders ?? []).some(l => l.registration_id === member.registration_id)
                    const cls    = formatMemberClasses(member)'''

new_f = '''                  {sortCheckinMembers(members, (c.car_leaders ?? []).map(l => l.registration_id)).map(member => {
                    const name   = getMemberName(member)
                    const guest  = isGuest(member)
                    const chkRaw = isCheckedIn(member)
                    const dir    = c.direction ?? 'down'
                    const preArr = dir === 'down'
                      ? getEffectiveLateReturn(member, c, dateEnd)
                      : getEffectivePreArrive(member, c, dateStart)
                    // 義工車 + 整車排除：整車視為「未參與當日」
                    const memberExcluded = !!preArr || integratedExcluded
                    const chk    = chkRaw && !memberExcluded   // 視覺強制顯示為未到
                    const preArrCls = dir === 'down'
                      ? 'bg-amber-100 text-amber-700 border-amber-200'
                      : 'bg-teal-100 text-teal-700 border-teal-200'
                    const isLeader = (c.car_leaders ?? []).some(l => l.registration_id === member.registration_id)
                    const cls    = formatMemberClasses(member)'''

ch = replace_once(ch, old_f, new_f, 'F: mode=small_car row chk 視覺強制未到')

# F2. button 的 disabled 條件改用 memberExcluded（取代 preArr）
old_f2 = '''                        <button
                          onClick={() => !preArr && handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                          disabled={!!preArr}
                          title={preArr ? `已標記為${dir === 'down' ? '延後回程' : '提前出發'}，從應到排除` : ''}
                          className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            preArr
                              ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200'
                              : chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {preArr ? (dir === 'down' ? '延後' : '提前') : chk ? '已到' : '報到'}
                        </button>'''

new_f2 = '''                        <button
                          onClick={() => !memberExcluded && handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                          disabled={memberExcluded}
                          title={memberExcluded ? (volSelfReturn ? '義工車自行回程，從應到排除' : `已標記為${dir === 'down' ? '延後回程' : '提前出發'}，從應到排除`) : ''}
                          className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            memberExcluded
                              ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200'
                              : chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {memberExcluded ? (volSelfReturn ? '義工' : dir === 'down' ? '延後' : '提前') : chk ? '已到' : '報到'}
                        </button>'''

ch = replace_once(ch, old_f2, new_f2, 'F2: mode=small_car button 用 memberExcluded')

# ─── G. mode='head' 小車展開 row 同上 ──
old_g = '''                            {sorted.map(member => {
                              const name  = getMemberName(member)
                              const guest = isGuest(member)
                              const chk   = isCheckedIn(member)
                              const preArr = headDirection === 'down'
                                ? getEffectiveLateReturn(member, c, dateEnd)
                                : getEffectivePreArrive(member, c, dateStart)
                              const preArrCls = headDirection === 'down'
                                ? 'bg-amber-100 text-amber-700 border-amber-200'
                                : 'bg-teal-100 text-teal-700 border-teal-200'
                              const isLeader = innerLeaderRegIds.includes(member.registration_id)
                              const cls   = formatMemberClasses(member)'''

new_g = '''                            {sorted.map(member => {
                              const name  = getMemberName(member)
                              const guest = isGuest(member)
                              const chkRaw = isCheckedIn(member)
                              const preArr = headDirection === 'down'
                                ? getEffectiveLateReturn(member, c, dateEnd)
                                : getEffectivePreArrive(member, c, dateStart)
                              const memberExcluded = !!preArr || integratedExcluded
                              const chk    = chkRaw && !memberExcluded
                              const preArrCls = headDirection === 'down'
                                ? 'bg-amber-100 text-amber-700 border-amber-200'
                                : 'bg-teal-100 text-teal-700 border-teal-200'
                              const isLeader = innerLeaderRegIds.includes(member.registration_id)
                              const cls   = formatMemberClasses(member)'''

ch = replace_once(ch, old_g, new_g, 'G: mode=head 小車展開 row chk 視覺')

old_g2 = '''                                  <button
                                    onClick={() => !preArr && handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                                    disabled={!!preArr}
                                    title={preArr ? `已標記為${headDirection === 'down' ? '延後回程' : '提前出發'}，從應到排除` : ''}
                                    className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                      preArr
                                        ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200'
                                        : chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                                    }`}
                                  >
                                    {preArr ? (headDirection === 'down' ? '延後' : '提前') : chk ? '已到' : '報到'}
                                  </button>'''

new_g2 = '''                                  <button
                                    onClick={() => !memberExcluded && handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                                    disabled={memberExcluded}
                                    title={memberExcluded ? (volSelfReturn ? '義工車自行回程，從應到排除' : `已標記為${headDirection === 'down' ? '延後回程' : '提前出發'}，從應到排除`) : ''}
                                    className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                      memberExcluded
                                        ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200'
                                        : chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                                    }`}
                                  >
                                    {memberExcluded ? (volSelfReturn ? '義工' : headDirection === 'down' ? '延後' : '提前') : chk ? '已到' : '報到'}
                                  </button>'''

ch = replace_once(ch, old_g2, new_g2, 'G2: mode=head 小車展開 button 用 memberExcluded')

CH.write_text(ch, encoding='utf-8')
print(f'[WROTE] {CH} ({len(ch)} bytes)')
