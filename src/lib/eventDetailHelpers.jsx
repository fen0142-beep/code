import { sessionFieldsForPeriod, formatSessionAnswer, getPreceptFlags } from './registrationHelpers'

export const STATUS_LABEL = { draft: '草稿', active: '進行中', closed: '已關閉' }

// ── 欄位值格式化 ────────────────────────────────────────────
export function formatFieldValue(field, val) {
  if (val === undefined || val === null || val === '') return '-'
  if (field.field_type === 'boolean') return val === true ? '✓ 是' : '✗ 否'
  if (Array.isArray(val)) return val.join('、')
  if (field.field_type === 'datetime' && typeof val === 'string' && val.includes('T')) {
    const [date, time] = val.split('T')
    return `${date.replaceAll('-', '/')} ${time.slice(0, 5)}`
  }
  if (field.field_type === 'date' && typeof val === 'string') {
    return val.replaceAll('-', '/')
  }
  // 純時間欄位：'HH:MM:SS' → 'HH:MM'（去掉秒；不足 5 字元就原樣）
  if (field.field_type === 'time' && typeof val === 'string') {
    return val.length >= 5 ? val.slice(0, 5) : val
  }
  // 車牌：自動大寫去空白（資料層可能未統一）
  if (field.field_type === 'plate' && typeof val === 'string') {
    return val.trim().toUpperCase()
  }
  return val
}

// ── 活動日期格式化 ──────────────────────────────────────────
export function formatEventDate(ev) {
  if (!ev?.date_start) return ''
  const fmt = d => d.replaceAll('-', '/')
  if (!ev.date_end || ev.date_end === ev.date_start) return fmt(ev.date_start)
  return `${fmt(ev.date_start)} ～ ${fmt(ev.date_end)}`
}

// ── 顯示名稱（學員或訪客）────────────────────────────────────
// 訪客若 answers.host_name 有值（代報親友）→ 顯示「親友姓名（XX 親友）」
// 舊資料（無 host_name，但有 host_student_id）由呼叫端 join 後從 students 反查名字，再傳入 hostFallback
export function getDisplayName(r, hostFallback) {
  if (r.students?.name) return r.students.name
  if (r.answers?.guest_name) {
    const host = r.answers?.host_name || hostFallback
    return host ? `${r.answers.guest_name}（${host} 親友）` : r.answers.guest_name
  }
  return '-'
}

// ── 多場次 helper ───────────────────────────────────────────
export function timePeriodShort(tp) {
  return { morning: '上', afternoon: '下', evening: '晚' }[tp] ?? tp
}
export function timePeriodLabel(tp) {
  return { morning: '上午', afternoon: '下午', evening: '晚上' }[tp] ?? tp
}
export function formatSessionTabLabel(s) {
  if (!s?.date) return ''
  const [, mm, dd] = s.date.split('-')
  return `${parseInt(mm)}/${parseInt(dd)}${timePeriodShort(s.time_period)}`
}

// 場次子欄位答案查詢（相容舊版 fallback key：lunch / parking）
// 舊版在 DB session_fields 未設定時，answers 用 fallback key 寫入；
// 後來 DB 設了不同 field_key（例如中文或其他命名），導致顯示「-」。
// 此 helper 先查 DB field_key，找不到時再試 fallback 常見對應。
export const SESSION_LEGACY_KEYS = {
  lunch:   ['午', '齋'],
  parking: ['停車', '車位'],
}
export function resolveSessionAns(field, ssAns) {
  if (!ssAns) return undefined
  const direct = ssAns[field.field_key]
  if (direct !== undefined) return direct
  for (const [legacyKey, hints] of Object.entries(SESSION_LEGACY_KEYS)) {
    if (hints.some(h => (field.field_label ?? '').includes(h)) && ssAns[legacyKey] !== undefined) {
      return ssAns[legacyKey]
    }
  }
  return undefined
}

