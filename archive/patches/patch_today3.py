# -*- coding: utf-8 -*-
# 補丁 #3 — 2026-05-22 三度
# 修：小車看板沒顯示法師 + 應到計算漏算法師
#
# A. supabase.js: getAllSmallCarsProgress SELECT 加 car_monks
# B. CarCheckinPage.jsx:
#    B1. mode='head' 小車摘要 smallTotal/smallChecked 加法師
#    B2. mode='head' 小車展開單車 total/checked 加法師
#    B3. mode='head' 小車展開渲染法師 row（類似大車 1037-1058）
#    B4. mode='small_car' totalAll/checkedAll 加法師
#    B5. mode='small_car' 單車 total/checked 加法師
#    B6. mode='small_car' 渲染法師 row

from pathlib import Path

ROOT = Path(__file__).parent
SB = ROOT / 'src/lib/supabase.js'
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


# ─── A. supabase.js getAllSmallCarsProgress 加 car_monks ──
sb = SB.read_text(encoding='utf-8')

old_a = '''export async function getAllSmallCarsProgress(eventId) {
  const { data, error } = await supabase
    .from('car_assignments')
    .select(`
      car_id, car_name, seats, sort_order, car_type, direction, pre_depart, late_return,
      car_leaders ( registration_id ),
      car_members (
        registration_id,
        registrations (
          registration_id, answers, checked_in_at, student_id, pre_depart_override, late_return_override,
          students!student_id ( name, student_classes ( class_name, group_name ) )
        )
      )
    `)
    .eq('event_id', eventId)
    .eq('car_type', 'small')
    .order('sort_order', { ascending: true })'''

new_a = '''export async function getAllSmallCarsProgress(eventId) {
  const { data, error } = await supabase
    .from('car_assignments')
    .select(`
      car_id, car_name, seats, sort_order, car_type, direction, pre_depart, late_return,
      car_leaders ( registration_id ),
      car_members (
        registration_id,
        registrations (
          registration_id, answers, checked_in_at, student_id, pre_depart_override, late_return_override,
          students!student_id ( name, student_classes ( class_name, group_name ) )
        )
      ),
      car_monks ( id, monk_id, checked_in_at, temple_monks ( name ) )
    `)
    .eq('event_id', eventId)
    .eq('car_type', 'small')
    .order('sort_order', { ascending: true })'''

sb = replace_once(sb, old_a, new_a, 'A: getAllSmallCarsProgress 加 car_monks')
SB.write_text(sb, encoding='utf-8')
print(f'[WROTE] {SB} ({len(sb)} bytes)')

# ─── B. CarCheckinPage.jsx ──
ch = CH.read_text(encoding='utf-8')

# B1. mode='head' 小車摘要 smallTotal/smallChecked 加法師
old_b1 = '''    const smallTotal   = smallCarsToday.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedFromExpected(m, c)).length ?? 0), 0
    )
    const smallChecked = smallCarsToday.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedFromExpected(m, c) && isCheckedIn(m)).length ?? 0), 0
    )'''

new_b1 = '''    const smallTotal   = smallCarsToday.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedFromExpected(m, c)).length ?? 0)
        + (c.car_monks?.length ?? 0), 0
    )
    const smallChecked = smallCarsToday.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedFromExpected(m, c) && isCheckedIn(m)).length ?? 0)
        + (c.car_monks?.filter(cm => !!cm.checked_in_at).length ?? 0), 0
    )'''

ch = replace_once(ch, old_b1, new_b1, 'B1: mode=head 小車摘要含法師')

# B2. mode='head' 小車展開單車 total/checked/done 加法師
old_b2 = '''              {expandedCarId === '__small__' && (
                <div className="border-t divide-y">
                  {smallCars.map(c => {
                    // 排除延後/提前者（與外層摘要一致）
                    const todayMembers = (c.car_members ?? []).filter(m => !isExcludedFromExpected(m, c))
                    const total     = todayMembers.length
                    const checked   = todayMembers.filter(isCheckedIn).length
                    const unchecked = total - checked
                    const done      = checked === total && total > 0'''

new_b2 = '''              {expandedCarId === '__small__' && (
                <div className="border-t divide-y">
                  {smallCars.map(c => {
                    // 排除延後/提前者（與外層摘要一致）
                    const todayMembers = (c.car_members ?? []).filter(m => !isExcludedFromExpected(m, c))
                    const monkCnt      = (c.car_monks ?? []).length
                    const monkChecked  = (c.car_monks ?? []).filter(cm => !!cm.checked_in_at).length
                    const total     = todayMembers.length + monkCnt
                    const checked   = todayMembers.filter(isCheckedIn).length + monkChecked
                    const unchecked = total - checked
                    const done      = checked === total && total > 0'''

ch = replace_once(ch, old_b2, new_b2, 'B2: mode=head 小車展開單車含法師')

# B3. mode='head' 小車展開區渲染法師 row
# 在 `{innerExp && (\n  <div className="bg-white border-t divide-y">` 之後插入法師 map
old_b3 = '''                        {innerExp && (
                          <div className="bg-white border-t divide-y">
                            {sorted.map(member => {
                              const name  = getMemberName(member)
                              const guest = isGuest(member)
                              const chk   = isCheckedIn(member)
                              const preArr = headDirection === 'down'
                                ? getEffectiveLateReturn(member, c, dateEnd)
                                : getEffectivePreArrive(member, c, dateStart)'''

