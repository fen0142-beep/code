# -*- coding: utf-8 -*-
# 一次性 patch script — 2026-05-22 二度
# 改動：
#   1. 小車自開車主司機 UI 強化（紅框 + banner）
#   2. 即時看板大小車含法師 + 修 car_monks bug
#   3. 法師指派大小車跨車互斥
#   4. 下山延後回程鎖定 toggle（含上山對稱）

import re
from pathlib import Path

ROOT = Path(__file__).parent
CARRANGE = ROOT / 'src/pages/admin/CarrangementDetailPage.jsx'
CHECKIN  = ROOT / 'src/pages/CarCheckinPage.jsx'

# ─────────────────────────────────────────────────────────────
# Helper: replace_once - 確保只替換一次（重複 patch 防呆）
# ─────────────────────────────────────────────────────────────
def replace_once(text, old, new, label):
    cnt = text.count(old)
    if cnt == 0:
        # 已 patch 過或字串不存在 → 警示但不中斷（讓使用者檢查）
        print(f'[SKIP] {label}: 找不到 old_string（可能已 patch 過）')
        return text
    if cnt > 1:
        raise RuntimeError(f'[ERROR] {label}: old_string 出現 {cnt} 次，需要更精確的 context')
    print(f'[OK]   {label}')
    return text.replace(old, new, 1)

# ═════════════════════════════════════════════════════════════
# 1. CarrangementDetailPage.jsx
# ═════════════════════════════════════════════════════════════
text = CARRANGE.read_text(encoding='utf-8')

# ─── 1A. 在 toggleSmallCarMonk 後加 unassignMonk / assignMonkToLargeCar / assignMonkToSmallCar ──
old_1a = '''  // 切換小車法師指派（同方向一位法師只能在一個群組）
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
'''

new_1a = '''  // 切換小車法師指派（同方向一位法師只能在一個群組）
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
'''

text = replace_once(text, old_1a, new_1a, '1A: 新增跨大小車法師指派 helper')

# ─── 1B. 看板 statMonkCount bug + 加 smallMonkCount ──
old_1b = '''        {/* 統計卡片（依目前方向） */}
        {(() => {
          const statMonkCount = (carsByDir[direction] ?? []).reduce((s, c) => s + (c.car_monks?.length ?? 0), 0)
          return (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label={`搭精舍車（大車）— ${dirLabel(direction)}`}
            value={largePeople.length}
            color="bg-blue-50 border-blue-200 text-blue-700"
            sub={statMonkCount > 0 ? `含法師 ${statMonkCount} 人` : null}
          />
          <StatCard label={`小車（自行/共乘）— ${dirLabel(direction)}`} value={smallPeople.length} color="bg-green-50 border-green-200 text-green-700" />
          <StatCard
            label="其他/未填"
            value={regs.length - largePeople.length - smallPeople.length}
            color="bg-gray-50 border-gray-200 text-gray-600"
          />
        </div>
          )
        })()}
'''

new_1b = '''        {/* 統計卡片（依目前方向） */}
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
'''

text = replace_once(text, old_1b, new_1b, '1B: 統計卡片含法師（大+小）')

# ─── 1C. 大車法師按鈕：擴充判斷含小車 + 改 onClick ──
old_1c = '''                  {/* 法師指派（可選，不強制；一位法師同方向只能在一台車） */}
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
                  )}'''

new_1c = '''                  {/* 法師指派（可選，不強制；一位法師同方向只能在一台車 / 一台小車） */}
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
                  )}'''

text = replace_once(text, old_1c, new_1c, '1C: 大車法師按鈕加查小車')

# ─── 1D. 小車外層 div 加 needsDriverChoice 紅框 + banner ──
old_1d = '''              {finalSmallGroups.map((g, idx) => (
                <div key={g.key} className="bg-white border rounded-xl shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-gray-50 text-sm font-semibold text-gray-700">'''

new_1d = '''              {finalSmallGroups.map((g, idx) => (
                <div key={g.key} className={`bg-white rounded-xl shadow-sm overflow-hidden border ${g.needsDriverChoice ? 'border-2 border-red-400 ring-2 ring-red-100' : ''}`}>
                  {g.needsDriverChoice && (
                    <div className="px-4 py-2 bg-red-50 text-red-700 text-xs font-medium border-b border-red-200 flex items-center gap-2">
                      <span className="animate-pulse">⚠️</span>
                      <span>同車號有多位填了車號的「自行開車」乘客，請從下方下拉選單指定誰是主司機</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-gray-50 text-sm font-semibold text-gray-700">'''

text = replace_once(text, old_1d, new_1d, '1D: 小車卡片加 needsDriverChoice 紅框 banner')

