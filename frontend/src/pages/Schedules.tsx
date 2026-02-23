// ─── Schedules Management Page ───────────────────────────────────────────
// Verwaltung aller Scan-Schedules (Server + Netzwerk)

import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

interface ServerSchedule {
  id: string;
  ip: string;
  hostname: string | null;
  scanSchedule: string | null;
  status: string;
  lastScanAt: string | null;
  lastScanError: string | null;
}

interface NetworkSchedule {
  id: string;
  subnet: string;
  schedule: string | null;
  status: string;
  createdAt: string;
}

interface SchedulerStats {
  activeServerSchedules: number;
  activeNetworkSchedules: number;
  totalScansTriggered: number;
  lastSyncAt: string | null;
  staleScansDetected: number;
  failedScansLast24h: number;
  upcomingScans: Array<{
    type: 'server' | 'network';
    target: string;
    schedule: string;
  }>;
}

interface ScheduleData {
  stats: SchedulerStats;
  serverSchedules: ServerSchedule[];
  networkSchedules: NetworkSchedule[];
}

export default function Schedules() {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // Network schedule editing
  const [editingNetId, setEditingNetId] = useState<string | null>(null);
  const [editNetValue, setEditNetValue] = useState('');
  // Add-schedule dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [allServers, setAllServers] = useState<Array<{ id: string; ip: string; hostname: string | null; scanSchedule: string | null }>>([]);
  const [addServerId, setAddServerId] = useState('');
  const [addCron, setAddCron] = useState('0 */6 * * *');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  const loadData = useCallback(() => {
    api.get('/schedules')
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const updateSchedule = async (serverId: string, schedule: string | null) => {
    setActionLoading(serverId);
    try {
      await api.put(`/schedules/server/${serverId}`, { scanSchedule: schedule });
      setEditingId(null);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Fehler beim Aktualisieren');
    } finally {
      setActionLoading(null);
    }
  };

  const removeSchedule = async (serverId: string) => {
    setActionLoading(serverId);
    try {
      await api.delete(`/schedules/server/${serverId}`);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Fehler beim Entfernen');
    } finally {
      setActionLoading(null);
    }
  };

  const triggerScan = async (serverId: string) => {
    setActionLoading(serverId);
    try {
      await api.post(`/schedules/server/${serverId}/trigger`);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Fehler beim Starten');
    } finally {
      setActionLoading(null);
    }
  };

  // ─── Add Schedule Dialog ──────────────────────────────────
  const openAddDialog = async () => {
    setAddError('');
    setAddCron('0 */6 * * *');
    setAddServerId('');
    try {
      const res = await api.get('/servers');
      const servers = res.data;
      // Filter to servers without a schedule
      const scheduledIds = new Set((data?.serverSchedules || []).map((s: any) => s.id));
      const available = servers.filter((s: any) => !scheduledIds.has(s.id) && !s.scanSchedule);
      setAllServers(available);
      if (available.length > 0) setAddServerId(available[0].id);
      setShowAddDialog(true);
    } catch {
      alert('Fehler beim Laden der Server');
    }
  };

  const submitAddSchedule = async () => {
    if (!addServerId || !addCron.trim()) return;
    setAddLoading(true);
    setAddError('');
    try {
      await api.put(`/schedules/server/${addServerId}`, { scanSchedule: addCron.trim() });
      setShowAddDialog(false);
      loadData();
    } catch (err: any) {
      setAddError(err.response?.data?.error || 'Fehler beim Erstellen');
    } finally {
      setAddLoading(false);
    }
  };

  // ─── Network Schedule Actions ────────────────────────────────
  const updateNetworkSchedule = async (scanId: string, schedule: string) => {
    setActionLoading(scanId);
    try {
      await api.put(`/schedules/network/${scanId}`, { schedule });
      setEditingNetId(null);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Fehler beim Aktualisieren');
    } finally {
      setActionLoading(null);
    }
  };

  const removeNetworkSchedule = async (scanId: string) => {
    if (!confirm('Netzwerk-Schedule entfernen?')) return;
    setActionLoading(scanId);
    try {
      await api.delete(`/schedules/network/${scanId}`);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Fehler beim Entfernen');
    } finally {
      setActionLoading(null);
    }
  };

  const triggerNetworkScan = async (subnet: string) => {
    setActionLoading(subnet);
    try {
      await api.post('/scans/network', { subnet });
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Fehler beim Starten');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-64 bg-gray-700 rounded" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-800 rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-gray-800 rounded-xl" />
      </div>
    );
  }

  if (!data) return <p className="text-red-400">Fehler beim Laden</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">⏰ Schedule-Verwaltung</h1>

      {/* Statistiken */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatBox
          icon="🖥️"
          label="Server-Schedules"
          value={data.stats.activeServerSchedules}
          color="text-green-400"
        />
        <StatBox
          icon="🌐"
          label="Netzwerk-Schedules"
          value={data.stats.activeNetworkSchedules}
          color="text-cyan-400"
        />
        <StatBox
          icon="📊"
          label="Scans getriggert"
          value={data.stats.totalScansTriggered}
          color="text-purple-400"
        />
        <StatBox
          icon="❌"
          label="Fehler (24h)"
          value={data.stats.failedScansLast24h}
          color={data.stats.failedScansLast24h > 0 ? 'text-red-400' : 'text-gray-400'}
        />
      </div>

      {/* Sync-Info */}
      {data.stats.lastSyncAt && (
        <p className="text-xs text-gray-500 mb-4">
          Letzte Synchronisation: {new Date(data.stats.lastSyncAt).toLocaleString('de-DE')}
        </p>
      )}

      {/* Server-Schedules */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl mb-6">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">🖥️ Server-Scan Schedules</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{data.serverSchedules.length} konfiguriert</span>
            <button
              onClick={openAddDialog}
              className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium"
            >
              ➕ Neuer Schedule
            </button>
          </div>
        </div>

        {data.serverSchedules.length === 0 ? (
          <p className="p-4 text-gray-400 text-sm">
            Keine Server-Schedules konfiguriert. Setze bei einem Server einen Cron-Ausdruck
            als Scan-Schedule, um automatische Scans zu aktivieren.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-2 text-left text-xs text-gray-400">Server</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400">Status</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400">Schedule</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400">Letzter Scan</th>
                <th className="px-4 py-2 text-right text-xs text-gray-400">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {data.serverSchedules.map((server) => (
                <tr key={server.id} className="hover:bg-gray-750">
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{server.hostname || server.ip}</p>
                    {server.hostname && (
                      <p className="text-xs text-gray-400 font-mono">{server.ip}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ServerStatusBadge status={server.status} />
                  </td>
                  <td className="px-4 py-3">
                    {editingId === server.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-32 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs font-mono"
                          placeholder="*/5 * * * *"
                          autoFocus
                        />
                        <button
                          onClick={() => updateSchedule(server.id, editValue || null)}
                          disabled={actionLoading === server.id}
                          className="text-green-400 hover:text-green-300 text-xs"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-gray-400 hover:text-gray-300 text-xs"
                        >
                          ✗
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingId(server.id);
                          setEditValue(server.scanSchedule || '');
                        }}
                        className="text-white font-mono text-xs hover:text-blue-400 transition-colors"
                      >
                        {server.scanSchedule || '–'}
                        <span className="text-gray-500 ml-1">✏️</span>
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {server.lastScanAt
                      ? new Date(server.lastScanAt).toLocaleString('de-DE')
                      : 'Noch nie'
                    }
                    {server.lastScanError && (
                      <p className="text-red-400 truncate max-w-[150px]">{server.lastScanError}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => triggerScan(server.id)}
                        disabled={actionLoading === server.id || server.status === 'SCANNING'}
                        className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded transition-colors"
                        title="Sofort scannen"
                      >
                        {actionLoading === server.id ? '⏳' : '▶ Scan'}
                      </button>
                      <button
                        onClick={() => removeSchedule(server.id)}
                        disabled={actionLoading === server.id}
                        className="px-2 py-1 text-xs bg-red-600/30 hover:bg-red-600/50 text-red-400 rounded transition-colors"
                        title="Schedule entfernen"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Netzwerk-Schedules */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">🌐 Netzwerk-Scan Schedules</h2>
          <span className="text-xs text-gray-400">{data.networkSchedules.length} konfiguriert</span>
        </div>

        {data.networkSchedules.length === 0 ? (
          <p className="p-4 text-gray-400 text-sm">
            Keine Netzwerk-Schedules konfiguriert. Starte einen Netzwerkscan mit Schedule-Option
            unter „Discovery & Scans".
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-2 text-left text-xs text-gray-400">Subnetz</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400">Schedule</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400">Status</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400">Erstellt</th>
                <th className="px-4 py-2 text-right text-xs text-gray-400">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {data.networkSchedules.map((ns) => (
                <tr key={ns.id} className="hover:bg-gray-750">
                  <td className="px-4 py-3 text-white font-mono">{ns.subnet}</td>
                  <td className="px-4 py-3">
                    {editingNetId === ns.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editNetValue}
                          onChange={(e) => setEditNetValue(e.target.value)}
                          className="w-32 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs font-mono"
                          placeholder="0 2 * * *"
                          autoFocus
                        />
                        <button
                          onClick={() => updateNetworkSchedule(ns.id, editNetValue)}
                          disabled={actionLoading === ns.id}
                          className="text-green-400 hover:text-green-300 text-xs"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setEditingNetId(null)}
                          className="text-gray-400 hover:text-gray-300 text-xs"
                        >
                          ✗
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingNetId(ns.id); setEditNetValue(ns.schedule || ''); }}
                        className="text-gray-300 font-mono text-xs hover:text-blue-400 transition-colors"
                      >
                        {ns.schedule || '–'}
                        <span className="text-gray-500 ml-1">✏️</span>
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ScanStatusBadge status={ns.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(ns.createdAt).toLocaleString('de-DE')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => triggerNetworkScan(ns.subnet)}
                        disabled={actionLoading === ns.subnet || actionLoading === ns.id}
                        className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded transition-colors"
                        title="Jetzt scannen"
                      >
                        {actionLoading === ns.subnet ? '⏳' : '▶ Scan'}
                      </button>
                      <button
                        onClick={() => removeNetworkSchedule(ns.id)}
                        disabled={actionLoading === ns.id}
                        className="px-2 py-1 text-xs bg-red-600/30 hover:bg-red-600/50 text-red-400 rounded transition-colors"
                        title="Schedule entfernen"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Schedule Modal */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">➕ Server-Schedule hinzufügen</h2>
              <button onClick={() => setShowAddDialog(false)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {addError && (
                <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">{addError}</div>
              )}

              {allServers.length === 0 ? (
                <p className="text-gray-400 text-sm">Alle Server haben bereits einen Schedule.</p>
              ) : (
                <>
                  {/* Server Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Server auswählen</label>
                    <select
                      value={addServerId}
                      onChange={(e) => setAddServerId(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                    >
                      {allServers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.hostname ? `${s.hostname} (${s.ip})` : s.ip}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Cron Expression */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Cron-Ausdruck</label>
                    <input
                      type="text"
                      value={addCron}
                      onChange={(e) => setAddCron(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm font-mono focus:ring-2 focus:ring-purple-500"
                      placeholder="0 */6 * * *"
                    />
                  </div>

                  {/* Quick Presets */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Alle 15 Min', cron: '*/15 * * * *' },
                      { label: 'Stündlich', cron: '0 * * * *' },
                      { label: 'Alle 6h', cron: '0 */6 * * *' },
                      { label: 'Täglich 02:00', cron: '0 2 * * *' },
                      { label: 'Wöchentlich Mo', cron: '0 2 * * 1' },
                      { label: 'Monatlich', cron: '0 0 1 * *' },
                    ].map((p) => (
                      <button
                        key={p.cron}
                        onClick={() => setAddCron(p.cron)}
                        className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                          addCron === p.cron
                            ? 'bg-purple-600 border-purple-500 text-white'
                            : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        <span className="font-mono">{p.cron}</span>
                        <br />
                        <span className="text-gray-400">{p.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowAddDialog(false)}
                  className="px-4 py-2 text-gray-300 hover:text-white text-sm rounded-lg hover:bg-gray-700"
                >
                  Abbrechen
                </button>
                {allServers.length > 0 && (
                  <button
                    onClick={submitAddSchedule}
                    disabled={addLoading || !addServerId || !addCron.trim()}
                    className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {addLoading ? '⏳ Speichern...' : '💾 Schedule erstellen'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cron-Hilfe */}
      <div className="mt-6 bg-gray-800 border border-gray-700 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">📖 Cron-Referenz</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
          {[
            { expr: '*/5 * * * *', desc: 'Alle 5 Minuten' },
            { expr: '0 * * * *', desc: 'Jede Stunde' },
            { expr: '0 */6 * * *', desc: 'Alle 6 Stunden' },
            { expr: '0 2 * * *', desc: 'Täglich 02:00' },
            { expr: '0 2 * * 1', desc: 'Montags 02:00' },
            { expr: '0 0 1 * *', desc: 'Monatlich 00:00' },
          ].map((example) => (
            <div key={example.expr} className="bg-gray-700 rounded-lg p-2">
              <p className="text-white font-mono">{example.expr}</p>
              <p className="text-gray-400 mt-1">{example.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Hilfskomponenten ────────────────────────────────────────────────────

function StatBox({ icon, label, value, color }: {
  icon: string; label: string; value: number; color: string;
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <span>{icon}</span>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function ServerStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ONLINE: 'bg-green-900/50 text-green-400 border-green-800',
    OFFLINE: 'bg-red-900/50 text-red-400 border-red-800',
    SCANNING: 'bg-purple-900/50 text-purple-400 border-purple-800',
    ERROR: 'bg-red-900/50 text-red-400 border-red-800',
    DISCOVERED: 'bg-yellow-900/50 text-yellow-400 border-yellow-800',
    CONFIGURED: 'bg-blue-900/50 text-blue-400 border-blue-800',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${colors[status] || 'bg-gray-700'}`}>
      {status}
    </span>
  );
}

function ScanStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-yellow-900/50 text-yellow-400 border-yellow-800',
    RUNNING: 'bg-blue-900/50 text-blue-400 border-blue-800',
    COMPLETED: 'bg-green-900/50 text-green-400 border-green-800',
    FAILED: 'bg-red-900/50 text-red-400 border-red-800',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${colors[status] || 'bg-gray-700'}`}>
      {status}
    </span>
  );
}
