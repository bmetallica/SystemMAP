// ─── Server Detail Page ──────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import ProcessMap from '../components/ProcessMap';
import type { ProcessTreeData } from '../components/ProcessMap';

type Tab = 'overview' | 'processes' | 'storage' | 'network' | 'docker' | 'connections' | 'systemd' | 'cron' | 'ssl' | 'users' | 'services' | 'processmap' | 'runbook' | 'healthlogs';

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const [server, setServer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [showSshEdit, setShowSshEdit] = useState(false);
  const [showScheduleEdit, setShowScheduleEdit] = useState(false);

  const loadServer = () => {
    if (!id) return;
    api.get(`/servers/${id}`)
      .then((res) => setServer(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadServer(); }, [id]);

  const triggerScan = async () => {
    if (!id) return;
    setScanning(true);
    setScanMessage('');
    try {
      await api.post(`/servers/${id}/scan`);
      setScanMessage('✅ Scan gestartet – Seite wird nach Abschluss aktualisiert.');
      // Polling for scan completion
      const poll = setInterval(() => {
        api.get(`/servers/${id}`).then((res) => {
          setServer(res.data);
          if (res.data.status !== 'SCANNING') {
            clearInterval(poll);
            setScanning(false);
            if (res.data.status === 'ERROR') {
              setScanMessage('');
            } else {
              setScanMessage('✅ Scan erfolgreich abgeschlossen.');
              setTimeout(() => setScanMessage(''), 5000);
            }
          }
        }).catch(() => { /* ignore polling errors */ });
      }, 3000);
      // Timeout polling after 5 minutes
      setTimeout(() => { clearInterval(poll); setScanning(false); }, 300_000);
    } catch (err: any) {
      setScanMessage(`❌ ${err.response?.data?.error || 'Scan konnte nicht gestartet werden'}`);
      setScanning(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse"><div className="h-96 bg-gray-800 rounded-xl" /></div>;
  }

  if (!server) {
    return <p className="text-red-400">Server nicht gefunden</p>;
  }

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'overview', label: 'Übersicht', icon: '📋' },
    { key: 'processes', label: `Prozesse (${server.processes?.length || 0})`, icon: '⚙️' },
    { key: 'services', label: `Services (${server.services?.length || 0})`, icon: '🔧' },
    { key: 'systemd', label: `Systemd (${server.systemdUnits?.length || 0})`, icon: '🏗️' },
    { key: 'storage', label: `Storage (${server.mounts?.length || 0})`, icon: '💾' },
    { key: 'network', label: `Netzwerk (${server.networkInterfaces?.length || 0})`, icon: '🌐' },
    { key: 'docker', label: `Docker (${server.dockerContainers?.length || 0})`, icon: '🐳' },
    { key: 'cron', label: `Cron (${server.cronJobs?.length || 0})`, icon: '⏰' },
    { key: 'ssl', label: `SSL (${server.sslCertificates?.length || 0})`, icon: '🔒' },
    { key: 'users', label: `Benutzer (${server.userAccounts?.length || 0})`, icon: '👤' },
    { key: 'connections', label: 'Verbindungen', icon: '🔗' },
    { key: 'processmap', label: '🗺️ Prozessmap', icon: '🗺️' },
    { key: 'runbook', label: '📋 Runbook', icon: '📋' },
    { key: 'healthlogs', label: '🏥 Health & Logs', icon: '🏥' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link to="/servers" className="text-gray-400 hover:text-white transition-colors">← Zurück</Link>
          <div>
            <h1 className="text-2xl font-bold text-white">
              {server.hostname || server.ip}
            </h1>
            <p className="text-sm text-gray-400">
              {server.ip} • {server.osInfo || 'OS unbekannt'} • {server.kernelInfo || ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowScheduleEdit(true)}
            className={`px-3 py-2 text-white text-sm rounded-lg transition-colors ${
              server.scanSchedule
                ? 'bg-purple-700 hover:bg-purple-600'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
            title={server.scanSchedule ? `Schedule: ${server.scanSchedule}` : 'Scan-Schedule hinzufügen'}
          >
            ⏰ {server.scanSchedule ? 'Schedule' : 'Schedule hinzufügen'}
          </button>
          <button
            onClick={() => setShowSshEdit(true)}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
            title="SSH-Zugangsdaten bearbeiten"
          >
            🔐 SSH bearbeiten
          </button>
          <button
            onClick={triggerScan}
            disabled={scanning || !server.sshUser}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
            title={!server.sshUser ? 'SSH-Daten erforderlich' : 'Scan starten'}
          >
            {scanning ? '⏳ Scannt...' : '🔍 Scan starten'}
          </button>
        </div>
      </div>

      {/* Scan Error Banner */}
      {server.status === 'ERROR' && server.lastScanError && (
        <div className="mb-6 bg-red-900/30 border border-red-700 rounded-xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-red-400 text-lg">⚠️</span>
                <h3 className="text-red-300 font-semibold">Scan fehlgeschlagen</h3>
                {server.lastScanError.match(/^\[(\w+)\]/) && (
                  <span className="px-2 py-0.5 text-xs bg-red-800 text-red-200 rounded">
                    {server.lastScanError.match(/^\[(\w+)\]/)![1]}
                  </span>
                )}
              </div>
              <pre className="text-sm text-red-200 whitespace-pre-wrap break-words font-mono bg-red-950/50 rounded p-3 max-h-48 overflow-y-auto">
                {server.lastScanError}
              </pre>
              {server.lastScanAt && (
                <p className="text-xs text-red-400 mt-2">
                  Letzter Scan-Versuch: {new Date(server.lastScanAt).toLocaleString('de-DE')}
                </p>
              )}
            </div>
            <button
              onClick={triggerScan}
              disabled={scanning}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              {scanning ? '⏳ Scannt...' : '🔄 Erneut scannen'}
            </button>
          </div>
        </div>
      )}

      {/* Scan Status Message */}
      {scanMessage && (
        <div className="mb-4 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200">
          {scanMessage}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-800 p-1 rounded-lg border border-gray-700 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab server={server} />}
      {activeTab === 'processes' && <ProcessesTab processes={server.processes || []} />}
      {activeTab === 'services' && <ServicesTab services={server.services || []} />}
      {activeTab === 'systemd' && <SystemdTab units={server.systemdUnits || []} />}
      {activeTab === 'storage' && <StorageTab mounts={server.mounts || []} lvmVolumes={server.lvmVolumes || []} />}
      {activeTab === 'network' && <NetworkTab interfaces={server.networkInterfaces || []} />}
      {activeTab === 'docker' && <DockerTab containers={server.dockerContainers || []} />}
      {activeTab === 'cron' && <CronTab cronJobs={server.cronJobs || []} />}
      {activeTab === 'ssl' && <SslTab certificates={server.sslCertificates || []} />}
      {activeTab === 'users' && <UsersTab users={server.userAccounts || []} />}
      {activeTab === 'connections' && <ConnectionsTab server={server} />}
      {activeTab === 'processmap' && <ProcessMapTab serverId={server.id} hostname={server.hostname || server.ip} />}
      {activeTab === 'runbook' && <RunbookTab serverId={server.id} hostname={server.hostname || server.ip} />}
      {activeTab === 'healthlogs' && <HealthLogsTab serverId={server.id} hostname={server.hostname || server.ip} />}

      {/* SSH Edit Modal */}
      {showSshEdit && (
        <SshEditModal
          server={server}
          onClose={() => setShowSshEdit(false)}
          onSaved={() => { setShowSshEdit(false); loadServer(); }}
        />
      )}

      {/* Schedule Edit Modal */}
      {showScheduleEdit && (
        <ScheduleEditModal
          server={server}
          onClose={() => setShowScheduleEdit(false)}
          onSaved={() => { setShowScheduleEdit(false); loadServer(); }}
        />
      )}
    </div>
  );
}

// ─── SSH Edit Modal ──────────────────────────────────────────────────────

function SshEditModal({ server, onClose, onSaved }: { server: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    hostname: server.hostname || '',
    sshUser: server.sshUser || '',
    sshPassword: '',
    sshPort: String(server.sshPort || 22),
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const updates: Record<string, any> = {
        hostname: form.hostname || null,
        sshUser: form.sshUser || null,
        sshPort: parseInt(form.sshPort) || 22,
      };
      if (form.sshPassword) updates.sshPassword = form.sshPassword;
      await api.put(`/servers/${server.id}`, updates);
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">🔐 SSH-Zugangsdaten – {server.ip}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Hostname</label>
            <input
              type="text"
              value={form.hostname}
              onChange={(e) => setForm({ ...form, hostname: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
              placeholder="webserver-01"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">SSH User</label>
              <input
                type="text"
                value={form.sshUser}
                onChange={(e) => setForm({ ...form, sshUser: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                placeholder="root"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Neues Passwort</label>
              <input
                type="password"
                value={form.sshPassword}
                onChange={(e) => setForm({ ...form, sshPassword: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                placeholder="Leer = unverändert"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Port</label>
              <input
                type="number"
                value={form.sshPort}
                onChange={(e) => setForm({ ...form, sshPort: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white text-sm rounded-lg hover:bg-gray-700">
              Abbrechen
            </button>
            <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm font-medium rounded-lg">
              {saving ? '⏳ Speichern...' : 'Änderungen speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Schedule Edit Modal ─────────────────────────────────────────────────

function ScheduleEditModal({ server, onClose, onSaved }: { server: any; onClose: () => void; onSaved: () => void }) {
  const [schedule, setSchedule] = useState(server.scanSchedule || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const presets = [
    { label: 'Alle 5 Min', cron: '*/5 * * * *' },
    { label: 'Alle 15 Min', cron: '*/15 * * * *' },
    { label: 'Stündlich', cron: '0 * * * *' },
    { label: 'Alle 6h', cron: '0 */6 * * *' },
    { label: 'Täglich 02:00', cron: '0 2 * * *' },
    { label: 'Wöchentlich Mo', cron: '0 2 * * 1' },
  ];

  const handleSave = async () => {
    if (!schedule.trim()) {
      setError('Bitte einen Cron-Ausdruck eingeben oder ein Preset wählen.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.put(`/schedules/server/${server.id}`, { scanSchedule: schedule.trim() });
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Speichern des Schedules');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    setError('');
    try {
      await api.delete(`/schedules/server/${server.id}`);
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Entfernen des Schedules');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">⏰ Scan-Schedule – {server.hostname || server.ip}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>
          )}

          {/* Current status */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Aktuell:</span>
            {server.scanSchedule ? (
              <span className="px-2 py-0.5 bg-purple-900/50 border border-purple-700 text-purple-300 rounded font-mono text-xs">
                {server.scanSchedule}
              </span>
            ) : (
              <span className="text-gray-500">Kein Schedule (nur manuell)</span>
            )}
          </div>

          {/* Cron input */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Cron-Ausdruck</label>
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              placeholder="*/30 * * * *"
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-1">Format: Minute Stunde Tag Monat Wochentag</p>
          </div>

          {/* Presets */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Schnellauswahl</label>
            <div className="grid grid-cols-3 gap-2">
              {presets.map((p) => (
                <button
                  key={p.cron}
                  onClick={() => setSchedule(p.cron)}
                  className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                    schedule === p.cron
                      ? 'bg-purple-600 border-purple-500 text-white'
                      : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white'
                  }`}
                >
                  <span className="font-mono">{p.cron}</span>
                  <br />
                  <span className="text-gray-400">{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <div>
              {server.scanSchedule && (
                <button
                  onClick={handleRemove}
                  disabled={saving}
                  className="px-4 py-2 text-red-400 hover:text-red-300 hover:bg-red-900/30 text-sm rounded-lg transition-colors"
                >
                  🗑️ Schedule entfernen
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-300 hover:text-white text-sm rounded-lg hover:bg-gray-700"
              >
                Abbrechen
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !schedule.trim()}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saving ? '⏳ Speichern...' : '💾 Schedule speichern'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────

function OverviewTab({ server }: { server: any }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* KI-Zusammenfassung (volle Breite, wenn vorhanden) */}
      {(server.aiPurpose || server.aiSummary || server.aiAnalyses?.[0]) && (
        <AiSummaryCard server={server} />
      )}
      <InfoCard title="System-Informationen" items={[
        { label: 'IP-Adresse', value: server.ip },
        { label: 'Hostname', value: server.hostname || '–' },
        { label: 'Betriebssystem', value: server.osInfo || '–' },
        { label: 'Kernel', value: server.kernelInfo || '–' },
        { label: 'CPU', value: server.cpuInfo || '–' },
        { label: 'RAM', value: server.memoryMb ? `${server.memoryMb} MB` : '–' },
        { label: 'Status', value: server.status },
      ]} />
      <InfoCard title="SSH-Konfiguration" items={[
        { label: 'SSH User', value: server.sshUser || '–' },
        { label: 'SSH Port', value: String(server.sshPort) },
        { label: 'Passwort hinterlegt', value: server.hasSshPassword ? '✅ Ja' : '❌ Nein' },
        { label: 'SSH-Key hinterlegt', value: server.hasSshKey ? '✅ Ja' : '❌ Nein' },
        { label: 'Letzter Scan', value: server.lastScanAt ? new Date(server.lastScanAt).toLocaleString('de-DE') : 'Nie' },
        { label: 'Scan-Schedule', value: server.scanSchedule || 'Manuell' },
      ]} />
    </div>
  );
}

function ProcessesTab({ processes }: { processes: any[] }) {
  const [filter, setFilter] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const filtered = processes.filter(
    (p) => !filter || p.command?.toLowerCase().includes(filter.toLowerCase()) || p.args?.toLowerCase().includes(filter.toLowerCase()) || p.user?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Prozesse filtern (Name, Args, User)..."
          className="flex-1 max-w-md px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500"
        />
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showDetails}
            onChange={(e) => setShowDetails(e.target.checked)}
            className="rounded bg-gray-700 border-gray-600"
          />
          Details anzeigen
        </label>
      </div>
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-3 py-2 text-left text-xs text-gray-400">PID</th>
              {showDetails && <th className="px-3 py-2 text-left text-xs text-gray-400">PPID</th>}
              <th className="px-3 py-2 text-left text-xs text-gray-400">User</th>
              <th className="px-3 py-2 text-right text-xs text-gray-400">CPU%</th>
              <th className="px-3 py-2 text-right text-xs text-gray-400">MEM%</th>
              {showDetails && <th className="px-3 py-2 text-right text-xs text-gray-400">RSS MB</th>}
              {showDetails && <th className="px-3 py-2 text-right text-xs text-gray-400">Threads</th>}
              {showDetails && <th className="px-3 py-2 text-right text-xs text-gray-400">FDs</th>}
              <th className="px-3 py-2 text-left text-xs text-gray-400">Kommando</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700 font-mono">
            {filtered.slice(0, 100).map((p) => (
              <tr key={p.id} className="hover:bg-gray-750">
                <td className="px-3 py-1.5 text-gray-300">{p.pid}</td>
                {showDetails && <td className="px-3 py-1.5 text-gray-500">{p.ppid || '–'}</td>}
                <td className="px-3 py-1.5 text-gray-400">{p.user}</td>
                <td className="px-3 py-1.5 text-right text-gray-300">{p.cpuPct?.toFixed(1)}</td>
                <td className="px-3 py-1.5 text-right text-gray-300">{p.memPct?.toFixed(1)}</td>
                {showDetails && <td className="px-3 py-1.5 text-right text-gray-400">{p.rssMb || '–'}</td>}
                {showDetails && <td className="px-3 py-1.5 text-right text-gray-400">{p.threads || '–'}</td>}
                {showDetails && <td className="px-3 py-1.5 text-right text-gray-400">{p.fdCount || '–'}</td>}
                <td className="px-3 py-1.5 text-gray-300 truncate max-w-xl" title={`${p.command} ${p.args || ''}`}>
                  <span className="text-blue-400">{p.command}</span>
                  {p.args && <span className="text-gray-500 ml-1">{p.args}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 100 && (
          <p className="px-4 py-2 text-xs text-gray-500">
            Zeigt 100 von {filtered.length} Prozessen
          </p>
        )}
      </div>
    </div>
  );
}

function StorageTab({ mounts, lvmVolumes }: { mounts: any[]; lvmVolumes: any[] }) {
  return (
    <div className="space-y-6">
      {/* Mounts */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700">
          <h3 className="text-white font-semibold">💾 Mount-Punkte ({mounts.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-4 py-2 text-left text-xs text-gray-400">Gerät</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Mount-Punkt</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Dateisystem</th>
              <th className="px-4 py-2 text-right text-xs text-gray-400">Größe</th>
              <th className="px-4 py-2 text-right text-xs text-gray-400">Belegt</th>
              <th className="px-4 py-2 text-right text-xs text-gray-400">Nutzung</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {mounts.map((m) => (
              <tr key={m.id} className="hover:bg-gray-750">
                <td className="px-4 py-2 text-gray-300 font-mono text-xs">{m.device}</td>
                <td className="px-4 py-2 text-white font-mono text-xs">{m.mountPoint}</td>
                <td className="px-4 py-2 text-gray-400">{m.fsType}</td>
                <td className="px-4 py-2 text-right text-gray-300">{formatMb(m.sizeMb)}</td>
                <td className="px-4 py-2 text-right text-gray-300">{formatMb(m.usedMb)}</td>
                <td className="px-4 py-2 text-right">
                  <UsageBar pct={m.usePct || 0} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* LVM Volumes */}
      {lvmVolumes.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <h3 className="text-white font-semibold">📦 LVM Volumes ({lvmVolumes.length})</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-2 text-left text-xs text-gray-400">VG</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400">LV</th>
                <th className="px-4 py-2 text-right text-xs text-gray-400">Größe</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400">Pfad</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400">Typ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {lvmVolumes.map((v: any) => (
                <tr key={v.id} className="hover:bg-gray-750">
                  <td className="px-4 py-2 text-blue-400 font-mono text-xs">{v.vgName}</td>
                  <td className="px-4 py-2 text-white font-mono text-xs">{v.lvName}</td>
                  <td className="px-4 py-2 text-right text-gray-300">{v.sizeMb ? formatMb(v.sizeMb) : v.size || '–'}</td>
                  <td className="px-4 py-2 text-gray-400 font-mono text-xs">{v.path || '–'}</td>
                  <td className="px-4 py-2 text-gray-400">{v.type || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NetworkTab({ interfaces }: { interfaces: any[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {interfaces.map((iface) => (
        <div key={iface.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white font-semibold font-mono">{iface.name}</h3>
            <div className="flex items-center gap-2">
              {iface.speed && <span className="text-xs text-gray-400">{iface.speed}</span>}
              <span className={`px-2 py-0.5 text-xs rounded-full ${
                iface.state === 'UP' ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'
              }`}>
                {iface.state || 'UNKNOWN'}
              </span>
            </div>
          </div>
          <div className="space-y-1 text-sm">
            {iface.ipAddr && <p className="text-gray-300">IP: <span className="text-blue-400 font-mono">{iface.ipAddr}</span></p>}
            {iface.macAddr && <p className="text-gray-300">MAC: <span className="text-gray-400 font-mono">{iface.macAddr}</span></p>}
            {iface.mtu && <p className="text-gray-300">MTU: <span className="text-gray-400">{iface.mtu}</span></p>}
            {(iface.rxBytes || iface.txBytes) && (
              <div className="flex gap-4 mt-1 pt-1 border-t border-gray-700">
                <p className="text-gray-400 text-xs">
                  ↓ RX: <span className="text-green-400">{formatBytes(iface.rxBytes)}</span>
                </p>
                <p className="text-gray-400 text-xs">
                  ↑ TX: <span className="text-blue-400">{formatBytes(iface.txBytes)}</span>
                </p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function DockerTab({ containers }: { containers: any[] }) {
  if (containers.length === 0) {
    return <p className="text-gray-400 text-center py-8">Kein Docker auf diesem Server oder keine Container gefunden</p>;
  }

  return (
    <div className="space-y-4">
      {containers.map((c) => (
        <div key={c.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-white font-semibold">{c.name}</h3>
              <p className="text-xs text-gray-400 font-mono">{c.image}</p>
            </div>
            <span className={`px-2 py-0.5 text-xs rounded-full ${
              c.state === 'running' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
            }`}>
              {c.state}
            </span>
          </div>
          {c.ports && Object.keys(c.ports).length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-400 mb-1">Ports:</p>
              <pre className="text-xs text-gray-300 bg-gray-900 rounded p-2 overflow-x-auto">
                {JSON.stringify(c.ports, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ConnectionsTab({ server }: { server: any }) {
  const outgoing = server.outgoingEdges || [];
  const incoming = server.incomingEdges || [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-3">📤 Ausgehende Verbindungen ({outgoing.length})</h3>
        {outgoing.length === 0 ? (
          <p className="text-gray-400 text-sm">Keine ausgehenden Verbindungen erkannt</p>
        ) : (
          <div className="space-y-2">
            {outgoing.map((e: any) => (
              <EdgeCard key={e.id} edge={e} direction="out" />
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white mb-3">📥 Eingehende Verbindungen ({incoming.length})</h3>
        {incoming.length === 0 ? (
          <p className="text-gray-400 text-sm">Keine eingehenden Verbindungen erkannt</p>
        ) : (
          <div className="space-y-2">
            {incoming.map((e: any) => (
              <EdgeCard key={e.id} edge={e} direction="in" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Kleine Hilfskomponenten ─────────────────────────────────────────────

function formatBytes(bytes: any): string {
  if (!bytes) return '–';
  const n = typeof bytes === 'string' ? parseInt(bytes) : Number(bytes);
  if (isNaN(n)) return '–';
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

function ServicesTab({ services }: { services: any[] }) {
  const [filter, setFilter] = useState('');
  const filtered = services.filter(
    (s) => !filter || s.name?.toLowerCase().includes(filter.toLowerCase()) || s.protocol?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Services filtern..."
        className="w-full max-w-md mb-4 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500"
      />
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-4 py-2 text-left text-xs text-gray-400">Name</th>
              <th className="px-4 py-2 text-right text-xs text-gray-400">Port</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Protokoll</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Bind-Adresse</th>
              <th className="px-4 py-2 text-right text-xs text-gray-400">PID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700 font-mono">
            {filtered.map((s: any) => (
              <tr key={s.id} className="hover:bg-gray-750">
                <td className="px-4 py-2 text-blue-400">{s.name}</td>
                <td className="px-4 py-2 text-right text-white">{s.port}</td>
                <td className="px-4 py-2 text-gray-400 uppercase">{s.protocol}</td>
                <td className="px-4 py-2 text-gray-400">{s.bindAddress || '*'}</td>
                <td className="px-4 py-2 text-right text-gray-500">{s.pid || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-gray-400 text-center py-6 text-sm">Keine Services gefunden</p>
        )}
      </div>
    </div>
  );
}

function SystemdTab({ units }: { units: any[] }) {
  const [filter, setFilter] = useState('');
  const [showOnlyFailed, setShowOnlyFailed] = useState(false);
  const filtered = units.filter((u) => {
    if (showOnlyFailed && u.activeState !== 'failed') return false;
    if (!filter) return true;
    return u.name?.toLowerCase().includes(filter.toLowerCase()) || u.description?.toLowerCase().includes(filter.toLowerCase());
  });

  const failedCount = units.filter((u) => u.activeState === 'failed').length;

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Systemd Units filtern..."
          className="flex-1 max-w-md px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500"
        />
        {failedCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-red-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyFailed}
              onChange={(e) => setShowOnlyFailed(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            Nur Fehler ({failedCount})
          </label>
        )}
      </div>
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-4 py-2 text-left text-xs text-gray-400">Unit</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Typ</th>
              <th className="px-4 py-2 text-center text-xs text-gray-400">Aktiv</th>
              <th className="px-4 py-2 text-center text-xs text-gray-400">Enabled</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Beschreibung</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {filtered.slice(0, 200).map((u: any) => (
              <tr key={u.id} className={`hover:bg-gray-750 ${u.activeState === 'failed' ? 'bg-red-900/10' : ''}`}>
                <td className="px-4 py-2 text-white font-mono text-xs">{u.name}</td>
                <td className="px-4 py-2 text-gray-400 text-xs">{u.unitType || '–'}</td>
                <td className="px-4 py-2 text-center">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                    u.activeState === 'active' ? 'bg-green-900/50 text-green-400' :
                    u.activeState === 'failed' ? 'bg-red-900/50 text-red-400' :
                    'bg-gray-700 text-gray-400'
                  }`}>
                    {u.activeState}
                  </span>
                </td>
                <td className="px-4 py-2 text-center">
                  <span className={`text-xs ${
                    u.enabled === 'enabled' ? 'text-green-400' :
                    u.enabled === 'disabled' ? 'text-gray-500' :
                    'text-yellow-400'
                  }`}>
                    {u.enabled || '–'}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-md" title={u.description}>
                  {u.description || '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <p className="px-4 py-2 text-xs text-gray-500">Zeigt 200 von {filtered.length} Units</p>
        )}
        {filtered.length === 0 && (
          <p className="text-gray-400 text-center py-6 text-sm">Keine Systemd Units gefunden</p>
        )}
      </div>
    </div>
  );
}

function CronTab({ cronJobs }: { cronJobs: any[] }) {
  if (cronJobs.length === 0) {
    return <p className="text-gray-400 text-center py-8">Keine Cron-Jobs auf diesem Server gefunden</p>;
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="px-4 py-2 text-left text-xs text-gray-400">Schedule</th>
            <th className="px-4 py-2 text-left text-xs text-gray-400">Benutzer</th>
            <th className="px-4 py-2 text-left text-xs text-gray-400">Kommando</th>
            <th className="px-4 py-2 text-left text-xs text-gray-400">Quelle</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {cronJobs.map((c: any) => (
            <tr key={c.id} className="hover:bg-gray-750">
              <td className="px-4 py-2 text-blue-400 font-mono text-xs whitespace-nowrap">{c.schedule}</td>
              <td className="px-4 py-2 text-gray-400">{c.user || '–'}</td>
              <td className="px-4 py-2 text-gray-300 font-mono text-xs truncate max-w-lg" title={c.command}>
                {c.command}
              </td>
              <td className="px-4 py-2 text-gray-500 text-xs">{c.source || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SslTab({ certificates }: { certificates: any[] }) {
  if (certificates.length === 0) {
    return <p className="text-gray-400 text-center py-8">Keine SSL-Zertifikate gefunden</p>;
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      {certificates.map((cert: any) => {
        const expires = cert.validTo ? new Date(cert.validTo) : null;
        const daysLeft = cert.daysLeft ?? (expires ? Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null);
        const isExpired = cert.isExpired || (daysLeft !== null && daysLeft < 0);
        const isExpiringSoon = !isExpired && daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;

        return (
          <div key={cert.id} className={`bg-gray-800 border rounded-xl p-4 ${
            isExpired ? 'border-red-600' : isExpiringSoon ? 'border-yellow-600' : 'border-gray-700'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-white font-semibold font-mono">{cert.subject || cert.path}</h3>
                {cert.path && <p className="text-xs text-gray-500 font-mono">{cert.path}</p>}
              </div>
              <div className="text-right">
                {daysLeft !== null && (
                  <span className={`px-3 py-1 text-xs rounded-full font-medium ${
                    isExpired ? 'bg-red-900/50 text-red-400' :
                    isExpiringSoon ? 'bg-yellow-900/50 text-yellow-400' :
                    'bg-green-900/50 text-green-400'
                  }`}>
                    {isExpired ? `Abgelaufen vor ${Math.abs(daysLeft)} Tagen` :
                     daysLeft === 0 ? 'Läuft heute ab!' :
                     `${daysLeft} Tage verbleibend`}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {cert.issuer && (
                <div>
                  <span className="text-gray-400">Aussteller: </span>
                  <span className="text-gray-300">{cert.issuer}</span>
                </div>
              )}
              {cert.subject && (
                <div>
                  <span className="text-gray-400">Subject: </span>
                  <span className="text-gray-300">{cert.subject}</span>
                </div>
              )}
              {cert.validFrom && (
                <div>
                  <span className="text-gray-400">Ausgestellt: </span>
                  <span className="text-gray-300">{new Date(cert.validFrom).toLocaleDateString('de-DE')}</span>
                </div>
              )}
              {expires && (
                <div>
                  <span className="text-gray-400">Ablauf: </span>
                  <span className="text-gray-300">{expires.toLocaleDateString('de-DE')}</span>
                </div>
              )}
              {cert.serial && (
                <div>
                  <span className="text-gray-400">Serial: </span>
                  <span className="text-gray-400 font-mono text-xs">{cert.serial}</span>
                </div>
              )}
              {cert.sanDomains && (
                <div className="col-span-2">
                  <span className="text-gray-400">SAN: </span>
                  <span className="text-gray-300 font-mono text-xs">
                    {Array.isArray(cert.sanDomains) ? cert.sanDomains.join(', ') : JSON.stringify(cert.sanDomains)}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UsersTab({ users }: { users: any[] }) {
  const [showSystem, setShowSystem] = useState(false);
  const filtered = showSystem ? users : users.filter((u) => {
    const uid = u.uid ?? 65534;
    return uid >= 1000 || uid === 0;
  });

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => setShowSystem(e.target.checked)}
            className="rounded bg-gray-700 border-gray-600"
          />
          System-Benutzer anzeigen ({users.length} gesamt)
        </label>
      </div>
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-4 py-2 text-right text-xs text-gray-400">UID</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Benutzer</th>
              <th className="px-4 py-2 text-right text-xs text-gray-400">GID</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Gruppe</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Home</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Shell</th>
              <th className="px-4 py-2 text-center text-xs text-gray-400">Sudo</th>
              <th className="px-4 py-2 text-left text-xs text-gray-400">Letzter Login</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700 font-mono">
            {filtered.map((u: any) => (
              <tr key={u.id} className={`hover:bg-gray-750 ${u.uid === 0 ? 'bg-red-900/10' : ''}`}>
                <td className="px-4 py-2 text-right text-gray-500">{u.uid}</td>
                <td className="px-4 py-2 text-white">{u.username}</td>
                <td className="px-4 py-2 text-right text-gray-500">{u.gid ?? '–'}</td>
                <td className="px-4 py-2 text-gray-400">{u.groupName || '–'}</td>
                <td className="px-4 py-2 text-gray-400 text-xs">{u.homeDir || '–'}</td>
                <td className="px-4 py-2 text-gray-400 text-xs">{u.shell || '–'}</td>
                <td className="px-4 py-2 text-center">
                  {u.hasSudo ? <span className="text-yellow-400">⚡</span> : <span className="text-gray-600">–</span>}
                </td>
                <td className="px-4 py-2 text-gray-400 text-xs">{u.lastLogin || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-gray-400 text-center py-6 text-sm">Keine Benutzer gefunden</p>
        )}
      </div>
    </div>
  );
}

// ─── KI-Zusammenfassungs-Karte ───────────────────────────────────────────

function AiSummaryCard({ server }: { server: any }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const generateSummary = async () => {
    setGenerating(true);
    setError('');
    try {
      await api.post(`/ai/summary/${server.id}`);
      // Seite neuladen um die neue Zusammenfassung anzuzeigen
      window.location.reload();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Zusammenfassung konnte nicht erstellt werden');
    } finally {
      setGenerating(false);
    }
  };

  const purpose = server.aiPurpose;
  const summary = server.aiSummary;
  const tags: string[] = server.aiTags || [];
  const analysis = server.aiAnalyses?.[0];
  const treeData = analysis?.purpose === 'server_summary' ? analysis.treeJson : null;
  const role = treeData?.role;

  return (
    <div className="lg:col-span-2 bg-gradient-to-br from-indigo-900/30 to-purple-900/20 border border-indigo-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🤖</span>
          <h3 className="text-lg font-semibold text-white">KI-Zusammenfassung</h3>
          {role && (
            <span className="px-2 py-0.5 text-xs bg-indigo-800/60 text-indigo-300 rounded-full">
              {role}
            </span>
          )}
        </div>
        <button
          onClick={generateSummary}
          disabled={generating}
          className="px-3 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
          title="KI-Zusammenfassung neu generieren"
        >
          {generating ? '⏳ Generiert...' : '🔄 Neu generieren'}
        </button>
      </div>

      {purpose && (
        <p className="text-indigo-200 font-medium text-base mb-2">{purpose}</p>
      )}

      {summary && (
        <p className="text-gray-300 text-sm leading-relaxed mb-3">{summary}</p>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag: string) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs bg-indigo-800/40 text-indigo-300 border border-indigo-700/40 rounded-full"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {!purpose && !summary && (
        <p className="text-gray-500 text-sm italic">Keine KI-Zusammenfassung vorhanden. Klicke auf "Neu generieren" um eine zu erstellen.</p>
      )}

      {analysis && (
        <p className="text-xs text-gray-500 mt-3">
          Modell: {analysis.modelUsed} • {analysis.durationMs ? `${(analysis.durationMs / 1000).toFixed(1)}s` : ''}
          {analysis.createdAt && ` • ${new Date(analysis.createdAt).toLocaleString('de-DE')}`}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400 mt-2">❌ {error}</p>
      )}
    </div>
  );
}

// ─── Basis Hilfskomponenten ──────────────────────────────────────────────

function InfoCard({ title, items }: { title: string; items: { label: string; value: string }[] }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
      <dl className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex justify-between">
            <dt className="text-sm text-gray-400">{item.label}</dt>
            <dd className="text-sm text-white font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EdgeCard({ edge, direction }: { edge: any; direction: 'in' | 'out' }) {
  const methodBadge: Record<string, string> = {
    SOCKET: 'bg-blue-900/50 text-blue-400',
    CONFIG: 'bg-purple-900/50 text-purple-400',
    ARP: 'bg-yellow-900/50 text-yellow-400',
    DOCKER: 'bg-cyan-900/50 text-cyan-400',
    MANUAL: 'bg-gray-700 text-gray-300',
  };

  const peer = direction === 'out' ? edge.targetServer : edge.sourceServer;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          {peer ? (
            <Link to={`/servers/${peer.id}`} className="text-blue-400 hover:text-blue-300 text-sm font-mono">
              {peer.hostname || peer.ip}
            </Link>
          ) : (
            <span className="text-gray-300 text-sm font-mono">{edge.targetIp} (extern)</span>
          )}
          <span className="text-gray-500 text-sm">:{edge.targetPort}</span>
          <span className={`px-2 py-0.5 text-xs rounded-full ${methodBadge[edge.detectionMethod] || 'bg-gray-700'}`}>
            {edge.detectionMethod}
          </span>
        </div>
        {edge.details && <p className="text-xs text-gray-500 mt-1">{edge.details}</p>}
      </div>
      {edge.sourceProcess && (
        <span className="text-xs text-gray-400 font-mono">{edge.sourceProcess}</span>
      )}
    </div>
  );
}

function UsageBar({ pct }: { pct: number }) {
  const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs text-gray-400">{pct}%</span>
    </div>
  );
}

function formatMb(mb: number | null): string {
  if (!mb) return '–';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

// ─── Prozessmap Tab ──────────────────────────────────────────────────────
// ─── Runbook Tab (Phase 5.7) ─────────────────────────────────────────────

interface RunbookSection {
  title: string;
  priority: 'routine' | 'important' | 'critical';
  description: string;
  steps: string[];
  affectedServices?: string[];
}

interface RunbookData {
  title: string;
  summary: string;
  sections: RunbookSection[];
  generatedAt: string;
}

function RunbookTab({ serverId, hostname }: { serverId: string; hostname: string }) {
  const [runbook, setRunbook] = useState<RunbookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<any>(null);

  const loadRunbook = async () => {
    try {
      const res = await api.get(`/ai/runbook/${serverId}`);
      if (res.data.result) {
        setRunbook(res.data.result as RunbookData);
        setMeta({
          generatedAt: res.data.generatedAt,
          model: res.data.modelUsed,
          duration: res.data.durationMs,
        });
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError(err.response?.data?.error || 'Laden fehlgeschlagen');
      }
    } finally {
      setLoading(false);
    }
  };

  const generateRunbook = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await api.post(`/ai/runbook/${serverId}`);
      if (res.data.result) {
        setRunbook(res.data.result as RunbookData);
        setMeta({
          generatedAt: new Date().toISOString(),
          model: null,
          duration: null,
        });
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Runbook-Generierung fehlgeschlagen');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    loadRunbook();
  }, [serverId]);

  const priorityConfig: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
    critical: { label: 'Kritisch', color: 'text-red-300', bg: 'bg-red-900/30', border: 'border-red-700', icon: '🔴' },
    important: { label: 'Wichtig', color: 'text-yellow-300', bg: 'bg-yellow-900/20', border: 'border-yellow-700', icon: '🟡' },
    routine: { label: 'Routine', color: 'text-blue-300', bg: 'bg-blue-900/20', border: 'border-blue-700', icon: '🔵' },
  };

  if (loading) {
    return <div className="animate-pulse"><div className="h-64 bg-gray-800 rounded-xl" /></div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">📋 Auto-Runbook</h2>
          <p className="text-xs text-gray-400">
            KI-generierte Wartungsanleitung für {hostname}
          </p>
        </div>
        <button
          onClick={generateRunbook}
          disabled={generating}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {generating ? '⏳ Generiert...' : runbook ? '🔄 Neu generieren' : '📋 Runbook erstellen'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300">
          ❌ {error}
          <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-200">✕</button>
        </div>
      )}

      {/* Generating Spinner */}
      {generating && (
        <div className="mb-6 bg-gray-800 border border-gray-700 rounded-xl p-6 text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-300">KI generiert Wartungs-Runbook...</p>
          <p className="text-xs text-gray-500 mt-1">Dies kann bis zu 60 Sekunden dauern</p>
        </div>
      )}

      {/* Meta Info */}
      {meta && !generating && runbook && (
        <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
          <span>📅 {new Date(meta.generatedAt).toLocaleString('de-DE')}</span>
          {meta.model && <span>🤖 {meta.model}</span>}
          {meta.duration && <span>⏱️ {(meta.duration / 1000).toFixed(1)}s</span>}
        </div>
      )}

      {/* Runbook Content */}
      {runbook && !generating && (
        <div>
          {/* Title & Summary */}
          <div className="mb-6 bg-gray-800 border border-gray-700 rounded-xl p-5">
            <h3 className="text-lg font-semibold text-white mb-2">{runbook.title}</h3>
            <p className="text-sm text-gray-300">{runbook.summary}</p>
            <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
              <span>{runbook.sections.length} Abschnitte</span>
              <span>{runbook.sections.filter(s => s.priority === 'critical').length} kritisch</span>
              <span>{runbook.sections.filter(s => s.priority === 'important').length} wichtig</span>
              <span>{runbook.sections.filter(s => s.priority === 'routine').length} routine</span>
            </div>
          </div>

          {/* Sections */}
          <div className="space-y-4">
            {runbook.sections.map((section, idx) => {
              const cfg = priorityConfig[section.priority] || priorityConfig.routine;
              return (
                <div key={idx} className={`${cfg.bg} border ${cfg.border} rounded-xl p-5`}>
                  {/* Section Header */}
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-md font-semibold text-white flex items-center gap-2">
                      <span>{cfg.icon}</span>
                      {section.title}
                    </h4>
                    <span className={`text-xs px-2 py-1 rounded-full ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
                      {cfg.label}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-gray-300 mb-4">{section.description}</p>

                  {/* Steps */}
                  <div className="space-y-2">
                    {section.steps.map((step, sIdx) => (
                      <div key={sIdx} className="flex items-start gap-3 bg-gray-900/40 rounded-lg p-3">
                        <span className="text-xs text-gray-500 font-mono mt-0.5 min-w-[20px]">{sIdx + 1}.</span>
                        <span className="text-sm text-gray-200 font-mono whitespace-pre-wrap break-all">{step}</span>
                      </div>
                    ))}
                  </div>

                  {/* Affected Services */}
                  {section.affectedServices && section.affectedServices.length > 0 && (
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">Betrifft:</span>
                      {section.affectedServices.map((svc, svcIdx) => (
                        <span key={svcIdx} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">
                          {svc}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!runbook && !generating && (
        <div className="text-center py-16 bg-gray-800/30 rounded-xl border border-gray-700/50">
          <p className="text-5xl mb-4">📋</p>
          <h3 className="text-lg font-semibold text-white mb-2">Noch kein Runbook</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
            Die KI analysiert Server-Konfiguration, laufende Services, Alerts und Anomalien
            und erstellt ein Schritt-für-Schritt Wartungs-Runbook.
          </p>
          <button
            onClick={generateRunbook}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
          >
            📋 Runbook erstellen
          </button>
        </div>
      )}
    </div>
  );
}

// ─── ProcessMap Tab ──────────────────────────────────────────────────────

function ProcessMapTab({ serverId, hostname }: { serverId: string; hostname: string }) {
  const [treeData, setTreeData] = useState<ProcessTreeData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<any>(null);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<any>(null);

  // Lade vorhandene Prozessmap
  const loadMap = async () => {
    try {
      const res = await api.get(`/ai/process-map/${serverId}`);
      const data = res.data;
      if (data.treeJson) {
        const trees = Array.isArray(data.treeJson) ? data.treeJson : [data.treeJson];
        setTreeData(trees);
        setMeta({
          model: data.modelUsed,
          duration: data.durationMs,
          createdAt: data.createdAt,
        });
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError(err.response?.data?.error || 'Laden fehlgeschlagen');
      }
    } finally {
      setLoading(false);
    }
  };

  // Status-Polling
  const pollStatus = async () => {
    try {
      const res = await api.get(`/ai/process-map/${serverId}/status`);
      const status = res.data;
      setProgress(status);

      if (status.running) {
        setTimeout(pollStatus, 2000);
      } else if (status.status === 'completed') {
        setScanning(false);
        setProgress(null);
        loadMap();
      } else if (status.status === 'failed') {
        setScanning(false);
        setError(status.failedReason || 'Scan fehlgeschlagen');
      }
    } catch {
      setTimeout(pollStatus, 3000);
    }
  };

  // Scan starten
  const startScan = async () => {
    setScanning(true);
    setError('');
    try {
      await api.post(`/ai/process-map/${serverId}`);
      setTimeout(pollStatus, 1000);
    } catch (err: any) {
      setScanning(false);
      setError(err.response?.data?.error || 'Scan konnte nicht gestartet werden');
    }
  };

  // Prozessmap löschen
  const deleteMap = async () => {
    if (!confirm('Prozessmap wirklich löschen?')) return;
    try {
      await api.delete(`/ai/process-map/${serverId}`);
      setTreeData(null);
      setMeta(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Löschen fehlgeschlagen');
    }
  };

  useEffect(() => {
    loadMap();
    // Prüfe ob gerade ein Scan läuft
    api.get(`/ai/process-map/${serverId}/status`)
      .then(res => {
        if (res.data.running) {
          setScanning(true);
          setProgress(res.data);
          setTimeout(pollStatus, 2000);
        }
      })
      .catch(() => {});
  }, [serverId]);

  if (loading) {
    return <div className="animate-pulse"><div className="h-64 bg-gray-800 rounded-xl" /></div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">🗺️ KI-Prozessmap</h2>
          <p className="text-xs text-gray-400">
            Automatische Baumstruktur der Konfigurationen und Services auf {hostname}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {treeData && (
            <button
              onClick={deleteMap}
              className="px-3 py-2 bg-red-900/30 hover:bg-red-800/50 text-red-400 text-sm rounded-lg transition-colors border border-red-800"
            >
              🗑️ Löschen
            </button>
          )}
          <button
            onClick={startScan}
            disabled={scanning}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {scanning ? '⏳ Scannt...' : treeData ? '🔄 Neu generieren' : '🗺️ Prozessmap erstellen'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300">
          ❌ {error}
          <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-200">✕</button>
        </div>
      )}

      {/* Progress */}
      {scanning && progress && (
        <div className="mb-6 bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white font-medium">
              {progress.message || 'Scan läuft...'}
            </span>
            <span className="text-xs text-gray-400">{progress.progress || 0}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress.progress || 0}%` }}
            />
          </div>
          {progress.processedCount > 0 && (
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Schritt: {progress.step || '—'}</span>
              <span>{progress.processedCount} / {progress.totalCount} Prozesse</span>
            </div>
          )}
          <div className="flex items-center gap-2 mt-3">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-gray-400">KI analysiert Konfigurationen...</span>
          </div>
        </div>
      )}

      {/* Scanning without progress data yet */}
      {scanning && !progress && (
        <div className="mb-6 bg-gray-800 border border-gray-700 rounded-xl p-6 text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-300">Scan wird vorbereitet...</p>
        </div>
      )}

      {/* Meta Info */}
      {meta && !scanning && (
        <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
          <span>📅 {new Date(meta.createdAt).toLocaleString('de-DE')}</span>
          {meta.model && <span>🤖 {meta.model}</span>}
          {meta.duration && <span>⏱️ {(meta.duration / 1000).toFixed(1)}s</span>}
        </div>
      )}

      {/* Tree View */}
      {treeData && !scanning && (
        <ProcessMap data={treeData} hostname={hostname} />
      )}

      {/* Empty State */}
      {!treeData && !scanning && (
        <div className="text-center py-16 bg-gray-800/30 rounded-xl border border-gray-700/50">
          <p className="text-5xl mb-4">🗺️</p>
          <h3 className="text-lg font-semibold text-white mb-2">Noch keine Prozessmap</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
            Die KI analysiert alle laufenden Prozesse, sammelt deren Konfigurationen und erstellt
            eine übersichtliche Baumstruktur mit Ports, Pfaden und Einstellungen.
          </p>
          <button
            onClick={startScan}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
          >
            🗺️ Prozessmap erstellen
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Health & Logs Tab ───────────────────────────────────────────────────

interface LogAnalysisFinding {
  issue: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  source: string;
  recommendation: string;
}

interface LogAnalysisResult {
  status_score: number;
  status: 'healthy' | 'degraded' | 'critical';
  summary: string[];
  findings: LogAnalysisFinding[];
  analyzedAt: string;
}

interface RawLogs {
  journaldErrors: string | null;
  dmesgErrors: string | null;
  syslogErrors: string | null;
  authErrors: string | null;
  oomEvents: string | null;
  appLogs: Record<string, string> | null;
  collectedAt: string;
}

function HealthLogsTab({ serverId, hostname }: { serverId: string; hostname: string }) {
  const [analysis, setAnalysis] = useState<LogAnalysisResult | null>(null);
  const [rawLogs, setRawLogs] = useState<RawLogs | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<any>(null);
  const [activeLogSection, setActiveLogSection] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const loadAnalysis = async () => {
    try {
      const res = await api.get(`/ai/log-analysis/${serverId}`);
      if (res.data.result) {
        setAnalysis(res.data.result as LogAnalysisResult);
        setMeta({
          generatedAt: res.data.generatedAt,
          model: res.data.modelUsed,
          duration: res.data.durationMs,
        });
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError(err.response?.data?.error || 'Laden fehlgeschlagen');
      }
    }
  };

  const loadRawLogs = async () => {
    try {
      const res = await api.get(`/ai/logs/${serverId}`);
      if (res.data.logs) {
        setRawLogs(res.data.logs);
      }
    } catch {
      // Silently ignore - raw logs are optional
    }
  };

  const generateAnalysis = async () => {
    setGenerating(true);
    setError('');
    setElapsed(0);
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    try {
      const res = await api.post(`/ai/log-analysis/${serverId}`, {}, { timeout: 200_000 });
      if (res.data.result) {
        setAnalysis(res.data.result as LogAnalysisResult);
        setMeta({
          generatedAt: new Date().toISOString(),
          model: null,
          duration: null,
        });
      }
    } catch (err: any) {
      const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout') || err.message?.includes('Timeout');
      const backendMsg = err.response?.data?.error || '';
      const msg = isTimeout || backendMsg.includes('Timeout')
        ? 'Timeout – Ollama antwortet nicht rechtzeitig. Prüfe ob GPU aktiv ist (nvidia-smi) und ob das Modell nicht zu groß ist.'
        : backendMsg || 'Log-Analyse fehlgeschlagen';
      setError(msg);
    } finally {
      clearInterval(timer);
      setGenerating(false);
    }
  };

  useEffect(() => {
    Promise.all([loadAnalysis(), loadRawLogs()]).finally(() => setLoading(false));
  }, [serverId]);

  // Status-Score Farben
  const getScoreColor = (score: number) => {
    if (score >= 80) return { text: 'text-green-400', bg: 'bg-green-500', ring: 'ring-green-500/30' };
    if (score >= 50) return { text: 'text-yellow-400', bg: 'bg-yellow-500', ring: 'ring-yellow-500/30' };
    return { text: 'text-red-400', bg: 'bg-red-500', ring: 'ring-red-500/30' };
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'healthy': return { label: 'Gesund', color: 'text-green-400', bg: 'bg-green-900/30', border: 'border-green-700', icon: '✅' };
      case 'degraded': return { label: 'Beeinträchtigt', color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', icon: '⚠️' };
      case 'critical': return { label: 'Kritisch', color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-700', icon: '🔴' };
      default: return { label: 'Unbekannt', color: 'text-gray-400', bg: 'bg-gray-800', border: 'border-gray-700', icon: '❓' };
    }
  };

  const getSeverityConfig = (severity: string) => {
    switch (severity) {
      case 'critical': return { label: 'Kritisch', color: 'text-red-300', bg: 'bg-red-900/30', border: 'border-red-700', icon: '🔴' };
      case 'error': return { label: 'Fehler', color: 'text-orange-300', bg: 'bg-orange-900/30', border: 'border-orange-700', icon: '🟠' };
      case 'warning': return { label: 'Warnung', color: 'text-yellow-300', bg: 'bg-yellow-900/20', border: 'border-yellow-700', icon: '🟡' };
      case 'info': return { label: 'Info', color: 'text-blue-300', bg: 'bg-blue-900/20', border: 'border-blue-700', icon: '🔵' };
      default: return { label: severity, color: 'text-gray-300', bg: 'bg-gray-800', border: 'border-gray-700', icon: '⚪' };
    }
  };

  // Log-Sektionen für die Raw-Log-Ansicht
  const logSections = rawLogs ? [
    { key: 'journald', label: 'Systemd Journal', icon: '📜', content: rawLogs.journaldErrors, lines: rawLogs.journaldErrors?.split('\n').length || 0 },
    { key: 'dmesg', label: 'Kernel (dmesg)', icon: '🐧', content: rawLogs.dmesgErrors, lines: rawLogs.dmesgErrors?.split('\n').length || 0 },
    { key: 'syslog', label: 'Syslog', icon: '📋', content: rawLogs.syslogErrors, lines: rawLogs.syslogErrors?.split('\n').length || 0 },
    { key: 'auth', label: 'Auth / Security', icon: '🔐', content: rawLogs.authErrors, lines: rawLogs.authErrors?.split('\n').length || 0 },
    { key: 'oom', label: 'OOM-Killer', icon: '💀', content: rawLogs.oomEvents, lines: rawLogs.oomEvents?.split('\n').length || 0 },
    ...(rawLogs.appLogs ? Object.entries(rawLogs.appLogs).map(([name, content]) => ({
      key: `app_${name}`,
      label: name,
      icon: '📦',
      content: content as string,
      lines: (content as string)?.split('\n').length || 0,
    })) : []),
  ].filter(s => s.content && s.content.trim().length > 0) : [];

  // Filter-Logik
  const filterLog = (content: string) => {
    if (!logFilter) return content;
    return content.split('\n').filter(line => line.toLowerCase().includes(logFilter.toLowerCase())).join('\n');
  };

  if (loading) {
    return <div className="animate-pulse"><div className="h-64 bg-gray-800 rounded-xl" /></div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">🏥 Health & Logs</h2>
          <p className="text-xs text-gray-400">
            KI-gestützte Log-Analyse und Roh-Log-Viewer für {hostname}
          </p>
        </div>
        <button
          onClick={generateAnalysis}
          disabled={generating}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {generating ? '⏳ Analysiert...' : analysis ? '🔄 Neu analysieren' : '🏥 Log-Analyse starten'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300">
          ❌ {error}
          <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-200">✕</button>
        </div>
      )}

      {/* Generating Spinner */}
      {generating && (
        <div className="mb-6 bg-gray-800 border border-gray-700 rounded-xl p-6 text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-300">KI analysiert Server-Logs...</p>
          <p className="text-xs text-gray-500 mt-1">{elapsed}s – max. ~3 Minuten (CPU-Modus)</p>
        </div>
      )}

      {/* ═══ KI-Analyse Dashboard ═══ */}
      {analysis && !generating && (
        <div className="mb-6">
          {/* Score + Status Card */}
          <div className={`${getStatusConfig(analysis.status).bg} border ${getStatusConfig(analysis.status).border} rounded-xl p-5 mb-4`}>
            <div className="flex items-center gap-6">
              {/* Score Circle */}
              <div className={`relative w-20 h-20 flex items-center justify-center rounded-full ring-4 ${getScoreColor(analysis.status_score).ring}`}>
                <div className={`w-16 h-16 rounded-full ${getScoreColor(analysis.status_score).bg} bg-opacity-20 flex items-center justify-center`}>
                  <span className={`text-2xl font-bold ${getScoreColor(analysis.status_score).text}`}>
                    {analysis.status_score}
                  </span>
                </div>
              </div>

              {/* Status Info */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{getStatusConfig(analysis.status).icon}</span>
                  <h3 className={`text-lg font-semibold ${getStatusConfig(analysis.status).color}`}>
                    {getStatusConfig(analysis.status).label}
                  </h3>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  Health-Score: {analysis.status_score}/100
                </p>
                {/* Summary Points */}
                <ul className="space-y-1">
                  {analysis.summary.map((point, idx) => (
                    <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                      <span className="text-gray-500 mt-0.5">•</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Meta Info */}
          {meta && (
            <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
              <span>📅 {new Date(analysis.analyzedAt || meta.generatedAt).toLocaleString('de-DE')}</span>
              {meta.model && <span>🤖 {meta.model}</span>}
              {meta.duration && <span>⏱️ {(meta.duration / 1000).toFixed(1)}s</span>}
              <span>📊 {analysis.findings.length} Befunde</span>
            </div>
          )}

          {/* Findings */}
          {analysis.findings.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-300">Detaillierte Befunde</h4>
              {analysis.findings.map((finding, idx) => {
                const cfg = getSeverityConfig(finding.severity);
                return (
                  <div key={idx} className={`${cfg.bg} border ${cfg.border} rounded-lg p-4`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span>{cfg.icon}</span>
                        <span className={`text-sm font-medium ${cfg.color}`}>{finding.issue}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                          {finding.source}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
                          {cfg.label}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-400 ml-6">
                      💡 {finding.recommendation}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Raw Log Viewer ═══ */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-md font-semibold text-white">📜 Roh-Logs</h3>
          {rawLogs && (
            <span className="text-xs text-gray-500">
              Gesammelt: {new Date(rawLogs.collectedAt).toLocaleString('de-DE')}
            </span>
          )}
        </div>

        {!rawLogs && (
          <div className="text-center py-8 bg-gray-800/30 rounded-xl border border-gray-700/50">
            <p className="text-3xl mb-2">📜</p>
            <p className="text-sm text-gray-400">
              Keine Log-Daten vorhanden. Führe einen Server-Scan durch, um Logs zu sammeln.
            </p>
          </div>
        )}

        {rawLogs && logSections.length === 0 && (
          <div className="text-center py-8 bg-gray-800/30 rounded-xl border border-gray-700/50">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-sm text-gray-400">Keine Fehler-Logs gefunden – System scheint sauber.</p>
          </div>
        )}

        {logSections.length > 0 && (
          <div>
            {/* Search / Filter */}
            <div className="mb-3">
              <input
                type="text"
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
                placeholder="🔍 Logs filtern..."
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Collapsible Log Sections */}
            <div className="space-y-2">
              {logSections.map((section) => (
                <div key={section.key} className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                  {/* Section Header */}
                  <button
                    onClick={() => setActiveLogSection(activeLogSection === section.key ? null : section.key)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span>{section.icon}</span>
                      <span className="text-sm font-medium text-gray-200">{section.label}</span>
                      <span className="text-xs text-gray-500 bg-gray-900 px-2 py-0.5 rounded">
                        {section.lines} Zeilen
                      </span>
                    </div>
                    <span className="text-gray-500 text-sm">
                      {activeLogSection === section.key ? '▼' : '▶'}
                    </span>
                  </button>

                  {/* Log Content */}
                  {activeLogSection === section.key && (
                    <div className="border-t border-gray-700">
                      <pre className="p-4 text-xs text-green-400 font-mono bg-gray-950 max-h-96 overflow-auto whitespace-pre-wrap break-words">
                        {filterLog(section.content || '') || '(keine Treffer für Filter)'}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Empty State (keine Analyse & keine Logs) */}
      {!analysis && !rawLogs && !generating && (
        <div className="text-center py-16 bg-gray-800/30 rounded-xl border border-gray-700/50 mt-6">
          <p className="text-5xl mb-4">🏥</p>
          <h3 className="text-lg font-semibold text-white mb-2">Health & Logs</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
            Die KI analysiert Fehler-Logs (journald, dmesg, syslog, auth) und gibt
            eine zusammenfassende Bewertung mit konkreten Handlungsempfehlungen.
          </p>
          <button
            onClick={generateAnalysis}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
          >
            🏥 Log-Analyse starten
          </button>
        </div>
      )}
    </div>
  );
}
