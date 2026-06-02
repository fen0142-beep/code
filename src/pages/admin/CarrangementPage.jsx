import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import AdminLayout from '../../components/AdminLayout'
import { getAllEvents } from '../../lib/supabase'

const STATUS_LABEL = { draft: '草稿', active: '進行中', closed: '已結束' }
const STATUS_COLOR = {
  draft:  'bg-gray-100 text-gray-500',
  active: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-400',
}

function formatDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`
}

export default function CarrangementPage() {
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAllEvents().then(({ events }) => {
      setEvents((events || []).filter(ev => ev.event_type === 'mountain' && ev.status === 'active'))
      setLoading(false)
    })
  }, [])

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">排車系統</h1>
          <p className="text-sm text-gray-500 mt-0.5">選擇活動後進行大車排班、小車配對與領隊指派</p>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400">載入中…</div>
        ) : events.length === 0 ? (
          <div className="text-center py-20 text-gray-400">目前沒有進行中的外出活動</div>
        ) : (
          <div className="space-y-2">
            {events.map(ev => (
              <button
                key={ev.event_id}
                onClick={() => navigate(`/admin/carrangement/${ev.event_id}`)}
                className="w-full text-left bg-white border rounded-xl px-5 py-4 shadow-sm hover:border-amber-400 hover:shadow-md transition-all group"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold text-gray-800 group-hover:text-amber-700 transition-colors flex-1">
                    {ev.name}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[ev.status]}`}>
                    {STATUS_LABEL[ev.status]}
                  </span>
                  <span className="text-sm text-gray-400 shrink-0">
                    {formatDate(ev.date_start)}
                    {ev.date_end && ev.date_end !== ev.date_start && ` — ${formatDate(ev.date_end)}`}
                  </span>
                  <span className="text-amber-600 text-sm group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
