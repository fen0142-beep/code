#!/usr/bin/env python3
"""一次性套用 Batch 2 看板邏輯改動到 CarCheckinPage.jsx
- 避開 Edit 工具截斷風險
- 跑完用 esbuild parse 驗證
"""
import sys, pathlib

src = pathlib.Path('src/pages/CarCheckinPage.jsx')
text = src.read_text(encoding='utf-8')
orig_len = len(text)

def replace_once(old, new, label):
    global text
    cnt = text.count(old)
    if cnt != 1:
        print(f"ERR [{label}]: expected 1 match, got {cnt}")
        sys.exit(1)
    text = text.replace(old, new, 1)
    print(f"OK  [{label}]")

# ─── Change 1: car mode 自動報到掃描限定 up 方向 ───
replace_once(
    """      const dateStart = carInfo.car.events?.date_start
      const autoChecked = getAutoCheckedSet(token)
      const toAutoCheck = carInfo.linkedCars.flatMap(c =>
        (c.car_members ?? []).filter(m =>
          !m.registrations?.checked_in_at &&
          getEffectivePreArrive(m, c, dateStart) &&
          !autoChecked.has(m.registration_id)
        )
      )""",
    """      const dateStart = carInfo.car.events?.date_start
      const autoChecked = getAutoCheckedSet(token)
      // 提前上山自動勾：只對「上山」方向適用（下山不該被自動勾，延後者另計）
      const toAutoCheck = carInfo.linkedCars.flatMap(c => {
        if ((c.direction ?? 'down') !== 'up') return []
        return (c.car_members ?? []).filter(m =>
          !m.registrations?.checked_in_at &&
          getEffectivePreArrive(m, c, dateStart) &&
          !autoChecked.has(m.registration_id)
        )
      })""",
    "car-mode auto-check 限定 up"
)

# ─── Change 2: head mode 自動報到掃描限定 up 方向 ───
replace_once(
    """      const dateStart = hlRes.headLeader.events?.date_start
      const autoChecked = getAutoCheckedSet(token)
      const toAutoCheck = (cars ?? []).flatMap(c =>
        (c.car_members ?? []).filter(m =>
          !m.registrations?.checked_in_at &&
          getEffectivePreArrive(m, c, dateStart) &&
          !autoChecked.has(m.registration_id)
        )
      )""",
    """      const dateStart = hlRes.headLeader.events?.date_start
      const autoChecked = getAutoCheckedSet(token)
      // 提前上山自動勾：只對「上山」方向適用
      const toAutoCheck = (cars ?? []).flatMap(c => {
        if ((c.direction ?? 'down') !== 'up') return []
        return (c.car_members ?? []).filter(m =>
          !m.registrations?.checked_in_at &&
          getEffectivePreArrive(m, c, dateStart) &&
          !autoChecked.has(m.registration_id)
        )
      })""",
    "head-mode auto-check 限定 up"
)

# ─── Change 3: car mode 加 dateEnd 變數（render 區） ───
# 用獨特 context: render 區的 `const dateStart     = car.events?.date_start`
# helper 內的 dateStart 是 `const dateStart = carInfo.car.events?.date_start`（沒對齊空格）
replace_once(
    """    const dateStart     = car.events?.date_start
""",
    """    const dateStart     = car.events?.date_start
    const dateEnd       = car.events?.date_end
""",
    "car-mode render 加 dateEnd"
)

# ─── Change 4: car mode 成員列 badge（依 car.direction 分流） ───
replace_once(
    """                    {getEffectivePreArrive(member, car, dateStart) && (
                      <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">
                        {getEffectivePreArrive(member, car, dateStart)}
                      </span>
                    )}""",
    """                    {(() => {
                      const dir = car.direction ?? 'down'
                      const ex  = dir === 'down'
                        ? getEffectiveLateReturn(member, car, dateEnd)
                        : getEffectivePreArrive(member, car, dateStart)
                      if (!ex) return null
                      const cls = dir === 'down'
                        ? 'bg-amber-100 text-amber-700 border-amber-200'
                        : 'bg-teal-100 text-teal-700 border-teal-200'
                      return <span className={`text-xs ${cls} border rounded-full px-1.5 shrink-0`}>{ex}</span>
                    })()}""",
    "car-mode badge 依方向"
)

