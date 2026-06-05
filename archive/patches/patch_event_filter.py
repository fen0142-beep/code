#!/usr/bin/env python3
"""Patch: add status tab filter + ascending date sort to EventsPage.jsx"""

filepath = r'src/pages/admin/EventsPage.jsx'

with open(filepath, 'r', encoding='utf-8') as f:
    src = f.read()

# ── 1. Add activeTab state ───────────────────────────────────────────────────
old_state = "  const [importingBuiltin, setImportingBuiltin] = useState(false)"
new_state = """  const [importingBuiltin, setImportingBuiltin] = useState(false)
  // 篩選 tab
  const [activeTab, setActiveTab] = useState('active')"""
assert old_state in src, "FAIL: state not found"
src = src.replace(old_state, new_state, 1)

# ── 2. Replace the events list section with filtered + sorted + tabbed version
old_list_section = """      {/* 活動列表 */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">載入中…</p>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          {isAdmin
            ? <p className="text-sm">尚無活動，點上方按鈕新增第一場</p>
            : <p className="text-sm">尚未被指定任何活動，請聯絡師父設定</p>
          }
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(ev => (
            <Link
              key={ev.event_id}
              to={`/admin/events/${ev.event_id}`}
              className="block bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-amber-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800">{ev.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {ev.date_start || '日期未設定'}
                    {ev.date_end && ev.date_end !== ev.date_start ? ` ～ ${ev.date_end}` : ''}
                    {ev.location ? `　${ev.location}` : ''}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[ev.status]}`}>
                  {STATUS_LABEL[ev.status]}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}"""

new_list_section = """      {/* 狀態篩選 Tab */}
      {!loading && (
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          {[
            { key: 'active', label: '進行中', color: 'text-green-700' },
            { key: 'draft',  label: '草稿',   color: 'text-gray-600' },
            { key: 'closed', label: '已關閉', color: 'text-red-500' },
            { key: 'all',    label: '全部',   color: 'text-gray-500' },
          ].map(tab => {
            const count = tab.key === 'all'
              ? events.length
              : events.filter(e => e.status === tab.key).length
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? `border-amber-600 ${tab.color}`
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 活動列表 */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">載入中…</p>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          {isAdmin
            ? <p className="text-sm">尚無活動，點上方按鈕新增第一場</p>
            : <p className="text-sm">尚未被指定任何活動，請聯絡師父設定</p>
          }
        </div>
      ) : (() => {
        const filtered = (activeTab === 'all' ? events : events.filter(e => e.status === activeTab))
          .slice()
          .sort((a, b) => {
            if (!a.date_start && !b.date_start) return 0
            if (!a.date_start) return 1
            if (!b.date_start) return -1
            return a.date_start.localeCompare(b.date_start)
          })
        return filtered.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-12">此分類目前沒有活動</p>
        ) : (
          <div className="space-y-3">
            {filtered.map(ev => (
              <Link
                key={ev.event_id}
                to={`/admin/events/${ev.event_id}`}
                className="block bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-amber-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-800">{ev.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {ev.date_start || '日期未設定'}
                      {ev.date_end && ev.date_end !== ev.date_start ? ` ～ ${ev.date_end}` : ''}
                      {ev.location ? `　${ev.location}` : ''}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[ev.status]}`}>
                    {STATUS_LABEL[ev.status]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )
      })()}"""

assert old_list_section in src, "FAIL: list section not found"
src = src.replace(old_list_section, new_list_section, 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(src)

print(f"✅ Done. Lines: {src.count(chr(10))}")
for kw in ['activeTab', 'setActiveTab', '進行中', '已關閉', 'localeCompare']:
    assert kw in src, f"MISSING: {kw}"
    print(f"  ✓ {kw}")
