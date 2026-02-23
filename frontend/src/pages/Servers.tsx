// ─── Servers Page ────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

interface ServerSummary {
  id: string;
  ip: string;
  hostname: string | null;
  osInfo: string | null;
  status: string;
  sshUser: string | null;
  sshPort: number;
  lastScanAt: string | null;
  lastScanError: string | null;
  scanSchedule: string | null;
  aiPurpose: string | null;
  aiTags: string[];
  _count: {
    services: number;
    outgoingEdges: number;
    incomingEdges: number;
    dockerContainers: number;
  };
}

// IP-Adresse als Zahl für korrekte Sortierung
function ipToNumber(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

export default function Servers() {
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editServer, setEditServer] = useState<ServerSummary | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const loadServers = () => {
    api.get('/servers')
      .then((res) => setServers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadServers(); }, []);

  // Sortiert nach IP aufsteigend + gefiltert
  const filteredServers = useMemo(() => {
    let list = [...servers];

    // Status-Filter
    if (statusFilter !== 'ALL') {
      list = list.filter((s) => s.status === statusFilter);
    }

    // Text-Filter (IP, Hostname, OS)
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(
        (s) =>
          s.ip.includes(q) ||
          (s.hostname && s.hostname.toLowerCase().includes(q)) ||
          (s.osInfo && s.osInfo.toLowerCase().includes(q)) ||
          (s.aiPurpose && s.aiPurpose.toLowerCase().includes(q)) ||
          (s.aiTags && s.aiTags.some(t => t.toLowerCase().includes(q)))
      );
    }

    // Sortierung nach IP aufsteigend
    list.sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip));

    return list;
  }, [servers, filter, statusFilter]);

  const triggerScan = async (id: string) => {
    try {
      await api.post(`/servers/${id}/scan`);
      loadServers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Scan-Fehler');
    }
  };

  const deleteServer = async (id: string, ip: string) => {
    if (!confirm(`Server ${ip} wirklich löschen?`)) return;
    try {
      await api.delete(`/servers/${id}`);
      loadServers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Lösch-Fehler');
    }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      ONLINE: 'bg-green-900/50 text-green-400 border-green-800',
      OFFLINE: 'bg-red-900/50 text-red-400 border-red-800',
      DISCOVERED: 'bg-yellow-900/50 text-yellow-400 border-yellow-800',
      CONFIGURED: 'bg-blue-900/50 text-blue-400 border-blue-800',
      SCANNING: 'bg-purple-900/50 text-purple-400 border-purple-800',
      ERROR: 'bg-red-900/50 text-red-400 border-red-800',
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${colors[status] || 'bg-gray-700 text-gray-400'}`}>
        {status}
      </span>
    );
  };

  // Unique status values for filter dropdown
  const statusOptions = useMemo(() => {
    const set = new Set(servers.map((s) => s.status));
    return ['ALL', ...Array.from(set).sort()];
  }, [servers]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Server</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + Server hinzufügen
        </button>
      </div>

      {/* Filter-Bar */}
      {servers.length > 0 && (
        <div className="flex gap-3 mb-4">
          <div className="flex-1 max-w-md">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="🔍 IP, Hostname oder OS filtern..."
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500"
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s === 'ALL' ? 'Alle Status' : s}
              </option>
            ))}
          </select>
          <span className="self-center text-sm text-gray-400">
            {filteredServers.length} / {servers.length}
          </span>
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-800 rounded-lg" />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center py-16 bg-gray-800 rounded-xl border border-gray-700">
          <p className="text-gray-400 text-lg mb-4">Noch keine Server erfasst</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Ersten Server anlegen
          </button>
        </div>
      ) : (
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700 text-left">
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">IP ↑</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">Hostname</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">OS</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">Services</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">Container</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">Letzter Scan</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredServers.map((s) => (
                <tr key={s.id} className="hover:bg-gray-750">
                  <td className="px-4 py-3">
                    <Link to={`/servers/${s.id}`} className="text-blue-400 hover:text-blue-300 font-mono text-sm">
                      {s.ip}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">
                    <div>
                      {s.hostname || '–'}
                      {s.aiPurpose && (
                        <p className="text-xs text-indigo-400 mt-0.5 truncate max-w-[200px]" title={s.aiPurpose}>
                          🤖 {s.aiPurpose}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-xs truncate">{s.osInfo || '–'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {statusBadge(s.status)}
                      {s.status === 'ERROR' && s.lastScanError && (
                        <button
                          onClick={() => setExpandedError(expandedError === s.id ? null : s.id)}
                          className="text-red-400 hover:text-red-300 text-xs cursor-pointer"
                          title="Fehlerdetails anzeigen"
                        >
                          {expandedError === s.id ? '▲' : '▼'} Details
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">{s._count.services}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{s._count.dockerContainers}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {s.lastScanAt ? new Date(s.lastScanAt).toLocaleString('de-DE') : 'Nie'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => triggerScan(s.id)}
                        disabled={s.status === 'SCANNING' || !s.sshUser}
                        className="px-2.5 py-1 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded transition-colors"
                        title={!s.sshUser ? 'SSH-Daten erforderlich – zuerst bearbeiten ✏️' : 'Scan starten'}
                      >
                        🔍
                      </button>
                      <button
                        onClick={() => setEditServer(s)}
                        className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                        title="SSH-Zugangsdaten bearbeiten"
                      >
                        ✏️
                      </button>
                      <Link
                        to={`/servers/${s.id}`}
                        className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                      >
                        📋
                      </Link>
                      <button
                        onClick={() => deleteServer(s.id, s.ip)}
                        className="px-2.5 py-1 bg-red-800 hover:bg-red-700 text-white text-xs rounded transition-colors"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {/* Fehler-Details Zeilen */}
              {filteredServers
                .filter((s) => expandedError === s.id && s.lastScanError)
                .map((s) => (
                  <tr key={`${s.id}-error`}>
                    <td colSpan={8} className="px-4 py-3 bg-red-900/20 border-t border-red-900/30">
                      <div className="flex items-start gap-3">
                        <span className="text-red-400 text-lg mt-0.5">⚠️</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-red-300 mb-1">Letzter Scan-Fehler</p>
                          <pre className="text-xs text-red-200/80 whitespace-pre-wrap break-words font-mono bg-red-900/30 rounded-lg p-3 border border-red-900/40 max-h-48 overflow-y-auto">{s.lastScanError}</pre>
                        </div>
                        <button
                          onClick={() => triggerScan(s.id)}
                          className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs rounded-lg transition-colors whitespace-nowrap"
                        >
                          🔄 Erneut scannen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Server Modal */}
      {showAddModal && (
        <ServerFormModal
          mode="add"
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); loadServers(); }}
        />
      )}

      {/* Edit Server Modal */}
      {editServer && (
        <ServerFormModal
          mode="edit"
          server={editServer}
          onClose={() => setEditServer(null)}
          onSaved={() => { setEditServer(null); loadServers(); }}
        />
      )}
    </div>
  );
}

// ─── Server Form Modal (Add + Edit) ────────────────────────────────────

function ServerFormModal({
  mode,
  server,
  onClose,
  onSaved,
}: {
  mode: 'add' | 'edit';
  server?: ServerSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    ip: server?.ip || '',
    hostname: server?.hostname || '',
    sshUser: server?.sshUser || '',
    sshPassword: '',
    sshPort: String(server?.sshPort || 22),
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'add') {
        await api.post('/servers', {
          ip: form.ip,
          hostname: form.hostname || undefined,
          sshUser: form.sshUser || undefined,
          sshPassword: form.sshPassword || undefined,
          sshPort: parseInt(form.sshPort) || 22,
        });
      } else {
        // Edit mode – PUT /servers/:id
        const updates: Record<string, any> = {
          hostname: form.hostname || null,
          sshUser: form.sshUser || null,
          sshPort: parseInt(form.sshPort) || 22,
        };
        // Nur senden wenn ein neues Passwort eingegeben wurde
        if (form.sshPassword) {
          updates.sshPassword = form.sshPassword;
        }
        await api.put(`/servers/${server!.id}`, updates);
      }
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Fehler beim Speichern');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">
            {mode === 'add' ? 'Server hinzufügen' : `Server ${server?.ip} bearbeiten`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">IP-Adresse *</label>
              <input
                type="text"
                value={form.ip}
                onChange={(e) => setForm({ ...form, ip: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                placeholder="192.168.1.100"
                required
                disabled={mode === 'edit'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Hostname</label>
              <input
                type="text"
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="webserver-01"
              />
            </div>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <p className="text-sm text-gray-400 mb-3">🔐 SSH-Zugangsdaten (für System-Scans)</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">SSH User</label>
                <input
                  type="text"
                  value={form.sshUser}
                  onChange={(e) => setForm({ ...form, sshUser: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="root"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {mode === 'edit' ? 'Neues Passwort' : 'Passwort'}
                </label>
                <input
                  type="password"
                  value={form.sshPassword}
                  onChange={(e) => setForm({ ...form, sshPassword: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={mode === 'edit' ? 'Leer = unverändert' : '••••••••'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Port</label>
                <input
                  type="number"
                  value={form.sshPort}
                  onChange={(e) => setForm({ ...form, sshPort: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="22"
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            🔒 SSH-Passwörter werden mit AES-256-GCM verschlüsselt in der Datenbank gespeichert.
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-white text-sm rounded-lg hover:bg-gray-700 transition-colors"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? '⏳ Speichern...' : mode === 'add' ? 'Server anlegen' : 'Änderungen speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
