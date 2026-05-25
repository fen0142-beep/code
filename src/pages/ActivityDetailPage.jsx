import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getPublicActivity } from '../lib/supabase'

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

function LocationBadge({ tag }) {
  const config = {
    zhongtai:  { label: '中台禪寺', borderColor: '#C9A96E', color: '#C9A96E' },
    tianxiang: { label: '天祥寶塔', borderColor: '#7FAFC0', color: '#7FAFC0' },
    other:     { label: '精舍',     borderColor: '#8FAF8A', color: '#8FAF8A' },
  }
  const c = config[tag] || config.other
  return (
    <span style={{
      border: `1px solid ${c.borderColor}`,
      color: c.color,
      backgroundColor: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(4px)',
      borderRadius: '4px',
      padding: '2px 8px',
      fontSize: '0.7rem',
      letterSpacing: '0.05em',
    }}>
      {c.label}
    </span>
  )
}

const btnBase = {
  display: 'inline-block',
  padding: '6px 16px',
  borderRadius: '4px',
  fontSize: '0.82rem',
  fontWeight: '500',
  letterSpacing: '0.05em',
  cursor: 'default',
  textDecoration: 'none',
}

function RegistrationButton({ event, large }) {
  const style = large ? { ...btnBase, padding: '12px 32px', fontSize: '1rem' } : btnBase
  if (event.offline_registration) {
    return <span style={{ ...style, backgroundColor: '#4A2A35', color: '#8a9aaa' }}>報名請洽精舍</span>
  }
  if (event.status === 'closed') {
    return <span style={{ ...style, backgroundColor: '#5C1020', color: '#d08090' }}>報名已截止</span>
  }
  if (event.status === 'active') {
    return (
      <a
        href={`/?event=${event.event_id}`}
        style={{ ...style, backgroundColor: '#C9A96E', color: '#2E0E1F', cursor: 'pointer' }}
      >
        點我報名
      </a>
    )
  }
  return <span style={{ ...style, backgroundColor: '#2E0E1F', color: '#6a7a8a' }}>尚未開放報名</span>
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#2E0E1F' }}>
      {/* 返回列 */}
      <div style={{ backgroundColor: '#220A17', borderBottom: '1px solid #5C1F3D44', padding: '12px 24px' }}>
        <Link
          to="/activities"
          style={{ color: '#C9A96E', fontSize: '0.85rem', letterSpacing: '0.05em', textDecoration: 'none' }}
        >
          ← 返回活動列表
        </Link>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        {loading && (
          <p style={{ textAlign: 'center', color: '#B0A898', paddingTop: '60px' }}>載入中…</p>
        )}

        {!loading && notFound && (
          <div style={{ textAlign: 'center', paddingTop: '60px' }}>
            <p style={{ color: '#B0A898', marginBottom: '16px' }}>找不到此活動，或活動尚未公開。</p>
            <Link
              to="/activities"
              style={{
                display: 'inline-block',
                backgroundColor: '#C9A96E',
                color: '#2E0E1F',
                padding: '8px 20px',
                borderRadius: '4px',
                textDecoration: 'none',
                fontSize: '0.9rem',
                fontWeight: '500',
              }}
            >
              返回活動列表
            </Link>
          </div>
        )}

        {!loading && event && (
          <>
            {/* 封面圖 */}
            {event.cover_image_url && (
              <div style={{ borderRadius: '8px', overflow: 'hidden', marginBottom: '24px', height: '280px' }}>
                <img
                  src={event.cover_image_url}
                  alt={event.name}
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover',
                    objectPosition: event.cover_image_position || '50% 50%',
                  }}
                />
              </div>
            )}

            {/* 地點 Badge */}
            <div style={{ marginBottom: '12px' }}>
              <LocationBadge tag={event.location_tag} />
            </div>

            {/* 活動名稱 */}
            <h1 style={{
              color: '#F0E8D8',
              fontSize: '1.5rem',
              fontWeight: '400',
              letterSpacing: '0.08em',
              marginBottom: '8px',
            }}>
              {event.name}
            </h1>

            {/* 金色裝飾線 */}
            <div style={{ width: '40px', height: '2px', backgroundColor: '#C9A96E', marginBottom: '16px' }} />

            {/* 日期 */}
            <p style={{ color: '#B0A898', fontSize: '0.9rem', marginBottom: '24px' }}>
              📅 {formatDateRange(event.date_start, event.date_end)}
            </p>

            {/* 活動說明 */}
            {event.description && (
              <div style={{
                color: '#D8D0C0',
                fontSize: '0.95rem',
                lineHeight: '1.9',
                whiteSpace: 'pre-wrap',
                marginBottom: '32px',
                borderLeft: '2px solid #C9A96E44',
                paddingLeft: '16px',
              }}>
                {event.description}
              </div>
            )}

            {/* 報名按鈕 */}
            <RegistrationButton event={event} large />
          </>
        )}
      </div>
    </div>
  )
}
