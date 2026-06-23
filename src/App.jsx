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
import RelationshipsPage from './pages/admin/RelationshipsPage'
import CarrangementPage from './pages/admin/CarrangementPage'
import CarrangementDetailPage from './pages/admin/CarrangementDetailPage'
import MonksPage from './pages/admin/MonksPage'
import DonorManagePage from './pages/admin/DonorManagePage'
import CarCheckinPage from './pages/CarCheckinPage'
import LeaderScanPage from './pages/LeaderScanPage'
import ActivitiesPage from './pages/ActivitiesPage'
import ActivityDetailPage from './pages/ActivityDetailPage'
import AccountPermissions from './pages/admin/permissions'

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
          <Route path="/admin/events/:id/donors" element={
            <ProtectedRoute adminOnly><DonorManagePage /></ProtectedRoute>
          } />
          <Route path="/admin/students" element={
            <ProtectedRoute adminOnly><StudentsPage /></ProtectedRoute>
          } />
          <Route path="/admin/templates" element={
            <ProtectedRoute adminOnly><TemplatesPage /></ProtectedRoute>
          } />
          <Route path="/admin/relationships" element={
            <ProtectedRoute adminOnly><RelationshipsPage /></ProtectedRoute>
          } />
          <Route path="/admin/monks" element={
            <ProtectedRoute adminOnly><MonksPage /></ProtectedRoute>
          } />
          <Route path="/admin/carrangement" element={
            <ProtectedRoute adminOnly><CarrangementPage /></ProtectedRoute>
          } />
          <Route path="/admin/carrangement/:eventId" element={
            <ProtectedRoute adminOnly><CarrangementDetailPage /></ProtectedRoute>
          } />
          {/* 📌 新增這一行：註冊帳號權限頁面，並設定只有 adminOnly 能進 */}
          <Route path="/admin/permissions" element={
            <ProtectedRoute adminOnly><AccountPermissions /></ProtectedRoute>
          } />   
          
          {/* 公開：領隊掃卡入口（刷學員證自動跳轉） */}
          <Route path="/leader" element={<LeaderScanPage />} />

          {/* 公開：領隊報到頁（不需登入，用 token 驗身） */}
          <Route path="/car-checkin/:token" element={<CarCheckinPage />} />

          {/* 公開：活動介紹頁 */}
          <Route path="/activities" element={<ActivitiesPage />} />
          <Route path="/activities/:id" element={<ActivityDetailPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
