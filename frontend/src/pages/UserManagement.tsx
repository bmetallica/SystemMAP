// ─── Benutzerverwaltung (Admin) ──────────────────────────────────────────

import { useState, useEffect, FormEvent } from 'react';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

interface User {
  id: string;
  email: string;
  username: string;
  role: string;
  createdAt: string;
  updatedAt?: string;
  _count?: { auditLogs: number };
}

const ROLES = ['ADMIN', 'OPERATOR', 'VIEWER'] as const;
const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-red-600 text-white',
  OPERATOR: 'bg-yellow-600 text-white',
  VIEWER: 'bg-blue-600 text-white',
};
const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  OPERATOR: 'Operator',
  VIEWER: 'Betrachter',
};

export default function UserManagement() {
  const currentUser = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Neuen Benutzer erstellen
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>('VIEWER');
  const [creating, setCreating] = useState(false);

  // Benutzer bearbeiten
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editRole, setEditRole] = useState('');

  // Passwort zurücksetzen
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  // Löschen bestätigen
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await api.get('/auth/users');
      setUsers(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Laden der Benutzer');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  // ─── Benutzer erstellen ──────────────────────────────────────────────
  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    clearMessages();
    setCreating(true);

    try {
      await api.post('/auth/users', {
        email: newEmail,
        username: newUsername,
        password: newPassword,
        role: newRole,
      });
      setSuccess(`Benutzer "${newUsername}" erfolgreich erstellt`);
      setShowCreate(false);
      setNewEmail('');
      setNewUsername('');
      setNewPassword('');
      setNewRole('VIEWER');
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Erstellen des Benutzers');
    } finally {
      setCreating(false);
    }
  };

  // ─── Benutzer bearbeiten ─────────────────────────────────────────────
  const startEdit = (user: User) => {
    setEditingUser(user);
    setEditEmail(user.email);
    setEditUsername(user.username);
    setEditRole(user.role);
    clearMessages();
  };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    clearMessages();

    try {
      const data: any = {};
      if (editEmail !== editingUser.email) data.email = editEmail;
      if (editUsername !== editingUser.username) data.username = editUsername;
      if (editRole !== editingUser.role) data.role = editRole;

      if (Object.keys(data).length === 0) {
        setError('Keine Änderungen vorgenommen');
        return;
      }

      await api.put(`/auth/users/${editingUser.id}`, data);
      setSuccess(`Benutzer "${editingUser.username}" aktualisiert`);
      setEditingUser(null);
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Aktualisieren');
    }
  };

  // ─── Passwort zurücksetzen ───────────────────────────────────────────
  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetUserId) return;
    clearMessages();

    try {
      const res = await api.put(`/auth/users/${resetUserId}/reset-password`, {
        newPassword: resetPassword,
      });
      setSuccess(res.data.message);
      setResetUserId(null);
      setResetPassword('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Zurücksetzen des Passworts');
    }
  };

  // ─── Benutzer löschen ────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteUserId) return;
    clearMessages();

    try {
      const res = await api.delete(`/auth/users/${deleteUserId}`);
      setSuccess(res.data.message);
      setDeleteUserId(null);
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Löschen');
    }
  };

  if (currentUser?.role !== 'ADMIN') {
    return (
      <div className="text-center py-20">
        <p className="text-6xl mb-4">🔒</p>
        <h2 className="text-xl font-semibold text-white mb-2">Zugriff verweigert</h2>
        <p className="text-gray-400">Nur Administratoren haben Zugriff auf die Benutzerverwaltung.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">👥 Benutzerverwaltung</h1>
          <p className="text-gray-400 text-sm mt-1">
            {users.length} Benutzer registriert
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(!showCreate); clearMessages(); }}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          ➕ Neuer Benutzer
        </button>
      </div>

      {/* Meldungen */}
      {error && (
        <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm flex items-center justify-between">
          <span>❌ {error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-200">✕</button>
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-300 text-sm flex items-center justify-between">
          <span>✅ {success}</span>
          <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-200">✕</button>
        </div>
      )}

      {/* Neuen Benutzer erstellen */}
      {showCreate && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Neuen Benutzer erstellen</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Benutzername</label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="max.mustermann"
                required
                minLength={3}
                maxLength={30}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">E-Mail</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="max@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Passwort</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Mindestens 8 Zeichen"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Rolle</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {creating ? '⏳ Erstelle...' : '✅ Erstellen'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rollen-Übersicht */}
      <div className="grid grid-cols-3 gap-4">
        {ROLES.map((role) => {
          const count = users.filter((u) => u.role === role).length;
          return (
            <div key={role} className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${ROLE_COLORS[role]}`}>
                {ROLE_LABELS[role]}
              </span>
              <p className="text-2xl font-bold text-white mt-2">{count}</p>
            </div>
          );
        })}
      </div>

      {/* Benutzer-Tabelle */}
      {loading ? (
        <div className="text-center py-10 text-gray-400">⏳ Lade Benutzer...</div>
      ) : (
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/50">
              <tr>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Benutzer</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">E-Mail</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Rolle</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Erstellt</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Audit-Logs</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {user.id === currentUser?.id ? '👤' : '🧑'}
                      </span>
                      <span className="text-white font-medium">{user.username}</span>
                      {user.id === currentUser?.id && (
                        <span className="text-xs text-blue-400 bg-blue-900/50 px-2 py-0.5 rounded-full">Du</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${ROLE_COLORS[user.role]}`}>
                      {ROLE_LABELS[user.role] || user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(user.createdAt).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {user._count?.auditLogs ?? '–'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => startEdit(user)}
                        className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                        title="Bearbeiten"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => { setResetUserId(user.id); setResetPassword(''); clearMessages(); }}
                        className="px-2 py-1 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded transition-colors"
                        title="Passwort zurücksetzen"
                      >
                        🔑
                      </button>
                      {user.id !== currentUser?.id && (
                        <button
                          onClick={() => { setDeleteUserId(user.id); clearMessages(); }}
                          className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                          title="Löschen"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal: Benutzer bearbeiten ─────────────────────────────────── */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">
              ✏️ Benutzer bearbeiten: {editingUser.username}
            </h3>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Benutzername</label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  minLength={3}
                  maxLength={30}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">E-Mail</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Rolle</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  💾 Speichern
                </button>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Passwort zurücksetzen ────────────────────────────────── */}
      {resetUserId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">
              🔑 Passwort zurücksetzen
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              Setze ein neues Passwort für <strong className="text-white">
                {users.find((u) => u.id === resetUserId)?.username}
              </strong>
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Neues Passwort</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Mindestens 8 Zeichen"
                  required
                  minLength={8}
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  🔑 Zurücksetzen
                </button>
                <button
                  type="button"
                  onClick={() => setResetUserId(null)}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Löschen bestätigen ──────────────────────────────────── */}
      {deleteUserId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">
              🗑️ Benutzer löschen?
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              Möchtest du <strong className="text-red-400">
                {users.find((u) => u.id === deleteUserId)?.username}
              </strong> wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                🗑️ Endgültig löschen
              </button>
              <button
                onClick={() => setDeleteUserId(null)}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
