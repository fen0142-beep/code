import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getPublicActivities } from '../lib/supabase'

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
    const key = month === 0 ? '待定' : String(month)
    if (!groups[key]) groups[key] = []
    groups[key].push(a)
  }
  return groups
}

function locationGradient(tag) {
  if (tag === 'tianxiang') return 'linear-gradient(135deg, #220A17 0%, #3D1429 100%)'
  if (tag === 'other') return 'linear-gradient(135deg, #220A17 0%, #3D1429 100%)'
  return 'linear-gradient(135deg, #2E0E1F 0%, #4A1A32 100%)'
}

function CornerRibbon({ tag }) {
  const config = {
    zhongtai:  { label: '中台',   bg: '#C9A96E', color: '#2E0E1F' },
    tianxiang: { label: '天祥',   bg: '#7FAFC0', color: '#ffffff' },
    puyi:      { label: (import.meta.env.VITE_TEMPLE_NAME || '普宜').slice(0, 2),   bg: '#C0C0C8', color: '#2E0E1F' },
    other:     { label: '其他',   bg: '#E5E7EB', color: '#6B7280' },
  }
  const c = config[tag] || config.puyi
  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: '72px',
      height: '56px',
      clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
      backgroundColor: c.bg,
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'flex-end',
      padding: '8px 10px',
      pointerEvents: 'none',
      zIndex: 10,
    }}>
      <span style={{
        color: c.color,
        fontSize: '0.85rem',
        fontWeight: '700',
        letterSpacing: '0.05em',
        lineHeight: 1,
      }}>
        {c.label}
      </span>
    </div>
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

function RegistrationButton({ event }) {
  if (event.status === 'closed') {
    return <span style={{ ...btnBase, backgroundColor: '#5C1020', color: '#d08090' }}>報名已截止</span>
  }
  if (event.offline_registration) {
    return <span style={{ ...btnBase, backgroundColor: '#4A2A35', color: '#8a9aaa' }}>報名請洽精舍</span>
  }
  if (event.locked && event.volunteer_open) {
    return (
      <div>
        <a
          href={`/?event=${event.event_id}`}
          style={{ ...btnBase, backgroundColor: '#2E0E1F', color: '#C9A96E', border: '1.5px solid #C9A96E', cursor: 'pointer' }}
          onClick={e => e.stopPropagation()}
        >
          義工報名
        </a>
        <p style={{ fontSize: '0.72rem', color: '#A0896A', marginTop: '4px', letterSpacing: '0.03em' }}>
          ＊學員報名已截止，僅開放義工
        </p>
      </div>
    )
  }
  if (event.walkin_mode) {
    return <span style={{ ...btnBase, backgroundColor: '#0F3D2E', color: '#6ecfaa' }}>現場刷卡即可參加</span>
  }
  if (!event.kiosk_open) {
    return <span style={{ ...btnBase, backgroundColor: '#2E0E1F', color: '#6a7a8a' }}>敬請期待</span>
  }
  if (event.status === 'active') {
    return (
      <a
        href={`/?event=${event.event_id}`}
        style={{ ...btnBase, backgroundColor: '#2E0E1F', color: '#C9A96E', border: '1.5px solid #C9A96E', cursor: 'pointer' }}
        onClick={e => e.stopPropagation()}
      >
        點我報名
      </a>
    )
  }
  return <span style={{ ...btnBase, backgroundColor: '#2E0E1F', color: '#6a7a8a' }}>尚未開放報名</span>
}

function ActivityCard({ event }) {
  return (
    <Link to={`/activities/${event.event_id}`} style={{ textDecoration: 'none' }}>
      <div
        style={{
          position: 'relative',
          backgroundColor: '#3D1429',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid #5C1F3D44',
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)'
          e.currentTarget.style.borderColor = '#C9A96E'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = 'none'
          e.currentTarget.style.borderColor = '#5C1F3D44'
        }}
      >
        {/* 封面圖或 Placeholder */}
        <div style={{ height: '160px', overflow: 'hidden' }}>
          {event.cover_image_url ? (
            <img
              src={event.cover_image_url}
              alt={event.name}
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                objectPosition: event.cover_image_position || '50% 50%',
              }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: locationGradient(event.location_tag),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>
                活動圖片
              </span>
            </div>
          )}
        </div>

        {/* 卡片內文 */}
        <div style={{ padding: '16px' }}>
          <h3 style={{
            color: '#F0E8D8',
            fontSize: '1rem',
            fontWeight: '500',
            marginBottom: '6px',
            lineHeight: '1.4',
          }}>
            {event.name}
          </h3>
          <p style={{ color: '#B0A898', fontSize: '0.8rem', marginBottom: '12px' }}>
            {formatDateRange(event.date_start, event.date_end)}
          </p>
          <RegistrationButton event={event} />
        </div>

        {/* 角落 Ribbon */}
        <CornerRibbon tag={event.location_tag} />
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
    <div style={{ minHeight: '100vh', backgroundColor: '#2E0E1F' }}>
      {/* Hero Banner */}
      <div style={{ backgroundColor: '#220A17', borderBottom: '1px solid #C9A96E' }}>
        <div className="max-w-4xl mx-auto px-6 py-10 text-center">
          <div style={{ width: '60px', height: '2px', backgroundColor: '#C9A96E', margin: '0 auto 16px' }} />
          <h1 style={{ color: '#F0E8D8', fontSize: '1.75rem', fontWeight: '300', letterSpacing: '0.15em' }}>
            {import.meta.env.VITE_TEMPLE_NAME}
          </h1>
          <p style={{ color: '#B0A898', fontSize: '0.85rem', letterSpacing: '0.2em', marginTop: '4px' }}>
            中台禪寺宜蘭分院
          </p>
          <p style={{ color: '#C9A96E', fontSize: '0.9rem', marginTop: '16px', letterSpacing: '0.05em' }}>
            年度活動一覽
          </p>
          <div style={{ width: '40px', height: '1px', backgroundColor: '#C9A96E', margin: '16px auto 0', opacity: 0.6 }} />
        </div>
      </div>

      <main className="max-w-4xl mx-auto">
        {loading && (
          <p style={{ textAlign: 'center', color: '#B0A898', padding: '80px 24px' }}>載入中…</p>
        )}
        {error && (
          <p style={{ textAlign: 'center', color: '#d08090', padding: '80px 24px' }}>載入失敗：{error}</p>
        )}

        {!loading && !error && activities.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 24px' }}>
            <div style={{ color: '#C9A96E', fontSize: '2rem', marginBottom: '16px' }}>☸</div>
            <p style={{ color: '#B0A898', letterSpacing: '0.1em' }}>目前尚無公開活動</p>
          </div>
        )}

        {!loading && !error && Object.entries(groups).map(([month, list]) => (
          <section key={month}>
            <div style={{ backgroundColor: '#220A17', padding: '8px 24px', borderLeft: '3px solid #C9A96E' }}>
              <h2 style={{ color: '#C9A96E', fontSize: '1rem', fontWeight: '500', letterSpacing: '0.1em' }}>
                {month === '待定' ? '待定' : `${month} 月`}
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
              {list.map(event => (
                <ActivityCard key={event.event_id} event={event} />
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
