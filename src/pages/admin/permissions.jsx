import React, { useState, useEffect } from 'react';
// 正確引用 lib 底下的 supabase.js
import { supabase } from '../../lib/supabase'; 

export default function AccountPermissions() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('admin'); // admin = 師父/管理者, volunteer = 義工
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // 1. 讀取 Supabase 帳號列表
  const fetchAccounts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('admin_roles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      alert('讀取帳號失敗：' + error.message);
    } else {
      setAccounts(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  // 2. 建立或更新帳號權限
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return alert('請輸入 Email');

    setLoading(true);

    if (editingId) {
      // 【更新既有帳號】
      const { error } = await supabase
        .from('admin_roles')
        .update({
          display_name: name,
          role: role,
          updated_at: new Date()
        })
        .eq('id', editingId);

      if (error) {
        alert('更新失敗：' + error.message);
      } else {
        alert('帳號權限更新成功！');
        handleClear();
        fetchAccounts();
      }
    } else {
      // 【新增新帳號】
      if (!password) {
        setLoading(false);
        return alert('新增新帳號時，密碼為必填欄位！');
      }
// 💡 隨機生成一個標準的 UUID 給新帳號，確保兩張表連動完全一致
      const newUuid = crypto.randomUUID();
      const { error } = await supabase
        .from('admin_roles')
        .insert([{ 
          id: newUuid, // 👈 補上這一行，手動指定新生成的 UUID
          email: email.trim(), 
          display_name: name, 
          role: role,
          temp_password: password
        }])
      if (error) {
        alert('新增失敗：' + error.message);
      } else {
        alert('帳號已全自動成功建立！義工現在可以直接登入了！');
        handleClear();
        fetchAccounts();
      }
    }
    setLoading(false);
  };

  // 3. 點擊「編輯」
  const handleEdit = (acc) => {
    setEditingId(acc.id);
    setEmail(acc.email);
    setName(acc.display_name || '');
    setRole(acc.role);
    setPassword('');
  };

  // 4. 清空表單（重置）
  const handleClear = () => {
    setEditingId(null);
    setEmail('');
    setName('');
    setPassword('');
    setRole('admin');
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-bold mb-2 text-gray-800">帳號權限設定</h1>
      <p className="text-gray-500 mb-6 text-sm">
        僅管理者可使用。可直接新增後台帳號、設定密碼，並指定師父／管理者或義工權限。
      </p>

      {/* 表單區塊 */}
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 max-w-5xl mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          
          {/* 📌 Email 輸入框 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">帳號 Email</label>
            <input 
              type="email" 
              value={email} 
              disabled={editingId !== null} // 只有在編輯既有帳號時才會鎖定不讓改 Email
              onChange={e => setEmail(e.target.value)} 
              placeholder="例如 volunteer@puyi.reg" 
              className="w-full border p-2 rounded disabled:bg-gray-100 text-gray-800 bg-white" 
              required 
            />
          </div>

          {/* 顯示名稱 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">顯示名稱</label>
            <input 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              placeholder="例如 知客組義工、某某師父" 
              className="w-full border p-2 rounded text-gray-800 bg-white" 
            />
          </div>

          {/* 密碼 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              placeholder={editingId ? "既有帳號不可在此修改密碼" : "新增帳號必填"} 
              className="w-full border p-2 rounded text-gray-800 bg-white" 
              disabled={editingId !== null}
            />
          </div>

          {/* 角色權限 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">角色權限</label>
            <select 
              value={role} 
              onChange={e => setRole(e.target.value)} 
              className="w-full border p-2 rounded bg-white text-gray-800"
            >
              <option value="admin">師父 / 管理者</option>
              <option value="volunteer">義工</option>
            </select>
          </div>
        </div>

        {/* 權限字卡說明 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className={`p-4 rounded border transition-colors ${role === 'admin' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
            <h4 className="font-bold">師父 / 管理者</h4>
            <p className="text-sm mt-1">可進入所有後台管理功能。</p>
          </div>
          <div className={`p-4 rounded border transition-colors ${role === 'volunteer' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
            <h4 className="font-bold">義工</h4>
            <p className="text-sm mt-1">只能進入活動管理中被授權的活動報名名單。</p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={handleClear} className="px-4 py-2 border rounded hover:bg-gray-100 text-gray-700">清空 / 新增模式</button>
          <button type="submit" disabled={loading} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded font-medium disabled:bg-amber-400">
            {editingId ? '儲存修改' : '建立 / 儲存帳號'}
          </button>
        </div>
      </form>

      {/* 帳號列表 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 max-w-5xl">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-bold text-gray-700">目前後台帳號</h3>
          <button onClick={fetchAccounts} className="text-sm text-amber-700 hover:text-amber-800 font-medium">重新整理</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-sm border-b">
                <th className="p-3 font-semibold">Email</th>
                <th className="p-3 font-semibold">顯示名稱</th>
                <th className="p-3 font-semibold">權限</th>
                <th className="p-3 font-semibold">最後登入</th>
                <th className="p-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && accounts.length === 0 ? (
                <tr><td colSpan="5" className="p-4 text-center text-gray-400">載入中...</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan="5" className="p-4 text-center text-gray-400">目前暫無帳號資料</td></tr>
              ) : accounts.map((acc) => (
                <tr key={acc.id || acc.email} className="border-b text-sm hover:bg-gray-50 text-gray-700">
                  <td className="p-3">{acc.email}</td>
                  <td className="p-3">{acc.display_name || '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${acc.role === 'admin' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                      {acc.role === 'admin' ? '管理者' : '義工'}
                    </span>
                  </td>
                  <td className="p-3 text-gray-500">
                    {acc.last_sign_in_at ? new Date(acc.last_sign_in_at).toLocaleString() : '—'}
                  </td>
                  <td className="p-3">
                    <button onClick={() => handleEdit(acc)} className="text-amber-700 hover:text-amber-900 font-medium">編輯</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
