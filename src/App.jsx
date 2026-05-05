import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import ProtectedRoute from './components/ProtectedRoute'

import KioskPage from './pages/KioskPage'
import LoginPage from './pages/admin/LoginPage'
import EventsPage from './pages/admin/EventsPage'
import EventDetailPage from './pages/admin/EventDetailPage'
import CheckinPage from './pages/admin/CheckinPage'
import StudentsPage from './pages/admin/StudentsPage'
import TemplatesPage from './pages/admin/TemplatesPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* 前台：刷卡報名 */}
          <Route path="/" element={<KioskPage />} />

          {/* 後台：登入 */}
          <Route path="/admin/login" element={<LoginPage />} />

          {/* 後台：受保護頁面 */}
          <Route path="/admin" element={<Navigate to="/admin/events" replace />} />
          <Route path="/admin/events" element={
            <ProtectedRoute><EventsPage /></ProtectedRoute>
          } />
          <Route path="/admin/events/:id" element={
            <ProtectedRoute><EventDetailPage /></ProtectedRoute>
          } />
          <Route path="/admin/events/:id/checkin" element={
            <ProtectedRoute><CheckinPage /></ProtectedRoute>
          } />
          <Route path="/admin/students" element={
            <ProtectedRoute adminOnly><StudentsPage /></ProtectedRoute>
          } />
          <Route path="/admin/templates" element={
            <ProtectedRoute adminOnly><TemplatesPage /></ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
