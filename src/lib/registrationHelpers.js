// ─── Phase 2 補強：身份標籤 + 司機判定 ───────────────────────
//
// 把跨檔案會用到的小邏輯集中在這裡，避免在頁面內各自實作走樣。
//
// • 三皈五戒（precept）— 報名時動態欄位（field_key 慣例為 precept_level），
//   值 = '三皈' / '五戒' / '無'（或空字串）。badge 用 [皈] / [戒] 渲染。
//
// • 司機（driver）— 動態欄位中型別為 'plate' 的車牌欄位有非空值 → 視為司機。
//   小車場景才有意義；統計「司機數」用此判定。
//
// ─────────────────────────────────────────────────────────────

/**
 * 同時偵測三皈與五戒（兩者可並存）
 *
 * 支援的設計：
 * A. 單一 radio 欄位：answers.precept_level = '三皈' / '五戒' / '無'
 *    （field_key 容錯：precept_level / precept / 三皈五戒 / 皈戒；
 *     value 可為 string 或 array，array 代表 checkbox 多選）
 * B. 雙 boolean 欄位（如「報名三皈依」、「報名五戒」各一個 boolean）：
 *    掃 answers，找 key 含「五戒」或「三皈/皈依」字樣、值為 true 的
 *
 * 重點：A、B 兩種模式都會掃，不會 early return。
 * 學員若 radio 選了「三皈」、又勾了「加報五戒」boolean，兩個 flag 都會 true。
 *
 * @returns {{ refuge: boolean, five: boolean }}
 */
export function getPreceptFlags(reg) {
  if (!reg) return { refuge: false, five: false }
  const ans = reg.answers || {}

  let refuge = false
  let five   = false

  // ── 模式 A：「集中型」欄位（radio 單值或 checkbox 多值）──
  const candidates = [
    ans.precept_level,
    ans.precept,
    ans['三皈五戒'],
    ans['皈戒'],
  ]
  for (const v of candidates) {
    if (v == null || v === '' || v === false) continue
    const arr = Array.isArray(v) ? v : [v]
    for (const item of arr) {
      if (item == null) continue
      const s = String(item).trim()
      if (!s) continue
      if (s === '五戒' || s === 'five_precepts' || s === 'five' || s.includes('五戒')) five = true
      if (s === '三皈' || s === '三皈依' || s === 'refuge' || s === 'sangui' ||
          s.includes('三皈') || s.includes('皈依')) refuge = true
    }
  }

  // ── 模式 B：boolean 雙欄位（key 含關鍵字、值為 true）──
  for (const [k, v] of Object.entries(ans)) {
    if (v !== true) continue
    const key = String(k)
    if (key.includes('五戒')) five = true
    else if (key.includes('三皈') || key.includes('皈依')) refuge = true
  }

  return { refuge, five }
}

/**
 * 從報名 answers 拿到 precept_level（單一最高層級）
 *
 * 同時受三皈與五戒時，回 'five_precepts'（五戒層級較高）。
 * 用於：badge 顯示、Step 0 同車獨佔分組等只需「擇一」語意的場景。
 * 想拿到完整「同時報名」資訊請用 getPreceptFlags。
 *
 * @returns {'refuge'|'five_precepts'|null}
 */
export function getPreceptLevel(reg) {
  const { refuge, five } = getPreceptFlags(reg)
  if (five) return 'five_precepts'
  if (refuge) return 'refuge'
  return null
}

/**
 * 對應 badge 樣式（回傳陣列，可直接 .map()）
 * @returns {Array<{ children: string, className: string, title: string }>}
 */
export function preceptBadgeProps(reg) {
  const lv = getPreceptLevel(reg)
  if (lv === 'five_precepts') return [{ children: '戒', className: 'text-xs bg-purple-100 text-purple-700 border border-purple-300 rounded px-1', title: '五戒' }]
  if (lv === 'refuge')        return [{ children: '皈', className: 'text-xs bg-emerald-100 text-emerald-700 border border-emerald-300 rounded px-1', title: '皈依' }]
  return []
}

/**
 * 從 answers 判斷是否為司機
 * 動態欄位中型別為 'plate' 的車牌欄位有非空值 → 視為司機
 */
export function isDriverFromAnswers(answers) {
  if (!answers) return false
  return Object.entries(answers).some(([k, v]) => {
    if (!v || typeof v !== 'string') return false
    // 車牌欄位 key 慣例含 plate
    return k.includes('plate') && v.trim().length > 0
  })
}

