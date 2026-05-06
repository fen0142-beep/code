import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('請在 .env.local 設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    // 強制繞過瀏覽器 HTTP 快取，確保每次查詢都取得最新資料
    fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }),
  },
})

// ─── Auth ─────────────────────────────────────────────────

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

export async function signOut() {
  await supabase.auth.signOut()
}

// ─── 活動查詢（前台）────────────────────────────────────────

/**
 * 取得所有 active 活動，每場附帶動態欄位
 * @returns {{ events: Array<{event, fields}>, error: string|null }}
 */
export async function getActiveEvents() {
  const { data: events, error: eventErr } = await supabase
    .from('events')
    .select('*')
    .eq('status', 'active')
    .order('date_start', { ascending: true })

  if (eventErr) return { events: [], error: eventErr.message }
  if (!events || events.length === 0) return { events: [], error: null }

  // 同時撈所有活動的欄位
  const { data: allFields, error: fieldErr } = await supabase
    .from('event_fields')
    .select('*')
    .in('event_id', events.map(e => e.event_id))
    .order('sort_order', { ascending: true })

  if (fieldErr) return { events: [], error: fieldErr.message }

  const fieldsMap = {}
  for (const f of (allFields || [])) {
    if (!fieldsMap[f.event_id]) fieldsMap[f.event_id] = []
    fieldsMap[f.event_id].push(f)
  }

  return {
    events: events.map(ev => ({
      event: ev,
      fields: fieldsMap[ev.event_id] || [],
    })),
    error: null,
  }
}

/**
 * 取得學員在多場活動中的報名狀態
 * @returns {{ [eventId]: registration|null }}
 */
export async function getStudentEventStatuses(studentId, eventIds) {
  if (!eventIds.length) return { map: {}, error: null }

  const { data, error } = await supabase
    .from('registrations')
    .select('registration_id, event_id, answers')
    .eq('student_id', studentId)
    .in('event_id', eventIds)

  if (error) {
    console.error('[getStudentEventStatuses] error:', error)
    return { map: {}, error: error.message }
  }

  const map = {}
  for (const id of eventIds) map[id] = null
  for (const r of (data || [])) map[r.event_id] = r
  return { map, error: null }
}

// ─── 學員查詢（前台）────────────────────────────────────────

/**
 * 用學員編號查詢學員資料（含班別）
 * 合併為單一查詢（原本兩次串行 → 一次搞定），減少往返延遲
 */
export async function getStudentById(studentId) {
  const { data, error } = await supabase
    .from('students')
    .select('*, student_classes(class_name, group_name)')
    .eq('student_id', studentId)
    .eq('active', true)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return { student: null, classes: [], error: 'NOT_FOUND' }
    }
    return { student: null, classes: [], error: error.message }
  }

  const classes = data.student_classes || []
  const { student_classes: _, ...student } = data

  return { student, classes, error: null }
}

// ─── 報名（前台）──────────────────────────────────────────

export async function checkDuplicate(eventId, studentId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('registration_id')
    .eq('event_id', eventId)
    .eq('student_id', studentId)
    .limit(1)

  if (error) return false
  return data && data.length > 0
}

