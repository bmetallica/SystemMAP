// ─── Dashboard Page v2 ───────────────────────────────────────────────────
// Erweitert mit: Alerts-Panel, Scheduler-Widget, Scan-Activity,
// SSL-Warnungen, Disk-Alerts, Systemd-Failures, Quick-Actions

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

// ─── Interfaces ──────────────────────────────────────────────────────────
interface DashboardData {
  servers: {
    total: number;
    online: number;
    offline: number;
    discovered: number;
    configured: number;
    scanning: number;
    error: number;
  };
  resources: {
    services: number;
    connections: number;
    containers: number;
    cronJobs: number;
    systemdUnits: number;
    sslCertificates: number;
    mounts: number;
    userAccounts: number;
  };
  alerts: {
    expiringSslCerts: Array<{
      id: string;
      subject: string | null;
      path: string;
      daysLeft: number | null;
      server: { id: string; ip: string; hostname: string | null };
    }>;
    expiredSslCertsCount: number;
    failedSystemdUnits: Array<{
      id: string;
      name: string;
      server: { id: string; ip: string; hostname: string | null };
    }>;
    criticalDisks: Array<{
      id: string;
      mountPoint: string;
      usePct: number | null;
      sizeMb: number | null;
      availMb: number | null;
      server: { id: string; ip: string; hostname: string | null };
    }>;
    staleScanCount: number;
    failedScansLast24h: number;
  };
  queues: {
    serverScans: { waiting: number; active: number };
    networkScans: { waiting: number; active: number };
  };
  scheduler: {
    activeServerSchedules: number;
    activeNetworkSchedules: number;
    totalScansTriggered: number;
    lastSyncAt: string | null;
    upcomingScans: Array<{
      type: 'server' | 'network';
      target: string;
      schedule: string;
    }>;
  };
  recentAudit: Array<{
    id: string;
    action: string;
    target: string;
    createdAt: string;
    user: { username: string } | null;
  }>;
  recentServerScans: Array<{
    id: string;
    ip: string;
    hostname: string | null;
    status: string;
    lastScanAt: string | null;
    lastScanError: string | null;
    _count: { services: number; dockerContainers: number; processes: number };
  }>;
  // Legacy
  services: number;
  connections: number;
  containers: number;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'alerts' | 'activity'>('overview');

