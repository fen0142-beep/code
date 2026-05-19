import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import { getAllEvents, createEvent, getMyEvents } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

const STATUS_LABEL = { draft: '草稿', active: '進行中', closed: '已關閉' }
const STATUS_COLOR = {
  draft:  'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
}

export default function EventsPage() {
  const navigate = useNavigate()
  const { isAdmin, user } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', date_start: '', date_end: '', location: '', status: 'draft', event_type: 'mountain', is_dharma: false, multi_session: false })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    if (isAdmin) {
      const { events } = await getAllEvents()
      setEvents(events)
    } else {
      // 義工只能看到師父指定的活動
      const { events } = await getMyEvents(user?.id)
      setEvents(events)
    }
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')
    setSaving(true)

    const { event, error } = await createEvent({
      name: form.name,
      date_start: form.date_start || null,
      date_end: form.date_end || null,
      location: form.location,
      status: form.status,
      event_type: form.event_type,
      is_dharma: form.is_dharma,
      multi_session: form.multi_session,
    })

    setSaving(false)

    if (error) {
      setFormError(error)
      return
    }

    setShowForm(false)
    setForm({ name: '', date_start: '', date_end: '', location: '', status: 'draft', event_type: 'mountain', is_dharma: false, multi_session: false })
    navigate(`/admin/events/${event.event_id}`)
  }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">活動管理</h2>
        {isAdmin && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            ＋ 新增活動
          </button>
        )}
      </div>

      {/* 新增活動表單 */}
      {showForm && (
        <div className="bg-white border border-amber-200 rounded-xl p-6 mb-6 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4">新增活動</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">活動名稱 *</label>
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="例：2026 祖忌法會"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">開始日期</label>
              <input
                type="date"
                value={form.date_start}
                onChange={e => setForm(f => ({ ...f, date_start: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">結束日期</label>
              <input
                type="date"
                value={form.date_end}
                onChange={e => setForm(f => ({ ...f, date_end: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">地點</label>
              <input
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="例：普宜精舍大殿"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">活動類型 *</label>
              <select
                value={form.event_type}
                onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="mountain">回山活動（看板顯示交通資訊）</option>
                <option value="temple">精舍活動（看板顯示午齋／停車）</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">狀態</label>
              <select
                value={form.status}
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
                  checked={form.is_dharma}
                  onChange={e => setForm(f => ({ ...f, is_dharma: e.target.checked }))}
                  className="w-4 h-4 accent-amber-600"
                />
                此為精舍法會活動（勾選後可設定法會報到時，出現功德主相關資訊）
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.multi_session}
                  onChange={e => setForm(f => ({ ...f, multi_session: e.target.checked }))}
                  className="w-4 h-4 accent-emerald-600"
                />
                <span>
                  多場次報名
                  <span className="text-xs text-gray-500 ml-1">（梁皇寶懺等多日法會用；學員可一次勾選多場）</span>
                </span>
              </label>
            </div>

            {formError && (
              <p className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formError}
              </p>
            )}

            <div className="sm:col-span-2 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? '儲存中…' : '建立活動'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 活動列表 */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">載入中…</p>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          {isAdmin
            ? <p className="text-sm">尚無活動，點上方按鈕新增第一場</p>
            : <p className="text-sm">尚未被指定任何活動，請聯絡師父設定</p>
          }
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(ev => (
            <Link
              key={ev.event_id}
              to={`/admin/events/${ev.event_id}`}
              className="block bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-amber-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800">{ev.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {ev.date_start || '日期未設定'}
                    {ev.date_end && ev.date_end !== ev.date_start ? ` ～ ${ev.date_end}` : ''}
                    {ev.location ? `　${ev.location}` : ''}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[ev.status]}`}>
                  {STATUS_LABEL[ev.status]}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AdminLayout>
  )
}
