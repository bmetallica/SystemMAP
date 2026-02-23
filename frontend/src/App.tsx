// ─── App Root ────────────────────────────────────────────────────────────

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Servers from './pages/Servers';
import ServerDetail from './pages/ServerDetail';
import Discovery from './pages/Discovery';
import Topology from './pages/Topology';
import Schedules from './pages/Schedules';
import Alerts from './pages/Alerts';
import DiffHistory from './pages/DiffHistory';
import ExportPage from './pages/ExportPage';
import UserManagement from './pages/UserManagement';
import Profile from './pages/Profile';
import AiSettings from './pages/AiSettings';
import AiChat from './pages/AiChat';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="servers" element={<Servers />} />
        <Route path="servers/:id" element={<ServerDetail />} />
        <Route path="discovery" element={<Discovery />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="changes" element={<DiffHistory />} />
        <Route path="export" element={<ExportPage />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="profile" element={<Profile />} />
        <Route path="topology" element={<Topology />} />
        <Route path="ai-settings" element={<AiSettings />} />
        <Route path="ai-chat" element={<AiChat />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
