// ─── Profil & Passwort ändern ─────────────────────────────────────────────

import { useState, useEffect, FormEvent } from 'react';
import api from '../api/client';
import { useAuthStore } from '../store/auth';

export default function Profile() {
  const { user, login: authLogin, token } = useAuthStore();

  // Profil-Daten
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const [createdAt, setCreatedAt] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);

  // Passwort-Felder
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  // Meldungen
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const ROLE_LABELS: Record<string, string> = {
    ADMIN: '🔴 Administrator',
    OPERATOR: '🟡 Operator',
    VIEWER: '🔵 Betrachter',
  };

  // Profil laden
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await api.get('/auth/me');
        setEmail(res.data.email);
        setUsername(res.data.username);
        setRole(res.data.role);
        setCreatedAt(res.data.createdAt);
      } catch (err: any) {
        setProfileError('Profil konnte nicht geladen werden');
      } finally {
        setProfileLoading(false);
      }
    };
    loadProfile();
  }, []);

  // ─── Profil speichern ────────────────────────────────────────────────
  const handleProfileSave = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setProfileSaving(true);

    try {
      const data: any = {};
      if (email !== user?.email) data.email = email;
      if (username !== user?.username) data.username = username;

      if (Object.keys(data).length === 0) {
        setProfileError('Keine Änderungen vorgenommen');
        setProfileSaving(false);
        return;
      }

      const res = await api.put('/auth/me', data);

      // Auth-Store aktualisieren damit Sidebar den neuen Namen zeigt
      if (token) {
        authLogin(token, {
          id: res.data.id,
          email: res.data.email,
          username: res.data.username,
          role: res.data.role,
        });
      }

      setProfileSuccess('Profil erfolgreich aktualisiert');
    } catch (err: any) {
      setProfileError(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setProfileSaving(false);
    }
  };

  // ─── Passwort ändern ─────────────────────────────────────────────────
  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    // Client-seitige Validierung
    if (newPassword.length < 8) {
      setPasswordError('Neues Passwort muss mindestens 8 Zeichen lang sein');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwörter stimmen nicht überein');
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordError('Das neue Passwort muss sich vom aktuellen unterscheiden');
      return;
    }

    setPasswordSaving(true);

    try {
      await api.put('/auth/password', {
        currentPassword,
        newPassword,
      });
      setPasswordSuccess('Passwort erfolgreich geändert');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswords(false);
    } catch (err: any) {
      setPasswordError(err.response?.data?.error || 'Fehler beim Ändern des Passworts');
    } finally {
      setPasswordSaving(false);
    }
  };

  // Passwortstärke berechnen
  const getPasswordStrength = (pw: string): { label: string; color: string; width: string } => {
    if (!pw) return { label: '', color: '', width: '0%' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z\d]/.test(pw)) score++;

    if (score <= 1) return { label: 'Schwach', color: 'bg-red-500', width: '20%' };
    if (score <= 2) return { label: 'Mäßig', color: 'bg-yellow-500', width: '40%' };
    if (score <= 3) return { label: 'Gut', color: 'bg-blue-500', width: '60%' };
    if (score <= 4) return { label: 'Stark', color: 'bg-green-500', width: '80%' };
    return { label: 'Sehr stark', color: 'bg-green-400', width: '100%' };
  };

  const pwStrength = getPasswordStrength(newPassword);

  if (profileLoading) {
    return <div className="text-center py-20 text-gray-400">⏳ Lade Profil...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">👤 Mein Profil</h1>
        <p className="text-gray-400 text-sm mt-1">Profildaten und Passwort verwalten</p>
      </div>

      {/* ── Profil-Karte ───────────────────────────────────────────────── */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center text-3xl">
            {role === 'ADMIN' ? '👑' : role === 'OPERATOR' ? '⚙️' : '👁️'}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{user?.username}</h2>
            <p className="text-sm text-gray-400">{ROLE_LABELS[role] || role}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Registriert am {createdAt ? new Date(createdAt).toLocaleDateString('de-DE', {
                day: '2-digit', month: 'long', year: 'numeric'
              }) : '–'}
            </p>
          </div>
        </div>

        {profileError && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
            ❌ {profileError}
          </div>
        )}
        {profileSuccess && (
          <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-300 text-sm">
            ✅ {profileSuccess}
          </div>
        )}

        <form onSubmit={handleProfileSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Benutzername</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              minLength={3}
              maxLength={30}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">E-Mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Rolle</label>
            <input
              type="text"
              value={ROLE_LABELS[role] || role}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-gray-400 text-sm cursor-not-allowed"
              disabled
            />
            <p className="text-xs text-gray-500 mt-1">Die Rolle kann nur von einem Administrator geändert werden.</p>
          </div>
          <button
            type="submit"
            disabled={profileSaving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {profileSaving ? '⏳ Speichere...' : '💾 Profil speichern'}
          </button>
        </form>
      </div>

      {/* ── Passwort ändern ─────────────────────────────────────────────── */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">🔒 Passwort ändern</h2>

        {passwordError && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
            ❌ {passwordError}
          </div>
        )}
        {passwordSuccess && (
          <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-300 text-sm">
            ✅ {passwordSuccess}
          </div>
        )}

        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Aktuelles Passwort</label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Dein aktuelles Passwort"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Neues Passwort</label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Mindestens 8 Zeichen"
              required
              minLength={8}
            />
            {/* Passwortstärke */}
            {newPassword && (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${pwStrength.color} transition-all duration-300`}
                      style={{ width: pwStrength.width }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">{pwStrength.label}</span>
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Neues Passwort bestätigen</label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                confirmPassword && confirmPassword !== newPassword
                  ? 'border-red-500'
                  : confirmPassword && confirmPassword === newPassword
                  ? 'border-green-500'
                  : 'border-gray-600'
              }`}
              placeholder="Passwort wiederholen"
              required
              minLength={8}
            />
            {confirmPassword && confirmPassword !== newPassword && (
              <p className="text-xs text-red-400 mt-1">Passwörter stimmen nicht überein</p>
            )}
            {confirmPassword && confirmPassword === newPassword && (
              <p className="text-xs text-green-400 mt-1">✓ Passwörter stimmen überein</p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={passwordSaving || !currentPassword || !newPassword || newPassword !== confirmPassword}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {passwordSaving ? '⏳ Ändere...' : '🔑 Passwort ändern'}
            </button>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(e) => setShowPasswords(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
              />
              Passwörter anzeigen
            </label>
          </div>
        </form>

        {/* Sicherheitshinweise */}
        <div className="mt-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">🛡️ Passwort-Empfehlungen</h3>
          <ul className="text-xs text-gray-400 space-y-1">
            <li className={newPassword.length >= 12 ? 'text-green-400' : ''}>
              {newPassword.length >= 12 ? '✓' : '○'} Mindestens 12 Zeichen
            </li>
            <li className={/[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) ? 'text-green-400' : ''}>
              {/[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) ? '✓' : '○'} Groß- und Kleinbuchstaben
            </li>
            <li className={/\d/.test(newPassword) ? 'text-green-400' : ''}>
              {/\d/.test(newPassword) ? '✓' : '○'} Mindestens eine Zahl
            </li>
            <li className={/[^a-zA-Z\d]/.test(newPassword) ? 'text-green-400' : ''}>
              {/[^a-zA-Z\d]/.test(newPassword) ? '✓' : '○'} Sonderzeichen (z.B. !@#$%)
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