// 單一場次 CSV 匯出（動態欄位：依 event_session_fields × show_if_period）
export function exportSessionCSV(sessionRegs, session, event, sessionFields = []) {
  const sessionLabel = formatSessionTabLabel(session)
  const fieldsHere = sessionFieldsForPeriod(sessionFields, session.time_period)
  const header = ['學員編號', '姓名', ...fieldsHere.map(f => f.field_label), '更新時間']

  const rows = sessionRegs.map(r => {
    const name = getDisplayName(r)
    const stamp = r.updated_at ?? r.registered_at
    const regAt = stamp ? new Date(stamp).toLocaleString('zh-TW') : ''
    const ssAns = r.answers?.sessions?.find(ss => ss.session_id === session.session_id) ?? {}
    const fieldCells = fieldsHere.map(f => {
      const v = resolveSessionAns(f, ssAns)
      if (v === undefined || v === null || v === '') return ''
      if (f.field_type === 'boolean') return v === true ? '是' : '否'
      if (Array.isArray(v)) return v.join('、')
      return String(v)
    })
    return [r.student_id ?? '訪客', name, ...fieldCells, regAt]
  })

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const eventName = (event?.name ?? '活動').replace(/^\d{4}\s*/, '')
  const filename = `${eventName}_${sessionLabel}_報名資料.csv`
  const bom = '﻿'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── 可排序表頭欄 ────────────────────────────────────────────
export function SortTh({ label, colKey, current, dir, onSort, className = '' }) {
  const active = current === colKey
  return (
    <th
      onClick={() => onSort(colKey)}
      className={`text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:text-amber-700 hover:bg-amber-50/60 transition-colors ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs leading-none ${active ? 'text-amber-600' : 'text-gray-300'}`}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </span>
    </th>
  )
}

// ── CSV 匯出 ───────────────────────────────────────────────
export function exportCSV(registrations, fields, event) {
  const answerHeaders = fields.map(f => f.field_label)
  // 補基本欄位：班級、組別、報名時間（首次報名）— 排座位與後續統計常用
  const header = [
    '學員編號', '姓名', '班級', '組別',
    '報名時間', '更新時間', '報到時間',
    ...answerHeaders,
  ]

  const rows = registrations.map(r => {
    const name = getDisplayName(r)
    // 班級／組別：學員可能屬多班，逐項以 / 串接（訪客為空）
    const classes = (r.students?.student_classes ?? [])
    const classCol = classes.map(c => c.class_name ?? '').filter(Boolean).join('/')
    const groupCol = classes.map(c => c.group_name ?? '').filter(Boolean).join('/')
    // 報名時間：首次報名（registered_at）；更新時間：最後編輯（updated_at）
    const regAt     = r.registered_at ? new Date(r.registered_at).toLocaleString('zh-TW') : ''
    const updatedAt = r.updated_at    ? new Date(r.updated_at).toLocaleString('zh-TW')    : ''
    const checkinAt = r.checked_in_at ? new Date(r.checked_in_at).toLocaleString('zh-TW') : ''
    const answerCols = fields.map(f => {
      const val = r.answers?.[f.field_key]
      const formatted = formatFieldValue(f, val)
      return formatted === '-' ? '' : formatted
    })
    return [
      r.student_id ?? '訪客', name, classCol, groupCol,
      regAt, updatedAt, checkinAt,
      ...answerCols,
    ]
  })

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  // 組合檔名：民國年 + 活動名稱（去掉開頭西元年）+ 學員報名資料 + MMDD
  const eventName = (event?.name ?? '活動').replace(/^\d{4}\s*/, '')
  const dateBase = event?.date_start ?? new Date().toISOString().slice(0, 10)
  const rocYear = parseInt(dateBase.slice(0, 4)) - 1911
  const mmdd = dateBase.replace(/-/g, '').slice(4) // "20260428" → "0428"
  const filename = `${rocYear}年${eventName}學員報名資料${mmdd}.csv`

  const bom = '\uFEFF'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── 即時看板統計 ──────────────────────────────────────────────
// 大車：包含「精舍」字樣（搭精舍車、精舍搭車 等）
export const BIG_CAR_KEYS = ['精舍']
export const SMALL_CAR_KEYS = ['自行開車', '搭學員']

export function classifyTransport(val) {
  if (!val) return null
  if (BIG_CAR_KEYS.some(k => val.includes(k))) return '大車'
  if (SMALL_CAR_KEYS.some(k => val.includes(k))) return '小車'
  return '其他'
}

// 統計單一交通欄位，回傳 { byIdentity, total }
export function computeTransportStats(regs, field, identityField) {
  const byIdentity = {}
  const total = { 大車: 0, 小車: 0, 其他: 0 }
  if (!field) return { byIdentity, total }
  for (const r of regs) {
    const category = classifyTransport(r.answers?.[field.field_key])
    if (!category) continue
    total[category]++
    if (identityField) {
      const identity = r.answers?.[identityField.field_key] ?? '未填'
      if (!byIdentity[identity]) byIdentity[identity] = { 大車: 0, 小車: 0, 其他: 0 }
      byIdentity[identity][category]++
    }
  }
  return { byIdentity, total }
}

// 三皈五戒統計：refugeOnly = 只受三皈、fiveOnly = 只受五戒、both = 同時受
export function computePreceptStats(regs) {
  let refugeOnly = 0
  let fiveOnly   = 0
  let both       = 0
  for (const r of regs) {
    const { refuge, five } = getPreceptFlags(r)
    if (refuge && five)   both++
    else if (five)        fiveOnly++
    else if (refuge)      refugeOnly++
  }
  return { refugeOnly, fiveOnly, both, total: refugeOnly + fiveOnly + both }
}

export function computeDashboardStats(regs, fields) {
  const identityField = fields.find(f => f.field_key === 'identity')
  const upField   = fields.find(f => f.field_key === 'transport_up')
                 ?? fields.find(f => f.field_key === 'transport')
  const downField = fields.find(f => f.field_key === 'transport_down')

  // 身份別總人數
  const identityCounts = {}
  if (identityField) {
    for (const r of regs) {
      const val = r.answers?.[identityField.field_key]
      if (val) identityCounts[val] = (identityCounts[val] || 0) + 1
    }
  }

  return {
    identityField,
    identityCounts,
    upStats:   computeTransportStats(regs, upField,   identityField),
    downStats: computeTransportStats(regs, downField, identityField),
    hasUp:   !!upField,
    hasDown: !!downField,
    preceptStats: computePreceptStats(regs),
  }
}

// 精舍活動：午齋 / 停車（機車、轎車）統計
//
// 停車輛數的計算方式（車號去重模式）：
// - 若欄位定義中有 plate 型別欄位、且名單中有任何人填了車號
//   → 進入「車號去重」模式：以車號為單位 group by，每個獨特車號算 1 台
//   → 同車號的其他人視為共乘者（不重複計）
// - 沒填車號但選了機車／轎車的人 → 視為各自一台（向下相容、避免漏算）
// - 完全沒 plate 欄位（舊活動）→ 退回單純計人頭模式
//
// 車號標準化：大寫 + 移除空白與連字號（避免 "ABC-1234" 和 "abc 1234" 算成兩台）
export function normalizePlate(s) {
  return String(s || '').trim().toUpperCase().replace(/[\s\-－—]/g, '')
}

// 看板特化角色 ↔ 欄位的識別：優先用 dashboard_role；找不到才 fallback 到舊的寫死 field_key
export function pickRoleField(fields, role, fallbackKey) {
  return (
    fields.find(f => f.dashboard_role === role) ??
    fields.find(f => f.field_key === fallbackKey) ??
    null
  )
}

// 停車選項字串 → 車種（motorcycle / car / none / null）
// 優先讀 option_meta；沒設則 fallback 到字串「機車／轎車／汽車」
export function parkingKindOf(val, optionMeta) {
  if (val === null || val === undefined || val === '') return null
  if (optionMeta && optionMeta[val]) return optionMeta[val]
  if (val === '機車') return 'motorcycle'
  if (val === '轎車' || val === '汽車') return 'car'
  return null
}

export function computeTempleStats(regs, fields) {
  const identityField = pickRoleField(fields, 'identity',     'identity')
  const lunchField    = pickRoleField(fields, 'lunch_total',  'need_lunch')
  const parkingField  = pickRoleField(fields, 'parking_kind', 'parking_type')
  const plateFields   = fields.filter(f => f.field_type === 'plate')

  const identityCounts = {}
  if (identityField) {
    for (const r of regs) {
      const val = r.answers?.[identityField.field_key]
      if (val) identityCounts[val] = (identityCounts[val] || 0) + 1
    }
  }

  // 偵測是否啟用車號去重模式
  const platesEnabled = plateFields.length > 0 && regs.some(r =>
    plateFields.some(pf => {
      const v = r.answers?.[pf.field_key]
      return v && String(v).trim() !== ''
    })
  )

  const parkingMeta = parkingField?.option_meta || null

  let lunchCount = 0
  let motorcycle = 0
  let car = 0
  const seenPlates = new Set()   // 已計入的標準化車號

  for (const r of regs) {
    if (lunchField && r.answers?.[lunchField.field_key] === true) lunchCount++
    if (!parkingField) continue

    const val  = r.answers?.[parkingField.field_key]
    const kind = parkingKindOf(val, parkingMeta)
    if (kind !== 'motorcycle' && kind !== 'car') continue   // none / 未填 / 跟 OOO 同車 都跳過

    if (platesEnabled) {
      // 找第一個非空的車號欄位
      let plate = ''
      for (const pf of plateFields) {
        const v = r.answers?.[pf.field_key]
        if (v && String(v).trim()) { plate = normalizePlate(v); break }
      }
      if (plate) {
        if (seenPlates.has(plate)) continue   // 同車號已計入 → 共乘者，跳過
        seenPlates.add(plate)
      }
      // plate 空（沒填車號）→ 維持「視為一台」的舊行為
    }

    if (kind === 'motorcycle') motorcycle++
    else if (kind === 'car') car++
  }

  return {
    identityField, identityCounts,
    hasLunch: !!lunchField, lunchCount,
    hasParking: !!parkingField, motorcycle, car,
    plateDedup: platesEnabled,
    // 已被特化佔用的 field_key（generic chip 區會跳過這些）
    specializedKeys: new Set([identityField, lunchField, parkingField].filter(Boolean).map(f => f.field_key)),
  }
}

// Generic chip 區：把所有「未被特化佔用、且為 radio / boolean」的欄位做選項計數
// 用途：即使活動沒標 dashboard_role，至少能看到每個選項的人數分佈
export function computeGenericRadioStats(regs, fields, excludeKeys) {
  const targets = fields.filter(f =>
    (f.field_type === 'radio' || f.field_type === 'boolean') &&
    !excludeKeys.has(f.field_key)
  )
  return targets.map(f => {
    const counts = {}
    for (const r of regs) {
      const v = r.answers?.[f.field_key]
      if (v === undefined || v === null || v === '') continue
      const key = typeof v === 'boolean' ? (v ? '是' : '否') : String(v)
      counts[key] = (counts[key] || 0) + 1
    }
    return { field: f, counts }
  }).filter(s => Object.keys(s.counts).length > 0)
}