# ─── Change 5: small_car mode 加 dateEnd + badge 依方向 ───
replace_once(
    """  if (mode === 'small_car') {
    const eventName  = headLeader?.events?.name ?? ''
    const dateStart  = headLeader?.events?.date_start
""",
    """  if (mode === 'small_car') {
    const eventName  = headLeader?.events?.name ?? ''
    const dateStart  = headLeader?.events?.date_start
    const dateEnd    = headLeader?.events?.date_end
""",
    "small_car-mode 加 dateEnd"
)

replace_once(
    """                    const preArr = getEffectivePreArrive(member, c, dateStart)""",
    """                    const dir    = c.direction ?? 'down'
                    const preArr = dir === 'down'
                      ? getEffectiveLateReturn(member, c, dateEnd)
                      : getEffectivePreArrive(member, c, dateStart)
                    const preArrCls = dir === 'down'
                      ? 'bg-amber-100 text-amber-700 border-amber-200'
                      : 'bg-teal-100 text-teal-700 border-teal-200'""",
    "small_car-mode preArr 依方向"
)

replace_once(
    """                            {preArr && <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">{preArr}</span>}
                          </div>
                          {cls && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{cls}</div>}
                        </div>
                        <button
                          onClick={() => handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}""",
    """                            {preArr && <span className={`text-xs ${preArrCls} border rounded-full px-1.5 shrink-0`}>{preArr}</span>}
                          </div>
                          {cls && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{cls}</div>}
                        </div>
                        <button
                          onClick={() => handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}""",
    "small_car-mode badge class 套 preArrCls"
)