export async function submitRegistration(eventId, studentId, answers, terminal = 'tablet-01') {
  const { error } = await supabase
    .from('registrations')
    .upsert({
      event_id: eventId,
      student_id: studentId,
      answers,
      terminal
    }, { onConflict: 'event_id,student_id' })

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

export async function getRegistration(eventId, studentId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('registration_id, answers')
    .eq('event_id', eventId)
    .eq('student_id', studentId)
    .single()
  if (error) return null
  return data
}

export async function updateRegistration(registrationId, answers) {
  const { error } = await supabase
    .from('registrations')
    .update({ answers })
    .eq('registration_id', registrationId)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

// ─── 活動管理（後台）────────────────────────────────────────

/**
 * 取得所有活動
 */
export async function getAllEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date_start', { ascending: false })

  if (error) return { events: [], error: error.message }
  return { events: data || [], error: null }
}

/**
 * 建立新活動
 */
export async function createEvent(payload) {
  const { data, error } = await supabase
    .from('events')
    .insert(payload)
    .select()
    .single()

  if (error) return { event: null, error: error.message }
  return { event: data, error: null }
}

/**
 * 更新活動
 */
export async function updateEvent(eventId, payload) {
  const { error } = await supabase
    .from('events')
    .update(payload)
    .eq('event_id', eventId)

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 刪除活動（含所有報名紀錄、欄位設定、異動紀錄）
 * 警告：此動作不可復原
 */
export async function deleteEvent(eventId) {
  // 依序刪除關聯資料，避免 FK 約束
  const steps = [
    { table: 'registration_changes', col: 'event_id' },
    { table: 'registrations',        col: 'event_id' },
    { table: 'event_fields',         col: 'event_id' },
    { table: 'events',               col: 'event_id' },
  ]
  for (const { table, col } of steps) {
    const { error } = await supabase.from(table).delete().eq(col, eventId)
    if (error) return { success: false, error: `刪除 ${table} 失敗：${error.message}` }
  }
  return { success: true, error: null }
}

/**
 * 切換活動鎖定狀態（停止／開放異動）
 */
export async function toggleEventLock(eventId, locked) {
  const { error } = await supabase
    .from('events')
    .update({ locked })
    .eq('event_id', eventId)

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 取得活動的動態欄位
 */
export async function getEventFields(eventId) {
  const { data, error } = await supabase
    .from('event_fields')
    .select('*')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })

  if (error) return { fields: [], error: error.message }
  return { fields: data || [], error: null }
}

/**
 * 儲存活動動態欄位（先刪全部再插入）
 */
export async function saveEventFields(eventId, fields) {
  const { error: delErr } = await supabase
    .from('event_fields')
    .delete()
    .eq('event_id', eventId)

  if (delErr) return { success: false, error: delErr.message }

  if (fields.length === 0) return { success: true, error: null }

  const rows = fields.map((f, i) => ({
    event_id: eventId,
    field_key: f.field_key,
    field_label: f.field_label,
    field_type: f.field_type,
    options: f.options || [],
    show_if: f.show_if || null,
    sort_order: i + 1,
    required: f.required ?? true,
    placeholder: f.placeholder || null,
  }))

  const { error: insertErr } = await supabase
    .from('event_fields')
    .insert(rows)

  if (insertErr) return { success: false, error: insertErr.message }
  return { success: true, error: null }
}

// ─── 模板管理 ─────────────────────────────────────────────

export async function getTemplates() {
  const { data, error } = await supabase
    .from('event_templates')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) return { templates: [], error: error.message }
  return { templates: data, error: null }
}

export async function createTemplate(name, fields) {
  const { data, error } = await supabase
    .from('event_templates')
    .insert({ name, fields })
    .select()
    .single()
  if (error) return { template: null, error: error.message }
  return { template: data, error: null }
}

