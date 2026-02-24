// ─── Layout mit Sidebar ──────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import api, { isOnline, onConnectionChange } from '../api/client';

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
  const [online, setOnline] = useState(isOnline());
  const [showReconnected, setShowReconnected] = useState(false);

  // ─── Verbindungsstatus überwachen ──────────────────────────────────
  useEffect(() => {
    return onConnectionChange((v) => {
      setOnline(v);
      if (v) {
        // Kurz "Wieder verbunden" anzeigen, dann ausblenden
        setShowReconnected(true);
        setTimeout(() => setShowReconnected(false), 4000);
      }
    });
  }, []);

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
      {/* Sidebar – collapsed: nur Icons (w-14), expanded: voll (w-64) */}
      <aside
        className="group/sidebar flex flex-col bg-gray-800 border-r border-gray-700 w-14 hover:w-64 transition-all duration-200 overflow-hidden flex-shrink-0"
      >
        {/* Logo – immer sichtbar */}
        <div className="p-3 border-b border-gray-700 flex items-center gap-2 min-h-[56px]">
          <span className="text-2xl flex-shrink-0">🗺️</span>
          <div className="whitespace-nowrap overflow-hidden">
            <h1 className="text-lg font-bold text-white leading-tight">SystemMAP</h1>
            <p className="text-[10px] text-gray-400">Infrastructure Mapping</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
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
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`
              }
              title={item.label}
            >
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200">
                {item.label}
              </span>
            </NavLink>
          ))}
        </nav>

        {/* User-Info */}
        <div className="p-2 border-t border-gray-700">
          <div className="flex items-center justify-between gap-2">
            <Link to="/profile" className="min-w-0 group flex items-center gap-2" title={user?.username}>
              <span className="text-lg flex-shrink-0">👤</span>
              <div className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 whitespace-nowrap overflow-hidden">
                <p className="text-sm font-medium text-white truncate group-hover:text-blue-400 transition-colors">{user?.username}</p>
                <p className="text-xs text-gray-400 truncate">{user?.role}</p>
              </div>
            </Link>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-red-400 text-sm px-1 py-1 rounded hover:bg-gray-700 transition-colors opacity-0 group-hover/sidebar:opacity-100 flex-shrink-0"
              title="Abmelden"
            >
              ⏻
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* ─── Verbindungsstatus-Banner ─────────────────────────────── */}
        {!online && (
          <div className="bg-red-900/90 border-b border-red-700 px-4 py-2 text-center text-red-200 text-sm flex items-center justify-center gap-2 animate-pulse">
            <span className="text-lg">📡</span>
            Verbindung verloren – Anfragen werden automatisch wiederholt…
          </div>
        )}
        {online && showReconnected && (
          <div className="bg-green-900/90 border-b border-green-700 px-4 py-2 text-center text-green-200 text-sm flex items-center justify-center gap-2">
            <span className="text-lg">✅</span>
            Verbindung wiederhergestellt
          </div>
        )}
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
