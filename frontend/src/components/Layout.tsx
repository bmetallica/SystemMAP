// ─── Layout mit Sidebar ──────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import api from '../api/client';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  aiRequired?: boolean;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/servers', label: 'Server', icon: '🖥️' },
  { to: '/discovery', label: 'Discovery & Scans', icon: '🔍' },
  { to: '/schedules', label: 'Schedules', icon: '⏰' },
  { to: '/alerts', label: 'Alarme', icon: '🔔' },
  { to: '/changes', label: 'Änderungen', icon: '📊' },
  { to: '/export', label: 'Export', icon: '📥' },
  { to: '/users', label: 'Benutzer', icon: '👥', adminOnly: true },
  { to: '/topology', label: 'Topologie', icon: '🕸️' },
  { to: '/ai-chat', label: 'KI-Chat', icon: '💬', aiRequired: true },
  { to: '/ai-settings', label: 'KI-Einstellungen', icon: '🤖', adminOnly: true },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [aiEnabled, setAiEnabled] = useState(false);

  // KI-Status laden um Nav-Eintrag ein/auszublenden
  useEffect(() => {
    api.get('/ai/health')
      .then((res) => {
        // Sichtbar wenn Provider nicht "disabled" ist
        setAiEnabled(res.data?.provider !== 'disabled');
      })
      .catch(() => setAiEnabled(false));
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-full bg-gray-900">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            🗺️ SystemMAP
          </h1>
          <p className="text-xs text-gray-400 mt-1">Infrastructure Mapping Platform</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems
            .filter((item) => {
              if (item.adminOnly && user?.role !== 'ADMIN') return false;
              if (item.aiRequired && !aiEnabled) return false;
              return true;
            })
            .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`
              }
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User-Info */}
        <div className="p-3 border-t border-gray-700">
          <div className="flex items-center justify-between">
            <Link to="/profile" className="min-w-0 group">
              <p className="text-sm font-medium text-white truncate group-hover:text-blue-400 transition-colors">{user?.username}</p>
              <p className="text-xs text-gray-400 truncate">{user?.role}</p>
            </Link>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-red-400 text-sm px-2 py-1 rounded hover:bg-gray-700 transition-colors"
              title="Abmelden"
            >
              ⏻
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
