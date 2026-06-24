import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = navigate = useNavigate()

  async function handleCustomLogin(targetRole) {
    if (!email || !password) return alert('請輸入電子信箱與密碼')
    setLoading(true)

    // 從我們建立的 custom_admins 表中進行帳密驗證
    const { data, error } = await supabase
      .from('custom_admins')
      .select('*')
      .eq('email', email.trim().toLowerCase())
      .eq('password', password)
      .single()

    if (error || !data) {
      alert('登入失敗：帳號或密碼錯誤')
      setLoading(false)
      return
    }

    if (data.role !== targetRole) {
      alert(`登入失敗：您的權限為【${data.role === 'admin' ? '師父/管理員' : '一般義工'}】，無法登入此入口。`)
      setLoading(false)
      return
    }

    // 驗證成功，模擬寫入 Session
    localStorage.setItem('sb-custom-auth', JSON.stringify(data))
    alert('登入成功！')
    navigate('/admin/events')
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-amber-50/40 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto w-full max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-xl sm:px-10 border border-gray-100">
          <h2 className="mb-6 text-center text-xl font-bold text-gray-700">後台管理系統</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600">電子信箱</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600">密碼</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            <div className="pt-4 grid grid-cols-1 gap-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleCustomLogin('volunteer')}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-amber-700 hover:bg-amber-800 transition-colors"
              >
                🙏 義工登入
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleCustomLogin('admin')}
                className="w-full flex justify-center py-2.5 px-4 border border-gray-200 rounded-lg shadow-sm text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                師父登入
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
