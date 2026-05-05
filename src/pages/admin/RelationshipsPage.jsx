import { useState, useEffect, useMemo } from 'react'
import AdminLayout from '../../components/AdminLayout'
import {
  getRelationshipGroups,
  createRelationshipGroup,
  updateRelationshipGroup,
  deleteRelationshipGroup,
  getAllStudents,
} from '../../lib/supabase'

// ─── 群組 Modal（新增 / 編輯）────────────────────────────────

function GroupModal({ group, students, onSave, onClose }) {
  const isEdit = !!group

  const [name, setName] = useState(group?.name ?? '')
  const [note, setNote] = useState(group?.note ?? '')
  // 已選成員 Set（student_id）
  const [selected, setSelected] = useState(
    () => new Set((group?.relationship_members ?? []).map(m => m.student_id))
  )
  const [classFilter, setClassFilter] = useState('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 班級列表（從學員資料動態取得）
  const classList = useMemo(() => {
    const set = new Set()
    for (const s of students) {
      for (const c of (s.student_classes ?? [])) {
        if (c.class_name) set.add(c.class_name)
      }
    }
    return [...set].sort()
  }, [students])

  // 過濾後的學員列表
  const filtered = useMemo(() => {
    return students.filter(s => {
      const nameMatch = !search.trim() || s.name.includes(search.trim())
      const classMatch = !classFilter || (s.student_classes ?? []).some(c => c.class_name === classFilter)
      return nameMatch && classMatch
    })
  }, [students, search, classFilter])

  function toggle(sid) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(sid) ? next.delete(sid) : next.add(sid)
      return next
    })
  }

  async function handleSave() {
    if (!name.trim()) { setError('請輸入群組名稱'); return }
    setSaving(true)
    setError('')
    const ids = [...selected]
    const res = isEdit
      ? await updateRelationshipGroup(group.group_id, name.trim(), note.trim(), ids)
      : await createRelationshipGroup(name.trim(), note.trim(), ids)
    setSaving(false)
    if (!res.success) { setError(res.error); return }
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* 標題列 */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-bold text-lg">{isEdit ? '編輯群組' : '新增群組'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 名稱 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">群組名稱 <span className="text-red-500">*</span></label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="例：王家、陳家姐妹"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {/* 備註 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="選填"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>

          {/* 成員選擇 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              成員（已選 {selected.size} 人）
            </label>

            {/* 篩選列 */}
            <div className="flex gap-2 mb-2">
              <select
                className="border rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-amber-400"
                value={classFilter}
                onChange={e => setClassFilter(e.target.value)}
              >
                <option value="">所有班級</option>
                {classList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                className="border rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="搜尋姓名…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* 學員列表 */}
            <div className="border rounded-lg overflow-y-auto max-h-64 divide-y">
              {filtered.length === 0 && (
                <div className="text-center text-gray-400 py-6 text-sm">沒有符合的學員</div>
              )}
              {filtered.map(s => {
                const isSelected = selected.has(s.student_id)
                const classes = (s.student_classes ?? []).map(c => c.class_name).join('・')
                return (
                  <label
                    key={s.student_id}
                    className={`flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-amber-50 transition-colors ${isSelected ? 'bg-amber-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(s.student_id)}
                      className="accent-amber-600 w-4 h-4 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm">{s.name}</span>
                      {classes && <span className="ml-2 text-xs text-gray-400">{classes}</span>}
                    </div>
                    <span className="text-xs text-gray-300">{s.student_id}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>

        {/* 按鈕列 */}
        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-600 border hover:bg-gray-100 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors font-medium"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 主頁面 ────────────────────────────────────────────────

export default function RelationshipsPage() {
  const [groups, setGroups] = useState([])
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)   // null | 'new' | group 物件
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    const [gRes, sRes] = await Promise.all([
      getRelationshipGroups(),
      getAllStudents(),
    ])
    if (gRes.error) setError(gRes.error)
    else setGroups(gRes.groups)
    if (sRes.error) setError(sRes.error)
    else setStudents(sRes.students)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(group) {
    if (!window.confirm(`確定要刪除群組「${group.name}」嗎？`)) return
    const res = await deleteRelationshipGroup(group.group_id)
    if (!res.success) { alert(res.error); return }
    load()
  }

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filtered = groups.filter(g =>
    !search.trim() || g.name.includes(search.trim()) ||
    (g.relationship_members ?? []).some(m => m.students?.name?.includes(search.trim()))
  )

  return (
    <AdminLayout>
      <div className="space-y-5">
        {/* 頁首 */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-800">關係連結</h1>
            <p className="text-sm text-gray-500 mt-0.5">將有同車或家屬關係的學員分組，排車時優先安排在同一車</p>
          </div>
          <button
            onClick={() => setModal('new')}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors shrink-0"
          >
            ＋ 新增群組
          </button>
        </div>

        {/* 搜尋 */}
        <input
          className="w-full max-w-sm border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          placeholder="搜尋群組名稱或成員姓名…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {error && <div className="text-red-500 text-sm">{error}</div>}

        {loading ? (
          <div className="text-center py-20 text-gray-400">載入中…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            {search ? '沒有符合的群組' : '尚未建立任何群組'}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(g => {
              const members = g.relationship_members ?? []
              const isExpanded = expandedIds.has(g.group_id)
              return (
                <div key={g.group_id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                  {/* 群組標題列 */}
                  <div className="flex items-center gap-3 px-5 py-4">
                    <button
                      onClick={() => toggleExpand(g.group_id)}
                      className="text-gray-400 hover:text-gray-700 text-lg leading-none shrink-0"
                      title={isExpanded ? '收起' : '展開'}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800">{g.name}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                          {members.length} 人
                        </span>
                        {g.note && (
                          <span className="text-xs text-gray-400 italic">{g.note}</span>
                        )}
                      </div>
                      {/* 摘要：最多顯示 5 位名字 */}
                      {!isExpanded && members.length > 0 && (
                        <div className="text-sm text-gray-500 mt-0.5 truncate">
                          {members.slice(0, 5).map(m => m.students?.name ?? m.student_id).join('、')}
                          {members.length > 5 && `…等 ${members.length} 人`}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setModal(g)}
                        className="text-xs px-3 py-1.5 border rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleDelete(g)}
                        className="text-xs px-3 py-1.5 border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                      >
                        刪除
                      </button>
                    </div>
                  </div>

                  {/* 展開的成員列表 */}
                  {isExpanded && (
                    <div className="border-t bg-gray-50 px-5 py-3">
                      {members.length === 0 ? (
                        <p className="text-sm text-gray-400">此群組尚無成員</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {members.map(m => (
                            <span
                              key={m.id}
                              className="inline-flex items-center gap-1 bg-white border rounded-full px-3 py-1 text-sm text-gray-700"
                            >
                              {m.students?.name ?? m.student_id}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <GroupModal
          group={modal === 'new' ? null : modal}
          students={students}
          onSave={() => { setModal(null); load() }}
          onClose={() => setModal(null)}
        />
      )}
    </AdminLayout>
  )
}
