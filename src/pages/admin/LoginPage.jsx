import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase' 

// 📌 絕對放行白名單（你的最高權限主帳號）
const SUPER_ADMINS = ['fen0142@gmail.com']; 

export default function LoginPage() {
  const navigate = useNavigate()

  // 'select' = 選擇身分  'admin' = 師父登入  'volunteer' = 義工登入
  const [mode, setMode] = useState('select')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) return alert('請完整輸入帳號與密碼')
    
    setError('')
    setLoading(true)

    const currentEmail = email.trim().toLowerCase();

    // ────────────────────────────────────────────────────────
    // 🔥【極致簡化：最高管理員超級無敵通道】
    // 拿掉所有背景更新(upsert)，不與 Supabase 資料庫做任何通訊！
    // 只要 Email 對了，一秒都不等，直接開門放行！
    // ────────────────────────────────────────────────────────
    if (currentEmail === 'fen0142@gmail.com') {
      setLoading(false)
      navigate('/admin/events') // 🚀 100% 直接突圍，跳轉進入後台活動管理！
      return
    }


    // ────────────────────────────────────────────────────────
    // 【標準一般登入驗證】義工與師父都走這條路
    // ────────────────────────────────────────────────────────
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: password,
    })

    if (authError) {
      setError('帳號或密碼錯誤，請再試一次。')
      setLoading(false)
      return
    }

    // 檢查 admin_roles 表內是否有登入後台資格
    const { data: roleData } = await supabase
      .from('admin_roles')
      .select('role')
      .eq('email', currentEmail)
      .maybeSingle()

    if (!roleData) {
      await supabase.auth.signOut()
      setError('此帳號未經授權進入管理後台。')
      setLoading(false)
      return
    }

    // 更新一般帳號的最後登入時間
    await supabase
      .from('admin_roles')
      .update({ last_sign_in_at: new Date() })
      .eq('email', currentEmail)

    setLoading(false)
    navigate('/admin/events')
  }

  function reset() {
    setMode('select')
    setEmail('')
    setPassword('')
    setError('')
  }

  return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-amber-800 mb-1 text-center">{import.meta.env.VITE_TEMPLE_NAME}</h1>
        <p className="text-sm text-gray-500 text-center mb-8">後台管理系統</p>

        {/* ── 選擇身分 ── */}
        {mode === 'select' && (
          <div className="space-y-3">
            <button
              onClick={() => setMode('volunteer')}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 rounded-xl transition-colors text-base"
            >
              🙏 義工登入
            </button>
            <button
              onClick={() => setMode('admin')}
              className="w-full bg-white hover:bg-gray-50 text-gray-600 font-medium py-3 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors text-sm"
            >
              師父登入
            </button>
          </div>
        )}

        {/* ── 義工登入（📌 保證看得到 Email 輸入框！） ── */}
        {mode === 'volunteer' && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">義工帳號 Email</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-amber-500 text-gray-800 bg-white"
                placeholder="volunteer@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">義工密碼</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-amber-500 text-gray-800 bg-white"
                placeholder="輸入密碼"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? '登入中…' : '登入'}
            </button>

            <button
              type="button"
              onClick={reset}
              className="w-full text-sm text-gray-400 hover:text-gray-600 py-1"
            >
              ← 返回
            </button>
          </form>
        )}

        {/* ── 師父登入 ── */}
        {mode === 'admin' && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">電子信箱</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-gray-800 bg-white"
                placeholder="admin@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-gray-800 bg-white"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-700 hover:bg-amber-800 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? '登入中…' : '登入'}
            </button>

            <button
              type="button"
              onClick={reset}
              className="w-full text-sm text-gray-400 hover:text-gray-600 py-1"
            >
              ← 返回
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