# ─── Change 6: head mode 應到計算完全重寫 (line 834-888) ───
replace_once(
    """    // 應到 = 當天搭車出發的人（排除提前出發），法師一律算
    // 上山：比 date_start 早算提前；下山：比 date_end 早算提前
    // 小車：同車有人提前 → 全車視為提前（用 getEffectivePreArrive）
    // 小車勾選 pre_depart → 整車排除應到
    // 上山：個人提前抵達 or 整車 pre_depart；下山：只看整車 pre_depart（已提前回山）
    const isPreArrived = (m, c) =>
      headDirection === 'down'
        ? c.pre_depart
        : (c.pre_depart || !!getEffectivePreArrive(m, c, dateStart))
    const todayMembers  = carsInDir.flatMap(c => (c.car_members ?? []).filter(m => !isPreArrived(m, c)))

    // 「其他交通」：本方向不歸大車也不歸小車的人，排除提前出發
    // 用 car_members 已存在的 registration_id 排除，避免重複計算（保險作法）
    const carMemberRegIds = new Set(carsInDir.flatMap(c => (c.car_members ?? []).map(m => m.registration_id)))
    const otherRegsInDir = allEventRegs.filter(r =>
      isOtherTransport(r, headDirection) &&
      (headDirection === 'down' || !getPreArriveInfo(r.answers, dateStart)) &&
      !carMemberRegIds.has(r.registration_id)
    )
    const otherTotal   = otherRegsInDir.length
    // 義工：預設已報到（不需刷卡），信眾：需實際 checked_in_at
    const otherChecked = otherRegsInDir.filter(r =>
      r.answers?.identity === '義工' || !!r.checked_in_at
    ).length

    const totalAll      = todayMembers.length + monkTotalAll + otherTotal
    const checkedAll    = todayMembers.filter(isCheckedIn).length + monkCheckedAll + otherChecked
    const uncheckedAll  = totalAll - checkedAll

    // 小車計數：排除 pre_depart 的車（已提前出發，不算今天應到）
    const smallCarsToday = smallCars.filter(c => !c.pre_depart)
    const smallTotal   = smallCarsToday.reduce((s, c) => s + (c.car_members?.length ?? 0), 0)
    const smallChecked = smallCarsToday.reduce((s, c) => s + (c.car_members?.filter(isCheckedIn).length ?? 0), 0)

    // 「回報聯絡組資訊」統計（上下山皆顯示）
    // 法師：已點報到的法師（= monkCheckedAll，當日方向）
    // 義工/信眾：提前出發（整車 pre_depart / 上山個人 preArrive）OR 當日已報到
    const confirmedRegIds = new Set()
    for (const c of carsInDir) {
      if (c.pre_depart) {
        for (const m of (c.car_members ?? [])) confirmedRegIds.add(m.registration_id)
      } else if (headDirection === 'up') {
        for (const m of (c.car_members ?? [])) {
          if (getEffectivePreArrive(m, c, dateStart)) confirmedRegIds.add(m.registration_id)
        }
      }
    }
    const reportCounts = { 法師: monkCheckedAll, 義工: 0, 信眾: 0 }
    for (const r of allEventRegs) {
      const id = r.answers?.identity
      if (id !== '義工' && id !== '信眾') continue
      if (!r.checked_in_at && !confirmedRegIds.has(r.registration_id)) continue
      if (id === '義工') reportCounts.義工 += 1
      else reportCounts.信眾 += 1
    }""",
    """    // 應到 = 當天搭車出發/回程的人（排除提前/延後），法師一律算
    // 上山方向：c.pre_depart（整車提前）OR 個人/同車 getEffectivePreArrive
    // 下山方向：c.late_return（整車延後）OR 個人/同車 getEffectiveLateReturn
    const isExcludedFromExpected = (m, c) => {
      if (headDirection === 'down') {
        return !!c.late_return || !!getEffectiveLateReturn(m, c, dateEnd)
      }
      return !!c.pre_depart || !!getEffectivePreArrive(m, c, dateStart)
    }
    const todayMembers  = carsInDir.flatMap(c => (c.car_members ?? []).filter(m => !isExcludedFromExpected(m, c)))

    // 「其他交通」：本方向不歸大車也不歸小車的人
    // 應到（otherRegsInDir）= 排除提前/延後（個人 override + 自動判別）
    // 已排除的人（otherExcluded）：UI 仍顯示但加 badge，不算入應到
    const carMemberRegIds = new Set(carsInDir.flatMap(c => (c.car_members ?? []).map(m => m.registration_id)))
    const isOtherExcluded = (r) => {
      if (headDirection === 'down') {
        if (r.late_return_override) return true
        return !!getLateReturnInfo(r.answers, dateEnd)
      }
      if (r.pre_depart_override) return true
      return !!getPreArriveInfo(r.answers, dateStart)
    }
    const otherAllInDir = allEventRegs.filter(r =>
      isOtherTransport(r, headDirection) &&
      !carMemberRegIds.has(r.registration_id)
    )
    const otherRegsInDir = otherAllInDir.filter(r => !isOtherExcluded(r))
    const otherExcluded  = otherAllInDir.filter(isOtherExcluded)
    const otherTotal   = otherRegsInDir.length
    // 義工：預設已報到（不需刷卡），信眾：需實際 checked_in_at
    const otherChecked = otherRegsInDir.filter(r =>
      r.answers?.identity === '義工' || !!r.checked_in_at
    ).length

    const totalAll      = todayMembers.length + monkTotalAll + otherTotal
    const checkedAll    = todayMembers.filter(isCheckedIn).length + monkCheckedAll + otherChecked
    const uncheckedAll  = totalAll - checkedAll

    // 小車計數：排除整車提前（上山 pre_depart）/ 延後（下山 late_return）
    //         + 個人/同車 effective 提前/延後
    const smallCarsToday = smallCars.filter(c =>
      headDirection === 'down' ? !c.late_return : !c.pre_depart
    )
    const smallTotal   = smallCarsToday.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedFromExpected(m, c)).length ?? 0), 0
    )
    const smallChecked = smallCarsToday.reduce((s, c) =>
      s + (c.car_members?.filter(m => !isExcludedFromExpected(m, c) && isCheckedIn(m)).length ?? 0), 0
    )

    // 「回報聯絡組資訊」統計（上下山皆顯示）
    // 法師：已點報到的法師（= monkCheckedAll，當日方向）
    // 義工/信眾：提前/延後（整車 + 個人/同車 effective + 其他交通 override）OR 當日已報到
    const confirmedRegIds = new Set()
    for (const c of carsInDir) {
      const carWideExcluded = headDirection === 'down' ? c.late_return : c.pre_depart
      if (carWideExcluded) {
        for (const m of (c.car_members ?? [])) confirmedRegIds.add(m.registration_id)
      } else {
        for (const m of (c.car_members ?? [])) {
          if (isExcludedFromExpected(m, c)) confirmedRegIds.add(m.registration_id)
        }
      }
    }
    // 其他交通的提前/延後也算「已確認」（不來當天）
    for (const r of otherExcluded) confirmedRegIds.add(r.registration_id)
    const reportCounts = { 法師: monkCheckedAll, 義工: 0, 信眾: 0 }
    for (const r of allEventRegs) {
      const id = r.answers?.identity
      if (id !== '義工' && id !== '信眾') continue
      if (!r.checked_in_at && !confirmedRegIds.has(r.registration_id)) continue
      if (id === '義工') reportCounts.義工 += 1
      else reportCounts.信眾 += 1
    }""",
    "head-mode 應到計算 + 其他交通 + reportCounts 重寫"
)

