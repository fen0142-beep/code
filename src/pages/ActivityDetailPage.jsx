import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getPublicActivity } from '../lib/supabase'

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

export default function ActivityDetailPage() {
  const { id } = useParams()
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    getPublicActivity(id).then(({ data, error }) => {
      if (error || !data) setNotFound(true)
      else setEvent(data)
      setLoading(false)
    })
  }, [id])

  const locationTag = event?.location_tag ?? 'zhongtai'
  const locationLabel =
    locationTag === 'other'
      ? (event?.location || '其他')
      : locationTag === 'tianxiang'
        ? '天祥寶塔禪寺'
        : '中台禪寺'
  const locationColor = LOCATION_COLORS[locationTag] ?? LOCATION_COLORS.other
  const gradient = PLACEHOLDER_GRADIENTS[0]

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

      <main className="max-w-xl mx-auto px-4 py-8">
        <Link to="/activities" className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-700 mb-6">
          ← 返回活動列表
        </Link>

        {loading && (
          <p className="text-center text-gray-400 py-20">載入中…</p>
        )}

        {!loading && notFound && (
          <div className="text-center py-20 space-y-4">
            <p className="text-gray-500">找不到此活動，或活動尚未公開。</p>
            <Link to="/activities" className="inline-block px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm hover:bg-emerald-600 transition-colors">
              返回活動列表
            </Link>
          </div>
        )}

        {!loading && event && (
          <div className="space-y-5">
            {/* 封面圖 */}
            <div className="aspect-video w-full overflow-hidden rounded-2xl">
              {event.cover_image_url ? (
                <img
                  src={event.cover_image_url}
                  alt={event.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                  <span className="text-6xl opacity-50">🪷</span>
                </div>
              )}
            </div>

            {/* 標題區 */}
            <div className="space-y-2">
              <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${locationColor}`}>
                {locationLabel}
              </span>
              <h1 className="text-2xl font-bold text-gray-900 leading-snug">{event.name}</h1>
              <p className="text-sm text-gray-600">📅 {formatDateRange(event.date_start, event.date_end)}</p>
              {event.location && (
                <p className="text-sm text-gray-600">📍 {event.location}</p>
              )}
            </div>

            {/* 說明文字 */}
            {event.description && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">活動說明</p>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {event.description}
                </p>
              </div>
            )}

            {/* 報名按鈕 */}
            <div className="pt-2">
              <RegistrationButton event={event} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
