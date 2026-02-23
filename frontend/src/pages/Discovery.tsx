// ─── Discovery & Scan Page v2 ────────────────────────────────────────────
// Erweitert um: Multi-Subnet-Scan, Auto-Configure, Discovery-Summary

import { useState, useEffect } from 'react';
import api from '../api/client';

export default function Discovery() {
  const [subnet, setSubnet] = useState('');
  const [schedule, setSchedule] = useState('');
  const [scans, setScans] = useState<any[]>([]);
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'scan' | 'discovered' | 'autocfg'>('scan');

  // Multi-Scan State
  const [multiSubnets, setMultiSubnets] = useState('');
  const [multiLoading, setMultiLoading] = useState(false);

  // Auto-Configure State
  const [discoveredServers, setDiscoveredServers] = useState<any[]>([]);
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set());
  const [cfgUser, setCfgUser] = useState('');
  const [cfgPassword, setCfgPassword] = useState('');
  const [cfgPort, setCfgPort] = useState('22');
  const [cfgAutoScan, setCfgAutoScan] = useState(true);
  const [cfgSchedule, setCfgSchedule] = useState('');
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgResult, setCfgResult] = useState<any>(null);

  // Discovery-Summary
  const [summary, setSummary] = useState<any>(null);

  // Individual SSH Config Modal
  const [sshConfigServer, setSshConfigServer] = useState<any>(null);

  const loadScans = () => {
    api.get('/scans/network').then((res) => setScans(res.data)).catch(console.error);
    api.get('/scans/jobs/status').then((res) => setJobStatus(res.data)).catch(console.error);
  };

  const loadDiscovered = () => {
    api.get('/discovery/discovered').then((res) => {
      setDiscoveredServers(res.data.servers || []);
    }).catch(console.error);
  };

  const loadSummary = () => {
    api.get('/discovery/summary').then((res) => setSummary(res.data)).catch(console.error);
  };

  useEffect(() => {
    loadScans();
    loadSummary();
    const interval = setInterval(loadScans, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === 'discovered' || activeTab === 'autocfg') {
      loadDiscovered();
    }
  }, [activeTab]);

  const startScan = async () => {
    if (!subnet) return;
    setLoading(true);
    try {
      await api.post('/scans/network', { subnet, schedule: schedule || null });
      setSubnet('');
      setSchedule('');
      loadScans();
      loadSummary();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Scan-Fehler');
    } finally {
      setLoading(false);
    }
  };

  const startMultiScan = async () => {
    const subnets = multiSubnets.split('\n').map(s => s.trim()).filter(Boolean);
    if (subnets.length === 0) return;
    setMultiLoading(true);
    try {
      const res = await api.post('/discovery/multi-scan', { subnets, schedule: schedule || null });
      alert(`${res.data.total} Scans gestartet!`);
      setMultiSubnets('');
      loadScans();
      loadSummary();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Multi-Scan Fehler');
    } finally {
      setMultiLoading(false);
    }
  };

  const autoConfigure = async () => {
    if (!cfgUser || !cfgPassword) return;
    setCfgLoading(true);
    setCfgResult(null);
    try {
      const serverIds = selectedServers.size > 0 ? Array.from(selectedServers) : undefined;
      const res = await api.post('/discovery/auto-configure', {
        serverIds,
        sshUser: cfgUser,
        sshPassword: cfgPassword,
        sshPort: parseInt(cfgPort) || 22,
        autoScan: cfgAutoScan,
        scanSchedule: cfgSchedule || null,
      });
      setCfgResult(res.data);
      setSelectedServers(new Set());
      loadDiscovered();
      loadSummary();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Auto-Configure Fehler');
    } finally {
      setCfgLoading(false);
    }
  };

  const purgeDiscovered = async () => {
    if (!confirm('Alle DISCOVERED Server löschen? Das kann nicht rückgängig gemacht werden.')) return;
    try {
      const res = await api.delete('/discovery/purge-discovered');
      alert(`${res.data.deleted} Server gelöscht`);
      loadDiscovered();
      loadSummary();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Fehler');
    }
  };

  const toggleServer = (id: string) => {
    setSelectedServers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedServers.size === discoveredServers.length) {
      setSelectedServers(new Set());
    } else {
      setSelectedServers(new Set(discoveredServers.map(s => s.id)));
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Discovery & Scans</h1>

      {/* Summary-Banner */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <SummaryCard icon="🔍" label="Entdeckt" value={summary.counts.discovered} color="text-yellow-400" />
          <SummaryCard icon="⚙️" label="Konfiguriert" value={summary.counts.configured} color="text-blue-400" />
          <SummaryCard icon="🟢" label="Online" value={summary.counts.online} color="text-green-400" />
          <SummaryCard icon="❌" label="Fehler" value={summary.counts.error} color="text-red-400" />
        </div>
      )}

      {/* Tab-Navigation */}
      <div className="flex gap-1 mb-6 bg-gray-800 rounded-lg p-1 w-fit">
        {[
          { key: 'scan' as const, label: '🌐 Netzwerkscan' },
          { key: 'discovered' as const, label: `🔍 Entdeckte Server (${discoveredServers.length})` },
          { key: 'autocfg' as const, label: '🤖 Auto-Configure' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Scan-Tab ═══ */}
      {activeTab === 'scan' && (
        <>
          {/* Einzel-Scan */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">🌐 Netzwerkscan (Nmap)</h2>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-300 mb-1">Subnetz</label>
                <input
                  type="text"
                  value={subnet}
                  onChange={(e) => setSubnet(e.target.value)}
                  placeholder="192.168.1.0/24"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="w-48">
                <label className="block text-sm font-medium text-gray-300 mb-1">Schedule (optional)</label>
                <input
                  type="text"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="0 2 * * *"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={startScan}
                disabled={loading || !subnet}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                {loading ? '⏳ Startet...' : '🚀 Scan starten'}
              </button>
            </div>
          </div>

          {/* Multi-Scan */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">🌐 Multi-Subnet-Scan</h2>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Subnetze (ein Subnetz pro Zeile)
                </label>
                <textarea
                  value={multiSubnets}
                  onChange={(e) => setMultiSubnets(e.target.value)}
                  placeholder={`192.168.1.0/24\n192.168.2.0/24\n10.0.0.0/16`}
                  rows={4}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm font-mono focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={startMultiScan}
                disabled={multiLoading || !multiSubnets.trim()}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap self-end"
              >
                {multiLoading ? '⏳ Startet...' : '🚀 Alle scannen'}
              </button>
            </div>
          </div>

          {/* Job-Status */}
          {jobStatus && (
            <div className="grid grid-cols-2 gap-4 mb-6">
              <QueueBox title="Server-Scans" data={jobStatus.serverScans} />
              <QueueBox title="Netzwerk-Scans" data={jobStatus.networkScans} />
            </div>
          )}

          {/* Scan-Historie */}
          <ScanHistoryTable scans={scans} />
        </>
      )}

      {/* ═══ Discovered-Tab ═══ */}
      {activeTab === 'discovered' && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl">
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              🔍 Entdeckte Server ({discoveredServers.length})
            </h2>
            {discoveredServers.length > 0 && (
              <button
                onClick={purgeDiscovered}
                className="px-3 py-1 text-xs bg-red-600/30 hover:bg-red-600/50 text-red-400 rounded transition-colors"
              >
                🗑️ Alle löschen
              </button>
            )}
          </div>
          {discoveredServers.length === 0 ? (
            <p className="p-4 text-gray-400 text-sm">
              Keine entdeckten Server. Starte einen Netzwerkscan, um Server zu finden.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-4 py-2 text-left text-xs text-gray-400">IP</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-400">Hostname</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-400">OS</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-400">Services</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-400">Entdeckt</th>
                  <th className="px-4 py-2 text-right text-xs text-gray-400">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {discoveredServers.map((server: any) => (
                  <tr key={server.id} className="hover:bg-gray-750">
                    <td className="px-4 py-2 text-white font-mono">{server.ip}</td>
                    <td className="px-4 py-2 text-gray-300">{server.hostname || '–'}</td>
                    <td className="px-4 py-2 text-gray-300 text-xs max-w-[200px] truncate">
                      {server.osInfo || '–'}
                    </td>
                    <td className="px-4 py-2 text-gray-400">{server._count?.services || 0}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">
                      {new Date(server.createdAt).toLocaleString('de-DE')}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setSshConfigServer(server)}
                          className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                          title="SSH-Zugangsdaten hinterlegen"
                        >
                          🔐 SSH
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`Server ${server.ip} löschen?`)) return;
                            try {
                              await api.delete(`/servers/${server.id}`);
                              loadDiscovered();
                              loadSummary();
                            } catch (err: any) {
                              alert(err.response?.data?.error || 'Fehler');
                            }
                          }}
                          className="px-2 py-1 text-xs bg-red-600/30 hover:bg-red-600/50 text-red-400 rounded transition-colors"
                          title="Server löschen"
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
      )}

      {/* ═══ Auto-Configure Tab ═══ */}
      {activeTab === 'autocfg' && (
        <div className="space-y-6">
          {/* Server-Auswahl */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-4">🤖 Auto-Configure</h2>
            <p className="text-sm text-gray-400 mb-4">
              Konfiguriere entdeckte Server automatisch mit SSH-Zugangsdaten.
              Wähle einzelne Server aus oder lasse das Feld leer, um alle DISCOVERED Server zu konfigurieren.
            </p>

            {discoveredServers.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-300">
                    Server auswählen ({selectedServers.size} / {discoveredServers.length})
                  </label>
                  <button onClick={toggleAll} className="text-xs text-blue-400 hover:text-blue-300">
                    {selectedServers.size === discoveredServers.length ? 'Keine auswählen' : 'Alle auswählen'}
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto bg-gray-700 rounded-lg divide-y divide-gray-600">
                  {discoveredServers.map((server: any) => (
                    <label
                      key={server.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-gray-600 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedServers.has(server.id)}
                        onChange={() => toggleServer(server.id)}
                        className="rounded border-gray-500"
                      />
                      <span className="text-sm text-white font-mono">{server.ip}</span>
                      {server.hostname && (
                        <span className="text-xs text-gray-400">({server.hostname})</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* SSH-Credentials */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">SSH-Benutzer</label>
                <input
                  type="text"
                  value={cfgUser}
                  onChange={(e) => setCfgUser(e.target.value)}
                  placeholder="root"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">SSH-Passwort</label>
                <input
                  type="password"
                  value={cfgPassword}
                  onChange={(e) => setCfgPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">SSH-Port</label>
                <input
                  type="number"
                  value={cfgPort}
                  onChange={(e) => setCfgPort(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                />
              </div>
            </div>

            {/* Optionen */}
            <div className="flex items-center gap-6 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfgAutoScan}
                  onChange={(e) => setCfgAutoScan(e.target.checked)}
                  className="rounded border-gray-500"
                />
                <span className="text-sm text-gray-300">Sofort scannen</span>
              </label>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-300">Schedule:</label>
                <input
                  type="text"
                  value={cfgSchedule}
                  onChange={(e) => setCfgSchedule(e.target.value)}
                  placeholder="0 2 * * * (optional)"
                  className="w-40 px-3 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm font-mono"
                />
              </div>
            </div>

            <button
              onClick={autoConfigure}
              disabled={cfgLoading || !cfgUser || !cfgPassword || (discoveredServers.length === 0 && selectedServers.size === 0)}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {cfgLoading ? '⏳ Konfiguriere...' : `🤖 ${selectedServers.size || discoveredServers.length} Server konfigurieren`}
            </button>
          </div>

          {/* Ergebnis */}
          {cfgResult && (
            <div className="bg-green-900/20 border border-green-800 rounded-xl p-4">
              <h3 className="text-green-400 font-medium mb-2">✅ Auto-Configure abgeschlossen</h3>
              <p className="text-sm text-gray-300">
                {cfgResult.configured} Server konfiguriert, {cfgResult.scansStarted} Scans gestartet
              </p>
              {cfgResult.servers && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {cfgResult.servers.map((ip: string) => (
                    <span key={ip} className="text-xs font-mono bg-green-900/30 text-green-400 px-2 py-1 rounded">
                      {ip}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SSH Config Modal for individual discovered server */}
      {sshConfigServer && (
        <SshConfigModal
          server={sshConfigServer}
          onClose={() => setSshConfigServer(null)}
          onSaved={() => { setSshConfigServer(null); loadDiscovered(); loadSummary(); }}
        />
      )}
    </div>
  );
}

// ─── Hilfskomponenten ────────────────────────────────────────────────────

function SummaryCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
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

function QueueBox({ title, data }: { title: string; data: { waiting: number; active: number; completed: number; failed: number } }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
      <h3 className="text-sm font-medium text-gray-400 mb-2">{title}</h3>
      <div className="grid grid-cols-4 gap-3 text-center">
        <div>
          <p className="text-xl font-bold text-yellow-400">{data.waiting}</p>
          <p className="text-xs text-gray-500">Wartend</p>
        </div>
        <div>
          <p className="text-xl font-bold text-blue-400">{data.active}</p>
          <p className="text-xs text-gray-500">Aktiv</p>
        </div>
        <div>
          <p className="text-xl font-bold text-green-400">{data.completed}</p>
          <p className="text-xs text-gray-500">Fertig</p>
        </div>
        <div>
          <p className="text-xl font-bold text-red-400">{data.failed}</p>
          <p className="text-xs text-gray-500">Fehler</p>
        </div>
      </div>
    </div>
  );
}

function ScanHistoryTable({ scans }: { scans: any[] }) {
  const [deleting, setDeleting] = useState<string | null>(null);

  const deleteScan = async (id: string) => {
    if (!confirm('Diesen Scan-Eintrag löschen?')) return;
    setDeleting(id);
    try {
      await api.delete(`/scans/network/${id}`);
      // Trigger parent reload by removing from local list
      window.location.reload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Fehler beim Löschen');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-white">Scan-Historie</h2>
      </div>
      {scans.length === 0 ? (
        <p className="p-4 text-gray-400 text-sm">Noch keine Scans durchgeführt</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-4 py-2 text-left text-xs text-gray-400">Subnetz</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Status</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Schedule</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Ergebnis</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Zeitpunkt</th>
              <th className="px-4 py-2 text-right text-xs text-gray-400">Aktion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {scans.map((scan) => (
              <tr key={scan.id} className="hover:bg-gray-750">
                <td className="px-4 py-2 text-white font-mono">{scan.subnet}</td>
                <td className="px-4 py-2">
                  <ScanStatusBadge status={scan.status} />
                </td>
                <td className="px-4 py-2 text-gray-400 font-mono">{scan.schedule || '–'}</td>
                <td className="px-4 py-2 text-gray-300">
                  {scan.results
                    ? `${(scan.results as any).hosts || 0} Hosts, ${(scan.results as any).newServers || 0} neu`
                    : scan.error || '–'
                  }
                </td>
                <td className="px-4 py-2 text-gray-400 text-xs">
                  {new Date(scan.createdAt).toLocaleString('de-DE')}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => deleteScan(scan.id)}
                    disabled={deleting === scan.id || scan.status === 'RUNNING'}
                    className="px-2 py-1 text-xs bg-red-600/30 hover:bg-red-600/50 disabled:bg-gray-700 disabled:text-gray-500 text-red-400 rounded transition-colors"
                    title={scan.status === 'RUNNING' ? 'Laufende Scans können nicht gelöscht werden' : 'Scan löschen'}
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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

// ─── SSH Config Modal for individual discovered host ─────────────────────

function SshConfigModal({ server, onClose, onSaved }: { server: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    sshUser: '',
    sshPassword: '',
    sshPort: '22',
    autoScan: true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.sshUser || !form.sshPassword) {
      setError('SSH User und Passwort sind erforderlich');
      return;
    }
    setError('');
    setSaving(true);
    try {
      // Update server with SSH credentials
      await api.put(`/servers/${server.id}`, {
        sshUser: form.sshUser,
        sshPassword: form.sshPassword,
        sshPort: parseInt(form.sshPort) || 22,
      });
      // Optionally trigger scan immediately
      if (form.autoScan) {
        try {
          await api.post(`/servers/${server.id}/scan`);
        } catch { /* scan error is not critical here */ }
      }
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">🔐 SSH für {server.ip}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>
          )}
          <p className="text-sm text-gray-400">
            Hinterlege SSH-Zugangsdaten für <span className="text-white font-mono">{server.ip}</span>
            {server.hostname && <span> ({server.hostname})</span>}, damit ein vollständiger System-Scan durchgeführt werden kann.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">SSH User *</label>
              <input
                type="text"
                value={form.sshUser}
                onChange={(e) => setForm({ ...form, sshUser: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                placeholder="root"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Passwort *</label>
              <input
                type="password"
                value={form.sshPassword}
                onChange={(e) => setForm({ ...form, sshPassword: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                placeholder="••••••••"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Port</label>
              <input
                type="number"
                value={form.sshPort}
                onChange={(e) => setForm({ ...form, sshPort: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.autoScan}
              onChange={(e) => setForm({ ...form, autoScan: e.target.checked })}
              className="rounded border-gray-500"
            />
            <span className="text-sm text-gray-300">Sofort scannen nach dem Speichern</span>
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white text-sm rounded-lg hover:bg-gray-700">
              Abbrechen
            </button>
            <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm font-medium rounded-lg">
              {saving ? '⏳...' : '💾 SSH speichern & konfigurieren'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