# ─── 1E. 小車法師按鈕：擴充判斷含大車 + 改 onClick ──
old_1e = '''                    {/* 法師 */}
                    {allMonks.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-purple-600 font-medium shrink-0">🏯 法師：</span>
                        {allMonks.map(monk => {
                          const isHere = (smallCarMonksByDir[direction][g.key] ?? []).includes(monk.id)
                          const assignedGroupKey = Object.keys(smallCarMonksByDir[direction]).find(
                            k => (smallCarMonksByDir[direction][k] ?? []).includes(monk.id)
                          )
                          const assignedElsewhere = !!assignedGroupKey && assignedGroupKey !== g.key
                          const assignedGroup = assignedElsewhere
                            ? finalSmallGroups.findIndex(fg => fg.key === assignedGroupKey)
                            : -1
                          return (
                            <button
                              key={monk.id}
                              onClick={() => toggleSmallCarMonk(g.key, monk.id)}
                              title={assignedElsewhere ? `目前在小車 ${assignedGroup + 1}，點選搬過來` : ''}
                              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                                isHere
                                  ? 'bg-purple-600 text-white border-purple-600'
                                  : assignedElsewhere
                                  ? 'bg-gray-100 text-gray-400 border-gray-200 line-through hover:bg-purple-50 hover:text-purple-500 hover:border-purple-300 hover:no-underline'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-600'
                              }`}
                            >
                              {isHere && '✓ '}{monk.name}
                            </button>
                          )
                        })}
                      </div>
                    )}'''

new_1e = '''                    {/* 法師（跨大小車唯一性） */}
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
                    )}'''

text = replace_once(text, old_1e, new_1e, '1E: 小車法師按鈕加查大車')

CARRANGE.write_text(text, encoding='utf-8')
print(f'[WROTE] {CARRANGE} ({len(text)} bytes)')

# ═════════════════════════════════════════════════════════════
# 2. CarCheckinPage.jsx
# ═════════════════════════════════════════════════════════════
text = CHECKIN.read_text(encoding='utf-8')

# ─── 2A. mode='car' 大車領隊 sorted.map：ex 上提 + button disabled ──
old_2a = '''          {sorted.map(member => {
            const name       = getMemberName(member)
            const guest      = isGuest(member)
            const checked    = isCheckedIn(member)
            const isLeader   = (car.car_leaders ?? []).some(
              l => l.registration_id === member.registration_id
            )

            return (
              <div
                key={member.registration_id}
                className={`flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-sm border transition-opacity ${
                  checked ? 'border-green-200 opacity-60' : 'border-gray-200'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`font-medium truncate ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {name}
                    </span>
                    {isLeader && (
                      <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">
                        領隊
                      </span>
                    )}
                    {guest && (
                      <span className="text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 shrink-0">
                        訪客
                      </span>
                    )}
                    {(() => {
                      const dir = car.direction ?? 'down'
                      const ex  = dir === 'down'
                        ? getEffectiveLateReturn(member, car, dateEnd)
                        : getEffectivePreArrive(member, car, dateStart)
                      if (!ex) return null
                      const cls = dir === 'down'
                        ? 'bg-amber-100 text-amber-700 border-amber-200'
                        : 'bg-teal-100 text-teal-700 border-teal-200'
                      return <span className={`text-xs ${cls} border rounded-full px-1.5 shrink-0`}>{ex}</span>
                    })()}
                  </div>
                  {formatMemberClasses(member) && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {formatMemberClasses(member)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                  className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    checked
                      ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500'
                      : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                  }`}
                >
                  {checked ? '已到' : '報到'}
                </button>
              </div>
            )
          })}'''

new_2a = '''          {sorted.map(member => {
            const name       = getMemberName(member)
            const guest      = isGuest(member)
            const checked    = isCheckedIn(member)
            const isLeader   = (car.car_leaders ?? []).some(
              l => l.registration_id === member.registration_id
            )
            const dir = car.direction ?? 'down'
            const ex  = dir === 'down'
              ? getEffectiveLateReturn(member, car, dateEnd)
              : getEffectivePreArrive(member, car, dateStart)
            const exCls = dir === 'down'
              ? 'bg-amber-100 text-amber-700 border-amber-200'
              : 'bg-teal-100 text-teal-700 border-teal-200'
            const exLabel = dir === 'down' ? '延後回程' : '提前出發'

            return (
              <div
                key={member.registration_id}
                className={`flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-sm border transition-opacity ${
                  checked ? 'border-green-200 opacity-60' : 'border-gray-200'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`font-medium truncate ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {name}
                    </span>
                    {isLeader && (
                      <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 shrink-0">
                        領隊
                      </span>
                    )}
                    {guest && (
                      <span className="text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 shrink-0">
                        訪客
                      </span>
                    )}
                    {ex && <span className={`text-xs ${exCls} border rounded-full px-1.5 shrink-0`}>{ex}</span>}
                  </div>
                  {formatMemberClasses(member) && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {formatMemberClasses(member)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => !ex && handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                  disabled={!!ex}
                  title={ex ? `已標記為${exLabel}，從應到排除（如需手動處理，請至排車頁取消標記）` : ''}
                  className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    ex
                      ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200'
                      : checked
                        ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500'
                        : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                  }`}
                >
                  {ex ? exLabel : checked ? '已到' : '報到'}
                </button>
              </div>
            )
          })}'''