new_b3 = '''                        {innerExp && (
                          <div className="bg-white border-t divide-y">
                            {/* 法師（排最上面，紫色強調） */}
                            {(c.car_monks ?? []).map(cm => {
                              const mchk = !!cm.checked_in_at
                              return (
                                <div key={cm.id} className={`flex items-center gap-3 px-5 py-2.5 bg-purple-50/40 ${mchk ? 'opacity-55' : ''}`}>
                                  <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-sm truncate ${mchk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>
                                      {cm.temple_monks?.name ?? '（未知）'}
                                    </span>
                                    <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-1.5 shrink-0">法師</span>
                                  </div>
                                  <button
                                    onClick={() => handleToggleMonkCheckin(cm.id, cm.checked_in_at)}
                                    className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                      mchk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                                    }`}
                                  >
                                    {mchk ? '已到' : '報到'}
                                  </button>
                                </div>
                              )
                            })}
                            {sorted.map(member => {
                              const name  = getMemberName(member)
                              const guest = isGuest(member)
                              const chk   = isCheckedIn(member)
                              const preArr = headDirection === 'down'
                                ? getEffectiveLateReturn(member, c, dateEnd)
                                : getEffectivePreArrive(member, c, dateStart)'''

ch = replace_once(ch, old_b3, new_b3, 'B3: mode=head 小車展開渲染法師')

# B4. mode='small_car' totalAll/checkedAll 加法師
old_b4 = '''    const totalAll   = activeCars.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedHere(m, c)).length ?? 0), 0
    )
    const checkedAll = activeCars.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedHere(m, c) && isCheckedIn(m)).length ?? 0), 0
    )'''

new_b4 = '''    const totalAll   = activeCars.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedHere(m, c)).length ?? 0)
        + (c.car_monks?.length ?? 0), 0
    )
    const checkedAll = activeCars.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedHere(m, c) && isCheckedIn(m)).length ?? 0)
        + (c.car_monks?.filter(cm => !!cm.checked_in_at).length ?? 0), 0
    )'''

ch = replace_once(ch, old_b4, new_b4, 'B4: mode=small_car 頭部計數含法師')

# B5. mode='small_car' 單車 total/checked/done 加法師
old_b5 = '''        {/* 各小車卡片 */}
        <div className="px-4 pt-3 max-w-lg mx-auto space-y-3">
          {allCars.map(c => {
            const members  = c.car_members ?? []
            // 排除延後/提前者
            const todayMembers = members.filter(m => !isExcludedHere(m, c))
            const total    = todayMembers.length
            const checked  = todayMembers.filter(isCheckedIn).length
            const unchecked = total - checked
            const done     = checked === total && total > 0'''

new_b5 = '''        {/* 各小車卡片 */}
        <div className="px-4 pt-3 max-w-lg mx-auto space-y-3">
          {allCars.map(c => {
            const members  = c.car_members ?? []
            // 排除延後/提前者
            const todayMembers = members.filter(m => !isExcludedHere(m, c))
            const monkCnt     = (c.car_monks ?? []).length
            const monkChecked = (c.car_monks ?? []).filter(cm => !!cm.checked_in_at).length
            const total    = todayMembers.length + monkCnt
            const checked  = todayMembers.filter(isCheckedIn).length + monkChecked
            const unchecked = total - checked
            const done     = checked === total && total > 0'''

ch = replace_once(ch, old_b5, new_b5, 'B5: mode=small_car 單車含法師')

# B6. mode='small_car' 渲染法師 row（在 divide-y 內成員 map 之前）
old_b6 = '''                {/* 成員清單（常駐顯示，不需展開） */}
                <div className="divide-y">
                  {sortCheckinMembers(members, (c.car_leaders ?? []).map(l => l.registration_id)).map(member => {'''

new_b6 = '''                {/* 成員清單（常駐顯示，不需展開） */}
                <div className="divide-y">
                  {/* 法師（排最上面，紫色強調） */}
                  {(c.car_monks ?? []).map(cm => {
                    const mchk = !!cm.checked_in_at
                    return (
                      <div key={cm.id} className={`flex items-center gap-3 px-4 py-2.5 bg-purple-50/40 ${mchk ? 'opacity-50' : ''}`}>
                        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                          <span className={`text-sm ${mchk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>
                            {cm.temple_monks?.name ?? '（未知）'}
                          </span>
                          <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-1.5 shrink-0">法師</span>
                        </div>
                        <button
                          onClick={() => handleToggleMonkCheckin(cm.id, cm.checked_in_at)}
                          className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            mchk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {mchk ? '已到' : '報到'}
                        </button>
                      </div>
                    )
                  })}
                  {sortCheckinMembers(members, (c.car_leaders ?? []).map(l => l.registration_id)).map(member => {'''

ch = replace_once(ch, old_b6, new_b6, 'B6: mode=small_car 渲染法師')

CH.write_text(ch, encoding='utf-8')
print(f'[WROTE] {CH} ({len(ch)} bytes)')