// ─── Phase 5：多場次「場次共用子欄位」(event_session_fields) 動態化 ─────
//
// 後台看板 / CSV 匯出 / 名單展開原本寫死 lunch / parking 兩個 key，
// 現在改成從 event_session_fields 動態驅動。下列 helper 三支：
//
//   sessionFieldsForPeriod  — 篩選此場次該顯示的欄位（依 show_if_period）
//   formatSessionAnswer     — 將答案值轉成顯示字串
//   computeMultiSessionStats— 依場次 + 場次共用欄位動態聚合
//
// 向後相容：舊活動沒有 event_session_fields 設定 → DB 已 backfill 預設
// 「午齋（morning）+ 停車（all）」兩筆；helper 只需照表動態跑即可。

/**
 * 從 event_session_fields 找出某時段該顯示的子欄位
 *
 * @param {Array} allFields - event_session_fields 陣列
 * @param {string} timePeriod - 'morning' | 'afternoon' | 'evening'
 * @returns 已依 sort_order 排序的欄位陣列（show_if_period 空 = 全部時段）
 */
export function sessionFieldsForPeriod(allFields, timePeriod) {
  if (!Array.isArray(allFields)) return []
  return allFields
    .filter(f => {
      const periods = Array.isArray(f.show_if_period) ? f.show_if_period : []
      return periods.length === 0 || periods.includes(timePeriod)
    })
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

/**
 * 將子欄位答案值格式化成顯示字串
 * - radio / text：原字串（空 → '-'）
 * - boolean：✓ / ✗（空 → '-'）
 */
export function formatSessionAnswer(field, val) {
  if (val === undefined || val === null || val === '') return '-'
  if (field?.field_type === 'boolean') return val === true ? '✓' : '✗'
  if (Array.isArray(val)) return val.join('、')
  return String(val)
}

/**
 * 多場次活動：依場次 × 場次共用子欄位 動態聚合
 *
 * 回傳的 bySession.get(session_id) 結構：
 *   { count, stats }
 * stats 結構（依 field_type）：
 *   - radio:   { [optionLabel]: count }   每個出現過的選項一個計數
 *   - boolean: { true: count }            只記 true 的人數
 *   - text:    { filled: count }          有填值（非空白）的人數
 *
 * @param {Array} regs           - registrations 陣列
 * @param {Array} sessions       - event_sessions 陣列
 * @param {Array} sessionFields  - event_session_fields 陣列（共用設定）
 */
export function computeMultiSessionStats(regs, sessions, sessionFields = []) {
  const uniquePeople = regs.length
  const fields = Array.isArray(sessionFields) ? sessionFields : []

  // 預建 bySession（保證 sessions 順序穩定）
  const bySession = new Map()
  for (const s of sessions) {
    const fieldsHere = sessionFieldsForPeriod(fields, s.time_period)
    const stats = {}
    for (const f of fieldsHere) stats[f.field_key] = {}
    bySession.set(s.session_id, { count: 0, stats })
  }

  let totalAttendance = 0
  for (const r of regs) {
    const arr = Array.isArray(r.answers?.sessions) ? r.answers.sessions : []
    for (const ss of arr) {
      const bucket = bySession.get(ss?.session_id)
      if (!bucket) continue
      bucket.count++
      totalAttendance++

      const s = sessions.find(x => x.session_id === ss.session_id)
      if (!s) continue
      const fieldsHere = sessionFieldsForPeriod(fields, s.time_period)
      for (const f of fieldsHere) {
        const val = ss[f.field_key]
        const stat = bucket.stats[f.field_key]
        if (!stat) continue
        if (f.field_type === 'boolean') {
          if (val === true) stat.true = (stat.true || 0) + 1
        } else if (f.field_type === 'text') {
          if (val != null && String(val).trim() !== '') stat.filled = (stat.filled || 0) + 1
        } else {
          // radio (default)
          if (val == null || val === '') continue
          const key = String(val)
          stat[key] = (stat[key] || 0) + 1
        }
      }
    }
  }

  // 依日期分組（保留 sessions 原排序）
  const byDate = new Map()
  for (const s of sessions) {
    if (!byDate.has(s.date)) byDate.set(s.date, [])
    byDate.get(s.date).push(s)
  }

  return { uniquePeople, totalAttendance, bySession, byDate }
}
