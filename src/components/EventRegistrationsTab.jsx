import { recordExportTime } from '../lib/supabase'
import {
  formatFieldValue, getDisplayName,
  timePeriodLabel, formatSessionTabLabel,
  resolveSessionAns, exportSessionCSV,
  SortTh, exportCSV,
  parkingKindOf,
  computeDashboardStats,
  computeTempleStats, computeGenericRadioStats,
} from '../lib/eventDetailHelpers'
import {
  sessionFieldsForPeriod,
  formatSessionAnswer,
  computeMultiSessionStats,
} from '../lib/registrationHelpers'

export default function EventRegistrationsTab({ event, setEvent, id, sessions, sessionTab, setSessionTab, registrations, sessionFilteredRegistrations, lastExported, totalChangeSince, newRegIds, modifiedRegIds, cancelledChangesSince, sessionFields, showSessionStatsDetail, setShowSessionStatsDetail, fields, listSearch, setListSearch, searchedRegistrations, sortedRegistrations, isAdmin, hasGuests, selectedGuestIds, allGuestsSelected, toggleSelectAllGuests, toggleGuestSelect, showCheckin, setShowCheckin, showRegTime, setShowRegTime, pinnedFieldKeys, isVolunteerField, isUpField, isDownField, hiddenFieldKeys, toggleFieldGroup, toggleFieldKey, sortKey, sortDir, handleSort, setBatchPrintOpen, setStudentModal, setGuestModal, changes, setDiffModal, effectiveCheckinAt, handleUncheckIn, setEditingReg, handleDeleteRegistration, showCancelled, setShowCancelled, cancelledChanges, setQrModal }) {
  return (
<div>
      {/* 多場次：場次切換 tabs */}
      {event?.multi_session && sessions.length > 0 && (
        <div className="flex gap-1.5 mb-4 flex-wrap items-center border-b border-gray-100 pb-3">
          {sessions.map(s => {
            const cnt = registrations.filter(r =>
              r.answers?.sessions?.some(ss => ss.session_id === s.session_id)
            ).length
            return (
              <button
                key={s.session_id}
                onClick={() => setSessionTab(s.session_id)}
                title={s.dharma_name ?? ''}
                className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                  sessionTab === s.session_id
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
              >
                {formatSessionTabLabel(s)}（{cnt}）
              </button>
            )
          })}
        </div>
      )}

      {/* 當前場次資訊 banner */}
      {event?.multi_session && sessionTab !== 'all' && (() => {
        const curS = sessions.find(s => s.session_id === sessionTab)
        if (!curS) return null
        return (
          <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
            <span className="text-amber-500 text-lg">🪷</span>
            <div className="text-sm">
              <span className="font-semibold text-amber-800">{curS.dharma_name ?? formatSessionTabLabel(curS)}</span>
              <span className="text-amber-600 ml-2">
                {curS.date?.replaceAll('-', '/')} {timePeriodLabel(curS.time_period)}
                {curS.time_start && curS.time_end && ` ${curS.time_start.slice(0,5)}–${curS.time_end.slice(0,5)}`}
              </span>
            </div>
            <span className="ml-auto text-xs text-amber-600 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
              {sessionFilteredRegistrations.length} 人
            </span>
          </div>
        )
      })()}

      {/* 異動橫幅 */}
      {lastExported && totalChangeSince > 0 && (
        <div className="mb-4 px-4 py-3 bg-orange-50 border border-orange-300 rounded-xl flex items-center gap-2">
          <span className="text-lg">🔔</span>
          <div className="text-sm text-orange-700">
            <span className="font-semibold">
              上次匯出（{new Date(event.last_exported_at).toLocaleString('zh-TW', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}）後有 {totalChangeSince} 筆異動：
            </span>
            {newRegIds.size > 0 && <span className="ml-1 text-green-700 font-medium">新增 {newRegIds.size} 筆</span>}
            {modifiedRegIds.size > 0 && <span className="ml-1 text-amber-700 font-medium">修改 {modifiedRegIds.size} 筆</span>}
            {cancelledChangesSince.length > 0 && <span className="ml-1 text-red-600 font-medium">取消 {cancelledChangesSince.length} 筆</span>}
          </div>
        </div>
      )}

      {/* 即時看板（精舍・多場次版）— 取代單場版 */}
      {registrations.length > 0 && event?.event_type === 'temple' && event?.multi_session && sessions.length > 0 && (() => {
        const { uniquePeople, totalAttendance, bySession, byDate } =
          computeMultiSessionStats(registrations, sessions, sessionFields)

        // 至少要有人或有場次才顯示
        if (uniquePeople === 0) return null

        const dayEntries = Array.from(byDate.entries())  // [[date, sessionList], ...]

        // 動態欄位：把 sessionFields 攤平成「表格欄」清單
        // - radio:   每個 option 一欄（parking_kind 角色時帶上車種 meta）
        // - boolean: 一欄（顯示 true 計數）
        // - text:    一欄（顯示有填的人數）
        // 每欄記 applicablePeriods（空陣列 = 所有時段適用）
        const sortedFields = [...sessionFields].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        const cols = []
        for (const f of sortedFields) {
          const periods = Array.isArray(f.show_if_period) ? f.show_if_period : []
          const isParkingKind = f.dashboard_role === 'parking_kind'
          const meta = f.option_meta || {}
          if (f.field_type === 'radio') {
            for (const opt of (f.options || [])) {
              // 車種優先讀 option_meta；沒設則 fallback 到字串「機車/轎車/汽車」
              const kindRaw = isParkingKind
                ? (meta[opt] || parkingKindOf(opt, null))
                : null
              cols.push({
                key: `${f.field_key}::${opt}`,
                label: opt,
                fieldKey: f.field_key,
                kind: 'option',
                option: opt,
                applicablePeriods: periods,
                parkingKind: kindRaw,   // 'motorcycle' | 'car' | 'none' | null
              })
            }
          } else if (f.field_type === 'boolean') {
            cols.push({
              key: f.field_key,
              label: f.field_label,
              fieldKey: f.field_key,
              kind: 'boolean',
              applicablePeriods: periods,
            })
          } else if (f.field_type === 'text') {
            cols.push({
              key: f.field_key,
              label: `${f.field_label}（有填）`,
              fieldKey: f.field_key,
              kind: 'text',
              applicablePeriods: periods,
            })
          }
        }

        const isColApplicable = (s, col) =>
          col.applicablePeriods.length === 0 || col.applicablePeriods.includes(s.time_period)

        const cellValueFor = (s, col, b) => {
          if (!isColApplicable(s, col)) return null
          const stat = b?.stats?.[col.fieldKey] || {}
          if (col.kind === 'option')  return stat[col.option] || 0
          if (col.kind === 'boolean') return stat.true || 0
          if (col.kind === 'text')    return stat.filled || 0
          return 0
        }

        // 合計列：對每欄加總「適用場次」的值；若該欄無任何適用場次顯示「—」
        // 同時依 option_meta 把 parking_kind 欄位的選項彙總成「機車人次 / 汽車人次」
        let sumCount = 0
        const sumByCol = new Map(cols.map(c => [c.key, { sum: 0, anyApplicable: false }]))
        const parkingTotals = { motorcycle: 0, car: 0, hasAny: false }
        for (const s of sessions) {
          const b = bySession.get(s.session_id) ?? { count: 0, stats: {} }
          sumCount += b.count
          for (const col of cols) {
            if (!isColApplicable(s, col)) continue
            const agg = sumByCol.get(col.key)
            agg.anyApplicable = true
            const v = cellValueFor(s, col, b) || 0
            agg.sum += v
            if (col.kind === 'option' && col.parkingKind) {
              parkingTotals.hasAny = true
              if (col.parkingKind === 'motorcycle') parkingTotals.motorcycle += v
              else if (col.parkingKind === 'car')   parkingTotals.car        += v
            }
          }
        }

        // 日期顯示：5/24
        const fmtMd = d => {
          if (!d) return ''
          const [, mm, dd] = d.split('-')
          return `${parseInt(mm)}/${parseInt(dd)}`
        }
        // 加星期（依星期幾顯示）
        const fmtDow = d => {
          if (!d) return ''
          const dow = new Date(d + 'T00:00:00').getDay()
          return ['日','一','二','三','四','五','六'][dow]
        }

        return (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-[11px] font-semibold text-emerald-500 uppercase tracking-widest">即時看板（精舍・多場次）</p>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-600">報名</span>
                <span className="font-bold text-emerald-700 text-lg leading-none">{uniquePeople}</span>
                <span className="text-xs text-gray-500">人（不重複）</span>
                <span className="text-gray-300">│</span>
                <span className="text-gray-600">合計</span>
                <span className="font-bold text-emerald-700 text-lg leading-none">{totalAttendance}</span>
                <span className="text-xs text-gray-500">人次</span>
              </div>
            </div>

            {/* 車輛人次摘要（schema-driven：依 option_meta 把 parking_kind 欄位彙總） */}
            {parkingTotals.hasAny && (
              <div className="inline-flex items-center gap-2 text-xs bg-white border border-emerald-200 rounded-lg px-3 py-1.5">
                <span className="text-gray-500">車輛人次</span>
                <span className="text-emerald-700 font-semibold">機車 {parkingTotals.motorcycle}</span>
                <span className="text-gray-300">·</span>
                <span className="text-emerald-700 font-semibold">汽車 {parkingTotals.car}</span>
                <span className="text-gray-400 ml-1">（人次，跨場次同人會重複計）</span>
              </div>
            )}

            {/* 每日卡片橫向排列 */}
            <div className="flex flex-wrap gap-2">
              {dayEntries.map(([date, sessList]) => (
                <div key={date} className="bg-white border border-emerald-200 rounded-lg px-3 py-2 shadow-sm min-w-[120px]">
                  <div className="text-xs font-semibold text-gray-700 mb-1">
                    {fmtMd(date)}（{fmtDow(date)}）
                  </div>
                  <div className="space-y-0.5">
                    {sessList.map(s => {
                      const b = bySession.get(s.session_id) ?? { count: 0 }
                      return (
                        <div key={s.session_id} className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="text-gray-500">{timePeriodLabel(s.time_period)}</span>
                          <span>
                            <span className="font-bold text-emerald-700 text-sm">{b.count}</span>
                            <span className="text-gray-400 ml-0.5">人</span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 詳細統計表格（可摺疊，欄位依 event_session_fields 動態渲染） */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowSessionStatsDetail(v => !v)}
                className="text-xs text-emerald-700 hover:text-emerald-900 font-medium inline-flex items-center gap-1"
              >
                <span>{showSessionStatsDetail ? '▾' : '▸'}</span>
                詳細統計
              </button>
              {showSessionStatsDetail && (
                <div className="mt-2 bg-white border border-emerald-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-emerald-100/60 text-emerald-900">
                      <tr>
                        <th className="text-left  px-3 py-1.5 font-medium whitespace-nowrap">場次</th>
                        <th className="text-right px-3 py-1.5 font-medium whitespace-nowrap">報名</th>
                        {cols.map(col => (
                          <th key={col.key} className="text-right px-3 py-1.5 font-medium whitespace-nowrap">
                            {col.label}
                            {col.parkingKind === 'motorcycle' && (
                              <span className="ml-1 text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded px-1 font-normal align-middle">機車</span>
                            )}
                            {col.parkingKind === 'car' && (
                              <span className="ml-1 text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded px-1 font-normal align-middle">汽車</span>
                            )}
                            {col.parkingKind === 'none' && (
                              <span className="ml-1 text-[10px] bg-gray-100 text-gray-500 border border-gray-200 rounded px-1 font-normal align-middle">不算</span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map(s => {
                        const b = bySession.get(s.session_id) ?? { count: 0, stats: {} }
                        return (
                          <tr key={s.session_id} className="border-t border-emerald-100">
                            <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                              {fmtMd(s.date)} {timePeriodLabel(s.time_period)}
                              {s.dharma_name && <span className="text-gray-400 ml-1">· {s.dharma_name}</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right font-medium text-emerald-700">{b.count}</td>
                            {cols.map(col => {
                              const v = cellValueFor(s, col, b)
                              return (
                                <td key={col.key} className="px-3 py-1.5 text-right text-gray-700">
                                  {v === null ? <span className="text-gray-300">—</span> : v}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                      <tr className="border-t-2 border-emerald-300 bg-emerald-50/50 font-semibold">
                        <td className="px-3 py-1.5 text-gray-700">合計</td>
                        <td className="px-3 py-1.5 text-right text-emerald-700">{sumCount}</td>
                        {cols.map(col => {
                          const agg = sumByCol.get(col.key)
                          return (
                            <td key={col.key} className="px-3 py-1.5 text-right text-gray-700">
                              {agg?.anyApplicable ? agg.sum : <span className="text-gray-300">—</span>}
                            </td>
                          )
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* 即時看板（精舍版・單場） */}
      {registrations.length > 0 && event?.event_type === 'temple' && !event?.multi_session && (() => {
        const { identityField, identityCounts, hasLunch, lunchCount, hasParking, motorcycle, car, specializedKeys } =
          computeTempleStats(registrations, fields)
        const hasIdentity = !!identityField && Object.keys(identityCounts).length > 0
        // 未被特化的 radio/boolean 欄位 → generic chip 區
        const genericStats = computeGenericRadioStats(registrations, fields, specializedKeys)
        if (!hasIdentity && !hasLunch && !hasParking && genericStats.length === 0) return null

        const identityOptions = identityField?.options ?? []
        const sortedIdentities = [
          ...identityOptions.filter(o => identityCounts[o] !== undefined),
          ...Object.keys(identityCounts).filter(k => !identityOptions.includes(k)),
        ]

        return (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 space-y-2.5">
            <p className="text-[11px] font-semibold text-emerald-500 uppercase tracking-widest">即時看板（精舍）</p>

            {/* 身份別人數 */}
            {hasIdentity && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500 shrink-0 w-14">身份</span>
                <div className="flex flex-wrap gap-2">
                  {sortedIdentities.map(val => (
                    <span key={val} className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm">
                      <span className="text-xs text-gray-600">{val}</span>
                      <span className="text-sm font-bold text-emerald-700 leading-none">{identityCounts[val]}</span>
                      <span className="text-xs text-gray-400">人</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 午齋 */}
            {hasLunch && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500 shrink-0 w-14">午齋</span>
                <span className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm">
                  <span className="text-xs text-gray-500">需要</span>
                  <span className="text-sm font-bold text-amber-600 leading-none">{lunchCount}</span>
                  <span className="text-xs text-gray-400">份</span>
                </span>
              </div>
            )}

            {/* 停車（機車、轎車） */}
            {hasParking && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500 shrink-0 w-14">停車</span>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm">
                    <span className="text-xs text-gray-500">機車</span>
                    <span className="text-sm font-bold text-blue-700 leading-none">{motorcycle}</span>
                    <span className="text-xs text-gray-400">輛</span>
                  </span>
                  <span className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm">
                    <span className="text-xs text-gray-500">轎車</span>
                    <span className="text-sm font-bold text-indigo-700 leading-none">{car}</span>
                    <span className="text-xs text-gray-400">輛</span>
                  </span>
                </div>
              </div>
            )}

            {/* Generic：其他 radio / boolean 欄位的選項分佈（未被特化的全部自動列出） */}
            {genericStats.map(({ field: gf, counts }) => {
              const ordered = [
                ...(gf.options || []).filter(o => counts[o] !== undefined),
                ...Object.keys(counts).filter(k => !(gf.options || []).includes(k)),
              ]
              return (
                <div key={gf.field_key} className="flex items-start gap-2 flex-wrap">
                  <span
                    className="text-xs text-gray-500 shrink-0 w-14 mt-1.5 truncate"
                    title={gf.field_label}
                  >
                    {gf.field_label}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {ordered.map(val => (
                      <span key={val} className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm">
                        <span className="text-xs text-gray-600">{val}</span>
                        <span className="text-sm font-bold text-emerald-700 leading-none">{counts[val]}</span>
                        <span className="text-xs text-gray-400">人</span>
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* 即時看板（回山版） */}
      {registrations.length > 0 && event?.event_type !== 'temple' && (() => {
        const { identityField, identityCounts, upStats, downStats, hasUp, hasDown, preceptStats } =
          computeDashboardStats(registrations, fields)
        const hasIdentity = !!identityField && Object.keys(identityCounts).length > 0
        const hasPrecept  = preceptStats.total > 0
        if (!hasIdentity && !hasUp && !hasDown && !hasPrecept) return null

        // 身份選項依後台定義排序
        const identityOptions = identityField?.options ?? []
        const sortedIdentities = [
          ...identityOptions.filter(o => identityCounts[o] !== undefined),
          ...Object.keys(identityCounts).filter(k => !identityOptions.includes(k)),
        ]

        // 渲染單一方向交通列（上山 or 下山）
        function TransportRow({ label, stats }) {
          const hasData = Object.values(stats.total).some(v => v > 0)
          if (!hasData) return null

          // 依身份排序的 byIdentity 列表
          const identityKeys = sortedIdentities.filter(id => stats.byIdentity[id])
          const useByIdentity = identityField && identityKeys.length > 0

          return (
            <div className="flex items-start gap-2 flex-wrap">
              <span className="text-xs text-gray-500 shrink-0 mt-1 w-20">{label}</span>
              <div className="flex flex-wrap gap-2">
                {useByIdentity ? (
                  identityKeys.map(id => {
                    const t = stats.byIdentity[id]
                    const big = t.大車, small = t.小車, other = t.其他
                    return (
                      <div key={id} className="flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1 shadow-sm">
                        <span className="text-xs text-gray-500 mr-1">{id}</span>
                        {big > 0   && <><span className="text-xs text-gray-500">大車</span><span className="text-xs font-bold text-amber-600 ml-0.5">{big}</span></>}
                        {small > 0 && <><span className={`text-xs text-gray-500 ${big > 0 ? 'ml-1.5' : ''}`}>小車</span><span className="text-xs font-bold text-green-700 ml-0.5">{small}</span></>}
                        {other > 0 && <><span className={`text-xs text-gray-500 ${(big+small) > 0 ? 'ml-1.5' : ''}`}>其他</span><span className="text-xs font-bold text-gray-500 ml-0.5">{other}</span></>}
                      </div>
                    )
                  })
                ) : (
                  <>
                    {stats.total.大車 > 0 && <span className="inline-flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1 shadow-sm"><span className="text-xs text-gray-500">大車</span><span className="text-xs font-bold text-amber-600">{stats.total.大車}</span><span className="text-xs text-gray-400">人</span></span>}
                    {stats.total.小車 > 0 && <span className="inline-flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1 shadow-sm"><span className="text-xs text-gray-500">小車</span><span className="text-xs font-bold text-green-700">{stats.total.小車}</span><span className="text-xs text-gray-400">人</span></span>}
                    {stats.total.其他 > 0 && <span className="inline-flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1 shadow-sm"><span className="text-xs text-gray-500">其他</span><span className="text-xs font-bold text-gray-500">{stats.total.其他}</span><span className="text-xs text-gray-400">人</span></span>}
                  </>
                )}
              </div>
            </div>
          )
        }

        return (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 space-y-2.5">
            <p className="text-[11px] font-semibold text-blue-400 uppercase tracking-widest">即時看板</p>

            {/* 身份別人數 */}
            {hasIdentity && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500 shrink-0 w-20">身份</span>
                <div className="flex flex-wrap gap-2">
                  {sortedIdentities.map(val => (
                    <span key={val} className="inline-flex items-center gap-1 bg-white border border-blue-200 rounded-lg px-2.5 py-1 shadow-sm">
                      <span className="text-xs text-gray-600">{val}</span>
                      <span className="text-sm font-bold text-blue-700 leading-none">{identityCounts[val]}</span>
                      <span className="text-xs text-gray-400">人</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 三皈五戒（三個數字互斥；活動有相關欄位且 total>0 才出現） */}
            {hasPrecept && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500 shrink-0 w-20">三皈五戒</span>
                <div className="flex flex-wrap gap-2">
                  {preceptStats.refugeOnly > 0 && (
                    <span
                      title="只受三皈（未同時受五戒）"
                      className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-1 shadow-sm"
                    >
                      <span className="text-xs text-emerald-700">三皈</span>
                      <span className="text-sm font-bold text-emerald-700 leading-none">{preceptStats.refugeOnly}</span>
                      <span className="text-xs text-gray-400">人</span>
                    </span>
                  )}
                  {preceptStats.fiveOnly > 0 && (
                    <span
                      title="只受五戒（未同時受三皈）"
                      className="inline-flex items-center gap-1 bg-white border border-purple-200 rounded-lg px-2.5 py-1 shadow-sm"
                    >
                      <span className="text-xs text-purple-700">五戒</span>
                      <span className="text-sm font-bold text-purple-700 leading-none">{preceptStats.fiveOnly}</span>
                      <span className="text-xs text-gray-400">人</span>
                    </span>
                  )}
                  {preceptStats.both > 0 && (
                    <span
                      title="同時受三皈與五戒"
                      className="inline-flex items-center gap-1 bg-white border border-indigo-200 rounded-lg px-2.5 py-1 shadow-sm"
                    >
                      <span className="text-xs text-emerald-700">三皈</span>
                      <span className="text-xs text-gray-400">、</span>
                      <span className="text-xs text-purple-700">五戒</span>
                      <span className="text-xs text-indigo-700">同受</span>
                      <span className="text-sm font-bold text-indigo-700 leading-none ml-0.5">{preceptStats.both}</span>
                      <span className="text-xs text-gray-400">人</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 交通（上山 / 下山） */}
            {hasUp   && <TransportRow label="去程" stats={upStats}   />}
            {hasDown && <TransportRow label="回程" stats={downStats} />}
          </div>
        )
      })()}

      {/* 搜尋列 */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <input
            value={listSearch}
            onChange={e => setListSearch(e.target.value)}
            placeholder="🔍 搜尋姓名、學員編號、班級或答案…"
            className="w-full pl-3 pr-9 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          {listSearch && (
            <button
              onClick={() => setListSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-base leading-none w-5 h-5 flex items-center justify-center"
              title="清除"
            >×</button>
          )}
        </div>
        {listSearch && (
          <span className="text-xs text-gray-500">
            找到 {searchedRegistrations.length} 筆
          </span>
        )}
      </div>

      {/* 工具列 */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-gray-500">
            共 {registrations.length} 筆報名
            {event?.multi_session && sessionTab !== 'all' && (
              <span className="text-amber-700">（本場次：{sessionFilteredRegistrations.length}）</span>
            )}
            {listSearch && <span className="text-amber-700">（搜尋中：{sortedRegistrations.length}）</span>}
          </p>
          {hasGuests && selectedGuestIds.size > 0 && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              已選 {selectedGuestIds.size} 位訪客
            </span>
          )}
          {/* 欄位顯隱切換 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400">顯示欄位：</span>
            {[
              { key: 'checkin', label: '報到', val: showCheckin, set: setShowCheckin },
              { key: 'regtime', label: '更新時間', val: showRegTime, set: setShowRegTime },
            ].map(col => (
              <button
                key={col.key}
                onClick={() => col.set(v => !v)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  col.val
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                }`}
              >
                {col.val ? '✓ ' : ''}{col.label}
              </button>
            ))}
            {/* 動態欄位 toggle（多場次模式下表格內容是場次而非 event_fields，不顯示） */}
            {!event?.multi_session && (() => {
              // 動態欄位分類（互斥，依序判斷）：
              //   - pinned：身分別（固定顯示、不在切換清單）
              //   - volunteer：show_if 指向身分別=義工（合併成「義工相關」鈕）
              //   - up：label 含「上山／山上」（合併成「上山交通」鈕）
              //   - down：label 含「下山／山下」（合併成「下山交通」鈕）
              //   - generic：其他（每欄一顆獨立鈕）
              const nonPinned       = fields.filter(f => !pinnedFieldKeys.has(f.field_key))
              const volunteerFields = nonPinned.filter(isVolunteerField)
              const upFields        = nonPinned.filter(f => !isVolunteerField(f) && isUpField(f))
              const downFields      = nonPinned.filter(f => !isVolunteerField(f) && !isUpField(f) && isDownField(f))
              const genericFields   = nonPinned.filter(f => !isVolunteerField(f) && !isUpField(f) && !isDownField(f))

              const renderGroup = (groupFields, label, color) => {
                if (groupFields.length === 0) return null
                const keys = groupFields.map(f => f.field_key)
                const allHidden = keys.every(k => hiddenFieldKeys.has(k))
                const palettes = {
                  purple: ['bg-purple-100 text-purple-800 border-purple-300'],
                  blue:   ['bg-blue-100 text-blue-800 border-blue-300'],
                  teal:   ['bg-teal-100 text-teal-800 border-teal-300'],
                }
                const onCls = palettes[color]?.[0] ?? 'bg-amber-100 text-amber-800 border-amber-300'
                return (
                  <button
                    onClick={() => toggleFieldGroup(keys)}
                    title={`${label}：${groupFields.map(f => f.field_label).join('、')}`}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      !allHidden ? onCls : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {!allHidden ? '✓ ' : ''}{label}
                  </button>
                )
              }

              return (
                <>
                  {renderGroup(volunteerFields, '義工相關', 'purple')}
                  {renderGroup(upFields,       '去程交通', 'blue')}
                  {renderGroup(downFields,     '回程交通', 'teal')}
                  {genericFields.map(f => {
                    const hidden = hiddenFieldKeys.has(f.field_key)
                    return (
                      <button
                        key={f.field_key}
                        onClick={() => toggleFieldKey(f.field_key)}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                          !hidden
                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                            : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {!hidden ? '✓ ' : ''}{f.field_label}
                      </button>
                    )
                  })}
                </>
              )
            })()}
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            {/* 批次列印按鈕（有選取時才顯示）*/}
            {selectedGuestIds.size > 0 && (
              <button
                onClick={() => setBatchPrintOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                🖨️ 批次列印（{selectedGuestIds.size}）
              </button>
            )}
            <button
              onClick={() => setStudentModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              title="從學員清單選人補登報名（不必刷學員證）"
            >
              ＋ 新增學員報名
            </button>
            <button
              onClick={() => setGuestModal(true)}
              className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              ＋ 新增訪客
            </button>
            {/* 多場次：場次視圖 → 場次 CSV */}
            {event?.multi_session && sessionTab !== 'all' && sessionFilteredRegistrations.length > 0 && (() => {
              const curS = sessions.find(s => s.session_id === sessionTab)
              return (
                <button
                  onClick={() => exportSessionCSV(sortedRegistrations, curS, event, sessionFields)}
                  className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  ⬇️ 匯出本場次 CSV
                </button>
              )
            })()}
            {/* 全部 CSV（非多場次，或多場次全部視圖）*/}
            {(!event?.multi_session || sessionTab === 'all') && registrations.length > 0 && (
              <button
                onClick={async () => {
                  exportCSV(registrations, fields, event)
                  await recordExportTime(id)
                  const now = new Date().toISOString()
                  setEvent(ev => ({ ...ev, last_exported_at: now }))
                }}
                className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                ⬇️ 匯出 CSV
              </button>
            )}
          </div>
        )}
      </div>

      {registrations.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-12">尚無報名紀錄</p>
      ) : (
        <div className="w-full bg-white rounded-xl border border-gray-200 overflow-auto max-h-[calc(100vh-300px)]">
          <table className="w-full min-w-max text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-gray-100 bg-gray-50">
                {/* 訪客 checkbox 欄（有訪客且是管理員才顯示） */}
                {isAdmin && hasGuests && (
                  <th className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={allGuestsSelected}
                      onChange={toggleSelectAllGuests}
                      title="全選訪客"
                      className="accent-amber-600 cursor-pointer w-4 h-4"
                    />
                  </th>
                )}
                <SortTh label="學員編號" colKey="student_id" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh
                  label="姓名"
                  colKey="name"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                  className="sticky left-0 z-20 bg-gray-50 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.08)]"
                />
                {/* 一般動態欄位（非多場次）*/}
                {!event?.multi_session && fields.filter(f => !hiddenFieldKeys.has(f.field_key)).map(f => (
                  <SortTh
                    key={f.field_id ?? f.field_key}
                    label={f.field_label}
                    colKey={`field:${f.field_key}`}
                    current={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  />
                ))}
                {/* 多場次：全部視圖 → 場次欄；場次視圖 → 午齋/停車 */}
                {event?.multi_session && sessionTab === 'all' && (
                  <th className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">參加場次</th>
                )}
                {event?.multi_session && sessionTab !== 'all' && (() => {
                  const curS = sessions.find(s => s.session_id === sessionTab)
                  if (!curS) return null
                  const fieldsHere = sessionFieldsForPeriod(sessionFields, curS.time_period)
                  return <>
                    {fieldsHere.map(f => (
                      <th key={f.field_key} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                        {f.field_label}
                      </th>
                    ))}
                  </>
                })()}
                {showCheckin && <SortTh label="報到" colKey="checked_in_at" current={sortKey} dir={sortDir} onSort={handleSort} />}
                {showRegTime && <SortTh label="更新時間" colKey="updated_at" current={sortKey} dir={sortDir} onSort={handleSort} />}
                <th className="sticky right-0 z-20 bg-gray-50 px-3 py-2 shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.08)]" />
              </tr>
            </thead>
            <tbody>
              {sortedRegistrations.map(r => {
                const isGuest = !r.student_id
                const isSelected = isGuest && selectedGuestIds.has(r.registration_id)
                return (
                  <tr
                    key={r.registration_id}
                    className={`border-b border-gray-50 transition-colors ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-amber-50/30'
                    }`}
                  >
                    {/* Checkbox（有訪客且是管理員才顯示此欄） */}
                    {isAdmin && hasGuests && (
                      <td className="px-3 py-1.5 text-center">
                        {isGuest && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleGuestSelect(r.registration_id)}
                            className="accent-amber-600 cursor-pointer w-4 h-4"
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-1.5 font-mono text-xs text-gray-500">
                      {r.student_id ?? (
                        <button
                          onClick={() => setQrModal({ registrationId: r.registration_id, name: getDisplayName(r) })}
                          className="text-amber-600 font-sans hover:text-amber-800 hover:underline"
                          title="點擊查看 QR code"
                        >
                          訪客 🔍
                        </button>
                      )}
                    </td>
                    <td className={`px-3 py-1.5 font-medium sticky left-0 z-[1] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)] ${isSelected ? 'bg-blue-50' : 'bg-white'}`}>
                      <span className="flex items-center gap-1.5 flex-wrap">
                        {getDisplayName(r)}
                        {r.source === 'walkin' && (
                          <span
                            className="text-xs bg-rose-100 text-rose-700 border border-rose-300 px-1.5 py-0.5 rounded-full font-normal leading-none"
                            title="刷卡時不在名單上，於報到頁現場補報"
                          >現場</span>
                        )}
                        {newRegIds.has(r.registration_id) && (
                          <span className="text-xs bg-green-100 text-green-700 border border-green-300 px-1.5 py-0.5 rounded-full font-normal leading-none">新</span>
                        )}
                        {modifiedRegIds.has(r.registration_id) && (
                          <button
                            onClick={() => {
                              const latest = changes.find(c =>
                                c.registration_id === r.registration_id && c.change_type === 'modified'
                              )
                              if (latest) setDiffModal(latest)
                            }}
                            className="text-xs bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded-full font-normal leading-none hover:bg-amber-200 cursor-pointer"
                            title="點擊查看修改明細"
                          >
                            改 🔍
                          </button>
                        )}
                      </span>
                    </td>
                    {/* 一般動態欄位（非多場次）*/}
                    {!event?.multi_session && fields.filter(f => !hiddenFieldKeys.has(f.field_key)).map(f => (
                      <td key={f.field_id} className="px-3 py-1.5 text-gray-700">
                        {formatFieldValue(f, r.answers?.[f.field_key])}
                      </td>
                    ))}
                    {/* 多場次：全部視圖 → 場次 badge 列 */}
                    {event?.multi_session && sessionTab === 'all' && (
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {(r.answers?.sessions ?? []).map(ss => {
                            const s = sessions.find(x => x.session_id === ss.session_id)
                            if (!s) return null
                            return (
                              <span
                                key={ss.session_id}
                                title={s.dharma_name ?? ''}
                                className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                              >
                                {formatSessionTabLabel(s)}
                              </span>
                            )
                          })}
                        </div>
                      </td>
                    )}
                    {/* 多場次：場次視圖 → 該場次子欄位（依 event_session_fields 動態渲染） */}
                    {event?.multi_session && sessionTab !== 'all' && (() => {
                      const curS = sessions.find(s => s.session_id === sessionTab)
                      if (!curS) return null
                      const fieldsHere = sessionFieldsForPeriod(sessionFields, curS.time_period)
                      const ssAns = r.answers?.sessions?.find(ss => ss.session_id === sessionTab) ?? {}
                      return <>
                        {fieldsHere.map(f => (
                          <td key={f.field_key} className="px-3 py-1.5 text-sm text-gray-700">
                            {formatSessionAnswer(f, resolveSessionAns(f, ssAns))}
                          </td>
                        ))}
                      </>
                    })()}
                    {showCheckin && (() => {
                      const chk = effectiveCheckinAt(r)
                      return (
                        <td className="px-3 py-1.5">
                          {chk ? (
                            <span className="text-green-600 text-xs font-medium" title={new Date(chk).toLocaleString('zh-TW', { hour12: false })}>
                              ✓ {new Date(chk).toLocaleTimeString('zh-TW', { hour12: false }).slice(0, 5)}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                      )
                    })()}
                    {showRegTime && (
                      <td className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap">
                        {(r.updated_at ?? r.registered_at)
                          ? new Date(r.updated_at ?? r.registered_at).toLocaleString('zh-TW', { hour12: false })
                          : '-'}
                      </td>
                    )}
                    <td className={`px-3 py-1.5 text-right sticky right-0 z-[1] shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.06)] ${isSelected ? 'bg-blue-50' : 'bg-white'}`}>
                      {isAdmin && (
                        <div className="flex gap-2 justify-end">
                          {effectiveCheckinAt(r) && (
                            <button
                              onClick={() => handleUncheckIn(r.registration_id, getDisplayName(r))}
                              className="text-xs text-orange-500 hover:text-orange-700 border border-orange-200 hover:border-orange-400 px-2 py-1 rounded transition-colors"
                            >
                              取消報到
                            </button>
                          )}
                          <button
                            onClick={() => setEditingReg(r)}
                            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-2 py-1 rounded transition-colors"
                          >
                            ✏️ 編輯
                          </button>
                          <button
                            onClick={() => handleDeleteRegistration(r.registration_id, getDisplayName(r))}
                            className="text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-2 py-1 rounded transition-colors"
                          >
                            取消報名
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 已取消區塊（永遠顯示，不受匯出基準限制） */}
      {cancelledChanges.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowCancelled(v => !v)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <span>{showCancelled ? '▼' : '▶'}</span>
            <span>已取消（共 {cancelledChanges.length} 筆）</span>
          </button>
          {showCancelled && (
            <div className="mt-2 bg-gray-50 rounded-xl border border-gray-200 overflow-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-100">
                    <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">姓名</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">取消時間</th>                        {fields.map(f => (
                      <th key={f.field_id ?? f.field_key} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">
                        {f.field_label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cancelledChanges.map(c => (
                    <tr key={c.id} className="border-b border-gray-100 text-gray-400">
                      <td className="px-3 py-1.5 line-through whitespace-nowrap">{c.student_name}</td>
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                        {new Date(c.changed_at).toLocaleString('zh-TW', { hour12: false })}
                      </td>
                      {fields.map(f => (
                        <td key={f.field_id ?? f.field_key} className="px-3 py-1.5">
                          {formatFieldValue(f, c.old_answers?.[f.field_key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
