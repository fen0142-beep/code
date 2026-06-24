import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function PermissionsPage() {
  const [accounts, setAccounts] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('volunteer')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    fetchAccounts()
  }, [])

  async function fetchAccounts() {
    const { data, error } = await supabase
      .from('custom_admins')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) setAccounts(data)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !name) return alert('請填寫完整欄位')
    setLoading(true)

    if (editingId) {
      // 📝 編輯模式
      const { error } = await supabase
        .from('custom_admins')
        .update({
          email: email.trim().toLowerCase(),
          display_name: name.trim(),
          role: role
        })
        .eq('id', editingId)

      if (error) {
        alert('更新失敗：' + error.message)
      } else {
        alert('更新成功')
        handleClear()
        fetchAccounts()
      }
    } else {
      // ➕ 新增模式
      if (!password) {
        setLoading(false)
        return alert('新增帳號時密碼為必填')
      }

      // 直接寫入我們自訂的 custom_admins 表，100% 繞過 Supabase 的內建 bug！
      const { error } = await supabase
        .from('custom_admins')
        .insert([{
          email: email.trim().toLowerCase(),
          password: password,
          display_name: name.trim(),
          role: role
        }])

      if (error) {
        alert('帳號建立失敗：' + error.message)
      } else {
        alert('新管理帳號建立成功！')
        handleClear()
        fetchAccounts()
      }
    }
    setLoading(false)
  }

  function handleEdit(acc) {
    setEditingId(acc.id)
    setEmail(acc.email)
    setName(acc.display_name || '')
    setRole(acc.role)
    setPassword('')
  }

  async function handleDelete(id) {
    if (!confirm('確定要刪除此管理帳號嗎？')) return
    const { error } = await supabase.from('custom_admins').delete().eq('id', id)
    if (!error) {
      alert('刪除成功')
      fetchAccounts()
    }
  }

  function handleClear() {
    setEditingId(null)
    setEmail('')
    setName('')
    setRole('volunteer')
    setPassword('')
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">帳號權限管理</h1>
      
      <div className="bg-white rounded-xl shadow-sm p-6 mb-8 border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">
          {editingId ? '📝 修改帳號權限' : '➕ 新增管理帳號'}
        </h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">電子信箱 (Email)</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
              placeholder="example@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">顯示名稱 / 姓名</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
              placeholder="請輸入姓名"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">後台身分權限</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
            >
              <option value="volunteer">🙏 一般義工</option>
              <option value="admin">☸️ 師父 / 管理員</option>
            </select>
          </div>
          {!editingId && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">登入密碼</label>
              <input
                type="password"
                required={!editingId}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
                placeholder="請設定密碼"
              />
            </div>
          )}
          <div className="md:col-span-2 flex gap-2 justify-end pt-2">
            {editingId && (
              <button type="button" onClick={handleClear} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700">取消修改</button>
            )}
            <button type="submit" disabled={loading} className="bg-amber-600 hover:bg-amber-700 text-white font-medium px-6 py-2 rounded-lg text-sm transition-colors">
              {loading ? '處理中…' : editingId ? '儲存修改' : '確認建立'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-sm font-medium text-gray-500">
              <th className="p-4">姓名</th>
              <th className="p-4">Email</th>
              <th className="p-4">身分</th>
              <th className="p-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
            {accounts.map(acc => (
              <tr key={acc.id} className="hover:bg-gray-50/50">
                <td className="p-4 font-medium text-gray-900">{acc.display_name}</td>
                <td className="p-4 text-gray-500">{acc.email}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${acc.role === 'admin' ? 'bg-purple-50 text-purple-600' : 'bg-amber-50 text-amber-600'}`}>
                    {acc.role === 'admin' ? '師父/管理員' : '一般義工'}
                  </span>
                </td>
                <td className="p-4 text-right space-x-2">
                  <button onClick={() => handleEdit(acc)} className="text-amber-600 hover:text-amber-700 font-medium">編輯</button>
                  <button onClick={() => handleDelete(acc.id)} className="text-red-500 hover:text-red-600 font-medium">刪除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