  const loadDashboard = useCallback(() => {
    api.get('/dashboard')
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 15000); // Alle 15 Sekunden aktualisieren
    return () => clearInterval(interval);
  }, [loadDashboard]);

  if (loading) return <LoadingSkeleton />;
  if (!data) return <p className="text-red-400">Fehler beim Laden des Dashboards</p>;

  const totalAlerts =
    (data.alerts.expiringSslCerts?.length || 0) +
    data.alerts.expiredSslCertsCount +
    (data.alerts.failedSystemdUnits?.length || 0) +
    (data.alerts.criticalDisks?.length || 0) +
    data.alerts.failedScansLast24h;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">
            Letzte Aktualisierung: {new Date().toLocaleTimeString('de-DE')}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/discovery"
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            🔍 Netzwerkscan
          </Link>
          <Link
            to="/servers"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            🖥️ Server verwalten
          </Link>
        </div>
      </div>

      {/* Alert-Banner wenn kritische Warnungen */}
      {totalAlerts > 0 && (
        <div
          className={`mb-6 p-4 rounded-xl border ${
            data.alerts.expiredSslCertsCount > 0 || data.alerts.failedSystemdUnits?.length > 0
              ? 'bg-red-900/20 border-red-800 text-red-300'
              : 'bg-yellow-900/20 border-yellow-800 text-yellow-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <span className="font-medium">
                {totalAlerts} {totalAlerts === 1 ? 'Warnung' : 'Warnungen'} erfordern Aufmerksamkeit
              </span>
            </div>
            <button
              onClick={() => setActiveTab('alerts')}
              className="text-sm underline hover:no-underline"
            >
              Details anzeigen →
            </button>
          </div>
        </div>
      )}

      {/* Tab-Navigation */}
      <div className="flex gap-1 mb-6 bg-gray-800 rounded-lg p-1 w-fit">
        {[
          { key: 'overview' as const, label: '📊 Übersicht' },
          { key: 'alerts' as const, label: `🚨 Warnungen${totalAlerts > 0 ? ` (${totalAlerts})` : ''}` },
          { key: 'activity' as const, label: '📋 Aktivitäten' },
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

      {/* Tab-Inhalte */}
      {activeTab === 'overview' && <OverviewTab data={data} />}
      {activeTab === 'alerts' && <AlertsTab data={data} />}
      {activeTab === 'activity' && <ActivityTab data={data} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Übersicht-Tab
// ═══════════════════════════════════════════════════════════════════════════
function OverviewTab({ data }: { data: DashboardData }) {
  const serverStats = [
    { label: 'Gesamt', value: data.servers.total, color: 'text-white', icon: '🖥️' },
    { label: 'Online', value: data.servers.online, color: 'text-green-400', icon: '🟢' },
    { label: 'Offline', value: data.servers.offline, color: 'text-red-400', icon: '🔴' },
    { label: 'Entdeckt', value: data.servers.discovered, color: 'text-yellow-400', icon: '🔍' },
    { label: 'Konfiguriert', value: data.servers.configured, color: 'text-blue-400', icon: '⚙️' },
    { label: 'Scanning', value: data.servers.scanning, color: 'text-purple-400', icon: '⏳' },
    { label: 'Fehler', value: data.servers.error, color: 'text-red-400', icon: '❌' },
  ];

  const resourceStats = [
    { label: 'Services', value: data.resources?.services ?? data.services, icon: '🔌', color: 'text-cyan-400' },
    { label: 'Verbindungen', value: data.resources?.connections ?? data.connections, icon: '🔗', color: 'text-orange-400' },
    { label: 'Container', value: data.resources?.containers ?? data.containers, icon: '🐳', color: 'text-indigo-400' },
    { label: 'Cron-Jobs', value: data.resources?.cronJobs ?? 0, icon: '⏰', color: 'text-teal-400' },
    { label: 'Systemd-Units', value: data.resources?.systemdUnits ?? 0, icon: '🔧', color: 'text-amber-400' },
    { label: 'SSL-Zertifikate', value: data.resources?.sslCertificates ?? 0, icon: '🔒', color: 'text-emerald-400' },
    { label: 'Mounts', value: data.resources?.mounts ?? 0, icon: '💾', color: 'text-violet-400' },
    { label: 'Benutzer', value: data.resources?.userAccounts ?? 0, icon: '👤', color: 'text-pink-400' },
  ];

  return (
    <div className="space-y-6">
      {/* Server-Status */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Server-Status</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {serverStats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      </div>

      {/* Ressourcen */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Ressourcen</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {resourceStats.map((stat) => (
            <StatCard key={stat.label} {...stat} small />
          ))}
        </div>
      </div>

      {/* Zwei-Spalten Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Queue-Status */}
        <QueueWidget queues={data.queues} />

        {/* Scheduler-Widget */}
        <SchedulerWidget scheduler={data.scheduler} />
      </div>

      {/* Zuletzt gescannte Server */}
      {data.recentServerScans && data.recentServerScans.length > 0 && (
        <RecentScansWidget scans={data.recentServerScans} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Warnungen-Tab
// ═══════════════════════════════════════════════════════════════════════════
function AlertsTab({ data }: { data: DashboardData }) {
  const hasAlerts =
    (data.alerts.expiringSslCerts?.length || 0) > 0 ||
    data.alerts.expiredSslCertsCount > 0 ||
    (data.alerts.failedSystemdUnits?.length || 0) > 0 ||
    (data.alerts.criticalDisks?.length || 0) > 0 ||
    data.alerts.failedScansLast24h > 0;

  if (!hasAlerts) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-12 text-center">
        <span className="text-4xl mb-4 block">✅</span>
        <p className="text-lg font-medium text-white">Keine Warnungen</p>
        <p className="text-sm text-gray-400 mt-2">Alle Systeme laufen einwandfrei.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* SSL-Zertifikat-Warnungen */}
      {((data.alerts.expiringSslCerts?.length || 0) > 0 || data.alerts.expiredSslCertsCount > 0) && (
        <AlertSection
          title="🔒 SSL-Zertifikate"
          subtitle={`${data.alerts.expiredSslCertsCount} abgelaufen, ${data.alerts.expiringSslCerts?.length || 0} laufen bald ab`}
          type={data.alerts.expiredSslCertsCount > 0 ? 'critical' : 'warning'}
        >
          {data.alerts.expiringSslCerts?.map((cert) => (
            <div key={cert.id} className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-white">{cert.subject || cert.path}</span>
                <span className="text-xs text-gray-400 ml-2">
                  ({cert.server.hostname || cert.server.ip})
                </span>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                (cert.daysLeft ?? 0) <= 7
                  ? 'bg-red-900/50 text-red-400'
                  : 'bg-yellow-900/50 text-yellow-400'
              }`}>
                {cert.daysLeft} Tage
              </span>
            </div>
          ))}
        </AlertSection>
      )}

      {/* Systemd-Failures */}
      {(data.alerts.failedSystemdUnits?.length || 0) > 0 && (
        <AlertSection
          title="🔧 Fehlgeschlagene Dienste"
          subtitle={`${data.alerts.failedSystemdUnits.length} Systemd-Units im Status 'failed'`}
          type="critical"
        >
          {data.alerts.failedSystemdUnits.map((unit) => (
            <div key={unit.id} className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-white font-mono">{unit.name}</span>
                <Link
                  to={`/servers/${(unit.server as any)?.id || unit.server?.ip}`}
                  className="text-xs text-blue-400 hover:text-blue-300 ml-2"
                >
                  {unit.server.hostname || unit.server.ip} →
                </Link>
              </div>
              <span className="text-xs font-medium px-2 py-1 rounded-full bg-red-900/50 text-red-400">
                failed
              </span>
            </div>
          ))}
        </AlertSection>
      )}

      {/* Disk-Alerts */}
      {(data.alerts.criticalDisks?.length || 0) > 0 && (
        <AlertSection
          title="💾 Kritische Festplattennutzung"
          subtitle={`${data.alerts.criticalDisks.length} Partitionen über 90% belegt`}
          type="warning"
        >
          {data.alerts.criticalDisks.map((disk) => (
            <div key={disk.id} className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-white font-mono">{disk.mountPoint}</span>
                <span className="text-xs text-gray-400 ml-2">
                  ({disk.server.hostname || disk.server.ip})
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-24 bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      (disk.usePct ?? 0) >= 95 ? 'bg-red-500' : 'bg-yellow-500'
                    }`}
                    style={{ width: `${Math.min(disk.usePct ?? 0, 100)}%` }}
                  />
                </div>
                <span className={`text-xs font-bold ${
                  (disk.usePct ?? 0) >= 95 ? 'text-red-400' : 'text-yellow-400'
                }`}>
                  {disk.usePct}%
                </span>
              </div>
            </div>
          ))}
        </AlertSection>
      )}

      {/* Scan-Fehler */}
      {data.alerts.failedScansLast24h > 0 && (
        <AlertSection
          title="🔍 Scan-Fehler"
          subtitle={`${data.alerts.failedScansLast24h} fehlgeschlagene Scans in den letzten 24h`}
          type="warning"
        >
          <p className="text-sm text-gray-400">
            Überprüfe die Server-Übersicht für Details zu fehlgeschlagenen Scans.
          </p>
        </AlertSection>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Aktivitäten-Tab
// ═══════════════════════════════════════════════════════════════════════════
function ActivityTab({ data }: { data: DashboardData }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-white">Letzte Aktivitäten</h2>
      </div>
      <div className="divide-y divide-gray-700">
        {data.recentAudit.length === 0 ? (
          <p className="p-4 text-gray-400 text-sm">Noch keine Aktivitäten</p>
        ) : (
          data.recentAudit.map((log) => (
            <div key={log.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-750">
              <div className="flex items-center gap-3">
                <span className="text-lg">{getActionIcon(log.action)}</span>
                <div>
                  <span className="text-sm text-white font-medium">{formatAction(log.action)}</span>
                  {log.target && (
                    <span className="text-xs text-gray-400 ml-2 font-mono">{log.target}</span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <span className="text-xs text-gray-400">{log.user?.username || 'System'}</span>
                <br />
                <span className="text-xs text-gray-500">
                  {new Date(log.createdAt).toLocaleString('de-DE')}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Hilfskomponenten
// ═══════════════════════════════════════════════════════════════════════════

function StatCard({ label, value, color, icon, small }: {
  label: string; value: number; color: string; icon: string; small?: boolean;
}) {
  return (
    <div className={`bg-gray-800 border border-gray-700 rounded-xl ${small ? 'p-3' : 'p-4'} hover:border-gray-600 transition-colors`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={small ? 'text-sm' : 'text-lg'}>{icon}</span>
        <span className={`${small ? 'text-[10px]' : 'text-xs'} text-gray-400`}>{label}</span>
      </div>
      <p className={`${small ? 'text-xl' : 'text-2xl'} font-bold ${color}`}>{value}</p>
    </div>
  );
}

function QueueWidget({ queues }: { queues: DashboardData['queues'] }) {
  const totalActive = queues.serverScans.active + queues.networkScans.active;
  const totalWaiting = queues.serverScans.waiting + queues.networkScans.waiting;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
        🔄 Job-Queue
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-blue-400">{totalActive}</p>
          <p className="text-xs text-gray-400 mt-1">Aktive Jobs</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-yellow-400">{totalWaiting}</p>
          <p className="text-xs text-gray-400 mt-1">Wartend</p>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-2 text-xs text-gray-400">
        <div>Server: {queues.serverScans.active} aktiv / {queues.serverScans.waiting} wartend</div>
        <div>Netzwerk: {queues.networkScans.active} aktiv / {queues.networkScans.waiting} wartend</div>
      </div>
    </div>
  );
}

function SchedulerWidget({ scheduler }: { scheduler: DashboardData['scheduler'] }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
        ⏰ Scheduler
      </h3>
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-green-400">{scheduler.activeServerSchedules}</p>
          <p className="text-xs text-gray-400 mt-1">Server-Schedules</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-cyan-400">{scheduler.activeNetworkSchedules}</p>
          <p className="text-xs text-gray-400 mt-1">Netzwerk-Schedules</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-purple-400">{scheduler.totalScansTriggered}</p>
          <p className="text-xs text-gray-400 mt-1">Scans getriggert</p>
        </div>
      </div>
      {scheduler.upcomingScans && scheduler.upcomingScans.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-400 mb-2">Geplante Scans:</p>
          <div className="space-y-1">
            {scheduler.upcomingScans.slice(0, 3).map((scan, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-white">
                  {scan.type === 'server' ? '🖥️' : '🌐'} {scan.target}
                </span>
                <span className="text-gray-400 font-mono">{scan.schedule}</span>
              </div>
            ))}
            {scheduler.upcomingScans.length > 3 && (
              <p className="text-xs text-gray-500">+ {scheduler.upcomingScans.length - 3} weitere</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RecentScansWidget({ scans }: { scans: DashboardData['recentServerScans'] }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          🔍 Zuletzt gescannte Server
        </h2>
      </div>
      <div className="divide-y divide-gray-700">
        {scans.map((scan) => (
          <Link
            key={scan.id}
            to={`/servers/${scan.id}`}
            className="px-4 py-3 flex items-center justify-between hover:bg-gray-750 block"
          >
            <div className="flex items-center gap-3">
              <StatusDot status={scan.status} />
              <div>
                <p className="text-sm text-white font-medium">
                  {scan.hostname || scan.ip}
                </p>
                <p className="text-xs text-gray-400">
                  {scan._count.services} Services · {scan._count.dockerContainers} Container · {scan._count.processes} Prozesse
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">
                {scan.lastScanAt ? new Date(scan.lastScanAt).toLocaleString('de-DE') : '–'}
              </p>
              {scan.lastScanError && (
                <p className="text-xs text-red-400 max-w-[200px] truncate">{scan.lastScanError}</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ONLINE: 'bg-green-500',
    OFFLINE: 'bg-red-500',
    SCANNING: 'bg-purple-500 animate-pulse',
    ERROR: 'bg-red-500',
    DISCOVERED: 'bg-yellow-500',
    CONFIGURED: 'bg-blue-500',
  };
  return <div className={`w-3 h-3 rounded-full ${colors[status] || 'bg-gray-500'}`} />;
}

function AlertSection({ title, subtitle, type, children }: {
  title: string;
  subtitle: string;
  type: 'critical' | 'warning';
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border ${
      type === 'critical'
        ? 'bg-red-900/10 border-red-800'
        : 'bg-yellow-900/10 border-yellow-800'
    }`}>
      <div className="p-4 border-b border-gray-700">
        <h3 className="text-white font-medium">{title}</h3>
        <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
      </div>
      <div className="p-4 divide-y divide-gray-700/50">{children}</div>
    </div>
  );
}

// ─── Formatierungs-Helfer ────────────────────────────────────────────────

function formatAction(action: string): string {
  const map: Record<string, string> = {
    SERVER_CREATED: 'Server angelegt',
    SERVER_UPDATED: 'Server aktualisiert',
    SERVER_DELETED: 'Server gelöscht',
    SCAN_TRIGGERED: 'Scan gestartet',
    MANUAL_SCAN_TRIGGERED: 'Manueller Scan',
    NETWORK_SCAN_TRIGGERED: 'Netzwerkscan gestartet',
    MULTI_NETWORK_SCAN_TRIGGERED: 'Multi-Netzwerkscan',
    SCHEDULED_SCAN_TRIGGERED: 'Geplanter Scan',
    SCHEDULED_NETWORK_SCAN_TRIGGERED: 'Geplanter Netzwerkscan',
    SCHEDULE_UPDATED: 'Schedule aktualisiert',
    SCHEDULE_REMOVED: 'Schedule entfernt',
    AUTO_CONFIGURE_SERVERS: 'Server auto-konfiguriert',
    STALE_SCAN_DETECTED: 'Stale Scan erkannt',
    PURGE_DISCOVERED_SERVERS: 'Entdeckte Server gelöscht',
  };
  return map[action] || action;
}

function getActionIcon(action: string): string {
  const map: Record<string, string> = {
    SERVER_CREATED: '🆕',
    SERVER_UPDATED: '✏️',
    SERVER_DELETED: '🗑️',
    SCAN_TRIGGERED: '🔍',
    MANUAL_SCAN_TRIGGERED: '🔍',
    NETWORK_SCAN_TRIGGERED: '🌐',
    MULTI_NETWORK_SCAN_TRIGGERED: '🌐',
    SCHEDULED_SCAN_TRIGGERED: '⏰',
    SCHEDULED_NETWORK_SCAN_TRIGGERED: '⏰',
    SCHEDULE_UPDATED: '📅',
    SCHEDULE_REMOVED: '🚫',
    AUTO_CONFIGURE_SERVERS: '🤖',
    STALE_SCAN_DETECTED: '⚠️',
    PURGE_DISCOVERED_SERVERS: '🧹',
  };
  return map[action] || '📋';
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 bg-gray-700 rounded" />
        <div className="flex gap-3">
          <div className="h-10 w-36 bg-gray-700 rounded-lg" />
          <div className="h-10 w-36 bg-gray-700 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-20 bg-gray-800 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-8 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 bg-gray-800 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="h-40 bg-gray-800 rounded-xl" />
        <div className="h-40 bg-gray-800 rounded-xl" />
      </div>
    </div>
  );
}