text = replace_once(text, old_2a, new_2a, '2A: mode=car 學員 toggle 鎖')

# ─── 2B. mode='small_car' 小車領隊 sorted.map button disabled ──
old_2b = '''                        <button
                          onClick={() => handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                          className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {chk ? '已到' : '報到'}
                        </button>'''

new_2b = '''                        <button
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

text = replace_once(text, old_2b, new_2b, '2B: mode=small_car 學員 toggle 鎖')

# ─── 2C. mode='head' 大車展開 sorted.map：ex 上提 + button disabled ──
old_2c = '''                    {sorted.map(member => {
                      const name     = getMemberName(member)
                      const guest    = isGuest(member)
                      const chk      = isCheckedIn(member)
                      const isLeader = (c.car_leaders ?? []).some(l => l.registration_id === member.registration_id)
                      const cls      = formatMemberClasses(member)
                      return (
                        <div key={member.registration_id} className={`flex items-center gap-3 px-4 py-2.5 ${chk ? 'opacity-55' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-sm truncate ${chk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>{name}</span>
                              {isLeader && <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-1.5 shrink-0">領隊</span>}
                              {guest    && <span className="text-xs bg-blue-100  text-blue-600  rounded-full px-1.5 shrink-0">訪客</span>}
                              {(() => {
                                const ex = headDirection === 'down'
                                  ? getEffectiveLateReturn(member, c, dateEnd)
                                  : getEffectivePreArrive(member, c, dateStart)
                                if (!ex) return null
                                const cls = headDirection === 'down'
                                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                                  : 'bg-teal-100 text-teal-700 border-teal-200'
                                return <span className={`text-xs ${cls} border rounded-full px-1.5 shrink-0`}>{ex}</span>
                              })()}
                            </div>
                            {cls && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{cls}</div>}
                          </div>
                          <button
                            onClick={() => handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                            className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                          >
                            {chk ? '已到' : '報到'}
                          </button>
                        </div>
                      )
                    })}'''

new_2c = '''                    {sorted.map(member => {
                      const name     = getMemberName(member)
                      const guest    = isGuest(member)
                      const chk      = isCheckedIn(member)
                      const isLeader = (c.car_leaders ?? []).some(l => l.registration_id === member.registration_id)
                      const cls      = formatMemberClasses(member)
                      const ex = headDirection === 'down'
                        ? getEffectiveLateReturn(member, c, dateEnd)
                        : getEffectivePreArrive(member, c, dateStart)
                      const exCls = headDirection === 'down'
                        ? 'bg-amber-100 text-amber-700 border-amber-200'
                        : 'bg-teal-100 text-teal-700 border-teal-200'
                      const exLabel = headDirection === 'down' ? '延後回程' : '提前出發'
                      return (
                        <div key={member.registration_id} className={`flex items-center gap-3 px-4 py-2.5 ${chk ? 'opacity-55' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-sm truncate ${chk ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}`}>{name}</span>
                              {isLeader && <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-1.5 shrink-0">領隊</span>}
                              {guest    && <span className="text-xs bg-blue-100  text-blue-600  rounded-full px-1.5 shrink-0">訪客</span>}
                              {ex && <span className={`text-xs ${exCls} border rounded-full px-1.5 shrink-0`}>{ex}</span>}
                            </div>
                            {cls && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{cls}</div>}
                          </div>
                          <button
                            onClick={() => !ex && handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                            disabled={!!ex}
                            title={ex ? `已標記為${exLabel}，從應到排除` : ''}
                            className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              ex
                                ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200'
                                : chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                          >
                            {ex ? exLabel : chk ? '已到' : '報到'}
                          </button>
                        </div>
                      )
                    })}'''

text = replace_once(text, old_2c, new_2c, '2C: mode=head 大車展開 學員 toggle 鎖')

# ─── 2D. mode='head' 小車展開 sorted.map button disabled（preArr 已上層） ──
old_2d = '''                                  <button
                                    onClick={() => handleToggleCheckin(member.registration_id, member.registrations?.checked_in_at)}
                                    className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                      chk ? 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white hover:bg-green-700'
                                    }`}
                                  >
                                    {chk ? '已到' : '報到'}
                                  </button>'''

new_2d = '''                                  <button
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

text = replace_once(text, old_2d, new_2d, '2D: mode=head 小車展開 學員 toggle 鎖')

CHECKIN.write_text(text, encoding='utf-8')
print(f'[WROTE] {CHECKIN} ({len(text)} bytes)')

print('\n[DONE] All patches applied. Run `git diff` to review.')