export async function updateTemplate(templateId, { name, fields }) {
  const { error } = await supabase
    .from('event_templates')
    .update({ name, fields })
    .eq('template_id', templateId)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

export async function deleteTemplate(templateId) {
  const { error } = await supabase
    .from('event_templates')
    .delete()
    .eq('template_id', templateId)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

// ─── 報名查詢（後台）────────────────────────────────────────

/**
 * 取得某活動的所有報名紀錄（含學員姓名）
 */
export async function getRegistrationsWithStudents(eventId) {
  const { data, error } = await supabase
    .from('registrations')
    .select(`
      registration_id,
      student_id,
      answers,
      registered_at,
      checked_in_at,
      terminal,
      students ( name )
    `)
    .eq('event_id', eventId)
    .order('registered_at', { ascending: true })

  if (error) return { registrations: [], error: error.message }
  return { registrations: data || [], error: null }
}

// ─── 現場報到（後台）────────────────────────────────────────

/**
 * 查詢某活動中某學員的報名紀錄（報到用，用學員編號查）
 */
export async function getRegistrationForCheckin(eventId, studentId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('registration_id, answers, checked_in_at, students(name)')
    .eq('event_id', eventId)
    .eq('student_id', studentId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return { registration: null, error: 'NOT_REGISTERED' }
    return { registration: null, error: error.message }
  }
  return { registration: data, error: null }
}

/**
 * 查詢某活動中某報名紀錄（訪客報到用，用 registration_id 查）
 */
export async function getGuestRegistrationForCheckin(eventId, registrationId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('registration_id, answers, checked_in_at')
    .eq('registration_id', registrationId)
    .eq('event_id', eventId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return { registration: null, error: 'NOT_REGISTERED' }
    return { registration: null, error: error.message }
  }
  return { registration: data, error: null }
}

/**
 * 報到打卡
 */
export async function checkIn(registrationId) {
  const { error } = await supabase
    .from('registrations')
    .update({ checked_in_at: new Date().toISOString() })
    .eq('registration_id', registrationId)

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 全車到齊：把某台車所有成員一次標記為已報到
 */
export async function checkInAllCar(carId) {
  // 先取得此車所有 registration_id
  const { data, error: fetchErr } = await supabase
    .from('car_members')
    .select('registration_id')
    .eq('car_id', carId)

  if (fetchErr) return { success: false, error: fetchErr.message }

  const ids = (data ?? []).map(m => m.registration_id)
  if (ids.length === 0) return { success: true, error: null }

  const { error } = await supabase
    .from('registrations')
    .update({ checked_in_at: new Date().toISOString() })
    .in('registration_id', ids)
    .is('checked_in_at', null)   // 只更新尚未報到的

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 取消報到
 */
export async function uncheckIn(registrationId) {
  const { error } = await supabase
    .from('registrations')
    .update({ checked_in_at: null })
    .eq('registration_id', registrationId)

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 取得活動的報到統計（已報到人數 / 總報名人數）
 */
export async function getCheckinStats(eventId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('registration_id, checked_in_at')
    .eq('event_id', eventId)

  if (error) return { total: 0, checkedIn: 0, error: error.message }
  const total = data?.length ?? 0
  const checkedIn = data?.filter(r => r.checked_in_at).length ?? 0
  return { total, checkedIn, error: null }
}

// ─── 訪客報名（後台）────────────────────────────────────────

/**
 * 後台手動新增訪客報名
 */
export async function createGuestRegistration(eventId, guestName, answers) {
  const allAnswers = { guest_name: guestName, ...answers }
  const { data, error } = await supabase
    .from('registrations')
    .insert({
      event_id: eventId,
      student_id: null,
      answers: allAnswers,
      terminal: 'admin-guest',
    })
    .select('registration_id')
    .single()

  if (error) return { registrationId: null, error: error.message }
  return { registrationId: data.registration_id, error: null }
}

// ─── 學員管理（後台）────────────────────────────────────────

/**
 * 取得所有學員（含班別），支援姓名搜尋
 */
export async function deleteRegistration(registrationId) {
  const { error } = await supabase
    .from('registrations')
    .delete()
    .eq('registration_id', registrationId)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

// ─── 學員匯入（後台）────────────────────────────────────────

/**
 * 批次匯入學員資料
 * @param {Array<{student_id, name, class_name, group_name}>} rows
 */
export async function importStudents(rows) {
  // 依 student_id 去重，建立唯一學員清單
  const studentMap = new Map()
  for (const row of rows) {
    if (row.student_id && row.name && !studentMap.has(row.student_id)) {
      studentMap.set(row.student_id, {
        student_id: row.student_id,
        name: row.name,
        qr_code: row.student_id,
        active: true,
      })
    }
  }

  const studentRows = [...studentMap.values()]
  const studentIds = studentRows.map(s => s.student_id)

  if (studentRows.length === 0) {
    return { success: false, imported: 0, error: '沒有有效的學員資料' }
  }

  // 1. Upsert students（衝突時更新 name、qr_code，不動 created_at）
  const { error: studentErr } = await supabase
    .from('students')
    .upsert(studentRows, { onConflict: 'student_id' })

  if (studentErr) return { success: false, imported: 0, error: studentErr.message }

  // 2. 刪除這些學員的舊班別紀錄
  const { error: delErr } = await supabase
    .from('student_classes')
    .delete()
    .in('student_id', studentIds)

  if (delErr) return { success: false, imported: 0, error: delErr.message }

  // 3. 插入新班別紀錄（跳過沒有班級的列）
  const classRows = rows
    .filter(r => r.student_id && r.class_name?.trim())
    .map(r => ({
      student_id: r.student_id,
      class_name: r.class_name.trim(),
      group_name: r.group_name?.trim() || null,
    }))

  if (classRows.length > 0) {
    const { error: classErr } = await supabase
      .from('student_classes')
      .insert(classRows)

    if (classErr) return { success: false, imported: 0, error: classErr.message }
  }

  return { success: true, imported: studentRows.length, error: null }
}

// ─── 異動追蹤 ───────────────────────────────────────────────

/**
 * 記錄報名異動（不阻斷主流程，失敗只 console.warn）
 */
export async function logRegistrationChange({
  registrationId, eventId, eventName, studentName,
  changeType, oldAnswers, newAnswers,
}) {
  const { error } = await supabase
    .from('registration_changes')
    .insert({
      registration_id: registrationId ?? null,
      event_id: eventId,
      event_name: eventName ?? '',
      student_name: studentName ?? '',
      change_type: changeType,
      old_answers: oldAnswers ?? null,
      new_answers: newAnswers ?? null,
    })
  if (error) console.warn('[logRegistrationChange]', error.message)
}

/**
 * 取得活動的所有異動紀錄（後台用）
 */
export async function getEventChanges(eventId) {
  const { data, error } = await supabase
    .from('registration_changes')
    .select('*')
    .eq('event_id', eventId)
    .order('changed_at', { ascending: false })
  if (error) return { changes: [], error: error.message }
  return { changes: data || [], error: null }
}

/**
 * 記錄匯出時間點
 */
export async function recordExportTime(eventId) {
  const { error } = await supabase
    .from('events')
    .update({ last_exported_at: new Date().toISOString() })
    .eq('event_id', eventId)
  if (error) console.warn('[recordExportTime]', error.message)
}

// ─── 學員管理（後台）────────────────────────────────────────

// ─── 義工存取管理（後台）─────────────────────────────────────

/**
 * 同步義工 profile（義工登入時自動呼叫）
 */
export async function upsertVolunteerProfile(userId, email, displayName) {
  await supabase
    .from('volunteer_profiles')
    .upsert({
      id: userId,
      email: email || '',
      display_name: displayName || email || '',
      updated_at: new Date().toISOString(),
    })
}

/**
 * 取得所有義工帳號清單（後台用）
 */
export async function getVolunteers() {
  const { data, error } = await supabase
    .from('volunteer_profiles')
    .select('id, email, display_name')
    .order('display_name', { ascending: true })
  if (error) return { volunteers: [], error: error.message }
  return { volunteers: data || [], error: null }
}

/**
 * 取得活動已授權的義工 id 清單
 */
export async function getEventVolunteers(eventId) {
  const { data, error } = await supabase
    .from('volunteer_event_access')
    .select('volunteer_id')
    .eq('event_id', eventId)
  if (error) return { volunteerIds: [], error: error.message }
  return { volunteerIds: (data || []).map(r => r.volunteer_id), error: null }
}

/**
 * 設定活動的義工存取清單（全覆蓋）
 */
export async function setEventVolunteers(eventId, volunteerIds) {
  const { error: delErr } = await supabase
    .from('volunteer_event_access')
    .delete()
    .eq('event_id', eventId)
  if (delErr) return { success: false, error: delErr.message }
  if (volunteerIds.length === 0) return { success: true, error: null }
  const rows = volunteerIds.map(vid => ({ volunteer_id: vid, event_id: eventId }))
  const { error: insErr } = await supabase
    .from('volunteer_event_access')
    .insert(rows)
  if (insErr) return { success: false, error: insErr.message }
  return { success: true, error: null }
}

/**
 * 取得義工可見的活動列表（義工後台用）
 */
export async function getMyEvents(userId) {
  const { data: access, error: accessErr } = await supabase
    .from('volunteer_event_access')
    .select('event_id')
    .eq('volunteer_id', userId)
  if (accessErr) return { events: [], error: accessErr.message }
  if (!access || access.length === 0) return { events: [], error: null }
  const eventIds = access.map(r => r.event_id)
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .in('event_id', eventIds)
    .order('date_start', { ascending: false })
  if (error) return { events: [], error: error.message }
  return { events: data || [], error: null }
}

// ─── 排車系統（後台）────────────────────────────────────────

/**
 * 取得活動所有報名紀錄（含學員班別，排除訪客），供排車用
 */
export async function getEventRegistrationsDetail(eventId) {
  const { data, error } = await supabase
    .from('registrations')
    .select(`
      registration_id,
      student_id,
      answers,
      registered_at,
      students ( name, student_classes(class_name, group_name) )
    `)
    .eq('event_id', eventId)
    .order('registered_at', { ascending: true })

  if (error) return { registrations: [], error: error.message }
  return { registrations: data || [], error: null }
}

/**
 * 取得活動的排班結果（大車 + 小車，含成員、領隊、法師）
 * @param {string} eventId
 * @param {'up'|'down'|null} direction 方向，傳 null 取全部（向後相容）
 */
export async function getCarArrangement(eventId, direction = null) {
  let query = supabase
    .from('car_assignments')
    .select(`
      car_id, car_name, seats, car_type, note, access_token, sort_order, direction,
      car_members ( registration_id ),
      car_leaders ( registration_id ),
      car_monks ( id, monk_id, checked_in_at )
    `)
    .eq('event_id', eventId)

  if (direction) query = query.eq('direction', direction)

  const { data, error } = await query.order('sort_order', { ascending: true })

  if (error) return { cars: [], error: error.message }
  return { cars: data || [], error: null }
}

/**
 * 儲存排班結果（大車 + 小車，全量取代「指定方向」的車輛）
 * @param {string} eventId
 * @param {Array} largeCars   大車陣列
 * @param {Array} smallGroups 小車群組（finalSmallGroups，含 key=司機 reg_id、allMembers）
 * @param {'up'|'down'} direction 預設 'down'
 */
export async function saveCarArrangement(eventId, largeCars, smallGroups = [], direction = 'down') {
  // 只刪除此活動「指定方向」的車輛（CASCADE 刪 car_members、car_leaders、car_monks）
  // 注意：另一個方向的排車不能動
  const { error: delErr } = await supabase
    .from('car_assignments')
    .delete()
    .eq('event_id', eventId)
    .eq('direction', direction)

  if (delErr) return { success: false, error: delErr.message }
  if (largeCars.length === 0 && smallGroups.length === 0) return { success: true, error: null }

  // 組合所有車輛列
  const carRows = [
    ...largeCars.map((c, i) => ({
      event_id:  eventId,
      car_name:  c.car_name,
      seats:     c.seats,
      car_type:  'large',
      direction,
      note:      c.note || null,
      sort_order: i,
    })),
    ...smallGroups.map((g, i) => ({
      event_id:  eventId,
      car_name:  `小車 ${i + 1}`,
      seats:     g.allMembers.length,
      car_type:  'small',
      direction,
      note:      g.key,   // 司機的 registration_id，重載時用來重建孤兒指派
      sort_order: i,
    })),
  ]

  const { data: inserted, error: insErr } = await supabase
    .from('car_assignments')
    .insert(carRows)
    .select('car_id, car_type, sort_order')

  if (insErr) return { success: false, error: insErr.message }

  const largeIds = Object.fromEntries(inserted.filter(c => c.car_type === 'large').map(c => [c.sort_order, c.car_id]))
  const smallIds = Object.fromEntries(inserted.filter(c => c.car_type === 'small').map(c => [c.sort_order, c.car_id]))

  const memberRows = []
  const leaderRows = []

  for (let i = 0; i < largeCars.length; i++) {
    const carId = largeIds[i]
    if (!carId) continue
    for (const rid of largeCars[i].members) memberRows.push({ car_id: carId, registration_id: rid })
    for (const rid of largeCars[i].leaders) leaderRows.push({ car_id: carId, registration_id: rid })
  }

  for (let i = 0; i < smallGroups.length; i++) {
    const carId = smallIds[i]
    if (!carId) continue
    for (const r of smallGroups[i].allMembers) {
      memberRows.push({ car_id: carId, registration_id: r.registration_id })
    }
  }

  if (memberRows.length > 0) {
    const { error: mErr } = await supabase.from('car_members').insert(memberRows)
    if (mErr) return { success: false, error: mErr.message }
  }
  if (leaderRows.length > 0) {
    const { error: lErr } = await supabase.from('car_leaders').insert(leaderRows)
    if (lErr) return { success: false, error: lErr.message }
  }

  // 法師指派
  const monkRows = []
  for (let i = 0; i < largeCars.length; i++) {
    const carId = largeIds[i]
    if (!carId) continue
    for (const monkId of (largeCars[i].monks ?? [])) {
      monkRows.push({ car_id: carId, monk_id: monkId })
    }
  }
  if (monkRows.length > 0) {
    const { error: moErr } = await supabase.from('car_monks').insert(monkRows)
    if (moErr) return { success: false, error: moErr.message }
  }

  return { success: true, error: null }
}

/**
 * 取得活動的總領隊（type = 'all'）
 */
export async function getHeadLeader(eventId) {
  const { data, error } = await supabase
    .from('head_leader')
    .select('registration_id, access_token')
    .eq('event_id', eventId)
    .eq('type', 'all')
    .single()

  if (error) {
    if (error.code === 'PGRST116') return { headLeader: null, error: null }
    return { headLeader: null, error: error.message }
  }
  return { headLeader: data, error: null }
}

/**
 * 取得活動的小車領隊（type = 'small_car'）
 */
export async function getSmallCarLeader(eventId) {
  const { data, error } = await supabase
    .from('head_leader')
    .select('registration_id, access_token')
    .eq('event_id', eventId)
    .eq('type', 'small_car')
    .single()

  if (error) {
    if (error.code === 'PGRST116') return { headLeader: null, error: null }
    return { headLeader: null, error: error.message }
  }
  return { headLeader: data, error: null }
}

/**
 * 設定（或更新）活動的總領隊
 */
export async function setHeadLeader(eventId, registrationId) {
  const { error } = await supabase
    .from('head_leader')
    .upsert(
      { event_id: eventId, registration_id: registrationId, type: 'all' },
      { onConflict: 'event_id,type' }
    )

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 設定（或更新）活動的小車領隊
 */
export async function setSmallCarLeader(eventId, registrationId) {
  const { error } = await supabase
    .from('head_leader')
    .upsert(
      { event_id: eventId, registration_id: registrationId, type: 'small_car' },
      { onConflict: 'event_id,type' }
    )

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

// ─── 關係連結（後台）────────────────────────────────────────

/**
 * 取得所有群組（含成員的 student_id 和姓名）
 */
export async function getRelationshipGroups() {
  const { data, error } = await supabase
    .from('relationship_groups')
    .select(`
      group_id, name, note, created_at,
      relationship_members (
        id, student_id,
        students ( name )
      )
    `)
    .order('created_at', { ascending: false })

  if (error) return { groups: [], error: error.message }
  return { groups: data || [], error: null }
}

/**
 * 建立群組並加入成員
 * @param {string} name
 * @param {string} note
 * @param {string[]} studentIds
 */
export async function createRelationshipGroup(name, note, studentIds) {
  const { data, error } = await supabase
    .from('relationship_groups')
    .insert({ name, note: note || null })
    .select('group_id')
    .single()

  if (error) return { success: false, error: error.message }

  if (studentIds.length > 0) {
    const members = studentIds.map(sid => ({ group_id: data.group_id, student_id: sid }))
    const { error: mErr } = await supabase.from('relationship_members').insert(members)
    if (mErr) return { success: false, error: mErr.message }
  }

  return { success: true, groupId: data.group_id, error: null }
}

/**
 * 更新群組名稱/備註，並全量更新成員
 */
export async function updateRelationshipGroup(groupId, name, note, studentIds) {
  const { error } = await supabase
    .from('relationship_groups')
    .update({ name, note: note || null })
    .eq('group_id', groupId)

  if (error) return { success: false, error: error.message }

  // 全量替換成員
  const { error: delErr } = await supabase
    .from('relationship_members')
    .delete()
    .eq('group_id', groupId)
  if (delErr) return { success: false, error: delErr.message }

  if (studentIds.length > 0) {
    const members = studentIds.map(sid => ({ group_id: groupId, student_id: sid }))
    const { error: mErr } = await supabase.from('relationship_members').insert(members)
    if (mErr) return { success: false, error: mErr.message }
  }

  return { success: true, error: null }
}

/**
 * 刪除群組（成員自動 CASCADE）
 */
export async function deleteRelationshipGroup(groupId) {
  const { error } = await supabase
    .from('relationship_groups')
    .delete()
    .eq('group_id', groupId)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

// ─── 領隊報到頁（公開，token 驗證）────────────────────────────

/**
 * 用車輛 access_token 取得車輛資料（含成員報到狀態）
 * 公開頁面使用，不需登入
 */
export async function getCarByToken(token) {
  const { data, error } = await supabase
    .from('car_assignments')
    .select(`
      car_id, car_name, seats, event_id, sort_order, direction,
      events ( name, date_start ),
      car_members (
        registration_id,
        registrations (
          registration_id, answers, checked_in_at, student_id,
          students ( name )
        )
      ),
      car_leaders ( registration_id ),
      car_monks ( id, monk_id, checked_in_at, temple_monks ( name ) )
    `)
    .eq('access_token', token)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return { car: null, error: 'NOT_FOUND' }
    return { car: null, error: error.message }
  }
  return { car: data, error: null }
}

/**
 * 找出這個活動中，給定 registration_id 們作為領隊的所有車
 * 用於領隊報到頁顯示「切換到另一方向」Tab
 * 公開頁面使用，不需登入
 *
 * 兩步驟做：先用 leaderRegIds 找 car_id，再用 car_id 撈完整車輛資料
 * （避免用 PostgREST nested filter 在 anon RLS 下踩坑）
 */
export async function getLinkedCarsForLeader(eventId, leaderRegIds) {
  if (!leaderRegIds || leaderRegIds.length === 0) return { cars: [], error: null }

  // Step 1: 找出這些領隊作為 car_leader 的所有 car_id
  const { data: leaderRows, error: lErr } = await supabase
    .from('car_leaders')
    .select('car_id')
    .in('registration_id', leaderRegIds)

  if (lErr) return { cars: [], error: lErr.message }
  const carIds = [...new Set((leaderRows ?? []).map(r => r.car_id).filter(Boolean))]
  if (carIds.length === 0) return { cars: [], error: null }

  // Step 2: 取出這些車的完整資料（限定 event_id，避免跨活動誤抓）
  const { data, error } = await supabase
    .from('car_assignments')
    .select(`
      car_id, car_name, seats, event_id, sort_order, direction, access_token,
      events ( name, date_start ),
      car_members (
        registration_id,
        registrations (
          registration_id, answers, checked_in_at, student_id,
          students ( name )
        )
      ),
      car_leaders ( registration_id ),
      car_monks ( id, monk_id, checked_in_at, temple_monks ( name ) )
    `)
    .in('car_id', carIds)
    .eq('event_id', eventId)

  if (error) return { cars: [], error: error.message }
  return { cars: data ?? [], error: null }
}

/**
 * 用總領隊 access_token 取得活動資料
 * 公開頁面使用，不需登入
 */
export async function getHeadLeaderByToken(token) {
  const { data, error } = await supabase
    .from('head_leader')
    .select(`
      id, registration_id, event_id, type,
      events ( event_id, name, date_start ),
      registrations ( answers, student_id, students ( name ) )
    `)
    .eq('access_token', token)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return { headLeader: null, error: 'NOT_FOUND' }
    return { headLeader: null, error: error.message }
  }
  return { headLeader: data, error: null }
}

/**
 * 取得活動所有車的報到進度（總領隊看板用，大車＋小車）
 */
export async function getAllCarsProgress(eventId) {
  const { data, error } = await supabase
    .from('car_assignments')
    .select(`
      car_id, car_name, seats, sort_order, car_type, direction,
      car_leaders ( registration_id ),
      car_members (
        registration_id,
        registrations (
          registration_id, answers, checked_in_at, student_id,
          students ( name )
        )
      ),
      car_monks ( id, monk_id, checked_in_at, temple_monks ( name ) )
    `)
    .eq('event_id', eventId)
    .order('car_type', { ascending: false })   // large 排前面
    .order('sort_order', { ascending: true })

  if (error) return { cars: [], error: error.message }
  return { cars: data || [], error: null }
}

/**
 * 取得活動所有小車的報到進度（小車領隊看板用）
 */
export async function getAllSmallCarsProgress(eventId) {
  const { data, error } = await supabase
    .from('car_assignments')
    .select(`
      car_id, car_name, seats, sort_order, car_type, direction,
      car_leaders ( registration_id ),
      car_members (
        registration_id,
        registrations (
          registration_id, answers, checked_in_at, student_id,
          students ( name )
        )
      )
    `)
    .eq('event_id', eventId)
    .eq('car_type', 'small')
    .order('sort_order', { ascending: true })

  if (error) return { cars: [], error: error.message }
  return { cars: data || [], error: null }
}

/**
 * 根據學員 QR code（student_id）找出該學員在有效活動中的領隊角色
 * 用於 /leader 掃卡入口頁
 * 回傳 roles 陣列，每筆包含 { type, token, eventId, eventName, carName? }
 */
export async function findLeaderByStudentId(studentId) {
  // Step 1：找出該學員的所有 registration_id
  const { data: regData, error: regErr } = await supabase
    .from('registrations')
    .select('registration_id, event_id')
    .eq('student_id', studentId)

  if (regErr || !regData?.length) return { roles: [] }

  const regIds = regData.map(r => r.registration_id)

  // Step 2：查是否為某台大車的領隊
  const { data: carLeaderData } = await supabase
    .from('car_leaders')
    .select(`
      registration_id,
      car_assignments (
        car_name, access_token, car_type,
        events ( event_id, name, status )
      )
    `)
    .in('registration_id', regIds)

  // Step 3：查是否為總領隊或小車領隊
  const { data: headLeaderData } = await supabase
    .from('head_leader')
    .select(`
      registration_id, type, access_token,
      events ( event_id, name, status )
    `)
    .in('registration_id', regIds)

  const roles = []

  for (const cl of carLeaderData || []) {
    const car = cl.car_assignments
    if (!car || car.events?.status !== 'active') continue
    roles.push({
      type: 'car',
      token: car.access_token,
      eventId: car.events.event_id,
      eventName: car.events.name,
      carName: car.car_name,
    })
  }

  for (const hl of headLeaderData || []) {
    if (hl.events?.status !== 'active') continue
    roles.push({
      type: hl.type,           // 'all' or 'small_car'
      token: hl.access_token,
      eventId: hl.events.event_id,
      eventName: hl.events.name,
      carName: null,
    })
  }

  return { roles }
}

// ─── 法師管理（後台）────────────────────────────────────────

/**
 * 取得法師名單（預設只取 active=true）
 */
export async function getMonks(includeInactive = false) {
  let query = supabase
    .from('temple_monks')
    .select('id, name, notes, active, created_at')
    .order('created_at', { ascending: true })

  if (!includeInactive) query = query.eq('active', true)

  const { data, error } = await query
  if (error) return { monks: [], error: error.message }
  return { monks: data || [], error: null }
}

/**
 * 新增法師
 */
export async function createMonk(name, notes) {
  const { data, error } = await supabase
    .from('temple_monks')
    .insert({ name, notes: notes || null })
    .select('id')
    .single()
  if (error) return { success: false, error: error.message }
  return { success: true, id: data.id, error: null }
}

/**
 * 更新法師資料
 */
export async function updateMonk(id, { name, notes, active }) {
  const fields = {}
  if (name     !== undefined) fields.name   = name
  if (notes    !== undefined) fields.notes  = notes || null
  if (active   !== undefined) fields.active = active

  const { error } = await supabase
    .from('temple_monks')
    .update(fields)
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 刪除法師（硬刪除，car_monks 會 CASCADE 清除）
 */
export async function deleteMonk(id) {
  const { error } = await supabase
    .from('temple_monks')
    .delete()
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 法師報到（更新 car_monks.checked_in_at）
 */
export async function checkInMonk(carMonkId) {
  const { error } = await supabase
    .from('car_monks')
    .update({ checked_in_at: new Date().toISOString() })
    .eq('id', carMonkId)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * 取消法師報到
 */
export async function uncheckInMonk(carMonkId) {
  const { error } = await supabase
    .from('car_monks')
    .update({ checked_in_at: null })
    .eq('id', carMonkId)
  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

// ─── 學員管理（後台）────────────────────────────────────────

export async function getAllStudents(search = '') {
  let query = supabase
    .from('students')
    .select(`
      student_id,
      name,
      active,
      created_at,
      student_classes ( class_name, group_name )
    `)
    .order('student_id', { ascending: true })

  if (search.trim()) {
    query = query.ilike('name', `%${search.trim()}%`)
  }

  const { data, error } = await query

  if (error) return { students: [], error: error.message }
  return { students: data || [], error: null }
}
