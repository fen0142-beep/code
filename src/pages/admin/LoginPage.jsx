import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase' // 改回引用專案通用的 supabase client

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

    // 1. 呼叫 Supabase 驗證帳號密碼
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password,
    })

    if (authError) {
      setError('帳號或密碼錯誤，請再試一次。')
      setLoading(false)
      return
    }

    // 2. 登入成功後，檢查該 Email 是否存在於我們的後台權限名單中
    const { data: roleData, error: roleError } = await supabase
      .from('admin_roles')
      .select('role')
      .eq('email', email.trim())
      .single()

    if (roleError || !roleData) {
      // 在權限表找不到此人，拒絕登入後台
      await supabase.auth.signOut()
      setError('此帳號未經授權進入管理後台。')
      setLoading(false)
      return
    }

    // 3. 驗證成功，更新最後登入時間
    await supabase
      .from('admin_roles')
      .update({ last_sign_in_at: new Date() })
      .eq('email', email.trim())

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

        {/* ── 義工登入（開放輸入專屬的 Email 與密碼）── */}
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

        {/* ── 師父登入（帳號 + 密碼）── */}
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
