import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getPublicActivities } from '../lib/supabase'

const PLACEHOLDER_GRADIENTS = [
  'from-amber-100 to-amber-200',
  'from-blue-100 to-blue-200',
  'from-emerald-100 to-emerald-200',
  'from-purple-100 to-purple-200',
  'from-rose-100 to-rose-200',
]

const LOCATION_COLORS = {
  zhongtai:  'bg-blue-100 text-blue-800',
  tianxiang: 'bg-green-100 text-green-800',
  other:     'bg-gray-100 text-gray-700',
}

function formatDateRange(start, end) {
  if (!start) return '日期待定'
  const s = new Date(start)
  const sm = s.getMonth() + 1
  const sd = s.getDate()
  if (!end || end === start) return `${sm}/${sd}`
  const e = new Date(end)
  const em = e.getMonth() + 1
  const ed = e.getDate()
  if (sm === em) return `${sm}/${sd}–${ed}`
  return `${sm}/${sd}–${em}/${ed}`
}

function groupByMonth(activities) {
  const groups = {}
  for (const a of activities) {
    const month = a.date_start ? new Date(a.date_start).getMonth() + 1 : 0
    const key = month === 0 ? '待定' : `${month} 月`
    if (!groups[key]) groups[key] = []
    groups[key].push(a)
  }
  return groups
}

function RegistrationButton({ event }) {
  if (event.offline_registration) {
    return (
      <span className="inline-block w-full text-center py-2 px-4 rounded-lg bg-gray-100 text-gray-500 text-sm">
        報名請洽精舍
      </span>
    )
  }
  if (event.status === 'active') {
    return (
      <Link
        to={`/?event=${event.event_id}`}
        className="inline-block w-full text-center py-2 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors"
        onClick={e => e.stopPropagation()}
      >
        點我報名 →
      </Link>
    )
  }
  return (
    <span className="inline-block w-full text-center py-2 px-4 rounded-lg bg-gray-100 text-gray-400 text-sm">
      尚未開放報名
    </span>
  )
}

function ActivityCard({ event, index }) {
  const locationTag = event.location_tag ?? 'zhongtai'
  const locationLabel =
    locationTag === 'other'
      ? (event.location || '其他')
      : locationTag === 'tianxiang'
        ? '天祥寶塔禪寺'
        : '中台禪寺'
  const locationColor = LOCATION_COLORS[locationTag] ?? LOCATION_COLORS.other
  const gradient = PLACEHOLDER_GRADIENTS[index % PLACEHOLDER_GRADIENTS.length]

  return (
    <Link
      to={`/activities/${event.event_id}`}
      className="block rounded-2xl overflow-hidden shadow-sm border border-gray-100 bg-white hover:shadow-md transition-shadow"
    >
      {/* 封面圖 */}
      <div className="aspect-video w-full overflow-hidden">
        {event.cover_image_url ? (
          <img
            src={event.cover_image_url}
            alt={event.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
            <span className="text-4xl opacity-60">🪷</span>
          </div>
        )}
      </div>

      {/* 內容 */}
      <div className="p-4 space-y-2">
        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${locationColor}`}>
          {locationLabel}
        </span>
        <p className="text-base font-bold text-gray-900 leading-snug">{event.name}</p>
        <p className="text-sm text-gray-500">📅 {formatDateRange(event.date_start, event.date_end)}</p>
        <div className="pt-1">
          <RegistrationButton event={event} />
        </div>
      </div>
    </Link>
  )
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getPublicActivities().then(({ data, error }) => {
      if (error) setError(error)
      else setActivities(data || [])
      setLoading(false)
    })
  }, [])

  const groups = groupByMonth(activities)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <img
          src="/logo.png"
          alt="普宜精舍"
          className="w-8 h-8 rounded"
          onError={e => { e.target.style.display = 'none' }}
        />
        <div>
          <p className="text-sm font-semibold text-gray-800">普宜精舍</p>
          <p className="text-xs text-gray-500">中台禪寺所屬精舍</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">活動介紹</h1>
        <p className="text-sm text-gray-500 mb-8">115 年度活動一覽，點入活動可查看詳細說明</p>

        {loading && (
          <p className="text-center text-gray-400 py-20">載入中…</p>
        )}
        {error && (
          <p className="text-center text-red-500 py-20">載入失敗：{error}</p>
        )}

        {!loading && !error && activities.length === 0 && (
          <p className="text-center text-gray-400 py-20">目前尚無公開活動</p>
        )}

        {!loading && !error && Object.entries(groups).map(([month, list]) => (
          <section key={month} className="mb-10">
            <h2 className="text-lg font-semibold text-gray-700 mb-4 border-b border-gray-200 pb-1">
              {month}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {list.map((event, i) => (
                <ActivityCard
                  key={event.event_id}
                  event={event}
                  index={activities.indexOf(event)}
                />
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