# ─── Change 7: head mode 大車 carToday + 成員列 badge 依方向 ───
replace_once(
    """            const carToday  = (c.car_members ?? []).filter(m => !isPreArrived(m, c))""",
    """            const carToday  = (c.car_members ?? []).filter(m => !isExcludedFromExpected(m, c))""",
    "head-mode 大車 carToday 使用新函數"
)

replace_once(
    """                              {headDirection === 'up' && getEffectivePreArrive(member, c, dateStart) && (
                                <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">
                                  {getEffectivePreArrive(member, c, dateStart)}
                                </span>
                              )}""",
    """                              {(() => {
                                const ex = headDirection === 'down'
                                  ? getEffectiveLateReturn(member, c, dateEnd)
                                  : getEffectivePreArrive(member, c, dateStart)
                                if (!ex) return null
                                const cls = headDirection === 'down'
                                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                                  : 'bg-teal-100 text-teal-700 border-teal-200'
                                return <span className={`text-xs ${cls} border rounded-full px-1.5 shrink-0`}>{ex}</span>
                              })()}""",
    "head-mode 大車展開 badge 依方向"
)

# ─── Change 8: head mode 小車卡片摘要列依方向顯示 pre_depart/late_return badge ───
replace_once(
    """                              {c.pre_depart && <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">🚀 提前出發</span>}
                              {done && !c.pre_depart && <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5">全員出發 ✓</span>}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {c.pre_depart ? '（已提前出發，不列入今日應到）' : `應到 ${total}　已到 ${checked}　未到 ${unchecked}`}
                            </div>""",
    """                              {headDirection === 'up' && c.pre_depart && (
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
                            </div>""",
    "head-mode 小車卡片 pre_depart/late_return badge"
)

# ─── Change 9: head mode 小車展開內成員 badge 依方向 ───
replace_once(
    """                              const preArr = headDirection === 'up' ? getEffectivePreArrive(member, c, dateStart) : null""",
    """                              const preArr = headDirection === 'down'
                                ? getEffectiveLateReturn(member, c, dateEnd)
                                : getEffectivePreArrive(member, c, dateStart)
                              const preArrCls = headDirection === 'down'
                                ? 'bg-amber-100 text-amber-700 border-amber-200'
                                : 'bg-teal-100 text-teal-700 border-teal-200'""",
    "head-mode 小車展開內 preArr 依方向"
)

replace_once(
    """                                      {preArr && <span className="text-xs bg-teal-100 text-teal-700 border border-teal-200 rounded-full px-1.5 shrink-0">{preArr}</span>}""",
    """                                      {preArr && <span className={`text-xs ${preArrCls} border rounded-full px-1.5 shrink-0`}>{preArr}</span>}""",
    "head-mode 小車展開 badge class 套 preArrCls"
)

# ─── Change 10: 其他交通卡片裡列出已排除的人（顯示但不算入應到） ───
# 目前 otherRegsInDir 只放未排除的，UI 不變即可；otherExcluded 留給未來如有需要再用
# 此 patch 不動 UI（保持其他交通卡片邏輯）

# ─── Change 11: 其他交通卡片裡每位顯示對應 badge（已排除的人） ───
# 「其他交通」當前 UI 用 sortCheckinMembers(otherRegsInDir.map(regAsMember))，所有人都會列出
# 但 otherRegsInDir 已過濾掉 excluded，這樣 excluded 不會出現 → 跟原本上山一致
# 「下山方向」過去 UI 全列出（不過濾），現在統一過濾 → 算回歸對稱
# OK 此 patch 不額外做事

# Write back
src.write_text(text, encoding='utf-8')
new_len = len(text)
print(f"\nDONE: {orig_len} -> {new_len} bytes (+{new_len - orig_len})")
