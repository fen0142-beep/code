import { toggleEventLock, uploadEventCoverImage } from '../lib/supabase'
import ImagePositionEditor from './ImagePositionEditor'
import EventSessionFieldsPanel from './EventSessionFieldsPanel'
import EventSessionsPanel from './EventSessionsPanel'

export default function EventInfoTab({ saving, handleSaveInfo, form, setForm, event, setEvent, id, locking, setLocking, setSaveMsg, deleting, handleDeleteEvent, registrations, volunteers, eventVolunteerIds, setEventVolunteerIds, sessions, setSessions, setSessionTab }) {
  return (
<>
    {/* 頂部儲存列（藍色主按鈕，提升優先級） */}
    <div className="sticky top-0 z-10 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3 shadow-sm">
      <div className="text-sm text-blue-800 min-w-0">
        <p className="font-semibold">活動設定</p>
        <p className="text-xs text-blue-600/80 truncate">修改任一欄位後請按右側按鈕儲存</p>
      </div>
      <button
        type="submit"
        form="event-info-form"
        disabled={saving}
        className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50 shadow"
      >
        {saving ? '儲存中…' : '💾 儲存設定'}
      </button>
    </div>

    <form id="event-info-form" onSubmit={handleSaveInfo} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-600 mb-1">活動名稱 *</label>
          <input
            required
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">開始日期</label>
          <input type="date" value={form.date_start}
            onChange={e => setForm(f => ({ ...f, date_start: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">結束日期</label>
          <input type="date" value={form.date_end}
            onChange={e => setForm(f => ({ ...f, date_end: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">地點</label>
          <input value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">活動類型 *</label>
          <select value={form.event_type ?? 'mountain'}
            onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="mountain">外出活動（看板顯示交通資訊）</option>
            <option value="temple">精舍活動（看板顯示午齋／停車）</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">狀態</label>
          <select value={form.status}
            onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="draft">草稿</option>
            <option value="active">進行中</option>
            <option value="closed">已關閉</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!form.is_dharma}
              onChange={e => setForm(f => ({ ...f, is_dharma: e.target.checked }))}
              className="w-4 h-4 accent-amber-600"
            />
            此為精舍法會活動（勾選後可設定法會報到時，出現功德主相關資訊）
          </label>
        </div>
        {/* 多場次報名 — 精舍活動即可啟用，不須限定法會 */}
        {form.event_type === 'temple' && (
          <div className="sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!form.multi_session}
                onChange={e => setForm(f => ({ ...f, multi_session: e.target.checked }))}
                className="w-4 h-4 accent-indigo-600"
              />
              啟用多場次報名（適用梁皇寶懺等多日法會，學員一次勾選所有場次）
            </label>
          </div>
        )}
        {/* 對外公開排車資訊 — 任何活動皆可開（回山活動最常用，但精舍也可能臨時用） */}
        <div className="sm:col-span-2">
          <label className="inline-flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!form.show_transport_to_public}
              onChange={e => setForm(f => ({ ...f, show_transport_to_public: e.target.checked }))}
              className="w-4 h-4 accent-blue-600 mt-0.5"
            />
            <span>
              對外公開排車資訊（勾選後，學員在前台刷卡可看到自己的車次）
              <span className="block text-xs text-gray-500 mt-0.5">
                排車作業中請保持關閉；確認排車定案後再開啟
              </span>
            </span>
          </label>
        </div>

        {/* ── 報名方式 ─────────────────────────────────────── */}
        <div className="sm:col-span-2">
          {(() => {
            // 從現有欄位推算目前模式
            const regMode = form.walkin_mode ? 'walkin'
              : form.offline_registration ? 'offline'
              : form.kiosk_open ? 'kiosk'
              : 'none'

            // 切換時同步設定底層三個欄位
            function handleRegMode(mode) {
              setForm(f => ({
                ...f,
                kiosk_open: mode === 'kiosk' || mode === 'walkin',
                walkin_mode: mode === 'walkin',
                offline_registration: mode === 'offline',
              }))
            }

            // 預覽內容
            const preview = {
              kiosk: {
                btn: form.show_on_activities ? '「點我報名」' : '（不顯示）',
                kiosk: '✅ 會出現',
                kioskColor: 'text-green-700',
                form: '✅ 需填報名資料',
                formColor: 'text-green-700',
                scene: form.show_on_activities ? '一般法會、禪修活動' : '內部活動，只現場刷卡不對外公告',
              },
              walkin: {
                btn: form.show_on_activities ? '「現場刷卡即可參加」' : '（不顯示）',
                kiosk: '✅ 會出現',
                kioskColor: 'text-green-700',
                form: '❌ 不需填資料',
                formColor: 'text-gray-500',
                scene: form.show_on_activities ? '共修、早課等有公告的自由參加' : '純統計到場人數，不對外公告',
              },
              offline: {
                btn: form.show_on_activities ? '「報名請洽精舍」' : '（不顯示）',
                kiosk: '❌ 不出現',
                kioskColor: 'text-gray-400',
                form: '❌ 不需填資料',
                formColor: 'text-gray-500',
                scene: form.show_on_activities ? '星燈營等需電話或現場洽詢的活動' : '（少用）洽詢型活動暫不公告',
              },
              none: {
                btn: form.show_on_activities ? '「敬請期待」' : '（不顯示）',
                kiosk: '❌ 不出現',
                kioskColor: 'text-gray-400',
                form: '❌ 不需填資料',
                formColor: 'text-gray-500',
                scene: form.show_on_activities ? '活動預告中，報名尚未開始' : '草稿階段，尚未準備好',
              },
            }[regMode]

            return (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">報名方式</label>
                  <select
                    value={regMode}
                    onChange={e => handleRegMode(e.target.value)}
                    className="w-full sm:w-72 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="kiosk">線上刷卡報名（一般活動）</option>
                    <option value="walkin">自由刷卡參加（無需填表）</option>
                    <option value="offline">洽詢精舍報名（電話／現場）</option>
                    <option value="none">暫不開放報名</option>
                  </select>
                </div>

                {/* 預覽面板 */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm">
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">介紹頁按鈕</p>
                      <p className="font-medium text-gray-800 text-xs">{preview.btn}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">刷卡報到頁</p>
                      <p className={`font-medium text-xs ${preview.kioskColor}`}>{preview.kiosk}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">需填報名資料</p>
                      <p className={`font-medium text-xs ${preview.formColor}`}>{preview.form}</p>
                    </div>
                  </div>
                  <div className="border-t border-gray-200 mt-2 pt-2">
                    <p className="text-xs text-gray-400 mb-0.5">適用場景</p>
                    <p className="text-xs text-gray-500">{preview.scene}</p>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {/* ── 活動介紹頁設定 ─────────────────────────────── */}
        <div className="sm:col-span-2 mt-2">
          <div className="border border-emerald-200 rounded-xl p-4 bg-emerald-50 space-y-4">
            <p className="text-sm font-semibold text-emerald-800">🌐 活動介紹頁設定（/activities）</p>

            {/* 顯示開關 */}
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!form.show_on_activities}
                onChange={e => setForm(f => ({ ...f, show_on_activities: e.target.checked }))}
                className="w-4 h-4 accent-emerald-600 mt-0.5"
              />
              <span>
                顯示在活動介紹頁
                <span className="block text-xs text-gray-500 mt-0.5">
                  勾選後學員可在 /activities 看到此活動；取消勾選可隱藏（明年複用時只需改日期再勾回）
                </span>
              </span>
            </label>

            {/* 地點標籤 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">地點標籤</label>
              <select
                value={form.location_tag ?? 'zhongtai'}
                onChange={e => setForm(f => ({ ...f, location_tag: e.target.value }))}
                className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="zhongtai">📍 中台禪寺</option>
                <option value="tianxiang">📍 天祥寶塔禪寺</option>
                <option value="puyi">📍 {import.meta.env.VITE_TEMPLE_NAME}</option>
                <option value="other">📍 其他（以「地點」欄文字為主）</option>
              </select>
            </div>

            {/* 活動說明 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">活動說明</label>
              <textarea
                value={form.description ?? ''}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={5}
                placeholder="介紹活動緣起、流程、注意事項等，學員在介紹頁可閱讀此內容"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-y"
              />
            </div>

            {/* 封面圖片 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">活動封面圖片</label>
              <input
                type="file"
                accept="image/*"
                onChange={async e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (file.size > 2 * 1024 * 1024) {
                    alert('圖片請小於 2MB')
                    return
                  }
                  const { url, error } = await uploadEventCoverImage(event.event_id, file)
                  if (error) { alert('上傳失敗：' + error); return }
                  setForm(f => ({ ...f, cover_image_url: url }))
                }}
                className="text-sm text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-emerald-100 file:text-emerald-700 hover:file:bg-emerald-200 cursor-pointer"
              />
              <p className="text-xs text-gray-400 mt-1">
                建議尺寸 1200×675（16:9），檔案大小 2MB 以內。上傳後請點「儲存設定」。
              </p>
              {form.cover_image_url && (
                <ImagePositionEditor
                  url={form.cover_image_url}
                  position={form.cover_image_position}
                  onChange={val => setForm(f => ({ ...f, cover_image_position: val }))}
                />
              )}
            </div>
          </div>

          {/* 相關連結 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              相關連結
              <span className="text-xs text-gray-400 ml-2">（前台顯示標題，不顯示網址）</span>
            </label>
            {(form.related_links || []).map((link, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <input
                  type="text"
                  placeholder="顯示標題，例：開山祖師開示：開悟三帖藥"
                  value={link.title}
                  onChange={e => { const ls=[...(form.related_links||[])]; ls[i]={...ls[i],title:e.target.value}; setForm(f=>({...f,related_links:ls})) }}
                  className="flex-1 border rounded px-3 py-1.5 text-sm"
                />
                <input
                  type="url"
                  placeholder="網址"
                  value={link.url}
                  onChange={e => { const ls=[...(form.related_links||[])]; ls[i]={...ls[i],url:e.target.value}; setForm(f=>({...f,related_links:ls})) }}
                  className="flex-1 border rounded px-3 py-1.5 text-sm"
                />
                <button type="button"
                  onClick={() => setForm(f=>({...f,related_links:(f.related_links||[]).filter((_,idx)=>idx!==i)}))}
                  className="text-red-500 hover:text-red-700 text-sm px-2">✕</button>
              </div>
            ))}
            <button type="button"
              onClick={() => setForm(f=>({...f,related_links:[...(f.related_links||[]),{title:'',url:''}]}))}
              className="text-sm text-blue-600 hover:underline mt-1">
              ＋ 新增連結
            </button>
          </div>
        </div>
      </div>
      {/* （原本底部的儲存按鈕已移至頁面頂部 sticky bar） */}
    </form>

    {/* 多場次場次設定 */}
    {form.multi_session && event?.event_id && (
      <>
        <EventSessionFieldsPanel eventId={event.event_id} />
        <EventSessionsPanel eventId={event.event_id} onSaved={fresh => { setSessions(fresh || []); if (fresh?.length > 0) setSessionTab(fresh[0].session_id) }} />
      </>
    )}

    {/* 停止異動區塊 */}
    <div className={`mt-4 rounded-xl border-2 p-5 flex items-start gap-4 ${
      event.locked
        ? 'border-red-300 bg-red-50'
        : 'border-gray-200 bg-white'
    }`}>
      <div className="flex-1">
        <p className={`text-sm font-semibold ${event.locked ? 'text-red-700' : 'text-gray-700'}`}>
          {event.locked ? '🔒 報名已鎖定（停止異動中）' : '🔓 報名開放中'}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {event.locked
            ? '前台學員只能查看報名資料，無法新增、修改或取消。如需調整請在此解鎖。'
            : '按下「停止異動」後，前台將顯示「如需異動請聯絡精舍」，學員無法自行新增或取消報名。'}
        </p>
      </div>
      <button
        disabled={locking}
        onClick={async () => {
          setLocking(true)
          const newLocked = !event.locked
          const { success, error: err } = await toggleEventLock(id, newLocked)
          setLocking(false)
          if (!success) { setSaveMsg(`❌ 操作失敗：${err}`); return }
          setEvent(ev => ({ ...ev, locked: newLocked }))
          if (!newLocked) setForm(f => ({ ...f, volunteer_open: false }))
          setSaveMsg(newLocked ? '🔒 已停止異動' : '🔓 已開放異動')
          setTimeout(() => setSaveMsg(''), 3000)
        }}
        className={`shrink-0 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${
          event.locked
            ? 'bg-white border-2 border-red-400 text-red-700 hover:bg-red-100'
            : 'bg-red-600 hover:bg-red-700 text-white'
        }`}
      >
        {locking ? '處理中…' : event.locked ? '🔓 解除鎖定' : '🔒 停止異動'}
      </button>
    </div>

    {/* 義工開放模式（鎖定時才顯示，隨儲存設定一起送出） */}
    {event.locked && (
      <div style={{
        marginTop: '8px',
        marginLeft: '28px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
      }}>
        <input
          type="checkbox"
          id="volunteer_open"
          checked={!!form.volunteer_open}
          onChange={e => setForm(f => ({ ...f, volunteer_open: e.target.checked }))}
          style={{ marginTop: '3px', accentColor: '#16a34a' }}
        />
        <label htmlFor="volunteer_open" style={{ fontSize: '0.85rem', color: '#374151', cursor: 'pointer' }}>
          開放義工繼續報名
          <span style={{ display: 'block', fontSize: '0.75rem', color: '#9CA3AF', marginTop: '2px' }}>
            勾選後，刷卡頁仍可報名，但身分別固定為「義工」。勾選後請按頂部「💾 儲存設定」。
          </span>
        </label>
      </div>
    )}

    {/* 義工存取設定（勾選後請按頂部「💾 儲存設定」一併儲存） */}
    <div className="mt-4 bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-1">👤 義工存取設定</p>
      <p className="text-xs text-gray-500 mb-3">
        勾選的義工帳號登入後台後，即可看到此活動的報名名單。
        <span className="text-amber-600">修改後請按頂部「💾 儲存設定」一併儲存。</span>
      </p>
      {volunteers.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">
          尚無義工帳號紀錄。義工以義工帳號登入後台一次後，即會自動出現在此。
        </p>
      ) : (
        <div className="space-y-1">
          {volunteers.map(v => (
            <label key={v.id} className="flex items-center gap-3 cursor-pointer select-none px-2 py-2 rounded-lg hover:bg-gray-50">
              <input
                type="checkbox"
                checked={eventVolunteerIds.has(v.id)}
                onChange={e => {
                  setEventVolunteerIds(prev => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(v.id)
                    else next.delete(v.id)
                    return next
                  })
                }}
                className="w-4 h-4 accent-amber-600 shrink-0"
              />
              <div className="min-w-0">
                <span className="text-sm font-medium text-gray-700">
                  {v.display_name && v.display_name !== v.email ? v.display_name : ''}
                </span>
                <span className="text-xs text-gray-500 ml-1">{v.email}</span>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>

    {/* 刪除活動（移至最下方，降權為灰色） */}
    <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-4 flex items-start gap-3">
      <div className="flex-1 text-xs text-gray-500">
        <p className="font-medium text-gray-600">刪除活動</p>
        <p className="mt-0.5">
          刪除後，活動設定、動態欄位與所有報名紀錄將永久移除，無法復原。
          {registrations.length > 0 && (
            <span className="text-red-500"> 目前有 {registrations.length} 筆報名紀錄。</span>
          )}
        </p>
      </div>
      <button
        disabled={deleting}
        onClick={handleDeleteEvent}
        className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-500 bg-white hover:bg-gray-100 hover:text-red-600 hover:border-red-300 transition-colors disabled:opacity-50"
      >
        {deleting ? '刪除中…' : '🗑 刪除活動'}
      </button>
    </div>
    </>
  )
}
