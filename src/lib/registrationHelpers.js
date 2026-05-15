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
 * 對應 badge 樣式
 * @returns {{ label: '皈'|'戒', cls: string }|null}
 */
export function preceptBadgeProps(reg) {
  const lv = getPreceptLevel(reg)
  if (lv === 'five_precepts') return { label: '戒', cls: 'bg-purple-100 text-purple-700 border-purple-300' }
  if (lv === 'refuge')        return { label: '皈', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' }
  return null
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
