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
 * 從報名 answers 拿到 precept_level（容錯多種設定方式）
 *
 * 支援兩種設計：
 * A. 單一 radio 欄位：answers.precept_level = '三皈' / '五戒' / '無'
 *    （field_key 容錯：precept_level / precept / 三皈五戒 / 皈戒）
 * B. 雙 boolean 欄位（如「報名三皈依」、「報名五戒」各一個 boolean）：
 *    掃 answers，找 key 含「五戒」或「三皈/皈依」字樣、值為 true 的
 *    同時都勾 → 五戒（層級較高）
 *
 * @returns {'refuge'|'five_precepts'|null}
 */
export function getPreceptLevel(reg) {
  if (!reg) return null
  const ans = reg.answers || {}

  // ── 模式 A：單一 radio 欄位 ──
  const candidates = [
    ans.precept_level,
    ans.precept,
    ans['三皈五戒'],
    ans['皈戒'],
  ]
  for (const v of candidates) {
    if (!v) continue
    const s = String(v).trim()
    if (s === '五戒' || s === 'five_precepts' || s === 'five') return 'five_precepts'
    if (s === '三皈' || s === '三皈依' || s === 'refuge' || s === 'sangui') return 'refuge'
  }

  // ── 模式 B：boolean 雙欄位（key 含關鍵字、值為 true）──
  let hasRefuge = false
  let hasFive   = false
  for (const [k, v] of Object.entries(ans)) {
    if (v !== true) continue
    const key = String(k)
    if (key.includes('五戒')) hasFive = true
    else if (key.includes('三皈') || key.includes('皈依')) hasRefuge = true
  }
  if (hasFive)   return 'five_precepts'   // 受五戒層級較高
  if (hasRefuge) return 'refuge'

  return null
}

/**
 * 對應 badge 樣式
 * @returns {{ label: '皈'|'戒', cls: string }|null}
 */
export function getPreceptBadge(reg) {
  const lv = getPreceptLevel(reg)
  if (lv === 'refuge') {
    return {
      label: '皈',
      cls: 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300',
    }
  }
  if (lv === 'five_precepts') {
    return {
      label: '戒',
      cls: 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300',
    }
  }
  return null
}

/**
 * 判斷某筆 registration 是否為司機。
 * 規則：動態欄位（fields）中有型別為 plate 的欄位、
 *       且 answers[該欄位 key] 有非空值。
 *
 * @param {Object} reg     registration 物件（含 answers）
 * @param {Array}  fields  該活動的 event_fields
 */
export function isDriverFromAnswers(reg, fields = []) {
  if (!reg) return false
  const ans = reg.answers || {}
  for (const f of (fields || [])) {
    if (f?.field_type !== 'plate') continue
    const v = ans[f.field_key]
    if (v && String(v).trim() !== '') return true
  }
  return false
}

/**
 * 拿出 plate 欄位的值（顯示用，回傳第一個非空者）
 */
export function getPlateNumber(reg, fields = []) {
  if (!reg) return ''
  const ans = reg.answers || {}
  for (const f of (fields || [])) {
    if (f?.field_type !== 'plate') continue
    const v = ans[f.field_key]
    if (v && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/**
 * 一個小元件等級的 helper：在 JSX 裡直接 inline 渲染 badge。
 * 用法：{renderPreceptBadge(reg)}
 *
 * 不用 JSX 是因為這檔案是 .js；改成回傳 props 給呼叫者組成 <span>
 */
export function preceptBadgeProps(reg) {
  const b = getPreceptBadge(reg)
  if (!b) return null
  return {
    className: b.cls,
    title: b.label === '皈' ? '三皈' : '五戒',
    children: `[${b.label}]`,
  }
}
