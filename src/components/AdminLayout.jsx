import { NavLink, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const ALL_NAV_ITEMS = [
  { to: '/admin/events',        label: '活動管理', adminOnly: false },
  { to: '/admin/students',      label: '學員管理', adminOnly: true  },
  { to: '/admin/templates',     label: '模板管理', adminOnly: true  },
  { to: '/admin/carrangement',  label: '排車系統', adminOnly: true  },
  { to: '/admin/relationships', label: '關係連結', adminOnly: true  },
  { to: '/admin/monks',         label: '法師管理', adminOnly: true  },
]

export default function AdminLayout({ children }) {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  const navItems = ALL_NAV_ITEMS.filter(item => !item.adminOnly || isAdmin)

  async function handleSignOut() {
    await signOut()
    navigate('/admin/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 頂部導覽列 */}
      <header className="bg-amber-700 text-white shadow-md">
        <div className="max-w-6xl mx-auto px-3 py-2">
          {/* 第一行：Logo + 右側按鈕 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-base sm:text-lg tracking-wide whitespace-nowrap">{import.meta.env.VITE_TEMPLE_NAME} · 後台</span>
              {!isAdmin && (
                <span className="text-xs bg-white/20 border border-white/30 text-white/90 px-2 py-0.5 rounded-full whitespace-nowrap">
                  義工
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <NavLink
                to="/"
                className="text-xs text-white/70 hover:text-white transition-colors whitespace-nowrap"
              >
                ← 前台報名
              </NavLink>
              <button
                onClick={handleSignOut}
                className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded transition-colors whitespace-nowrap"
              >
                登出
              </button>
            </div>
          </div>
          {/* 第二行：Nav（手機版橫向捲動） */}
          <nav className="flex gap-1 mt-1.5 overflow-x-auto pb-0.5 -mx-1 px-1"
               style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {navItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `px-3 py-1 rounded text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-white/20'
                      : 'hover:bg-white/10'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* 主內容 */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  )
}
