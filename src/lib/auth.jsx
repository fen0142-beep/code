import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, upsertVolunteerProfile } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = 尚未確認

  useEffect(() => {
    // 取得目前 session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    // 監聽登入/登出事件
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      // 義工登入時自動同步 profile（讓師父在後台看到義工清單）
      if (newSession?.user) {
        const u = newSession.user
        const r = u.app_metadata?.role ?? 'volunteer'
        if (r === 'volunteer') {
          const displayName = u.user_metadata?.display_name || u.email || ''
          upsertVolunteerProfile(u.id, u.email || '', displayName)
        }
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const user = session?.user ?? null
  const role = user?.app_metadata?.role ?? 'volunteer'
  const isAdmin = role === 'admin'

  return (
    <AuthContext.Provider value={{ session, user, role, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
